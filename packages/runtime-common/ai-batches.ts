// The batch record: one `ai_batches` row per batch of AI requests an
// automation run submits to OpenRouter's Batch API (ADR 030). Submitting a
// batch charges nothing, because OpenRouter reports a batch's cost only once
// it ends. A batch can't be canceled, so every batch is billed later, from its
// row, to the person its run acted as, by the settle job once it ends.

import { MANUAL_RUN_TRIGGER } from './automation-declaration.ts';
import { runCreditHoldCounts } from './automation-runs.ts';
import { CREDITS_PER_USD } from './constants.ts';
import type { DBAdapter } from './db.ts';
import {
  addExplicitParens,
  param,
  query,
  separatedByCommas,
  type Expression,
  type Querier,
} from './expression.ts';
import type { PgPrimitive } from './index.ts';
import type {
  RealmIdentifier,
  RealmResourceIdentifier,
} from './realm-identifiers.ts';

// The statuses after which OpenRouter does no more work on a batch. A batch in
// any other status is still open.
export const AI_BATCH_FINAL_STATES: readonly string[] = [
  'completed',
  'failed',
  'expired',
  'cancelled',
];

export interface AIBatch {
  // OpenRouter's id for the batch.
  batchId: string;
  // The run that submitted it, and the Matrix user id that run acted as,
  // whom the batch is billed to.
  runId: string;
  actsAs: string;
  realm: RealmIdentifier;
  automationId: RealmResourceIdentifier;
  model: string;
  requestCount: number;
  // The most the batch can cost, in USD: each request's input and
  // output-token limit at the model's listed batch price.
  estimatedUsd: number;
  // The reservation the batch holds on the submitting run's AI spending cap,
  // at twice its requests' worst case at the normal price, for the settle job
  // to settle when the batch ends.
  runAIReservation: string;
  // The credits that reservation holds. Null on a row recorded without them
  // (see `creditsHeldByUnsettledAIBatches` for what such a row holds).
  reservedCredits: number | null;
  // How long the submitting script waits for the results.
  deadline: string;
  // When OpenRouter says its provider stops working on the batch, if it
  // gives a time.
  expiresAt: string | null;
  // OpenRouter's status for the batch as last read, and when.
  state: string;
  stateReadAt: string;
  submittedAt: string;
  // When the batch reached a final status: OpenRouter's `finalized_at` when
  // it reports one, otherwise when a final status was first read. Null while
  // the batch is open.
  finalizedAt: string | null;
  // When a run first read the batch, at or after its deadline, and found it
  // still open. That run falls back to the normal price, so the batch is
  // late from then on. Null while no run has.
  deadlineMissedAt: string | null;
  // When the settle job last tried to read the batch.
  settleReadAt: string | null;
  // When the settle job billed the batch, and what it billed, in USD: the
  // cost OpenRouter reported, or the estimate when it reported none. Null
  // until the batch is settled.
  settledAt: string | null;
  billedUsd: number | null;
  billedAtEstimate: boolean | null;
}

// What a batch costs as the run that submitted it reads it: pending until the
// settle job bills it, then what it was billed, in USD, and whether that was
// the estimate because OpenRouter reported no cost.
export type AIBatchCost =
  | { kind: 'pending' }
  | { kind: 'settled'; usd: number; estimated: boolean };

export function aiBatchCost(batch: AIBatch): AIBatchCost {
  if (batch.settledAt === null || batch.billedUsd === null) {
    return { kind: 'pending' };
  }
  return {
    kind: 'settled',
    usd: batch.billedUsd,
    estimated: batch.billedAtEstimate === true,
  };
}

// Whether the batch is late: a run read it at or after its deadline and
// found it still open, so that run sends the same requests at the normal
// price (ADR 030 §1.3). A late batch is billed like any other, and its
// results are discarded, so the requests aren't answered twice.
export function isLateAIBatch(batch: AIBatch): boolean {
  return batch.deadlineMissedAt !== null;
}

export interface NewAIBatch {
  batchId: string;
  runId: string;
  actsAs: string;
  realm: RealmIdentifier;
  automationId: RealmResourceIdentifier;
  model: string;
  requestCount: number;
  estimatedUsd: number;
  runAIReservation: string;
  reservedCredits: number;
  deadline: Date;
  expiresAt: Date | null;
  state: string;
}

// How a worker task settles batches: the realm-server side reads each
// unsettled batch from OpenRouter and bills the ones that have ended (see
// `ai-batch-settle.ts` in realm-server), since only it holds the platform's
// OpenRouter key and the billing functions.
export interface AIBatchSettlement {
  // `onProgress` is called as the pass makes progress, after each batch and
  // each page of OpenRouter's batch list.
  settle(opts?: {
    now?: Date;
    onProgress?: () => void;
  }): Promise<AIBatchSettlementResult>;
}

