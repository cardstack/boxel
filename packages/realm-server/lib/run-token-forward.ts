import {
  automationRunForCall,
  isSessionRevoked,
  logger,
  type DBAdapter,
  type DefinitionLookup,
  type VirtualNetwork,
} from '@cardstack/runtime-common';
import {
  countRunCall,
  endRunAtCap,
  readRunDeclaration,
  type LimitedRun,
} from '@cardstack/runtime-common/automation-run-limits';
import {
  admitAutomationRunAIRequest,
  settleAutomationRunAIRequest,
} from './automation-ai-spending.ts';
import {
  openRouterModelPrice,
  openRouterModelsRealmURL,
} from './openrouter-model-price.ts';
import { verifyRunToken } from './run-token.ts';

const log = logger('request-forward');

// The one request an automation run forwards: a `resolve` call, a chat
// completion sent to OpenRouter with the platform's key.
export const OPENROUTER_CHAT_COMPLETIONS_URL =
  'https://openrouter.ai/api/v1/chat/completions';

// A run-token request to `_request-forward`, held to the run and its
// automation's declaration before it is sent (ADR 026 §1.3, ADR 029 §1.5):
//
// - the token verifies, its person's sessions weren't revoked after it was
//   minted, and the run is running and owned by the token's attempt;
// - the request is a chat completion to OpenRouter, not streamed: the only
//   request a run forwards is a `resolve` call;
// - its worst case is priced at the model's listed price and reserved against
//   the run's `aiCredits` cap (`admitAutomationRunAIRequest`);
// - it counts as one call against the run's `resolveCalls` cap.
//
// A call past either cap ends the run as an error, `hit-a-cap`, naming the
// cap. An admitted request must be settled exactly once with `settle`.
export interface RunForwardRefusal {
  status: 401 | 403 | 422 | 503;
  message: string;
}

export interface AdmittedRunForward {
  run: LimitedRun & { actsAs: string };
  // Settles the request's AI reservation: with the generation's cost in USD
  // once it is known, 0 when the request was never sent, or undefined when
  // its cost can't be learned, which spends the whole reservation.
  settle(costInUsd: number | undefined): Promise<void>;
}

export async function admitRunForward(
  {
    dbAdapter,
    definitionLookup,
    virtualNetwork,
    realmSecretSeed,
  }: {
    dbAdapter: DBAdapter;
    definitionLookup: DefinitionLookup;
    virtualNetwork: VirtualNetwork;
    realmSecretSeed: string;
  },
  {
    token,
    url,
    method,
    stream,
    multipart,
    body,
  }: {
    token: string;
    url: string;
    method: string;
    stream: boolean;
    multipart: boolean;
    // The request body exactly as it will be sent.
    body: string | undefined;
  },
): Promise<
  | { ok: true; admitted: AdmittedRunForward }
  | ({ ok: false } & RunForwardRefusal)
> {
  let refuse = (
    status: RunForwardRefusal['status'],
    message: string,
    why: string = message,
  ) => {
    log.warn(`run-token request forward to ${url} refused: ${why}`);
    return { ok: false as const, status, message };
  };
  let context = verifyRunToken(token, realmSecretSeed);
  if (!context) {
    return refuse(401, 'Invalid token', 'the run token did not verify');
  }
  if (await isSessionRevoked(dbAdapter, context.actsAs, context.iat)) {
    return refuse(
      401,
      'Session revoked',
      `the sessions of ${context.actsAs}, whom run ${context.runId} acts as, were revoked after the token was minted`,
    );
  }
  let call = await automationRunForCall(
    dbAdapter,
    context.runId,
    context.attempt,
  );
  if (!call.ok) {
    return refuse(
      401,
      'The automation run is not running',
      `run ${context.runId} attempt ${context.attempt}: ${call.reason}`,
    );
  }
  if (call.run.actsAs !== context.actsAs) {
    return refuse(
      401,
      'Invalid token',
      `run ${context.runId} acts as ${call.run.actsAs}, but the token names ${context.actsAs}`,
    );
  }
  let run = {
    runId: context.runId,
    attempt: context.attempt,
    automationId: call.run.automationId,
    actsAs: context.actsAs,
  };
  if (
    url !== OPENROUTER_CHAT_COMPLETIONS_URL ||
    method !== 'POST' ||
    stream ||
    multipart ||
    body === undefined
  ) {
    return refuse(
      403,
      'An automation run may forward only a chat completion request to OpenRouter, without streaming',
      `run ${run.runId} asked to forward ${method} ${url}${stream ? ' streamed' : ''}${multipart ? ' as multipart' : ''}`,
    );
  }
  let declaration = await readRunDeclaration({
    dbAdapter,
    definitionLookup,
    virtualNetwork,
    automationId: run.automationId,
  });
  if (!declaration.ok) {
    return refuse(
      403,
      "The automation's declaration can't be read, so its run may make no AI request",
      `run ${run.runId}: ${declaration.message}`,
    );
  }
  let { caps } = declaration.declaration;
  let model = modelOf(body);
  let modelsRealmURL = openRouterModelsRealmURL(virtualNetwork);
  if (!modelsRealmURL) {
    return refuse(
      503,
      'The realm server has no model prices, so it forwards no AI request for an automation run',
    );
  }
  let price = model
    ? await openRouterModelPrice(dbAdapter, modelsRealmURL, model)
    : undefined;
  if (!price) {
    return refuse(
      422,
      model
        ? `Boxel has no listed price for the model ${model}, so an automation run can't send a request to it`
        : 'The request names no model',
    );
  }
  let admission = await admitAutomationRunAIRequest(dbAdapter, {
    runId: run.runId,
    aiCreditsCap: caps.aiCredits,
    body,
    price,
  });
  if (admission.kind === 'refused') {
    switch (admission.reason) {
      case 'over-cap':
        await endRunAtCap(dbAdapter, run, 'aiCredits');
        return refuse(
          403,
          `The automation run hit its aiCredits cap, so the run has ended. ${admission.message}`,
          `run ${run.runId}: ${admission.message}`,
        );
      case 'run-not-running':
      case 'missing-run':
        return refuse(401, 'The automation run is not running');
      default:
        return refuse(422, admission.message);
    }
  }
  let settled = false;
  let settle = async (costInUsd: number | undefined) => {
    if (settled) {
      return;
    }
    settled = true;
    await settleAutomationRunAIRequest(dbAdapter, {
      runId: run.runId,
      reservationId: admission.reservationId,
      costInUsd,
    });
  };
  let counted = await countRunCall(
    dbAdapter,
    run,
    'resolveCalls',
    caps.resolveCalls,
  );
  if (!counted.ok) {
    await settle(0);
    return refuse(
      counted.error.status === 401 ? 401 : 403,
      counted.error.detail,
      `run ${run.runId}: ${counted.error.detail}`,
    );
  }
  return { ok: true, admitted: { run, settle } };
}

function modelOf(body: string): string | undefined {
  try {
    let model = JSON.parse(body)?.model;
    return typeof model === 'string' ? model : undefined;
  } catch {
    return undefined;
  }
}
