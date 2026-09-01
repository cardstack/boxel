// The single money formatter for the Sole Vault cards. Import this everywhere an
// amount is rendered — isolated, embedded, fitted, atom, table cell, CSV — so no
// two views of the same card can disagree about a price.
//
// WHY THIS EXISTS: base `amount-with-currency.gts` performs no number formatting
// at all (grep it: no Intl, no toFixed, no minimumFractionDigits). Rendering its
// atom therefore prints the raw JS number, so 11.50 renders as "11.5" and 3.10 as
// "3.1". A price missing a digit is not a price — a reader cannot tell $11.50 from
// $11.05 — and the bug is invisible on any amount whose minor units happen to be
// non-zero, which is most test data.
//
// WHAT THIS IS NOT: the formatting itself. That lives in the matrix-layer block
// `./money`, pulled verbatim, and this file DELEGATES to it rather than carrying a
// second Intl call. Two things follow from that split:
//
//   1. `money.gts` passes no explicit fraction-digit options, so Intl applies each
//      currency's OWN minor units — 2 for USD, 0 for JPY and KRW. An earlier
//      version of this file pinned minimumFractionDigits: 2, which rendered
//      ¥100 as "¥100.00": a quantity that does not exist in that currency.
//      Delegating fixed that, so do not "restore" the pinned digits.
//   2. `money.gts`'s own no-code branch uses maximumFractionDigits: 2 with no
//      minimum, which DOES drop minor units ("11.5"). This file never reaches it,
//      because it always resolves a currency code before delegating.
//
// The two `formatMoney` exports are distinguishable by signature — this one takes
// an `{amount, currency}`, `./money`'s takes `(amount, code)`. A third, unrelated
// `formatMoney(n: number)` in `./utils/index` hardcodes `$` and drops minor units
// via toLocaleString; it belongs to another app's slice. Do not import that one.

import { formatMoney as formatAmount } from './money';

export interface MoneyLike {
  amount?: number | null;
  currency?: { code?: string | null } | null;
}

const DEFAULT_CURRENCY = 'USD';

/**
 * Format an amount in its own currency's minor units: `$310.00`, `¥310`.
 *
 * Falls back to a plain fixed-2 rendering with the raw code prefixed if Intl does
 * not recognise the currency — a realm may carry a code Intl has never heard of,
 * and `./money` would silently drop the code there and print a bare number.
 */
export function formatMoney(value: MoneyLike | null | undefined): string {
  if (!value || value.amount == null) {
    return '';
  }
  let code = value.currency?.code?.trim() || DEFAULT_CURRENCY;
  try {
    // Probe the code before delegating: `./money` swallows an unknown-currency
    // throw and degrades to a bare number, losing the code the reader needs.
    new Intl.NumberFormat('en-US', { style: 'currency', currency: code });
  } catch {
    return `${code} ${value.amount.toFixed(2)}`;
  }
  return formatAmount(value.amount, code);
}

/**
 * Signed difference between two amounts, formatted with an explicit sign.
 *
 * Returns null — not '0' and not '' — when either side is missing, so a caller can
 * tell "no comparison possible" from "no change". A card that renders a 0 it never
 * computed is asserting something it does not know.
 */
export function formatMoneyDelta(
  now: MoneyLike | null | undefined,
  then: MoneyLike | null | undefined,
): { text: string; direction: 'up' | 'down' | 'flat'; percent: string } | null {
  if (now?.amount == null || then?.amount == null) {
    return null;
  }
  let diff = now.amount - then.amount;
  let direction = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
  let sign = diff > 0 ? '+' : diff < 0 ? '−' : '';
  let magnitude = formatMoney({
    amount: Math.abs(diff),
    currency: now.currency ?? then.currency,
  });
  let percent =
    then.amount === 0
      ? ''
      : `${sign}${Math.abs((diff / then.amount) * 100).toFixed(0)}%`;
  return { text: `${sign}${magnitude}`, direction: direction as any, percent };
}
