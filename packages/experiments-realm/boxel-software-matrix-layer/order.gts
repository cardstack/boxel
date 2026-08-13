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
import PercentageField from 'https://cardstack.com/base/percentage';
import { Account } from './account';
import { Contract } from './contract';
import { LineItem } from './line-item';
import { formatMoney, lineTotal, orderTotals, sumLineItems } from './money';

const OrderStatusField = enumField(StringField, {
  options: ['pending', 'paid', 'shipped', 'delivered', 'canceled'],
  displayName: 'Order Status',
});

export class Order extends CardDef {
  static displayName = 'Order';
  static icon = PackageIcon;

  @field orderNumber = contains(StringField);
  @field account = linksTo(Account);
  @field orderDate = contains(DateField);
  @field shippingAddress = contains(AddressField);
  @field status = contains(OrderStatusField);
  @field lineItems = containsMany(LineItem);
  @field taxRate = contains(PercentageField);
  // The agreement this order is placed under, when there is one.
  @field contract = linksTo(() => Contract);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: Order) {
      return this.orderNumber?.trim()?.length
        ? `Order ${this.orderNumber}`
        : `Untitled ${this.constructor.displayName}`;
    },
  });

  static embedded = class Embedded extends Component<typeof Order> {
    get total() {
      const { total, code } = orderTotals(
        this.args.model?.lineItems,
        this.args.model?.taxRate,
      );
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
      const { total, code } = orderTotals(
        this.args.model?.lineItems,
        this.args.model?.taxRate,
      );
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
            {{#if @model.account.name}}
              <span class='meta'>{{@model.account.name}}</span>
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
    fulfilmentSteps = ['pending', 'paid', 'shipped', 'delivered'];
    get steps() {
      let current = this.fulfilmentSteps.indexOf(
        this.args.model?.status ?? '',
      );
      return this.fulfilmentSteps.map((label, i) => ({
        label,
        state:
          current < 0
            ? 'todo'
            : i < current
              ? 'done'
              : i === current
                ? 'current'
                : 'todo',
      }));
    }
    get isCanceled() {
      return this.args.model?.status === 'canceled';
    }
    get rows() {
      return (this.args.model?.lineItems ?? []).map((item) => ({
        description: item?.description || '\u2014',
        quantity: item?.quantity ?? 0,
        unit: formatMoney(
          item?.unitPrice?.amount,
          item?.unitPrice?.currency?.code,
        ),
        total: formatMoney(lineTotal(item), item?.unitPrice?.currency?.code),
      }));
    }
    get total() {
      const { total, code } = orderTotals(
        this.args.model?.lineItems,
        this.args.model?.taxRate,
      );
      return formatMoney(total, code) || '\u2014';
    }
    get number() {
      return this.args.model?.orderNumber?.trim() || 'Draft';
    }
    get totals() {
      return orderTotals(this.args.model?.lineItems, this.args.model?.taxRate);
    }
    get subtotalDisplay() {
      return formatMoney(this.totals.subtotal, this.totals.code);
    }
    get taxDisplay() {
      return this.totals.tax
        ? formatMoney(this.totals.tax, this.totals.code)
        : '';
    }
    <template>
      <article class='order-doc'>
        <header class='doc-head'>
          <div>
            <p class='doc-kind'>Order</p>
            <h1>{{this.number}}</h1>
          </div>
          {{#if this.isCanceled}}
            <span class='status status-canceled'>canceled</span>
          {{/if}}
        </header>

        {{#unless this.isCanceled}}
          <ol class='stepper'>
            {{#each this.steps as |step|}}
              <li class='step step-{{step.state}}'>
                <span class='dot'></span>
                <span class='step-label'>{{step.label}}</span>
              </li>
            {{/each}}
          </ol>
        {{/unless}}

        <section class='doc-meta'>
          <div class='party'>
            <span class='label'>Account</span>
            <@fields.account @format='embedded' />
          </div>
          <dl class='facts'>
            <dt>Ordered</dt>
            <dd><@fields.orderDate /></dd>
          </dl>
        </section>

        <section class='items'>
          {{#if this.rows.length}}
            <div class='table-scroll'>
              <table>
                <thead>
                  <tr>
                    <th class='t-desc'>Item</th>
                    <th class='t-num'>Qty</th>
                    <th class='t-num'>Unit</th>
                    <th class='t-num'>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {{#each this.rows as |row|}}
                    <tr>
                      <td class='t-desc'>{{row.description}}</td>
                      <td class='t-num'>{{row.quantity}}</td>
                      <td class='t-num'>{{row.unit}}</td>
                      <td class='t-num t-strong'>{{row.total}}</td>
                    </tr>
                  {{/each}}
                </tbody>
                <tfoot>
                  {{#if this.taxDisplay}}
                    <tr class='sub-row'>
                      <td class='t-desc' colspan='3'>Subtotal</td>
                      <td class='t-num'>{{this.subtotalDisplay}}</td>
                    </tr>
                    <tr class='sub-row'>
                      <td class='t-desc' colspan='3'>Tax ({{@model.taxRate}}%)</td>
                      <td class='t-num'>{{this.taxDisplay}}</td>
                    </tr>
                  {{/if}}
                  <tr>
                    <td class='t-desc' colspan='3'>Total</td>
                    <td class='t-num t-total'>{{this.total}}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          {{else}}
            <p class='empty'>No items yet</p>
          {{/if}}
        </section>

        <section class='ship'>
          <span class='label'>Ship to</span>
          <@fields.shippingAddress />
        </section>
      </article>
      <style scoped>
        .order-doc {
          max-width: 46rem;
          margin: 0 auto;
          padding: 2rem 1.5rem;
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }
        .doc-head {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 1rem;
          border-bottom: 2px solid var(--foreground, #111111);
          padding-bottom: 1rem;
        }
        .doc-kind {
          margin: 0 0 0.125rem;
          font-size: 0.6875rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.14em;
          color: var(--muted-foreground, #6b7280);
        }
        h1 {
          margin: 0;
          font-size: 1.75rem;
          line-height: 1.1;
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
          margin-bottom: 0.25rem;
        }
        .status-canceled {
          background: #fee2e2;
          color: #991b1b;
        }
        .stepper {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
        }
        .step {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.375rem;
          position: relative;
        }
        .step:not(:first-child)::before {
          content: '';
          position: absolute;
          top: 0.4375rem;
          right: 50%;
          width: 100%;
          height: 2px;
          background: var(--border, #e5e7eb);
        }
        .step-done:not(:first-child)::before,
        .step-current:not(:first-child)::before {
          background: var(--primary, #111111);
        }
        .dot {
          width: 0.9375rem;
          height: 0.9375rem;
          border-radius: 50%;
          background: var(--card, #ffffff);
          border: 2px solid var(--border, #e5e7eb);
          position: relative;
          z-index: 1;
        }
        .step-done .dot {
          background: var(--primary, #111111);
          border-color: var(--primary, #111111);
        }
        .step-current .dot {
          border-color: var(--primary, #111111);
          box-shadow: 0 0 0 3px
            color-mix(in srgb, var(--primary, #111111) 20%, transparent);
        }
        .step-label {
          font-size: 0.6875rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--muted-foreground, #6b7280);
        }
        .step-current .step-label {
          color: var(--foreground, #111111);
        }
        .doc-meta {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 1.5rem;
          flex-wrap: wrap;
        }
        .party {
          flex: 1 1 20rem;
          min-width: 15rem;
          max-width: 26rem;
        }
        .label {
          display: block;
          font-size: 0.6875rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: var(--muted-foreground, #6b7280);
          margin-bottom: 0.375rem;
        }
        .facts {
          margin: 0;
          display: grid;
          grid-template-columns: auto auto;
          gap: 0.375rem 1rem;
          font-size: 0.875rem;
          text-align: right;
          align-items: center;
        }
        .facts dt {
          color: var(--muted-foreground, #6b7280);
        }
        .facts dd {
          margin: 0;
          font-weight: 500;
        }
        .table-scroll {
          overflow-x: auto;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.875rem;
        }
        th {
          font-size: 0.6875rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--muted-foreground, #6b7280);
          padding: 0 0.5rem 0.5rem;
          border-bottom: 1px solid var(--border, #e5e7eb);
        }
        td {
          padding: 0.625rem 0.5rem;
          border-bottom: 1px solid var(--border, #e5e7eb);
          vertical-align: baseline;
        }
        .t-desc {
          text-align: left;
        }
        .t-num {
          text-align: right;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }
        .t-strong {
          font-weight: 600;
        }
        tbody tr:last-child td {
          border-bottom: none;
        }
        tfoot td {
          border-bottom: none;
          border-top: 2px solid var(--foreground, #111111);
          padding-top: 0.75rem;
          font-weight: 700;
        }
        .t-total {
          font-size: 1.125rem;
        }
        .sub-row td {
          border-top: none;
          padding-top: 0.25rem;
          font-weight: 500;
        }
        tfoot .sub-row:first-child td {
          border-top: 2px solid var(--foreground, #111111);
          padding-top: 0.75rem;
        }
        .empty {
          margin: 0;
          padding: 1.5rem;
          text-align: center;
          border: 1px dashed var(--border, #e5e7eb);
          border-radius: 0.5rem;
          color: var(--muted-foreground, #6b7280);
          font-size: 0.8125rem;
        }
        .ship {
          border: 1px solid var(--border, #e5e7eb);
          border-radius: 0.5rem;
          padding: 1rem;
          background: var(--card, #ffffff);
        }
      </style>
    </template>
  };
}
