import { getCloudflareContext } from '@opennextjs/cloudflare';
import { updateWatchlessJobWorkflow } from './jobs';

export type WatchlessWorkflowMode = 'url' | 'publish';

type WorkflowInstance = { id: string; terminate?: () => Promise<void> };
type WorkflowBinding = {
  create: (options: { id?: string; params: { jobId: string; mode: WatchlessWorkflowMode } }) => Promise<WorkflowInstance>;
  get: (id: string) => Promise<WorkflowInstance>;
};

type WatchlessWorkflowEnv = {
  WATCHLESS_WORKFLOW?: WorkflowBinding;
  WATCHLESS_CONTAINER?: { getByName(name: string): { stop(): Promise<void> } };
};

export async function startWatchlessWorkflow(
  jobId: string,
  mode: WatchlessWorkflowMode,
  options: { uniqueAttempt?: boolean } = {},
): Promise<string> {
  let env: WatchlessWorkflowEnv;
  try {
    const context = await getCloudflareContext({ async: true });
    env = context.env as unknown as WatchlessWorkflowEnv;
  } catch {
    throw new Error('Watchless Workflow is only available in the Cloudflare runtime.');
  }

  if (!env.WATCHLESS_WORKFLOW) {
    throw new Error('WATCHLESS_WORKFLOW binding is not configured.');
  }

  const attemptSuffix = options.uniqueAttempt ? `-${crypto.randomUUID()}` : '';
  const instanceId = `watchless-${jobId}${attemptSuffix}`;
  const instance = await env.WATCHLESS_WORKFLOW.create({
    id: instanceId,
    params: { jobId, mode },
  });
  await updateWatchlessJobWorkflow(jobId, instance.id || instanceId);
  return instance.id || instanceId;
}

export async function terminateWatchlessWorkflow(instanceId: string): Promise<void> {
  const context = await getCloudflareContext({ async: true });
  const binding = (context.env as unknown as WatchlessWorkflowEnv).WATCHLESS_WORKFLOW;
  if (!binding) throw new Error('WATCHLESS_WORKFLOW binding is not configured.');
  const jobId = /^watchless-(wl_[A-Za-z0-9_-]{18})/.exec(instanceId)?.[1];
  const containers = (context.env as unknown as WatchlessWorkflowEnv).WATCHLESS_CONTAINER;
  const results = await Promise.allSettled([
    (async () => {
      const instance = await binding.get(instanceId);
      if (typeof instance.terminate !== 'function') throw new Error('Workflow termination is unavailable.');
      await instance.terminate();
    })(),
    jobId && containers ? containers.getByName(`watchless-${jobId}`).stop() : Promise.resolve(),
  ]);
  const failure = results.find(result => result.status === 'rejected');
  if (failure?.status === 'rejected') throw failure.reason;
}
