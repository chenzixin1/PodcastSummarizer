import { downloadAudioWithYoutubeJs } from './path2/downloader-youtubejs.js';
import { downloadAudioWithLocalFallback } from './path2/downloader-local.js';

class OffscreenTaskError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'OffscreenTaskError';
    this.code = code;
    this.details = details;
  }
}

function normalizeMimeType(input) {
  return String(input || '')
    .trim()
    .toLowerCase()
    .split(';')[0]
    .trim();
}

function isVolcanoDirectMime(mimeType) {
  const normalized = normalizeMimeType(mimeType);
  return normalized === 'audio/mpeg' || normalized === 'audio/wav' || normalized === 'audio/x-wav' || normalized === 'audio/ogg';
}

function replaceExtension(fileName, nextExtension) {
  const safeName = String(fileName || '').trim() || 'audio';
  const safeExt = String(nextExtension || 'wav')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase() || 'wav';

  if (!safeName.includes('.')) {
    return `${safeName}.${safeExt}`;
  }
  return safeName.replace(/\.[^.]+$/, `.${safeExt}`);
}

function toArrayBuffer(bytes) {
  if (bytes instanceof Uint8Array) {
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }
  if (bytes instanceof ArrayBuffer) {
    return bytes.slice(0);
  }
  throw new OffscreenTaskError('INVALID_AUDIO_BYTES', 'Invalid audio bytes payload.');
}

function writeAscii(view, offset, value) {
  for (let i = 0; i < value.length; i += 1) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}

function downmixToMono(audioBuffer) {
  const channels = Number(audioBuffer?.numberOfChannels || 0);
  const length = Number(audioBuffer?.length || 0);
  if (channels <= 0 || length <= 0) {
    throw new OffscreenTaskError('AUDIO_DECODE_FAILED', 'Decoded audio is empty.');
  }

  if (channels === 1) {
    return new Float32Array(audioBuffer.getChannelData(0));
  }

  const mono = new Float32Array(length);
  for (let c = 0; c < channels; c += 1) {
    const data = audioBuffer.getChannelData(c);
    for (let i = 0; i < length; i += 1) {
      mono[i] += data[i] / channels;
    }
  }
  return mono;
}

function resampleLinear(input, inputRate, outputRate) {
  const source = input instanceof Float32Array ? input : new Float32Array(input || []);
  if (!source.length) {
    return new Float32Array(0);
  }

  const srcRate = Number(inputRate || 0);
  const dstRate = Number(outputRate || 0);
  if (!Number.isFinite(srcRate) || !Number.isFinite(dstRate) || srcRate <= 0 || dstRate <= 0 || srcRate === dstRate) {
    return source;
  }

  const ratio = srcRate / dstRate;
  const outputLength = Math.max(1, Math.floor(source.length / ratio));
  const output = new Float32Array(outputLength);
  const lastIndex = source.length - 1;

  for (let i = 0; i < outputLength; i += 1) {
    const position = i * ratio;
    const left = Math.floor(position);
    const right = Math.min(lastIndex, left + 1);
    const mix = position - left;
    output[i] = source[left] * (1 - mix) + source[right] * mix;
  }

  return output;
}

function encodePcm16Wav(samples, sampleRate) {
  const input = samples instanceof Float32Array ? samples : new Float32Array(samples || []);
  const safeRate = Math.max(8000, Math.floor(Number(sampleRate || 16000)));
  const dataBytes = input.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, safeRate, true);
  view.setUint32(28, safeRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  for (let i = 0; i < input.length; i += 1) {
    const value = Math.max(-1, Math.min(1, input[i]));
    const int16 = value < 0 ? Math.round(value * 0x8000) : Math.round(value * 0x7fff);
    view.setInt16(offset, int16, true);
    offset += 2;
  }

  return new Uint8Array(buffer);
}

