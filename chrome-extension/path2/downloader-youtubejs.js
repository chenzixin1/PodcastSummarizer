import { Innertube } from './vendor/youtubei-browser.js';
import {
  buildAudioFileName,
  extractContentType,
  guessExtension,
} from './download-utils.js';

const innertubeRef = {
  instancePromise: null,
};

async function getInnertube() {
  if (!innertubeRef.instancePromise) {
    innertubeRef.instancePromise = Innertube.create({
      retrieve_player: true,
      generate_session_locally: true,
    });
  }
  return innertubeRef.instancePromise;
}

function safeDuration(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    return null;
  }
  return Math.round(num);
}

function toUint8Array(value) {
  if (value instanceof Uint8Array) {
    return value;
  }
  return new Uint8Array(value);
}

function inferContainerFromMimeType(mimeType) {
  const normalized = extractContentType(mimeType || '');
  if (normalized.startsWith('audio/mp4')) return 'mp4';
  if (normalized.startsWith('audio/mpeg')) return 'mp3';
  if (normalized.startsWith('audio/wav') || normalized.startsWith('audio/x-wav')) return 'wav';
  if (normalized.startsWith('audio/aac')) return 'aac';
  if (normalized.startsWith('audio/flac')) return 'flac';
  if (normalized.startsWith('audio/ogg')) return 'ogg';
  if (normalized.startsWith('audio/webm') || normalized.startsWith('audio/opus')) return 'webm';
  return '';
}

function looksLikeTextPayload(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 8) {
    return false;
  }

  const limit = Math.min(bytes.length, 96);
  let probe = '';
  for (let i = 0; i < limit; i += 1) {
    const code = bytes[i];
    if (code === 0) {
      return false;
    }
    if (code >= 32 && code <= 126) {
      probe += String.fromCharCode(code);
      continue;
    }
    if (code === 9 || code === 10 || code === 13) {
      probe += ' ';
      continue;
    }
    return false;
  }

  const normalized = probe.trim().toLowerCase();
  return (
    normalized.startsWith('<!doctype html') ||
    normalized.startsWith('<html') ||
    normalized.startsWith('<?xml') ||
    normalized.startsWith('{') ||
    normalized.startsWith('[')
  );
}

function detectAudioContainer(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 4) {
    return 'unknown';
  }

  if (bytes.length >= 12) {
    const box = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]);
    if (box === 'ftyp' || box === 'styp' || box === 'sidx' || box === 'moov' || box === 'moof' || box === 'mdat') {
      return 'mp4';
    }
  }

  const head4 = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (head4 === 'RIFF' && bytes.length >= 12) {
    const wave = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
    if (wave === 'WAVE') return 'wav';
  }
  if (head4 === 'OggS') return 'ogg';
  if (head4 === 'fLaC') return 'flac';
  if (head4 === 'ID3') return 'mp3';
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'webm';
  if (bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0) return 'aac';
  if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return 'mp3';
  return 'unknown';
}

function containerToMime(container, fallback = 'audio/mp4') {
  if (container === 'mp4') return 'audio/mp4';
  if (container === 'mp3') return 'audio/mpeg';
  if (container === 'wav') return 'audio/wav';
  if (container === 'aac') return 'audio/aac';
  if (container === 'flac') return 'audio/flac';
  if (container === 'ogg') return 'audio/ogg';
  if (container === 'webm') return 'audio/webm';
  return fallback;
}

async function streamToBytes(stream, totalBytes, onProgress) {
  if (!stream || typeof stream.getReader !== 'function') {
    throw new Error('Invalid audio stream from youtubei.js');
  }

  const reader = stream.getReader();
  const chunks = [];
  let downloaded = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    if (value) {
      const chunk = toUint8Array(value);
      chunks.push(chunk);
      downloaded += chunk.length;
      if (typeof onProgress === 'function') {
        onProgress({ downloadedBytes: downloaded, totalBytes });
      }
    }
  }

  const output = new Uint8Array(downloaded);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }

  return output;
}

function pickFormat(info) {
  try {
    return info.chooseFormat({
      type: 'audio',
      quality: 'best',
      format: 'mp4',
    });
  } catch {
    return info.chooseFormat({
      type: 'audio',
      quality: 'best',
      format: 'any',
    });
  }
}

export async function downloadAudioWithYoutubeJs(options) {
  const videoId = String(options?.videoId || '').trim();
  if (!videoId) {
    throw new Error('Missing videoId for youtubei.js downloader');
  }

  const maxDurationSec = Number(options?.maxDurationSec || 180 * 60);
  const onProgress = options?.onProgress;

  const innertube = await getInnertube();
  const info = await innertube.getBasicInfo(videoId, { client: 'WEB' });
  const durationSec = safeDuration(info?.basic_info?.duration);

  if (durationSec && durationSec > maxDurationSec) {
    throw new Error(`VIDEO_TOO_LONG: ${durationSec}s exceeds ${maxDurationSec}s.`);
  }

  const format = pickFormat(info);
  const mimeType = extractContentType(format?.mime_type || 'audio/mp4');
  if (!mimeType.startsWith('audio/')) {
    throw new Error(`UNSUPPORTED_AUDIO_MIME: ${mimeType || 'unknown'}`);
  }
  const extension = guessExtension(mimeType, 'm4a');
  const totalBytes = Number(format?.content_length || 0);

  const stream = await info.download({
    itag: format?.itag,
    type: 'audio',
    quality: 'best',
    format: extension === 'm4a' ? 'mp4' : 'any',
  });

  const audioBytes = await streamToBytes(stream, Number.isFinite(totalBytes) ? totalBytes : 0, onProgress);
  let container = detectAudioContainer(audioBytes);
  if (container === 'unknown') {
    const hinted = inferContainerFromMimeType(mimeType);
    if (hinted) {
      container = hinted;
    }
  }
  if (container === 'unknown' && looksLikeTextPayload(audioBytes)) {
    throw new Error('YOUTUBEJS_RECEIVED_TEXT_PAYLOAD');
  }
  const finalMimeType = container === 'unknown' ? mimeType : containerToMime(container, mimeType);
  const finalExtension = guessExtension(finalMimeType, extension);
  const finalFileName = buildAudioFileName(
    videoId,
    info?.basic_info?.title || options?.title || `youtube-${videoId}`,
    finalExtension,
  );

  return {
    stack: 'youtubejs',
    audioBytes,
    mimeType: finalMimeType,
    extension: finalExtension,
    fileName: finalFileName,
    title: info?.basic_info?.title || options?.title || `YouTube ${videoId}`,
    durationSec: durationSec || null,
  };
}
