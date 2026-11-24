// A batch's follow-up run: the one run that picks up the results of a batch
// of AI requests an automation run submitted (ADR 030 §1.2). The submitting
// run finishes as soon as the batch is submitted, and nothing waits on the
// batch. The batch's `ai_batches` row is the follow-up's schedule: once its
// deadline passes, the minute tick makes the follow-up's run row and enqueues
// its `run-command` job.
//
// The follow-up's run row carries the trigger label `batch`
// (`BATCH_RUN_TRIGGER`) and the batch's id as its slot, and its job carries
// `triggerKind: 'batch'` and the dedupe key `automation:<id>:batch:<batch
// id>`. A run row is unique by its automation, trigger and slot, so a batch
// gets one follow-up however many ticks see its deadline pass: the tick that
// creates the row enqueues the job, and a tick that finds the row already
// there leaves it. A run row made by a tick that stopped before enqueueing
// is a pending run with no job, which reconcile finds as a lost run.
//
// The follow-up acts as, and is billed to, whoever the submitting run acted
// as (the batch's `acts_as`), in the automation's concurrency group, at the
// automation tier, with a queue timeout from the `seconds` cap the payer
// agreed to. It goes through admission like any run.
//
// A batch of an automation that is paused waits: its follow-up starts once
// the automation is no longer paused, as the tick next sees it (ADR 030
// §1.5). A batch of an automation that has been removed (no `automations`
// row) gets no follow-up. A batch whose deadline passed more than
// `AI_BATCH_HOLD_SECONDS` ago is left alone: OpenRouter deletes a batch's
// results 30 days after submit, and the settle job bills it whatever
// happens.

import { AI_BATCH_HOLD_SECONDS } from './ai-batches.ts';
import { BATCH_RUN_TRIGGER } from './automation-declaration.ts';
import { logRunPlatformLine } from './automation-run-log.ts';
import {
  emitAutomationRunEvent,
  type AutomationRunEnqueuedEvent,
} from './automation-run-telemetry.ts';
import { insertOrFindAutomationRun } from './automation-runs.ts';
import type { DBAdapter } from './db.ts';
import { dbAdapterQuerier, param, query } from './expression.ts';
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
// - `found`: another tick made the follow-up's run row first, so this one
//   enqueued nothing.
// - `failed`: starting the follow-up threw. A row made before the error is
//   found again as a pending run (by reconcile, when its job never came).
export type AIBatchFollowUpOutcome =
  | {
      kind: 'started';
      batchId: string;
      automationId: RealmResourceIdentifier;
      runId: string;
      jobId: number;
    }
  | {
      kind: 'found';
      batchId: string;
      automationId: RealmResourceIdentifier;
      runId: string;
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

// The batches whose deadline passed by `now`, within the hold, that have no
// follow-up run row, of an automation that is switched on and not paused,
// earliest deadline first.
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
    'WHERE b.deadline <=',
    param(nowISO),
    '::timestamptz AND b.deadline >',
    param(nowISO),
    '::timestamptz - make_interval(secs =>',
    param(AI_BATCH_HOLD_SECONDS),
    ") AND a.state <> 'paused'",
    'AND NOT EXISTS (SELECT 1 FROM automation_runs r WHERE r.automation_id = b.automation_id AND r.trigger =',
    param(BATCH_RUN_TRIGGER),
    'AND r.slot = b.batch_id)',
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
  if (!created) {
    return { kind: 'found', batchId, automationId, runId: run.id };
  }
  let job = await enqueueAutomationRunJob(queue, {
    automationId,
    realmURL: ensureTrailingSlash(virtualNetwork.toURLHref(batch.realm)),
    actsAs: run.actsAs,
    trigger: BATCH_RUN_TRIGGER,
    slot: batchId,
    secondsCap: batch.secondsCap,
    input: {
      runId: run.id,
      scheduledAt: batch.deadline,
      dryRun: false,
      triggerKind: 'batch',
    },
  });
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
