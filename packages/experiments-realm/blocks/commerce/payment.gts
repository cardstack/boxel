import {
  CardDef,
  Component,
  contains,
  field,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import DatetimeField from 'https://cardstack.com/base/datetime';
import AmountWithCurrency from 'https://cardstack.com/base/amount-with-currency';
import enumField from 'https://cardstack.com/base/enum';
import CreditCardIcon from '@cardstack/boxel-icons/credit-card';
import { Invoice } from './invoice';
import { formatMoney } from './money';

const PaymentMethodField = enumField(StringField, {
  options: ['card', 'bank transfer', 'cash', 'other'],
  displayName: 'Payment Method',
});

export class Payment extends CardDef {
  static displayName = 'Payment';
  static icon = CreditCardIcon;

  @field invoice = linksTo(Invoice);
  @field amount = contains(AmountWithCurrency);
  @field method = contains(PaymentMethodField);
  @field paidAt = contains(DatetimeField);
  @field reference = contains(StringField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: Payment) {
      let amt = formatMoney(this.amount?.amount, this.amount?.currency?.code);
      return amt ? `Payment ${amt}` : `Untitled ${this.constructor.displayName}`;
    },
  });

  static embedded = class Embedded extends Component<typeof Payment> {
    <template>
      <div class='payment'>
        <CreditCardIcon class='icon' />
        <span class='title'>{{@model.cardTitle}}</span>
        <span class='method'>{{@model.method}}</span>
        <span class='when'><@fields.paidAt /></span>
      </div>
      <style scoped>
        .payment {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 0.625rem 0.875rem;
          font-size: 0.875rem;
        }
        .icon {
          width: 20px;
          height: 20px;
          color: var(--muted-foreground, #6b7280);
          flex-shrink: 0;
        }
        .title {
          font-weight: 600;
        }
        .method {
          font-size: 0.6875rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          padding: 0.125rem 0.5rem;
          border-radius: 999px;
          background: var(--muted, #f3f4f6);
          color: var(--muted-foreground, #6b7280);
        }
        .when {
          margin-left: auto;
          color: var(--muted-foreground, #6b7280);
          font-size: 0.75rem;
        }
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof Payment> {
    <template>
      <article class='payment-page'>
        <header>
          <h1>{{@model.cardTitle}}</h1>
          <span class='method'>{{@model.method}}</span>
        </header>
        <section class='panel'>
          <dl>
            <dt>Paid at</dt>
            <dd><@fields.paidAt /></dd>
            <dt>Reference</dt>
            <dd>{{@model.reference}}</dd>
            <dt>Applied to</dt>
            <dd class='invoice'><@fields.invoice @format='embedded' /></dd>
          </dl>
        </section>
      </article>
      <style scoped>
        .payment-page {
          padding: 1.5rem;
          display: flex;
          flex-direction: column;
          gap: 1rem;
          max-width: 40rem;
        }
        header {
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }
        h1 {
          margin: 0;
          font-size: 1.375rem;
        }
        .method {
          font-size: 0.6875rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          padding: 0.1875rem 0.625rem;
          border-radius: 999px;
          background: var(--muted, #f3f4f6);
          color: var(--muted-foreground, #6b7280);
        }
        .panel {
          border: 1px solid var(--border, #e5e7eb);
          border-radius: 0.75rem;
          padding: 1rem;
          background: var(--card, #ffffff);
        }
        dl {
          margin: 0;
          display: grid;
          grid-template-columns: auto 1fr;
          gap: 0.5rem 1rem;
          font-size: 0.875rem;
          align-items: center;
        }
        dt {
          color: var(--muted-foreground, #6b7280);
        }
        dd {
          margin: 0;
        }
        .invoice :deep(.invoice-row) {
          padding: 0;
        }
      </style>
    </template>
  };
}
