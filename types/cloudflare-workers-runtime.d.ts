declare module 'cloudflare:workers' {
  export interface WorkflowEvent<T> {
    payload: T;
    instanceId: string;
    timestamp: Date;
  }

  export interface WorkflowStep {
    do<T>(name: string, callback: () => Promise<T>): Promise<T>;
    do<T>(name: string, options: Record<string, unknown>, callback: () => Promise<T>): Promise<T>;
    sleep(name: string, duration: string | number): Promise<void>;
  }

  export abstract class WorkflowEntrypoint<Env, Params> {
    protected env: Env;
    abstract run(event: WorkflowEvent<Params>, step: WorkflowStep): Promise<unknown>;
  }
}
