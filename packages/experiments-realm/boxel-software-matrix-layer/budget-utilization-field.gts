import {
  FieldDef,
  Component,
  field,
  contains,
  StringField,
} from '@cardstack/base/card-api';
import NumberField from '@cardstack/base/number';

import { formatMoney } from './money';
import { stateColor, type StateColor } from './utils/index';

// Commitment-accounting utilization: money splits into `actual` (received)
// and `committed` (approved POs not yet received). Utilization counts BOTH —
// committed money is already spoken for, which is the whole point of
// commitment accounting. The bar renders the two segments distinctly
// (actual solid, committed hatched) so "spent" and "promised" never blur.
//
// Domain-neutral: this field holds three plain numbers. The consumer
// (ProcurementBudget here) decides what counts as committed vs actual and
// keeps the numbers current via its commands.

export type UtilizationBand = 'healthy' | 'warning' | 'critical' | 'over';

export const UTILIZATION_BAND_COLORS: Record<UtilizationBand, StateColor> = {
  healthy: stateColor('green'),
  warning: stateColor('amber'),
  critical: stateColor('red'),
  over: stateColor('red'),
};

export function utilizationBandOf(percent: number): UtilizationBand {
  if (percent > 100) {
    return 'over';
  }
  if (percent >= 95) {
    return 'critical';
  }
  if (percent >= 70) {
    return 'warning';
  }
  return 'healthy';
}

export class BudgetUtilizationField extends FieldDef {
  static displayName = 'Budget Utilization';

  @field budget = contains(NumberField);
  @field committed = contains(NumberField);
  @field actual = contains(NumberField);

  @field percent = contains(NumberField, {
    computeVia: function (this: BudgetUtilizationField) {
      let budget = this.budget ?? 0;
      if (budget <= 0) {
        return 0;
      }
      let used = (this.committed ?? 0) + (this.actual ?? 0);
      return Math.round((used / budget) * 100);
    },
  });

  @field band = contains(StringField, {
    computeVia: function (this: BudgetUtilizationField) {
      return utilizationBandOf(this.percent ?? 0);
    },
  });

  @field available = contains(NumberField, {
    computeVia: function (this: BudgetUtilizationField) {
      return (
        (this.budget ?? 0) - (this.committed ?? 0) - (this.actual ?? 0)
      );
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    get actualPct() {
      let budget = this.args.model?.budget ?? 0;
      if (budget <= 0) {
        return 0;
      }
      return Math.min(100, ((this.args.model?.actual ?? 0) / budget) * 100);
    }
    get committedPct() {
      let budget = this.args.model?.budget ?? 0;
      if (budget <= 0) {
        return 0;
      }
      let pct = ((this.args.model?.committed ?? 0) / budget) * 100;
      return Math.min(100 - this.actualPct, pct);
    }
    get bandColors() {
      return UTILIZATION_BAND_COLORS[
        (this.args.model?.band as UtilizationBand) ?? 'healthy'
      ];
    }
    get bandLabel() {
      switch (this.args.model?.band) {
        case 'over':
          return 'OVER BUDGET';
        case 'critical':
          return 'CRITICAL';
        case 'warning':
          return 'WARNING';
        default:
          return 'HEALTHY';
      }
    }
    get actualLabel() {
      return formatMoney(this.args.model?.actual ?? 0, 'USD');
    }
    get committedLabel() {
      return formatMoney(this.args.model?.committed ?? 0, 'USD');
    }
    get availableLabel() {
      return formatMoney(this.args.model?.available ?? 0, 'USD');
    }
    get barStyle() {
      return `--actual-w: ${this.actualPct}%; --committed-w: ${this.committedPct}%;`;
    }
    <template>
      <div class='util'>
        <div class='meta'>
          <span class='pct band-{{@model.band}}'>{{@model.percent}}%</span>
          <span class='band band-{{@model.band}}'>{{this.bandLabel}}</span>
        </div>
        <div class='bar' style={{this.barStyle}}>
          <div class='seg actual'></div>
          <div class='seg committed'></div>
        </div>
        <div class='legend'>
          <span><i class='swatch solid'></i>actual {{this.actualLabel}}</span>
          <span><i class='swatch hatch'></i>committed
            {{this.committedLabel}}</span>
          <span class='avail'>available {{this.availableLabel}}</span>
        </div>
      </div>
      <style scoped>
        .util {
          display: grid;
          gap: var(--boxel-sp-4xs);
          font-size: 0.8125rem;
        }
        .meta {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
        }
        .pct {
          font-weight: 700;
          font-size: 1rem;
          font-variant-numeric: tabular-nums;
        }
        .band {
          font-size: 0.6875rem;
          letter-spacing: 0.1em;
          font-weight: 600;
        }
        .band-healthy {
          color: var(--state-green-fg, #15803d);
        }
        .band-warning {
          color: var(--state-amber-fg, #b45309);
        }
        .band-critical,
        .band-over {
          color: var(--state-red-fg, #b91c1c);
        }
        .bar {
          display: flex;
          height: 10px;
          border-radius: 5px;
          overflow: hidden;
          background: var(--muted, var(--boxel-100));
        }
        .seg.actual {
          width: var(--actual-w, 0%);
          background: var(--primary, var(--boxel-highlight));
        }
        .seg.committed {
          width: var(--committed-w, 0%);
          background: repeating-linear-gradient(
            45deg,
            var(--primary, var(--boxel-highlight)),
            var(--primary, var(--boxel-highlight)) 3px,
            transparent 3px,
            transparent 6px
          );
          opacity: 0.75;
        }
        .legend {
          display: flex;
          flex-wrap: wrap;
          gap: var(--boxel-sp-sm);
          color: var(--muted-foreground, var(--boxel-450));
          font-variant-numeric: tabular-nums;
        }
        .legend .avail {
          margin-left: auto;
          font-weight: 600;
          color: var(--foreground, var(--boxel-dark));
        }
        .swatch {
          display: inline-block;
          width: 10px;
          height: 10px;
          border-radius: 2px;
          margin-right: 4px;
          vertical-align: -1px;
        }
        .swatch.solid {
          background: var(--primary, var(--boxel-highlight));
        }
        .swatch.hatch {
          background: repeating-linear-gradient(
            45deg,
            var(--primary, var(--boxel-highlight)),
            var(--primary, var(--boxel-highlight)) 2px,
            transparent 2px,
            transparent 4px
          );
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    <template>
      <span class='util-atom band-{{@model.band}}'>{{@model.percent}}%</span>
      <style scoped>
        .util-atom {
          font-weight: 600;
          font-variant-numeric: tabular-nums;
          font-size: 0.8125rem;
        }
        .band-healthy {
          color: var(--state-green-fg, #15803d);
        }
        .band-warning {
          color: var(--state-amber-fg, #b45309);
        }
        .band-critical,
        .band-over {
          color: var(--state-red-fg, #b91c1c);
        }
      </style>
    </template>
  };
}