// What a settle pass did: batches it billed (`settled`), batches still
// running (`open`), batches it couldn't read or bill this pass (`failed`),
// and batches OpenRouter lists with no row that it found for the first time
// (`unrecorded`).
export interface AIBatchSettlementResult {
  settled: number;
  open: number;
  failed: number;
  unrecorded: number;
}

// The credits held by unsettled batches: those billed to `actsAs` (the
// balance check), or those of `automationId` that runs other than Previews
// and Run nows submitted (the credit caps). A batch is billed only once it
// ends, so from submit until the settle job bills it, a batch holds what it
// reserved on its submitting run's AI spending cap: twice its requests' worst
// case at the normal price, once for the batch and once for the requests its
// follow-up sends at the normal price when it misses its deadline (ADR 030
// §1.4).
//
// A row recorded without `reserved_credits` holds the reservation its run's
// row still names (`ai_reservations`). A row whose reservation is gone too
// holds twice its estimate: the estimate is at the batch price, which is
// typically half the normal price, so twice it approximates the most the
// batch can be billed.
//
// While the submitting run's own credit hold counts
// (`creditsHeldByRunsInFlight`), that hold already covers the batch: the
// run's cost ceiling includes its AI spending cap, which the batch's
// reservation counts against. So a batch holds only once its run's hold has
// stopped counting, or its run's row is gone.
export async function creditsHeldByUnsettledAIBatches(
  querier: Querier,
  filter:
    | { actsAs: string; automationId?: undefined }
    | { automationId: RealmResourceIdentifier; actsAs?: undefined },
): Promise<number> {
  let [row] = await querier([
    'SELECT COALESCE(SUM(COALESCE(b.reserved_credits, CAST(r.ai_reservations ->> b.run_ai_reservation AS numeric), b.estimated_usd *',
    param(2 * CREDITS_PER_USD),
    ')), 0) AS held FROM ai_batches b LEFT JOIN automation_runs r ON r.id = b.run_id',
    'WHERE b.settled_at IS NULL AND',
    ...((filter.actsAs !== undefined
      ? ['b.acts_as =', param(filter.actsAs)]
      : [
          'b.automation_id =',
          param(filter.automationId),
          'AND r.trigger IS DISTINCT FROM',
          param(MANUAL_RUN_TRIGGER),
        ]) as Expression),
    'AND NOT',
    ...runCreditHoldCounts('r'),
  ] as Expression);
  return Number(row?.held ?? 0);
}

export function isFinalAIBatchState(state: string): boolean {
  return AI_BATCH_FINAL_STATES.includes(state);
}

// Records a submitted batch, or returns the record already there for its id,
// so recording the same submit twice gives one row.
export async function recordAIBatch(
  dbAdapter: DBAdapter,
  batch: NewAIBatch,
): Promise<AIBatch> {
  if (!Number.isInteger(batch.requestCount) || batch.requestCount < 1) {
    throw new Error(
      `a batch holds a whole number of requests, 1 or more, not ${batch.requestCount}`,
    );
  }
  if (!Number.isFinite(batch.estimatedUsd) || batch.estimatedUsd < 0) {
    throw new Error(
      `a batch's estimate is a finite number of USD, 0 or more, not ${batch.estimatedUsd}`,
    );
  }
  if (!Number.isFinite(batch.reservedCredits) || batch.reservedCredits < 0) {
    throw new Error(
      `a batch reserves a finite number of credits, 0 or more, not ${batch.reservedCredits}`,
    );
  }
  let [created] = await query(dbAdapter, [
    'INSERT INTO ai_batches (batch_id, run_id, acts_as, realm, automation_id, model, request_count, estimated_usd, run_ai_reservation, reserved_credits, deadline, expires_at, state) VALUES (',
    param(batch.batchId),
    ',',
    param(batch.runId),
    ',',
    param(batch.actsAs),
    ',',
    param(batch.realm),
    ',',
    param(batch.automationId),
    ',',
    param(batch.model),
    ',',
    param(batch.requestCount),
    ',',
    param(batch.estimatedUsd),
    ',',
    param(batch.runAIReservation),
    ',',
    param(batch.reservedCredits),
    ',',
    param(batch.deadline.toISOString()),
    ',',
    param(batch.expiresAt ? batch.expiresAt.toISOString() : null),
    ',',
    param(batch.state),
    ') ON CONFLICT (batch_id) DO NOTHING RETURNING *',
  ]);
  if (created) {
    return batchFromRow(created);
  }
  let existing = await getAIBatch(dbAdapter, batch.batchId);
  if (!existing) {
    throw new Error(`batch ${batch.batchId} was neither recorded nor found`);
  }
  return existing;
}

