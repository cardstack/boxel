// The batch record: one `ai_batches` row per batch of AI requests an
// automation run submits to OpenRouter's Batch API (ADR 030). Submitting a
// batch charges nothing, because OpenRouter reports a batch's cost only once
// it ends. A batch can't be canceled, so every batch is billed later, from its
// row, to the person its run acted as.

import type { DBAdapter } from './db.ts';
import { param, query } from './expression.ts';
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
  // How long the submitting script waits for the results.
  deadline: string;
  // When OpenRouter says its provider stops working on the batch, if it
  // gives a time.
  expiresAt: string | null;
  // OpenRouter's status for the batch as last read, and when.
  state: string;
  stateReadAt: string;
  submittedAt: string;
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
  deadline: Date;
  expiresAt: Date | null;
  state: string;
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
  let [created] = await query(dbAdapter, [
    'INSERT INTO ai_batches (batch_id, run_id, acts_as, realm, automation_id, model, request_count, estimated_usd, run_ai_reservation, deadline, expires_at, state) VALUES (',
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
// it. Returns the batch as recorded, or undefined when there is no such
// batch.
export async function recordAIBatchState(
  dbAdapter: DBAdapter,
  batchId: string,
  { state, expiresAt }: { state: string; expiresAt?: Date | null },
): Promise<AIBatch | undefined> {
  let [row] = await query(dbAdapter, [
    'UPDATE ai_batches SET state = CASE WHEN state IN (',
    ...finalStatesList(),
    ') THEN state ELSE',
    param(state),
    'END, expires_at = COALESCE(',
    param(expiresAt ? expiresAt.toISOString() : null),
    ', expires_at), state_read_at = now() WHERE batch_id =',
    param(batchId),
    'RETURNING *',
  ]);
  return row ? batchFromRow(row) : undefined;
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
    deadline: iso(row.deadline)!,
    expiresAt: iso(row.expires_at),
    state: String(row.state),
    stateReadAt: iso(row.state_read_at)!,
    submittedAt: iso(row.submitted_at)!,
  };
}

function iso(value: PgPrimitive | undefined): string | null {
  if (value == null) {
    return null;
  }
  return new Date(value as string).toISOString();
}
