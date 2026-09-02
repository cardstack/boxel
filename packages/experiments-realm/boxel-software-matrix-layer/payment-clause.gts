import {
  Component,
  field,
  contains,
  StringField,
} from '@cardstack/base/card-api';
import NumberField from '@cardstack/base/number';

import { Clause } from './clause';
import { StatePill } from './components/state-pill';

// A payment-terms clause as a typed library entry. Extends the shared
// Clause additively with the numbers a finance reviewer scans for: net
// days, late-fee rate, and any early-payment discount. Instances should set
// the base `clauseType` to `payment` so type-driven views group them.
export class PaymentClause extends Clause {
  static displayName = 'Payment Clause';

  @field netDays = contains(NumberField, {
    description: 'Days to pay after invoice, e.g. 30 for Net-30',
  });
  @field lateFeePercent = contains(NumberField, {
    description: 'Monthly late fee on overdue balance, e.g. 1.5',
  });
  @field earlyPaymentDiscountPercent = contains(NumberField);
  @field earlyPaymentWindowDays = contains(NumberField);
  @field acceptedMethods = contains(StringField, {
    description: 'e.g. ACH, wire, credit card',
  });

  static embedded = class Embedded extends Component<typeof this> {
    get termsLabel() {
      let parts: string[] = [];
      let net = this.args.model?.netDays;
      if (net != null) {
        parts.push(`Net-${net}`);
      }
      let late = this.args.model?.lateFeePercent;
      if (late) {
        parts.push(`${late}%/mo late fee`);
      }
      let disc = this.args.model?.earlyPaymentDiscountPercent;
      let window = this.args.model?.earlyPaymentWindowDays;
      if (disc && window) {
        parts.push(`${disc}/${window} discount`);
      }
      return parts.join(' · ') || 'terms unset';
    }
    <template>
      <div class='row'>
        <div class='who'>
          <span class='name'>{{@model.name}}</span>
          <span class='meta'>{{this.termsLabel}}</span>
        </div>
        <StatePill @label='payment' @hue='green' @chrome={{true}} />
      </div>
      <style scoped>
        .row {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: var(--boxel-sp-sm);
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
        .meta {
          font-size: 0.8125rem;
          color: var(--muted-foreground, var(--boxel-450));
          font-variant-numeric: tabular-nums;
        }
      </style>
    </template>
  };
}
