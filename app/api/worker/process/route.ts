import { NextRequest, NextResponse } from 'next/server';
import { getPodcast } from '../../../../lib/db';
import {
  claimNextProcessingJob,
  completeProcessingJob,
  failProcessingJob,
  updateProcessingJobProgress,
} from '../../../../lib/processingJobs';
import {
  getCronSecret,
  getPreferredWorkerSecretForInternalCalls,
  getWorkerSharedSecrets,
  isWorkerAuthorizedBySecret,
} from '../../../../lib/workerAuth';

interface PodcastJobPayload {
  blobUrl: string;
  originalFileName: string;
}

interface ProcessStreamEvent {
  type?: string;
  task?: string;
  message?: string;
  chunkIndex?: number;
  totalChunks?: number;
}

function getBaseUrl() {
  if (process.env.NEXTAUTH_URL) {
    return process.env.NEXTAUTH_URL;
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return 'http://localhost:3000';
}

function isAuthorized(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = getCronSecret();
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    return true;
  }
  const workerSecret = request.headers.get('x-worker-secret');
  if (isWorkerAuthorizedBySecret(workerSecret)) {
    return true;
  }
  if (!cronSecret && getWorkerSharedSecrets().length === 0 && process.env.NODE_ENV !== 'production') {
    return true;
  }
  return false;
}

function safeProgressNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function parseStreamEvent(payload: string): ProcessStreamEvent | null {
  try {
    const parsed = JSON.parse(payload) as ProcessStreamEvent;
    return parsed;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!isAuthorized(request)) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const workerId = `worker-${Date.now().toString(36)}`;
    const claimed = await claimNextProcessingJob(workerId);
    if (!claimed.success) {
      return NextResponse.json({ success: false, error: claimed.error || 'Failed to claim job' }, { status: 500 });
    }

    if (!claimed.data) {
      return NextResponse.json({ success: true, data: { message: 'No queued jobs' } });
    }

    const job = claimed.data;
    const podcastResult = await getPodcast(job.podcastId);
    if (!podcastResult.success) {
      await failProcessingJob(job.podcastId, podcastResult.error || 'Podcast not found');
      return NextResponse.json({ success: false, error: 'Podcast not found for claimed job' }, { status: 404 });
    }

    const podcast = podcastResult.data as PodcastJobPayload;
    if (!podcast?.blobUrl) {
      await failProcessingJob(job.podcastId, 'Missing blob url');
      return NextResponse.json({ success: false, error: 'Missing blob url' }, { status: 400 });
    }

    await updateProcessingJobProgress(job.podcastId, {
      currentTask: 'summary',
      progressCurrent: 0,
      progressTotal: 0,
      statusMessage: 'Worker started processing',
    });

    const processSecret =
      getPreferredWorkerSecretForInternalCalls() || (process.env.NODE_ENV !== 'production' ? 'dev-worker' : '');
    if (!processSecret) {
      await failProcessingJob(job.podcastId, 'Worker secret is not configured');
      return NextResponse.json({ success: false, error: 'Missing worker secret' }, { status: 500 });
    }

    const response = await fetch(`${getBaseUrl()}/api/process`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-process-worker-secret': processSecret,
      },
      body: JSON.stringify({
        id: job.podcastId,
        blobUrl: podcast.blobUrl,
        fileName: podcast.originalFileName,
        debug: false,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      const message = text || `Process API failed with status ${response.status}`;
      await failProcessingJob(job.podcastId, message);
      return NextResponse.json({ success: false, error: message }, { status: 500 });
    }

    const reader = response.body?.getReader();
    if (!reader) {
      await failProcessingJob(job.podcastId, 'Process API stream reader not available');
      return NextResponse.json({ success: false, error: 'No stream reader from process API' }, { status: 500 });
    }

    const decoder = new TextDecoder();
    const maxCompletedByTask: Record<'summary' | 'translation' | 'highlights', number> = {
      summary: 0,
      translation: 0,
      highlights: 0,
    };

    const monotonicCompletedCount = (task: 'summary' | 'translation' | 'highlights', candidate?: number) => {
      if (typeof candidate !== 'number' || !Number.isFinite(candidate)) {
        return maxCompletedByTask[task];
      }
      const normalized = Math.max(0, Math.floor(candidate));
      maxCompletedByTask[task] = Math.max(maxCompletedByTask[task], normalized);
      return maxCompletedByTask[task];
    };
    let buffer = '';
    let finished = false;

    while (!finished) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      let eolIndex: number;

      while ((eolIndex = buffer.indexOf('\n\n')) >= 0) {
        const rawMessage = buffer.substring(0, eolIndex);
        buffer = buffer.substring(eolIndex + 2);

        if (!rawMessage.startsWith('data: ')) {
          continue;
        }

        const jsonPayload = rawMessage.substring(6).trim();
        if (!jsonPayload) {
          continue;
        }

        const eventData = parseStreamEvent(jsonPayload);
        if (!eventData) {
          continue;
        }

        if (eventData.type === 'status') {
          await updateProcessingJobProgress(job.podcastId, {
            currentTask:
              eventData.task === 'summary' || eventData.task === 'translation' || eventData.task === 'highlights'
                ? eventData.task
                : undefined,
            statusMessage: typeof eventData.message === 'string' ? eventData.message : undefined,
          });
          continue;
        }

        if (eventData.type === 'summary_chunk_result') {
          const completedCandidate =
            safeProgressNumber(eventData.chunkIndex) !== undefined ? Number(eventData.chunkIndex) + 1 : undefined;
          const completed = monotonicCompletedCount('summary', completedCandidate);
          await updateProcessingJobProgress(job.podcastId, {
            currentTask: 'summary',
            progressCurrent: completed,
            progressTotal: safeProgressNumber(eventData.totalChunks),
            statusMessage: 'Processing summary chunks',
          });
          continue;
        }

        if (eventData.type === 'translation_chunk_result') {
          const completedCandidate =
            safeProgressNumber(eventData.chunkIndex) !== undefined ? Number(eventData.chunkIndex) + 1 : undefined;
          const completed = monotonicCompletedCount('translation', completedCandidate);
          await updateProcessingJobProgress(job.podcastId, {
            currentTask: 'translation',
            progressCurrent: completed,
            progressTotal: safeProgressNumber(eventData.totalChunks),
            statusMessage: 'Processing translation chunks',
          });
          continue;
        }

        if (eventData.type === 'highlight_chunk_result') {
          const completedCandidate =
            safeProgressNumber(eventData.chunkIndex) !== undefined ? Number(eventData.chunkIndex) + 1 : undefined;
          const completed = monotonicCompletedCount('highlights', completedCandidate);
          await updateProcessingJobProgress(job.podcastId, {
            currentTask: 'highlights',
            progressCurrent: completed,
            progressTotal: safeProgressNumber(eventData.totalChunks),
            statusMessage: 'Processing highlight chunks',
          });
          continue;
        }

        if (eventData.type === 'summary_final_result') {
          await updateProcessingJobProgress(job.podcastId, {
            statusMessage: 'Summary completed',
          });
          continue;
        }

        if (eventData.type === 'translation_final_result') {
          await updateProcessingJobProgress(job.podcastId, {
            statusMessage: 'Translation completed',
          });
          continue;
        }

        if (eventData.type === 'highlight_final_result') {
          await updateProcessingJobProgress(job.podcastId, {
            statusMessage: 'Highlights completed',
          });
          continue;
        }

        if (eventData.type === 'error') {
          const message = typeof eventData.message === 'string' ? eventData.message : 'Unknown processing error';
          await failProcessingJob(job.podcastId, message);
          return NextResponse.json({ success: false, error: message }, { status: 500 });
        }

        if (eventData.type === 'all_done') {
          finished = true;
          await completeProcessingJob(job.podcastId);
          break;
        }
      }
    }

    if (!finished) {
      await failProcessingJob(job.podcastId, 'Process stream closed before completion');
      return NextResponse.json({ success: false, error: 'Processing did not complete' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      data: {
        podcastId: job.podcastId,
        message: 'Job completed'
      }
    });
  } catch (error) {
    console.error('Worker process failed:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
