// A batch's follow-up run: the one run that picks up the results of a batch
// of AI requests an automation run submitted (ADR 030 §1.2). The submitting
// run finishes as soon as the batch is submitted, and nothing waits on the
// batch. The batch's `ai_batches` row is the follow-up's schedule: once its
// deadline passes, the minute tick makes the follow-up's run row, enqueues
// its `run-command` job, and records the run on the batch
// (`follow_up_run_id`).
//
// The follow-up's run row carries the trigger label `batch`
// (`BATCH_RUN_TRIGGER`) and the batch's id as its slot, and its job carries
// `triggerKind: 'batch'` and the dedupe key `automation:<id>:batch:<batch
// id>`. A run row is unique by its automation, trigger and slot, and the
// queue joins a job to an unfinished one with the same dedupe key, so a batch
// gets one follow-up and one job however many ticks see its deadline pass.
// A tick that stops after making the row and before recording it on the
// batch leaves the batch due: the next tick finds the same row, enqueues its
// job again while the run is still pending (joining the job already there,
// or replacing one that never got enqueued), and records it. Once recorded,
// a follow-up whose job is lost is reconcile's to enqueue again
// (`automation-reconcile.ts`).
//
// The follow-up acts as, and is billed to, whoever the submitting run acted
// as (the batch's `acts_as`), in the automation's concurrency group, at the
// automation tier, with a queue timeout from the `seconds` cap the payer
// agreed to. It goes through admission like any run.
//
// A batch of an automation that is paused, or waiting for a key approval,
// waits however long that lasts: its follow-up starts once the automation is
// active again, as the tick next sees it (ADR 030 §1.5). The tick holds the
// automation's row while it makes the follow-up's run row, enqueues its job
// and records it, as it does for a trigger's run, so a pause or a key-approval
// wait either lands first, and the batch waits, or lands after and finds the
// follow-up there to cancel. A batch of an automation that has been removed
// gets no follow-up, including after the automation is switched on again:
// only batches submitted since the automation's row was made count. Once its
// deadline has passed, such a batch is marked dropped
// (`follow_up_dropped_at`), which takes it out of the tick's search; the
// settle job still bills it.

import { BATCH_RUN_TRIGGER } from './automation-declaration.ts';
import type { AutomationJobInput } from './automation-run-command.ts';
import { logRunPlatformLine } from './automation-run-log.ts';
import {
  emitAutomationRunEvent,
  type AutomationRunEnqueuedEvent,
} from './automation-run-telemetry.ts';
import { insertOrFindAutomationRun } from './automation-runs.ts';
import type { DBAdapter } from './db.ts';
import {
  dbAdapterQuerier,
  param,
  query,
  type Expression,
  type Querier,
} from './expression.ts';
import { enqueueAutomationRunJob } from './jobs/run-command.ts';
import { ensureTrailingSlash } from './paths.ts';
import type { QueuePublisher } from './queue.ts';
import type {
  RealmIdentifier,
  RealmResourceIdentifier,
} from './realm-identifiers.ts';
import type { VirtualNetwork } from './virtual-network.ts';

// How many due batches one query reads. The tick reads pages until none is
// left, so this bounds a query, not a tick.
export const AI_BATCH_FOLLOW_UP_PAGE_SIZE = 100;

export interface AIBatchFollowUpOptions {
  queue: QueuePublisher;
  virtualNetwork: Pick<VirtualNetwork, 'toURLHref'>;
  // Unix seconds; the current time when absent.
  now?: number;
  pageSize?: number;
  // Called after each batch handled.
  onProgress?: () => void;
}

// What came of one batch whose deadline passed with no follow-up:
//
// - `started`: this call made the follow-up's run row and enqueued its job.
// - `resumed`: the run row was already there, still pending, from a tick that
//   stopped before recording it on the batch; its job was enqueued again.
// - `found`: the run row was already there and had started, so nothing was
//   enqueued.
// - `held`: the automation was paused, or began waiting for a key approval,
//   or was removed, after the search read the batch; it stays due.
// - `failed`: starting the follow-up threw. The batch stays due, and the next
//   tick tries again.
export type AIBatchFollowUpOutcome =
  | {
      kind: 'started';
      batchId: string;
      automationId: RealmResourceIdentifier;
      runId: string;
      jobId: number;
    }
  | {
      kind: 'resumed' | 'found';
      batchId: string;
      automationId: RealmResourceIdentifier;
      runId: string;
    }
  | {
      kind: 'held';
      batchId: string;
      automationId: RealmResourceIdentifier;
    }
  | {
      kind: 'failed';
      batchId: string;
      automationId: RealmResourceIdentifier;
      error: unknown;
    };

