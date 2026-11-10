import { CREDITS_PER_USD } from '@cardstack/runtime-common';

import type { TokenUsage } from '@cardstack/base/matrix-event';

// "16,794 in (12,032 cached) · 164 out · $0.0421" — the cached and cost parts
// appear only when the provider reported them.
export function formatTokenUsage(usage: TokenUsage): string {
  let format = (count: number | undefined) =>
    count == null ? '?' : count.toLocaleString();
  let input = `${format(usage.promptTokens)} in`;
  if (usage.cachedTokens != null) {
    input += ` (${format(usage.cachedTokens)} cached)`;
  }
  let parts = [input, `${format(usage.completionTokens)} out`];
  if (usage.costUsd != null) {
    parts.push(`$${usage.costUsd.toFixed(4)}`);
  }
  return parts.join(' · ');
}

// Boxel credits for a model cost, as the billing ledger rounds them.
export function creditsForCost(costUsd: number): number {
  return Math.round(costUsd * CREDITS_PER_USD);
}

// A turn counts toward a session's totals when its usage has token counts,
// the same rule as the per-answer line: a usage without them shows nothing
// there, so it must not add a turn to a total either.
export function isCountedTurn(
  usage: TokenUsage | undefined,
): usage is TokenUsage {
  return Boolean(
    usage && (usage.promptTokens != null || usage.completionTokens != null),
  );
}

// A session's usage so far: how many turns counted, and their summed token
// counts. Input is summed rather than read off the last turn because each
// turn re-sends the whole conversation, so the sum is what the provider
// billed. The cached and cost figures are totals only when every counted turn
// reported them: a partial sum would read as the whole bill, so they are left
// out otherwise.
export function sessionUsage(usages: Iterable<TokenUsage | undefined>): {
  turns: number;
  promptTokens: number;
  completionTokens: number;
  cachedTokens?: number;
  costUsd?: number;
} {
  let turns = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let cachedTokens = 0;
  let turnsWithCached = 0;
  let costUsd = 0;
  let turnsWithCost = 0;
  for (let usage of usages) {
    if (!isCountedTurn(usage)) {
      continue;
    }
    turns++;
    promptTokens += usage.promptTokens ?? 0;
    completionTokens += usage.completionTokens ?? 0;
    if (usage.cachedTokens != null) {
      cachedTokens += usage.cachedTokens;
      turnsWithCached++;
    }
    if (usage.costUsd != null) {
      costUsd += usage.costUsd;
      turnsWithCost++;
    }
  }
  return {
    turns,
    promptTokens,
    completionTokens,
    ...(turnsWithCached === turns ? { cachedTokens } : {}),
    ...(turnsWithCost === turns ? { costUsd } : {}),
  };
}

// "12 credits", "1,204 credits", "<1 credit": what a turn or a session
// cost the account, in the unit the account is billed in.
export function formatCredits(costUsd: number): string {
  let credits = creditsForCost(costUsd);
  if (credits < 1) {
    return '<1 credit';
  }
  return `${credits.toLocaleString()} ${credits === 1 ? 'credit' : 'credits'}`;
}
