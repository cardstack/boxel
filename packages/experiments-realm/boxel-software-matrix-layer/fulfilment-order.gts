import {
  CardDef,
  Component,
  StringField,
  contains,
  containsMany,
  field,
  linksTo,
} from '@cardstack/base/card-api';
import NumberField from '@cardstack/base/number';
import DatetimeField from '@cardstack/base/datetime';
import AddressField from '@cardstack/base/address';
import EmailField from '@cardstack/base/email';
import AmountWithCurrency from '@cardstack/base/amount-with-currency';
import CurrencyField from '@cardstack/base/currency';
import enumField from '@cardstack/base/enum';
import MarkdownField from '@cardstack/base/markdown';
import { htmlSafe } from '@ember/template';
import ReceiptIcon from '@cardstack/boxel-icons/receipt';
import { FulfilmentLineItemField } from './fulfilment-line-item';
import { OrderStatusField, orderStatusStyle, orderProgress } from './order-status';
import { Warehouse } from './warehouse';
import StatusChip from './fulfilment-status-chip';

// Where the order came from. v1 enters orders by hand; the field exists now so
// that an integration later is a new option rather than a migration.
export const ORDER_SOURCES = [
  { value: 'manual', label: 'Manual entry' },
  { value: 'shopify', label: 'Shopify' },
  { value: 'woocommerce', label: 'WooCommerce' },
  { value: 'amazon', label: 'Amazon' },
  { value: 'api', label: 'API' },
];

export const OrderSourceField = enumField(StringField, {
  options: ORDER_SOURCES,
  displayName: 'Order Source',
});

export const PAYMENT_STATUSES = [
  { value: 'paid', label: 'Paid' },
  { value: 'pending', label: 'Pending' },
  { value: 'partial', label: 'Partially paid' },
  { value: 'refunded', label: 'Refunded' },
];

export const PaymentStatusField = enumField(StringField, {
  options: PAYMENT_STATUSES,
  displayName: 'Payment Status',
});

export const ORDER_PRIORITIES = [
  { value: 'normal', label: 'Normal' },
  { value: 'express', label: 'Express' },
  { value: 'rush', label: 'Rush' },
];

export const OrderPriorityField = enumField(StringField, {
  options: ORDER_PRIORITIES,
  displayName: 'Priority',
});

// Order (Or) — what the customer bought, and how far it has got.
//
// Money is computed, never stored: subtotal comes from the lines, total from
// subtotal plus shipping plus tax. A stored total is a number that can disagree
// with the rows above it, and eventually does.
//
// `fulfilledAt` is an event fact — the datetime the order first completed,
// written once by the FulfilOrder command. "Is it fulfilled" is then a question
// about that date rather than a second flag that can drift out of step.
export class FulfilmentOrder extends CardDef {
  static displayName = 'Order';
  static icon = ReceiptIcon;

  @field orderNumber = contains(StringField);
  @field source = contains(OrderSourceField);
  @field externalId = contains(StringField);

  @field customerName = contains(StringField);
  @field customerEmail = contains(EmailField);
  @field shippingAddress = contains(AddressField);
  @field billingAddress = contains(AddressField);

  @field lineItems = containsMany(FulfilmentLineItemField);

  @field shippingCost = contains(AmountWithCurrency);
  @field tax = contains(AmountWithCurrency);

  @field status = contains(OrderStatusField);
  @field paymentStatus = contains(PaymentStatusField);
  @field priority = contains(OrderPriorityField);

  @field allocatedWarehouse = linksTo(() => Warehouse);
  @field notes = contains(MarkdownField);
  @field tags = containsMany(StringField);

  @field placedAt = contains(DatetimeField);
  @field fulfilledAt = contains(DatetimeField);

