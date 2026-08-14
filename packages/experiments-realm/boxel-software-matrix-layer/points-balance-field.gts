import { Component } from '@cardstack/base/card-api';
import NumberField from '@cardstack/base/number';
import CoinsIcon from '@cardstack/boxel-icons/coins';

function formatPoints(n?: number | null): string {
  if (n == null || Number.isNaN(n)) {
    return '—';
  }
  return new Intl.NumberFormat().format(n);
}

/**
 * A quantity of loyalty points — a count, not money. It never carries a
 * currency and never converts; what a point is worth is the program's
 * business, decided wherever points are earned or redeemed.
 *
 * The stored number is maintained by the program's single writer (the
 * Credit Points command) against its transaction ledger; nothing else
 * should assign it. The field's own job is only to render a points figure
 * consistently everywhere one appears.
 */
export default class PointsBalanceField extends NumberField {
  static displayName = 'Points Balance';
  static icon = CoinsIcon;

  static embedded = class Embedded extends Component<typeof this> {
    get formatted() {
      return formatPoints(this.args.model as unknown as number);
    }
    <template>
      <span class='points'>
        <span class='points-value'>{{this.formatted}}</span>
        <span class='points-unit'>pts</span>
      </span>
      <style scoped>
        .points {
          display: inline-flex;
          align-items: baseline;
          gap: var(--boxel-sp-5xs);
        }
        .points-value {
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          color: var(--foreground, var(--boxel-dark));
        }
        .points-unit {
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    get formatted() {
      return formatPoints(this.args.model as unknown as number);
    }
    <template>
      <span class='points'>{{this.formatted}} pts</span>
      <style scoped>
        .points {
          font-variant-numeric: tabular-nums;
          font-size: var(--boxel-font-size-xs);
          font-weight: 600;
        }
      </style>
    </template>
  };
}
