import type * as JSONTypes from 'json-typescript';

import { getAutomationRun } from './automation-runs.ts';
import type { DBAdapter } from './db.ts';
import type { Prerenderer, PrerenderResponseMeta } from './index.ts';
import type { MeteredCharges } from './metered-charges.ts';

// The indexing an automation run's commit causes, carried on the jobs that do
// it so the run's identity can be charged for it once it is done (ADR 029
// §1.1, §1.5).
//
// A commit's indexing can take more than one job: a batch that writes a module
// and then instances runs an index pass for the module before the one for the
// whole write, and the write's last index pass hands its HTML renders to a
// `prerender_html` job. Each job adds what it measured to the usage it was
// handed and passes the total to the next, and the last job charges it. The
// charge is written once per run, so the run's indexing is one charge, priced
// when its last job completes.
//
// A job carrying a run's indexing never shares a pass with another writer's
// work, in either direction (see `sameRunIndexing`), so everything it
// measures was caused by that run.
export interface RunIndexing extends JSONTypes.Object {
  // The `automation_runs` id of the run whose commit is being indexed.
  runId: string;
  // Seconds a worker process spent on the jobs that have finished so far.
  workerProcessSeconds: number;
  // Seconds of prerender tab time those jobs' renders took.
  prerenderTabSeconds: number;
}

// The indexing a run's commit causes before any job has run.
export function runIndexingFor(runId: string): RunIndexing {
  return { runId, workerProcessSeconds: 0, prerenderTabSeconds: 0 };
}

// Read loosely, from job args or a job result: anything but the full shape
// reads as no run, so a job published without the field indexes as it always
// has and charges nothing.
export function parseRunIndexing(value: unknown): RunIndexing | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  let { runId, workerProcessSeconds, prerenderTabSeconds } = value as Record<
    string,
    unknown
  >;
  if (
    typeof runId !== 'string' ||
    !isUsage(workerProcessSeconds) ||
    !isUsage(prerenderTabSeconds)
  ) {
    return null;
  }
  return { runId, workerProcessSeconds, prerenderTabSeconds };
}

