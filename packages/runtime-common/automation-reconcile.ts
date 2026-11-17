// Reconcile: make up a run that an outage cost (ADR 028 §1.5).
//
// The worker manager enqueues an `automation-reconcile` job when it starts
// and every few minutes after. Each pass makes up two kinds of missed work,
// at most one run per trigger:
//
// - **A run whose job is gone.** A run is pending or running with no
//   unfinished `run-command` job carrying its `dedupeKey`, and it was made at
//   least `graceSeconds` ago (the grace covers the moment between writing a
//   run's row and publishing its job). Its job ran out of reservations, or
//   finished without ending the run, or was never published. Reconcile
//   enqueues the same run again, once: the new job's attempt takes the run
//   over (`startAutomationRunAttempt`), so a run whose commit never started
//   runs its script again, one whose commit landed finishes complete, and one
//   whose commit was claimed and never recorded ends as `commit-interrupted`.
//   The run keeps its slot, so the make-up's slot is the missed instant and
//   its trigger's count and cursor don't change. `reconciled_at` records the
//   new job. A run still left with no live job after that, or one reconcile
//   can't enqueue again, is ended with `abandonAutomationRun` (reason
//   `job-lost`) and charged for what it used.
// - **A due time that passed with nothing enqueued.** An automation whose
//   next run is `graceSeconds` or more behind is one the minute tick missed
//   (the tick was down, or its worker manager just started). Reconcile hands
//   those rows to the tick's own procedure (`tickAutomations` with
//   `overdueBy`), which collapses every slot that passed into one make-up run
//   at the latest of them. The tick and reconcile claim rows with
//   `FOR UPDATE SKIP LOCKED` and key each run by its automation, trigger and
//   slot, so they can't both start one.
//
// Lost runs are handled first, so a due slot finds a pending run that will
// run (and joins it) or none (and starts its own), never one that is stuck.
//
// An outage costs at most one late run per trigger, and because the realm is
// the state, that run catches up on everything since.
//
// Other kinds of missed work, such as a batch's follow-up whose deadline
// passed with nothing enqueued, register a step with
// `registerAutomationReconcileStep`; each pass runs every registered step
// after its own.

import { MANUAL_RUN_TRIGGER } from './automation-declaration.ts';
import { chargeAutomationRun } from './automation-run-charge.ts';
import { logRunPlatformLine } from './automation-run-log.ts';
import {
  abandonAutomationRun,
  getAutomationRun,
  type AutomationRun,
} from './automation-runs.ts';
import {
  tickAutomations,
  type AutomationDeclarationRead,
  type AutomationTickOutcome,
} from './automation-tick.ts';
import type { DBAdapter } from './db.ts';
import { param, query } from './expression.ts';
import { enqueueAutomationRunJob } from './jobs/run-command.ts';
import type { MeteredCharges } from './metered-charges.ts';
import { ensureTrailingSlash } from './paths.ts';
import type { QueuePublisher } from './queue.ts';
import type { RealmResourceIdentifier } from './realm-identifiers.ts';
import type { VirtualNetwork } from './virtual-network.ts';

// How long a run's row may wait for its job, and how far behind the tick an
// automation's next run must be, before reconcile treats it as missed. Two
// minutes is two ticks: long enough that a tick in progress, or the moment
// between writing a run's row and publishing its job, is never mistaken for
// an outage.
export const AUTOMATION_RECONCILE_GRACE_SECONDS = 2 * 60;

// How many lost runs a pass reads per page. A pass reads pages until none is
// left, so this bounds a query, not a pass.
export const AUTOMATION_RECONCILE_PAGE_SIZE = 100;

// The `error_reason` of a run reconcile ended because its job was gone.
export const JOB_LOST_REASON = 'job-lost';

type Log = {
  info: (...args: any[]) => void;
  warn: (...args: any[]) => void;
  error: (...args: any[]) => void;
};

export interface AutomationReconcileOptions {
  queue: QueuePublisher;
  // Reads the automation card's declaration from the index
  // (`readRunDeclaration` in the worker).
  readDeclaration: (
    automationId: RealmResourceIdentifier,
  ) => Promise<AutomationDeclarationRead>;
  virtualNetwork: Pick<VirtualNetwork, 'toURLHref'>;
  // Charges a run reconcile ends for the compute and network it used. Without
  // it, as in a harness, nothing is charged.
  meteredCharges?: MeteredCharges;
  log: Log;
  // Unix seconds; the current time when absent.
  now?: number;
  graceSeconds?: number;
  pageSize?: number;
}

