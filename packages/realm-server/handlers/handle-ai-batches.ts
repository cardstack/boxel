import type Koa from 'koa';
import {
  automationRunForCall,
  getAIBatch,
  reserveAutomationRunAICredits,
  isSessionRevoked,
  logger,
  recordAIBatch,
  recordAIBatchState,
  type AutomationRun,
  type DBAdapter,
  type VirtualNetwork,
} from '@cardstack/runtime-common';
import {
  getAutomation,
  type AutomationRow,
} from '@cardstack/runtime-common/automations';
import * as Sentry from '@sentry/node';
import {
  fetchRequestFromContext,
  sendResponseForBadRequest,
  sendResponseForError,
  sendResponseForForbiddenRequest,
  sendResponseForNotFound,
  sendResponseForSystemError,
  sendResponseForUnauthorizedRequest,
  sendResponseForUnprocessableEntity,
} from '../middleware/index.ts';
import { AllowedProxyDestinations } from '../lib/allowed-proxy-destinations.ts';
import {
  outboundFailureResponse,
  outboundLogContext,
  systemKeyCredential,
} from '../lib/proxy-forward.ts';
import {
  OutboundRefusedError,
  outboundFetch,
  sendContext,
} from '../lib/outbound/client.ts';
import { scrubError } from '../lib/outbound/scrub-error.ts';
import { CredentialScrubber } from '../lib/outbound/scrubber.ts';
import { currentPricing } from '../lib/pricing.ts';
import {
  BATCHED_AI_RESERVE_FACTOR,
  settleAutomationRunAIRequest,
} from '../lib/automation-ai-spending.ts';
import {
  estimateAIBatch,
  openRouterModelsRealmURL,
} from '../lib/ai-batch-estimate.ts';
import {
  MAX_AI_BATCH_DEADLINE_SECONDS,
  OPENROUTER_BATCHES_URL,
  openRouterBatchSubmitBody,
  openRouterBatchURL,
  readOpenRouterBatch,
} from '../lib/openrouter-batches.ts';
import { verifyRunToken } from '../lib/run-token.ts';
import { carriesRunToken } from '@cardstack/runtime-common/run-token';

const log = logger('ai-batches');

// The batch path: an automation run's submit and status calls to
// OpenRouter's Batch API, sent with the platform's OpenRouter key (ADR 030).
//
// Only a run token reaches it, from a running run that its token's attempt
// still owns, whose identity's sessions haven't been revoked since the token
// was minted. An interactive session is refused: someone waiting for an
// answer gains nothing from a batch. A submit also needs the automation's
// payer to have turned on `batchedAI` when they switched it on or last
// resumed it (the automation row's caps snapshot); a status read doesn't, so
// a follow-up run can always read a batch that is already paid for.
//
// A submit charges nothing. OpenRouter reports a batch's cost only once it
// ends, so the submit records the batch (its run, the person that run acts
// as, its request count, the most it can cost, its deadline and its status)
// for the settle job to bill. A batch can't be canceled, so a recorded batch
// is always billed. Before it is sent, the batch reserves twice its requests'
// worst case at the model's listed price on the run's AI spending cap, in
// one statement (ADR 030 §1.4), and a batch that would pass the cap is
// refused. The reservation is released when the batch isn't submitted, and
// otherwise held on the batch's row for the settle job to settle.

interface SubmitBody {
  model?: unknown;
  // How long the script waits for the results, in seconds.
  deadlineSeconds?: unknown;
  requests?: unknown;
}

interface BatchRequest {
  customId: string;
  body: Record<string, unknown>;
}

export interface AIBatchHandlerArgs {
  dbAdapter: DBAdapter;
  realmSecretSeed: string;
  virtualNetwork: VirtualNetwork;
}

