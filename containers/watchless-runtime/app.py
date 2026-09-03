from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import html
import json
import os
import re
import shutil
import subprocess
import tempfile
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import quote

import httpx
from fastapi import BackgroundTasks, FastAPI, Header, HTTPException
from pydantic import BaseModel
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer
from reportlab.lib.styles import getSampleStyleSheet

app = FastAPI(docs_url=None, redoc_url=None)
states: dict[str, dict[str, Any]] = {}
YOUTUBE_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
MODEL = os.getenv("WATCHLESS_MODEL", "openai/gpt-5.6-luna")
if MODEL != "openai/gpt-5.6-luna":
    raise RuntimeError("WATCHLESS_MODEL must be openai/gpt-5.6-luna")


class JobRequest(BaseModel):
    jobId: str


def secret_ok(value: str | None) -> bool:
    expected = os.getenv("WATCHLESS_INTERNAL_SECRET", "")
    return bool(expected and value and hmac.compare_digest(value, expected))


def run(command: list[str], timeout: int = 1800) -> str:
    result = subprocess.run(command, capture_output=True, text=True, timeout=timeout, check=False)
    if result.returncode:
        raise RuntimeError((result.stderr or result.stdout)[-1500:])
    return result.stdout


async def callback(path: str, method: str = "POST", **kwargs: Any) -> httpx.Response:
    base = os.environ["PODSUM_CALLBACK_BASE"].rstrip("/")
    headers = kwargs.pop("headers", {})
    headers["x-watchless-internal-secret"] = os.environ["WATCHLESS_INTERNAL_SECRET"]
    timeout = httpx.Timeout(connect=30, read=180, write=300, pool=30)
    last_error: Exception | None = None
    for attempt in range(3):
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.request(method, f"{base}{path}", headers=headers, **kwargs)
            response.raise_for_status()
            return response
        except httpx.HTTPStatusError as exc:
            last_error = exc
            if exc.response.status_code < 500 or attempt == 2:
                raise
        except httpx.TransportError as exc:
            last_error = exc
            if attempt == 2:
                raise
        await asyncio.sleep(2 ** attempt)
    raise last_error or RuntimeError("PodSum callback failed")


async def status(
    job_id: str,
    job_status: str,
    stage: str,
    progress: int,
    message: str,
    title: str | None = None,
) -> None:
    states[job_id] = {"status": "running", "stage": stage, "progress": progress}
    await callback(
        f"/api/watchless/jobs/internal/{quote(job_id)}/status",
        json={
            "status": job_status,
            "stage": stage,
            "progressCurrent": progress,
            "progressTotal": 100,
            "title": title,
            "message": message,
        },
    )


def failure_code(exc: Exception) -> str:
    if isinstance(exc, httpx.WriteTimeout):
        return "WATCHLESS_UPSTREAM_WRITE_TIMEOUT"
    if isinstance(exc, httpx.ReadTimeout):
        return "WATCHLESS_UPSTREAM_READ_TIMEOUT"
    if isinstance(exc, httpx.TimeoutException):
        return "WATCHLESS_UPSTREAM_TIMEOUT"
    if isinstance(exc, subprocess.TimeoutExpired):
        return "WATCHLESS_MEDIA_TIMEOUT"
    return "WATCHLESS_RUNTIME_FAILED"


async def upload(job_id: str, path: str, role: str, file: Path, content_type: str) -> None:
    data = await asyncio.to_thread(file.read_bytes)
    digest = hashlib.sha256(data).hexdigest()
    await callback(
        f"/api/watchless/jobs/internal/{quote(job_id)}/assets?path={quote(path)}&role={quote(role)}",
        method="PUT",
        content=data,
        headers={"content-type": content_type, "x-content-sha256": digest},
    )


def video_id_from_url(url: str) -> str:
    patterns = [r"youtu\.be/([A-Za-z0-9_-]{11})", r"[?&]v=([A-Za-z0-9_-]{11})", r"/shorts/([A-Za-z0-9_-]{11})"]
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    if YOUTUBE_ID.fullmatch(url):
        return url
    raise RuntimeError("Only canonical YouTube URLs are accepted")


