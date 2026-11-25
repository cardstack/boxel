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
//   finished without ending the run, or was never published.
//
//   A **pending** run never started, so reconcile enqueues the same run's
//   job again, once, and records `reconciled_at`. The run keeps its slot, so
//   the make-up's slot is the missed instant and its trigger's count and
//   cursor don't change. Its card's `seconds` cap sets the job's timeout; a
//   card that can't be read gets the longest a run may take, and the run's
//   admission then ends it with the reason the card doesn't read. A batch's
//   follow-up (trigger `batch`) is enqueued again with the input the tick
//   gave it, due at its batch's deadline (`aiBatchFollowUpInput`).
//
//   A **running** run is ended: an attempt had started it, and a retry gets
//   only what is left of the run's time limit, counted from that first start,
//   which a job the queue gave up on has long since used. The trigger's next
//   run catches up on everything since, because the realm is the state.
//
//   `abandonAutomationRun` ends a run (reason `job-lost`; `complete` when its
//   commit landed), the run is charged for what it used, and its automation
//   pauses if its own runs have failed too many times in a row
//   (`pauseAfterRepeatedFailures`). A pending run
//   whose extra job was lost too is ended the same way, as is a scheduled run
//   whose automation is paused, waiting for key approval or no longer switched on, or whose trigger is
//   gone from its card.
//
//   A batch's follow-up whose automation is paused or waiting for key
//   approval is held instead, never ended (`holdAutomationFollowUpRuns`, ADR
//   030 §1.5): a pause holds it, and the tick starts it again once the
//   automation is active. A follow-up its batch records as held has no job by
//   design, so the search for lost runs passes over it.
//
//   A webhook delivery's run is ended too, never enqueued again: its
//   delivery's payload lived only in its job, so a job made again would run
//   the script without it. Its slot says it is a delivery's
//   (`isWebhookDeliverySlot`), whatever its card says now. A cron trigger on
//   the same card is what makes up a delivery that was lost (see
//   `automation-webhook-runs.ts`).
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
// Other kinds of missed work register a step with
// `registerAutomationReconcileStep`; each pass runs every registered step
// after its own. A batch whose deadline passed with no follow-up needs none:
// the minute tick reads every such batch on each pass
// (`startDueAIBatchFollowUps`).

import { aiBatchFollowUpInput } from './ai-batch-follow-ups.ts';
import {
  BATCH_RUN_TRIGGER,
  MANUAL_RUN_TRIGGER,
  MAX_RUN_SECONDS,
} from './automation-declaration.ts';
import { chargeAutomationRun } from './automation-run-charge.ts';
import type { ReportAutomationChange } from './automation-change-events.ts';
import type { ReportRunChange } from './automation-run-events.ts';
import { logRunPlatformLine } from './automation-run-log.ts';
import {
  abandonAutomationRun,
  getAutomationRun,
  holdAutomationFollowUpRuns,
  logAutomationRunEnded,
  type AutomationRun,
} from './automation-runs.ts';
import {
  tickAutomations,
  type AutomationDeclarationRead,
  type AutomationTickOutcome,
} from './automation-tick.ts';
import { pauseAfterRepeatedFailures } from './automations.ts';
import type { DBAdapter } from './db.ts';
import { param, query, type Querier } from './expression.ts';
import { enqueueAutomationRunJob } from './jobs/run-command.ts';
import { isWebhookDeliverySlot } from './automation-run-command.ts';
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
  // Called after each run, automation and step a pass handles, so the job
  // running the pass can tell the queue it is getting somewhere
  // (`heartbeatJob`). A pass after a long outage can outlast the job's
  // timeout.
  onProgress?: () => void;
  // Told of each automation the overdue pass or a pause for repeated
  // failures changes, such as one paused for an invalid declaration, and of
  // each run such a pause cancels, once the change commits.
  reportRunChange?: ReportRunChange;
  reportAutomationChange?: ReportAutomationChange;
}

// What reconcile did with one run whose job was gone:
//
// - `requeued`: it enqueued the run's job again (`jobId`).
// - `ended`: it ended the run (`run`, as ended), and `why`.
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
      kind: 'held';
      // The held follow-up, and the run that ended in its place when the
      // lost run had used something (`holdAutomationFollowUpRuns`).
      run: AutomationRun;
      ended?: AutomationRun;
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

