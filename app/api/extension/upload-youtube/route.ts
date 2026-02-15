import { NextRequest, NextResponse, after } from 'next/server';
import { put } from '@vercel/blob';
import { nanoid } from 'nanoid';
import {
  ExtensionAuthError,
  parseBearerToken,
  verifyExtensionAccessToken,
} from '../../../../lib/extensionAuth';
import {
  createExtensionMonitorTask,
  recordExtensionMonitorEvent,
  updateExtensionMonitorTask,
} from '../../../../lib/extensionMonitor';
import { savePodcastWithCreditDeduction } from '../../../../lib/db';
import { enqueueProcessingJob } from '../../../../lib/processingJobs';
import { triggerWorkerProcessing } from '../../../../lib/workerTrigger';
import { ApifyTranscriptError, fetchYoutubeSrtViaApify } from '../../../../lib/apifyTranscript';
import { resolveYoutubePodcastTitle } from '../../../../lib/podcastTitle';

export const runtime = 'nodejs';
export const maxDuration = 300;

interface UploadYoutubeBody {
  youtubeUrl?: string;
  sourceReference?: string;
  preferredLanguage?: string;
  isPublic?: boolean;
  clientTaskId?: string;
  traceId?: string;
}

function sanitizeFileName(input: string): string {
  const trimmed = input.trim();
  const safe = trimmed.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^\.+/, '');
  if (!safe) {
    return 'transcript.srt';
  }
  if (safe.toLowerCase().endsWith('.srt')) {
    return safe;
  }
  return `${safe}.srt`;
}

function getAppBaseUrl(request: NextRequest): string {
  const envBase = (process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || '').trim();
  if (envBase) {
    return envBase.replace(/\/+$/g, '');
  }

  const origin = (request.headers.get('origin') || '').trim();
  if (origin) {
    return origin.replace(/\/+$/g, '');
  }

  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  const proto = request.headers.get('x-forwarded-proto') || 'https';
  if (host) {
    return `${proto}://${host}`;
  }

  return 'https://podsum.cc';
}

