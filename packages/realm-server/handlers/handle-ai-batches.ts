import type Koa from 'koa';
import {
  automationRunForCall,
  endAutomationRunNotADirectWriter,
  runActsAsDirectWriter,
  getAIBatch,
  getAIBatchRequests,
  isFinalAIBatchState,
  isLateAIBatch,
  recordAIBatchFallback,
  listAIBatchesForRun,
  recordAIBatchReadByRun,
  reserveAutomationRunAICredits,
  isSessionRevoked,
  logger,
  recordAIBatch,
  recordAIBatchState,
  type AIBatch,
  type AIBatchFollowUpRead,
  type AIBatchRequest,
  type AutomationRun,
  type DBAdapter,
  type ReportRunChange,
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
import { outboundLogContext } from '../lib/proxy-forward.ts';
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
  callOpenRouterBatchAPI,
  openRouterBatchSubmitBody,
  openRouterBatchURL,
  readOpenRouterBatch,
} from '../lib/openrouter-batches.ts';
import { verifyRunToken } from '../lib/run-token.ts';
import { aiBatchSubmitsEnabled } from '../lib/ai-batch-submits-config.ts';
import { runTokenOf } from '@cardstack/runtime-common/run-token';
import { countRunCall } from '@cardstack/runtime-common/automation-run-limits';
import {
  readRunMilestones,
  RUN_MILESTONE_MAX_NAME_CHARS,
} from '@cardstack/runtime-common/automation-run-milestones';
import { BATCH_RUN_TRIGGER } from '@cardstack/runtime-common/automation-declaration';
import { logRunPlatformLine } from '@cardstack/runtime-common/automation-run-log';

const log = logger('ai-batches');

// The batch path: an automation run's submit and status calls to
// OpenRouter's Batch API, sent with the platform's OpenRouter key (ADR 030).
//
// Only a run token reaches it, from a running run that its token's attempt
// still owns, whose identity's sessions haven't been revoked since the token
// was minted. An interactive session is refused: someone waiting for an
// answer gains nothing from a batch. A Preview's submit is refused too: a
// Preview sends batched requests at the normal price (ADR 030 §1.1), and its
// minimum balance counts its AI once on that basis. A submit also needs the
// automation's payer to have turned on `batchedAI` when they switched it on
// or last resumed it (the automation row's caps snapshot); a status read
// doesn't, so a follow-up run can always read a batch that is already paid
// for.
//
// A submit is refused when the realm server turns batch submits off
// (`AI_BATCH_SUBMITS_ENABLED=false`, `aiBatchSubmitsEnabled`). A status read
// or a follow-up's read never is, so a batch already submitted can always be
// read.
//
// A submit records the batch's requests and the run milestone it starts,
// for its follow-up (`handleAIBatchFollowUp`).
//
// A run submits at most one batch, whichever attempt sends it.
//
// A batch counts each of its requests against the run's `resolveCalls` cap,
// as a plain `resolve` counts its one. A batch that would pass the cap ends
// the run at the cap, as a plain `resolve` past it does, and nothing is sent.
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
  // The run milestone the batch starts, which its follow-up enters again.
  milestone?: unknown;
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
  matrixServerName: string;
  // Told when a batch call ends its run: the run's person is no longer a
  // direct writer of its realm, or the batch passes the run's `resolveCalls`
  // cap.
  reportRunChange?: ReportRunChange;
  // Whether this server submits batches. `aiBatchSubmitsEnabled` when absent.
  submitsEnabled?: () => boolean;
}