function isUsage(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

// Whether two publishes, given by their job args, may be done by one job: only
// when neither carries a run's indexing. A job that indexed one run's commit
// together with any other write would charge the run for the other write's
// indexing, or leave part of the run's uncharged, so a run's job neither
// joins another job nor is joined.
export function sameRunIndexing(aArgs: unknown, bArgs: unknown): boolean {
  return runIndexingOf(aArgs) === null && runIndexingOf(bArgs) === null;
}

// The run's indexing a job's args carry, or null.
function runIndexingOf(args: unknown): RunIndexing | null {
  return args && typeof args === 'object' && !Array.isArray(args)
    ? parseRunIndexing((args as Record<string, unknown>).runIndexing)
    : null;
}

// `runIndexing` with one more job's measured usage added.
export function addRunIndexingUsage(
  runIndexing: RunIndexing,
  usage: { workerProcessSeconds: number; prerenderTabSeconds: number },
): RunIndexing {
  return {
    runId: runIndexing.runId,
    workerProcessSeconds:
      runIndexing.workerProcessSeconds + usage.workerProcessSeconds,
    prerenderTabSeconds:
      runIndexing.prerenderTabSeconds + usage.prerenderTabSeconds,
  };
}

// A prerenderer that adds up the tab time of every render made through it.
//
// A render's tab time is the server's own measure of the render
// (`renderElapsedMs`), which leaves out the wait for a tab, when the tab was
// not yet the job's. A response without it falls back to the server's total
// (`totalElapsedMs`, which includes that wait), and a response without either,
// from an in-process prerenderer, to the time the call took. Each fallback is
// longer than the render, so a missing measure never charges less than the
// render took.
//
// It sees only the renders made through it. The module renders that fill the
// shared definition cache go through the worker's definition lookup, or the
// prerender server's own, on prerenderers a job doesn't own, so a job's
// measurement leaves their tab time out; the job's wall clock still counts the
// time it waited on them.
export function meteredPrerenderer(prerenderer: Prerenderer): {
  prerenderer: Prerenderer;
  tabSeconds(): number;
} {
  let tabMs = 0;
  async function meter<T extends { meta?: PrerenderResponseMeta }>(
    call: () => Promise<T>,
  ): Promise<T> {
    let start = Date.now();
    let response: T;
    try {
      response = await call();
    } catch (e) {
      tabMs += Date.now() - start;
      throw e;
    }
    let diagnostics = response?.meta?.diagnostics;
    tabMs +=
      diagnostics?.renderElapsedMs ??
      diagnostics?.totalElapsedMs ??
      Date.now() - start;
    return response;
  }
  let metered: Prerenderer = {
    prerenderModule: (args) => meter(() => prerenderer.prerenderModule(args)),
    prerenderVisit: (args) => meter(() => prerenderer.prerenderVisit(args)),
    runCommand: (args) => prerenderer.runCommand(args),
    ...(prerenderer.releaseBatch
      ? { releaseBatch: (args) => prerenderer.releaseBatch!(args) }
      : {}),
    ...(prerenderer.prerenderCapture
      ? { prerenderCapture: (args) => prerenderer.prerenderCapture!(args) }
      : {}),
  };
  return { prerenderer: metered, tabSeconds: () => tabMs / 1000 };
}

// How many times a step that hands on or charges a run's indexing is tried
// before it is given up, and how long it waits before each retry. The work
// being charged for has already happened and can't be redone for the charge,
// so a transient database error is retried here rather than by failing the
// job, which would index the commit again.
export const RUN_INDEXING_ATTEMPT_DELAYS_MS = [0, 1000, 4000];

// Runs `step` until it resolves, trying it once per entry of `delaysMs` after
// waiting that long, and rejects with the last error when every try failed.
export async function withRunIndexingRetries<T>(
  step: () => Promise<T>,
  delaysMs: readonly number[] = RUN_INDEXING_ATTEMPT_DELAYS_MS,
): Promise<T> {
  let lastError: unknown;
  for (let delay of delaysMs) {
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    try {
      return await step();
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

// Charges a run's indexing to the run's identity, as a `run_indexing` charge
// referencing the run, priced from the usage its jobs measured. Called by the
// last job the run's commit causes, once it is done. The job records the
// usage it charged on its result too (`chargedRunIndexing`), so a charge that
// could not be written can be priced again from the job.
//
// It never throws. A transient failure is retried a few times (see
// `withRunIndexingRetries`), and a charge that still can't be written is
// logged, since failing the job would index the commit again. The charge is
// written once per run (see `spendCredits`), so a retry, or a job that runs
// again after its charge was written, charges nothing more.
export async function chargeRunIndexing({
  dbAdapter,
  meteredCharges,
  runIndexing,
  log,
  attemptDelaysMs,
}: {
  dbAdapter: DBAdapter;
  meteredCharges: MeteredCharges | undefined;
  runIndexing: RunIndexing;
  log: {
    info(message: string): void;
    warn(message: string): void;
    error(message: string, ...args: unknown[]): void;
  };
  attemptDelaysMs?: readonly number[];
}): Promise<void> {
  let { runId, workerProcessSeconds, prerenderTabSeconds } = runIndexing;
  let measured = `${workerProcessSeconds.toFixed(3)} worker-process seconds and ${prerenderTabSeconds.toFixed(3)} prerender-tab seconds`;
  if (!meteredCharges) {
    log.warn(
      `not charging the indexing of run ${runId} (${measured}): this worker writes no metered charges`,
    );
    return;
  }
  try {
    await withRunIndexingRetries(async () => {
      // Deleting a realm deletes its runs, so a run can be gone by the time
      // its commit's indexing finishes. Its payer is not recorded anywhere
      // else.
      let run = await getAutomationRun(dbAdapter, runId);
      if (!run) {
        log.warn(
          `not charging the indexing of run ${runId} (${measured}): the run no longer exists`,
        );
        return;
      }
      let result = await meteredCharges.charge({
        payer: run.actsAs,
        charge: { kind: 'run_indexing', realm: run.realm, runId },
        usage: {
          worker_process_seconds: workerProcessSeconds,
          prerender_tab_seconds: prerenderTabSeconds,
        },
      });
      let message = `indexing of run ${runId} in ${run.realm} for ${run.actsAs} (${measured}): ${result}`;
      if (result === 'no-prices' || result === 'no-payer') {
        log.error(`could not charge the ${message}`);
      } else {
        log.info(`charged the ${message}`);
      }
    }, attemptDelaysMs);
  } catch (e) {
    log.error(`failed to charge the indexing of run ${runId} (${measured})`, e);
  }
}