// Adds a step under `name`, replacing any step already there. Returns a
// function that removes it again.
export function registerAutomationReconcileStep(
  name: string,
  step: AutomationReconcileStep,
): () => void {
  reconcileSteps.set(name, step);
  return () => {
    if (reconcileSteps.get(name) === step) {
      reconcileSteps.delete(name);
    }
  };
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
    onProgress: options.onProgress,
    reportAutomationChange: options.reportAutomationChange,
    reportRunChange: options.reportRunChange,
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
    options.onProgress?.();
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
      'AND',
      ...notHeld(),
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
      options.onProgress?.();
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
      'AND',
      ...notHeld(),
    ]);
    if (!row) {
      return undefined;
    }
    let run = (await getAutomationRun(dbAdapter, runId))!;
    // A batch's follow-up: its slot is its batch's id, and no trigger on the
    // card names it.
    let followUp = run.trigger === BATCH_RUN_TRIGGER;
    if (
      followUp &&
      (automation?.state === 'paused' ||
        automation?.state === 'waiting-for-key-approval')
    ) {
      let {
        held: [held],
        ended: [ended],
      } = await holdAutomationFollowUpRuns(txQuery, automationId, { runId });
      return held
        ? ({ kind: 'held', run: held, ...(ended ? { ended } : {}) } as const)
        : undefined;
    }
    if (row.reconciled_at != null) {
      return await end(
        run,
        'its job was lost again after reconcile enqueued it once more',
      );
    }
    if (run.state === 'running') {
      return await end(
        run,
        "an attempt had started it, and a retry would get only what is left of the run's time limit",
      );
    }
    let scheduled = run.trigger !== MANUAL_RUN_TRIGGER;
    if (
      scheduled &&
      (!automation ||
        automation.state === 'paused' ||
        automation.state === 'waiting-for-key-approval')
    ) {
      return await end(
        run,
        !automation
          ? 'its automation is no longer switched on'
          : automation.state === 'paused'
            ? 'its automation is paused'
            : 'its automation is waiting for key approval',
      );
    }
    if (scheduled && isWebhookDeliverySlot(run.slot)) {
      return await end(
        run,
        "it is a webhook delivery's run, and the delivery's payload lived only in its job",
      );
    }
    // A card that can't be read still gets its run enqueued: the run's
    // admission reads the card again and ends the run with the reason it
    // doesn't read, so no run is left pending for good.
    let read = await options.readDeclaration(automationId);
    let declaration = read.ok ? read.declaration : undefined;
    if (
      scheduled &&
      !followUp &&
      declaration &&
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
      secondsCap: declaration?.caps.seconds ?? MAX_RUN_SECONDS,
      input: followUp
        ? aiBatchFollowUpInput(
            runId,
            (await aiBatchDeadline(txQuery, run.slot)) ?? run.createdAt,
          )
        : scheduled
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

  if (decided?.kind === 'held') {
    if (decided.ended) {
      // The lost run's attempt is gone, so reconcile logs its end and
      // charges what it used to whom it acted as.
      await logAutomationRunEnded(dbAdapter, decided.ended);
      await chargeAutomationRun({
        dbAdapter,
        meteredCharges: options.meteredCharges,
        runId: decided.ended.id,
        log: options.log,
      });
      await options.reportRunChange?.(decided.ended.id);
    }
    await logRunPlatformLine(dbAdapter, decided.run.id, {
      kind: 'trigger',
      level: 'info',
      message:
        "Reconcile found this batch's follow-up without a job while its automation is stopped, so it is held: it starts again once the automation is resumed or active again",
      data: { reconciled: true, held: true },
    });
    await options.reportRunChange?.(decided.run.id);
  } else if (decided?.kind === 'requeued') {
    await logRunPlatformLine(dbAdapter, runId, {
      kind: 'trigger',
      level: 'warn',
      message:
        'Reconcile enqueued this run again: it was still pending and its job was gone',
      data: { reconciled: true },
    });
  } else if (decided?.kind === 'ended') {
    await chargeAutomationRun({
      dbAdapter,
      meteredCharges: options.meteredCharges,
      runId,
      log: options.log,
    });
    if (decided.run.state === 'error') {
      await pauseIfFailingRepeatedly(dbAdapter, decided.run, options);
    }
  }
  return decided;
}

// Once reconcile has ended a run as an error, pauses its automation if its
// own runs have now failed too many times in a row, as the worker does after
// each run it ends. It asks after the automation's row is let go, since the
// pause takes the row itself. Whether the run counts toward the streak is the
// streak's own rule: `job-lost` doesn't, and asking anyway makes up a check
// that an earlier failed run's attempt never got to. A failure to pause is
// logged, and the next failed run asks again.
async function pauseIfFailingRepeatedly(
  dbAdapter: DBAdapter,
  run: AutomationRun,
  options: AutomationReconcileOptions,
): Promise<void> {
  try {
    let result = await pauseAfterRepeatedFailures(
      dbAdapter,
      run.automationId,
      {},
      {
        reportRunChange: options.reportRunChange,
        reportAutomationChange: options.reportAutomationChange,
      },
    );
    if (result?.paused) {
      options.log.warn(
        `automation ${run.automationId} paused after repeated failed runs; reconcile ended run ${run.id} (${run.errorReason ?? 'error'})`,
      );
    }
  } catch (error) {
    options.log.error(
      `could not check whether automation run ${run.id}'s failure pauses its automation:`,
      error,
    );
  }
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

// The run, aliased `r`, isn't a batch's follow-up its batch records as held:
// one that waits, with no job, for its automation to be active again.
function notHeld(): string[] {
  return [
    'NOT EXISTS (SELECT 1 FROM ai_batches b WHERE',
    "r.trigger = 'batch' AND b.batch_id = r.slot AND b.automation_id = r.automation_id",
    'AND b.follow_up_held_at IS NOT NULL)',
  ];
}

// The deadline of the batch a follow-up's slot names, as ISO text, or
// undefined when no batch has that id.
async function aiBatchDeadline(
  txQuery: Querier,
  batchId: string,
): Promise<string | undefined> {
  let [row] = await txQuery([
    'SELECT deadline FROM ai_batches WHERE batch_id =',
    param(batchId),
  ]);
  return row ? new Date(row.deadline as string).toISOString() : undefined;
}
