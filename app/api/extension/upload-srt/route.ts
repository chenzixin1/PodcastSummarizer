import { NextRequest, NextResponse, after } from 'next/server';
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
import { triggerWorkerProcessing } from '../../../../lib/workerTrigger';
import { createPodcastFromSrt, PodcastUploadError } from '../../../../lib/podcastUploadPipeline';

export const runtime = 'nodejs';
export const maxDuration = 300;

interface UploadSrtBody {
  sourceReference?: string;
  fileName?: string;
  srtContent?: string;
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
  const endpoint = '/api/extension/upload-srt';
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
    const body = (await request.json()) as UploadSrtBody;
    const sourceReference = (body?.sourceReference || '').trim() || null;
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
      title: body?.fileName ? String(body.fileName).trim() : null,
      isPublic,
    });
    monitorTaskId = monitorTask?.id || null;

    if (monitorTaskId) {
      await recordExtensionMonitorEvent({
        taskId: monitorTaskId,
        level: 'info',
        stage: 'request_received',
        endpoint,
        message: 'Path1 upload request received.',
        requestHeaders: Object.fromEntries(request.headers.entries()),
        requestBody: body,
      });
    }

    const srtContent = (body?.srtContent || '').replace(/^\uFEFF/, '').trim();
    if (!srtContent) {
      if (monitorTaskId) {
        await updateExtensionMonitorTask(monitorTaskId, {
          status: 'failed',
          stage: 'failed',
          lastErrorCode: 'INVALID_SRT',
          lastErrorMessage: 'srtContent is required.',
          lastHttpStatus: 400,
        });
        await recordExtensionMonitorEvent({
          taskId: monitorTaskId,
          level: 'error',
          stage: 'failed',
          endpoint,
          httpStatus: 400,
          message: 'Missing srtContent in request.',
          responseBody: {
            success: false,
            code: 'INVALID_SRT',
          },
        });
      }
      return NextResponse.json(
        {
          success: false,
          code: 'INVALID_SRT',
          error: 'srtContent is required.',
        },
        { status: 400 },
      );
    }

    if (monitorTaskId) {
      await updateExtensionMonitorTask(monitorTaskId, {
        status: 'accepted',
        stage: 'input_validated',
        clearError: true,
      });
      await recordExtensionMonitorEvent({
        taskId: monitorTaskId,
        level: 'info',
        stage: 'input_validated',
        endpoint,
        message: 'SRT payload validated.',
        meta: {
          srtChars: srtContent.length,
        },
      });
    }

    const id = nanoid();
    const originalFileName = sanitizeFileName(body?.fileName || `${id}.srt`);
    const titleBase = originalFileName.replace(/\.srt$/i, '') || 'Transcript';
    const title = `Transcript Analysis: ${titleBase}`;

    const srtBuffer = Buffer.from(srtContent, 'utf8');
    const fileSize = `${(srtBuffer.length / 1024).toFixed(2)} KB`;

    const result = await createPodcastFromSrt({
      id,
      title,
      originalFileName,
      srtContent: srtBuffer,
      sourceReference,
      isPublic,
      userId: user.id,
      contentType: 'application/x-subrip',
    });
    const blobUrl = result.blobUrl;

    if (monitorTaskId) {
      await updateExtensionMonitorTask(monitorTaskId, {
        stage: 'srt_blob_saved',
      });
      await recordExtensionMonitorEvent({
        taskId: monitorTaskId,
        level: 'info',
        stage: 'srt_blob_saved',
        endpoint,
        message: 'SRT blob stored.',
        meta: {
          blobUrl,
          fileSize,
          originalFileName,
        },
      });
    }

    if (monitorTaskId) {
      await updateExtensionMonitorTask(monitorTaskId, {
        stage: 'podcast_saved',
        podcastId: id,
        videoId: null,
        title,
      });
      await recordExtensionMonitorEvent({
        taskId: monitorTaskId,
        level: 'info',
        stage: 'podcast_saved',
        endpoint,
        message: 'Podcast row saved from Path1.',
        meta: {
          podcastId: id,
        },
      });
    }

    if (result.processingQueued) {
      after(async () => {
        const triggerResult = await triggerWorkerProcessing('upload', id);
        if (!triggerResult.success) {
          console.error('[EXTENSION_UPLOAD] Failed to trigger worker:', triggerResult.error);
        }
      });
    } else {
      console.error('[EXTENSION_UPLOAD] enqueueProcessingJob failed:', result.queueError);
    }

    if (monitorTaskId) {
      await updateExtensionMonitorTask(monitorTaskId, {
        status: result.processingQueued ? 'queued' : 'accepted',
        stage: result.processingQueued ? 'processing_queued' : 'response_sent',
        podcastId: id,
        clearError: true,
      });
      await recordExtensionMonitorEvent({
        taskId: monitorTaskId,
        level: result.processingQueued ? 'info' : 'warn',
        stage: result.processingQueued ? 'processing_queued' : 'response_sent',
        endpoint,
        message: result.processingQueued ? 'Processing job queued.' : 'Processing queue failed.',
        meta: {
          queueSuccess: result.processingQueued,
          queueError: result.queueError,
        },
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        podcastId: id,
        dashboardUrl: `${getAppBaseUrl(request)}/dashboard/${id}`,
        processingQueued: result.processingQueued,
        queueError: result.queueError,
        monitorTaskId,
        remainingCredits: result.remainingCredits,
      },
    });
  } catch (error) {
    const failure =
      error instanceof ExtensionAuthError
        ? {
            code: error.code,
            status: error.status,
            message: error.message,
            details: null,
          }
        : error instanceof PodcastUploadError
          ? {
              code: error.code,
              status: error.status,
              message: error.message,
              details: error.details || null,
            }
          : {
              code: 'UPLOAD_FAILED',
              status: 500,
              message: 'Failed to upload SRT from extension.',
              details: error instanceof Error ? error.message : String(error),
            };

    if (monitorTaskId) {
      await updateExtensionMonitorTask(monitorTaskId, {
        status: 'failed',
        stage: 'failed',
        lastErrorCode: failure.code,
        lastErrorMessage: failure.message,
        lastHttpStatus: failure.status,
      }).catch((monitorError) => {
        console.error('[EXT_MON] failed to update monitor task:', monitorError);
      });
      await recordExtensionMonitorEvent({
        taskId: monitorTaskId,
        level: 'error',
        stage: 'failed',
        endpoint,
        httpStatus: failure.status,
        message: failure.message,
        responseBody: {
          success: false,
          code: failure.code,
          error: failure.message,
          details: failure.details,
        },
        errorStack: error instanceof Error ? error.stack || null : null,
      }).catch((monitorError) => {
        console.error('[EXT_MON] failed to record monitor event:', monitorError);
      });
    }

    if (error instanceof ExtensionAuthError) {
      return NextResponse.json(
        {
          success: false,
          code: failure.code,
          error: failure.message,
        },
        { status: failure.status },
      );
    }

    if (error instanceof PodcastUploadError) {
      return NextResponse.json(
        {
          success: false,
          code: failure.code,
          error: failure.message,
          details: failure.details,
        },
        { status: failure.status },
      );
    }

    return NextResponse.json(
      {
        success: false,
        code: failure.code,
        error: failure.message,
        details: failure.details,
      },
      { status: failure.status },
    );
  }
}