export function handleSubmitAIBatch(args: AIBatchHandlerArgs) {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    let { dbAdapter, virtualNetwork } = args;
    let caller = await batchCaller(ctxt, args);
    if (!caller) {
      return;
    }
    let { run, automation, attempt } = caller;
    if (!(args.submitsEnabled ?? aiBatchSubmitsEnabled)()) {
      await sendResponseForForbiddenRequest(
        ctxt,
        "Batched AI isn't turned on on this realm server, so it submits no batches",
      );
      return;
    }
    if (run.dryRun) {
      await sendResponseForForbiddenRequest(
        ctxt,
        'A Preview sends its batched requests at the normal price, so it submits no batches',
      );
      return;
    }
    if (!automation.capsSnapshot.batchedAI) {
      await sendResponseForForbiddenRequest(
        ctxt,
        "This automation hasn't turned on batched AI, so its runs can't submit batches",
      );
      return;
    }
    // A run submits one batch, which gets one follow-up. The tab holds a
    // script to one call; this holds a run to one batch across its attempts,
    // so an attempt that takes over a run whose batch is already submitted
    // can't submit, and pay for, a second.
    if ((await listAIBatchesForRun(dbAdapter, run.id)).length > 0) {
      await sendResponseForError(
        ctxt,
        409,
        'Conflict',
        'This run has already submitted a batch, and a run submits one batch',
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
    let { model, deadlineSeconds, milestone, requests } = submit;

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
    let { reservationId, reservedCredits } = reserved;
    let release = () =>
      settleAutomationRunAIRequest(dbAdapter, {
        runId: run.id,
        reservationId,
        costInUsd: 0,
      });
    let counted = await countRunCall(
      dbAdapter,
      { runId: run.id, attempt, automationId: run.automationId },
      'resolveCalls',
      automation.capsSnapshot.resolveCalls,
      args.reportRunChange,
      requests.length,
    );
    if (!counted.ok) {
      await release();
      await sendResponseForForbiddenRequest(
        ctxt,
        `${counted.error.detail}: a batch of ${requests.length} requests counts ${requests.length} AI requests`,
      );
      return;
    }
    // What an operator needs to record a batch that may have been submitted
    // with no row (`/_grafana-record-ai-batch`). Every report of such a
    // submit carries the `ai-batch-submit` tag, whatever its title, so an
    // operator finds them all with one Sentry search.
    let unrecorded = {
      runId: run.id,
      actsAs: run.actsAs,
      realm: run.realm,
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
      Sentry.captureException(answer.error, {
        tags: { 'ai-batch-submit': 'outcome-unknown' },
        extra: unrecorded,
      });
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
      Sentry.captureMessage(message, {
        level: 'error',
        tags: { 'ai-batch-submit': 'outcome-unknown' },
        extra: unrecorded,
      });
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
      Sentry.captureMessage(message, {
        level: 'error',
        tags: { 'ai-batch-submit': 'outcome-unknown' },
        extra: unrecorded,
      });
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
        ...(milestone ? { milestone } : {}),
        requests,
        estimatedUsd: estimated.estimate.usd,
        runAIReservation: reservationId,
        reservedCredits,
        deadline,
        expiresAt: batch.expiresAt,
        state: batch.status,
      });
    } catch (error) {
      // The batch is submitted and will be charged to the platform, but
      // nothing records it to bill. Reported with everything needed to
      // record it.
      let message = `OpenRouter batch ${batch.id} for run ${run.id} (acting as ${run.actsAs}, estimated at ${estimated.estimate.usd} USD) was submitted but could not be recorded for billing`;
      log.error(message, error);
      Sentry.captureException(error, {
        tags: { 'ai-batch-submit': 'not-recorded' },
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
          finalizedAt: read.finalizedAt,
        });
        // A run that reads the batch still open at or after its deadline
        // sends the same requests at the normal price (ADR 030 §1.3), so the
        // batch is late from then on: its results are discarded rather than
        // used twice. It is still billed.
        let recorded = await recordAIBatchReadByRun(dbAdapter, batch.batchId);
        let results = (json as { results?: unknown }).results;
        if (recorded && isLateAIBatch(recorded) && results != null) {
          log.info(
            `batch ${batch.batchId} ended after a run read it still open past its deadline, at ${recorded.deadlineMissedAt}, so its results are discarded`,
          );
          text = JSON.stringify({ ...(json as object), results: null });
        }
      }
    }
    sendJson(ctxt, status, text);
  };
}