export function handleSubmitAIBatch(args: AIBatchHandlerArgs) {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    let { dbAdapter, virtualNetwork } = args;
    let caller = await batchCaller(ctxt, args);
    if (!caller) {
      return;
    }
    let { run, automation } = caller;
    if (!automation.capsSnapshot.batchedAI) {
      await sendResponseForForbiddenRequest(
        ctxt,
        "This automation hasn't turned on batched AI, so its runs can't submit batches",
      );
      return;
    }

    if (!currentPricing()) {
      await sendResponseForError(
        ctxt,
        503,
        'Service Unavailable',
        'The realm server has no prices configured, so it submits no batches',
      );
      return;
    }

    let submit = await readSubmit(ctxt);
    if (!submit) {
      return;
    }
    let { model, deadlineSeconds, requests } = submit;

    let modelsRealmURL = openRouterModelsRealmURL(virtualNetwork);
    if (!modelsRealmURL) {
      await sendResponseForError(
        ctxt,
        503,
        'Service Unavailable',
        'The realm server has no model prices, so it submits no batches',
      );
      return;
    }
    let estimated = await estimateAIBatch(
      dbAdapter,
      modelsRealmURL,
      model,
      requests.map(({ body }) => JSON.stringify(body)),
    );
    if (!estimated.ok) {
      await sendResponseForUnprocessableEntity(ctxt, estimated.message);
      return;
    }

    let reserved = await reserveBatch(ctxt, dbAdapter, {
      run,
      aiCreditsCap: automation.capsSnapshot.aiCredits,
      listedCredits: estimated.listedCredits,
      requestCount: requests.length,
    });
    if (!reserved) {
      return;
    }
    let reservationId = reserved;
    let release = () =>
      settleAutomationRunAIRequest(dbAdapter, {
        runId: run.id,
        reservationId,
        costInUsd: 0,
      });
    // What an operator needs to bill a batch by hand when it may have been
    // submitted with no row recording it.
    let unrecorded = {
      runId: run.id,
      actsAs: run.actsAs,
      automationId: run.automationId,
      model,
      requestCount: requests.length,
      estimatedUsd: estimated.estimate.usd,
      runAIReservation: reservationId,
    };

    let deadline = new Date(Date.now() + deadlineSeconds * 1000);
    let answer = await sendToOpenRouter(ctxt, dbAdapter, {
      url: OPENROUTER_BATCHES_URL,
      method: 'POST',
      body: openRouterBatchSubmitBody({ model, requests }),
    });
    if (answer.kind === 'not-sent') {
      await release();
      return;
    }
    if (answer.kind === 'unknown') {
      // The submit went out and its outcome is unknown, so a batch may exist
      // that is paid for and recorded nowhere. The reservation stays held.
      let message = `batch submit outcome unknown for run ${run.id} (acting as ${run.actsAs}, ${requests.length} requests to ${model}, estimated at ${estimated.estimate.usd} USD): OpenRouter may have accepted a batch that nothing records`;
      log.error(message, answer.error);
      Sentry.captureException(answer.error, { extra: unrecorded });
      return;
    }
    let { status, json, text } = answer;
    if (status >= 500) {
      // A 5xx says only that something between here and OpenRouter stopped
      // waiting (a 502, a 504, or Cloudflare's 524 when OpenRouter takes too
      // long), not that no batch was created. The outcome is unknown, as for
      // a timeout, so the reservation stays held.
      let message = `batch submit outcome unknown for run ${run.id}: OpenRouter answered ${status}, so a batch may exist that nothing records`;
      log.error(message);
      Sentry.captureMessage(message, { level: 'error', extra: unrecorded });
      sendJson(ctxt, status, text);
      return;
    }
    if (status < 200 || status >= 300) {
      // OpenRouter refused the batch (a 402 when the platform's OpenRouter
      // balance can't cover it, a 400 for a body it won't take): nothing was
      // submitted, so nothing is recorded or reserved.
      await release();
      log.warn(
        `OpenRouter refused a batch for run ${run.id} with status ${status}`,
      );
      sendJson(ctxt, status, text);
      return;
    }
    let batch = readOpenRouterBatch(json);
    if (!batch) {
      // OpenRouter accepted something and answered with no batch id, so the
      // batch, if one exists, can't be recorded or billed.
      let message = `batch submit outcome unknown for run ${run.id}: OpenRouter accepted the submit but its answer names no batch, so it can't be recorded for billing`;
      log.error(message);
      Sentry.captureMessage(message, { level: 'error', extra: unrecorded });
      await sendResponseForSystemError(
        ctxt,
        'OpenRouter answered the batch submit with no batch',
      );
      return;
    }
    try {
      await recordAIBatch(dbAdapter, {
        batchId: batch.id,
        runId: run.id,
        actsAs: run.actsAs,
        realm: run.realm,
        automationId: run.automationId,
        model,
        requestCount: requests.length,
        estimatedUsd: estimated.estimate.usd,
        runAIReservation: reservationId,
        deadline,
        expiresAt: batch.expiresAt,
        state: batch.status,
      });
    } catch (error) {
      // The batch is submitted and will be charged to the platform, but
      // nothing records it to bill. Reported with everything needed to bill
      // it by hand.
      let message = `OpenRouter batch ${batch.id} for run ${run.id} (acting as ${run.actsAs}, estimated at ${estimated.estimate.usd} USD) was submitted but could not be recorded for billing`;
      log.error(message, error);
      Sentry.captureException(error, {
        extra: { batchId: batch.id, ...unrecorded },
      });
      await sendResponseForSystemError(
        ctxt,
        'The batch was submitted but could not be recorded',
      );
      return;
    }
    log.info(
      `run ${run.id} submitted batch ${batch.id}: ${requests.length} requests to ${model}, estimated at ${estimated.estimate.usd} USD priced as ${estimated.estimate.pricedAs}, deadline ${deadline.toISOString()}`,
    );
    sendJson(ctxt, status, text);
  };
}