def transcribe(audio: Path, language: str) -> dict[str, Any]:
    data = audio.read_bytes()
    if len(data) > 100 * 1024 * 1024:
        raise RuntimeError("ASR audio exceeds 100 MiB")
    access = os.getenv("VOLCENGINE_API_KEY", "")
    app_id = os.getenv("VOLCENGINE_APP_KEY", "")
    if not access:
        raise RuntimeError("VOLCENGINE_API_KEY is not configured")
    headers = {
        "Content-Type": "application/json",
        "X-Api-Resource-Id": "volc.bigasr.auc_turbo",
        "X-Api-Request-Id": str(uuid.uuid4()),
        "X-Api-Sequence": "-1",
    }
    if app_id:
        headers.update({"X-Api-App-Key": app_id, "X-Api-Access-Key": access})
    else:
        headers["X-Api-Key"] = access
    payload = {
        "user": {"uid": app_id or "podsum-watchless"},
        "audio": {"format": "mp3", "data": base64.b64encode(data).decode("ascii"), "language": language or "en-US"},
        "request": {
            "model_name": "bigmodel", "enable_itn": True, "enable_punc": True,
            "enable_speaker_info": True, "enable_channel_split": False, "enable_ddc": False,
            "show_utterances": True, "vad_segment": True, "sensitive_words_filter": "",
        },
    }
    timeout = httpx.Timeout(connect=30, read=900, write=1800, pool=30)
    with httpx.Client(timeout=timeout) as client:
        response = client.post("https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash", headers=headers, json=payload)
    if response.status_code != 200 or response.headers.get("X-Api-Status-Code") != "20000000":
        raise RuntimeError(f"Volcengine ASR failed: HTTP {response.status_code}, code {response.headers.get('X-Api-Status-Code', 'missing')}")
    result = response.json()
    if not result.get("result"):
        raise RuntimeError("Volcengine ASR returned no result")
    return result


def transcript_lines(asr: dict[str, Any]) -> tuple[str, list[dict[str, Any]]]:
    result = asr.get("result") or {}
    utterances = result.get("utterances") or []
    lines, normalized = [], []
    for item in utterances:
        text = str(item.get("text") or "").strip()
        if not text:
            continue
        additions = item.get("additions") if isinstance(item.get("additions"), dict) else {}
        raw_speaker = item.get("speaker")
        if raw_speaker in (None, ""):
            raw_speaker = additions.get("speaker")
        speaker = str(raw_speaker) if raw_speaker not in (None, "") else "unknown"
        start = float(item.get("start_time", 0)) / 1000
        end = float(item.get("end_time", item.get("start_time", 0))) / 1000
        lines.append(f"{speaker}: {text}")
        normalized.append({"speaker": speaker, "startSec": start, "endSec": max(end, start + 0.5), "text": text})
    if not lines:
        text = str(result.get("text") or "").strip()
        lines = [f"Speaker: {text}"] if text else []
        normalized = [{"speaker": "Speaker", "startSec": 0, "endSec": 1, "text": text}] if text else []
    return "\n".join(lines), normalized


def collapse_original_turns(
    utterances: list[dict[str, Any]],
    display_speaker: Any,
) -> list[dict[str, str]]:
    """Group adjacent ASR segments without rewriting any spoken words."""
    turns: list[dict[str, str]] = []
    for item in utterances:
        text = str(item.get("text") or "").strip()
        if not text:
            continue
        speaker = str(display_speaker(item)).strip()
        if turns and turns[-1]["speaker"] == speaker:
            turns[-1]["text"] += f" {text}"
        else:
            turns.append({"speaker": speaker, "text": text})
    return turns


def verbatim_markdown(turns: list[dict[str, str]]) -> str:
    return "\n\n".join(f"**{turn['speaker']}：** {turn['text']}" for turn in turns)


def verbatim_transcript(turns: list[dict[str, str]]) -> str:
    return "\n\n".join(f"{turn['speaker']}: {turn['text']}" for turn in turns)


