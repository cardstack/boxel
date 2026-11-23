import type Koa from 'koa';
import {
  dismissUnrecordedAIBatch,
  getAIBatch,
  getAutomationRun,
  getUnrecordedAIBatch,
  logger,
  param,
  query,
  recordAIBatch,
  resolveRecordedAIBatches,
  writeOffAIBatch,
  SupportedMimeType,
  type DBAdapter,
  type RealmIdentifier,
  type RealmResourceIdentifier,
} from '@cardstack/runtime-common';
import { chargeAIBatch } from '@cardstack/billing/ai-billing';
import {
  sendResponseForBadRequest,
  sendResponseForError,
  sendResponseForNotFound,
} from '../middleware/index.ts';
import type { CreateRoutesArgs } from '../routes.ts';
import { currentPricing } from '../lib/pricing.ts';
import { MAX_AI_BATCH_DEADLINE_SECONDS } from '../lib/openrouter-batches.ts';

const log = logger('ai-batch-settle');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The operator's levers for the batches the settle job reports and can't
// finish on its own (the `pricing` skill's runbook). Each is a Grafana
// endpoint: the Automations dashboard's batch panels call them through the
// realm-server operator datasource, and an operator can call them with the
// Grafana secret.

// Bills a settled batch whose charge drew nothing: its payer's balance held
// nothing when the settle job billed it. Charges what the settle job billed,
// to the person its run acted as, exactly as the settle job does, so a batch
// is still charged once however often this is called. A payer whose balance
// still holds nothing is told so, and nothing is written.
export function handleBillAIBatch({
  dbAdapter,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    let batchId = requiredParam(ctxt, 'batch');
    if (!batchId) {
      await sendResponseForBadRequest(ctxt, 'batch param must be specified');
      return;
    }
    let batch = await getAIBatch(dbAdapter, batchId);
    if (!batch) {
      await sendResponseForNotFound(ctxt, `There is no batch ${batchId}`);
      return;
    }
    if (batch.settledAt === null || batch.billedUsd === null) {
      await sendConflict(
        ctxt,
        `Batch ${batchId} isn't settled: the settle job bills it once it ends`,
      );
      return;
    }
    let pricingVersion = currentPricing()?.version;
    let charged = await chargeAIBatch(dbAdapter, {
      payer: batch.actsAs,
      charge: {
        kind: 'batched_ai',
        realm: batch.realm,
        runId: batch.runId,
        batchId: batch.batchId,
        ...(pricingVersion ? { pricingVersion } : {}),
      },
      usd: batch.billedUsd,
      estimated: batch.billedAtEstimate === true,
    });
    log.info(
      `operator billed batch ${batchId}: ${batch.billedUsd} USD to ${batch.actsAs}${batch.billedAtEstimate ? ' at its estimate' : ''}; ${charged}`,
    );
    switch (charged) {
      case 'charged':
      case 'already-charged':
        sendJSON(ctxt, 200, {
          batch: batchId,
          result: charged,
          payer: batch.actsAs,
          usd: batch.billedUsd,
        });
        return;
      case 'nothing-to-charge':
        await sendConflict(
          ctxt,
          `Nothing was charged for batch ${batchId}: ${batch.actsAs}'s balance holds nothing, or its cost rounds to no credit`,
        );
        return;
      case 'no-payer':
        await sendConflict(
          ctxt,
          `Nothing was charged for batch ${batchId}: ${batch.actsAs} has no users row`,
        );
        return;
    }
  };
}

