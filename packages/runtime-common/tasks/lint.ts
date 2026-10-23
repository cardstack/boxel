import { resolve, sep } from 'node:path';
import { Worker } from 'node:worker_threads';

import type { Task } from './index.ts';
import type { LintThreadRequest, LintThreadResponse } from './lint-thread.ts';

import { jobIdentity, MAX_LINT_SOURCE_BYTES } from '../index.ts';

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
// The loaded engines hold about 200 MB of heap, and a source at the size limit
// needs at most a few hundred MB more, so this leaves headroom for every
// source the size limit admits.
export const LINT_THREAD_HEAP_LIMIT_MB = 512;

export class LintThreadOutOfMemoryError extends Error {
  readonly heapLimitMb: number;
  constructor(heapLimitMb: number) {
    super(`the lint thread ran out of its ${heapLimitMb} MB heap limit`);
    this.heapLimitMb = heapLimitMb;
  }
}

// One long-lived thread per worker process keeps the engines' config and
// plugin loading (over a second) off every lint. When the thread dies — out of
// memory or otherwise — the requests it held are rejected and the next lint
// starts a fresh thread.
export class LintThread {
  #worker: Worker | undefined;
  #pending = new Map<
    number,
    { resolve: (result: LintResult) => void; reject: (e: Error) => void }
  >();
  #nextId = 0;
  readonly heapLimitMb: number;

  constructor(heapLimitMb = LINT_THREAD_HEAP_LIMIT_MB) {
    this.heapLimitMb = heapLimitMb;
  }

  lint(source: string, filename: string): Promise<LintResult> {
    let worker = this.#worker ?? this.#start();
    let id = this.#nextId++;
    return new Promise<LintResult>((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      // An idle thread must not hold the process open; a busy one must, or
      // a caller awaiting its result could see the process exit under it.
      worker.ref();
      worker.postMessage({ id, source, filename } satisfies LintThreadRequest);
    });
  }

  async terminate(): Promise<void> {
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
      let pending = this.#pending.get(response.id);
      this.#pending.delete(response.id);
      if (this.#pending.size === 0) {
        worker.unref();
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

    const result = await lintArgs(
      args,
      (sharedLintThread ??= new LintThread()),
    );

    log.debug(
      `${jobIdentity(jobInfo as any)} completed lint-source: ${result.messages.length} message(s), fixed=${result.fixed}`,
    );
    reportStatus(jobInfo as any, 'finish');
    return result;
  };

export async function lintArgs(
  args: LintArgs,
  thread: LintThread,
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
      `lint-source: source is ${bytes} bytes, over the ${MAX_LINT_SOURCE_BYTES}-byte lint limit, so it was not linted. Split it into smaller modules to have it linted.`,
    );
  }
  try {
    return await thread.lint(args.source, validated.filename);
  } catch (e) {
    if (e instanceof LintThreadOutOfMemoryError) {
      return notLinted(
        args.source,
        `lint-source: linting this source ran out of the ${e.heapLimitMb} MB lint memory limit, so it was not linted. Split it into smaller modules to have it linted.`,
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

function notLinted(source: string, message: string): LintResult {
  return {
    passed: true,
    output: source,
    fixed: false,
    messages: [problem(1, message)],
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
