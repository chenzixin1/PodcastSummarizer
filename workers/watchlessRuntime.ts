import { Container, getContainer } from '@cloudflare/containers';
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';

export interface WatchlessRuntimeEnv {
  WATCHLESS_CONTAINER: Parameters<typeof getContainer<WatchlessContainer>>[0];
  WORKER_SELF_REFERENCE: { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> };
  NEXTAUTH_URL?: string;
  NEXT_PUBLIC_APP_URL?: string;
  WATCHLESS_INTERNAL_SECRET: string;
  OPENROUTER_API_KEY: string;
  VOLCENGINE_APP_KEY?: string;
  VOLCENGINE_API_KEY?: string;
  VOLCANO_ACCESS_KEY?: string;
  WATCHLESS_MODEL?: string;
}

interface WatchlessWorkflowParams {
  jobId: string;
  mode: 'url' | 'publish';
}

interface RuntimeStatus {
  status: 'queued' | 'running' | 'completed' | 'failed';
  error?: string;
  errorCode?: string;
  stage?: string;
  progress?: number;
  pollUnavailable?: boolean;
}

export class WatchlessContainer extends Container<WatchlessRuntimeEnv> {
  defaultPort = 8080;
  requiredPorts = [8080];
  sleepAfter = '15m';
  enableInternet = true;
}

function appOrigin(env: WatchlessRuntimeEnv): string {
  return (env.NEXTAUTH_URL || env.NEXT_PUBLIC_APP_URL || 'https://podsum.cc').replace(/\/+$/, '');
}

async function internalFetch(env: WatchlessRuntimeEnv, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('x-watchless-internal-secret', env.WATCHLESS_INTERNAL_SECRET);
  if (!headers.has('content-type') && init.body) headers.set('content-type', 'application/json');
  return env.WORKER_SELF_REFERENCE.fetch(`${appOrigin(env)}${path}`, { ...init, headers });
}

async function failJob(
  env: WatchlessRuntimeEnv,
  jobId: string,
  error: unknown,
  runtimeStatus?: RuntimeStatus,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await internalFetch(env, `/api/watchless/jobs/internal/${encodeURIComponent(jobId)}/fail`, {
    method: 'POST',
    body: JSON.stringify({
      code: runtimeStatus?.errorCode || 'WATCHLESS_WORKFLOW_FAILED',
      message: message.slice(0, 1800),
      stage: runtimeStatus?.stage,
      progressCurrent: runtimeStatus?.progress,
    }),
  });
}

export class WatchlessWorkflow extends WorkflowEntrypoint<WatchlessRuntimeEnv, WatchlessWorkflowParams> {
  async run(event: WorkflowEvent<WatchlessWorkflowParams>, step: WorkflowStep): Promise<{ jobId: string; status: string }> {
    const { jobId, mode } = event.payload;
    let container: ReturnType<typeof getContainer<WatchlessContainer>> | null = null;
    let runtimeStatus: RuntimeStatus | undefined;
    try {
      if (mode === 'publish') {
        await step.do('publish uploaded Watchless bundle', async () => {
          const response = await internalFetch(this.env, `/api/watchless/jobs/internal/${encodeURIComponent(jobId)}/publish`, { method: 'POST' });
          if (!response.ok) throw new Error(`Publish failed (${response.status}): ${await response.text()}`);
        });
        return { jobId, status: 'completed' };
      }

      container = getContainer(this.env.WATCHLESS_CONTAINER, `watchless-${jobId}`);
      await step.do('start isolated Watchless container', { retries: { limit: 2, delay: '10 seconds', backoff: 'exponential' } }, async () => {
        await container.startAndWaitForPorts([8080], { portReadyTimeoutMS: 120_000 }, {
          envVars: {
            PODSUM_CALLBACK_BASE: appOrigin(this.env),
            WATCHLESS_INTERNAL_SECRET: this.env.WATCHLESS_INTERNAL_SECRET,
            OPENROUTER_API_KEY: this.env.OPENROUTER_API_KEY,
            VOLCENGINE_APP_KEY: this.env.VOLCENGINE_APP_KEY || '',
            VOLCENGINE_API_KEY: this.env.VOLCENGINE_API_KEY || this.env.VOLCANO_ACCESS_KEY || '',
            WATCHLESS_MODEL: this.env.WATCHLESS_MODEL || 'openai/gpt-5.6-luna',
          },
          enableInternet: true,
        });
        const response = await container.fetch('http://container/jobs', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-runtime-secret': this.env.WATCHLESS_INTERNAL_SECRET },
          body: JSON.stringify({ jobId }),
        });
        if (!response.ok) throw new Error(`Container rejected job (${response.status}): ${await response.text()}`);
      });

      let unavailablePolls = 0;
      for (let poll = 1; poll <= 240; poll += 1) {
        const status = await step.do(`poll runtime ${poll}`, async () => {
          try {
            const response = await container.fetch(`http://container/jobs/${encodeURIComponent(jobId)}`, {
              headers: { 'x-runtime-secret': this.env.WATCHLESS_INTERNAL_SECRET },
            });
            if (!response.ok) {
              return {
                status: 'running',
                error: `Container status temporarily unavailable (${response.status})`,
                errorCode: 'WATCHLESS_CONTAINER_STATUS_UNAVAILABLE',
                pollUnavailable: true,
              } satisfies RuntimeStatus;
            }
            return await response.json<RuntimeStatus>();
          } catch (error) {
            return {
              status: 'running',
              error: error instanceof Error ? error.message : String(error),
              errorCode: 'WATCHLESS_CONTAINER_STATUS_UNAVAILABLE',
              pollUnavailable: true,
            } satisfies RuntimeStatus;
          }
        });
        runtimeStatus = status;
        unavailablePolls = status.pollUnavailable ? unavailablePolls + 1 : 0;
        if (unavailablePolls >= 20) {
          throw new Error(status.error || 'Container status remained unavailable for ten minutes.');
        }
        if (status.status === 'completed') break;
        if (status.status === 'failed') throw new Error(status.error || 'Watchless container failed.');
        if (poll === 240) throw new Error('Watchless runtime timed out after two hours.');
        await step.sleep(`wait for runtime ${poll}`, '30 seconds');
      }

      await step.do('publish generated Watchless article', async () => {
        const response = await internalFetch(this.env, `/api/watchless/jobs/internal/${encodeURIComponent(jobId)}/publish`, { method: 'POST' });
        if (!response.ok) throw new Error(`Publish failed (${response.status}): ${await response.text()}`);
      });
      await step.do('stop Watchless container', async () => container?.stop()).catch(() => undefined);
      return { jobId, status: 'completed' };
    } catch (error) {
      if (container) {
        await step.do(
          'stop Watchless container after failure',
          { retries: { limit: 2, delay: '5 seconds', backoff: 'exponential' } },
          async () => container?.stop(),
        ).catch(() => undefined);
      }
      await step.do('record failure and refund reservation', async () => failJob(this.env, jobId, error, runtimeStatus));
      throw error;
    }
  }
}
