import {
  isFinalAIBatchState,
  listUnsettledAIBatches,
  logger,
  recordAIBatchSettled,
  recordAIBatchSettleRead,
  recordAIBatchState,
  recordUnrecordedAIBatches,
  resolveRecordedAIBatches,
  type AIBatch,
  type AIBatchSettlement,
  type AIBatchSettlementResult,
  type DBAdapter,
  type UnrecordedAIBatch,
} from '@cardstack/runtime-common';
import {
  chargeAIBatch,
  type AIBatchChargeResult,
} from '@cardstack/billing/ai-billing';
import * as Sentry from '@sentry/node';
import { outboundLogContext } from './proxy-forward.ts';
import { settleAutomationRunAIRequest } from './automation-ai-spending.ts';
import {
  callOpenRouterBatchAPI,
  openRouterBatchListURL,
  openRouterBatchURL,
  readOpenRouterBatch,
  readOpenRouterBatchList,
  type OpenRouterBatch,
  type OpenRouterBatchCall,
} from './openrouter-batches.ts';

const log = logger('ai-batch-settle');

// The most unsettled batches one pass reads. The rest wait for the next pass,
// the ones read longest ago first.
const MAX_BATCHES_PER_PASS = 500;

// How far back a pass looks in OpenRouter's batch list for batches with no
// row. Twice the 24 hours a batch can run, so a day of missed passes still
// finds every batch submitted in it.
const RECONCILE_WINDOW_MS = 48 * 60 * 60 * 1000;

// How old a listed batch must be before it counts as unrecorded: three times
// the longest a submit waits for OpenRouter's answer, after which it records
// the batch at once. A row that lands later all the same resolves the
// batch's `unrecorded_ai_batches` row on the next pass.
const RECONCILE_GRACE_MS = 30 * 60 * 1000;

// The batch settle job (ADR 030 §1.4). Each pass:
//
// 1. Reads every unsettled batch from OpenRouter, records its status, and
//    settles each one that has ended. Settling bills the batch once, to the
//    person its run acted as, at the cost OpenRouter reported, or at the
//    estimate made at submit when OpenRouter reported none, as a
//    `batched_ai` charge naming its run and batch. It then settles the
//    batch's reservation on the run's AI spending cap with what the batch was
//    billed, and records the batch as settled. Each step is safe to repeat,
//    so a pass that stops partway is finished by the next one without
//    billing twice.
// 2. Lists every batch OpenRouter has accepted in the last 48 hours and
//    records any with no `ai_batches` row as unrecorded: a batch the platform
//    may pay for that nothing bills. Each is reported to Sentry once.
//
// `onProgress` is called after each batch and each page of the list, so the
// job can tell the queue it is still making progress.
//
// A batch OpenRouter no longer has results for (a `410`, 30 days after it
// was submitted) is settled at its estimate. A batch OpenRouter doesn't know
// (`404`), or one it can't answer for, stays unsettled and is read again by
// the next pass.
export function aiBatchSettlementFor(dbAdapter: DBAdapter): AIBatchSettlement {
  return {
    settle: (opts) => settleAIBatches(dbAdapter, opts),
  };
}

export async function settleAIBatches(
  dbAdapter: DBAdapter,
  {
    now = new Date(),
    onProgress = () => {},
  }: { now?: Date; onProgress?: () => void } = {},
): Promise<AIBatchSettlementResult> {
  let result: AIBatchSettlementResult = {
    settled: 0,
    open: 0,
    failed: 0,
    unrecorded: 0,
  };
  let batches = await listUnsettledAIBatches(dbAdapter, {
    limit: MAX_BATCHES_PER_PASS,
  });
  for (let batch of batches) {
    try {
      let outcome = await settleAIBatch(dbAdapter, batch);
      result[outcome]++;
    } catch (error) {
      result.failed++;
      log.error(`could not settle batch ${batch.batchId}:`, error);
      Sentry.captureException(error, { extra: { batchId: batch.batchId } });
    }
    onProgress();
  }
  try {
    result.unrecorded = await reconcileOpenRouterBatches(
      dbAdapter,
      now,
      onProgress,
    );
  } catch (error) {
    log.error(`could not reconcile OpenRouter's batch list:`, error);
    Sentry.captureException(error);
  }
  return result;
}

