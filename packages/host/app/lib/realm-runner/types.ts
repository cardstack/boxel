// The guest's `realm.*`, `room.*` and `console.*` calls leave the sandbox as
// `call` messages. The host does the work and answers with `callResult`; the
// value is JSON-encoded so it crosses into QuickJS as one string. Which of
// these a script can make depends on its surface (`surfaces.ts`).
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
  | 'operations.invoke'
  | 'operations.invokeBatchOperation'
  | 'operations.capabilities'
  | 'entries.search'
  | 'fs.delete'
  | 'capture'
  | 'images.generate'
  | 'workspaces.create'
  | 'workspaces.delete'
  | 'room.enableSkills'
  | 'room.disableSkills'
  | 'room.setModel'
  | 'room.credits'
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
  | 'transform'
  | 'activity'
  | 'plan'
  | 'ask'
  | 'progress.plan'
  | 'progress.milestone'
  | 'progress.count'
  | 'console.log'
  | 'console.info'
  | 'console.warn'
  | 'console.error';

// The interactive surface serves the assistant's scripts in a chat room; the
// automation surface serves an automation's runs, with no person and no room.
// Both run on the same engine, with the same names for the methods they share.
export type RealmRunnerSurface = 'interactive' | 'automation';

// What an automation run tells its script about itself, as
// `realm.current.automation`. Times are ISO 8601 strings.
export interface AutomationRunContext {
  // The URL of the automation card.
  url: string;
  // The trigger that started the run. A run started by hand (Preview, Run
  // now) has kind `manual`; a follow-up to a batch of AI requests has kind
  // `batch`.
  trigger: {
    label?: string;
    kind: 'cron' | 'once' | 'webhook' | 'manual' | 'batch';
  };
  // When the trigger was due; for a run started by hand, when it was asked
  // for.
  scheduledAt: string;
  // When the automation's last complete run started, if it has had one.
  lastSuccessAt?: string;
  // The card's params with the trigger's own merged over them.
  params: Record<string, string>;
  // The delivery's JSON body, for a run a webhook started.
  webhookPayload?: unknown;
  // True for a Preview: the run's writes are shown and then discarded.
  dryRun: boolean;
}

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
      // The interactive surface when absent.
      surface?: RealmRunnerSurface;
      // Given only on the automation surface.
      automation?: AutomationRunContext;
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
  // A one-way call (progress, console) that waits for no answer.
  | { type: 'notify'; method: RealmRunnerCallMethod; args: unknown[] }
  | { type: 'success'; result: RealmRunnerResult }
  | { type: 'error'; error: string; scriptError?: RealmScriptErrorInfo };

// A user's Stop, as a stopped run's error begins: the transcript reads it as
// stopped, never as failed.
export const STOPPED_BY_USER = 'Stopped by you';
