// The guest's `realm.*` and `room.*` calls leave the sandbox as `call`
// messages. The host
// does the work and answers with `callResult`; the value is JSON-encoded so it
// crosses into QuickJS as one string.
export type RealmRunnerCallMethod =
  | 'fs.readText'
  | 'fs.exists'
  | 'fs.list'
  | 'fs.replace'
  | 'fs.writeText'
  | 'fs.copy'
  | 'fs.writeBytes'
  | 'fs.download'
  | 'cards.search'
  | 'cards.get'
  | 'cards.update'
  | 'entries.search'
  | 'fs.delete'
  | 'capture'
  | 'images.generate'
  | 'workspaces.create'
  | 'workspaces.delete'
  | 'room.enableSkills'
  | 'room.disableSkills'
  | 'room.setModel'
  | 'ui.switchSubmode'
  | 'ui.openFile'
  | 'ui.previewFormat'
  | 'ui.openWorkspace'
  | 'index.invalidate'
  | 'index.reindex'
  | 'index.fullReindex'
  | 'index.cancelJob'
  | 'web.search'
  | 'web.read'
  | 'resolve'
  | 'activity'
  | 'plan'
  | 'ask';

export type RealmRunnerCallHandler = (
  method: RealmRunnerCallMethod,
  args: unknown[],
) => Promise<unknown>;

// An error the script itself threw or failed to compile with, as opposed to
// one from a realm call or the time limit. `phase` is 'compile' for a script
// QuickJS could not parse, and 'run' for one that threw while it ran.
export interface RealmScriptErrorInfo {
  name: string;
  message: string;
  line?: number;
  phase: 'compile' | 'run';
}

export interface RealmRunnerResult {
  scriptResult: string;
}

export type RealmRunnerRequest =
  | {
      type: 'run';
      code: string;
      realmURL: string;
      timeoutMs: number;
      // Absolute URL of QuickJS's WASM file. The host resolves it because the
      // worker cannot: started from a `blob:` URL, it has no base to resolve
      // a root-relative asset path against.
      wasmURL: string;
    }
  | {
      type: 'callResult';
      id: number;
      value?: string;
      error?: string;
      // the call waited this long on a person (realm.ask): the script's
      // deadline moves out by as much
      extendMs?: number;
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
  | { type: 'error'; error: string; scriptError?: RealmScriptErrorInfo };

// A user's Stop, as a stopped run's error begins: the transcript reads it as
// stopped, never as failed.
export const STOPPED_BY_USER = 'Stopped by you';