async function settleAIBatch(
  dbAdapter: DBAdapter,
  batch: AIBatch,
): Promise<'settled' | 'open' | 'failed'> {
  await recordAIBatchSettleRead(dbAdapter, batch.batchId);
  let answer = await callOpenRouterBatchAPI(dbAdapter, {
    url: openRouterBatchURL(batch.batchId),
    method: 'GET',
  });
  if (answer.kind !== 'answered') {
    log.warn(
      `could not read batch ${batch.batchId} from OpenRouter: ${describeUnanswered(answer)}`,
    );
    return 'failed';
  }
  let { status, json } = answer;
  if (status === 410) {
    // OpenRouter deletes a batch's results 30 days after it was submitted,
    // long after it ended. What it cost is no longer readable, so it is
    // billed at its estimate.
    await settle(dbAdapter, batch, undefined);
    return 'settled';
  }
  // A 402 answers with the batch when the platform's OpenRouter balance
  // can't cover the cost it finalized at; the batch has still ended.
  let read =
    (status >= 200 && status < 300) || status === 402
      ? readOpenRouterBatch(json)
      : undefined;
  if (!read || read.id !== batch.batchId) {
    let message = `OpenRouter answered ${status} for batch ${batch.batchId}${read ? ` with batch ${read.id}` : ''}, so it stays unsettled`;
    if (status === 404) {
      // A batch the platform recorded and OpenRouter doesn't know. The
      // unsettled batch alert finds it if it stays this way.
      log.error(message);
    } else {
      log.warn(message);
    }
    return 'failed';
  }
  if (status === 402) {
    log.error(
      `OpenRouter withholds batch ${batch.batchId}'s results: its cost exceeds the platform's OpenRouter balance`,
    );
  }
  let recorded = await recordAIBatchState(dbAdapter, batch.batchId, {
    state: read.status,
    expiresAt: read.expiresAt,
    finalizedAt: read.finalizedAt,
  });
  if (!recorded || !isFinalAIBatchState(recorded.state)) {
    return 'open';
  }
  if (status === 402 && read.costUsd === null) {
    // The batch ended and OpenRouter will report its cost once the balance
    // is topped up, so it isn't billed at the estimate yet.
    return 'open';
  }
  await settle(dbAdapter, recorded, read.costUsd ?? undefined);
  return 'settled';
}

// Bills a batch that has ended: `reportedUsd` when OpenRouter reported a
// cost, otherwise the estimate made at submit.
async function settle(
  dbAdapter: DBAdapter,
  batch: AIBatch,
  reportedUsd: number | undefined,
) {
  let estimated = reportedUsd === undefined;
  let usd = reportedUsd ?? batch.estimatedUsd;
  let charged = await chargeAIBatch(dbAdapter, {
    payer: batch.actsAs,
    charge: {
      kind: 'batched_ai',
      realm: batch.realm,
      runId: batch.runId,
      batchId: batch.batchId,
    },
    usd,
    estimated,
  });
  if (charged === 'no-payer') {
    let message = `batch ${batch.batchId} is billed to ${batch.actsAs}, who has no users row, so its ${usd} USD is not charged`;
    log.error(message);
    Sentry.captureMessage(message, {
      level: 'error',
      extra: { batchId: batch.batchId, runId: batch.runId, usd },
    });
  }
  // The run's row may be gone with its realm; settling then changes nothing.
  await settleAutomationRunAIRequest(dbAdapter, {
    runId: batch.runId,
    reservationId: batch.runAIReservation,
    costInUsd: usd,
  });
  await recordAIBatchSettled(dbAdapter, batch.batchId, { usd, estimated });
  log.info(
    `settled batch ${batch.batchId} of run ${batch.runId} (${batch.state}): billed ${usd} USD to ${batch.actsAs}${estimated ? ' at its estimate, since OpenRouter reported no cost' : ''}; ${describeCharge(charged)}`,
  );
}

