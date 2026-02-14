const DEFAULT_CHUNK_SIZE = 4 * 1024 * 1024;

function concatUint8Arrays(chunks, totalLength) {
  const output = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function safeNumber(value, fallback = 0) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) {
    return fallback;
  }
  return num;
}

export function extractContentType(input) {
  const raw = String(input || '').trim().toLowerCase();
  if (!raw) {
    return 'application/octet-stream';
  }
  const contentType = raw.split(';')[0].trim();
  return contentType || 'application/octet-stream';
}

export function guessExtension(contentType, fallback = 'm4a') {
  const normalized = extractContentType(contentType);
  if (normalized === 'audio/mpeg') return 'mp3';
  if (normalized === 'audio/mp4') return 'm4a';
  if (normalized === 'audio/aac') return 'aac';
  if (normalized === 'audio/wav' || normalized === 'audio/x-wav') return 'wav';
  if (normalized === 'audio/ogg') return 'ogg';
  if (normalized === 'audio/flac') return 'flac';
  if (normalized === 'audio/webm') return 'webm';
  if (normalized === 'audio/opus') return 'opus';
  return fallback;
}

export function sanitizeFileStem(input, fallback = 'audio') {
  const value = String(input || '').trim();
  const normalized = value
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);

  if (!normalized) {
    return fallback;
  }

  return normalized.replace(/\s+/g, '_');
}

export function buildAudioFileName(videoId, title, extension) {
  const stem = sanitizeFileStem(title, videoId || 'audio');
  const safeExt = String(extension || 'm4a').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'm4a';
  return `${stem}-${String(videoId || 'yt').slice(0, 11)}.${safeExt}`;
}

async function fetchRangeChunk(url, start, end) {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Range: `bytes=${start}-${end}`,
    },
    credentials: 'omit',
  });

  if (!(response.ok || response.status === 206)) {
    throw new Error(`Range request failed (${response.status}).`);
  }

  const data = new Uint8Array(await response.arrayBuffer());
  return data;
}

async function fetchWithRanges(url, contentLength, chunkSize, onProgress) {
  const chunks = [];
  let downloaded = 0;

  for (let start = 0; start < contentLength; start += chunkSize) {
    const end = Math.min(contentLength - 1, start + chunkSize - 1);
    const chunk = await fetchRangeChunk(url, start, end);
    chunks.push(chunk);
    downloaded += chunk.length;
    if (typeof onProgress === 'function') {
      onProgress({ downloadedBytes: downloaded, totalBytes: contentLength });
    }
  }

  return concatUint8Arrays(chunks, downloaded);
}

async function fetchAsStream(url, onProgress) {
  const response = await fetch(url, {
    method: 'GET',
    credentials: 'omit',
  });

  if (!response.ok) {
    throw new Error(`Download request failed (${response.status}).`);
  }

  const totalBytes = safeNumber(response.headers.get('content-length'), 0);
  if (!response.body || typeof response.body.getReader !== 'function') {
    const data = new Uint8Array(await response.arrayBuffer());
    if (typeof onProgress === 'function') {
      onProgress({ downloadedBytes: data.length, totalBytes: totalBytes || data.length });
    }
    return data;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let downloaded = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (value) {
      chunks.push(value);
      downloaded += value.length;
      if (typeof onProgress === 'function') {
        onProgress({ downloadedBytes: downloaded, totalBytes });
      }
    }
  }

  return concatUint8Arrays(chunks, downloaded);
}

export async function downloadBinary(url, options = {}) {
  const normalizedUrl = String(url || '').trim();
  if (!normalizedUrl) {
    throw new Error('Missing download URL.');
  }

  const chunkSize = Math.max(256 * 1024, safeNumber(options.chunkSize, DEFAULT_CHUNK_SIZE));
  const contentLength = safeNumber(options.contentLength, 0);
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;

  if (contentLength > 0) {
    try {
      return await fetchWithRanges(normalizedUrl, contentLength, chunkSize, onProgress);
    } catch {
      return fetchAsStream(normalizedUrl, onProgress);
    }
  }

  return fetchAsStream(normalizedUrl, onProgress);
}