def openrouter_article(metadata: dict[str, Any], utterances: list[dict[str, Any]], duration: float) -> dict[str, Any]:
    key = os.getenv("OPENROUTER_API_KEY", "")
    if not key:
        raise RuntimeError("OPENROUTER_API_KEY is not configured")
    compact = utterances[:8000]
    schema = {
        "type": "object",
        "properties": {
            "titleZh": {"type": "string"}, "summaryZh": {"type": "string"}, "summaryEn": {"type": "string"},
            "speakers": {"type": "array", "minItems": 1, "maxItems": 20, "items": {"type": "object", "properties": {
                "id": {"type": "string"}, "name": {"type": "string"}},
                "required": ["id", "name"], "additionalProperties": False}},
            "scenes": {"type": "array", "minItems": 3, "maxItems": 30, "items": {"type": "object", "properties": {
                "titleZh": {"type": "string"}, "startSec": {"type": "number"}, "endSec": {"type": "number"},
                "visualDescriptionZh": {"type": "string"}, "boundaryReasonEn": {"type": "string"}},
                "required": ["titleZh", "startSec", "endSec", "visualDescriptionZh", "boundaryReasonEn"],
                "additionalProperties": False}},
        },
        "required": ["titleZh", "summaryZh", "summaryEn", "speakers", "scenes"], "additionalProperties": False,
    }
    prompt = (
        "Analyze this speaker-labelled transcript and return only metadata for an illustrated transcript. "
        "The summary belongs only in summaryZh. Never output, translate, rewrite, polish, condense, or summarize the scene body; the application will copy every scene body verbatim from ASR. "
        "Choose scene boundaries that preserve the full chronological timeline and keep each range meaningful. "
        "Return a speakers mapping from every ASR speaker id to a real participant name only when the transcript or metadata supports it; otherwise use Speaker 1, Speaker 2, and so on. "
        "Do not invent claims. Scene ranges must be ordered, non-overlapping and cover 0 through duration.\n"
        + json.dumps({"metadata": metadata, "durationSec": duration, "utterances": compact}, ensure_ascii=False)
    )
    payload = {
        "model": MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "response_format": {"type": "json_schema", "json_schema": {"name": "watchless_article", "strict": True, "schema": schema}},
        "temperature": 0.2,
        "max_tokens": 65536,
        "provider": {"require_parameters": True},
    }
    with httpx.Client(timeout=1200) as client:
        response = client.post("https://openrouter.ai/api/v1/chat/completions", headers={"authorization": f"Bearer {key}", "content-type": "application/json"}, json=payload)
    response.raise_for_status()
    content = response.json()["choices"][0]["message"]["content"]
    return json.loads(content)


def time_label(start: float, end: float) -> str:
    def one(value: float) -> str:
        value = int(max(0, value)); return f"{value // 60:02d}:{value % 60:02d}"
    return f"{one(start)}–{one(end)}"


def build_pdf(article: dict[str, Any], path: Path) -> None:
    pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))
    styles = getSampleStyleSheet()
    for style in styles.byName.values():
        style.fontName = "STSong-Light"
    styles["BodyText"].leading = 18
    story = [
        Paragraph(html.escape(article["titleZh"]), styles["Title"]),
        Spacer(1, 8),
        Paragraph(f"来源：{html.escape(article['sourceUrl'])}", styles["BodyText"]),
        Spacer(1, 14),
        Paragraph("内容摘要", styles["Heading2"]),
        Paragraph(html.escape(re.sub(r"\*\*([^*]+)\*\*", r"\1", article["summaryZh"])), styles["BodyText"]),
    ]
    for scene in article["scenes"]:
        story.extend([
            Spacer(1, 16),
            Paragraph(f"{scene['number']:02d}. {html.escape(scene['titleZh'])}", styles["Heading2"]),
            Paragraph(html.escape(scene["timeLabel"]), styles["BodyText"]),
            Spacer(1, 6),
        ])
        paragraphs = [part.strip() for part in re.split(r"\n\s*\n", scene["articleZh"]) if part.strip()]
        for paragraph in paragraphs:
            match = re.match(r"^\*\*([^*\n]{1,80})[：:]\*\*\s*(.*)$", paragraph, re.S)
            if match:
                speaker = html.escape(match.group(1).strip())
                spoken_text = html.escape(match.group(2).strip()).replace("\n", "<br/>")
                story.extend([Paragraph(f"<b>{speaker}：</b> {spoken_text}", styles["BodyText"]), Spacer(1, 7)])
            else:
                story.extend([Paragraph(html.escape(paragraph).replace("\n", "<br/>"), styles["BodyText"]), Spacer(1, 7)])
    SimpleDocTemplate(str(path), pagesize=A4, title=article["titleZh"]).build(story)


