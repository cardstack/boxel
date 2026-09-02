import GlimmerComponent from '@glimmer/component';

// Money Display — the money-rendering primitive: tabular numerals,
// currency-correct precision (0 dp JPY, 3 dp KWD, 2 dp default), negatives
// as red parentheses, optional base-currency subline for foreign amounts.
// A display wrapper over plain values — explicitly NOT a money data type
// (Amount-with-Currency owns storage; the Money matrix row is its alias).

const ZERO_DP = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK']);
const THREE_DP = new Set(['KWD', 'BHD', 'OMR', 'JOD', 'TND', 'IQD', 'LYD']);

export function decimalsFor(code?: string | null): number {
  let c = (code ?? '').toUpperCase();
  if (ZERO_DP.has(c)) {
    return 0;
  }
  if (THREE_DP.has(c)) {
    return 3;
  }
  return 2;
}

export function formatMoneyDisplay(
  amount?: number | null,
  code?: string | null,
): string {
  if (amount == null) {
    return '—';
  }
  let dp = decimalsFor(code);
  let abs = Math.abs(amount).toLocaleString('en-US', {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
  let cur = code ? `${code.toUpperCase()} ` : '$';
  return amount < 0 ? `(${cur}${abs})` : `${cur}${abs}`;
}

interface Signature {
  Args: {
    amount?: number | null;
    currency?: string | null;
    /** shown as a muted subline, e.g. the base-currency equivalent */
    baseAmount?: number | null;
    baseCurrency?: string | null;
    /** larger emphatic rendering for totals */
    emphatic?: boolean;
  };
  Element: HTMLElement;
}

export class MoneyDisplay extends GlimmerComponent<Signature> {
  get display() {
    return formatMoneyDisplay(this.args.amount, this.args.currency);
  }
  get negative() {
    return (this.args.amount ?? 0) < 0;
  }
  get baseDisplay() {
    if (this.args.baseAmount == null) {
      return undefined;
    }
    return formatMoneyDisplay(this.args.baseAmount, this.args.baseCurrency);
  }
  <template>
    <span
      class='money {{if this.negative "negative"}} {{if @emphatic "emphatic"}}'
      ...attributes
    >
      <span class='money-main'>{{this.display}}</span>
      {{#if this.baseDisplay}}
        <span class='money-base'>≈ {{this.baseDisplay}}</span>
      {{/if}}
    </span>
    <style scoped>
      .money {
        display: inline-flex;
        flex-direction: column;
        align-items: flex-end;
        font-variant-numeric: tabular-nums;
        line-height: 1.25;
      }
      .money-main {
        font-weight: 600;
      }
      .money.emphatic .money-main {
        font-weight: 700;
        font-size: 1.125em;
      }
      .money.negative .money-main {
        color: var(--state-red-fg, #b91c1c);
      }
      .money-base {
        font-size: 0.75em;
        color: var(--muted-foreground, var(--boxel-450));
      }
    </style>
  </template>
}
