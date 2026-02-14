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

function sendWorkerMessage(payload) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(payload, () => {
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

  await reportProgress('download_complete', {
    stack: downloadResult.stack,
    fileName: downloadResult.fileName,
    durationSec: downloadResult.durationSec,
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