export function handleAIBatchStatus(args: AIBatchHandlerArgs) {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    let { dbAdapter } = args;
    let caller = await batchCaller(ctxt, args);
    if (!caller) {
      return;
    }
    let { run } = caller;
    let batchId = String(ctxt.params.batchId ?? '');
    let batch = batchId ? await getAIBatch(dbAdapter, batchId) : undefined;
    // A run reads only its own automation's batches: the run that submitted
    // one, and the follow-up that picks up its results. Another automation's
    // batch reads as missing, so its existence isn't disclosed.
    if (!batch || batch.automationId !== run.automationId) {
      await sendResponseForNotFound(ctxt, `There is no batch ${batchId}`);
      return;
    }
    let answer = await sendToOpenRouter(ctxt, dbAdapter, {
      url: openRouterBatchURL(batch.batchId),
      method: 'GET',
    });
    if (answer.kind !== 'answered') {
      if (answer.kind === 'unknown') {
        Sentry.captureException(answer.error, {
          extra: { batchId: batch.batchId, runId: run.id },
        });
      }
      return;
    }
    let { status, json, text } = answer;
    if (status >= 200 && status < 300) {
      let read = readOpenRouterBatch(json);
      if (read && read.id === batch.batchId) {
        await recordAIBatchState(dbAdapter, batch.batchId, {
          state: read.status,
          expiresAt: read.expiresAt,
        });
      }
    }
    sendJson(ctxt, status, text);
  };
}

// The run a batch call comes from, and its automation, after checking that
// the call carries a run token whose identity's sessions weren't revoked
// since it was minted, and that its run is still running and owned by the
// token's attempt. Answers the refusal itself and returns undefined
// otherwise.
async function batchCaller(
  ctxt: Koa.Context,
  { dbAdapter, realmSecretSeed }: AIBatchHandlerArgs,
): Promise<{ run: AutomationRun; automation: AutomationRow } | undefined> {
  let authorization = ctxt.req.headers['authorization'] ?? null;
  if (!authorization) {
    await sendResponseForUnauthorizedRequest(
      ctxt,
      'A batch call needs an automation run token',
    );
    return undefined;
  }
  if (!carriesRunToken(authorization)) {
    await sendResponseForForbiddenRequest(
      ctxt,
      'Batched AI is only for automation runs: a batch call needs an automation run token',
    );
    return undefined;
  }
  let token = verifyRunToken(
    authorization.slice('Bearer '.length),
    realmSecretSeed,
  );
  if (!token) {
    await sendResponseForUnauthorizedRequest(
      ctxt,
      'The automation run token is invalid or has expired',
    );
    return undefined;
  }
  // As `Realm.handleAutomation` does: a person whose sessions were revoked
  // after the token was minted makes no more calls through it.
  if (await isSessionRevoked(dbAdapter, token.actsAs, token.iat)) {
    await sendResponseForUnauthorizedRequest(
      ctxt,
      'The automation run token has been revoked',
    );
    return undefined;
  }
  // The signature says only that this server minted the token; the run's
  // row says whether the run is still going and this attempt still owns it.
  let call = await automationRunForCall(dbAdapter, token.runId, token.attempt);
  if (!call.ok) {
    await sendResponseForForbiddenRequest(
      ctxt,
      call.reason === 'missing'
        ? 'There is no such run'
        : call.reason === 'superseded'
          ? 'Another attempt owns the run, so this token makes no more calls'
          : `The run is ${call.run?.state}, so it can't make batch calls`,
    );
    return undefined;
  }
  let { run } = call;
  let automation = await getAutomation(dbAdapter, run.automationId);
  if (!automation) {
    await sendResponseForForbiddenRequest(
      ctxt,
      "The run's automation isn't switched on, so its runs can't make batch calls",
    );
    return undefined;
  }
  return { run, automation };
}

