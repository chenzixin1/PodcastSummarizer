import { NextRequest, NextResponse, after } from 'next/server';
import {
  ExtensionAuthError,
  parseBearerToken,
  verifyExtensionAccessToken,
} from '../../../../../lib/extensionAuth';
import {
  findMonitorTaskByPodcastId,
  recordExtensionMonitorEvent,
  updateExtensionMonitorTask,
} from '../../../../../lib/extensionMonitor';
import { getAnalysisResults, getPodcast } from '../../../../../lib/db';
import { getProcessingJob } from '../../../../../lib/processingJobs';
import { triggerWorkerProcessing } from '../../../../../lib/workerTrigger';

export const runtime = 'nodejs';

interface AnalysisData {
  summary?: string | null;
  translation?: string | null;
  highlights?: string | null;
}

interface ProcessingJobData {
  status?: string | null;
  updatedAt?: string | null;
  statusMessage?: string | null;
  lastError?: string | null;
}

function hasCompleteAnalysis(analysis: AnalysisData | null, processingStatus: string | null): boolean {
  if (!analysis) {
    return false;
  }

  const hasAllFields = Boolean(
    (analysis.summary || '').trim() &&
      (analysis.translation || '').trim() &&
      (analysis.highlights || '').trim(),
  );

  if (!hasAllFields) {
    return false;
  }

  if (!processingStatus) {
    return true;
  }

  return processingStatus === 'completed';
}

function shouldKickWorker(processingJob: ProcessingJobData | null): boolean {
  if (!processingJob || !processingJob.status) {
    return false;
  }

  const isQueued = processingJob.status === 'queued';
  const isStaleProcessing = processingJob.status === 'processing';
  if (!isQueued && !isStaleProcessing) {
    return false;
  }

  if (!processingJob.updatedAt) {
    return true;
  }

  const updatedAt = new Date(processingJob.updatedAt).getTime();
  if (!Number.isFinite(updatedAt)) {
    return true;
  }

  const staleMs = Date.now() - updatedAt;
  if (isQueued) {
    return staleMs > 8000;
  }

  return staleMs > 120000;
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

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const endpoint = '/api/extension/status/:id';
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
    const { id } = await context.params;

    if (!id) {
      return NextResponse.json(
        {
          success: false,
          code: 'INVALID_ID',
          error: 'Missing podcast id.',
        },
        { status: 400 },
      );
    }

    const podcastResult = await getPodcast(id);
    if (!podcastResult.success) {
      return NextResponse.json(
        {
          success: false,
          code: 'NOT_FOUND',
          error: 'Podcast not found.',
        },
        { status: 404 },
      );
    }

    const podcast = podcastResult.data as { userId?: string | null };
    if (!podcast.userId || podcast.userId !== user.id) {
      return NextResponse.json(
        {
          success: false,
          code: 'FORBIDDEN',
          error: 'Access denied.',
        },
        { status: 403 },
      );
    }

    const processingJobResult = await getProcessingJob(id);
    const processingJob = processingJobResult.success
      ? (processingJobResult.data as ProcessingJobData | null)
      : null;

    if (shouldKickWorker(processingJob)) {
      after(async () => {
        const triggerResult = await triggerWorkerProcessing('analysis_poll', id);
        if (!triggerResult.success) {
          console.error('[EXTENSION_STATUS] Failed to trigger worker:', triggerResult.error);
        }
      });
    }

    const analysisResult = await getAnalysisResults(id);
    const analysis = analysisResult.success ? (analysisResult.data as AnalysisData) : null;
    const status = processingJob?.status || (analysis ? 'completed' : 'queued');
    const isProcessed = hasCompleteAnalysis(analysis, processingJob?.status || null);

    const monitorTask = await findMonitorTaskByPodcastId(id);
    monitorTaskId = monitorTask?.id || null;
    if (monitorTaskId && monitorTask) {
      const mappedStatus =
        status === 'failed'
          ? 'failed'
          : status === 'completed'
            ? 'completed'
            : status === 'processing'
              ? 'processing'
              : 'queued';
      const mappedStage =
        status === 'failed'
          ? 'processing_failed'
          : status === 'completed'
            ? 'processing_completed'
            : status === 'processing'
              ? 'processing_running'
              : 'processing_queued';

      const shouldUpdate =
        monitorTask.status !== mappedStatus ||
        monitorTask.stage !== mappedStage ||
        (status === 'failed' &&
          (monitorTask.lastErrorMessage || '') !== String(processingJob?.lastError || 'Analysis failed.'));

      if (shouldUpdate) {
        await updateExtensionMonitorTask(monitorTaskId, {
          status: mappedStatus,
          stage: mappedStage,
          podcastId: id,
          lastErrorCode: status === 'failed' ? 'ANALYSIS_FAILED' : undefined,
          lastErrorMessage: status === 'failed' ? String(processingJob?.lastError || 'Analysis failed.') : undefined,
          lastHttpStatus: status === 'failed' ? 200 : undefined,
          clearError: status !== 'failed',
        });
        await recordExtensionMonitorEvent({
          taskId: monitorTaskId,
          level: status === 'failed' ? 'error' : 'info',
          stage: mappedStage,
          endpoint,
          message:
            status === 'failed'
              ? String(processingJob?.lastError || 'Analysis failed.')
              : `Analysis status is ${status}.`,
          meta: {
            podcastId: id,
            processingStatus: processingJob?.status || null,
            processingMessage: processingJob?.statusMessage || null,
            isProcessed,
          },
        });
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        podcastId: id,
        status,
        isProcessed,
        statusMessage: processingJob?.statusMessage || null,
        lastError: processingJob?.lastError || null,
        dashboardUrl: `${getAppBaseUrl(request)}/dashboard/${id}`,
        monitorTaskId,
      },
    });
  } catch (error) {
    if (monitorTaskId) {
      await updateExtensionMonitorTask(monitorTaskId, {
        status: 'failed',
        stage: 'failed',
        lastErrorCode: error instanceof ExtensionAuthError ? error.code : 'STATUS_FAILED',
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
        code: 'STATUS_FAILED',
        error: 'Failed to fetch extension task status.',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