  @field subtotal = contains(AmountWithCurrency, {
    computeVia: function (this: FulfilmentOrder) {
      let result = new AmountWithCurrency();
      let currency = new CurrencyField();
      currency.code = this.currencyCode ?? 'USD';
      result.currency = currency;
      result.amount = (this.lineItems ?? []).reduce(
        (sum, line) =>
          sum + (line?.unitPrice?.amount ?? 0) * (line?.quantity ?? 0),
        0,
      );
      return result;
    },
  });

  @field total = contains(AmountWithCurrency, {
    computeVia: function (this: FulfilmentOrder) {
      let result = new AmountWithCurrency();
      let currency = new CurrencyField();
      currency.code = this.currencyCode ?? 'USD';
      result.currency = currency;
      result.amount =
        (this.subtotal?.amount ?? 0) +
        (this.shippingCost?.amount ?? 0) +
        (this.tax?.amount ?? 0);
      return result;
    },
  });

  @field itemCount = contains(NumberField, {
    computeVia: function (this: FulfilmentOrder) {
      return (this.lineItems ?? []).reduce(
        (sum, line) => sum + (line?.quantity ?? 0),
        0,
      );
    },
  });

  // The order's currency is whatever its first priced line says. One order, one
  // currency — mixed-currency orders are explicitly out of scope for v1.
  @field currencyCode = contains(StringField, {
    computeVia: function (this: FulfilmentOrder) {
      let line = (this.lineItems ?? []).find(
        (l) => l?.unitPrice?.currency?.code,
      );
      return line?.unitPrice?.currency?.code;
    },
  });

  @field warehouseCode = contains(StringField, {
    computeVia: function (this: FulfilmentOrder) {
      return this.allocatedWarehouse?.code;
    },
  });

  @field cardTitle = contains(StringField, {
    computeVia: function (this: FulfilmentOrder) {
      return this.orderNumber?.length ? this.orderNumber : 'Untitled Order';
    },
  });

  get statusStyle() {
    return orderStatusStyle(this.status);
  }

  get progress() {
    return Math.round(orderProgress(this.status) * 100);
  }

  get isExpress() {
    return this.priority === 'express' || this.priority === 'rush';
  }

  get isFulfilled() {
    return this.fulfilledAt != null;
  }

  get shipToLabel() {
    let a = this.shippingAddress;
    if (!a) {
      return undefined;
    }
    return [a.city, a.postalCode].filter(Boolean).join(' ') || a.country?.name;
  }

  get lineSummary() {
    return (this.lineItems ?? []).slice(0, 3);
  }

