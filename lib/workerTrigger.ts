import { getCronSecret, getPreferredWorkerSecretForInternalCalls } from './workerAuth';

function getBaseUrl(): string {
  if (process.env.NEXTAUTH_URL) {
    return process.env.NEXTAUTH_URL;
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return 'http://localhost:3000';
}

interface TriggerWorkerResult {
  success: boolean;
  status?: number;
  error?: string;
}

export async function triggerWorkerProcessing(
  source: 'upload' | 'manual_enqueue' | 'analysis_poll',
  podcastId: string
): Promise<TriggerWorkerResult> {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const cronSecret = getCronSecret();
    if (cronSecret) {
      headers.Authorization = `Bearer ${cronSecret}`;
    }
    const workerSecret = getPreferredWorkerSecretForInternalCalls();
    if (workerSecret) {
      headers['x-worker-secret'] = workerSecret;
    }

    const response = await fetch(`${getBaseUrl()}/api/worker/process`, {
      method: 'POST',
      headers,
      cache: 'no-store',
      body: JSON.stringify({
        source,
        podcastId,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        status: response.status,
        error: errorText || `Worker trigger failed with status ${response.status}`,
      };
    }

    return {
      success: true,
      status: response.status,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
