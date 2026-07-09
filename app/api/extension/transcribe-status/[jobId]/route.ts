import { after, NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import {
  ExtensionAuthError,
  parseBearerToken,
  verifyExtensionAccessToken,
} from '../../../../../lib/extensionAuth';
import {
  getExtensionTranscriptionJobForUser,
  reserveExtensionTranscriptionJobPodcastId,
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
import { triggerWorkerProcessing } from '../../../../../lib/workerTrigger';
import { deleteObject, getObjectText, uploadObject } from '../../../../../lib/objectStorage';
import {
  createPodcastFromSrt,
  PodcastUploadError,
  type CreatePodcastFromSrtResult,
} from '../../../../../lib/podcastUploadPipeline';
import { getPodcast, updatePodcastStoredFile } from '../../../../../lib/db';
import { enqueueProcessingJob, getProcessingJob } from '../../../../../lib/processingJobs';

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

function scheduleAudioCleanup(audioBlobUrl: string | null | undefined) {
  if (!audioBlobUrl) {
    return;
  }

  after(async () => {
    try {
      await deleteObject(audioBlobUrl);
    } catch (deleteError) {
      console.error('[EXTENSION_TRANSCRIBE_STATUS] Failed to delete temporary audio blob:', deleteError);
    }
  });
}

type ExistingPodcastRow = {
  blobUrl?: string | null;
  fileSize?: string | null;
  originalFileName?: string | null;
};

function srtFileSizeLabel(value: Buffer): string {
  return `${(value.byteLength / 1024).toFixed(2)} KB`;
}

async function ensureProcessingQueued(podcastId: string, allowEnqueue: boolean) {
  const existingJobResult = await getProcessingJob(podcastId);
  if (existingJobResult.success && existingJobResult.data) {
    return {
      processingQueued: true,
      processingJob: existingJobResult.data,
      queueError: null,
    };
  }

  if (existingJobResult.error === 'Processing job not found' && allowEnqueue) {
    const enqueueResult = await enqueueProcessingJob(podcastId);
    return {
      processingQueued: enqueueResult.success,
      processingJob: enqueueResult.success ? enqueueResult.data || null : null,
      queueError: enqueueResult.success ? null : enqueueResult.error || 'Failed to queue processing.',
    };
  }

  return {
    processingQueued: false,
    processingJob: null,
    queueError: existingJobResult.error || 'Failed to inspect processing job.',
  };
}

async function completedQueueState(
  podcastId: string,
  monitorTask: { status?: string | null; stage?: string | null } | null | undefined,
) {
  const responseSent = monitorTask?.status === 'accepted' && monitorTask?.stage === 'response_sent';
  const queueState = await ensureProcessingQueued(podcastId, !responseSent);

  return {
    processingQueued: queueState.processingQueued,
    processingJob: queueState.processingJob,
    queueError:
      responseSent && !queueState.processingQueued && queueState.queueError === 'Processing job not found'
        ? 'Processing was not queued automatically.'
        : queueState.queueError,
    remainingCredits: null as number | null,
  };
}

async function ensureExistingPodcastFile(
  podcastId: string,
  existingPodcast: ExistingPodcastRow,
  originalFileName: string,
  srtBuffer: Buffer,
  objectKey: string,
) {
  const fileSize = existingPodcast.fileSize || srtFileSizeLabel(srtBuffer);
  const storedBlobUrl = existingPodcast.blobUrl || '';

  if (storedBlobUrl) {
    try {
      await getObjectText(storedBlobUrl);
      return {
        blobUrl: storedBlobUrl,
        objectKey: '',
        originalFileName: existingPodcast.originalFileName || originalFileName,
        fileSize,
      };
    } catch (error) {
      console.error('[EXTENSION_TRANSCRIBE_STATUS] Existing Path2 podcast file is unreadable; re-uploading SRT:', error);
    }
  }

  const repairedObject = await uploadObject(objectKey, srtBuffer, {
    contentType: 'application/x-subrip',
  });
  const updateResult = await updatePodcastStoredFile(podcastId, {
    originalFileName: existingPodcast.originalFileName || originalFileName,
    fileSize,
    blobUrl: repairedObject.url,
  });
  if (!updateResult.success) {
    throw new Error(updateResult.error || 'Failed to repair existing Path2 podcast file metadata.');
  }

  return {
    blobUrl: repairedObject.url,
    objectKey: repairedObject.key,
    originalFileName: existingPodcast.originalFileName || originalFileName,
    fileSize,
  };
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
      const queueState = await completedQueueState(job.podcastId, monitorTask);
      if (monitorTaskId) {
        await updateExtensionMonitorTask(monitorTaskId, {
          status: queueState.processingQueued ? 'queued' : 'accepted',
          stage: queueState.processingQueued ? 'processing_queued' : 'response_sent',
          transcriptionJobId: job.id,
          podcastId: job.podcastId,
          providerTaskId: job.providerTaskId,
          clearError: true,
        });
      }
      if (queueState.processingQueued && queueState.processingJob?.status === 'queued') {
        after(async () => {
          const triggerResult = await triggerWorkerProcessing('upload', job.podcastId as string);
          if (!triggerResult.success) {
            console.error('[EXTENSION_TRANSCRIBE_STATUS] Failed to trigger worker:', triggerResult.error);
          }
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
          processingQueued: queueState.processingQueued,
          queueError: queueState.queueError,
          remainingCredits: queueState.remainingCredits,
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
      scheduleAudioCleanup(job.audioBlobUrl);
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
      scheduleAudioCleanup(job.audioBlobUrl);
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
    const requestedPodcastId = job.podcastId || nanoid();
    const reserveResult = await reserveExtensionTranscriptionJobPodcastId(job.id, user.id, requestedPodcastId);
    if (!reserveResult.success || !reserveResult.data?.podcastId) {
      throw new Error(reserveResult.error || 'Failed to reserve podcast id for Path2 transcription.');
    }
    const podcastId = reserveResult.data.podcastId;
    const originalFileName = sanitizeSrtFileName(job.originalFileName || `${job.videoId || job.id}.srt`);
    const titleBase = (originalFileName || '').replace(/\.srt$/i, '') || job.videoId || podcastId;
    const podcastTitle = `Transcript Analysis: ${titleBase}`;
    const objectKey = `extension-srt/${podcastId}-${originalFileName}`;
    let result: CreatePodcastFromSrtResult;
    const existingPodcastResult = await getPodcast(podcastId);

    if (existingPodcastResult.success && existingPodcastResult.data) {
      const existingPodcast = existingPodcastResult.data as ExistingPodcastRow;
      const existingFile = await ensureExistingPodcastFile(
        podcastId,
        existingPodcast,
        originalFileName,
        srtBuffer,
        objectKey,
      );
      const queueState = await ensureProcessingQueued(podcastId, true);
      result = {
        id: podcastId,
        blobUrl: existingFile.blobUrl,
        objectKey: existingFile.objectKey,
        originalFileName: existingFile.originalFileName,
        fileSize: existingFile.fileSize,
        remainingCredits: null,
        processingQueued: queueState.processingQueued,
        processingJob: queueState.processingJob,
        queueError: queueState.queueError,
      };
    } else {
      if (!existingPodcastResult.success && existingPodcastResult.error !== 'Podcast not found') {
        throw new Error(existingPodcastResult.error || 'Failed to check existing Path2 podcast.');
      }

      try {
        result = await createPodcastFromSrt({
          id: podcastId,
          title: job.title?.trim() || podcastTitle,
          originalFileName,
          srtContent: srtBuffer,
          objectKey,
          sourceReference: job.sourceReference || null,
          isPublic: Boolean(job.isPublic),
          userId: job.userId,
          contentType: 'application/x-subrip',
        });
      } catch (error) {
        if (error instanceof PodcastUploadError && error.code === 'PODCAST_ALREADY_EXISTS') {
          const recoveredPodcastResult = await getPodcast(podcastId);
          if (!recoveredPodcastResult.success || !recoveredPodcastResult.data) {
            throw error;
          }
          const existingFile = await ensureExistingPodcastFile(
            podcastId,
            recoveredPodcastResult.data as ExistingPodcastRow,
            originalFileName,
            srtBuffer,
            objectKey,
          );
          const queueState = await ensureProcessingQueued(podcastId, true);
          result = {
            id: podcastId,
            blobUrl: existingFile.blobUrl,
            objectKey: existingFile.objectKey,
            originalFileName: existingFile.originalFileName,
            fileSize: existingFile.fileSize,
            remainingCredits: null,
            processingQueued: queueState.processingQueued,
            processingJob: queueState.processingJob,
            queueError: queueState.queueError,
          };
        } else if (error instanceof PodcastUploadError) {
          await updateExtensionTranscriptionJobFailed(
            job.id,
            user.id,
            error.message || 'Failed to save podcast from Path2 transcription.',
          );
          scheduleAudioCleanup(job.audioBlobUrl);
          throw error;
        } else {
          throw error;
        }
      }
    }

    const blobUrl = result.blobUrl;
    const remainingCredits = result.remainingCredits;

    const completionResult = await updateExtensionTranscriptionJobCompleted(job.id, user.id, podcastId);
    if (!completionResult.success) {
      throw new Error(completionResult.error || 'Failed to mark Path2 transcription job completed.');
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
          blobUrl,
          remainingCredits,
        },
      });
    }

    const shouldTriggerWorker = result.processingQueued && result.processingJob?.status === 'queued';
    if (shouldTriggerWorker) {
      after(async () => {
        const triggerResult = await triggerWorkerProcessing('upload', podcastId);
        if (!triggerResult.success) {
          console.error('[EXTENSION_TRANSCRIBE_STATUS] Failed to trigger worker:', triggerResult.error);
        }
      });
    } else if (!result.processingQueued) {
      console.error(
        '[EXTENSION_TRANSCRIBE_STATUS] Processing queue failed after Path2 transcription completion:',
        result.queueError,
      );
    }

    if (monitorTaskId) {
      await updateExtensionMonitorTask(monitorTaskId, {
        status: result.processingQueued ? 'queued' : 'accepted',
        stage: result.processingQueued ? 'processing_queued' : 'response_sent',
        podcastId,
        transcriptionJobId: job.id,
        providerTaskId: job.providerTaskId,
        clearError: true,
      });
      await recordExtensionMonitorEvent({
        taskId: monitorTaskId,
        level: result.processingQueued ? 'info' : 'warn',
        stage: result.processingQueued ? 'processing_queued' : 'response_sent',
        endpoint,
        message: result.processingQueued
          ? 'Path2 transcription completed and processing queued.'
          : 'Path2 transcription completed, but processing queue failed.',
        meta: {
          queueSuccess: result.processingQueued,
          queueError: result.queueError,
          podcastId,
          remainingCredits,
        },
      });
    }

    scheduleAudioCleanup(job.audioBlobUrl);

    return NextResponse.json({
      success: true,
      data: {
        status: 'completed',
        podcastId,
        dashboardUrl: `${dashboardBase}/dashboard/${podcastId}`,
        lastError: null,
        monitorTaskId,
        processingQueued: result.processingQueued,
        queueError: result.queueError,
        remainingCredits: result.remainingCredits,
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