async function decodeAudio(arrayBuffer) {
  const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (typeof Ctx !== 'function') {
    throw new OffscreenTaskError('AUDIO_CONTEXT_UNSUPPORTED', '当前浏览器不支持音频解码。');
  }

  const context = new Ctx();
  try {
    const decoded = await context.decodeAudioData(arrayBuffer);
    if (!decoded || !decoded.length) {
      throw new OffscreenTaskError('AUDIO_DECODE_FAILED', '无法解析下载音频。');
    }
    return decoded;
  } finally {
    try {
      await context.close();
    } catch {
      // Ignore close errors.
    }
  }
}

async function ensureVolcanoCompatibleAudio(downloadResult, reportProgress) {
  const currentMime = normalizeMimeType(downloadResult?.mimeType || '');
  if (isVolcanoDirectMime(currentMime)) {
    return downloadResult;
  }

  await reportProgress('transcode_start', {
    fromMime: currentMime || 'unknown',
    fromFileName: downloadResult?.fileName || null,
    targetMime: 'audio/wav',
    targetRate: 16000,
  });

  try {
    const sourceBuffer = toArrayBuffer(downloadResult?.audioBytes);
    const decoded = await decodeAudio(sourceBuffer);
    const mono = downmixToMono(decoded);
    const downsampled = resampleLinear(mono, decoded.sampleRate, 16000);
    const wavBytes = encodePcm16Wav(downsampled, 16000);

    const converted = {
      ...downloadResult,
      audioBytes: wavBytes,
      mimeType: 'audio/wav',
      extension: 'wav',
      fileName: replaceExtension(downloadResult?.fileName || 'audio', 'wav'),
    };

    await reportProgress('transcode_complete', {
      fromMime: currentMime || 'unknown',
      toMime: converted.mimeType,
      fileName: converted.fileName,
      bytes: converted.audioBytes.length,
    });

    return converted;
  } catch (error) {
    await reportProgress('transcode_failed', {
      fromMime: currentMime || 'unknown',
      error: error instanceof Error ? error.message : String(error),
    });

    if (error instanceof OffscreenTaskError) {
      throw error;
    }

    throw new OffscreenTaskError(
      'AUDIO_TRANSCODE_FAILED',
      'Path2 音频转码失败，无法转换为火山可识别格式。',
      error instanceof Error ? error.message : String(error),
    );
  }
}

function sendWorkerMessage(payload) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(payload, () => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        const message = String(runtimeError.message || '').toLowerCase();
        const isBenign =
          message.includes('message port closed before a response was received') ||
          message.includes('port closed before a response was received') ||
          message.includes('receiving end does not exist');
        if (!isBenign) {
          // Keep unexpected channel errors visible for debugging.
          console.warn('[OFFSCREEN] sendMessage runtime error:', runtimeError.message || runtimeError);
        }
      }
      resolve();
    });
  });
}

function createProgressReporter(requestId, taskId) {
  let lastProgressAt = 0;
  return async (stage, data = null) => {
    if (stage === 'download_progress') {
      const now = Date.now();
      if (now - lastProgressAt < 900) {
        return;
      }
      lastProgressAt = now;
    }

    await sendWorkerMessage({
      type: 'PODSUM_OFFSCREEN_PROGRESS',
      requestId,
      taskId,
      stage,
      data,
    });
  };
}

async function requestJson(url, init) {
  const response = await fetch(url, init);
  const rawText = await response.text();

  let data = null;
  if (rawText) {
    try {
      data = JSON.parse(rawText);
    } catch {
      data = null;
    }
  }

  if (!response.ok || !data?.success) {
    throw new OffscreenTaskError(
      data?.code || `HTTP_${response.status}`,
      data?.error || `Request failed (${response.status})`,
      data?.details || rawText || null,
    );
  }

  return data;
}