// Records that a settled batch whose charge drew nothing won't be billed, and
// why, so it leaves the batches still to bill. Its cost stays unrecovered,
// and the cost coverage report still lists it.
export function handleWriteOffAIBatch({
  dbAdapter,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    let batchId = requiredParam(ctxt, 'batch');
    let reason = requiredParam(ctxt, 'reason');
    if (!batchId || !reason) {
      await sendResponseForBadRequest(
        ctxt,
        'batch and reason params must be specified',
      );
      return;
    }
    let batch = await getAIBatch(dbAdapter, batchId);
    if (!batch) {
      await sendResponseForNotFound(ctxt, `There is no batch ${batchId}`);
      return;
    }
    if (batch.settledAt === null) {
      await sendConflict(
        ctxt,
        `Batch ${batchId} isn't settled: the settle job bills it once it ends`,
      );
      return;
    }
    if (await isAIBatchCharged(dbAdapter, batchId)) {
      await sendConflict(
        ctxt,
        `Batch ${batchId} is already charged, so there is nothing to write off`,
      );
      return;
    }
    let written = await writeOffAIBatch(dbAdapter, batchId, reason);
    if (!written) {
      await sendConflict(
        ctxt,
        `Batch ${batchId} was written off on ${batch.writtenOffAt}: ${batch.writeOffReason}`,
      );
      return;
    }
    log.info(
      `operator wrote off batch ${batchId} (${batch.billedUsd} USD to ${batch.actsAs}): ${written.writeOffReason}`,
    );
    sendJSON(ctxt, 200, {
      batch: batchId,
      writtenOffAt: written.writtenOffAt,
      reason: written.writeOffReason,
    });
  };
}

// Records a batch the settle job found in OpenRouter's list with no
// `ai_batches` row, from the Sentry event its submit sent when its outcome was
// unknown: the run, the estimate and the reservation it holds on the run's AI
// spending cap. The payer, realm and automation come from the run's row, or,
// when the row is gone with its realm, from params. The model, request count,
// status and submit time come from what OpenRouter listed. Once recorded, the
// settle job reads and bills the batch like any other, and the unrecorded row
// is resolved as `recorded`.
export function handleRecordAIBatch({
  dbAdapter,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    let batchId = requiredParam(ctxt, 'batch');
    let runId = requiredParam(ctxt, 'run');
    let estimateParam = requiredParam(ctxt, 'estimate');
    let reservation = requiredParam(ctxt, 'reservation');
    if (!batchId || !runId || !estimateParam || !reservation) {
      await sendResponseForBadRequest(
        ctxt,
        'batch, run, estimate and reservation params must be specified',
      );
      return;
    }
    let estimatedUsd = Number(estimateParam);
    if (!Number.isFinite(estimatedUsd) || estimatedUsd < 0) {
      await sendResponseForBadRequest(
        ctxt,
        `estimate must be a number of USD, 0 or more, not "${estimateParam}"`,
      );
      return;
    }
    let unrecorded = await getUnrecordedAIBatch(dbAdapter, batchId);
    if (!unrecorded) {
      await sendResponseForNotFound(
        ctxt,
        `There is no unrecorded batch ${batchId}`,
      );
      return;
    }
    if (unrecorded.resolvedAt !== null) {
      await sendConflict(
        ctxt,
        `Unrecorded batch ${batchId} was resolved on ${unrecorded.resolvedAt}: ${unrecorded.resolution}`,
      );
      return;
    }
    if (await getAIBatch(dbAdapter, batchId)) {
      await resolveRecordedAIBatches(dbAdapter);
      await sendConflict(ctxt, `Batch ${batchId} already has a row`);
      return;
    }
    let model = unrecorded.model ?? requiredParam(ctxt, 'model');
    let requestCount =
      unrecorded.requestCount ?? Number(requiredParam(ctxt, 'requests'));
    if (!model || !Number.isInteger(requestCount) || requestCount < 1) {
      await sendResponseForBadRequest(
        ctxt,
        `OpenRouter listed no model or request count for batch ${batchId}, so model and requests params must be specified`,
      );
      return;
    }

    if (!UUID.test(runId)) {
      await sendResponseForBadRequest(
        ctxt,
        `run must be an automation run id, not "${runId}"`,
      );
      return;
    }
    let payer: { actsAs: string; realm: string; automationId: string };
    let run = await getAutomationRun(dbAdapter, runId);
    if (run) {
      if (!(await runHoldsAIReservation(dbAdapter, runId, reservation))) {
        await sendResponseForBadRequest(
          ctxt,
          `Run ${runId} holds no AI reservation ${reservation}. Check the run and reservation against the Sentry event for this batch`,
        );
        return;
      }
      payer = {
        actsAs: run.actsAs,
        realm: run.realm,
        automationId: run.automationId,
      };
    } else {
      let actsAs = requiredParam(ctxt, 'acts_as');
      let realm = requiredParam(ctxt, 'realm');
      let automationId = requiredParam(ctxt, 'automation');
      if (!actsAs || !realm || !automationId) {
        await sendResponseForBadRequest(
          ctxt,
          `Run ${runId} has no row, so acts_as, realm and automation params must be specified`,
        );
        return;
      }
      payer = { actsAs, realm, automationId };
    }

    let submittedAt = unrecorded.createdAt ?? new Date();
    let batch = await recordAIBatch(dbAdapter, {
      batchId,
      runId,
      actsAs: payer.actsAs,
      realm: payer.realm as RealmIdentifier,
      automationId: payer.automationId as RealmResourceIdentifier,
      model,
      requestCount,
      estimatedUsd,
      runAIReservation: reservation,
      deadline: new Date(
        submittedAt.getTime() + MAX_AI_BATCH_DEADLINE_SECONDS * 1000,
      ),
      expiresAt: null,
      state: unrecorded.status ?? 'validating',
      submittedAt,
    });
    await resolveRecordedAIBatches(dbAdapter);
    log.info(
      `operator recorded batch ${batchId} for run ${runId}, billed to ${batch.actsAs} at up to ${batch.estimatedUsd} USD once it settles`,
    );
    sendJSON(ctxt, 200, {
      batch: batchId,
      run: batch.runId,
      payer: batch.actsAs,
      estimatedUsd: batch.estimatedUsd,
    });
  };
}

