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

  static atom = class Atom extends Component<typeof Order> {
    <template>
      <span class='order-atom'>
        <PackageIcon class='oa-icon' />
        <span class='oa-name'>{{@model.cardTitle}}</span>
      </span>
      <style scoped>
        .order-atom {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          font-size: 0.8125rem;
          font-weight: 500;
          color: var(--foreground, #111111);
        }
        .oa-icon {
          width: 14px;
          height: 14px;
          color: var(--muted-foreground, #6b7280);
          flex-shrink: 0;
        }
        .oa-name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof Order> {
    get total() {
      const { total, code } = sumLineItems(this.args.model?.lineItems);
      return formatMoney(total, code) || '—';
    }
    get destination() {
      let a = this.args.model?.shippingAddress;
      return [a?.city, a?.country?.name].filter(Boolean).join(', ');
    }
    <template>
      <div class='fitted'>
        <div class='fmt badge'>
          <PackageIcon class='doc-icon' />
          <span class='name'>{{@model.cardTitle}}</span>
          {{#if @model.status}}
            <span class='status status-{{@model.status}}'>{{@model.status}}</span>
          {{/if}}
        </div>
        <div class='fmt strip'>
          <PackageIcon class='doc-icon' />
          <div class='info'>
            <span class='name'>{{@model.cardTitle}}</span>
            {{#if @model.status}}
              <span
                class='status status-{{@model.status}}'
              >{{@model.status}}</span>
            {{/if}}
          </div>
          <span class='figure'>{{this.total}}</span>
        </div>
        <div class='fmt tile'>
          <div class='row'>
            <PackageIcon class='doc-icon' />
            {{#if @model.status}}
              <span
                class='status status-{{@model.status}}'
              >{{@model.status}}</span>
            {{/if}}
          </div>
          <span class='name'>{{@model.cardTitle}}</span>
          <span class='figure figure-lg'>{{this.total}}</span>
          {{#if this.destination}}
            <span class='meta'>To {{this.destination}}</span>
          {{/if}}
        </div>
        <div class='fmt card'>
          <div class='col'>
            <div class='row'>
              <PackageIcon class='doc-icon' />
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
            {{#if this.destination}}
              <span class='meta'>To {{this.destination}}</span>
            {{/if}}
          </div>
          <span class='figure figure-lg'>{{this.total}}</span>
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
          font-size: 1.25rem;
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
        .status-delivered {
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
          font-family: var(--font-heading, inherit);
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
