// Derives a glanceable cost tier (`Free`, `$`, `$$`, `$$$`, `$$$$`) for an AI
// model from its OpenRouter per-token pricing.
//
// The metric is a *blended* price per million tokens using a 3:1 input:output
// weighting — the industry-standard "blended" cost. 3:1 reflects that real
// usage sends more prompt tokens than it receives completion tokens, so it
// avoids input-only understating reasoning-heavy models and output-only
// overstating models with cheap completions.
//
// Prices arrive from the OpenRouter API as per-token decimal strings (e.g.
// "0.0000006"); a value of "0" means free. An absent side is treated as zero
// (when the other side is known), but a present-yet-unparseable price makes
// the whole cost unknown — better no badge than a wrong tier.

// Upper bounds (inclusive) for the blended $/M cost of each dollar tier. Fixed,
// human-round thresholds — not quantiles — so a model's badge stays stable as
// the catalog churns. Grounded in the live OpenRouter price distribution.
export const COST_TIER_UPPER_BOUNDS = [1, 5, 20] as const; // $, $$, $$$ (>20 => $$$$)

const DOLLAR_LABELS = ['$', '$$', '$$$', '$$$$'] as const;

export type CostTierLabel = 'Free' | (typeof DOLLAR_LABELS)[number];

export interface CostTier {
  // 0 = Free, 1 = `$` … 4 = `$$$$`.
  tier: 0 | 1 | 2 | 3 | 4;
  label: CostTierLabel;
}

function parsePrice(
  price: string | undefined | null,
): number | 'absent' | 'invalid' {
  if (price == null || price === '') {
    return 'absent';
  }
  // `Number` (unlike `parseFloat`) rejects numeric-prefixed junk like
  // "0.000003 USD" or "1x" as `NaN`, honoring this file's "unparseable => no
  // badge" contract; the `>= 0` guard rejects a stray negative price that would
  // otherwise blend below zero and mislabel a paid model as `Free`.
  let n = Number(price);
  return Number.isFinite(n) && n >= 0 ? n : 'invalid';
}

// Blended 3:1 input:output cost per million tokens, or `undefined` when the
// cost is unknown: both prices absent, or either present but unparseable.
export function blendedCostPerMillion(
  promptPerToken: string | undefined | null,
  completionPerToken: string | undefined | null,
): number | undefined {
  let prompt = parsePrice(promptPerToken);
  let completion = parsePrice(completionPerToken);
  if (prompt === 'invalid' || completion === 'invalid') {
    return undefined;
  }
  if (prompt === 'absent' && completion === 'absent') {
    return undefined;
  }
  let perToken =
    (3 * (prompt === 'absent' ? 0 : prompt) +
      (completion === 'absent' ? 0 : completion)) /
    4;
  return perToken * 1_000_000;
}

// Maps OpenRouter pricing to a cost tier, or `undefined` when pricing is
// unknown (so callers render no badge rather than a wrong one).
export function modelCostTier(
  promptPerToken: string | undefined | null,
  completionPerToken: string | undefined | null,
): CostTier | undefined {
  let blended = blendedCostPerMillion(promptPerToken, completionPerToken);
  if (blended === undefined) {
    return undefined;
  }
  if (blended <= 0) {
    return { tier: 0, label: 'Free' };
  }
  let index = COST_TIER_UPPER_BOUNDS.findIndex((bound) => blended <= bound);
  // Above the last bound => the top dollar tier.
  let dollarIndex = index === -1 ? DOLLAR_LABELS.length - 1 : index;
  return {
    tier: (dollarIndex + 1) as 1 | 2 | 3 | 4,
    label: DOLLAR_LABELS[dollarIndex],
  };
}

// Convenience for callers that only need the badge text.
export function modelCostTierLabel(
  promptPerToken: string | undefined | null,
  completionPerToken: string | undefined | null,
): CostTierLabel | undefined {
  return modelCostTier(promptPerToken, completionPerToken)?.label;
}
