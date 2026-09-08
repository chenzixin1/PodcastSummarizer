import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import type { RecoveryTick } from '../lib/watchless/analysisRecovery';

interface Env {
  WORKER_SELF_REFERENCE: {fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>};
  WATCHLESS_INTERNAL_SECRET: string;
  NEXTAUTH_URL?: string;
}

export class WatchlessAnalysisWorkflow extends WorkflowEntrypoint<Env,{runId:string}> {
  async run(event:WorkflowEvent<{runId:string}>,step:WorkflowStep) {
    const call=async(action:string,pending?:RecoveryTick['pending']):Promise<RecoveryTick>=>{
      const response=await this.env.WORKER_SELF_REFERENCE.fetch(`${this.env.NEXTAUTH_URL || 'https://podsum.cc'}/api/watchless/analysis/internal`,{
        method:'POST',headers:{'content-type':'application/json','x-watchless-internal-secret':this.env.WATCHLESS_INTERNAL_SECRET},
        body:JSON.stringify({runId:event.payload.runId,owner:event.instanceId,action,pending}),
      });
      if(!response.ok) throw new Error(`Analysis state HTTP ${response.status}`);
      return response.json() as Promise<RecoveryTick>;
    };
    for(let n=0;n<1500;n++) {
      let result:RecoveryTick;
      try {
        result=await step.do(`analysis transition ${n}`,{retries:{limit:0,delay:'1 second'},timeout:'4 minutes'},()=>call('tick'));
      } catch {
        await step.do(`record interruption ${n}`,{retries:{limit:5,delay:'10 seconds',backoff:'exponential'}},()=>call('pause'));
        return {status:'paused'};
      }
      if(result.done) return {status:result.status};
      if(result.pending) {
        const pending=result.pending;
        try {
          // This retries STORAGE only. The model step output is retained by Workflow.
          await step.do(`save model result ${n}`,{retries:{limit:100,delay:'30 seconds',backoff:'constant'},timeout:'2 minutes'},()=>call('save',pending));
        } catch {
          await step.do(`record pending result ${n}`,()=>call('pause-result'));
          return {status:'paused',pendingResultStep:n};
        }
      }
      if(result.waitMs>0) await step.sleep(`analysis backoff ${n}`,result.waitMs);
    }
    await step.do('pause bounded execution',()=>call('pause'));
    return {status:'paused'};
  }
}
