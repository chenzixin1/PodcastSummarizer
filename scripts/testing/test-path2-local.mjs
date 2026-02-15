#!/usr/bin/env node

import { randomUUID } from 'crypto';
import process from 'process';
import fs from 'fs/promises';
import path from 'path';

const YOUTUBE_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';

function parseVideoId(input) {
  const raw = String(input || '').trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(raw)) {
    return raw;
  }

  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase();
    if (host.includes('youtu.be')) {
      const id = parsed.pathname.split('/').filter(Boolean)[0] || '';
      if (/^[A-Za-z0-9_-]{11}$/.test(id)) return id;
    }

    if (host.includes('youtube.com')) {
      const v = parsed.searchParams.get('v') || '';
      if (/^[A-Za-z0-9_-]{11}$/.test(v)) return v;
      const parts = parsed.pathname.split('/').filter(Boolean);
      const marker = parts.findIndex((item) => ['shorts', 'embed', 'live', 'v'].includes(item));
      if (marker >= 0 && /^[A-Za-z0-9_-]{11}$/.test(parts[marker + 1] || '')) {
        return parts[marker + 1];
      }
    }
  } catch {
    // Ignore parse errors and fall through.
  }

  const match = raw.match(/(?:v=|be\/|shorts\/|embed\/|live\/)([A-Za-z0-9_-]{11})/i);
  if (match?.[1]) {
    return match[1];
  }

  throw new Error(`Invalid YouTube URL: ${raw}`);
}

function extensionFromFormat(format) {
  const mimeType = String(format?.mimeType || '').toLowerCase();
  const container = String(format?.container || '').toLowerCase();
  if (mimeType.includes('audio/mpeg') || container === 'mp3') return { ext: 'mp3', mime: 'audio/mpeg' };
  if (mimeType.includes('audio/wav') || container === 'wav') return { ext: 'wav', mime: 'audio/wav' };
  if (mimeType.includes('audio/flac') || container === 'flac') return { ext: 'flac', mime: 'audio/flac' };
  if (mimeType.includes('audio/ogg') || container === 'ogg') return { ext: 'ogg', mime: 'audio/ogg' };
  if (mimeType.includes('audio/webm') || container === 'webm' || mimeType.includes('audio/opus')) {
    return { ext: 'webm', mime: 'audio/webm' };
  }
  return { ext: 'm4a', mime: 'audio/mp4' };
}

function pickFormat(formats) {
  const rank = (format) => {
    const { ext } = extensionFromFormat(format);
    const pref = ['m4a', 'mp3', 'wav', 'flac', 'ogg', 'webm'].indexOf(ext);
    const prefScore = pref >= 0 ? pref : 99;
    const bitrate = Number(format?.audioBitrate || format?.bitrate || 0);
    return prefScore * 100000 - bitrate;
  };

  return [...formats].sort((a, b) => rank(a) - rank(b))[0] || null;
}

function streamToBuffer(stream, maxBytes = 150 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;

    stream.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        stream.destroy(new Error(`Audio too large: ${total} > ${maxBytes}`));
        return;
      }
      chunks.push(chunk);
    });

    stream.once('error', (error) => reject(error));
    stream.once('end', () => resolve(Buffer.concat(chunks)));
  });
}

async function requestJson(url, init) {
  const response = await fetch(url, init);
  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${text || '(empty body)'}`);
  }

  return data;
}

async function ensureUser(baseUrl, email, password, name) {
  const registerResp = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name }),
  });

  if (registerResp.status === 201) {
    return;
  }

  if (registerResp.status === 409) {
    return;
  }

  const body = await registerResp.text();
  throw new Error(`Register failed (${registerResp.status}): ${body}`);
}

async function extensionLogin(baseUrl, email, password) {
  const body = await requestJson(`${baseUrl}/api/extension/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  const token = body?.data?.accessToken;
  if (!token) {
    throw new Error(`Login response missing accessToken: ${JSON.stringify(body)}`);
  }
  return token;
}

async function downloadYoutubeAudio(url) {
  const mod = await import('@distube/ytdl-core');
  const ytdl = mod.default || mod;
  const commonOptions = {
    requestOptions: {
      headers: {
        'User-Agent': YOUTUBE_USER_AGENT,
        'Accept-Language': 'en-US,en;q=0.9',
      },
    },
  };

  const info = await ytdl.getInfo(url, commonOptions);
  const formats = ytdl
    .filterFormats(info.formats, 'audioonly')
    .filter((item) => Boolean(item?.url));

  if (!formats.length) {
    throw new Error('No downloadable audio formats found.');
  }

  const format = pickFormat(formats);
  if (!format) {
    throw new Error('Unable to pick audio format.');
  }

  const picked = extensionFromFormat(format);
  const stream = ytdl.downloadFromInfo(info, {
    ...commonOptions,
    format,
    highWaterMark: 1 << 25,
  });
  const buffer = await streamToBuffer(stream);

  return {
    buffer,
    title: String(info?.videoDetails?.title || 'YouTube Video'),
    durationSec: Number.parseInt(String(info?.videoDetails?.lengthSeconds || '0'), 10) || null,
    extension: picked.ext,
    mimeType: picked.mime,
  };
}

