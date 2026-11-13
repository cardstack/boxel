import { resolve, sep } from 'node:path';
import { Worker } from 'node:worker_threads';

import type { Task } from './index.ts';
import type {
  LintThreadProgress,
  LintThreadRequest,
  LintThreadResponse,
} from './lint-thread.ts';

import {
  heartbeatJob,
  jobIdentity,
  logger,
  LINT_NOT_RUN_RULE_IDS,
  MAX_LINT_SOURCE_BYTES,
} from '../index.ts';

import { LINT_ANCHOR } from './lint-engines.ts';

export { isLintableFilename } from './lint-engines.ts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type LintMessageSource = 'eslint' | 'template-lint';

export interface LintMessage {
  ruleId: string | null;
  severity: 1 | 2; // ESLint convention: 1=warning, 2=error
  message: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  /** Which engine produced this finding. Optional for backwards compat. */
  source?: LintMessageSource;
}

export interface LintArgs {
  source: string;
  filename?: string;
}

export interface LintResult {
  output: string;
  fixed: boolean;
  messages: LintMessage[];
  /** True iff `messages` contains no error-severity entries. Optional for
   * backwards compat — callers can also compute from `messages`. */
  passed?: boolean;
}

// No coalesce handler: each lint enqueue carries its own `source` (the file
// the user is editing) and the caller awaits a result derived from THAT
// source. Two concurrent lint requests across instances are for distinct
// sources; coalescing would return one caller's lint output to a different
// caller. The work is also short and bucketed across 10 random concurrency
// groups, so duplicate-instance contention is negligible.

// ---------------------------------------------------------------------------
// Lint thread
// ---------------------------------------------------------------------------

// The engines run in a worker thread with its own heap limit, so a file that
// is expensive to lint can only fail its own lint job. Without the limit the
// engines grow inside the worker process, whose heap limit is sized for the
// whole container; several workers share that container, so one expensive
// lint exhausts the container's memory and the kernel kills whichever worker
// it picks, along with the job that worker was running.
//
// The loaded engines hold about 200 MB of heap. Every module in this repo up
// to the size limit lints within this, and a denser one that doesn't gets the
// out-of-memory warning instead of a lint. The worker-manager budgets this
// limit into each worker's share of the task's memory.
export const LINT_THREAD_HEAP_LIMIT_MB = 256;

// How long an idle thread is kept. Loading the engines takes over a second, so
// a burst of lints (an assistant writing several files) shares one thread;
// once the burst is over the thread exits, and its few hundred MB go back to
// the worker rather than sitting in every worker that has ever linted.
export const LINT_THREAD_IDLE_MS = 60_000;

// A lint that starts the thread and takes at least this long, engine loading
// included, is logged as a warning with the time each stage took.
export const SLOW_LINT_THREAD_START_MS = 10_000;

export class LintThreadOutOfMemoryError extends Error {
  readonly heapLimitMb: number;
  constructor(heapLimitMb: number) {
    super(`the lint thread ran out of its ${heapLimitMb} MB heap limit`);
    this.heapLimitMb = heapLimitMb;
  }
}

// One thread per worker process, started on the first lint and stopped once
// it has been idle for `idleMs`. When the thread dies — out of memory or
// otherwise — the requests it held are rejected and the next lint starts a
// fresh thread.
export class LintThread {
  #worker: Worker | undefined;
  #pending = new Map<
    number,
    {
      resolve: (result: LintResult) => void;
      reject: (e: Error) => void;
      onProgress?: (progress: LintThreadProgress) => void;
    }
  >();
  #nextId = 0;
  #idleTimer: ReturnType<typeof setTimeout> | undefined;
  readonly heapLimitMb: number;
  readonly idleMs: number;

  constructor(
    heapLimitMb = LINT_THREAD_HEAP_LIMIT_MB,
    idleMs = LINT_THREAD_IDLE_MS,
  ) {
    this.heapLimitMb = heapLimitMb;
    this.idleMs = idleMs;
  }

  // Whether a thread is running, for tests.
  get isRunning(): boolean {
    return this.#worker !== undefined;
  }

