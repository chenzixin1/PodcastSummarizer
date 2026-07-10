#!/usr/bin/env python3
import argparse
import json
import os
import sys
from pathlib import Path
from urllib.parse import urlparse

import requests


DEFAULT_BASE_URL = "https://podsum.cc"
DEFAULT_OUTPUT_DIR = "output/youtube/bestpartners"


def parse_args():
    parser = argparse.ArgumentParser(description="Submit recent Best Partners YouTube URLs to PodSum.")
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument("--output-dir", default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--latest-count", type=int, default=20)
    parser.add_argument("--max-submit", type=int, default=10)
    parser.add_argument("--target-success-count", type=int, default=None)
    parser.add_argument("--channel-name", default="最佳拍档")
    parser.add_argument("--retry-failed", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def load_json(path, fallback):
    try:
        return json.loads(path.read_text())
    except FileNotFoundError:
        return fallback


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    tmp_path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
    tmp_path.replace(path)


def build_session(base_url):
    session = requests.Session()
    cookie = os.environ.get("PODSUM_COOKIE")
    if cookie:
        session.headers.update({"Cookie": cookie})
        return session

    domain = urlparse(base_url).hostname
    try:
        import browser_cookie3
    except ImportError as error:
        raise RuntimeError("Set PODSUM_COOKIE or install browser_cookie3 to read local Chrome login cookies.") from error

    session.cookies.update(browser_cookie3.chrome(domain_name=domain))
    return session


def extract_podcast_id(payload):
    if not isinstance(payload, dict):
        return None
    for key in ("podcastId", "id"):
        if payload.get(key):
            return payload[key]
    for key in ("podcast", "data"):
        nested = payload.get(key)
        if isinstance(nested, dict):
            nested_id = nested.get("id") or nested.get("podcastId")
            if nested_id:
                return nested_id
    return None


def response_error(payload):
    if isinstance(payload, dict):
        error = payload.get("error")
        code = payload.get("code")
        if code and error:
            return f"{code}: {error}"
        if error:
            return str(error)
    return str(payload)[:500]


def list_existing_podcasts(session, base_url, pages=8):
    existing = []
    for page in range(1, pages + 1):
        response = session.get(
            f"{base_url}/api/podcasts",
            params={"includePrivate": "true", "page": page, "pageSize": 50},
            timeout=60,
        )
        if response.status_code != 200:
            continue
        payload = response.json()
        existing.extend(payload.get("podcasts") or payload.get("data") or [])
    return existing


def find_existing_podcast(podcasts, video_id, url):
    for podcast in podcasts:
        haystack = json.dumps(podcast, ensure_ascii=False)
        if video_id in haystack or url in haystack:
            return podcast
    return None


def dashboard_url(base_url, podcast_id):
    return f"{base_url}/dashboard/{podcast_id}" if podcast_id else None


def status_is_success(item):
    return item.get("status") in ("uploaded_url", "skipped_existing") and bool(item.get("podcastId"))


def make_result(video, status, **extra):
    return {
        "videoId": video["id"],
        "title": video.get("title"),
        "url": video["url"],
        "status": status,
        **extra,
    }


def submit_video(session, base_url, video, existing_podcasts, channel_name="", dry_run=False):
    existing = find_existing_podcast(existing_podcasts, video["id"], video["url"])
    if existing:
        podcast_id = existing.get("id") or existing.get("_id") or existing.get("podcastId")
        return make_result(
            video,
            "skipped_existing",
            podcastId=podcast_id,
            dashboardUrl=dashboard_url(base_url, podcast_id),
            sourcePublishedAt=video.get("uploadDate"),
            isProcessed=existing.get("isProcessed") or existing.get("processed"),
        )

    if dry_run:
        return make_result(video, "dry_run")

    response = session.post(
        f"{base_url}/api/upload",
        data={
            "youtubeUrl": video["url"],
            "sourceReference": video["url"],
            "channelName": channel_name,
            "sourcePublishedAt": video.get("uploadDate") or "",
            "isPublic": "false",
        },
        timeout=180,
    )
    try:
        payload = response.json()
    except ValueError:
        payload = {"raw": response.text[:500]}

    if not response.ok:
        return make_result(
            video,
            "failed",
            httpStatus=response.status_code,
            response=payload,
            error=response_error(payload),
        )

    podcast_id = extract_podcast_id(payload)
    if not podcast_id:
        refreshed = list_existing_podcasts(session, base_url, pages=2)
        existing = find_existing_podcast(refreshed, video["id"], video["url"])
        if existing:
            podcast_id = existing.get("id") or existing.get("_id") or existing.get("podcastId")

    return make_result(
        video,
        "uploaded_url",
        podcastId=podcast_id,
        dashboardUrl=dashboard_url(base_url, podcast_id),
        sourcePublishedAt=video.get("uploadDate"),
        processingQueued=payload.get("processingQueued") if isinstance(payload, dict) else None,
        youtubeIngest=payload.get("youtubeIngest") if isinstance(payload, dict) else None,
        remainingCredits=payload.get("remainingCredits") if isinstance(payload, dict) else None,
    )


def main():
    args = parse_args()
    base_url = args.base_url.rstrip("/")
    output_dir = Path(args.output_dir)
    index = load_json(output_dir / "index.json", None)
    if not index:
        raise RuntimeError(f"Missing index: {output_dir / 'index.json'}")

    results_path = output_dir / "url-submit-results.json"
    results = load_json(results_path, [])
    results_by_id = {item.get("videoId"): item for item in results}
    success_count = sum(1 for item in results if status_is_success(item))

    session = build_session(base_url)
    existing_podcasts = list_existing_podcasts(session, base_url)
    candidates = (index.get("videos") or [])[: args.latest_count]

    submitted = []
    for video in candidates:
        previous = results_by_id.get(video.get("id"))
        if previous and status_is_success(previous):
            continue
        if previous and previous.get("status") == "failed" and not args.retry_failed:
            continue
        if len(submitted) >= args.max_submit:
            break
        if args.target_success_count is not None and success_count >= args.target_success_count:
            break

        result = submit_video(session, base_url, video, existing_podcasts, channel_name=args.channel_name, dry_run=args.dry_run)
        results_by_id[video["id"]] = result
        submitted.append(result)
        if status_is_success(result):
            success_count += 1
        print(f"{video['id']}\t{result['status']}\t{result.get('dashboardUrl') or result.get('error') or ''}")

    ordered_ids = []
    for item in results:
        if item.get("videoId") not in ordered_ids:
            ordered_ids.append(item.get("videoId"))
    for item in submitted:
        if item.get("videoId") not in ordered_ids:
            ordered_ids.append(item.get("videoId"))

    write_json(results_path, [results_by_id[item_id] for item_id in ordered_ids if item_id in results_by_id])
    print(json.dumps({"submitted": len(submitted), "successCount": success_count, "resultsPath": str(results_path)}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"submit failed: {error}", file=sys.stderr)
        sys.exit(1)