// Starts the follow-up of every batch whose deadline has passed by `now` and
// that has none, one batch at a time, so one batch's failure doesn't stop the
// rest.
export async function startDueAIBatchFollowUps(
  dbAdapter: DBAdapter,
  options: AIBatchFollowUpOptions,
): Promise<AIBatchFollowUpOutcome[]> {
  let now = options.now ?? Math.floor(Date.now() / 1000);
  let pageSize = options.pageSize ?? AI_BATCH_FOLLOW_UP_PAGE_SIZE;
  let outcomes: AIBatchFollowUpOutcome[] = [];
  // The last batch read, by deadline and then id, so a batch that failed
  // isn't read again in the same pass.
  let after: { deadline: string; batchId: string } | undefined;
  await dropUnreachableFollowUps(dbAdapter, now);
  for (;;) {
    let due = await dueBatches(dbAdapter, now, pageSize, after);
    for (let batch of due) {
      try {
        outcomes.push(await startFollowUp(dbAdapter, batch, options));
      } catch (error) {
        outcomes.push({
          kind: 'failed',
          batchId: batch.batchId,
          automationId: batch.automationId,
          error,
        });
      }
      options.onProgress?.();
    }
    if (due.length < pageSize) {
      return outcomes;
    }
    let last = due[due.length - 1];
    after = { deadline: last.deadline, batchId: last.batchId };
  }
}

interface DueBatch {
  batchId: string;
  runId: string;
  actsAs: string;
  realm: RealmIdentifier;
  automationId: RealmResourceIdentifier;
  // ISO 8601.
  deadline: string;
  requestCount: number;
  // The `seconds` cap the payer agreed to, from the automation's caps
  // snapshot.
  secondsCap: number;
}

// The batches whose deadline passed by `now` that have no follow-up recorded,
// of an automation that is switched on, neither paused nor waiting for a key
// approval, and was switched on before the batch was submitted, earliest
// deadline first.
async function dueBatches(
  dbAdapter: DBAdapter,
  now: number,
  limit: number,
  after: { deadline: string; batchId: string } | undefined,
): Promise<DueBatch[]> {
  let nowISO = new Date(now * 1000).toISOString();
  let rows = await query(dbAdapter, [
    "SELECT b.batch_id, b.run_id, b.acts_as, b.realm, b.automation_id, b.deadline, b.request_count, a.caps_snapshot ->> 'seconds' AS seconds_cap",
    'FROM ai_batches b JOIN automations a ON a.automation_id = b.automation_id',
    'WHERE b.follow_up_run_id IS NULL AND b.follow_up_dropped_at IS NULL AND b.deadline <=',
    param(nowISO),
    '::timestamptz AND',
    ...followUpMayStart(),
    ...(after
      ? [
          'AND (b.deadline, b.batch_id) > (',
          param(after.deadline),
          '::timestamptz,',
          param(after.batchId),
          ')',
        ]
      : []),
    'ORDER BY b.deadline, b.batch_id LIMIT',
    param(limit),
  ]);
  return rows.map((row) => ({
    batchId: String(row.batch_id),
    runId: String(row.run_id),
    actsAs: String(row.acts_as),
    realm: row.realm as RealmIdentifier,
    automationId: row.automation_id as RealmResourceIdentifier,
    deadline: new Date(row.deadline as string).toISOString(),
    requestCount: Number(row.request_count),
    secondsCap: Number(row.seconds_cap),
  }));
}

