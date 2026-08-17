import {
  CardDef,
  Component,
  FieldDef,
  StringField,
  contains,
  containsMany,
  field,
  linksTo,
} from '@cardstack/base/card-api';
import NumberField from '@cardstack/base/number';
import DatetimeField from '@cardstack/base/datetime';
import AmountWithCurrency from '@cardstack/base/amount-with-currency';
import CurrencyField from '@cardstack/base/currency';
import enumField from '@cardstack/base/enum';
import MarkdownField from '@cardstack/base/markdown';
import { htmlSafe } from '@ember/template';
import { FieldContainer } from '@cardstack/boxel-ui/components';
import RotateIcon from '@cardstack/boxel-icons/rotate-ccw';
import { FulfilmentOrder } from './fulfilment-order';
import { Shipment } from './shipment';
import StatusChip, { type StatusStyle } from './fulfilment-status-chip';

export const RETURN_STATUSES: StatusStyle[] = [
  { value: 'requested', label: 'Requested', hue: '#3b82f6' },
  { value: 'approved', label: 'Approved', hue: '#0ea5e9' },
  { value: 'denied', label: 'Denied', hue: '#6b7280' },
  { value: 'in_transit', label: 'In Transit', hue: '#f59e0b' },
  { value: 'received', label: 'Received', hue: '#d97706' },
  { value: 'inspecting', label: 'Inspecting', hue: '#b45309' },
  { value: 'restocked', label: 'Restocked', hue: '#15803d' },
  { value: 'disposed', label: 'Disposed', hue: '#6b7280' },
  { value: 'refunded', label: 'Refunded', hue: '#15803d' },
  { value: 'exchanged', label: 'Exchanged', hue: '#8b5cf6' },
];

export function returnStatusStyle(value?: string | null): StatusStyle {
  return (
    RETURN_STATUSES.find((s) => s.value === value) ?? {
      value: value ?? '',
      label: value ? value.replace(/_/g, ' ') : 'No status',
      hue: '',
    }
  );
}

export const ReturnStatusField = enumField(StringField, {
  options: RETURN_STATUSES.map((s) => ({ value: s.value, label: s.label })),
  displayName: 'Return Status',
});

// Why it came back, and what the policy says about it. `restockable` and
// `restockingFeeRate` live on this table rather than in the refund code, so a
// change of returns policy is an edit to one list.
export const RETURN_REASONS = [
  { value: 'wrong_item', label: 'Wrong item received', restockable: true, feeRate: 0 },
  {
    value: 'damaged_shipping',
    label: 'Damaged in shipping',
    restockable: false,
    feeRate: 0,
  },
  { value: 'defective', label: 'Defective product', restockable: false, feeRate: 0 },
  { value: 'changed_mind', label: 'Changed mind', restockable: true, feeRate: 0.15 },
  { value: 'wrong_size', label: 'Wrong size or fit', restockable: true, feeRate: 0 },
  {
    value: 'not_as_described',
    label: 'Not as described',
    restockable: true,
    feeRate: 0,
  },
  { value: 'arrived_late', label: 'Arrived too late', restockable: true, feeRate: 0 },
];

export function returnReason(value?: string | null) {
  return RETURN_REASONS.find((r) => r.value === value);
}

// A fee is waived when the fault was ours. Encoding that here — rather than
// leaving it to whoever processes the return — is what makes two people
// processing the same return produce the same refund.
export function isOurFault(value?: string | null) {
  return (
    value === 'wrong_item' ||
    value === 'damaged_shipping' ||
    value === 'defective' ||
    value === 'not_as_described' ||
    value === 'arrived_late'
  );
}

export const ReturnReasonField = enumField(StringField, {
  options: RETURN_REASONS.map((r) => ({ value: r.value, label: r.label })),
  displayName: 'Return Reason',
});

export const ITEM_CONDITIONS = [
  { value: 'new', label: 'As new' },
  { value: 'good', label: 'Good' },
  { value: 'damaged', label: 'Damaged' },
  { value: 'defective', label: 'Defective' },
];

