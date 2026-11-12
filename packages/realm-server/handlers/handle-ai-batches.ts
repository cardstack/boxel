import type Koa from 'koa';
import {
  automationRunForCall,
  getAIBatch,
  logger,
  recordAIBatch,
  recordAIBatchState,
  type AutomationRun,
  type DBAdapter,
  type VirtualNetwork,
} from '@cardstack/runtime-common';
import { getAutomation } from '@cardstack/runtime-common/automations';
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
import { outboundFetch, sendContext } from '../lib/outbound/client.ts';
import { scrubError } from '../lib/outbound/scrub-error.ts';
import { CredentialScrubber } from '../lib/outbound/scrubber.ts';
import { currentPricing } from '../lib/pricing.ts';
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
// Only a run token reaches it, and only from a running run of an automation
// whose payer turned on `batchedAI` when they switched it on or last resumed
// it (the automation row's caps snapshot). An interactive session is refused:
// someone waiting for an answer gains nothing from a batch.
//
// A submit charges nothing. OpenRouter reports a batch's cost only once it
// ends, so the submit records the batch (its run, the person that run acts
// as, its request count, the most it can cost, its deadline and its status)
// for the settle job to bill. A batch can't be canceled, so a recorded batch
// is always billed.

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
    let { run } = caller;

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

    let deadline = new Date(Date.now() + deadlineSeconds * 1000);
    let answer = await sendToOpenRouter(ctxt, dbAdapter, {
      url: OPENROUTER_BATCHES_URL,
      method: 'POST',
      body: openRouterBatchSubmitBody({ model, requests }),
    });
    if (!answer) {
      return;
    }
    let { status, json, text } = answer;
    if (status < 200 || status >= 300) {
      // OpenRouter refused the batch (a 402 when the platform's OpenRouter
      // balance can't cover it, a 400 for a body it won't take): nothing was
      // submitted, so nothing is recorded.
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
      let message = `OpenRouter accepted a batch for run ${run.id} but its answer names no batch, so it can't be recorded for billing`;
      log.error(message);
      Sentry.captureMessage(message, 'error');
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
        deadline,
        expiresAt: batch.expiresAt,
        state: batch.status,
      });
    } catch (error) {
      // The batch is submitted and will be charged to the platform, but
      // nothing records it to bill. Reported so an operator bills it by hand.
      let message = `OpenRouter batch ${batch.id} for run ${run.id} (acting as ${run.actsAs}, estimated at ${estimated.estimate.usd} USD) was submitted but could not be recorded for billing`;
      log.error(message, error);
      Sentry.captureException(error, { extra: { batchId: batch.id } });
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
    if (!answer) {
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

// The run a batch call comes from, after checking that it carries a run
// token, that its run is still running, and that its automation turned on
// batched AI. Answers the refusal itself and returns undefined otherwise.
async function batchCaller(
  ctxt: Koa.Context,
  { dbAdapter, realmSecretSeed }: AIBatchHandlerArgs,
): Promise<{ run: AutomationRun } | undefined> {
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
  if (!automation?.capsSnapshot.batchedAI) {
    await sendResponseForForbiddenRequest(
      ctxt,
      "This automation hasn't turned on batched AI, so its runs can't make batch calls",
    );
    return undefined;
  }
  return { run };
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
// key, and reads the whole answer. Answers the failure itself and returns
// undefined when the call can't be made or fails.
async function sendToOpenRouter(
  ctxt: Koa.Context,
  dbAdapter: DBAdapter,
  { url, method, body }: { url: string; method: string; body?: string },
): Promise<{ status: number; json: unknown; text: string } | undefined> {
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
    return undefined;
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
    return { status: response.status, json, text };
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
      return undefined;
    }
    log.error(`Error in batch call${outboundLogContext(error, call)}:`, error);
    Sentry.captureException(error);
    await sendResponseForSystemError(
      ctxt,
      'An error occurred while calling the batch API',
    );
    return undefined;
  }
}

function sendJson(ctxt: Koa.Context, status: number, text: string) {
  ctxt.status = status;
  ctxt.type = 'application/json';
  ctxt.body = text;
}