// A batch's follow-up reads its batch before its script runs (ADR 030 §1.3,
// §1.5). Only the batch's own follow-up run reads it this way: a run whose
// trigger is `batch` and whose slot is the batch's id. It answers an
// `AIBatchFollowUpRead`:
//
// - A batch OpenRouter reports completed, with its results, that no run has
//   found still open past its deadline: each request gets its result, by
//   its `customId`, as OpenRouter's chat completion for it or the error it
//   got.
// - Any other batch is late: it was still open, or failed, expired or was
//   canceled, or OpenRouter no longer holds it (`410`, 30 days after submit),
//   or couldn't be read. Each request carries the body the submit recorded,
//   which the follow-up sends at the normal price. A batch read still open is
//   recorded as late, so its results are never used, even once it ends.
//
// Each request also carries its body when the batch completed: the follow-up
// reads each result against the request's output schema, as `realm.resolve`
// reads its answer. The answer names the batch's milestone, and the
// milestones the submitting run's script planned from it on, so the
// follow-up carries on where the submitting run stopped.
export function handleAIBatchFollowUp(args: AIBatchHandlerArgs) {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    let { dbAdapter } = args;
    let caller = await batchCaller(ctxt, args);
    if (!caller) {
      return;
    }
    let { run } = caller;
    let batchId = String(ctxt.params.batchId ?? '');
    let batch = batchId ? await getAIBatch(dbAdapter, batchId) : undefined;
    // Another automation's batch reads as missing, so its existence isn't
    // disclosed.
    if (!batch || batch.automationId !== run.automationId) {
      await sendResponseForNotFound(ctxt, `There is no batch ${batchId}`);
      return;
    }
    if (run.trigger !== BATCH_RUN_TRIGGER || run.slot !== batch.batchId) {
      await sendResponseForForbiddenRequest(
        ctxt,
        `Only the follow-up run of batch ${batch.batchId} reads it for its results`,
      );
      return;
    }
    let [requests, read, submitting] = await Promise.all([
      getAIBatchRequests(dbAdapter, batch.batchId),
      readBatchResults(dbAdapter, batch),
      readRunMilestones(dbAdapter, batch.runId),
    ]);
    let current = (await getAIBatch(dbAdapter, batch.batchId)) ?? batch;
    let late = !read.results || isLateAIBatch(current);
    if (late && !isFinalAIBatchState(current.state)) {
      // Its results, once it ends, are never used: these requests are sent
      // at the normal price instead.
      await recordAIBatchFallback(dbAdapter, batch.batchId);
    }
    let milestone = batch.milestone ?? DEFAULT_BATCH_MILESTONE;
    let plan = submitting?.plan ?? [];
    let from = plan.indexOf(milestone);
    let answer: AIBatchFollowUpRead = {
      id: batch.batchId,
      deadline: batch.deadline,
      milestone,
      // The plan from the batch's milestone on, or, for a milestone the plan
      // doesn't name, the batch's milestone and what the plan had ahead.
      plan:
        plan.length === 0
          ? []
          : from >= 0
            ? plan.slice(from)
            : [milestone, ...(submitting?.ahead ?? [])],
      late,
      state: read.state,
      requests: followUpRequests(
        batch,
        requests,
        late ? undefined : read.results,
      ),
    };
    let count = answer.requests.length;
    await logRunPlatformLine(dbAdapter, run.id, {
      kind: 'trigger',
      level: late ? 'warn' : 'info',
      message: late
        ? `Batch ${batch.batchId} has no results to give (${describeLate(read.state, current)}), so this run sends its ${count} AI request${count === 1 ? '' : 's'} at the normal price`
        : `Batch ${batch.batchId} completed, and this run picks up its ${count} result${count === 1 ? '' : 's'}`,
      data: {
        trigger: BATCH_RUN_TRIGGER,
        slot: batch.batchId,
        late,
        state: read.state,
      },
    });
    sendJson(ctxt, 200, JSON.stringify(answer));
  };
}

// The run milestone a batch whose submit named none started: the automation
// surface's default (`DEFAULT_BATCH_MILESTONE` in host
// `lib/realm-runner/research.ts`).
const DEFAULT_BATCH_MILESTONE = 'batched AI';