  // `onProgress` hears each stage of this lint as it completes, including the
  // loading of any engine the lint waits on.
  lint(
    source: string,
    filename: string,
    onProgress?: (progress: LintThreadProgress) => void,
  ): Promise<LintResult> {
    clearTimeout(this.#idleTimer);
    let worker = this.#worker ?? this.#start();
    let id = this.#nextId++;
    return new Promise<LintResult>((resolve, reject) => {
      this.#pending.set(id, { resolve, reject, onProgress });
      // An idle thread must not hold the process open; a busy one must, or
      // a caller awaiting its result could see the process exit under it.
      worker.ref();
      worker.postMessage({ id, source, filename } satisfies LintThreadRequest);
    });
  }

  async terminate(): Promise<void> {
    clearTimeout(this.#idleTimer);
    let worker = this.#worker;
    this.#worker = undefined;
    await worker?.terminate();
  }

  #start(): Worker {
    let worker = new Worker(new URL('./lint-thread.ts', import.meta.url), {
      resourceLimits: { maxOldGenerationSizeMb: this.heapLimitMb },
    });
    worker.unref();
    worker.on('message', (response: LintThreadResponse) => {
      if ('progress' in response) {
        // An engine's load has no id: it is progress for every pending lint,
        // all of which wait on the engine it loaded.
        let listeners =
          response.id === undefined
            ? [...this.#pending.values()]
            : [this.#pending.get(response.id)];
        for (let pending of listeners) {
          pending?.onProgress?.(response.progress);
        }
        return;
      }
      let pending = this.#pending.get(response.id);
      this.#pending.delete(response.id);
      if (this.#pending.size === 0) {
        worker.unref();
        this.#idleTimer = setTimeout(() => {
          if (this.#worker === worker && this.#pending.size === 0) {
            void this.terminate();
          }
        }, this.idleMs);
        this.#idleTimer.unref();
      }
      if ('error' in response) {
        pending?.reject(new Error(response.error));
      } else {
        pending?.resolve(response.result);
      }
    });
    worker.on('error', (e: Error & { code?: string }) => {
      this.#fail(
        worker,
        e.code === 'ERR_WORKER_OUT_OF_MEMORY'
          ? new LintThreadOutOfMemoryError(this.heapLimitMb)
          : e,
      );
    });
    worker.on('exit', (code) => {
      this.#fail(worker, new Error(`the lint thread exited with code ${code}`));
    });
    this.#worker = worker;
    return worker;
  }

  #fail(worker: Worker, e: Error) {
    if (this.#worker === worker) {
      this.#worker = undefined;
    }
    let pending = [...this.#pending.values()];
    this.#pending.clear();
    for (let { reject } of pending) {
      reject(e);
    }
  }
}

let sharedLintThread: LintThread | undefined;

const lintThreadLog = logger('lint-thread');

// "eslint-module 1200ms (cpu 180ms), …": the wall and thread CPU time each
// stage took, measured from the previous stage. The first stage is measured
// from `startedAt`, and its CPU time includes starting the thread.
function describeStages(
  stages: LintThreadProgress[],
  startedAt: number,
): string {
  let previous = { at: startedAt, cpuMs: 0 };
  return stages
    .map((s) => {
      let described = `${s.stage} ${s.at - previous.at}ms (cpu ${
        s.cpuMs - previous.cpuMs
      }ms)`;
      previous = s;
      return described;
    })
    .join(', ');
}

// ---------------------------------------------------------------------------
// Task
// ---------------------------------------------------------------------------

