// The guest's `realm.*` calls leave the sandbox as `call` messages. The host
// does the work and answers with `callResult`; the value is JSON-encoded so it
// crosses into QuickJS as one string.
export type RealmRunnerCallMethod =
  | 'fs.readText'
  | 'fs.exists'
  | 'fs.replace'
  | 'fs.writeText';

export type RealmRunnerCallHandler = (
  method: RealmRunnerCallMethod,
  args: unknown[],
) => Promise<unknown>;

export interface RealmRunnerResult {
  scriptResult: string;
}

export type RealmRunnerRequest =
  | {
      type: 'run';
      code: string;
      realmURL: string;
      timeoutMs: number;
    }
  | {
      type: 'callResult';
      id: number;
      value?: string;
      error?: string;
    };

export type RealmRunnerResponse =
  // `ready` arrives once the worker has loaded QuickJS. It separates the cost
  // of starting the sandbox from the time the submitted script is allowed.
  | { type: 'ready' }
  | {
      type: 'call';
      id: number;
      method: RealmRunnerCallMethod;
      args: unknown[];
    }
  | { type: 'success'; result: RealmRunnerResult }
  | { type: 'error'; error: string };
