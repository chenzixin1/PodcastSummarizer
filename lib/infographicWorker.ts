import { getAnalysisResults, getPodcast } from './db';
import {
  claimNextInfographicJob,
  completeInfographicJob,
  heartbeatInfographicJob,
  recordInfographicFailure,
  type InfographicJob,
} from './infographicJobs';
import {
  composeInfographicSvg,
  generateInfographicRaster,
  InfographicGenerationError,
} from './infographicImage';
import { buildInfographicPrompt } from './infographicPrompt';
import { deleteObject, uploadObject } from './objectStorage';

export interface ProcessInfographicJobResult {
  processed: boolean;
  podcastId: string | null;
  status: 'idle' | 'completed' | 'retry_scheduled' | 'failed';
}

const HEARTBEAT_INTERVAL_MS = 60_000;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function startHeartbeat(podcastId: string, workerId: string): () => void {
  let stopped = false;
  let inFlight = false;

  const timer = setInterval(() => {
    if (stopped || inFlight) return;
    inFlight = true;
    void heartbeatInfographicJob(podcastId, workerId)
      .then((result) => {
        if (!result.success) {
          console.warn('[infographic] lease heartbeat failed', { podcastId });
        }
      })
      .catch(() => {
        console.warn('[infographic] lease heartbeat failed', { podcastId });
      })
      .finally(() => {
        inFlight = false;
      });
  }, HEARTBEAT_INTERVAL_MS);

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

function classifyFailure(error: unknown): {
  transient: boolean;
  errorCode: string;
  message: string;
} {
  if (error instanceof InfographicGenerationError) {
    return {
      transient: error.transient,
      errorCode: error.code,
      message: error.message,
    };
  }

  const message = error instanceof Error ? error.message : String(error || 'Infographic generation failed');
  if (/write verification failed/i.test(message)) {
    return { transient: true, errorCode: 'artifact_verification_failed', message };
  }
  return { transient: true, errorCode: 'artifact_upload_failed', message };
}

async function failClaimedJob(
  job: InfographicJob,
  workerId: string,
  failure: { transient: boolean; errorCode: string; message: string },
): Promise<ProcessInfographicJobResult> {
  const recorded = await recordInfographicFailure(job.podcastId, workerId, failure);
  const retryScheduled = recorded.data?.status === 'pending'
    || (!recorded.data && failure.transient && job.attempts < 3);

  console.warn('[infographic] job failed', {
    podcastId: job.podcastId,
    errorCode: failure.errorCode,
    transient: failure.transient,
  });

  return {
    processed: true,
    podcastId: job.podcastId,
    status: retryScheduled ? 'retry_scheduled' : 'failed',
  };
}

export async function processNextInfographicJob(workerId: string): Promise<ProcessInfographicJobResult> {
  const claimed = await claimNextInfographicJob(workerId);
  if (!claimed.success) {
    console.warn('[infographic] claim failed');
    return { processed: false, podcastId: null, status: 'idle' };
  }
  if (!claimed.data) {
    return { processed: false, podcastId: null, status: 'idle' };
  }

  const job = claimed.data;
  const [podcastResult, analysisResult] = await Promise.all([
    getPodcast(job.podcastId),
    getAnalysisResults(job.podcastId),
  ]);

  if (!analysisResult.success) {
    return failClaimedJob(job, workerId, {
      transient: false,
      errorCode: 'missing_analysis',
      message: analysisResult.error || 'Analysis results not found',
    });
  }
  if (!podcastResult.success) {
    return failClaimedJob(job, workerId, {
      transient: false,
      errorCode: 'missing_analysis',
      message: podcastResult.error || 'Podcast not found',
    });
  }

  const podcast = asRecord(podcastResult.data);
  const analysis = asRecord(analysisResult.data);
  const sourceTitle = stringValue(podcast.title) || job.sourceTitle;
  const sourceUrl = stringValue(podcast.sourceReference) || job.sourceUrl;
  const summaryZh = stringValue(analysis.summaryZh) || stringValue(analysis.summary) || '';
  const prompt = buildInfographicPrompt({
    originalTitle: sourceTitle,
    summaryZh,
    titleZh: stringValue(analysis.titleZh),
    keyData: stringValue(analysis.keyData),
    actionItems: stringValue(analysis.actionItems),
  });

  let stopHeartbeat: (() => void) | null = startHeartbeat(job.podcastId, workerId);
  let artifactUrl: string | null = null;
  try {
    const raster = await generateInfographicRaster(prompt);
    stopHeartbeat();
    stopHeartbeat = null;

    const svgBytes = composeInfographicSvg({ raster, sourceTitle, sourceUrl });
    const svg = new TextDecoder().decode(svgBytes);
    const uploaded = await uploadObject(
      `infographics/${job.podcastId}/${job.promptVersion}.svg`,
      svg,
      { contentType: 'image/svg+xml' },
    );
    artifactUrl = uploaded.url;

    const completed = await completeInfographicJob(job.podcastId, workerId, {
      artifactUrl: uploaded.url,
      artifactMediaType: 'image/svg+xml',
      costUsd: raster.costUsd,
    });
    if (!completed.success) {
      await deleteObject(uploaded.url).catch(() => undefined);
      return failClaimedJob(job, workerId, {
        transient: false,
        errorCode: 'lease_lost',
        message: completed.error || 'Infographic job lease was lost before completion',
      });
    }

    return { processed: true, podcastId: job.podcastId, status: 'completed' };
  } catch (error) {
    if (artifactUrl) {
      await deleteObject(artifactUrl).catch(() => undefined);
    }
    return failClaimedJob(job, workerId, classifyFailure(error));
  } finally {
    stopHeartbeat?.();
  }
}
