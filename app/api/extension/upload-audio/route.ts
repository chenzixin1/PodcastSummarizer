import { NextRequest, NextResponse } from 'next/server';
import { del, put } from '@vercel/blob';
import { nanoid } from 'nanoid';
import {
  ExtensionAuthError,
  parseBearerToken,
  verifyExtensionAccessToken,
} from '../../../../lib/extensionAuth';
import {
  createExtensionTranscriptionJob,
  updateExtensionTranscriptionJobFailed,
  updateExtensionTranscriptionJobTranscribing,
} from '../../../../lib/extensionTranscriptionJobs';
import {
  createExtensionMonitorTask,
  recordExtensionMonitorEvent,
  updateExtensionMonitorTask,
} from '../../../../lib/extensionMonitor';
import {
  getVolcanoConfig,
  submitVolcanoTask,
  toVolcanoAudioFormat,
} from '../../../../lib/volcanoTranscription';

export const runtime = 'nodejs';
export const maxDuration = 300;

const PATH2_MAX_DURATION_SEC = 180 * 60;
const PATH2_MAX_AUDIO_BYTES = Number.parseInt(process.env.EXTENSION_PATH2_MAX_AUDIO_BYTES || '', 10) || 250 * 1024 * 1024;

function sanitizeFileName(input: string): string {
  const trimmed = input.trim();
  const safe = trimmed.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^\.+/, '');
  if (!safe) {
    return 'audio.m4a';
  }
  return safe.slice(0, 180);
}

function parseBooleanField(value: FormDataEntryValue | null): boolean {
  const raw = String(value || '').trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'on';
}