// Reserves the batch on the run's AI spending cap, in one statement, at twice
// its requests' worst case at the model's listed price: once for the batch,
// and once for the normal-price requests it falls back to when it misses its
// deadline. Returns the reservation's id, or answers the refusal itself and
// returns undefined when the batch would pass the cap or the run can no
// longer make AI requests.
async function reserveBatch(
  ctxt: Koa.Context,
  dbAdapter: DBAdapter,
  {
    run,
    aiCreditsCap,
    listedCredits,
    requestCount,
  }: {
    run: AutomationRun;
    aiCreditsCap: number;
    listedCredits: number;
    requestCount: number;
  },
): Promise<string | undefined> {
  let credits = listedCredits * BATCHED_AI_RESERVE_FACTOR;
  let reservation = await reserveAutomationRunAICredits(
    dbAdapter,
    run.id,
    credits,
    aiCreditsCap,
  );
  switch (reservation.kind) {
    case 'reserved':
      return reservation.reservationId;
    case 'over-cap': {
      let { aiCreditsSpent, aiCreditsReserved } = reservation.run;
      await sendResponseForForbiddenRequest(
        ctxt,
        `This batch of ${requestCount} requests could cost up to ${formatCredits(credits)} credits (twice its most at the listed price, since it is batched). ` +
          `The run has spent ${formatCredits(aiCreditsSpent)} and holds ${formatCredits(aiCreditsReserved)} for requests in flight, ` +
          `against an AI spending cap of ${aiCreditsCap} credits`,
      );
      return undefined;
    }
    case 'not-running':
      await sendResponseForForbiddenRequest(
        ctxt,
        `The run is ${reservation.run.state}, so it can't make AI requests`,
      );
      return undefined;
    case 'missing':
      await sendResponseForForbiddenRequest(ctxt, 'There is no such run');
      return undefined;
  }
}

function formatCredits(credits: number): string {
  return Number(credits.toFixed(3)).toString();
}

async function readSubmit(
  ctxt: Koa.Context,
): Promise<
  | { model: string; deadlineSeconds: number; requests: BatchRequest[] }
  | undefined