// What reconcile did with one run whose job was gone:
//
// - `requeued`: it enqueued the run's job again (`jobId`).
// - `ended`: it ended the run (`run`, as ended): reconcile had enqueued it
//   once already, or can't enqueue it again (`why`).
// - `left`: it left the run for a later pass: the run's card can't be read,
//   so its time limit isn't known (`why`).
// - `failed`: handling the run threw.
export type AutomationLostRunOutcome =
  | {
      kind: 'requeued';
      runId: string;
      automationId: RealmResourceIdentifier;
      trigger: string;
      slot: string;
      jobId: number;
    }
  | {
      kind: 'ended';
      run: AutomationRun;
      why: string;
    }
  | {
      kind: 'left';
      runId: string;
      automationId: RealmResourceIdentifier;
      why: string;
    }
  | {
      kind: 'failed';
      runId: string;
      automationId: RealmResourceIdentifier;
      error: unknown;
    };

export interface AutomationReconcileResult {
  lostRuns: AutomationLostRunOutcome[];
  // What the tick's procedure did with each automation whose next run had
  // passed unclaimed.
  overdue: AutomationTickOutcome[];
  // Runs each registered step made up, by step name.
  steps: Record<string, number>;
}

export interface AutomationReconcileStepContext {
  dbAdapter: DBAdapter;
  queue: QueuePublisher;
  readDeclaration: AutomationReconcileOptions['readDeclaration'];
  virtualNetwork: AutomationReconcileOptions['virtualNetwork'];
  log: Log;
  now: number;
  graceSeconds: number;
}

// A further kind of missed work for reconcile to make up. It returns how many
// runs it made up, and must be as safe to run twice at once as the pass
// itself: key what it enqueues by automation, trigger and slot.
export type AutomationReconcileStep = (
  context: AutomationReconcileStepContext,
) => Promise<number>;

const reconcileSteps = new Map<string, AutomationReconcileStep>();

export function registerAutomationReconcileStep(
  name: string,
  step: AutomationReconcileStep,
): void {
  reconcileSteps.set(name, step);
}

export async function reconcileAutomations(
  dbAdapter: DBAdapter,
  options: AutomationReconcileOptions,
): Promise<AutomationReconcileResult> {
  let now = options.now ?? Math.floor(Date.now() / 1000);
  let graceSeconds = options.graceSeconds ?? AUTOMATION_RECONCILE_GRACE_SECONDS;
  let lostRuns = await reconcileLostRuns(dbAdapter, options, now, graceSeconds);
  let overdue = await tickAutomations(dbAdapter, {
    queue: options.queue,
    readDeclaration: options.readDeclaration,
    virtualNetwork: options.virtualNetwork,
    now,
    overdueBy: graceSeconds,
    pageSize: options.pageSize,
  });
  let steps: Record<string, number> = {};
  for (let [name, step] of reconcileSteps) {
    try {
      steps[name] = await step({
        dbAdapter,
        queue: options.queue,
        readDeclaration: options.readDeclaration,
        virtualNetwork: options.virtualNetwork,
        log: options.log,
        now,
        graceSeconds,
      });
    } catch (error) {
      options.log.error(`automation-reconcile step ${name} failed:`, error);
    }
  }
  return { lostRuns, overdue, steps };
}

async function reconcileLostRuns(
  dbAdapter: DBAdapter,
  options: AutomationReconcileOptions,
  now: number,
  graceSeconds: number,
): Promise<AutomationLostRunOutcome[]> {
  let pageSize = options.pageSize ?? AUTOMATION_RECONCILE_PAGE_SIZE;
  let madeBefore = new Date((now - graceSeconds) * 1000).toISOString();
  let outcomes: AutomationLostRunOutcome[] = [];
  let after: string | undefined;
  for (;;) {
    let rows = await query(dbAdapter, [
      'SELECT r.id, r.automation_id FROM automation_runs r WHERE',
      "r.state IN ('pending', 'running') AND r.created_at <=",
      param(madeBefore),
      '::timestamptz AND',
      ...noLiveJob(),
      ...(after ? ['AND r.id >', param(after), '::uuid'] : []),
      'ORDER BY r.id LIMIT',
      param(pageSize),
    ]);
    for (let row of rows) {
      let runId = String(row.id);
      let automationId = row.automation_id as RealmResourceIdentifier;
      try {
        let outcome = await reconcileLostRun(
          dbAdapter,
          runId,
          automationId,
          options,
        );
        if (outcome) {
          outcomes.push(outcome);
        }
      } catch (error) {
        outcomes.push({ kind: 'failed', runId, automationId, error });
      }
    }
    if (rows.length < pageSize) {
      return outcomes;
    }
    after = String(rows[rows.length - 1].id);
  }
}