async function startFollowUp(
  dbAdapter: DBAdapter,
  batch: DueBatch,
  { queue, virtualNetwork }: AIBatchFollowUpOptions,
): Promise<AIBatchFollowUpOutcome> {
  let { batchId, automationId } = batch;
  // Held until the run row, the job and the record are written, so a pause or
  // a key-approval wait can't land between reading the automation's state and
  // writing the follow-up (see the header).
  let started = await dbAdapter.withTransaction(async (txQuery) => {
    let [mayStart] = await txQuery([
      'SELECT 1 FROM automations a JOIN ai_batches b ON b.automation_id = a.automation_id WHERE b.batch_id =',
      param(batchId),
      'AND b.follow_up_run_id IS NULL AND',
      ...followUpMayStart(),
      'FOR UPDATE OF a',
    ]);
    if (!mayStart) {
      return { kind: 'held' as const };
    }
    // Written outside the transaction, as the tick writes a trigger's run,
    // so the worker that takes the job finds the run row.
    let { run, created } = await insertOrFindAutomationRun(
      dbAdapterQuerier(dbAdapter),
      {
        automationId,
        realm: batch.realm,
        trigger: BATCH_RUN_TRIGGER,
        slot: batchId,
        actsAs: batch.actsAs,
      },
    );
    if (!created && run.state !== 'pending') {
      await recordFollowUp(txQuery, batchId, run.id);
      return { kind: 'found' as const, run };
    }
    let job = await enqueueAutomationRunJob(queue, {
      automationId,
      realmURL: ensureTrailingSlash(virtualNetwork.toURLHref(batch.realm)),
      actsAs: run.actsAs,
      trigger: BATCH_RUN_TRIGGER,
      slot: batchId,
      secondsCap: batch.secondsCap,
      input: aiBatchFollowUpInput(run.id, batch.deadline),
    });
    await recordFollowUp(txQuery, batchId, run.id);
    return {
      kind: created ? ('started' as const) : ('resumed' as const),
      run,
      job,
    };
  });
  if (started.kind === 'held') {
    return { kind: 'held', batchId, automationId };
  }
  let { run } = started;
  if (started.kind !== 'started') {
    return { kind: started.kind, batchId, automationId, runId: run.id };
  }
  let { job } = started;
  let enqueuedAt = Date.now();
  let enqueued: AutomationRunEnqueuedEvent = {
    kind: 'enqueued',
    automation: automationId,
    run: run.id,
    job: job.id,
    realm: batch.realm,
    trigger: BATCH_RUN_TRIGGER,
    triggerKind: 'batch',
    dryRun: false,
    scheduledAt: batch.deadline,
    enqueuedAt: new Date(enqueuedAt).toISOString(),
    scheduleLagMs: Math.max(0, enqueuedAt - Date.parse(batch.deadline)),
  };
  emitAutomationRunEvent(enqueued);
  await logRunPlatformLine(
    dbAdapter,
    run.id,
    {
      kind: 'trigger',
      level: 'info',
      message: `Batch ${batchId} of ${batch.requestCount} AI request${batch.requestCount === 1 ? '' : 's'}, submitted by run ${batch.runId}, reached its deadline at ${batch.deadline}, so this run picks up its results`,
      data: {
        trigger: BATCH_RUN_TRIGGER,
        slot: batchId,
        submittedBy: batch.runId,
        deadline: batch.deadline,
      },
    },
    job.id,
  );
  return {
    kind: 'started',
    batchId,
    automationId,
    runId: run.id,
    jobId: job.id,
  };
}

// The job input of a batch's follow-up run: due at the batch's deadline.
export function aiBatchFollowUpInput(
  runId: string,
  deadline: string,
): AutomationJobInput {
  return { runId, scheduledAt: deadline, dryRun: false, triggerKind: 'batch' };
}

// Records the batch's follow-up run, which takes the batch out of the tick's
// search.
async function recordFollowUp(
  querier: Querier,
  batchId: string,
  runId: string,
): Promise<void> {
  await querier([
    'UPDATE ai_batches SET follow_up_run_id =',
    param(runId),
    '::uuid WHERE batch_id =',
    param(batchId),
    'AND follow_up_run_id IS NULL',
  ]);
}

// Whether a batch's automation lets its follow-up start (`a` the automation,
// `b` the batch): it is neither paused nor waiting for a key approval, and
// was switched on before the batch was submitted.
function followUpMayStart(): Expression {
  return [
    "a.state NOT IN ('paused', 'waiting-for-key-approval') AND b.submitted_at >= a.switched_on_at",
  ];
}

// Marks dropped every batch whose deadline has passed and that can never get
// a follow-up: its automation has been removed, or was switched on again after
// the batch was submitted. Without the mark, such a batch would stay in the
// tick's search for good.
async function dropUnreachableFollowUps(
  dbAdapter: DBAdapter,
  now: number,
): Promise<void> {
  await query(dbAdapter, [
    'UPDATE ai_batches b SET follow_up_dropped_at = now()',
    'WHERE b.follow_up_run_id IS NULL AND b.follow_up_dropped_at IS NULL AND b.deadline <=',
    param(new Date(now * 1000).toISOString()),
    '::timestamptz AND NOT EXISTS (SELECT 1 FROM automations a WHERE a.automation_id = b.automation_id AND b.submitted_at >= a.switched_on_at)',
  ]);
}
