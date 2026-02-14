import { after, NextRequest, NextResponse } from 'next/server';
import { del, put } from '@vercel/blob';
import { nanoid } from 'nanoid';
import {
  ExtensionAuthError,
  parseBearerToken,
  verifyExtensionAccessToken,
} from '../../../../../lib/extensionAuth';
import {
  getExtensionTranscriptionJobForUser,
  touchExtensionTranscriptionJob,
  updateExtensionTranscriptionJobCompleted,
  updateExtensionTranscriptionJobFailed,
} from '../../../../../lib/extensionTranscriptionJobs';
import {
  createExtensionMonitorTask,
  findMonitorTaskByTranscriptionJobId,
  recordExtensionMonitorEvent,
  updateExtensionMonitorTask,
} from '../../../../../lib/extensionMonitor';
import {
  getVolcanoConfig,
  queryVolcanoTask,
  srtFromVolcanoResult,
} from '../../../../../lib/volcanoTranscription';
import { savePodcast } from '../../../../../lib/db';
import { enqueueProcessingJob } from '../../../../../lib/processingJobs';
import { triggerWorkerProcessing } from '../../../../../lib/workerTrigger';

export const runtime = 'nodejs';

function sanitizeSrtFileName(input: string): string {
  const trimmed = input.trim();
  const safe = trimmed.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^\.+/, '');
  const base = safe || 'transcript';
  if (base.toLowerCase().endsWith('.srt')) {
    return base;
  }
  return `${base.replace(/\.[a-z0-9]{1,5}$/i, '')}.srt`;
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

