import {
  CardDef,
  Component,
  contains,
  containsMany,
  field,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import DateField from 'https://cardstack.com/base/date';
import AddressField from 'https://cardstack.com/base/address';
import enumField from 'https://cardstack.com/base/enum';
import PackageIcon from '@cardstack/boxel-icons/package';
import { Customer } from './customer';
import { Invoice } from './invoice';
import { LineItem } from './line-item';
import { formatMoney, sumLineItems } from './money';

const OrderStatusField = enumField(StringField, {
  options: ['pending', 'paid', 'shipped', 'delivered', 'canceled'],
  displayName: 'Order Status',
});

export class Order extends CardDef {
  static displayName = 'Order';
  static icon = PackageIcon;

  @field orderNumber = contains(StringField);
  @field customer = linksTo(Customer);
  @field invoice = linksTo(Invoice);
  @field orderDate = contains(DateField);
  @field shippingAddress = contains(AddressField);
  @field status = contains(OrderStatusField);
  @field lineItems = containsMany(LineItem);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: Order) {
      return this.orderNumber?.trim()?.length
        ? `Order ${this.orderNumber}`
        : `Untitled ${this.constructor.displayName}`;
    },
  });

  static embedded = class Embedded extends Component<typeof Order> {
    get total() {
      const { total, code } = sumLineItems(this.args.model?.lineItems);
      return formatMoney(total, code);
    }
    <template>
      <div class='order-row'>
        <PackageIcon class='icon' />
        <span class='number'>{{@model.cardTitle}}</span>
        <span class='status status-{{@model.status}}'>{{@model.status}}</span>
        <span class='total'>{{this.total}}</span>
      </div>
      <style scoped>
        .order-row {
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
        .number {
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
        .status-delivered {
          background: #d1fae5;
          color: #065f46;
        }
        .status-canceled {
          background: #fee2e2;
          color: #991b1b;
        }
        .total {
          margin-left: auto;
          font-weight: 600;
          font-variant-numeric: tabular-nums;
        }
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof Order> {
    get total() {
      const { total, code } = sumLineItems(this.args.model?.lineItems);
      return formatMoney(total, code);
    }
    get hasLineItems() {
      return (this.args.model?.lineItems?.length ?? 0) > 0;
    }
    <template>
      <article class='order-page'>
        <header>
          <h1>{{@model.cardTitle}}</h1>
          <span class='status status-{{@model.status}}'>{{@model.status}}</span>
        </header>
        <section class='meta'>
          <div>
            <span class='label'>Customer</span>
            <@fields.customer @format='embedded' />
          </div>
          <dl>
            <dt>Ordered</dt>
            <dd><@fields.orderDate /></dd>
            <dt>Invoice</dt>
            <dd><@fields.invoice @format='embedded' /></dd>
          </dl>
        </section>
        <section class='panel'>
          <h2>Items</h2>
          {{#if this.hasLineItems}}
            <@fields.lineItems />
            <div class='total-row'>
              <span>Total</span>
              <strong>{{this.total}}</strong>
            </div>
          {{else}}
            <p class='empty'>No items yet</p>
          {{/if}}
        </section>
        <section class='panel'>
          <h2>Ship To</h2>
          <@fields.shippingAddress />
        </section>
      </article>
      <style scoped>
        .order-page {
          padding: 1.5rem;
          display: flex;
          flex-direction: column;
          gap: 1rem;
          max-width: 44rem;
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
        .status-delivered {
          background: #d1fae5;
          color: #065f46;
        }
        .status-canceled {
          background: #fee2e2;
          color: #991b1b;
        }
        .meta {
          display: flex;
          justify-content: space-between;
          align-items: start;
          gap: 1rem;
          flex-wrap: wrap;
        }
        .meta > div {
          flex: 1 1 22rem;
          min-width: 16rem;
          max-width: 28rem;
        }
        .meta dl {
          flex: 1 1 24rem;
        }
        .label {
          display: block;
          font-size: 0.75rem;
          color: var(--muted-foreground, #6b7280);
          margin-bottom: 0.25rem;
        }
        dl {
          margin: 0;
          display: grid;
          grid-template-columns: auto 1fr;
          gap: 0.25rem 0.75rem;
          font-size: 0.875rem;
          align-items: center;
        }
        dt {
          color: var(--muted-foreground, #6b7280);
        }
        dd {
          margin: 0;
        }
        .panel {
          border: 1px solid var(--border, #e5e7eb);
          border-radius: 0.75rem;
          padding: 1rem;
          background: var(--card, #ffffff);
        }
        h2 {
          margin: 0 0 0.75rem;
          font-size: 0.8125rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--muted-foreground, #6b7280);
        }
        .total-row {
          display: flex;
          justify-content: space-between;
          border-top: 1px solid var(--border, #e5e7eb);
          margin-top: 0.5rem;
          padding-top: 0.625rem;
          font-size: 0.9375rem;
        }
        .empty {
          margin: 0;
          color: var(--muted-foreground, #6b7280);
          font-size: 0.8125rem;
        }
      </style>
    </template>
  };
}