export const ItemConditionField = enumField(StringField, {
  options: ITEM_CONDITIONS,
  displayName: 'Condition',
});

// What happens to the unit now. Only `restock` puts stock back — the others all
// remove it from sellable inventory in different ways, and the difference
// matters to the numbers at the end of the month.
export const DISPOSITIONS = [
  { value: 'restock', label: 'Restock (A grade)' },
  { value: 'refurbish', label: 'Refurbish' },
  { value: 'liquidate', label: 'Liquidate' },
  { value: 'dispose', label: 'Dispose' },
  { value: 'return_to_vendor', label: 'Return to vendor' },
];

export const DispositionField = enumField(StringField, {
  options: DISPOSITIONS,
  displayName: 'Disposition',
});

export const REFUND_METHODS = [
  { value: 'original', label: 'Original payment method' },
  { value: 'store_credit', label: 'Store credit' },
  { value: 'exchange', label: 'Exchange' },
];

export const RefundMethodField = enumField(StringField, {
  options: REFUND_METHODS,
  displayName: 'Refund Method',
});

export class ReturnItemField extends FieldDef {
  static displayName = 'Return Item';

  @field sku = contains(StringField);
  @field productName = contains(StringField);
  @field quantity = contains(NumberField);
  @field unitPrice = contains(AmountWithCurrency);
  @field itemCondition = contains(ItemConditionField);
  @field disposition = contains(DispositionField);
  @field inspectionNotes = contains(StringField);

  @field lineValue = contains(AmountWithCurrency, {
    computeVia: function (this: ReturnItemField) {
      let result = new AmountWithCurrency();
      let currency = new CurrencyField();
      currency.code = this.unitPrice?.currency?.code ?? 'USD';
      result.currency = currency;
      result.amount = (this.unitPrice?.amount ?? 0) * (this.quantity ?? 0);
      return result;
    },
  });

  get returnsToStock() {
    return this.disposition === 'restock';
  }

