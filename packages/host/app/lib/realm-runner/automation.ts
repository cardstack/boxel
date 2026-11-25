import { MAX_RUN_SECONDS } from '@cardstack/runtime-common/automation-declaration';

// An automation run's time limit: its `seconds` cap, never more than
// `MAX_RUN_SECONDS` (20 minutes). It takes the place of the interactive
// surface's 100-second deadline, and bounds everything the script does,
// waiting on realm calls included.
export function automationTimeLimitMs(secondsCap: number): number {
  if (!Number.isFinite(secondsCap) || secondsCap <= 0) {
    throw new Error(
      `An automation run's seconds cap must be more than 0, not ${secondsCap}`,
    );
  }
  return Math.min(secondsCap, MAX_RUN_SECONDS) * 1000;
}

// What an automation run rejects with when it reaches its time limit, so a
// caller can tell a run out of time from a script that failed.
export class AutomationTimeLimitError extends Error {}

// What an automation run's script is stopped with when its run stops running
// under it: a person canceled the run, a pause or remove canceled it, it
// ended at a cap, or a newer attempt took it over (see `RunStateWatch`).
export class AutomationRunStoppedError extends Error {
  constructor(
    message = 'The automation run stopped running, so its script was stopped',
  ) {
    super(message);
    this.name = 'AutomationRunStoppedError';
  }
}

// Whether a request an automation run made failed because of the platform
// rather than because of what it asked: it got a server error, the server
// shed it under load (429), or it got no answer, or its body failed while it
// was read. A request aborted because the run stopped is none of these.
export function isPlatformFailure(
  result: { response: Response } | { error: unknown },
): boolean {
  if ('error' in result) {
    return !(
      result.error instanceof DOMException && result.error.name === 'AbortError'
    );
  }
  return result.response.status >= 500 || result.response.status === 429;
}

export type ConsoleLevel = 'log' | 'info' | 'warn' | 'error';

// What an automation run reports while it runs, in the order it happens.
// `at` is the time it was reported, in ms since the epoch. Every text in an
// event has been through `redactSecrets`.
export type RunProgressEvent =
  | { kind: 'activity'; at: number; line: string }
  // the milestones the script means to pass, in order
  | { kind: 'plan'; at: number; milestones: string[] }
  // the milestone the script has reached
  | { kind: 'milestone'; at: number; name: string }
  // a notable task the script did inside the current milestone, in a few
  // plain words
  | { kind: 'task'; at: number; text: string }
  // `line` is the script's own line number, when QuickJS reports one
  | {
      kind: 'console';
      at: number;
      level: ConsoleLevel;
      message: string;
      line?: number;
    }
  // what the run's realm.transform calls came to, reported once as the run
  // settles: the calls the script made, those that failed, the time their
  // programs ran, and the bytes sent in and answered
  | {
      kind: 'transform';
      at: number;
      calls: number;
      failed: number;
      ms: number;
      inBytes: number;
      outBytes: number;
    }
  // the error the run ended with: an uncaught error from the script, with
  // its script line and its stack in the script's lines, or the time limit
  | {
      kind: 'error';
      at: number;
      message: string;
      line?: number;
      stack?: string;
    };

// Where an automation run's progress goes in place of a chat. The run record
// keeps it: the console shows it live, and the run log persists it.
export interface RunProgressSink {
  record(event: RunProgressEvent): void;
}

// A sink that holds events before passing them on, such as the run log's,
// which sends them in batches. `flush` resolves once every event recorded so
// far has been passed on, or given up on.
export interface FlushableRunProgressSink extends RunProgressSink {
  flush(): Promise<void>;
}

// Redaction is shared with the realm server, which redacts a run's log lines
// again as it stores them.
export {
  REDACTED,
  redactSecrets,
} from '@cardstack/runtime-common/redact-secrets';