function mimeFromExtension(ext) {
  const normalized = String(ext || '').toLowerCase();
  if (normalized === 'mp3') return 'audio/mpeg';
  if (normalized === 'wav') return 'audio/wav';
  if (normalized === 'flac') return 'audio/flac';
  if (normalized === 'ogg') return 'audio/ogg';
  if (normalized === 'webm' || normalized === 'opus') return 'audio/webm';
  if (normalized === 'm4a' || normalized === 'mp4' || normalized === 'aac') return 'audio/mp4';
  return 'application/octet-stream';
}

async function loadAudioFromFile(filePath) {
  const absolutePath = path.resolve(filePath);
  const stat = await fs.stat(absolutePath);
  if (!stat.isFile()) {
    throw new Error(`Not a file: ${absolutePath}`);
  }

  const buffer = await fs.readFile(absolutePath);
  const ext = path.extname(absolutePath).replace(/^\./, '').toLowerCase() || 'wav';
  return {
    buffer,
    title: path.basename(absolutePath),
    durationSec: null,
    extension: ext,
    mimeType: mimeFromExtension(ext),
  };
}

async function submitPath2Task(baseUrl, token, payload) {
  const form = new FormData();
  const blob = new Blob([payload.audioBuffer], { type: payload.mimeType });
  form.append('file', blob, payload.fileName);
  form.append('fileName', payload.fileName);
  form.append('sourceReference', payload.youtubeUrl);
  form.append('isPublic', payload.isPublic ? 'true' : 'false');
  form.append('videoId', payload.videoId);
  form.append('title', payload.title);
  form.append('clientTaskId', payload.clientTaskId);
  form.append('traceId', payload.traceId);
  if (payload.durationSec) {
    form.append('durationSec', String(payload.durationSec));
  }

  return requestJson(`${baseUrl}/api/extension/upload-audio`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: form,
  });
}

async function pollTranscribeStatus(baseUrl, token, jobId, maxPolls = 8, intervalMs = 5000) {
  for (let i = 1; i <= maxPolls; i += 1) {
    const result = await requestJson(`${baseUrl}/api/extension/transcribe-status/${encodeURIComponent(jobId)}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    const status = String(result?.data?.status || 'unknown');
    console.log(`[poll ${i}/${maxPolls}] status=${status}`);
    if (status === 'completed' || status === 'failed') {
      return result;
    }
    if (i < maxPolls) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
  return null;
}

async function main() {
  const youtubeUrl = String(process.argv[2] || '').trim();
  if (!youtubeUrl) {
    console.error('Usage: node scripts/testing/test-path2-local.mjs <youtubeUrl> [baseUrl]');
    process.exitCode = 1;
    return;
  }

  const baseUrl = String(process.argv[3] || process.env.BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
  const videoId = parseVideoId(youtubeUrl);
  const suffix = randomUUID().slice(0, 8);
  const email = process.env.EXT_TEST_EMAIL || `path2-smoke-${suffix}@example.com`;
  const password = process.env.EXT_TEST_PASSWORD || `Path2!${suffix}`;
  const name = process.env.EXT_TEST_NAME || 'Path2 Smoke User';
  const isPublic = String(process.env.EXT_TEST_IS_PUBLIC || 'false').toLowerCase() === 'true';
  const localAudioFile = String(process.env.EXT_TEST_AUDIO_FILE || '').trim();

  console.log(`[1/5] base=${baseUrl}`);
  console.log(`[2/5] ensure test user email=${email}`);
  await ensureUser(baseUrl, email, password, name);

  console.log('[3/5] extension login');
  const accessToken = await extensionLogin(baseUrl, email, password);

  console.log(`[4/5] prepare audio payload videoId=${videoId}`);
  const audio = localAudioFile ? await loadAudioFromFile(localAudioFile) : await downloadYoutubeAudio(youtubeUrl);
  const fileName = `${videoId}-${Date.now()}.${audio.extension}`;
  console.log(`audio bytes=${audio.buffer.length} mime=${audio.mimeType} file=${fileName}`);

  console.log('[5/5] submit /api/extension/upload-audio');
  const traceId = `local-smoke-${Date.now()}-${videoId}`;
  const clientTaskId = `local-${videoId}-${Date.now()}`;
  const submitResp = await submitPath2Task(baseUrl, accessToken, {
    audioBuffer: audio.buffer,
    mimeType: audio.mimeType,
    fileName,
    youtubeUrl,
    videoId,
    title: audio.title,
    isPublic,
    durationSec: audio.durationSec,
    traceId,
    clientTaskId,
  });

  const jobId = submitResp?.data?.transcriptionJobId;
  const monitorTaskId = submitResp?.data?.monitorTaskId;
  console.log(`submitted transcriptionJobId=${jobId || '-'} monitorTaskId=${monitorTaskId || '-'}`);

  if (!jobId) {
    console.error('No transcriptionJobId returned.');
    process.exitCode = 2;
    return;
  }

  const pollResult = await pollTranscribeStatus(baseUrl, accessToken, jobId, 6, 5000);
  if (!pollResult) {
    console.log('poll timeout: task submitted successfully, still running');
    return;
  }

  console.log(`final status=${pollResult?.data?.status || 'unknown'}`);
  if (pollResult?.data?.status === 'failed') {
    console.log(`final error=${pollResult?.data?.lastError || '-'}`);
    process.exitCode = 3;
  }
}

main().catch((error) => {
  console.error('[smoke failed]', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