// Resolves a batch the settle job found with no `ai_batches` row that nothing
// should bill, with the operator's reason: most often a batch another
// environment that shares the OpenRouter workspace submitted, which that
// environment's own row bills.
export function handleDismissUnrecordedAIBatch({
  dbAdapter,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    let batchId = requiredParam(ctxt, 'batch');
    let reason = requiredParam(ctxt, 'reason');
    if (!batchId || !reason) {
      await sendResponseForBadRequest(
        ctxt,
        'batch and reason params must be specified',
      );
      return;
    }
    if (reason === 'recorded') {
      await sendResponseForBadRequest(
        ctxt,
        `"recorded" is how a recorded batch resolves; give the reason it needs no bill`,
      );
      return;
    }
    let dismissed = await dismissUnrecordedAIBatch(dbAdapter, batchId, reason);
    if (!dismissed) {
      let unrecorded = await getUnrecordedAIBatch(dbAdapter, batchId);
      if (!unrecorded) {
        await sendResponseForNotFound(
          ctxt,
          `There is no unrecorded batch ${batchId}`,
        );
      } else {
        await sendConflict(
          ctxt,
          `Unrecorded batch ${batchId} was resolved on ${unrecorded.resolvedAt}: ${unrecorded.resolution}`,
        );
      }
      return;
    }
    log.info(
      `operator dismissed unrecorded batch ${batchId}: ${dismissed.resolution}`,
    );
    sendJSON(ctxt, 200, {
      batch: batchId,
      resolvedAt: dismissed.resolvedAt,
      resolution: dismissed.resolution,
    });
  };
}

function requiredParam(ctxt: Koa.Context, name: string): string | undefined {
  let value = ctxt.URL.searchParams.get(name)?.trim();
  return value ? value : undefined;
}

async function isAIBatchCharged(
  dbAdapter: DBAdapter,
  batchId: string,
): Promise<boolean> {
  let rows = await query(dbAdapter, [
    "SELECT 1 FROM credits_ledger WHERE charge_kind = 'batched_ai' AND batch_id =",
    param(batchId),
    'LIMIT 1',
  ]);
  return rows.length > 0;
}

async function runHoldsAIReservation(
  dbAdapter: DBAdapter,
  runId: string,
  reservationId: string,
): Promise<boolean> {
  let rows = await query(dbAdapter, [
    'SELECT 1 FROM automation_runs WHERE id =',
    param(runId),
    'AND jsonb_exists(ai_reservations, CAST(',
    param(reservationId),
    'AS text))',
  ]);
  return rows.length > 0;
}

async function sendConflict(ctxt: Koa.Context, message: string) {
  await sendResponseForError(ctxt, 409, 'Conflict', message);
}

function sendJSON(ctxt: Koa.Context, status: number, body: unknown) {
  ctxt.status = status;
  ctxt.set('Content-Type', SupportedMimeType.JSON);
  ctxt.body = JSON.stringify(body);
}
