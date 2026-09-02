import {
  CardDef,
  Component,
  field,
  contains,
  StringField,
} from '@cardstack/base/card-api';
import NumberField from '@cardstack/base/number';

import {
  BudgetUtilizationField,
  UTILIZATION_BAND_COLORS,
  type UtilizationBand,
} from './budget-utilization-field';
import { formatMoney } from './money';
import { StatePill } from './components/state-pill';

// A department's spending envelope for one period, tracked with commitment
// accounting: `committed` is money promised by approved-but-unreceived POs,
// `actual` is money for goods actually received. Both are maintained by the
// single writers that own those transitions (ApprovePurchaseOrderCommand
// moves 0 → committed; ReceiveGoodsCommand moves committed → actual) — never
// hand-edited, never recomputed by a query, so the numbers can't drift from
// the events that produced them.
export class ProcurementBudget extends CardDef {
  static displayName = 'Procurement Budget';
  static headerColor = '#3e4e88';

  @field department = contains(StringField);
  @field period = contains(StringField, {
    description: 'e.g. FY2026 Q1',
  });
  @field budgetAmount = contains(NumberField);
  @field committed = contains(NumberField);
  @field actual = contains(NumberField);

  @field utilization = contains(BudgetUtilizationField, {
    computeVia: function (this: ProcurementBudget) {
      return new BudgetUtilizationField({
        budget: this.budgetAmount ?? 0,
        committed: this.committed ?? 0,
        actual: this.actual ?? 0,
      });
    },
  });

  @field title = contains(StringField, {
    computeVia: function (this: ProcurementBudget) {
      let dept = this.department?.trim();
      let period = this.period?.trim();
      if (dept && period) {
        return `${dept} · ${period}`;
      }
      return dept || period || 'Untitled Budget';
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    get budgetLabel() {
      return formatMoney(this.args.model?.budgetAmount ?? 0, 'USD');
    }
    get bandHue() {
      let band = (this.args.model?.utilization?.band ??
        'healthy') as UtilizationBand;
      return UTILIZATION_BAND_COLORS[band] ? band : 'healthy';
    }
    get overCommitted() {
      return (this.args.model?.utilization?.percent ?? 0) > 100;
    }
    <template>
      <article class='budget'>
        <header class='head'>
          <div>
            <p class='kicker'>Procurement Budget</p>
            <h1>{{@model.department}}</h1>
            <p class='sub'>{{@model.period}}</p>
          </div>
          <div class='amount'>
            <span class='amount-value'>{{this.budgetLabel}}</span>
            <span class='amount-label'>period budget</span>
          </div>
        </header>

        {{#if this.overCommitted}}
          <div class='over-banner'>
            <StatePill
              @label='OVER BUDGET — commitments exceed the envelope'
              @hue='red'
              @emphatic={{true}}
            />
          </div>
        {{/if}}

        <section class='panel'>
          <@fields.utilization @format='embedded' />
        </section>
      </article>
      <style scoped>
        .budget {
          container-type: inline-size;
          padding: var(--boxel-sp-lg);
          background: var(--background, var(--boxel-light));
          color: var(--foreground, var(--boxel-dark));
          font-family: var(--font-sans, inherit);
        }
        .head {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          gap: var(--boxel-sp);
          border-bottom: 1px solid var(--border, var(--boxel-200));
          padding-bottom: var(--boxel-sp);
          margin-bottom: var(--boxel-sp);
        }
        .kicker {
          margin: 0;
          font-size: 0.6875rem;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--muted-foreground, var(--boxel-450));
        }
        h1 {
          margin: var(--boxel-sp-5xs) 0;
          font-family: var(--font-heading, inherit);
          font-size: 1.75rem;
          line-height: 1.15;
        }
        .sub {
          margin: 0;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .amount {
          text-align: right;
        }
        .amount-value {
          display: block;
          font-size: 1.5rem;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
        }
        .amount-label {
          font-size: 0.75rem;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .over-banner {
          margin-bottom: var(--boxel-sp);
        }
        .panel {
          border: 1px solid var(--border, var(--boxel-200));
          border-radius: var(--radius, var(--boxel-border-radius));
          padding: var(--boxel-sp);
          background: var(--card, transparent);
        }
        @container (max-width: 480px) {
          .head {
            flex-direction: column;
            align-items: flex-start;
          }
          .amount {
            text-align: left;
          }
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    get budgetLabel() {
      return formatMoney(this.args.model?.budgetAmount ?? 0, 'USD');
    }
    <template>
      <div class='row'>
        <div class='who'>
          <span class='name'>{{@model.department}}</span>
          <span class='period'>{{@model.period}} ·
            {{this.budgetLabel}}</span>
        </div>
        <div class='bar-cell'>
          <@fields.utilization @format='embedded' />
        </div>
      </div>
      <style scoped>
        .row {
          display: grid;
          grid-template-columns: minmax(8rem, 14rem) 1fr;
          gap: var(--boxel-sp);
          align-items: center;
          padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        }
        .who {
          display: flex;
          flex-direction: column;
          gap: 2px;
          min-width: 0;
        }
        .name {
          font-weight: 600;
          font-size: 0.9375rem;
        }
        .period {
          font-size: 0.8125rem;
          color: var(--muted-foreground, var(--boxel-450));
          font-variant-numeric: tabular-nums;
        }
        .bar-cell {
          min-width: 0;
        }
        @container (max-width: 480px) {
          .row {
            grid-template-columns: 1fr;
          }
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    <template>
      <span class='atom'>{{@model.department}}
        <@fields.utilization @format='atom' /></span>
      <style scoped>
        .atom {
          display: inline-flex;
          align-items: baseline;
          gap: var(--boxel-sp-5xs);
          font-size: 0.8125rem;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    get budgetLabel() {
      return formatMoney(this.args.model?.budgetAmount ?? 0, 'USD');
    }
    <template>
      <div class='fit'>
        <div class='fit-head'>
          <span class='fit-name'>{{@model.department}}</span>
          <@fields.utilization @format='atom' />
        </div>
        <span class='fit-sub'>{{@model.period}} · {{this.budgetLabel}}</span>
        <div class='fit-bar'>
          <@fields.utilization @format='embedded' />
        </div>
      </div>
      <style scoped>
        .fit {
          height: 100%;
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-5xs);
          padding: var(--boxel-sp-xs);
          overflow: hidden;
        }
        .fit-head {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: var(--boxel-sp-5xs);
        }
        .fit-name {
          font-weight: 600;
          font-size: 0.9375rem;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .fit-sub {
          font-size: 0.75rem;
          color: var(--muted-foreground, var(--boxel-450));
          font-variant-numeric: tabular-nums;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .fit-bar {
          display: none;
          margin-top: auto;
        }
        @container fitted-card (height > 140px) and (width > 250px) {
          .fit-bar {
            display: block;
          }
        }
        @container fitted-card (height <= 65px) {
          .fit {
            flex-direction: row;
            align-items: center;
            gap: var(--boxel-sp-xs);
          }
          .fit-sub {
            display: none;
          }
        }
      </style>
    </template>
  };
}
