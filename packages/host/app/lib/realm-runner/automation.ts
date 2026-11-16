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
  // how far through the current milestone: `done` of `total`
  | { kind: 'count'; at: number; done: number; total?: number }
  // `line` is the script's own line number, when QuickJS reports one
  | {
      kind: 'console';
      at: number;
      level: ConsoleLevel;
      message: string;
      line?: number;
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
