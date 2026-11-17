import {
  CREDITS_PER_USD,
  reserveAutomationRunAICredits,
  settleAutomationRunAICredits,
  type DBAdapter,
} from '@cardstack/runtime-common';
import {
  aiRequestCostCeiling,
  type AIModelPrice,
  type AIRequestCostCeiling,
  type AIRequestCostRefusal,
} from '@cardstack/runtime-common/automation-ai-cost';

// A run's AI spending cap, enforced before each AI request is sent
// (ADR 029 §1.5). The server prices the request's worst case (its input and
// its output-token limit at the model's listed price, `aiRequestCostCeiling`)
// and reserves it on the run row against the automation's `aiCredits` cap.
// The reservation counts against the cap until the request's actual cost
// replaces it, so requests in flight at once can't between them pass the cap.
//
// A batched request reserves twice its worst case (ADR 030 §1.4): once for
// the batch and once for the normal-price request it falls back to when the
// batch misses its deadline. The factor bounds spending; the charge is still
// what each was actually billed.
export const BATCHED_AI_RESERVE_FACTOR = 2;

// A request that's admitted must be settled exactly once, whatever happens
// to it: with its cost once the AI provider reports it, with 0 when it was
// never sent, or with no cost when the cost can't be learned, which settles
// it at the most it could have cost.

export type AutomationRunAIAdmission =
  | {
      kind: 'admitted';
      // The reservation to settle with `settleAutomationRunAIRequest`, and
      // the credits it holds.
      reservationId: string;
      reservedCredits: number;
      ceiling: AIRequestCostCeiling;
    }
  | {
      kind: 'refused';
      // `over-cap`: the run's AI spending plus this request's worst case
      // would pass the cap. An `AIRequestCostRefusal`: the request's worst
      // case can't be priced (`aiRequestCostCeiling`). `run-not-running` and
      // `missing-run`: the run can't make requests.
      reason:
        | 'over-cap'
        | AIRequestCostRefusal
        | 'run-not-running'
        | 'missing-run';
      message: string;
    };

export async function admitAutomationRunAIRequest(
  dbAdapter: DBAdapter,
  {
    runId,
    attempt,
    aiCreditsCap,
    body,
    price,
    batched = false,
  }: {
    runId: string;
    // The attempt the request was admitted for. A run a retry has taken over
    // from it refuses the request.
    attempt?: number;
    // The automation's `aiCredits` cap.
    aiCreditsCap: number;
    // The request body as it will be sent.
    body: string;
    price: AIModelPrice;
    // Sent as part of a batch (the automation's `batchedAI`).
    batched?: boolean;
  },
): Promise<AutomationRunAIAdmission> {
  let priced = aiRequestCostCeiling(body, price);
  if (!priced.ok) {
    return { kind: 'refused', reason: priced.reason, message: priced.message };
  }
  let { ceiling } = priced;
  let credits = batched
    ? ceiling.credits * BATCHED_AI_RESERVE_FACTOR
    : ceiling.credits;
  let reservation = await reserveAutomationRunAICredits(
    dbAdapter,
    runId,
    credits,
    aiCreditsCap,
    attempt !== undefined ? { attempt } : {},
  );
  switch (reservation.kind) {
    case 'reserved':
      return {
        kind: 'admitted',
        reservationId: reservation.reservationId,
        reservedCredits: credits,
        ceiling,
      };
    case 'over-cap': {
      let { aiCreditsSpent, aiCreditsReserved } = reservation.run;
      return {
        kind: 'refused',
        reason: 'over-cap',
        message:
          `This AI request could cost up to ${formatCredits(credits)} credits${batched ? ' (twice its most, since it is batched)' : ''}. ` +
          `The run has spent ${formatCredits(aiCreditsSpent)} and holds ` +
          `${formatCredits(aiCreditsReserved)} for requests in flight, ` +
          `against an AI spending cap of ${aiCreditsCap} credits`,
      };
    }
    case 'not-running':
      return {
        kind: 'refused',
        reason: 'run-not-running',
        message:
          reservation.run.state === 'running'
            ? "Another attempt has taken the run over, so this one can't make AI requests"
            : `The run is ${reservation.run.state}, so it can't make AI requests`,
      };
    case 'missing':
      return {
        kind: 'refused',
        reason: 'missing-run',
        message: 'There is no such run',
      };
  }
}

// Settles an admitted request: releases its reservation and adds what it
// cost, in USD as the AI provider reports it, to the run's AI spending. Pass
// `costInUsd: 0` for a request that was never sent, and leave it undefined
// when the cost can't be learned, which spends the whole reservation. Returns
// false when the reservation was already settled, which changes nothing.
export async function settleAutomationRunAIRequest(
  dbAdapter: DBAdapter,
  {
    runId,
    reservationId,
    costInUsd,
  }: { runId: string; reservationId: string; costInUsd: number | undefined },
): Promise<boolean> {
  return await settleAutomationRunAICredits(
    dbAdapter,
    runId,
    reservationId,
    costInUsd === undefined ? undefined : costInUsd * CREDITS_PER_USD,
  );
}

function formatCredits(credits: number): string {
  return Number(credits.toFixed(3)).toString();
}