> {
  let request = await fetchRequestFromContext(ctxt);
  let submit: SubmitBody;
  try {
    submit = JSON.parse(await request.text());
  } catch {
    await sendResponseForBadRequest(ctxt, 'Request body is not valid JSON');
    return undefined;
  }
  if (!submit || typeof submit !== 'object' || Array.isArray(submit)) {
    await sendResponseForBadRequest(ctxt, 'Request body must be a JSON object');
    return undefined;
  }
  let { model, deadlineSeconds, requests } = submit;
  if (typeof model !== 'string' || model.length === 0) {
    await sendResponseForBadRequest(ctxt, 'A batch must name its model');
    return undefined;
  }
  if (
    typeof deadlineSeconds !== 'number' ||
    !Number.isInteger(deadlineSeconds) ||
    deadlineSeconds < 1 ||
    deadlineSeconds > MAX_AI_BATCH_DEADLINE_SECONDS
  ) {
    await sendResponseForBadRequest(
      ctxt,
      `deadlineSeconds must be a whole number of seconds from 1 to ${MAX_AI_BATCH_DEADLINE_SECONDS} (24 hours)`,
    );
    return undefined;
  }
  if (!Array.isArray(requests) || requests.length === 0) {
    await sendResponseForBadRequest(
      ctxt,
      'A batch must hold a non-empty list of requests',
    );
    return undefined;
  }
  let customIds = new Set<string>();
  let read: BatchRequest[] = [];
  for (let [index, entry] of requests.entries()) {
    let customId = (entry as { customId?: unknown })?.customId;
    let body = (entry as { body?: unknown })?.body;
    if (typeof customId !== 'string' || customId.length === 0) {
      await sendResponseForBadRequest(
        ctxt,
        `Request ${index + 1} of the batch must have a customId`,
      );
      return undefined;
    }
    if (customIds.has(customId)) {
      await sendResponseForBadRequest(
        ctxt,
        `Request ${index + 1} of the batch repeats the customId ${customId}`,
      );
      return undefined;
    }
    customIds.add(customId);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      await sendResponseForBadRequest(
        ctxt,
        `Request ${index + 1} of the batch must have a body that is a JSON object`,
      );
      return undefined;
    }
    let requestBody = body as Record<string, unknown>;
    if (requestBody.model !== undefined && requestBody.model !== model) {
      await sendResponseForBadRequest(
        ctxt,
        `Request ${index + 1} of the batch names the model ${String(requestBody.model)}, but every request in a batch is sent to ${model}`,
      );
      return undefined;
    }
    // Each body names the model, so it is priced, and sent, as one request
    // to that model.
    read.push({ customId, body: { ...requestBody, model } });
  }
  return { model, deadlineSeconds, requests: read };
}

// Sends one call to OpenRouter's Batch API with the platform's OpenRouter
// key, and reads the whole answer. A call that was never sent (no key covers
// the URL, or the outbound guard refused it before sending) is `not-sent`,
// and its refusal is answered here. A call that went out and failed before
// its answer was read is `unknown`: OpenRouter may have acted on it. Either
// way the failure is answered here, and the caller reports an `unknown` one.
type OpenRouterAnswer =
  | { kind: 'answered'; status: number; json: unknown; text: string }
  | { kind: 'not-sent' }
  | { kind: 'unknown'; error: unknown };

async function sendToOpenRouter(
  ctxt: Koa.Context,
  dbAdapter: DBAdapter,
  { url, method, body }: { url: string; method: string; body?: string },
): Promise<OpenRouterAnswer> {
  let destination =
    await AllowedProxyDestinations.getInstance(dbAdapter).getDestinationConfig(
      url,
    );
  if (!destination) {
    await sendResponseForError(
      ctxt,
      503,
      'Service Unavailable',
      'The realm server has no OpenRouter key for batches',
    );
    return { kind: 'not-sent' };
  }
  let scrubber = new CredentialScrubber();
  let credential = systemKeyCredential(destination);
  let call = sendContext(credential.name, url);
  try {
    let response = await outboundFetch({
      url,
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body,
      sizePath: 'system-key',
      responseSizeCap: destination.responseSizeCap,
      destinationSetBy: 'platform',
      credential,
      scrubber,
    });
    let text = await response.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return { kind: 'answered', status: response.status, json, text };
  } catch (error) {
    scrubError(error, scrubber);
    let failure = outboundFailureResponse(error);
    if (failure) {
      log.warn(
        `Batch call stopped by the outbound guard: ${failure.message}${outboundLogContext(error, call)}`,
      );
      await sendResponseForError(
        ctxt,
        failure.status,
        failure.statusText,
        failure.message,
      );
      return error instanceof OutboundRefusedError
        ? { kind: 'not-sent' }
        : { kind: 'unknown', error };
    }
    // The caller reports it, with what it knows about the call.
    log.error(`Error in batch call${outboundLogContext(error, call)}:`, error);
    await sendResponseForSystemError(
      ctxt,
      'An error occurred while calling the batch API',
    );
    return { kind: 'unknown', error };
  }
}

function sendJson(ctxt: Koa.Context, status: number, text: string) {
  ctxt.status = status;
  ctxt.type = 'application/json';
  ctxt.body = text;
}