export const lintSource: Task<LintArgs, LintResult> = ({ reportStatus, log }) =>
  async function (args) {
    const { jobInfo } = args as LintArgs & { jobInfo?: unknown };
    const filename = args.filename || 'input.gts';
    log.debug(
      `${jobIdentity(jobInfo as any)} starting lint-source for ${filename}`,
    );
    reportStatus(jobInfo as any, 'start');

    let thread = (sharedLintThread ??= new LintThread());
    // A lint that starts the thread also loads the engines it uses, which is
    // most of its time. Logging those lints, and only those, shows how often a
    // save waits on an engine load and how long it takes on this host. A
    // source rejected before it reaches the thread starts nothing, and a lint
    // whose thread died is not timed.
    let startsThread = !thread.isRunning;
    let startedAt = Date.now();
    // Every completed stage is progress, so the queue's no-progress deadline
    // measures a stalled stage rather than the whole lint: loading the
    // engines can outlast the deadline on a busy host without being stuck.
    let stages: LintThreadProgress[] = [];
    const result = await lintArgs(args, thread, (progress) => {
      stages.push(progress);
      heartbeatJob(args.jobInfo?.reservationId);
    });
    if (startsThread && thread.isRunning) {
      let tookMs = Date.now() - startedAt;
      let message = `${jobIdentity(jobInfo as any)} lint-source started the lint thread: the first lint on it, of ${filename}, took ${tookMs} ms including loading the engines it used: ${describeStages(stages, startedAt)}`;
      if (tookMs >= SLOW_LINT_THREAD_START_MS) {
        lintThreadLog.warn(message);
      } else {
        log.info(message);
      }
    }

    log.debug(
      `${jobIdentity(jobInfo as any)} completed lint-source: ${result.messages.length} message(s), fixed=${result.fixed}`,
    );
    reportStatus(jobInfo as any, 'finish');
    return result;
  };

export async function lintArgs(
  args: LintArgs,
  thread: LintThread,
  onProgress?: (progress: LintThreadProgress) => void,
): Promise<LintResult> {
  const validated = validateArgs(args);
  if (!validated.ok) {
    return {
      passed: false,
      output: typeof args?.source === 'string' ? args.source : '',
      fixed: false,
      messages: [problem(2, validated.problem)],
    };
  }
  // Too expensive to lint is not a defect in the source, so the source passes
  // through unchanged with a warning rather than failing: callers that refuse
  // to save a file with lint errors still save it.
  const bytes = Buffer.byteLength(args.source, 'utf8');
  if (bytes > MAX_LINT_SOURCE_BYTES) {
    return notLinted(
      args.source,
      LINT_NOT_RUN_RULE_IDS.tooLarge,
      `lint-source: skipped linting this file because it is ${bytes} bytes, over the ${MAX_LINT_SOURCE_BYTES}-byte limit. Split it into smaller modules to lint it.`,
    );
  }
  try {
    return await thread.lint(args.source, validated.filename, onProgress);
  } catch (e) {
    if (e instanceof LintThreadOutOfMemoryError) {
      return notLinted(
        args.source,
        LINT_NOT_RUN_RULE_IDS.outOfMemory,
        `lint-source: stopped linting this file because it needed more than the ${e.heapLimitMb} MB lint memory limit. Split it into smaller modules to lint it.`,
      );
    }
    return {
      passed: false,
      output: args.source,
      fixed: false,
      messages: [
        problem(
          2,
          `lint-source: lint failed: ${e instanceof Error ? e.message : String(e)}`,
        ),
      ],
    };
  }
}

function notLinted(
  source: string,
  ruleId: string,
  message: string,
): LintResult {
  return {
    passed: true,
    output: source,
    fixed: false,
    messages: [{ ...problem(1, message), ruleId }],
  };
}

function problem(severity: 1 | 2, message: string): LintMessage {
  return { ruleId: null, severity, message, line: 1, column: 1 };
}

function validateArgs(
  args: LintArgs,
): { ok: true; filename: string } | { ok: false; problem: string } {
  if (typeof (globalThis as any).document !== 'undefined') {
    return {
      ok: false,
      problem: 'Linting is not supported in the browser environment.',
    };
  }
  if (typeof args?.source !== 'string') {
    return { ok: false, problem: 'lint-source: `source` must be a string' };
  }
  // X-Filename is user input; absolute paths and `..` traversal land here.
  const normalized = (args.filename || 'input.gts').replace(/\\/g, '/');
  const resolved = resolve(LINT_ANCHOR, normalized);
  if (!resolved.startsWith(LINT_ANCHOR + sep)) {
    return {
      ok: false,
      problem: `lint-source: invalid filename ${JSON.stringify(args.filename)}`,
    };
  }
  return { ok: true, filename: normalized };
}
