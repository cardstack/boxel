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