export async function getAIBatch(
  dbAdapter: DBAdapter,
  batchId: string,
): Promise<AIBatch | undefined> {
  let [row] = await query(dbAdapter, [
    'SELECT * FROM ai_batches WHERE batch_id =',
    param(batchId),
  ]);
  return row ? batchFromRow(row) : undefined;
}

// Records the status OpenRouter last reported for a batch, and its expiry
// when it reports one. A batch already in a final status keeps it: OpenRouter
// does no more work on it, so a read that arrives out of order can't reopen
// it. The first read of a final status also records when the batch reached
// it: `finalizedAt`, OpenRouter's time, when given, otherwise the time of the
// read. Returns the batch as recorded, or undefined when there is no such
// batch.
export async function recordAIBatchState(
  dbAdapter: DBAdapter,
  batchId: string,
  {
    state,
    expiresAt,
    finalizedAt,
  }: { state: string; expiresAt?: Date | null; finalizedAt?: Date | null },
): Promise<AIBatch | undefined> {
  let finalized: Expression = isFinalAIBatchState(state)
    ? [
        ', finalized_at = COALESCE(finalized_at, CAST(',
        param(finalizedAt ? finalizedAt.toISOString() : null),
        'AS timestamptz), now())',
      ]
    : [];
  let [row] = await query(dbAdapter, [
    'UPDATE ai_batches SET state = CASE WHEN state IN (',
    ...finalStatesList(),
    ') THEN state ELSE',
    param(state),
    'END, expires_at = COALESCE(',
    param(expiresAt ? expiresAt.toISOString() : null),
    ', expires_at)',
    ...finalized,
    ', state_read_at = now() WHERE batch_id =',
    param(batchId),
    'RETURNING *',
  ]);
  return row ? batchFromRow(row) : undefined;
}

// The batches the settle job hasn't billed yet, the ones it hasn't tried to
// read for longest first, so batches OpenRouter can't answer for take their
// turn behind the rest instead of ahead of them.
export async function listUnsettledAIBatches(
  dbAdapter: DBAdapter,
  { limit }: { limit: number },
): Promise<AIBatch[]> {
  let rows = await query(dbAdapter, [
    'SELECT * FROM ai_batches WHERE settled_at IS NULL ORDER BY settle_read_at NULLS FIRST, submitted_at LIMIT',
    param(limit),
  ]);
  return rows.map(batchFromRow);
}

// Records that the settle job is trying to read a batch, whatever comes of
// it.
export async function recordAIBatchSettleRead(
  dbAdapter: DBAdapter,
  batchId: string,
): Promise<void> {
  await query(dbAdapter, [
    'UPDATE ai_batches SET settle_read_at = now() WHERE batch_id =',
    param(batchId),
  ]);
}

// Records that a run read a batch at or after its deadline and found it
// still open, the first time that happens. Returns the batch as recorded, or
// undefined when there is no such batch.
export async function recordAIBatchReadByRun(
  dbAdapter: DBAdapter,
  batchId: string,
): Promise<AIBatch | undefined> {
  let [row] = await query(dbAdapter, [
    'UPDATE ai_batches SET deadline_missed_at = COALESCE(deadline_missed_at, CASE WHEN deadline <= now() AND state NOT IN (',
    ...finalStatesList(),
    ') THEN now() END) WHERE batch_id =',
    param(batchId),
    'RETURNING *',
  ]);
  return row ? batchFromRow(row) : undefined;
}

// The batches a run submitted, oldest first.
export async function listAIBatchesForRun(
  dbAdapter: DBAdapter,
  runId: string,
): Promise<AIBatch[]> {
  let rows = await query(dbAdapter, [
    'SELECT * FROM ai_batches WHERE run_id =',
    param(runId),
    'ORDER BY submitted_at',
  ]);
  return rows.map(batchFromRow);
}