export async function POST(request: NextRequest) {
  const endpoint = '/api/extension/upload-youtube';
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
    const body = (await request.json()) as UploadYoutubeBody;

    const youtubeUrl = String(body?.youtubeUrl || '').trim();
    const sourceReference = String(body?.sourceReference || youtubeUrl || '').trim() || null;
    const preferredLanguage = String(body?.preferredLanguage || '').trim() || undefined;
    const isPublic = Boolean(body?.isPublic);
    const clientTaskId = String(body?.clientTaskId || '').trim() || null;
    const traceId = String(body?.traceId || '').trim() || null;

    const monitorTask = await createExtensionMonitorTask({
      path: 'path1',
      status: 'received',
      stage: 'request_received',
      userId: user.id,
      userEmail: user.email,
      clientTaskId,
      traceId,
      sourceReference,
      isPublic,
    });
    monitorTaskId = monitorTask?.id || null;

    if (monitorTaskId) {
      await recordExtensionMonitorEvent({
        taskId: monitorTaskId,
        level: 'info',
        stage: 'request_received',
        endpoint,
        message: 'Path1 URL upload request received.',
        requestHeaders: Object.fromEntries(request.headers.entries()),
        requestBody: {
          youtubeUrl,
          sourceReference,
          preferredLanguage: preferredLanguage || null,
          isPublic,
          clientTaskId,
          traceId,
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

    if (!youtubeUrl) {
      return failAndRespond('INVALID_YOUTUBE_URL', 'youtubeUrl is required.', 400);
    }

    if (monitorTaskId) {
      await updateExtensionMonitorTask(monitorTaskId, {
        status: 'accepted',
        stage: 'input_validated',
        sourceReference,
        isPublic,
        clearError: true,
      });
      await recordExtensionMonitorEvent({
        taskId: monitorTaskId,
        level: 'info',
        stage: 'input_validated',
        endpoint,
        message: 'Path1 URL payload validated.',
      });
    }

    let transcriptResult;
    try {
      transcriptResult = await fetchYoutubeSrtViaApify(youtubeUrl, preferredLanguage);
    } catch (error) {
      if (error instanceof ApifyTranscriptError) {
        return failAndRespond(error.code, error.message, error.status, error.details || null);
      }
      return failAndRespond(
        'TRANSCRIPT_FETCH_FAILED',
        'Failed to fetch transcript from APIFY.',
        502,
        error instanceof Error ? error.message : String(error),
      );
    }

    const id = nanoid();
    const originalFileName = sanitizeFileName(`${transcriptResult.videoId}.srt`);
    const title = resolveYoutubePodcastTitle({
      videoTitle: transcriptResult.title,
      videoId: transcriptResult.videoId,
    });
    const srtBuffer = Buffer.from(transcriptResult.srtContent, 'utf8');
    const fileSize = `${(srtBuffer.length / 1024).toFixed(2)} KB`;

    let blobUrl = '#mock-blob-url';
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      const blob = await put(`${id}-${originalFileName}`, srtBuffer, {
        access: 'public',
        contentType: 'application/x-subrip',
      });
      blobUrl = blob.url;
    }

    if (monitorTaskId) {
      await updateExtensionMonitorTask(monitorTaskId, {
        stage: 'srt_blob_saved',
        title,
        videoId: transcriptResult.videoId,
      });
      await recordExtensionMonitorEvent({
        taskId: monitorTaskId,
        level: 'info',
        stage: 'srt_blob_saved',
        endpoint,
        message: 'SRT generated from APIFY and blob stored.',
        meta: {
          blobUrl,
          originalFileName,
          fileSize,
          videoId: transcriptResult.videoId,
          source: transcriptResult.source,
          transcriptEntries: transcriptResult.entries,
        },
      });
    }

    const saveResult = await savePodcastWithCreditDeduction({
      id,
      title,
      originalFileName,
      fileSize,
      blobUrl,
      sourceReference,
      isPublic,
      userId: user.id,
    });

    if (!saveResult.success) {
      if (saveResult.errorCode === 'INSUFFICIENT_CREDITS') {
        return failAndRespond('INSUFFICIENT_CREDITS', '积分不足，无法继续转换 SRT。', 402);
      }
      return failAndRespond('SAVE_FAILED', 'Failed to save podcast.', 500, saveResult.error || null);
    }

    if (monitorTaskId) {
      await updateExtensionMonitorTask(monitorTaskId, {
        stage: 'podcast_saved',
        podcastId: id,
        videoId: transcriptResult.videoId,
        title,
      });
      await recordExtensionMonitorEvent({
        taskId: monitorTaskId,
        level: 'info',
        stage: 'podcast_saved',
        endpoint,
        message: 'Podcast row saved from APIFY transcript.',
        meta: {
          podcastId: id,
          videoId: transcriptResult.videoId,
        },
      });
    }

    const queueResult = await enqueueProcessingJob(id);
    if (queueResult.success) {
      after(async () => {
        const triggerResult = await triggerWorkerProcessing('upload', id);
        if (!triggerResult.success) {
          console.error('[EXT_UPLOAD_YOUTUBE] Failed to trigger worker:', triggerResult.error);
        }
      });
    }

    if (monitorTaskId) {
      await updateExtensionMonitorTask(monitorTaskId, {
        status: queueResult.success ? 'queued' : 'accepted',
        stage: queueResult.success ? 'processing_queued' : 'response_sent',
        podcastId: id,
        clearError: true,
      });
      await recordExtensionMonitorEvent({
        taskId: monitorTaskId,
        level: queueResult.success ? 'info' : 'warn',
        stage: queueResult.success ? 'processing_queued' : 'response_sent',
        endpoint,
        message: queueResult.success ? 'Processing job queued.' : 'Processing queue failed.',
        meta: {
          queueSuccess: queueResult.success,
          queueError: queueResult.error || null,
        },
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        podcastId: id,
        dashboardUrl: `${getAppBaseUrl(request)}/dashboard/${id}`,
        processingQueued: queueResult.success,
        monitorTaskId,
        fileName: originalFileName,
        remainingCredits: (saveResult.data as { remainingCredits?: number } | undefined)?.remainingCredits ?? null,
        youtubeIngest: {
          source: transcriptResult.source,
          videoId: transcriptResult.videoId,
          entries: transcriptResult.entries,
        },
      },
    });
  } catch (error) {
    if (monitorTaskId) {
      await updateExtensionMonitorTask(monitorTaskId, {
        status: 'failed',
        stage: 'failed',
        lastErrorCode: error instanceof ExtensionAuthError ? error.code : 'UPLOAD_YOUTUBE_FAILED',
        lastErrorMessage: error instanceof Error ? error.message : String(error),
        lastHttpStatus: error instanceof ExtensionAuthError ? error.status : 500,
      }).catch((monitorError) => {
        console.error('[EXT_MON] failed to update monitor task:', monitorError);
      });
      await recordExtensionMonitorEvent({
        taskId: monitorTaskId,
        level: 'error',
        stage: 'failed',
        endpoint,
        httpStatus: error instanceof ExtensionAuthError ? error.status : 500,
        message: error instanceof Error ? error.message : String(error),
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
        code: 'UPLOAD_YOUTUBE_FAILED',
        error: 'Failed to upload YouTube transcript from extension.',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
