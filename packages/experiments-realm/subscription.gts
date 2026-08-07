import {
  CardDef,
  Component,
  contains,
  field,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import DateField from 'https://cardstack.com/base/date';
import AmountWithCurrency from 'https://cardstack.com/base/amount-with-currency';
import enumField from 'https://cardstack.com/base/enum';
import RefreshIcon from '@cardstack/boxel-icons/refresh';
import { Customer } from './customer';
import { formatMoney } from './money';

const BillingCycleField = enumField(StringField, {
  options: ['monthly', 'yearly'],
  displayName: 'Billing Cycle',
});

const SubscriptionStatusField = enumField(StringField, {
  options: ['trial', 'active', 'paused', 'canceled'],
  displayName: 'Subscription Status',
});

export class Subscription extends CardDef {
  static displayName = 'Subscription';
  static icon = RefreshIcon;

  @field customer = linksTo(Customer);
  @field planName = contains(StringField);
  @field price = contains(AmountWithCurrency);
  @field billingCycle = contains(BillingCycleField);
  @field startDate = contains(DateField);
  @field status = contains(SubscriptionStatusField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: Subscription) {
      return this.planName?.trim()?.length
        ? this.planName
        : `Untitled ${this.constructor.displayName}`;
    },
  });

  static embedded = class Embedded extends Component<typeof Subscription> {
    get price() {
      return formatMoney(
        this.args.model?.price?.amount,
        this.args.model?.price?.currency?.code,
      );
    }
    <template>
      <div class='subscription'>
        <RefreshIcon class='icon' />
        <span class='plan'>{{@model.cardTitle}}</span>
        <span class='status status-{{@model.status}}'>{{@model.status}}</span>
        <span class='price'>{{this.price}} / {{@model.billingCycle}}</span>
      </div>
      <style scoped>
        .subscription {
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
        .plan {
          font-weight: 600;
        }
        .status {
          font-size: 0.6875rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          padding: 0.125rem 0.5rem;
          border-radius: 999px;
          background: var(--muted, #f3f4f6);
          color: var(--muted-foreground, #6b7280);
        }
        .status-active {
          background: #d1fae5;
          color: #065f46;
        }
        .status-canceled {
          background: #fee2e2;
          color: #991b1b;
        }
        .price {
          margin-left: auto;
          font-variant-numeric: tabular-nums;
          color: var(--muted-foreground, #6b7280);
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof Subscription> {
    <template>
      <span class='subscription-atom'>
        <RefreshIcon class='sa-icon' />
        <span class='sa-name'>{{@model.cardTitle}}</span>
      </span>
      <style scoped>
        .subscription-atom {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          font-size: 0.8125rem;
          font-weight: 500;
          color: var(--foreground, #111111);
        }
        .sa-icon {
          width: 14px;
          height: 14px;
          color: var(--muted-foreground, #6b7280);
          flex-shrink: 0;
        }
        .sa-name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof Subscription> {
    get price() {
      let p = formatMoney(
        this.args.model?.price?.amount,
        this.args.model?.price?.currency?.code,
      );
      if (!p) return '—';
      return this.args.model?.billingCycle
        ? `${p} / ${this.args.model.billingCycle}`
        : p;
    }
    <template>
      <div class='fitted'>
        <div class='fmt badge'>
          <RefreshIcon class='doc-icon' />
          <span class='name'>{{@model.cardTitle}}</span>
          {{#if @model.status}}
            <span class='status status-{{@model.status}}'>{{@model.status}}</span>
          {{/if}}
        </div>
        <div class='fmt strip'>
          <RefreshIcon class='doc-icon' />
          <div class='info'>
            <span class='name'>{{@model.cardTitle}}</span>
            {{#if @model.status}}
              <span
                class='status status-{{@model.status}}'
              >{{@model.status}}</span>
            {{/if}}
          </div>
          <span class='figure'>{{this.price}}</span>
        </div>
        <div class='fmt tile'>
          <div class='row'>
            <RefreshIcon class='doc-icon' />
            {{#if @model.status}}
              <span
                class='status status-{{@model.status}}'
              >{{@model.status}}</span>
            {{/if}}
          </div>
          <span class='name'>{{@model.cardTitle}}</span>
          <span class='figure figure-lg'>{{this.price}}</span>
          {{#if @model.startDate}}
            <span class='meta'>Since <@fields.startDate /></span>
          {{/if}}
        </div>
        <div class='fmt card'>
          <div class='col'>
            <div class='row'>
              <RefreshIcon class='doc-icon' />
              <span class='name name-lg'>{{@model.cardTitle}}</span>
              {{#if @model.status}}
                <span
                  class='status status-{{@model.status}}'
                >{{@model.status}}</span>
              {{/if}}
            </div>
            {{#if @model.customer.name}}
              <span class='meta'>{{@model.customer.name}}</span>
            {{/if}}
            {{#if @model.startDate}}
              <span class='meta'>Since <@fields.startDate /></span>
            {{/if}}
          </div>
          <span class='figure figure-lg'>{{this.price}}</span>
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
        .name {
          font-weight: 600;
          font-size: 0.8125rem;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          max-width: 100%;
        }
        .name-lg {
          font-size: 0.9375rem;
        }
        .figure {
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          font-size: 0.875rem;
          white-space: nowrap;
        }
        .figure-lg {
          font-size: 1.125rem;
        }
        .meta {
          font-size: 0.6875rem;
          color: var(--muted-foreground, #6b7280);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          max-width: 100%;
        }
        .status {
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
        .status-active {
          background: #d1fae5;
          color: #065f46;
        }
        .status-canceled {
          background: #fee2e2;
          color: #991b1b;
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
          .strip .status {
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
          .tile .row {
            width: 100%;
            justify-content: space-between;
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

  static isolated = class Isolated extends Component<typeof Subscription> {
    get price() {
      return formatMoney(
        this.args.model?.price?.amount,
        this.args.model?.price?.currency?.code,
      );
    }
    <template>
      <article class='subscription-page'>
        <header>
          <h1>{{@model.cardTitle}}</h1>
          <span class='status status-{{@model.status}}'>{{@model.status}}</span>
        </header>
        <section class='panel'>
          <dl>
            <dt>Price</dt>
            <dd>{{this.price}} / {{@model.billingCycle}}</dd>
            <dt>Started</dt>
            <dd><@fields.startDate /></dd>
            <dt>Customer</dt>
            <dd><@fields.customer @format='embedded' /></dd>
          </dl>
        </section>
      </article>
      <style scoped>
        .subscription-page {
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
        .status {
          font-size: 0.6875rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          padding: 0.1875rem 0.625rem;
          border-radius: 999px;
          background: var(--muted, #f3f4f6);
          color: var(--muted-foreground, #6b7280);
        }
        .status-active {
          background: #d1fae5;
          color: #065f46;
        }
        .status-canceled {
          background: #fee2e2;
          color: #991b1b;
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
      </style>
    </template>
  };
}