// Records the batches OpenRouter accepted in the reconcile window that have
// no `ai_batches` row, and reports each the first time it is found. Returns
// how many were found this pass.
async function reconcileOpenRouterBatches(
  dbAdapter: DBAdapter,
  now: Date,
  onProgress: () => void,
): Promise<number> {
  let resolved = await resolveRecordedAIBatches(dbAdapter);
  if (resolved > 0) {
    log.info(
      `${resolved} unrecorded batch(es) have an ai_batches row after all, so they are resolved`,
    );
  }
  let createdAfter = new Date(now.getTime() - RECONCILE_WINDOW_MS);
  let createdBefore = now.getTime() - RECONCILE_GRACE_MS;
  let found: UnrecordedAIBatch[] = [];
  let after: string | undefined;
  let pagesRead = new Set<string>();
  // The list is bounded by `created_after`, so it ends; a cursor OpenRouter
  // repeats ends it too, rather than reading the same page forever.
  for (;;) {
    let answer = await callOpenRouterBatchAPI(dbAdapter, {
      url: openRouterBatchListURL({ createdAfter, after }),
      method: 'GET',
    });
    if (answer.kind !== 'answered') {
      log.warn(
        `could not list OpenRouter's batches: ${describeUnanswered(answer)}`,
      );
      break;
    }
    let list =
      answer.status >= 200 && answer.status < 300
        ? readOpenRouterBatchList(answer.json)
        : undefined;
    if (!list) {
      log.warn(
        `could not list OpenRouter's batches: OpenRouter answered ${answer.status}`,
      );
      break;
    }
    found.push(
      ...(await recordUnrecordedAIBatches(
        dbAdapter,
        list.batches
          .filter(
            (batch) =>
              batch.createdAt && batch.createdAt.getTime() <= createdBefore,
          )
          .map(unrecorded),
      )),
    );
    onProgress();
    if (!list.hasMore || !list.lastId || pagesRead.has(list.lastId)) {
      break;
    }
    pagesRead.add(list.lastId);
    after = list.lastId;
  }
  for (let batch of found) {
    let message = `OpenRouter batch ${batch.batchId} has no ai_batches row, so nothing bills it`;
    log.error(
      `${message} (${batch.requestCount ?? 'unknown'} requests to ${batch.model ?? 'an unknown model'}, created ${batch.createdAt?.toISOString() ?? 'at an unknown time'}, status ${batch.status ?? 'unknown'}, cost ${batch.costUsd ?? 'not reported'})`,
    );
    Sentry.captureMessage(message, {
      level: 'error',
      extra: {
        batchId: batch.batchId,
        model: batch.model,
        requestCount: batch.requestCount,
        createdAt: batch.createdAt?.toISOString(),
        status: batch.status,
        costUsd: batch.costUsd,
      },
    });
  }
  return found.length;
}

function unrecorded(batch: OpenRouterBatch): UnrecordedAIBatch {
  return {
    batchId: batch.id,
    model: batch.model,
    status: batch.status,
    requestCount: batch.total,
    costUsd: batch.costUsd,
    createdAt: batch.createdAt,
  };
}

function describeUnanswered(
  answer: Exclude<OpenRouterBatchCall, { kind: 'answered' }>,
): string {
  if (answer.kind === 'no-key') {
    return 'no system key covers the batches URL';
  }
  return `${answer.failure?.message ?? String(answer.error)}${outboundLogContext(answer.error, answer.call)}`;
}

function describeCharge(charged: AIBatchChargeResult): string {
  switch (charged) {
    case 'charged':
      return 'charged';
    case 'already-charged':
      return 'already charged';
    case 'nothing-to-charge':
      return "nothing charged: the payer's balance held nothing, or the cost rounds to no credit";
    case 'no-payer':
      return 'nothing charged: no payer';
  }
}
