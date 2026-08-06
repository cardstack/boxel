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
