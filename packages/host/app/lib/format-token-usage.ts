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

// What a session has cost so far: the counted turns, and their summed cost
// when every one of them reported a cost. A partial sum would read as the
// whole bill, so a counted turn without a cost leaves `costUsd` out.
export function sessionCost(usages: Iterable<TokenUsage | undefined>): {
  turns: number;
  costUsd?: number;
} {
  let turns = 0;
  let turnsWithCost = 0;
  let costUsd = 0;
  for (let usage of usages) {
    if (!isCountedTurn(usage)) {
      continue;
    }
    turns++;
    if (usage.costUsd != null) {
      costUsd += usage.costUsd;
      turnsWithCost++;
    }
  }
  return turnsWithCost === turns ? { turns, costUsd } : { turns };
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