function parseDurationSeconds(value: FormDataEntryValue | null): number | null {
  const raw = String(value || '').trim();
  if (!raw) {
    return null;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return Math.round(parsed);
}

function looksLikeAudio(fileName: string, contentType: string): boolean {
  if (contentType.toLowerCase().startsWith('audio/')) {
    return true;
  }

  const ext = fileName.toLowerCase().split('.').pop() || '';
  return ['mp3', 'm4a', 'mp4', 'aac', 'wav', 'ogg', 'flac', 'webm', 'opus'].includes(ext);
}

export async function POST(request: NextRequest) {
  const endpoint = '/api/extension/upload-audio';
  let userId = '';
  let userEmail = '';
  let transcriptionJobId = '';
  let uploadedAudioUrl: string | null = null;
  let monitorTaskId: string | null = null;

  try {
    const token = parseBearerToken(request.headers.get('authorization'));
    if (!token) {
      return NextResponse.json(
        {
          success: false,
          code: 'AUTH_REQUIRED',
          error: 'Missing Bearer token.',
        },
        { status: 401 },
      );
    }

    const user = verifyExtensionAccessToken(token);
    userId = user.id;
    userEmail = user.email;

    const formData = await request.formData();
    const clientTaskId = String(formData.get('clientTaskId') || '').trim() || null;
    const traceId = String(formData.get('traceId') || '').trim() || null;
    const title = String(formData.get('title') || '').trim() || null;
    const videoId = String(formData.get('videoId') || '').trim() || null;
    const sourceReference = String(formData.get('sourceReference') || '').trim() || null;
    const isPublic = parseBooleanField(formData.get('isPublic'));

    const monitorTask = await createExtensionMonitorTask({
      path: 'path2',
      status: 'received',
      stage: 'request_received',
      userId,
      userEmail,
      clientTaskId,
      traceId,
      sourceReference,
      videoId,
      title,
      isPublic,
    });
    monitorTaskId = monitorTask?.id || null;

    const fileEntry = formData.get('file');
    const fileNameFromInput = String(formData.get('fileName') || '').trim() || null;
    const durationSec = parseDurationSeconds(formData.get('durationSec'));

    if (monitorTaskId) {
      await recordExtensionMonitorEvent({
        taskId: monitorTaskId,
        level: 'info',
        stage: 'request_received',
        endpoint,
        message: 'Path2 upload request received.',
        requestHeaders: Object.fromEntries(request.headers.entries()),
        requestBody: {
          clientTaskId,
          traceId,
          title,
          videoId,
          sourceReference,
          isPublic,
          fileName: fileNameFromInput,
          durationSec,
          hasFile: Boolean(fileEntry),
          fileType: (fileEntry as File | null)?.type || null,
          fileSize: typeof (fileEntry as File | null)?.size === 'number' ? (fileEntry as File).size : null,
        },
      });
    }

    const failAndRespond = async (code: string, message: string, status: number, details?: string | null) => {
      if (monitorTaskId) {
        await updateExtensionMonitorTask(monitorTaskId, {
          status: 'failed',
          stage: 'failed',
          lastErrorCode: code,
          lastErrorMessage: message,
          lastHttpStatus: status,
        });
        await recordExtensionMonitorEvent({
          taskId: monitorTaskId,
          level: 'error',
          stage: 'failed',
          endpoint,
          httpStatus: status,
          message,
          responseBody: {
            success: false,
            code,
            error: message,
            details: details || null,
          },
        });
      }
      return NextResponse.json(
        {
          success: false,
          code,
          error: message,
          ...(details ? { details } : {}),
        },
        { status },
      );
    };

    if (
      !fileEntry ||
      typeof fileEntry !== 'object' ||
      !('arrayBuffer' in fileEntry) ||
      typeof fileEntry.arrayBuffer !== 'function'
    ) {
      return failAndRespond('INVALID_AUDIO_FILE', 'Missing audio file.', 400);
    }
    const file = fileEntry as File;
    if (durationSec && durationSec > PATH2_MAX_DURATION_SEC) {
      return failAndRespond(
        'VIDEO_TOO_LONG',
        `Path2 only supports videos up to ${PATH2_MAX_DURATION_SEC / 60} minutes.`,
        400,
      );
    }

    const fileName = sanitizeFileName(String(formData.get('fileName') || file.name || 'audio.m4a'));

    if (!looksLikeAudio(fileName, file.type || '')) {
      return failAndRespond('INVALID_AUDIO_TYPE', 'Only audio files are supported for Path2.', 400);
    }

    if (file.size <= 0) {
      return failAndRespond('EMPTY_AUDIO_FILE', 'Audio file is empty.', 400);
    }

    if (file.size > PATH2_MAX_AUDIO_BYTES) {
      return failAndRespond(
        'AUDIO_TOO_LARGE',
        `Audio file is too large (max ${(PATH2_MAX_AUDIO_BYTES / 1024 / 1024).toFixed(0)} MB).`,
        400,
      );
    }

    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return failAndRespond('BLOB_NOT_CONFIGURED', 'Storage is not configured on server.', 503);
    }

    if (monitorTaskId) {
      await updateExtensionMonitorTask(monitorTaskId, {
        status: 'accepted',
        stage: 'input_validated',
        title,
        videoId,
        sourceReference,
        isPublic,
        clearError: true,
      });
      await recordExtensionMonitorEvent({
        taskId: monitorTaskId,
        level: 'info',
        stage: 'input_validated',
        endpoint,
        message: 'Path2 input validated.',
        meta: {
          fileName,
          fileType: file.type || null,
          fileSize: file.size,
          durationSec,
        },
      });
    }

    transcriptionJobId = nanoid();
    const createJobResult = await createExtensionTranscriptionJob({
      id: transcriptionJobId,
      userId,
      status: 'submitted',
      sourceReference,
      originalFileName: fileName,
      title,
      videoId,
      isPublic,
    });

    if (!createJobResult.success) {
      return failAndRespond(
        'JOB_CREATE_FAILED',
        'Failed to create transcription job.',
        500,
        createJobResult.error || null,
      );
    }

    if (monitorTaskId) {
      await updateExtensionMonitorTask(monitorTaskId, {
        stage: 'job_created',
        transcriptionJobId,
      });
      await recordExtensionMonitorEvent({
        taskId: monitorTaskId,
        level: 'info',
        stage: 'job_created',
        endpoint,
        message: 'Transcription job created.',
        meta: {
          transcriptionJobId,
        },
      });
    }

    const audioStorageName = `extension-audio/${transcriptionJobId}-${fileName}`;
    const audioBlob = await put(audioStorageName, file, {
      access: 'public',
      contentType: file.type || 'application/octet-stream',
    });
    uploadedAudioUrl = audioBlob.url;

    if (monitorTaskId) {
      await updateExtensionMonitorTask(monitorTaskId, {
        stage: 'audio_blob_uploaded',
        transcriptionJobId,
      });
      await recordExtensionMonitorEvent({
        taskId: monitorTaskId,
        level: 'info',
        stage: 'audio_blob_uploaded',
        endpoint,
        message: 'Audio blob uploaded.',
        meta: {
          transcriptionJobId,
          audioBlobUrl: audioBlob.url,
          audioStorageName,
        },
      });
    }

    const volcConfig = getVolcanoConfig('auto');
    const audioFormat = toVolcanoAudioFormat(fileName, file.type || '');
    const providerTaskId = await submitVolcanoTask(audioBlob.url, audioFormat, volcConfig, 'auto');

    if (monitorTaskId) {
      await updateExtensionMonitorTask(monitorTaskId, {
        stage: 'provider_submitted',
        providerTaskId,
        transcriptionJobId,
      });
      await recordExtensionMonitorEvent({
        taskId: monitorTaskId,
        level: 'info',
        stage: 'provider_submitted',
        endpoint,
        message: 'Submitted Path2 task to transcription provider.',
        meta: {
          providerTaskId,
          transcriptionJobId,
          audioFormat,
        },
      });
    }

    const updateResult = await updateExtensionTranscriptionJobTranscribing(
      transcriptionJobId,
      userId,
      providerTaskId,
      audioBlob.url,
    );

    if (!updateResult.success) {
      return failAndRespond(
        'JOB_UPDATE_FAILED',
        'Failed to update transcription job.',
        500,
        updateResult.error || null,
      );
    }

    if (monitorTaskId) {
      await updateExtensionMonitorTask(monitorTaskId, {
        status: 'transcribing',
        stage: 'accepted',
        transcriptionJobId,
        providerTaskId,
        clearError: true,
      });
      await recordExtensionMonitorEvent({
        taskId: monitorTaskId,
        level: 'info',
        stage: 'accepted',
        endpoint,
        message: 'Path2 upload accepted and transcribing.',
        meta: {
          transcriptionJobId,
          providerTaskId,
        },
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        transcriptionJobId,
        audioBlobUrl: audioBlob.url,
        status: 'transcribing',
        monitorTaskId,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (transcriptionJobId && userId) {
      await updateExtensionTranscriptionJobFailed(transcriptionJobId, userId, message);
    }

    if (uploadedAudioUrl && process.env.BLOB_READ_WRITE_TOKEN) {
      try {
        await del(uploadedAudioUrl);
      } catch (deleteError) {
        console.error('[EXTENSION_UPLOAD_AUDIO] Failed to cleanup blob:', deleteError);
      }
    }

    if (monitorTaskId) {
      await updateExtensionMonitorTask(monitorTaskId, {
        status: 'failed',
        stage: 'failed',
        lastErrorCode: error instanceof ExtensionAuthError ? error.code : 'UPLOAD_AUDIO_FAILED',
        lastErrorMessage: message,
        lastHttpStatus: error instanceof ExtensionAuthError ? error.status : 500,
        transcriptionJobId: transcriptionJobId || undefined,
      }).catch((monitorError) => {
        console.error('[EXT_MON] failed to update monitor task:', monitorError);
      });
      await recordExtensionMonitorEvent({
        taskId: monitorTaskId,
        level: 'error',
        stage: 'failed',
        endpoint,
        httpStatus: error instanceof ExtensionAuthError ? error.status : 500,
        message,
        errorStack: error instanceof Error ? error.stack || null : null,
      }).catch((monitorError) => {
        console.error('[EXT_MON] failed to record monitor event:', monitorError);
      });
    }

    if (error instanceof ExtensionAuthError) {
      return NextResponse.json(
        {
          success: false,
          code: error.code,
          error: error.message,
        },
        { status: error.status },
      );
    }

    return NextResponse.json(
      {
        success: false,
        code: 'UPLOAD_AUDIO_FAILED',
        error: 'Failed to upload audio from extension.',
        details: message,
      },
      { status: 500 },
    );
  }
}