async def process(job_id: str) -> None:
    states[job_id] = {"status": "running"}
    work = Path(tempfile.mkdtemp(prefix=f"watchless-{job_id}-", dir="/work"))
    try:
        info_response = await callback(f"/api/watchless/jobs/internal/{quote(job_id)}", method="GET")
        job = info_response.json()["data"]
        source = str(job.get("sourceUrl") or "")
        video_id = video_id_from_url(source)
        await status(job_id, "preparing", "preparing_metadata", 5, "正在读取视频信息")
        metadata = json.loads(await asyncio.to_thread(
            run,
            ["yt-dlp", "--no-playlist", "--no-warnings", "--dump-single-json", source],
            180,
        ))
        duration = float(metadata.get("duration") or 0)
        if duration <= 0 or duration > 7200:
            raise RuntimeError("Video duration must be between 1 second and 2 hours")
        metadata_path = work / "source-metadata.json"
        metadata_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
        await upload(job_id, "intermediate/source-metadata.json", "manifest", metadata_path, "application/json")
        await status(job_id, "preparing", "preparing_metadata", 8, "视频来源元数据已保存", metadata.get("title"))
        video = work / "video.mp4"
        await status(job_id, "preparing", "preparing_download", 10, "正在下载授权视频", metadata.get("title"))
        await asyncio.to_thread(
            run,
            ["yt-dlp", "--no-playlist", "--max-filesize", "1G", "-f", "bv*[height<=1080]+ba/b[height<=1080]", "--merge-output-format", "mp4", "-o", str(video), source],
            2400,
        )
        if not video.exists() or video.stat().st_size > 1024 * 1024 * 1024:
            raise RuntimeError("Video download missing or exceeds 1 GiB")
        audio = work / "audio.mp3"
        await status(job_id, "preparing", "preparing_audio", 18, "正在提取语音轨道", metadata.get("title"))
        await asyncio.to_thread(
            run,
            ["ffmpeg", "-nostdin", "-y", "-i", str(video), "-vn", "-ac", "1", "-ar", "16000", "-b:a", "32k", str(audio)],
            1800,
        )
        await upload(job_id, "intermediate/audio.mp3", "other", audio, "audio/mpeg")
        await status(job_id, "preparing", "preparing_audio", 22, "压缩语音轨道已保存", metadata.get("title"))
        await status(job_id, "transcribing", "transcribing_upload", 25, "正在上传音频并识别原话", metadata.get("title"))
        asr = await asyncio.to_thread(transcribe, audio, job.get("preferredLanguage") or "en-US")
        asr_path = work / "asr-raw.json"
        asr_path.write_text(json.dumps(asr, ensure_ascii=False, indent=2), encoding="utf-8")
        await upload(job_id, "intermediate/asr-raw.json", "manifest", asr_path, "application/json")
        transcript, utterances = transcript_lines(asr)
        if not utterances:
            raise RuntimeError("Transcript is empty")
        transcript_path = work / "transcript.txt"
        transcript_path.write_text(transcript, encoding="utf-8")
        await upload(job_id, "transcript.txt", "transcript", transcript_path, "text/plain; charset=utf-8")
        await status(job_id, "transcribing", "transcribing_upload", 45, "ASR 原始结果和原话转录已保存", metadata.get("title"))
        await status(job_id, "segmenting", "segmenting_structure", 50, "正在识别说话人并划分场景")
        generated = await asyncio.to_thread(openrouter_article, {"title": metadata.get("title"), "author": metadata.get("uploader")}, utterances, duration)
        structure_path = work / "scene-structure.json"
        structure_path.write_text(json.dumps(generated, ensure_ascii=False, indent=2), encoding="utf-8")
        await upload(job_id, "intermediate/scene-structure.json", "manifest", structure_path, "application/json")
        await status(job_id, "segmenting", "segmenting_structure", 60, "说话人与场景结构已保存", metadata.get("title"))
        def clean_speaker_name(value: Any) -> str:
            return re.sub(r"[\r\n:]+", " ", str(value or "")).strip()[:80]

        speaker_map = {
            str(item.get("id")): clean_speaker_name(item.get("name"))
            for item in generated.get("speakers", [])
            if str(item.get("id") or "").strip() and clean_speaker_name(item.get("name"))
        }
        def display_speaker(item: dict[str, Any]) -> str:
            speaker_id = str(item["speaker"])
            return speaker_map.get(speaker_id) or ("Speaker" if speaker_id == "unknown" else f"Speaker {speaker_id}")

        transcript = "\n".join(
            f"{display_speaker(item)}: {item['text']}"
            for item in utterances
        )
        transcript_path.write_text(transcript, encoding="utf-8")
        await upload(job_id, "transcript.txt", "transcript", transcript_path, "text/plain; charset=utf-8")
        scenes = sorted(generated["scenes"], key=lambda item: float(item.get("startSec", 0)))
        max_scene_count = max(1, min(30, int(duration)))
        if len(scenes) > max_scene_count:
            scenes = scenes[:max_scene_count]
        starts = [0.0]
        for index in range(1, len(scenes)):
            proposed = max(starts[-1] + 1, float(scenes[index].get("startSec", starts[-1] + 1)))
            starts.append(min(proposed, max(starts[-1] + 1, duration - (len(scenes) - index))))
        await status(job_id, "rendering", "rendering_keyframes", 65, "正在生成场景关键帧")
        for index, scene in enumerate(scenes):
            scene["startSec"] = starts[index]
            scene["endSec"] = starts[index + 1] if index + 1 < len(starts) else duration
            turns = [
                item for item in utterances
                if item["startSec"] >= scene["startSec"]
                and (item["startSec"] < scene["endSec"] or index == len(scenes) - 1)
            ]
            original_turns = collapse_original_turns(turns, display_speaker)
            if not original_turns:
                raise RuntimeError(f"Scene {index + 1} contains no source utterance")
            scene["articleZh"] = verbatim_markdown(original_turns)
            scene["transcriptEn"] = verbatim_transcript(original_turns)
            scene["id"] = f"scene-{index + 1}"
            scene["number"] = index + 1
            scene["timeLabel"] = time_label(scene["startSec"], scene["endSec"])
            scene["keyframe"] = f"/api/files/watchless/{video_id}/keyframes/scene_{index + 1:03d}.jpg"
            scene["keyframeAlt"] = scene.get("visualDescriptionZh") or scene["titleZh"]
            frame = work / f"scene_{index + 1:03d}.jpg"
            midpoint = min(duration, (scene["startSec"] + scene["endSec"]) / 2)
            await asyncio.to_thread(
                run,
                ["ffmpeg", "-nostdin", "-y", "-ss", str(midpoint), "-i", str(video), "-frames:v", "1", "-q:v", "3", str(frame)],
                120,
            )
            await upload(job_id, f"keyframes/{frame.name}", "keyframe", frame, "image/jpeg")
            frame_progress = 65 + round(((index + 1) / max(1, len(scenes))) * 10)
            states[job_id] = {"status": "running", "stage": "rendering_keyframes", "progress": frame_progress}
            if index + 1 == len(scenes) or (index + 1) % 4 == 0:
                await status(
                    job_id,
                    "rendering",
                    "rendering_keyframes",
                    frame_progress,
                    f"已生成 {index + 1}/{len(scenes)} 个关键帧",
                )
        article = {
            "id": f"watchless-{video_id.lower().replace('_', '-')}", "videoId": video_id,
            "title": metadata.get("title") or video_id, "titleZh": generated["titleZh"], "eyebrow": "Watchless",
            "author": metadata.get("uploader") or "YouTube", "sourceName": "YouTube", "sourceUrl": f"https://www.youtube.com/watch?v={video_id}",
            "pdfUrl": f"/api/files/watchless/{video_id}/article.pdf", "durationSec": duration,
            "durationLabel": time_label(0, duration).split("–")[1], "publishedLabel": str(metadata.get("upload_date") or ""),
            "summaryZh": generated["summaryZh"], "summaryEn": generated["summaryEn"],
            "bodyMode": "verbatim", "transcriptLanguage": "other", "availableLanguageModes": ["zh"], "scenes": scenes,
        }
        article_path = work / "article.json"
        article_path.write_text(json.dumps(article, ensure_ascii=False, indent=2), encoding="utf-8")
        pdf_path = work / "article.pdf"
        await asyncio.to_thread(build_pdf, article, pdf_path)
        await upload(job_id, "article.json", "article", article_path, "application/json")
        await upload(job_id, "article.pdf", "pdf", pdf_path, "application/pdf")
        await upload(job_id, "transcript.txt", "transcript", transcript_path, "text/plain; charset=utf-8")
        await status(job_id, "validating", "validating_assets", 78, "正在核对文章、原话实录和附件")
        states[job_id] = {"status": "completed"}
    except Exception as exc:
        previous = states.get(job_id, {})
        states[job_id] = {
            "status": "failed",
            "error": str(exc)[:1800],
            "errorCode": failure_code(exc),
            "stage": previous.get("stage", "preparing"),
            "progress": previous.get("progress", 0),
        }
    finally:
        shutil.rmtree(work, ignore_errors=True)


@app.get("/ping")
def ping() -> dict[str, bool]:
    return {"ok": True}


@app.post("/jobs", status_code=202)
async def create_job(body: JobRequest, tasks: BackgroundTasks, x_runtime_secret: str | None = Header(default=None)) -> dict[str, str]:
    if not secret_ok(x_runtime_secret):
        raise HTTPException(403, "Forbidden")
    if body.jobId in states and states[body.jobId]["status"] in {"running", "completed"}:
        return {"jobId": body.jobId, **states[body.jobId]}
    states[body.jobId] = {"status": "queued"}
    tasks.add_task(process, body.jobId)
    return {"jobId": body.jobId, "status": "queued"}


@app.get("/jobs/{job_id}")
def get_job(job_id: str, x_runtime_secret: str | None = Header(default=None)) -> dict[str, Any]:
    if not secret_ok(x_runtime_secret):
        raise HTTPException(403, "Forbidden")
    if job_id not in states:
        raise HTTPException(404, "Not found")
    return {"jobId": job_id, **states[job_id]}