  static isolated = class Isolated extends Component<typeof FulfilmentOrder> {
    <template>
      <article class='ord'>
        {{#if @model.isExpress}}
          <div class='flash' aria-hidden='true'></div>
        {{/if}}

        <header class='hd'>
          <div class='hd-id'>
            <span class='eyebrow'>Order</span>
            <h1 class='num'>{{@model.orderNumber}}</h1>
            <p class='cust'>
              {{if @model.customerName @model.customerName 'No customer name'}}
              {{#if @model.shipToLabel}}<span class='to'>→
                  {{@model.shipToLabel}}</span>{{/if}}
            </p>
          </div>
          <div class='hd-state'>
            <StatusChip
              @label={{@model.statusStyle.label}}
              @hue={{@model.statusStyle.hue}}
              @size='base'
            />
            {{#if @model.isExpress}}
              <span class='prio'><@fields.priority @format='atom' /></span>
            {{/if}}
          </div>
        </header>

        <div class='track' aria-hidden='true'>
          <span class='track-fill' style={{barWidth @model.progress}}></span>
        </div>

        <dl class='stats'>
          <div>
            <dt>Items</dt>
            <dd>{{@model.itemCount}}</dd>
          </div>
          <div>
            <dt>Total</dt>
            <dd><@fields.total @format='atom' /></dd>
          </div>
          <div>
            <dt>Warehouse</dt>
            <dd class='sm'>{{if @model.warehouseCode @model.warehouseCode 'Not allocated'}}</dd>
          </div>
          <div>
            <dt>Payment</dt>
            <dd class='sm'><@fields.paymentStatus @format='atom' /></dd>
          </div>
        </dl>

        <section class='sec'>
          <h2>Line items</h2>
          {{#if @model.lineItems.length}}
            <div class='li-head'>
              <span>Item</span><span>Qty</span><span>Unit</span><span>Total</span>
            </div>
            <@fields.lineItems @format='embedded' />
            <div class='totals'>
              <div><span>Subtotal</span><@fields.subtotal @format='atom' /></div>
              <div><span>Shipping</span>{{#if
                  @model.shippingCost.amount
                }}<@fields.shippingCost @format='atom' />{{else}}—{{/if}}</div>
              <div><span>Tax</span>{{#if @model.tax.amount}}<@fields.tax
                    @format='atom'
                  />{{else}}—{{/if}}</div>
              <div class='grand'><span>Total</span><@fields.total
                  @format='atom'
                /></div>
            </div>
          {{else}}
            <p class='empty'>No line items. An order with no lines cannot be
              picked — add at least one before allocating.</p>
          {{/if}}
        </section>

        <div class='cols'>
          <section class='sec'>
            <h2>Ship to</h2>
            <@fields.shippingAddress @format='embedded' />
          </section>
          <section class='sec'>
            <h2>Timeline</h2>
            <dl class='kv'>
              <div>
                <dt>Placed</dt>
                <dd><@fields.placedAt @format='atom' /></dd>
              </div>
              <div>
                <dt>Fulfilled</dt>
                <dd>{{#if @model.fulfilledAt}}<@fields.fulfilledAt
                      @format='atom'
                    />{{else}}Not yet{{/if}}</dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd><@fields.source @format='atom' /></dd>
              </div>
            </dl>
          </section>
        </div>

        {{#if @model.notes}}
          <section class='sec'>
            <h2>Notes</h2>
            <@fields.notes />
          </section>
        {{/if}}
      </article>

      <style scoped>
        .ord {
          --ful-bg: var(--background);
          --ful-fg: var(--foreground);
          --ful-muted-fg: var(--muted-foreground);
          --ful-border: var(--border);
          --ful-rule: color-mix(in oklch, var(--foreground) 12%, transparent);
          /* Named because no semantic token expresses it: the tear line down a
             shipping label. */
          --ful-perf: color-mix(in oklch, var(--foreground) 22%, transparent);

          position: relative;
          height: 100%;
          overflow-y: auto;
          padding: var(--boxel-sp-lg);
          background: var(--ful-bg, var(--boxel-light));
          color: var(--ful-fg, var(--boxel-dark));
          font-family: var(--font-sans, inherit);
        }
        /* Express orders get a rail down the left edge — the physical
           equivalent of the coloured tape a picker looks for. */
        .flash {
          position: absolute;
          inset: 0 auto 0 0;
          width: 4px;
          background: repeating-linear-gradient(
            -45deg,
            var(--ful-perf) 0 6px,
            transparent 6px 12px
          );
        }
        .hd {
          display: flex;
          flex-wrap: wrap;
          gap: var(--boxel-sp);
          justify-content: space-between;
          align-items: flex-start;
          padding-bottom: var(--boxel-sp);
          border-bottom: 2px dashed var(--ful-perf);
        }
        .eyebrow {
          font-size: 0.65rem;
          font-weight: 700;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: var(--ful-muted-fg, var(--boxel-500));
        }
        .num {
          margin: 2px 0 0;
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 2.1rem;
          line-height: 1;
          letter-spacing: -0.01em;
        }
        .cust {
          margin: 8px 0 0;
          font-size: 0.9rem;
          color: var(--ful-muted-fg, var(--boxel-500));
        }
        .to {
          margin-left: 6px;
        }
        .hd-state {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
        }
        .prio {
          font-size: 0.7rem;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          padding: 3px 8px;
          border-radius: 3px;
          color: var(--ful-fg, var(--boxel-dark));
          border: 1px dashed var(--ful-perf);
        }
        .track {
          height: 3px;
          margin-top: var(--boxel-sp);
          border-radius: 999px;
          background: color-mix(in oklch, var(--foreground) 10%, transparent);
          overflow: hidden;
        }
        .track-fill {
          display: block;
          height: 100%;
          background: color-mix(in oklch, var(--foreground) 55%, transparent);
        }
        .stats {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
          gap: var(--boxel-sp);
          margin: var(--boxel-sp) 0 0;
        }
        .stats div {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .stats dt {
          font-size: 0.65rem;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--ful-muted-fg, var(--boxel-500));
        }
        .stats dd {
          margin: 0;
          font-family: var(--font-mono, ui-monospace, monospace);
          font-variant-numeric: tabular-nums;
          font-size: 1.4rem;
          font-weight: 700;
        }
        .stats .sm {
          font-size: 0.9rem;
          font-weight: 600;
        }
        .sec {
          margin-top: var(--boxel-sp-lg);
        }
        .sec h2 {
          margin: 0 0 var(--boxel-sp-xs);
          font-size: 0.72rem;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--ful-muted-fg, var(--boxel-500));
        }
        .li-head {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 3rem 5.5rem 6rem;
          gap: var(--boxel-sp-xs);
          padding-bottom: 4px;
          border-bottom: 1px solid var(--ful-border, var(--boxel-border-color));
          font-size: 0.62rem;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--ful-muted-fg, var(--boxel-500));
        }
        .li-head span:nth-child(n + 2) {
          text-align: right;
        }
        .totals {
          margin-top: var(--boxel-sp-sm);
          padding-top: var(--boxel-sp-xs);
          border-top: 1px dashed var(--ful-perf);
          display: grid;
          gap: 4px;
          justify-content: end;
        }
        .totals div {
          display: grid;
          grid-template-columns: 6rem 6rem;
          gap: var(--boxel-sp-xs);
          font-size: 0.85rem;
          text-align: right;
          font-family: var(--font-mono, ui-monospace, monospace);
          font-variant-numeric: tabular-nums;
        }
        .totals span {
          text-align: left;
          font-family: var(--font-sans, inherit);
          color: var(--ful-muted-fg, var(--boxel-500));
        }
        .grand {
          font-weight: 800;
          font-size: 1rem;
          padding-top: 4px;
          border-top: 1px solid var(--ful-border, var(--boxel-border-color));
        }
        .cols {
          display: grid;
          gap: var(--boxel-sp-lg);
          grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
        }
        .kv {
          display: grid;
          gap: 6px;
          margin: 0;
        }
        .kv div {
          display: grid;
          grid-template-columns: 6rem minmax(0, 1fr);
          gap: var(--boxel-sp-xs);
        }
        .kv dt {
          font-size: 0.8rem;
          color: var(--ful-muted-fg, var(--boxel-500));
        }
        .kv dd {
          margin: 0;
          font-size: 0.85rem;
        }
        .empty {
          font-size: 0.85rem;
          color: var(--ful-muted-fg, var(--boxel-500));
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof FulfilmentOrder> {
    <template>
      <div class='o-emb'>
        <span class='o-num'>{{@model.orderNumber}}</span>
        <span class='o-cust'>{{if @model.customerName @model.customerName '—'}}</span>
        <span class='o-status'><StatusChip
            @label={{@model.statusStyle.label}}
            @hue={{@model.statusStyle.hue}}
          /></span>
        <span class='o-slot'>{{@model.itemCount}} items</span>
        <span class='o-slot o-total'><@fields.total @format='atom' /></span>
      </div>

      <style scoped>
        .o-emb {
          display: grid;
          grid-template-columns: 8rem minmax(0, 1fr) auto 5rem 5.5rem;
          align-items: center;
          gap: var(--boxel-sp-xs);
          font-size: 0.88rem;
        }
        .o-num {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-weight: 700;
          letter-spacing: 0.02em;
          color: var(--foreground, var(--boxel-dark));
        }
        .o-cust {
          color: var(--muted-foreground, var(--boxel-500));
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .o-slot {
          text-align: right;
          font-family: var(--font-mono, ui-monospace, monospace);
          font-variant-numeric: tabular-nums;
          font-size: 0.78rem;
          color: var(--muted-foreground, var(--boxel-500));
        }
        .o-total {
          font-size: 0.9rem;
          font-weight: 700;
          color: var(--foreground, var(--boxel-dark));
        }
        @container (width < 430px) {
          .o-emb {
            grid-template-columns: 7rem minmax(0, 1fr) 5.5rem;
          }
          .o-status,
          .o-slot:not(.o-total) {
            display: none;
          }
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof FulfilmentOrder> {
    <template>
      <span class='o-atom'>{{@model.orderNumber}}</span>
      <style scoped>
        .o-atom {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 0.85em;
          font-weight: 700;
        }
      </style>
    </template>
  };

  // The shipping label. Hand-rolled rather than a FittedCard because the card
  // has a visual world of its own — perforated edge, status dot, priority
  // hatching — and bending FittedCard's slots around it would cost more than
  // building it.
  //
  // Progressive across the size spectrum: badge = number + status dot; strip
  // adds items and total; tile adds the customer and destination; card adds the
  // first three SKUs and the warehouse.
  static fitted = class Fitted extends Component<typeof FulfilmentOrder> {
    <template>
      <article class='fit {{if @model.isExpress "is-express"}}'>
        <div class='r-head'>
          <div class='hd-row'>
            <span class='dot' style={{dotStyle @model.statusStyle.hue}}></span>
            <span class='num'>{{@model.orderNumber}}</span>
          </div>
          <span class='status'>{{@model.statusStyle.label}}</span>
        </div>

        <div class='r-body'>
          <p class='cust'>{{if @model.customerName @model.customerName ''}}</p>
          {{#if @model.shipToLabel}}
            <p class='dest'>{{@model.shipToLabel}}</p>
          {{/if}}
          <ul class='lines'>
            {{#each @model.lineSummary as |line|}}
              <li><span class='q'>{{line.quantity}}×</span>{{line.sku}}</li>
            {{/each}}
          </ul>
        </div>

        <div class='r-meta'>
          <span class='items'>{{@model.itemCount}} items</span>
          <span class='wh'>{{if @model.warehouseCode @model.warehouseCode ''}}</span>
          <span class='total'><@fields.total @format='atom' /></span>
        </div>
      </article>

      <style scoped>
        .fit {
          --type-ratio: 1.24;
          --ar: calc(max(1cqi, 1cqb) - min(1cqi, 1cqb));
          /* The block-axis budget. `--type-base` is driven mostly by `cqi`, which
             is huge in a wide, short cell (a 691x105 strip gave 15px, and the
             25px number it produced needed a 30px line box in a row that only
             had 22px — a 12px shear straight through the digits). Capping the
             SCALE against `cqb` fixes every role at once, where capping each
             display role individually did not: in a tall cell the cqi term still
             governs, so tiles are unchanged. */
          --type-base: clamp(
            10px,
            min(calc(3px + 2.1cqi + 1cqb - 0.6 * var(--ar)), 10cqb),
            17px
          );
          --meta-size: max(8px, calc(var(--type-base) / var(--type-ratio)));
          --glyph-size: max(11px, min(3cqi, 14cqb));
          /* The identifier is a VALUE, so it must render in full. It is capped
             against the inline axis as well as the block axis so a real order /
             RMA / SKU always fits its box — the ellipsis below is a safety net
             for a pathological identifier, not a truncation strategy. */
          --num-size: max(
            11px,
            min(
              calc(var(--type-base) * pow(var(--type-ratio), 2)),
              26cqb,
              7.5cqi
            )
          );
          --pad: clamp(6px, calc(2px + 1.7cqi), 14px);
          --perf: color-mix(in oklch, var(--card-foreground) 20%, transparent);

          position: relative;
          width: 100%;
          height: 100%;
          box-sizing: border-box;
          display: grid;
          grid-template-rows: auto minmax(0, 1fr) auto;
          grid-template-areas: 'head' 'body' 'meta';
          gap: 3px;
          padding: var(--pad);
          overflow: hidden;
          background: var(--card, var(--boxel-light));
          color: var(--card-foreground, var(--boxel-dark));
          font-family: var(--font-sans, inherit);
        }
        /* The hatched rail reads as priority tape at every size, which is what
           keeps the card's identity alive down at badge. */
        .is-express::before {
          content: '';
          position: absolute;
          inset: 0 auto 0 0;
          width: 3px;
          background: repeating-linear-gradient(
            -45deg,
            var(--perf) 0 4px,
            transparent 4px 8px
          );
        }
        .r-head,
        .r-body,
        .r-meta {
          overflow: hidden;
          min-height: 0;
        }
        .r-head {
          grid-area: head;
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 6px;
        }
        .r-body {
          grid-area: body;
        }
        .r-meta {
          grid-area: meta;
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 6px;
          padding-top: 3px;
          border-top: 1px dashed var(--perf);
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: var(--meta-size);
          font-variant-numeric: tabular-nums;
          color: var(--muted-foreground, var(--boxel-500));
        }
        .hd-row {
          display: flex;
          align-items: center;
          gap: 5px;
          min-width: 0;
        }
        .dot {
          flex: none;
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: color-mix(
            in oklch,
            var(--st-hue, var(--muted-foreground, var(--boxel-400))) 72%,
            transparent
          );
        }
        .num {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: var(--num-size);
          font-weight: 800;
          line-height: 1.2;
          letter-spacing: -0.01em;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .status {
          font-size: var(--meta-size);
          font-weight: 700;
          white-space: nowrap;
          color: var(--muted-foreground, var(--boxel-500));
        }
        .cust {
          margin: 2px 0 0;
          font-size: var(--type-base);
          font-weight: 600;
          line-height: 1.2;
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 1;
          overflow: hidden;
        }
        .dest {
          margin: 1px 0 0;
          font-size: var(--meta-size);
          color: var(--muted-foreground, var(--boxel-500));
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 1;
          overflow: hidden;
        }
        .lines {
          margin: 5px 0 0;
          padding: 0;
          list-style: none;
          display: grid;
          gap: 1px;
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: var(--meta-size);
          color: var(--muted-foreground, var(--boxel-500));
        }
        .lines li {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .q {
          font-weight: 700;
          margin-right: 4px;
          color: var(--card-foreground, var(--boxel-dark));
        }
        .total {
          font-weight: 800;
          color: var(--card-foreground, var(--boxel-dark));
        }

        /* Badge: number + status dot only. */
        @container fitted-card (height <= 50px) {
          .fit {
            grid-template-rows: auto;
          }
          .r-body,
          .r-meta {
            display: none;
          }
        }
        /* Strip: meta row returns, body still out. */
        @container fitted-card (50px < height <= 80px) {
          .r-body {
            display: none;
          }
          .wh {
            display: none;
          }
        }
        /* Thin tile: customer and destination, but no line list yet. */
        @container fitted-card (80px < height <= 130px) {
          .lines {
            display: none;
          }
        }
        /* Full card: everything, including the first three SKUs. */
        @container fitted-card (height > 170px) {
          .lines {
            gap: 2px;
          }
        }
        @container fitted-card (width <= 150px) {
          .status,
          .wh {
            display: none;
          }
        }
        @container fitted-card (width <= 110px) {
          .items {
            display: none;
          }
        }
      </style>
    </template>
  };
}

function barWidth(pct: number | undefined) {
  return htmlSafe(`width: ${Math.min(100, Math.max(0, pct ?? 0))}%`);
}

function dotStyle(hue: string | undefined) {
  return htmlSafe(`--st-hue: ${hue ?? 'var(--muted-foreground)'}`);
}

export default FulfilmentOrder;
