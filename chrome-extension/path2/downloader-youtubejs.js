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
  const extension = guessExtension(mimeType, 'm4a');
  const fileName = buildAudioFileName(
    videoId,
    info?.basic_info?.title || options?.title || `youtube-${videoId}`,
    extension,
  );
  const totalBytes = Number(format?.content_length || 0);

  const stream = await info.download({
    itag: format?.itag,
    type: 'audio',
    quality: 'best',
    format: extension === 'm4a' ? 'mp4' : 'any',
  });

  const audioBytes = await streamToBytes(stream, Number.isFinite(totalBytes) ? totalBytes : 0, onProgress);

  return {
    stack: 'youtubejs',
    audioBytes,
    mimeType,
    extension,
    fileName,
    title: info?.basic_info?.title || options?.title || `YouTube ${videoId}`,
    durationSec: durationSec || null,
  };
}