export async function GET(request: NextRequest, context: { params: Promise<{ jobId: string }> }) {
  const endpoint = '/api/extension/transcribe-status/:jobId';
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
    const { jobId } = await context.params;

    if (!jobId) {
      return NextResponse.json(
        {
          success: false,
          code: 'INVALID_JOB_ID',
          error: 'Missing job id.',
        },
        { status: 400 },
      );
    }

    const jobResult = await getExtensionTranscriptionJobForUser(jobId, user.id);
    if (!jobResult.success || !jobResult.data) {
      return NextResponse.json(
        {
          success: false,
          code: 'NOT_FOUND',
          error: 'Transcription job not found.',
        },
        { status: 404 },
      );
    }

    const job = jobResult.data;
    const dashboardBase = getAppBaseUrl(request);
    const monitorTask =
      (await findMonitorTaskByTranscriptionJobId(job.id)) ||
      (await createExtensionMonitorTask({
        path: 'path2',
        status: 'transcribing',
        stage: 'provider_polling',
        userId: user.id,
        userEmail: user.email,
        sourceReference: job.sourceReference,
        videoId: job.videoId,
        title: job.title,
        isPublic: job.isPublic,
        transcriptionJobId: job.id,
        providerTaskId: job.providerTaskId,
        podcastId: job.podcastId,
      }));
    monitorTaskId = monitorTask?.id || null;

    if (monitorTaskId) {
      await recordExtensionMonitorEvent({
        taskId: monitorTaskId,
        level: 'info',
        stage: 'provider_polling',
        endpoint,
        message: 'Polling provider transcription status.',
        meta: {
          transcriptionJobId: job.id,
          providerTaskId: job.providerTaskId,
          currentJobStatus: job.status,
        },
      });
    }

    if (job.status === 'completed' && job.podcastId) {
      if (monitorTaskId) {
        await updateExtensionMonitorTask(monitorTaskId, {
          status: 'queued',
          stage: 'processing_queued',
          transcriptionJobId: job.id,
          podcastId: job.podcastId,
          providerTaskId: job.providerTaskId,
          clearError: true,
        });
      }
      return NextResponse.json({
        success: true,
        data: {
          status: 'completed',
          podcastId: job.podcastId,
          dashboardUrl: `${dashboardBase}/dashboard/${job.podcastId}`,
          lastError: null,
          monitorTaskId,
        },
      });
    }

    if (job.status === 'failed') {
      if (monitorTaskId) {
        await updateExtensionMonitorTask(monitorTaskId, {
          status: 'failed',
          stage: 'failed',
          transcriptionJobId: job.id,
          podcastId: job.podcastId,
          providerTaskId: job.providerTaskId,
          lastErrorCode: 'PATH2_TRANSCRIBE_FAILED',
          lastErrorMessage: job.error || 'Transcription failed.',
          lastHttpStatus: 200,
        });
      }
      return NextResponse.json({
        success: true,
        data: {
          status: 'failed',
          podcastId: job.podcastId,
          dashboardUrl: job.podcastId ? `${dashboardBase}/dashboard/${job.podcastId}` : null,
          lastError: job.error || 'Transcription failed.',
          monitorTaskId,
        },
      });
    }

    if (!job.providerTaskId) {
      await updateExtensionTranscriptionJobFailed(job.id, user.id, 'Missing provider task id for transcription job.');
      if (monitorTaskId) {
        await updateExtensionMonitorTask(monitorTaskId, {
          status: 'failed',
          stage: 'failed',
          transcriptionJobId: job.id,
          lastErrorCode: 'PROVIDER_TASK_ID_MISSING',
          lastErrorMessage: 'Missing provider task id for transcription job.',
          lastHttpStatus: 200,
        });
        await recordExtensionMonitorEvent({
          taskId: monitorTaskId,
          level: 'error',
          stage: 'failed',
          endpoint,
          message: 'Missing provider task id for transcription job.',
        });
      }
      return NextResponse.json({
        success: true,
        data: {
          status: 'failed',
          lastError: 'Missing provider task id for transcription job.',
          monitorTaskId,
        },
      });
    }

    const volcConfig = getVolcanoConfig('auto');
    const queryResult = await queryVolcanoTask(job.providerTaskId, volcConfig);

    if (!queryResult.done) {
      await touchExtensionTranscriptionJob(job.id, user.id);
      if (monitorTaskId) {
        await updateExtensionMonitorTask(monitorTaskId, {
          status: 'transcribing',
          stage: 'provider_polling',
          transcriptionJobId: job.id,
          providerTaskId: job.providerTaskId,
          podcastId: job.podcastId,
          clearError: true,
        });
      }
      return NextResponse.json({
        success: true,
        data: {
          status: 'transcribing',
          podcastId: job.podcastId,
          dashboardUrl: job.podcastId ? `${dashboardBase}/dashboard/${job.podcastId}` : null,
          lastError: null,
          monitorTaskId,
        },
      });
    }

    if (queryResult.fatalError) {
      await updateExtensionTranscriptionJobFailed(job.id, user.id, queryResult.fatalError);
      if (monitorTaskId) {
        await updateExtensionMonitorTask(monitorTaskId, {
          status: 'failed',
          stage: 'failed',
          transcriptionJobId: job.id,
          providerTaskId: job.providerTaskId,
          podcastId: job.podcastId,
          lastErrorCode: 'VOLCANO_QUERY_FAILED',
          lastErrorMessage: queryResult.fatalError,
          lastHttpStatus: 200,
        });
        await recordExtensionMonitorEvent({
          taskId: monitorTaskId,
          level: 'error',
          stage: 'failed',
          endpoint,
          message: queryResult.fatalError,
          meta: {
            providerTaskId: job.providerTaskId,
          },
        });
      }
      if (job.audioBlobUrl && process.env.BLOB_READ_WRITE_TOKEN) {
        after(async () => {
          try {
            await del(job.audioBlobUrl as string);
          } catch (deleteError) {
            console.error('[EXTENSION_TRANSCRIBE_STATUS] Failed to delete temporary audio blob:', deleteError);
          }
        });
      }
      return NextResponse.json({
        success: true,
        data: {
          status: 'failed',
          podcastId: job.podcastId,
          dashboardUrl: job.podcastId ? `${dashboardBase}/dashboard/${job.podcastId}` : null,
          lastError: queryResult.fatalError,
          monitorTaskId,
        },
      });
    }

    if (!queryResult.data) {
      await updateExtensionTranscriptionJobFailed(job.id, user.id, 'Volcano returned no payload.');
      if (monitorTaskId) {
        await updateExtensionMonitorTask(monitorTaskId, {
          status: 'failed',
          stage: 'failed',
          transcriptionJobId: job.id,
          providerTaskId: job.providerTaskId,
          podcastId: job.podcastId,
          lastErrorCode: 'VOLCANO_EMPTY_PAYLOAD',
          lastErrorMessage: 'Volcano returned no payload.',
          lastHttpStatus: 200,
        });
        await recordExtensionMonitorEvent({
          taskId: monitorTaskId,
          level: 'error',
          stage: 'failed',
          endpoint,
          message: 'Volcano returned no payload.',
        });
      }
      if (job.audioBlobUrl && process.env.BLOB_READ_WRITE_TOKEN) {
        after(async () => {
          try {
            await del(job.audioBlobUrl as string);
          } catch (deleteError) {
            console.error('[EXTENSION_TRANSCRIBE_STATUS] Failed to delete temporary audio blob:', deleteError);
          }
        });
      }
      return NextResponse.json({
        success: true,
        data: {
          status: 'failed',
          podcastId: job.podcastId,
          dashboardUrl: job.podcastId ? `${dashboardBase}/dashboard/${job.podcastId}` : null,
          lastError: 'Volcano returned no payload.',
          monitorTaskId,
        },
      });
    }

    const srtContent = srtFromVolcanoResult(queryResult.data);
    if (monitorTaskId) {
      await updateExtensionMonitorTask(monitorTaskId, {
        status: 'transcribing',
        stage: 'srt_generated',
        transcriptionJobId: job.id,
        providerTaskId: job.providerTaskId,
        clearError: true,
      });
      await recordExtensionMonitorEvent({
        taskId: monitorTaskId,
        level: 'info',
        stage: 'srt_generated',
        endpoint,
        message: 'SRT generated from provider payload.',
        meta: {
          srtChars: srtContent.length,
        },
      });
    }

    const srtBuffer = Buffer.from(srtContent, 'utf8');
    const podcastId = nanoid();
    const originalFileName = sanitizeSrtFileName(job.originalFileName || `${job.videoId || job.id}.srt`);
    const fileSize = `${(srtBuffer.length / 1024).toFixed(2)} KB`;
    const titleBase = (originalFileName || '').replace(/\.srt$/i, '') || job.videoId || podcastId;
    const podcastTitle = `Transcript Analysis: ${titleBase}`;

    let srtBlobUrl = '#mock-blob-url';
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      const srtBlob = await put(`extension-srt/${podcastId}-${originalFileName}`, srtBuffer, {
        access: 'public',
        contentType: 'application/x-subrip',
      });
      srtBlobUrl = srtBlob.url;
    }

    const saveResult = await savePodcast({
      id: podcastId,
      title: job.title?.trim() || podcastTitle,
      originalFileName,
      fileSize,
      blobUrl: srtBlobUrl,
      sourceReference: job.sourceReference,
      isPublic: job.isPublic,
      userId: user.id,
    });

    if (!saveResult.success) {
      throw new Error(saveResult.error || 'Failed to save podcast from Path2 transcription.');
    }

    if (monitorTaskId) {
      await updateExtensionMonitorTask(monitorTaskId, {
        stage: 'podcast_saved',
        podcastId,
      });
      await recordExtensionMonitorEvent({
        taskId: monitorTaskId,
        level: 'info',
        stage: 'podcast_saved',
        endpoint,
        message: 'Podcast row saved from Path2 transcription.',
        meta: {
          podcastId,
          srtBlobUrl,
        },
      });
    }

    const queueResult = await enqueueProcessingJob(podcastId);
    if (queueResult.success) {
      after(async () => {
        const triggerResult = await triggerWorkerProcessing('upload', podcastId);
        if (!triggerResult.success) {
          console.error('[EXTENSION_TRANSCRIBE_STATUS] Failed to trigger worker:', triggerResult.error);
        }
      });
    }

    if (monitorTaskId) {
      await updateExtensionMonitorTask(monitorTaskId, {
        status: queueResult.success ? 'queued' : 'accepted',
        stage: queueResult.success ? 'processing_queued' : 'response_sent',
        podcastId,
        transcriptionJobId: job.id,
        providerTaskId: job.providerTaskId,
        clearError: true,
      });
      await recordExtensionMonitorEvent({
        taskId: monitorTaskId,
        level: queueResult.success ? 'info' : 'warn',
        stage: queueResult.success ? 'processing_queued' : 'response_sent',
        endpoint,
        message: queueResult.success
          ? 'Path2 transcription completed and processing queued.'
          : 'Path2 transcription completed, but processing queue failed.',
        meta: {
          queueSuccess: queueResult.success,
          queueError: queueResult.error || null,
          podcastId,
        },
      });
    }

    await updateExtensionTranscriptionJobCompleted(job.id, user.id, podcastId);

    if (job.audioBlobUrl && process.env.BLOB_READ_WRITE_TOKEN) {
      after(async () => {
        try {
          await del(job.audioBlobUrl as string);
        } catch (deleteError) {
          console.error('[EXTENSION_TRANSCRIBE_STATUS] Failed to delete temporary audio blob:', deleteError);
        }
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        status: 'completed',
        podcastId,
        dashboardUrl: `${dashboardBase}/dashboard/${podcastId}`,
        lastError: null,
        monitorTaskId,
      },
    });
  } catch (error) {
    if (monitorTaskId) {
      await updateExtensionMonitorTask(monitorTaskId, {
        status: 'failed',
        stage: 'failed',
        lastErrorCode: error instanceof ExtensionAuthError ? error.code : 'TRANSCRIBE_STATUS_FAILED',
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
        code: 'TRANSCRIBE_STATUS_FAILED',
        error: 'Failed to fetch extension transcription status.',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