// Records that the settle job billed a batch `usd`, at its estimate when
// `estimated`. The first settlement stands: a batch already settled keeps
// what it was billed, and this returns undefined.
export async function recordAIBatchSettled(
  dbAdapter: DBAdapter,
  batchId: string,
  { usd, estimated }: { usd: number; estimated: boolean },
): Promise<AIBatch | undefined> {
  if (!Number.isFinite(usd) || usd < 0) {
    throw new Error(
      `a batch is billed a finite number of USD, 0 or more, not ${usd}`,
    );
  }
  let [row] = await query(dbAdapter, [
    'UPDATE ai_batches SET settled_at = now(), billed_usd =',
    param(usd),
    ', billed_at_estimate =',
    param(estimated),
    'WHERE batch_id =',
    param(batchId),
    'AND settled_at IS NULL RETURNING *',
  ]);
  return row ? batchFromRow(row) : undefined;
}

// A batch OpenRouter lists with no `ai_batches` row.
export interface UnrecordedAIBatch {
  batchId: string;
  model: string | null;
  status: string | null;
  requestCount: number | null;
  costUsd: number | null;
  createdAt: Date | null;
}

// Records the batches OpenRouter lists that have no `ai_batches` row, in one
// statement, and returns the ones not recorded before, so each is reported
// once. A batch with an `ai_batches` row by the time this runs is left out.
export async function recordUnrecordedAIBatches(
  dbAdapter: DBAdapter,
  batches: UnrecordedAIBatch[],
): Promise<UnrecordedAIBatch[]> {
  if (batches.length === 0) {
    return [];
  }
  let values: Expression = separatedByCommas(
    batches.map(
      (batch) =>
        addExplicitParens(
          separatedByCommas([
            [param(batch.batchId)],
            [param(batch.model)],
            [param(batch.status)],
            ['CAST(', param(batch.requestCount), 'AS integer)'],
            ['CAST(', param(batch.costUsd), 'AS numeric)'],
            [
              'CAST(',
              param(batch.createdAt ? batch.createdAt.toISOString() : null),
              'AS timestamptz)',
            ],
          ]),
        ) as Expression,
    ),
  ) as Expression;
  let rows = await query(dbAdapter, [
    'INSERT INTO unrecorded_ai_batches (batch_id, model, status, request_count, cost_usd, created_at)',
    'SELECT * FROM (VALUES',
    ...values,
    ') AS listed (batch_id, model, status, request_count, cost_usd, created_at)',
    'WHERE NOT EXISTS (SELECT 1 FROM ai_batches b WHERE b.batch_id = listed.batch_id)',
    'ON CONFLICT (batch_id) DO NOTHING RETURNING batch_id',
  ]);
  let inserted = new Set(rows.map((row) => String(row.batch_id)));
  return batches.filter((batch) => inserted.has(batch.batchId));
}

// Marks resolved every unrecorded batch that has an `ai_batches` row after
// all, as a submit slower than the reconciliation's grace period leaves
// behind. Returns how many it resolved.
export async function resolveRecordedAIBatches(
  dbAdapter: DBAdapter,
): Promise<number> {
  let rows = await query(dbAdapter, [
    'UPDATE unrecorded_ai_batches u SET resolved_at = now() WHERE resolved_at IS NULL',
    'AND EXISTS (SELECT 1 FROM ai_batches b WHERE b.batch_id = u.batch_id) RETURNING batch_id',
  ]);
  return rows.length;
}

function finalStatesList() {
  return AI_BATCH_FINAL_STATES.flatMap((state, index) =>
    index === 0 ? [param(state)] : [',', param(state)],
  );
}

function batchFromRow(row: Record<string, PgPrimitive>): AIBatch {
  return {
    batchId: String(row.batch_id),
    runId: String(row.run_id),
    actsAs: String(row.acts_as),
    realm: row.realm as RealmIdentifier,
    automationId: row.automation_id as RealmResourceIdentifier,
    model: String(row.model),
    requestCount: Number(row.request_count),
    estimatedUsd: Number(row.estimated_usd),
    runAIReservation: String(row.run_ai_reservation),
    reservedCredits:
      row.reserved_credits == null ? null : Number(row.reserved_credits),
    deadline: iso(row.deadline)!,
    expiresAt: iso(row.expires_at),
    state: String(row.state),
    stateReadAt: iso(row.state_read_at)!,
    submittedAt: iso(row.submitted_at)!,
    finalizedAt: iso(row.finalized_at),
    deadlineMissedAt: iso(row.deadline_missed_at),
    settleReadAt: iso(row.settle_read_at),
    settledAt: iso(row.settled_at),
    billedUsd: row.billed_usd == null ? null : Number(row.billed_usd),
    billedAtEstimate:
      row.billed_at_estimate == null ? null : Boolean(row.billed_at_estimate),
  };
}

function iso(value: PgPrimitive | undefined): string | null {
  if (value == null) {
    return null;
  }
  return new Date(value as string).toISOString();
}
