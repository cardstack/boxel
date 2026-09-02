import {
  FieldDef,
  Component,
  field,
  contains,
  StringField,
} from '@cardstack/base/card-api';
import NumberField from '@cardstack/base/number';
import enumField from '@cardstack/base/enum';

import { formatMoney } from './money';

export const PAY_PERIODS = ['annual', 'monthly', 'hourly'];

export const PAY_PERIOD_LABELS: Record<string, string> = {
  annual: 'per year',
  monthly: 'per month',
  hourly: 'per hour',
};

export const PayPeriodField = enumField(StringField, {
  options: PAY_PERIODS.map((value) => ({
    value,
    label: PAY_PERIOD_LABELS[value],
  })),
  displayName: 'Pay Period',
});

// A pay package as one value: base + period, bonus target, equity. A
// compound field rather than loose numbers on Employee, so a compensation
// CHANGE can be recorded as a dated card (see compensation.gts) carrying
// the whole before/after package, and so any card that needs to show pay
// (offer, comp record, workspace) renders it one way. Domain-neutral: no
// approval or effective-date semantics here — those belong to the record
// card that contains this field.
export class CompensationField extends FieldDef {
  static displayName = 'Compensation';

  @field baseAmount = contains(NumberField);
  @field payPeriod = contains(PayPeriodField);
  @field bonusTargetPercent = contains(NumberField);
  @field equityShares = contains(NumberField);

  @field summary = contains(StringField, {
    computeVia: function (this: CompensationField) {
      if (this.baseAmount == null) {
        return '';
      }
      let base = `$${(this.baseAmount ?? 0).toLocaleString('en-US')} ${PAY_PERIOD_LABELS[this.payPeriod ?? 'annual'] ?? ''}`;
      let extras: string[] = [];
      if (this.bonusTargetPercent) {
        extras.push(`${this.bonusTargetPercent}% bonus`);
      }
      if (this.equityShares) {
        extras.push(`${this.equityShares.toLocaleString('en-US')} shares`);
      }
      return extras.length ? `${base} + ${extras.join(' + ')}` : base;
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    get baseLabel() {
      return formatMoney(this.args.model?.baseAmount ?? 0);
    }
    get periodLabel() {
      return PAY_PERIOD_LABELS[this.args.model?.payPeriod ?? 'annual'] ?? '';
    }
    <template>
      <div class='comp'>
        <span class='base'>{{this.baseLabel}}
          <span class='period'>{{this.periodLabel}}</span></span>
        <div class='extras'>
          {{#if @model.bonusTargetPercent}}
            <span>{{@model.bonusTargetPercent}}% bonus target</span>
          {{/if}}
          {{#if @model.equityShares}}
            <span>{{@model.equityShares}} shares</span>
          {{/if}}
        </div>
      </div>
      <style scoped>
        .comp {
          display: grid;
          gap: var(--boxel-sp-5xs);
          font-size: 0.875rem;
        }
        .base {
          font-size: 1.125rem;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
        }
        .period {
          font-size: 0.8125rem;
          font-weight: 400;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .extras {
          display: flex;
          gap: var(--boxel-sp-sm);
          color: var(--muted-foreground, var(--boxel-450));
          font-variant-numeric: tabular-nums;
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    <template>
      <span class='comp-atom'>{{@model.summary}}</span>
      <style scoped>
        .comp-atom {
          font-size: 0.8125rem;
          font-variant-numeric: tabular-nums;
        }
      </style>
    </template>
  };
}
