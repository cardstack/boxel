import {
  CardDef,
  Component,
  contains,
  containsMany,
  field,
  linksTo,
  linksToMany,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import BooleanField from 'https://cardstack.com/base/boolean';
import DateField from 'https://cardstack.com/base/date';
import enumField from 'https://cardstack.com/base/enum';
import { eq } from '@cardstack/boxel-ui/helpers';
import FileInvoiceIcon from '@cardstack/boxel-icons/file-invoice';
import { Account } from './account';
import { User } from './user';
import { LineItem } from './line-item';
import { Order } from './order';
import { Subscription } from './subscription';
import { Payment } from './payment';
import { formatMoney, lineTotal, sumLineItems } from './money';

// Overdue is not a state anyone sets — it is what being unpaid past the due
// date looks like, so it is derived rather than stored and cannot drift from
// the balance and the calendar.
const InvoiceStatusField = enumField(StringField, {
  options: ['draft', 'sent', 'viewed', 'partial', 'paid', 'void'],
  displayName: 'Invoice Status',
});

export class Invoice extends CardDef {
  static displayName = 'Invoice';
  static icon = FileInvoiceIcon;

  @field invoiceNumber = contains(StringField);
  @field account = linksTo(Account);
  @field owner = linksTo(User);
  @field issueDate = contains(DateField);
  @field sentDate = contains(DateField);
  @field dueDate = contains(DateField);
  @field status = contains(InvoiceStatusField);
  @field lineItems = containsMany(LineItem);
  @field order = linksTo(() => Order);
  @field subscription = linksTo(() => Subscription);
  @field payments = linksToMany(() => Payment);

  @field daysOverdue = contains(NumberField, {
    computeVia: function (this: Invoice) {
      if (!this.dueDate) return 0;
      if (['paid', 'void'].includes(this.status ?? '')) return 0;
      let days = Math.floor(
        (Date.now() - new Date(this.dueDate).getTime()) / 86400000,
      );
      return days > 0 ? days : 0;
    },
  });

  @field isOverdue = contains(BooleanField, {
    computeVia: function (this: Invoice) {
      return (this.daysOverdue ?? 0) > 0;
    },
  });

  // What every consumer should render and filter on: the stored status except
  // when the calendar overrides it.
  @field displayStatus = contains(StringField, {
    computeVia: function (this: Invoice) {
      return this.isOverdue ? 'overdue' : this.status;
    },
  });

  @field cardTitle = contains(StringField, {
    computeVia: function (this: Invoice) {
      return this.invoiceNumber?.trim()?.length
        ? `Invoice ${this.invoiceNumber}`
        : `Untitled ${this.constructor.displayName}`;
    },
  });

  static embedded = class Embedded extends Component<typeof Invoice> {
    get total() {
      const { total, code } = sumLineItems(this.args.model?.lineItems);
      return formatMoney(total, code);
    }
    <template>
      <div class='invoice-row'>
        <FileInvoiceIcon class='icon' />
        <span class='number'>{{@model.cardTitle}}</span>
        <span class='status status-{{@model.displayStatus}}'>{{@model.displayStatus}}</span>
        <span class='total'>{{this.total}}</span>
      </div>
      <style scoped>
        .invoice-row {
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
        .status-paid {
          background: var(--state-paid-bg, #d1fae5);
          color: var(--state-paid-fg, #065f46);
        }
        .status-partial {
          background: var(--state-partial-bg, #fef3c7);
          color: var(--state-partial-fg, #92400e);
        }
        .status-overdue {
          background: var(--state-overdue-bg, #fee2e2);
          color: var(--state-overdue-fg, #991b1b);
        }
        .total {
          margin-left: auto;
          font-weight: 600;
          font-variant-numeric: tabular-nums;
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof Invoice> {
    <template>
      <span class='invoice-atom'>
        <FileInvoiceIcon class='ia-icon' />
        <span class='ia-name'>{{@model.cardTitle}}</span>
      </span>
      <style scoped>
        .invoice-atom {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          font-size: 0.8125rem;
          font-weight: 500;
          color: var(--foreground, #111111);
        }
        .ia-icon {
          width: 14px;
          height: 14px;
          color: var(--muted-foreground, #6b7280);
          flex-shrink: 0;
        }
        .ia-name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof Invoice> {
    get total() {
      const { total, code } = sumLineItems(this.args.model?.lineItems);
      return formatMoney(total, code) || '—';
    }
    get itemCount() {
      return this.args.model?.lineItems?.length ?? 0;
    }
    <template>
      <div class='fitted'>
        <div class='fmt badge'>
          <FileInvoiceIcon class='doc-icon' />
          <span class='name'>{{@model.cardTitle}}</span>
          {{#if @model.displayStatus}}
            <span class='status status-{{@model.displayStatus}}'>{{@model.displayStatus}}</span>
          {{/if}}
        </div>
        <div class='fmt strip'>
          <FileInvoiceIcon class='doc-icon' />
          <div class='info'>
            <span class='name'>{{@model.cardTitle}}</span>
            {{#if @model.displayStatus}}
              <span
                class='status status-{{@model.displayStatus}}'
              >{{@model.displayStatus}}</span>
            {{/if}}
          </div>
          <span class='figure'>{{this.total}}</span>
        </div>
        <div class='fmt tile'>
          <div class='row'>
            <FileInvoiceIcon class='doc-icon' />
            {{#if @model.displayStatus}}
              <span
                class='status status-{{@model.displayStatus}}'
              >{{@model.displayStatus}}</span>
            {{/if}}
          </div>
          <span class='name'>{{@model.cardTitle}}</span>
          <span class='figure figure-lg'>{{this.total}}</span>
          {{#if @model.dueDate}}
            <span class='meta'>Due <@fields.dueDate /></span>
          {{/if}}
        </div>
        <div class='fmt card'>
          <div class='col'>
            <div class='row'>
              <FileInvoiceIcon class='doc-icon' />
              <span class='name name-lg'>{{@model.cardTitle}}</span>
              {{#if @model.displayStatus}}
                <span
                  class='status status-{{@model.displayStatus}}'
                >{{@model.displayStatus}}</span>
              {{/if}}
            </div>
            {{#if @model.account.name}}
              <span class='meta'>Billed to {{@model.account.name}}</span>
            {{/if}}
            <span class='meta'>{{this.itemCount}}
              item{{unless (eq this.itemCount 1) 's'}}{{#if @model.dueDate}}
                · due
                <@fields.dueDate />{{/if}}</span>
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
        .status-paid {
          background: var(--state-paid-bg, #d1fae5);
          color: var(--state-paid-fg, #065f46);
        }
        .status-partial {
          background: var(--state-partial-bg, #fef3c7);
          color: var(--state-partial-fg, #92400e);
        }
        .status-overdue {
          background: var(--state-overdue-bg, #fee2e2);
          color: var(--state-overdue-fg, #991b1b);
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

  static isolated = class Isolated extends Component<typeof Invoice> {
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
      const { total, code } = sumLineItems(this.args.model?.lineItems);
      return formatMoney(total, code) || '\u2014';
    }
    get number() {
      return this.args.model?.invoiceNumber?.trim() || 'Draft';
    }
    get paidSum() {
      let sum = 0;
      let code: string | undefined;
      for (let p of this.args.model?.payments ?? []) {
        sum += p?.amount?.amount ?? 0;
        code = code ?? p?.amount?.currency?.code ?? undefined;
      }
      return { sum, code };
    }
    get amountPaid() {
      let { sum, code } = this.paidSum;
      return sum ? formatMoney(sum, code) : '';
    }
    get balance() {
      const { total, code } = sumLineItems(this.args.model?.lineItems);
      let due = total - this.paidSum.sum;
      return formatMoney(due > 0 ? due : 0, this.paidSum.code ?? code);
    }
    <template>
      <article class='invoice-doc'>
        <header class='doc-head'>
          <div>
            <p class='doc-kind'>Invoice</p>
            <h1>{{this.number}}</h1>
          </div>
          {{#if @model.displayStatus}}
            <span class='status status-{{@model.displayStatus}}'>{{@model.displayStatus}}</span>
          {{/if}}
        </header>

        <section class='doc-meta'>
          <div class='party'>
            <span class='label'>Billed to</span>
            <@fields.account @format='embedded' />
          </div>
          <dl class='dates'>
            <dt>Issued</dt>
            <dd><@fields.issueDate /></dd>
            {{#if @model.sentDate}}
              <dt>Sent</dt>
              <dd><@fields.sentDate /></dd>
            {{/if}}
            <dt>Due</dt>
            <dd><@fields.dueDate /></dd>
            {{#if @model.daysOverdue}}
              <dt>Overdue</dt>
              <dd class='overdue-days'>{{@model.daysOverdue}} days</dd>
            {{/if}}
            {{#if @model.owner}}
              <dt>Owner</dt>
              <dd><@fields.owner @format='atom' /></dd>
            {{/if}}
            {{#if @model.order}}
              <dt>Order</dt>
              <dd><@fields.order @format='atom' /></dd>
            {{/if}}
            {{#if @model.subscription}}
              <dt>Subscription</dt>
              <dd><@fields.subscription @format='atom' /></dd>
            {{/if}}
          </dl>
        </section>

        <section class='items'>
          {{#if this.rows.length}}
            <div class='table-scroll'>
              <table>
                <thead>
                  <tr>
                    <th class='t-desc'>Description</th>
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
                  <tr>
                    <td class='t-desc' colspan='3'>Total</td>
                    <td class='t-num t-total'>{{this.total}}</td>
                  </tr>
                  {{#if this.amountPaid}}
                    <tr class='sub-row'>
                      <td class='t-desc' colspan='3'>Paid</td>
                      <td class='t-num'>{{this.amountPaid}}</td>
                    </tr>
                    <tr class='sub-row'>
                      <td class='t-desc' colspan='3'>Balance due</td>
                      <td class='t-num t-strong'>{{this.balance}}</td>
                    </tr>
                  {{/if}}
                </tfoot>
              </table>
            </div>
          {{else}}
            <p class='empty'>No line items yet</p>
          {{/if}}
        </section>

        {{#if @model.payments.length}}
          <section class='payments'>
            <span class='label'>Payments</span>
            <@fields.payments @format='embedded' />
          </section>
        {{/if}}
      </article>
      <style scoped>
        .invoice-doc {
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
        .status-paid {
          background: var(--state-paid-bg, #d1fae5);
          color: var(--state-paid-fg, #065f46);
        }
        .status-partial {
          background: var(--state-partial-bg, #fef3c7);
          color: var(--state-partial-fg, #92400e);
        }
        .status-overdue {
          background: var(--state-overdue-bg, #fee2e2);
          color: var(--state-overdue-fg, #991b1b);
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
        .dates {
          margin: 0;
          display: grid;
          grid-template-columns: auto auto;
          gap: 0.375rem 1rem;
          font-size: 0.875rem;
          text-align: right;
        }
        .dates dt {
          color: var(--muted-foreground, #6b7280);
        }
        .dates dd {
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
        .overdue-days {
          color: var(--state-overdue-fg, #991b1b);
          font-weight: 600;
        }
        .sub-row td {
          border-top: none;
          padding-top: 0.25rem;
          font-weight: 500;
        }
        .payments .label {
          margin-bottom: 0.375rem;
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
      </style>
    </template>
  };
}