// The batch's status as OpenRouter reports it now, recorded on its row, and
// its results when it completed with them. `gone` when OpenRouter no longer
// holds the batch; `unread` when it couldn't be read.
async function readBatchResults(
  dbAdapter: DBAdapter,
  batch: AIBatch,
): Promise<{ state: string; results?: unknown[] }> {
  let answer = await callOpenRouterBatchAPI(dbAdapter, {
    url: openRouterBatchURL(batch.batchId),
    method: 'GET',
  });
  if (answer.kind !== 'answered') {
    log.warn(
      `could not read batch ${batch.batchId} for its follow-up: ${answer.kind === 'no-key' ? 'no OpenRouter key for batches' : String((answer.error as Error)?.message ?? answer.error)}`,
    );
    return { state: 'unread' };
  }
  let { status, json } = answer;
  if (status === 404 || status === 410) {
    return { state: 'gone' };
  }
  let read =
    status >= 200 && status < 300 ? readOpenRouterBatch(json) : undefined;
  if (!read || read.id !== batch.batchId) {
    log.warn(
      `could not read batch ${batch.batchId} for its follow-up: OpenRouter answered ${status}`,
    );
    return { state: 'unread' };
  }
  await recordAIBatchState(dbAdapter, batch.batchId, {
    state: read.status,
    expiresAt: read.expiresAt,
    finalizedAt: read.finalizedAt,
  });
  let results = (json as { results?: unknown }).results;
  return read.status === 'completed' && Array.isArray(results)
    ? { state: read.status, results }
    : { state: read.status };
}

// Each of the batch's requests, in the order the script listed them, with its
// result when `results` is given. A request whose body is no longer held, or
// that the results don't answer, carries the error that says so.
function followUpRequests(
  batch: AIBatch,
  requests: AIBatchRequest[] | undefined,
  results: unknown[] | undefined,
): AIBatchFollowUpRead['requests'] {
  if (!requests) {
    return Array.from({ length: batch.requestCount }, () => ({
      error: `The platform no longer holds the requests of batch ${batch.batchId}, so this request has no answer`,
    }));
  }
  let byId = new Map<string, Record<string, any>>();
  for (let result of results ?? []) {
    let entry = result as Record<string, any> | null;
    if (entry && typeof entry.custom_id === 'string') {
      byId.set(entry.custom_id, entry);
    }
  }
  return requests.map(({ customId, body }) => {
    if (!results) {
      return { body };
    }
    let result = byId.get(customId);
    if (!result) {
      return { body, error: 'The batch has no answer for this request' };
    }
    if (result.error) {
      return {
        body,
        error: `OpenRouter failed this request in the batch: ${String(result.error.message ?? JSON.stringify(result.error))}`,
      };
    }
    let status = result.response?.status_code;
    let answer = result.response?.body;
    if (typeof status === 'number' && (status < 200 || status >= 300)) {
      return {
        body,
        error: `OpenRouter answered this request in the batch with ${status}${answer?.error?.message ? `: ${answer.error.message}` : ''}`,
      };
    }
    if (answer === undefined || answer === null) {
      return { body, error: 'The batch answered this request with no body' };
    }
    return { body, answer };
  });
}

// Why a late batch has no results to give, for the run's log.
function describeLate(state: string, batch: AIBatch): string {
  switch (state) {
    case 'gone':
      return 'OpenRouter no longer holds it';
    case 'unread':
      return "it couldn't be read from OpenRouter";
    case 'completed':
      return batch.deadlineMissedAt
        ? `a run found it still open past its deadline, at ${batch.deadlineMissedAt}`
        : 'OpenRouter gave no results for it';
    case 'failed':
    case 'expired':
    case 'cancelled':
      return `it ${state === 'cancelled' ? 'was canceled' : state}`;
    default:
      return `it is still ${state} past its deadline, ${batch.deadline}`;
  }
}

// The run a batch call comes from, and its automation, after checking that
// the call carries a run token whose identity's sessions weren't revoked
// since it was minted, that its run is still running and owned by the
// token's attempt, and that its identity is still a direct writer of the
// run's realm. Answers the refusal itself and returns undefined otherwise.
async function batchCaller(
  ctxt: Koa.Context,
  {
    dbAdapter,
    realmSecretSeed,
    virtualNetwork,
    matrixServerName,
    reportRunChange,
  }: AIBatchHandlerArgs,
): Promise<
  { run: AutomationRun; automation: AutomationRow; attempt: number } | undefined
