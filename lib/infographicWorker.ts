import { getAnalysisResults, getPodcast } from './db';
import {
  claimNextInfographicJob,
  completeInfographicJob,
  getInfographicJobLeaseSeconds,
  getInfographicWorkerConcurrency,
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

export interface ProcessInfographicJobOptions {
  leaseSeconds?: number;
  maxActiveWorkers?: number;
}

class InfographicLeaseLostError extends Error {
  constructor() {
    super('Infographic job lease was lost');
    this.name = 'InfographicLeaseLostError';
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function startHeartbeat(podcastId: string, workerId: string, leaseSeconds: number) {
  let stopped = false;
  let leaseLost = false;
  let inFlight: Promise<boolean> | null = null;

  const beat = (): Promise<boolean> => {
    if (stopped) {
      return Promise.resolve(false);
    }
    if (inFlight) {
      return inFlight;
    }

    inFlight = (async () => {
      try {
        const result = await heartbeatInfographicJob(podcastId, workerId, { leaseSeconds });
        if (!result.success) {
          leaseLost = true;
          console.warn('[infographic] lease heartbeat failed', { podcastId });
        }
        return result.success;
      } catch {
        leaseLost = true;
        console.warn('[infographic] lease heartbeat failed', { podcastId });
        return false;
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  };

  const intervalMs = Math.max(5_000, Math.min(HEARTBEAT_INTERVAL_MS, Math.floor(leaseSeconds * 1000 / 3)));
  const timer = setInterval(() => {
    void beat();
  }, intervalMs);

  return {
    async assertOwned(): Promise<void> {
      if (leaseLost || !(await beat())) {
        throw new InfographicLeaseLostError();
      }
    },
    hasLostLease(): boolean {
      return leaseLost;
    },
    stop(): void {
      stopped = true;
      clearInterval(timer);
    },
  };
}

function artifactKeyForAttempt(job: InfographicJob, workerId: string): string {
  const attemptId = `${job.attempts}-${workerId}`
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .slice(0, 160);
  return `infographics/${job.podcastId}/${job.promptVersion}/${attemptId}.svg`;
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

export async function processNextInfographicJob(
  workerId: string,
  options: ProcessInfographicJobOptions = {},
): Promise<ProcessInfographicJobResult> {
  const leaseSeconds = options.leaseSeconds ?? getInfographicJobLeaseSeconds();
  const maxActiveWorkers = options.maxActiveWorkers ?? getInfographicWorkerConcurrency();
  const claimed = await claimNextInfographicJob(workerId, { leaseSeconds, maxActiveWorkers });
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

  const heartbeat = startHeartbeat(job.podcastId, workerId, leaseSeconds);
  let artifactUrl: string | null = null;
  try {
    const raster = await generateInfographicRaster(prompt);
    await heartbeat.assertOwned();
    const svgBytes = composeInfographicSvg({ raster, sourceTitle, sourceUrl });
    const svg = new TextDecoder().decode(svgBytes);
    await heartbeat.assertOwned();
    const uploaded = await uploadObject(
      artifactKeyForAttempt(job, workerId),
      svg,
      { contentType: 'image/svg+xml' },
    );
    artifactUrl = uploaded.url;
    await heartbeat.assertOwned();

    const completed = await completeInfographicJob(job.podcastId, workerId, {
      artifactUrl: uploaded.url,
      artifactMediaType: 'image/svg+xml',
      costUsd: raster.costUsd,
    });
    if (!completed.success) {
      throw new InfographicLeaseLostError();
    }

    return { processed: true, podcastId: job.podcastId, status: 'completed' };
  } catch (error) {
    const leaseLost = error instanceof InfographicLeaseLostError || heartbeat.hasLostLease();
    if (leaseLost) {
      console.warn('[infographic] job lease lost', { podcastId: job.podcastId });
      return { processed: true, podcastId: job.podcastId, status: 'failed' };
    }
    if (artifactUrl) {
      try {
        await heartbeat.assertOwned();
      } catch (heartbeatError) {
        if (heartbeatError instanceof InfographicLeaseLostError) {
          console.warn('[infographic] job lease lost', { podcastId: job.podcastId });
          return { processed: true, podcastId: job.podcastId, status: 'failed' };
        }
        return failClaimedJob(job, workerId, classifyFailure(heartbeatError));
      }
      await deleteObject(artifactUrl).catch(() => undefined);
    }
    const failed = await failClaimedJob(job, workerId, classifyFailure(error));
    return failed;
  } finally {
    heartbeat.stop();
  }
}