// Holds the automation's row, as the tick does while it writes runs and
// jobs, so a run the tick is enqueueing is never judged lost. Undefined when
// the run has ended, or has a live job, by the time the row is held.
async function reconcileLostRun(
  dbAdapter: DBAdapter,
  runId: string,
  automationId: RealmResourceIdentifier,
  options: AutomationReconcileOptions,
): Promise<AutomationLostRunOutcome | undefined> {
  let decided = await dbAdapter.withTransaction(async (txQuery) => {
    let [automation] = await txQuery([
      'SELECT state FROM automations WHERE automation_id =',
      param(automationId),
      'FOR UPDATE',
    ]);
    let [row] = await txQuery([
      'SELECT r.reconciled_at FROM automation_runs r WHERE r.id =',
      param(runId),
      "::uuid AND r.state IN ('pending', 'running') AND",
      ...noLiveJob(),
    ]);
    if (!row) {
      return undefined;
    }
    let run = (await getAutomationRun(dbAdapter, runId))!;
    if (row.reconciled_at != null) {
      return await end(
        run,
        'its job was lost again after reconcile enqueued it once more',
      );
    }
    let scheduled = run.trigger !== MANUAL_RUN_TRIGGER;
    if (scheduled && (!automation || automation.state === 'paused')) {
      return await end(
        run,
        automation
          ? 'its automation is paused'
          : 'its automation is no longer switched on',
      );
    }
    let read = await options.readDeclaration(automationId);
    if (!read.ok) {
      return {
        kind: 'left',
        runId,
        automationId,
        why: `its card can't be read: ${read.message}`,
      } as const;
    }
    let { declaration } = read;
    if (
      scheduled &&
      !declaration.triggers.some(
        ({ label, kind }) =>
          label === run.trigger && (kind === 'cron' || kind === 'once'),
      )
    ) {
      return await end(
        run,
        `no cron or one-time trigger on its card is labeled ${run.trigger}`,
      );
    }
    await txQuery([
      'UPDATE automation_runs SET reconciled_at = now() WHERE id =',
      param(runId),
      '::uuid',
    ]);
    let job = await enqueueAutomationRunJob(options.queue, {
      automationId,
      realmURL: ensureTrailingSlash(
        options.virtualNetwork.toURLHref(run.realm),
      ),
      actsAs: run.actsAs,
      trigger: run.trigger,
      slot: run.slot,
      secondsCap: declaration.caps.seconds,
      input: scheduled
        ? { runId, scheduledAt: run.slot, dryRun: false }
        : {
            runId,
            scheduledAt: run.createdAt,
            dryRun: run.dryRun,
            triggerKind: 'manual',
          },
    });
    return {
      kind: 'requeued',
      runId,
      automationId,
      trigger: run.trigger,
      slot: run.slot,
      jobId: job.id,
    } as const;
  });

  // Ends the run while the automation's row is held. The end is a
  // transaction of its own, and only locks the run's row, which this
  // transaction never takes.
  async function end(run: AutomationRun, why: string) {
    let ended = await abandonAutomationRun(dbAdapter, run.id, JOB_LOST_REASON);
    return ended ? ({ kind: 'ended', run: ended, why } as const) : undefined;
  }

  if (decided?.kind === 'requeued') {
    await logRunPlatformLine(dbAdapter, runId, {
      kind: 'trigger',
      level: 'warn',
      message:
        'Reconcile enqueued this run again: it was unfinished and its job was gone',
      data: { reconciled: true },
    });
  } else if (decided?.kind === 'ended') {
    await chargeAutomationRun({
      dbAdapter,
      meteredCharges: options.meteredCharges,
      runId,
      log: options.log,
    });
  }
  return decided;
}

// No unfinished `run-command` job carries the run's `dedupeKey`
// (`automationRunDedupeKey`, spelled out in SQL). A job is in
// its automation's concurrency group, which the partial index over
// unfinished jobs serves.
function noLiveJob(): string[] {
  return [
    'NOT EXISTS (SELECT 1 FROM jobs j WHERE',
    "j.status = 'unfulfilled' AND j.concurrency_group = 'automation:' || r.automation_id",
    "AND j.job_type = 'run-command'",
    "AND j.args->>'dedupeKey' = 'automation:' || r.automation_id || ':' || r.trigger || ':' || r.slot)",
  ];
}
