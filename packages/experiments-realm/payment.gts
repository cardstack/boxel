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

  static atom = class Atom extends Component<typeof Payment> {
    <template>
      <span class='payment-atom'>
        <CreditCardIcon class='pa-icon' />
        <span class='pa-name'>{{@model.cardTitle}}</span>
      </span>
      <style scoped>
        .payment-atom {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          font-size: 0.8125rem;
          font-weight: 500;
          color: var(--foreground, #111111);
        }
        .pa-icon {
          width: 14px;
          height: 14px;
          color: var(--muted-foreground, #6b7280);
          flex-shrink: 0;
        }
        .pa-name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof Payment> {
    get amount() {
      return (
        formatMoney(
          this.args.model?.amount?.amount,
          this.args.model?.amount?.currency?.code,
        ) || '—'
      );
    }
    <template>
      <div class='fitted'>
        <div class='fmt badge'>
          <CreditCardIcon class='doc-icon' />
          <span class='figure'>{{this.amount}}</span>
          {{#if @model.method}}
            <span class='chip'>{{@model.method}}</span>
          {{/if}}
        </div>
        <div class='fmt strip'>
          <CreditCardIcon class='doc-icon' />
          <div class='info'>
            <span class='figure'>{{this.amount}}</span>
            {{#if @model.method}}
              <span class='chip'>{{@model.method}}</span>
            {{/if}}
          </div>
          {{#if @model.paidAt}}
            <span class='meta'><@fields.paidAt /></span>
          {{/if}}
        </div>
        <div class='fmt tile'>
          <CreditCardIcon class='doc-icon' />
          <span class='figure figure-lg'>{{this.amount}}</span>
          {{#if @model.method}}
            <span class='chip'>{{@model.method}}</span>
          {{/if}}
          {{#if @model.paidAt}}
            <span class='meta'><@fields.paidAt /></span>
          {{/if}}
        </div>
        <div class='fmt card'>
          <div class='col'>
            <div class='row'>
              <CreditCardIcon class='doc-icon' />
              <span class='figure figure-lg'>{{this.amount}}</span>
              {{#if @model.method}}
                <span class='chip'>{{@model.method}}</span>
              {{/if}}
            </div>
            {{#if @model.invoice.cardTitle}}
              <span class='meta'>Applied to {{@model.invoice.cardTitle}}</span>
            {{/if}}
            {{#if @model.reference}}
              <span class='meta'>Ref {{@model.reference}}</span>
            {{/if}}
          </div>
          {{#if @model.paidAt}}
            <span class='meta'><@fields.paidAt /></span>
          {{/if}}
        </div>
      </div>
      <style scoped>
        .fitted {
          width: 100%;
          height: 100%;
          color: var(--foreground, #111111);
        }
        .fmt {
          display: none;
          width: 100%;
          height: 100%;
          box-sizing: border-box;
          overflow: hidden;
        }
        .doc-icon {
          width: 20px;
          height: 20px;
          color: var(--muted-foreground, #6b7280);
          flex-shrink: 0;
        }
        .figure {
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          font-size: 0.875rem;
          white-space: nowrap;
        }
        .figure-lg {
          font-size: 1.25rem;
        }
        .chip {
          font-size: 0.625rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          padding: 0.125rem 0.4375rem;
          border-radius: 999px;
          background: var(--muted, #f3f4f6);
          color: var(--muted-foreground, #6b7280);
          white-space: nowrap;
        }
        .meta {
          font-size: 0.6875rem;
          color: var(--muted-foreground, #6b7280);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          max-width: 100%;
        }
        .row {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          min-width: 0;
        }
        .col,
        .info {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
          min-width: 0;
          flex: 1;
        }
        @container fitted-card (max-width: 150px) and (max-height: 169px) {
          .badge {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 0.375rem;
            padding: 0.5rem;
            text-align: center;
          }
        }
        @container fitted-card (min-width: 151px) and (max-height: 169px) {
          .strip {
            display: flex;
            align-items: center;
            gap: 0.625rem;
            padding: 0.625rem 0.75rem;
          }
          .strip .info {
            gap: 0.125rem;
          }
          .strip .chip {
            align-self: flex-start;
          }
        }
        @container fitted-card (max-width: 399px) and (min-height: 170px) {
          .tile {
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            justify-content: center;
            gap: 0.375rem;
            padding: 0.875rem;
          }
        }
        @container fitted-card (min-width: 400px) and (min-height: 170px) {
          .card {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 1rem;
            padding: 1.25rem;
          }
        }
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof Payment> {
    get amount() {
      return (
        formatMoney(
          this.args.model?.amount?.amount,
          this.args.model?.amount?.currency?.code,
        ) || '\u2014'
      );
    }
    <template>
      <article class='receipt-wrap'>
        <div class='receipt'>
          <header class='r-head'>
            <p class='r-label'>Payment received</p>
            <h1 class='r-amount'>{{this.amount}}</h1>
            {{#if @model.method}}
              <span class='chip'>{{@model.method}}</span>
            {{/if}}
          </header>
          <div class='tear' aria-hidden='true'></div>
          <dl class='r-rows'>
            {{#if @model.paidAt}}
              <dt>Paid at</dt>
              <dd><@fields.paidAt /></dd>
            {{/if}}
            {{#if @model.reference}}
              <dt>Reference</dt>
              <dd class='mono'>{{@model.reference}}</dd>
            {{/if}}
            {{#if @model.invoice}}
              <dt>Applied to</dt>
              <dd class='r-invoice'><@fields.invoice @format='atom' /></dd>
            {{/if}}
          </dl>
        </div>
      </article>
      <style scoped>
        .receipt-wrap {
          padding: 2.5rem 1.5rem;
          display: flex;
          justify-content: center;
        }
        .receipt {
          width: 100%;
          max-width: 24rem;
          background: var(--card, #ffffff);
          border: 1px solid var(--border, #e5e7eb);
          border-radius: 0.5rem;
          box-shadow: var(--shadow-md, 0 4px 14px rgba(0, 0, 0, 0.08));
          overflow: hidden;
        }
        .r-head {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.5rem;
          padding: 2rem 1.5rem 1.5rem;
          text-align: center;
        }
        .r-label {
          margin: 0;
          font-size: 0.6875rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.14em;
          color: var(--muted-foreground, #6b7280);
        }
        .r-amount {
          margin: 0;
          font-size: 2.25rem;
          line-height: 1.1;
          font-variant-numeric: tabular-nums;
          font-family: var(--font-heading, inherit);
        }
        .chip {
          font-size: 0.6875rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          padding: 0.1875rem 0.625rem;
          border-radius: 999px;
          background: var(--muted, #f3f4f6);
          color: var(--muted-foreground, #6b7280);
        }
        .tear {
          border-top: 2px dashed var(--border, #e5e7eb);
          margin: 0 1rem;
          position: relative;
        }
        .tear::before,
        .tear::after {
          content: '';
          position: absolute;
          top: -0.5rem;
          width: 1rem;
          height: 1rem;
          border-radius: 50%;
          background: var(--background, #f4f4f4);
          border: 1px solid var(--border, #e5e7eb);
        }
        .tear::before {
          left: -1.5rem;
        }
        .tear::after {
          right: -1.5rem;
        }
        .r-rows {
          margin: 0;
          padding: 1.25rem 1.5rem 1.75rem;
          display: grid;
          grid-template-columns: auto 1fr;
          gap: 0.625rem 1.25rem;
          font-size: 0.875rem;
          align-items: center;
        }
        .r-rows dt {
          color: var(--muted-foreground, #6b7280);
        }
        .r-rows dd {
          margin: 0;
          text-align: right;
          font-weight: 500;
        }
        .mono {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 0.8125rem;
        }
        .r-invoice {
          display: flex;
          justify-content: flex-end;
        }
      </style>
    </template>
  };
}