async function uploadAudioToServer(payload, downloadResult, reportProgress) {
  await reportProgress('upload_start', {
    stack: downloadResult.stack,
    fileName: downloadResult.fileName,
  });

  const blob = new Blob([downloadResult.audioBytes], {
    type: downloadResult.mimeType || 'application/octet-stream',
  });
  const file = new File([blob], downloadResult.fileName, {
    type: downloadResult.mimeType || 'application/octet-stream',
  });

  const formData = new FormData();
  formData.append('file', file);
  formData.append('sourceReference', payload.youtubeUrl || '');
  formData.append('fileName', downloadResult.fileName || file.name);
  formData.append('isPublic', payload.isPublic ? 'true' : 'false');
  formData.append('videoId', payload.videoId || '');
  formData.append('title', downloadResult.title || payload.title || '');
  formData.append('clientTaskId', payload.taskId || '');
  formData.append('traceId', payload.traceId || '');
  if (downloadResult.durationSec) {
    formData.append('durationSec', String(downloadResult.durationSec));
  }

  const result = await requestJson(`${payload.baseUrl}/api/extension/upload-audio`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${payload.accessToken}`,
    },
    body: formData,
  });

  await reportProgress('upload_complete', {
    transcriptionJobId: result.data?.transcriptionJobId,
    audioBlobUrl: result.data?.audioBlobUrl,
  });

  return result.data;
}

async function runPath2DownloadAndUpload(requestId, payload) {
  const reportProgress = createProgressReporter(requestId, payload.taskId);
  await reportProgress('download_start', { preferredStack: 'youtubejs' });

  let downloadResult = null;
  let youtubeJsError = null;

  try {
    downloadResult = await downloadAudioWithYoutubeJs({
      videoId: payload.videoId,
      title: payload.title,
      maxDurationSec: payload.maxDurationSec,
      onProgress: async (progress) => {
        await reportProgress('download_progress', {
          stack: 'youtubejs',
          ...progress,
        });
      },
    });
  } catch (error) {
    youtubeJsError = error;
  }

  if (!downloadResult) {
    await reportProgress('fallback_start', {
      from: 'youtubejs',
      reason: youtubeJsError instanceof Error ? youtubeJsError.message : String(youtubeJsError),
    });

    downloadResult = await downloadAudioWithLocalFallback({
      videoId: payload.videoId,
      title: payload.title,
      maxDurationSec: payload.maxDurationSec,
      downloadContext: payload.downloadContext,
      onProgress: async (progress) => {
        await reportProgress('download_progress', {
          stack: 'local_decsig',
          ...progress,
        });
      },
    });
  }

  downloadResult = await ensureVolcanoCompatibleAudio(downloadResult, reportProgress);

  await reportProgress('download_complete', {
    stack: downloadResult.stack,
    fileName: downloadResult.fileName,
    durationSec: downloadResult.durationSec,
    mimeType: downloadResult.mimeType,
  });

  const uploadData = await uploadAudioToServer(payload, downloadResult, reportProgress);

  return {
    stack: downloadResult.stack,
    fileName: downloadResult.fileName,
    durationSec: downloadResult.durationSec,
    transcriptionJobId: uploadData.transcriptionJobId,
    audioBlobUrl: uploadData.audioBlobUrl,
    status: uploadData.status,
  };
}

async function handleRequest(requestId, payload) {
  try {
    if (payload?.action !== 'PATH2_DOWNLOAD_AND_UPLOAD') {
      throw new OffscreenTaskError('UNSUPPORTED_ACTION', 'Unsupported offscreen action.');
    }

    const data = await runPath2DownloadAndUpload(requestId, payload);
    await sendWorkerMessage({
      type: 'PODSUM_OFFSCREEN_RESPONSE',
      requestId,
      taskId: payload?.taskId || null,
      ok: true,
      data,
    });
  } catch (error) {
    const summary = {
      code: error?.code || 'OFFSCREEN_FAILED',
      message: error instanceof Error ? error.message : String(error || 'Unknown offscreen error'),
      details: error?.details || null,
    };

    await sendWorkerMessage({
      type: 'PODSUM_OFFSCREEN_RESPONSE',
      requestId,
      taskId: payload?.taskId || null,
      ok: false,
      error: summary,
    });
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'PODSUM_OFFSCREEN_REQUEST') {
    return false;
  }

  const requestId = String(message.requestId || '');
  if (!requestId) {
    sendResponse({ accepted: false, code: 'MISSING_REQUEST_ID' });
    return false;
  }

  handleRequest(requestId, message.payload || {}).catch(() => {
    // Errors are already returned via PODSUM_OFFSCREEN_RESPONSE.
  });

  sendResponse({ accepted: true, requestId });
  return false;
});