  static embedded = class Embedded extends Component<typeof ReturnItemField> {
    <template>
      <div class='ri'>
        <div class='ri-id'>
          <span class='ri-name'>{{if
              @model.productName
              @model.productName
              'Unnamed item'
            }}</span>
          <span class='ri-sku'>{{if @model.sku @model.sku '—'}}</span>
        </div>
        <span class='ri-slot'>{{if @model.quantity @model.quantity '—'}}</span>
        <span class='ri-slot ri-cond'><@fields.itemCondition @format='atom' /></span>
        <span class='ri-slot ri-disp'><@fields.disposition @format='atom' /></span>
        <span class='ri-slot ri-val'>{{#if @model.lineValue.amount}}<@fields.lineValue
              @format='atom'
            />{{else}}—{{/if}}</span>
      </div>

      <style scoped>
        .ri {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 2.5rem 6rem 8rem 5.5rem;
          align-items: center;
          gap: var(--boxel-sp-xs);
          padding: var(--boxel-sp-xxs) 0;
          font-size: 0.85rem;
        }
        .ri-id {
          display: flex;
          flex-direction: column;
          min-width: 0;
        }
        .ri-name {
          font-weight: 600;
          color: var(--foreground, var(--boxel-dark));
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .ri-sku {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 0.7rem;
          letter-spacing: 0.06em;
          color: var(--muted-foreground, var(--boxel-500));
        }
        .ri-slot {
          text-align: right;
          font-size: 0.78rem;
          font-variant-numeric: tabular-nums;
          color: var(--muted-foreground, var(--boxel-500));
        }
        .ri-val {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-weight: 700;
          color: var(--foreground, var(--boxel-dark));
        }
        @container (width < 460px) {
          .ri {
            grid-template-columns: minmax(0, 1fr) 2.5rem 5.5rem;
          }
          .ri-cond,
          .ri-disp {
            display: none;
          }
        }
      </style>
    </template>
  };

  static edit = class Edit extends Component<typeof ReturnItemField> {
    <template>
      <div class='ri-edit'>
        <FieldContainer @label='Product' @vertical={{true}}>
          <@fields.productName />
        </FieldContainer>
        <FieldContainer @label='SKU' @vertical={{true}}>
          <@fields.sku />
        </FieldContainer>
        <FieldContainer @label='Qty' @vertical={{true}}>
          <@fields.quantity />
        </FieldContainer>
        <FieldContainer @label='Condition' @vertical={{true}}>
          <@fields.itemCondition />
        </FieldContainer>
        <FieldContainer @label='Disposition' @vertical={{true}}>
          <@fields.disposition />
        </FieldContainer>
        <FieldContainer @label='Inspection notes' @vertical={{true}}>
          <@fields.inspectionNotes />
        </FieldContainer>
      </div>

      <style scoped>
        .ri-edit {
          display: grid;
          gap: var(--boxel-sp-xs);
          grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof ReturnItemField> {
    <template>
      <span class='ri-atom'>{{@model.quantity}}× {{@model.sku}}</span>
      <style scoped>
        .ri-atom {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 0.85em;
        }
      </style>
    </template>
  };
}

// Product Return (PR) — the RMA, from request to refund.
//
// The refund is computed from the items and the policy, never typed in. Two
// people processing the same return get the same number, and the arithmetic is
// visible on the card rather than in someone's head.
export class ProductReturn extends CardDef {
  static displayName = 'Product Return';
  static icon = RotateIcon;

  @field rmaNumber = contains(StringField);
  @field order = linksTo(() => FulfilmentOrder);
  @field originalShipment = linksTo(() => Shipment);
  @field customerName = contains(StringField);

  @field status = contains(ReturnStatusField);
  @field reason = contains(ReturnReasonField);
  @field reasonDetails = contains(StringField);
  @field lineItems = containsMany(ReturnItemField);

  @field returnLabelUrl = contains(StringField);
  @field returnTrackingNumber = contains(StringField);
  @field refundMethod = contains(RefundMethodField);
  @field notes = contains(MarkdownField);

  // Event facts. Each is written once, when the thing happened; the RMA's
  // progress is a question about which of them are set.
  @field requestedAt = contains(DatetimeField);
  @field receivedAt = contains(DatetimeField);
  @field inspectedAt = contains(DatetimeField);
  @field completedAt = contains(DatetimeField);

  @field itemsValue = contains(AmountWithCurrency, {
    computeVia: function (this: ProductReturn) {
      let result = new AmountWithCurrency();
      let currency = new CurrencyField();
      currency.code = this.currencyCode ?? 'USD';
      result.currency = currency;
      result.amount = (this.lineItems ?? []).reduce(
        (sum, l) => sum + (l?.unitPrice?.amount ?? 0) * (l?.quantity ?? 0),
        0,
      );
      return result;
    },
  });

  @field restockingFee = contains(AmountWithCurrency, {
    computeVia: function (this: ProductReturn) {
      let result = new AmountWithCurrency();
      let currency = new CurrencyField();
      currency.code = this.currencyCode ?? 'USD';
      result.currency = currency;
      let rate = isOurFault(this.reason)
        ? 0
        : (returnReason(this.reason)?.feeRate ?? 0);
      result.amount =
        Math.round((this.itemsValue?.amount ?? 0) * rate * 100) / 100;
      return result;
    },
  });

  @field refundAmount = contains(AmountWithCurrency, {
    computeVia: function (this: ProductReturn) {
      let result = new AmountWithCurrency();
      let currency = new CurrencyField();
      currency.code = this.currencyCode ?? 'USD';
      result.currency = currency;
      result.amount =
        Math.round(
          ((this.itemsValue?.amount ?? 0) - (this.restockingFee?.amount ?? 0)) *
            100,
        ) / 100;
      return result;
    },
  });

  @field currencyCode = contains(StringField, {
    computeVia: function (this: ProductReturn) {
      let line = (this.lineItems ?? []).find(
        (l) => l?.unitPrice?.currency?.code,
      );
      return line?.unitPrice?.currency?.code;
    },
  });

  @field orderNumber = contains(StringField, {
    computeVia: function (this: ProductReturn) {
      return this.order?.orderNumber;
    },
  });

  @field itemCount = contains(NumberField, {
    computeVia: function (this: ProductReturn) {
      return (this.lineItems ?? []).reduce(
        (sum, l) => sum + (l?.quantity ?? 0),
        0,
      );
    },
  });

  // The statuses that mean "this RMA is finished". Exported so a consumer
  // filters by the same list the card computes from.
  static CLOSED_STATUSES = ['refunded', 'exchanged', 'denied'];

  // Open vs closed as a FIELD, not a getter: a consumer filtering a grid through
  // a realm query cannot see a getter, so a getter here would let a grid and a
  // table disagree about which returns are open.
  @field lifecycleState = contains(StringField, {
    computeVia: function (this: ProductReturn) {
      return ProductReturn.CLOSED_STATUSES.includes(this.status ?? '')
        ? 'closed'
        : 'open';
    },
  });

  @field cardTitle = contains(StringField, {
    computeVia: function (this: ProductReturn) {
      return this.rmaNumber?.length ? this.rmaNumber : 'Untitled Return';
    },
  });

  get statusStyle() {
    return returnStatusStyle(this.status);
  }

  get reasonLabel() {
    return returnReason(this.reason)?.label ?? 'No reason given';
  }

  get feeWaived() {
    return isOurFault(this.reason);
  }

  get restockingLines() {
    return (this.lineItems ?? []).filter((l) => l?.disposition === 'restock');
  }

  get isInspected() {
    return this.inspectedAt != null;
  }

  static isolated = class Isolated extends Component<typeof ProductReturn> {
    <template>
      <article class='ret'>
        <header class='hd'>
          <div>
            <span class='eyebrow'>Return authorization</span>
            <h1 class='num'>{{@model.rmaNumber}}</h1>
            <p class='sub'>
              {{if @model.customerName @model.customerName 'No customer'}}
              {{#if @model.orderNumber}}<span class='ord'>·
                  {{@model.orderNumber}}</span>{{/if}}
            </p>
          </div>
          <StatusChip
            @label={{@model.statusStyle.label}}
            @hue={{@model.statusStyle.hue}}
            @size='base'
          />
        </header>

        <section class='sec'>
          <h2>Reason</h2>
          <p class='reason'>{{@model.reasonLabel}}</p>
          {{#if @model.reasonDetails}}
            <p class='detail'>“{{@model.reasonDetails}}”</p>
          {{/if}}
        </section>

        <section class='sec'>
          <h2>Items and disposition</h2>
          {{#if @model.lineItems.length}}
            <div class='ri-head'>
              <span>Item</span><span>Qty</span><span>Condition</span><span
              >Disposition</span><span>Value</span>
            </div>
            <@fields.lineItems @format='embedded' />
          {{else}}
            <p class='empty'>No items on this RMA yet.</p>
          {{/if}}
        </section>

        <section class='sec'>
          <h2>Refund calculation</h2>
          <dl class='calc'>
            <div>
              <dt>Item value</dt>
              <dd><@fields.itemsValue @format='atom' /></dd>
            </div>
            <div>
              <dt>Restocking fee
                {{#if @model.feeWaived}}<span class='waived'>waived — our
                    fault</span>{{/if}}</dt>
              <dd>−<@fields.restockingFee @format='atom' /></dd>
            </div>
            <div class='total'>
              <dt>Refund</dt>
              <dd><@fields.refundAmount @format='atom' /></dd>
            </div>
          </dl>
          <p class='via'>
            Issued to
            <strong><@fields.refundMethod @format='atom' /></strong>.
            This card records the amount; moving the money happens in the sales
            channel that took the payment.
          </p>
        </section>

        {{#if @model.restockingLines.length}}
          <p class='restock-note'>
            {{@model.restockingLines.length}}
            of these lines go back on the shelf. Adjust the matching stock rows
            when the units are physically put away — the RMA records the
            decision, not the movement.
          </p>
        {{/if}}

        <section class='sec'>
          <h2>Timeline</h2>
          <dl class='kv'>
            <div>
              <dt>Requested</dt>
              <dd><@fields.requestedAt @format='atom' /></dd>
            </div>
            <div>
              <dt>Received</dt>
              <dd>{{#if @model.receivedAt}}<@fields.receivedAt
                    @format='atom'
                  />{{else}}Not yet{{/if}}</dd>
            </div>
            <div>
              <dt>Inspected</dt>
              <dd>{{#if @model.inspectedAt}}<@fields.inspectedAt
                    @format='atom'
                  />{{else}}Not yet{{/if}}</dd>
            </div>
            <div>
              <dt>Completed</dt>
              <dd>{{#if @model.completedAt}}<@fields.completedAt
                    @format='atom'
                  />{{else}}Not yet{{/if}}</dd>
            </div>
          </dl>
        </section>
      </article>

      <style scoped>
        .ret {
          --ful-bg: var(--background);
          --ful-fg: var(--foreground);
          --ful-muted-fg: var(--muted-foreground);
          --ful-border: var(--border);
          --ful-perf: color-mix(in oklch, var(--foreground) 22%, transparent);

          height: 100%;
          overflow-y: auto;
          padding: var(--boxel-sp-lg);
          background: var(--ful-bg, var(--boxel-light));
          color: var(--ful-fg, var(--boxel-dark));
          font-family: var(--font-sans, inherit);
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
          font-size: 0.62rem;
          font-weight: 700;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          color: var(--ful-muted-fg, var(--boxel-500));
        }
        .num {
          margin: 2px 0 0;
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 2rem;
          line-height: 1;
        }
        .sub {
          margin: 8px 0 0;
          font-size: 0.9rem;
          color: var(--ful-muted-fg, var(--boxel-500));
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
        .reason {
          margin: 0;
          font-size: 1.05rem;
          font-weight: 600;
        }
        .detail {
          margin: 4px 0 0;
          font-size: 0.88rem;
          font-style: italic;
          color: var(--ful-muted-fg, var(--boxel-500));
        }
        .ri-head {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 2.5rem 6rem 8rem 5.5rem;
          gap: var(--boxel-sp-xs);
          padding-bottom: 4px;
          border-bottom: 1px solid var(--ful-border, var(--boxel-border-color));
          font-size: 0.62rem;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--ful-muted-fg, var(--boxel-500));
        }
        .ri-head span:nth-child(n + 2) {
          text-align: right;
        }
        .calc {
          display: grid;
          gap: 6px;
          margin: 0;
          max-width: 26rem;
        }
        .calc div {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 7rem;
          gap: var(--boxel-sp-xs);
          font-size: 0.9rem;
        }
        .calc dt {
          color: var(--ful-muted-fg, var(--boxel-500));
        }
        .calc dd {
          margin: 0;
          text-align: right;
          font-family: var(--font-mono, ui-monospace, monospace);
          font-variant-numeric: tabular-nums;
        }
        .waived {
          margin-left: 6px;
          font-size: 0.7rem;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }
        .total {
          padding-top: 6px;
          border-top: 1px solid var(--ful-perf);
        }
        .total dt {
          font-weight: 700;
          color: var(--ful-fg, var(--boxel-dark));
        }
        .total dd {
          font-size: 1.3rem;
          font-weight: 800;
        }
        .via,
        .restock-note {
          margin: var(--boxel-sp-sm) 0 0;
          font-size: 0.8rem;
          color: var(--ful-muted-fg, var(--boxel-500));
        }
        .restock-note {
          padding: var(--boxel-sp-sm);
          border-left: 3px solid var(--ful-border, var(--boxel-border-color));
        }
        .kv {
          display: grid;
          gap: 6px;
          margin: 0;
          max-width: 26rem;
        }
        .kv div {
          display: grid;
          grid-template-columns: 7rem minmax(0, 1fr);
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

  static embedded = class Embedded extends Component<typeof ProductReturn> {
    <template>
      <div class='r-emb'>
        <span class='r-num'>{{@model.rmaNumber}}</span>
        <span class='r-reason'>{{@model.reasonLabel}}</span>
        <span class='r-status'><StatusChip
            @label={{@model.statusStyle.label}}
            @hue={{@model.statusStyle.hue}}
          /></span>
        <span class='r-slot'><@fields.refundAmount @format='atom' /></span>
      </div>

      <style scoped>
        .r-emb {
          display: grid;
          grid-template-columns: 9rem minmax(0, 1fr) auto 5.5rem;
          align-items: center;
          gap: var(--boxel-sp-xs);
          font-size: 0.88rem;
        }
        .r-num {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-weight: 700;
          color: var(--foreground, var(--boxel-dark));
        }
        .r-reason {
          color: var(--muted-foreground, var(--boxel-500));
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .r-slot {
          text-align: right;
          font-family: var(--font-mono, ui-monospace, monospace);
          font-variant-numeric: tabular-nums;
          font-weight: 700;
          color: var(--foreground, var(--boxel-dark));
        }
        @container (width < 420px) {
          .r-emb {
            grid-template-columns: 8.5rem minmax(0, 1fr) 5.5rem;
          }
          .r-status {
            display: none;
          }
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof ProductReturn> {
    <template>
      <span class='r-atom'>{{@model.rmaNumber}}</span>
      <style scoped>
        .r-atom {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 0.85em;
          font-weight: 700;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof ProductReturn> {
    <template>
      <article class='fit'>
        <div class='r-head'>
          <div class='hd-row'>
            <span class='dot' style={{dotStyle @model.statusStyle.hue}}></span>
            <span class='num'>{{@model.rmaNumber}}</span>
          </div>
          <span class='status'>{{@model.statusStyle.label}}</span>
        </div>
        <div class='r-body'>
          <p class='reason'>{{@model.reasonLabel}}</p>
          <p class='cust'>{{if @model.customerName @model.customerName ''}}</p>
        </div>
        <div class='r-meta'>
          <span class='items'>{{@model.itemCount}} items</span>
          <span class='refund'><@fields.refundAmount @format='atom' /></span>
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

          width: 100%;
          height: 100%;
          box-sizing: border-box;
          display: grid;
          grid-template-rows: auto minmax(0, 1fr) auto;
          gap: 3px;
          padding: var(--pad);
          overflow: hidden;
          background: var(--card, var(--boxel-light));
          color: var(--card-foreground, var(--boxel-dark));
          font-family: var(--font-sans, inherit);
        }
        .r-head,
        .r-body,
        .r-meta {
          overflow: hidden;
          min-height: 0;
        }
        .r-head {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 6px;
        }
        .r-meta {
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
        .reason {
          margin: 2px 0 0;
          font-size: var(--type-base);
          font-weight: 600;
          line-height: 1.2;
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;
          overflow: hidden;
        }
        .cust {
          margin: 2px 0 0;
          font-size: var(--meta-size);
          color: var(--muted-foreground, var(--boxel-500));
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .refund {
          font-weight: 800;
          color: var(--card-foreground, var(--boxel-dark));
        }

        @container fitted-card (height <= 50px) {
          .fit {
            grid-template-rows: auto;
          }
          .r-body,
          .r-meta {
            display: none;
          }
        }
        @container fitted-card (50px < height <= 80px) {
          .r-body {
            display: none;
          }
        }
        @container fitted-card (80px < height <= 130px) {
          .cust {
            display: none;
          }
        }
        @container fitted-card (width <= 150px) {
          .status {
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

function dotStyle(hue: string | undefined) {
  return htmlSafe(`--st-hue: ${hue ?? 'var(--muted-foreground)'}`);
}

export default ProductReturn;