> {
  let authorization = ctxt.req.headers['authorization'] ?? null;
  if (!authorization) {
    await sendResponseForUnauthorizedRequest(
      ctxt,
      'A batch call needs an automation run token',
    );
    return undefined;
  }
  let runToken = runTokenOf(authorization);
  if (!runToken) {
    await sendResponseForForbiddenRequest(
      ctxt,
      'Batched AI is only for automation runs: a batch call needs an automation run token',
    );
    return undefined;
  }
  let token = verifyRunToken(runToken, realmSecretSeed);
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
  if (
    !(await runActsAsDirectWriter(
      { dbAdapter, virtualNetwork, matrixServerName },
      run,
    ))
  ) {
    if (
      await endAutomationRunNotADirectWriter(dbAdapter, run.id, token.attempt)
    ) {
      await reportRunChange?.(run.id);
    }
    await sendResponseForForbiddenRequest(
      ctxt,
      "The person this run acts as is not a direct writer of the automation's workspace, so the run has ended",
    );
    return undefined;
  }
  let automation = await getAutomation(dbAdapter, run.automationId);
  if (!automation) {
    await sendResponseForForbiddenRequest(
      ctxt,
      "The run's automation isn't switched on, so its runs can't make batch calls",
    );
    return undefined;
  }
  return { run, automation, attempt: token.attempt };
}

// Reserves the batch on the run's AI spending cap, in one statement, at twice
// its requests' worst case at the model's listed price: once for the batch,
// and once for the normal-price requests it falls back to when it misses its
// deadline. Returns the reservation's id and the credits it holds, or answers
// the refusal itself and returns undefined when the batch would pass the cap
// or the run can no longer make AI requests.
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
): Promise<{ reservationId: string; reservedCredits: number } | undefined> {
  let credits = listedCredits * BATCHED_AI_RESERVE_FACTOR;
  let reservation = await reserveAutomationRunAICredits(
    dbAdapter,
    run.id,
    credits,
    aiCreditsCap,
  );
  switch (reservation.kind) {
    case 'reserved':
      return {
        reservationId: reservation.reservationId,
        reservedCredits: credits,
      };
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

async function readSubmit(ctxt: Koa.Context): Promise<
  | {
      model: string;
      deadlineSeconds: number;
      milestone: string | undefined;
      requests: BatchRequest[];
    }
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
  let { model, deadlineSeconds, milestone, requests } = submit;
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
  if (
    milestone !== undefined &&
    (typeof milestone !== 'string' ||
      !milestone.trim() ||
      milestone.length > RUN_MILESTONE_MAX_NAME_CHARS)
  ) {
    await sendResponseForBadRequest(
      ctxt,
      `milestone must be a name of 1 to ${RUN_MILESTONE_MAX_NAME_CHARS} characters`,
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
  return {
    model,
    deadlineSeconds,
    milestone: typeof milestone === 'string' ? milestone.trim() : undefined,
    requests: read,
  };
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
  request: { url: string; method: string; body?: string },
): Promise<OpenRouterAnswer> {
  let answer = await callOpenRouterBatchAPI(dbAdapter, request);
  switch (answer.kind) {
    case 'answered':
      return answer;
    case 'no-key':
      await sendResponseForError(
        ctxt,
        503,
        'Service Unavailable',
        'The realm server has no OpenRouter key for batches',
      );
      return { kind: 'not-sent' };
    case 'failed': {
      let { error, failure, sent, call } = answer;
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
        return sent ? { kind: 'unknown', error } : { kind: 'not-sent' };
      }
      // The caller reports it, with what it knows about the call.
      log.error(
        `Error in batch call${outboundLogContext(error, call)}:`,
        error,
      );
      await sendResponseForSystemError(
        ctxt,
        'An error occurred while calling the batch API',
      );
      return { kind: 'unknown', error };
    }
  }
}

function sendJson(ctxt: Koa.Context, status: number, text: string) {
  ctxt.status = status;
  ctxt.type = 'application/json';
  ctxt.body = text;
}
