import {
  Component,
  FieldDef,
  StringField,
  contains,
  field,
} from '@cardstack/base/card-api';
import NumberField from '@cardstack/base/number';
import AmountWithCurrency from '@cardstack/base/amount-with-currency';
import { money } from './fulfilment-format';
import CurrencyField from '@cardstack/base/currency';
import { FieldContainer } from '@cardstack/boxel-ui/components';
import ListIcon from '@cardstack/boxel-icons/list';

// Invoice Line Item (IL) — one row of what was bought.
//
// The line holds the SKU and product name as ATTRIBUTES rather than a link to
// the Product card, for two independent reasons that happen to agree:
//
//   1. Layering. A field must not import a card; that would be an upward
//      dependency and would make this field unusable without the whole
//      fulfilment card set.
//   2. Correctness. An order line is a snapshot. Prices change and products get
//      renamed, but what the customer bought at 14:02 on Tuesday does not. A
//      line that reads through a link would silently rewrite history.
//
// It also happens to be what fitted rendering needs: prerendered fitted does not
// resolve links, so an attribute-only line renders at every size.
export class FulfilmentLineItemField extends FieldDef {
  static displayName = 'Line Item';
  static icon = ListIcon;

  @field sku = contains(StringField);
  @field productName = contains(StringField);
  @field quantity = contains(NumberField);
  @field unitPrice = contains(AmountWithCurrency);
  // How many of `quantity` have actually left the building. Fulfilment is not
  // all-or-nothing: a split shipment ships 2 of 3 now and 1 next week.
  @field quantityFulfilled = contains(NumberField);

  @field lineTotal = contains(AmountWithCurrency, {
    computeVia: function (this: FulfilmentLineItemField) {
      let result = new AmountWithCurrency();
      let currency = new CurrencyField();
      currency.code = this.unitPrice?.currency?.code ?? 'USD';
      result.currency = currency;
      result.amount = (this.unitPrice?.amount ?? 0) * (this.quantity ?? 0);
      return result;
    },
  });

  get outstanding() {
    return (this.quantity ?? 0) - (this.quantityFulfilled ?? 0);
  }

  get isFullyFulfilled() {
    return (this.quantity ?? 0) > 0 && this.outstanding <= 0;
  }

  static atom = class Atom extends Component<typeof FulfilmentLineItemField> {
    <template>
      <span class='li-atom'>
        <span class='li-qty'>{{if @model.quantity @model.quantity 0}}×</span>
        {{if @model.productName @model.productName @model.sku}}
      </span>

      <style scoped>
        .li-atom {
          font-size: 0.85em;
          color: var(--foreground, var(--boxel-dark));
        }
        .li-qty {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-weight: 700;
          color: var(--muted-foreground, var(--boxel-500));
        }
      </style>
    </template>
  };

  // Row-shaped. Every trailing slot is always rendered at a constant width —
  // an em dash when there is no value — so a list of these column-aligns no
  // matter what any individual row is missing.
  static embedded = class Embedded extends Component<
    typeof FulfilmentLineItemField
  > {
    <template>
      <div class='li'>
        <div class='li-id'>
          <span class='li-name'>{{if
              @model.productName
              @model.productName
              'Unnamed item'
            }}</span>
          <span class='li-sku'>{{if @model.sku @model.sku '—'}}</span>
        </div>

        <span class='li-slot li-qty'>
          {{#if @model.quantity}}
            {{@model.quantity}}
          {{else}}
            —
          {{/if}}
        </span>

        {{! `money` rather than the AmountWithCurrency atom. The atom renders
            "£ 42" — a space after the symbol and no minor units — while every
            other figure on the host card goes through `money` and renders
            "£6.87". Two money formats on one screen is exactly what that helper
            exists to prevent, and a row of line items is where it showed. }}
        <span class='li-slot li-price'>
          {{#if @model.unitPrice.amount}}
            {{money @model.unitPrice.amount @model.unitPrice.currency.code}}
          {{else}}
            —
          {{/if}}
        </span>

        <span class='li-slot li-total'>
          {{#if @model.lineTotal.amount}}
            {{money @model.lineTotal.amount @model.lineTotal.currency.code}}
          {{else}}
            —
          {{/if}}
        </span>
      </div>

      <style scoped>
        .li {
          display: grid;
          /* 14.5rem of FIXED trailing columns used to sit here. In a 330px
             column that leaves the name about 3.5rem, so "Stoneware Mug" became
             "Stonew…" while a 6rem money slot held "£42.00" and a visible hole.
             Constant-width trailing columns are still right — they are what
             makes a stack of rows read as a table — they were just budgeted for
             a card-width container and mounted in a half-width one. */
          grid-template-columns: minmax(0, 1fr) 2.25rem 4.5rem 5rem;
          align-items: center;
          gap: var(--boxel-sp-xs);
          padding: var(--boxel-sp-xxs) 0;
          font-size: 0.85rem;
        }
        .li-id {
          display: flex;
          flex-direction: column;
          min-width: 0;
        }
        .li-name {
          font-weight: 600;
          color: var(--foreground, var(--boxel-dark));
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .li-sku {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 0.7rem;
          letter-spacing: 0.06em;
          color: var(--muted-foreground, var(--boxel-500));
        }
        .li-slot {
          text-align: right;
          font-family: var(--font-mono, ui-monospace, monospace);
          font-variant-numeric: tabular-nums;
          color: var(--muted-foreground, var(--boxel-500));
        }
        .li-total {
          font-weight: 700;
          color: var(--foreground, var(--boxel-dark));
        }
        /* A narrow container drops the unit price before the total: the total
           is what anyone reading a compressed row is looking for. The stop moved
           from 340px to 430px because 340 was measured against the wrong thing —
           it only fired once the name had already been crushed to an ellipsis.
           Below 250px the quantity goes too, leaving name + total. */
        @container (width < 430px) {
          .li {
            grid-template-columns: minmax(0, 1fr) 2.25rem 5rem;
          }
          .li-price {
            display: none;
          }
        }
        @container (width < 250px) {
          .li {
            grid-template-columns: minmax(0, 1fr) 5rem;
          }
          .li-qty {
            display: none;
          }
        }
      </style>
    </template>
  };

  static edit = class Edit extends Component<typeof FulfilmentLineItemField> {
    <template>
      <div class='li-edit'>
        <FieldContainer @label='Product' @vertical={{true}}>
          <@fields.productName />
        </FieldContainer>
        <FieldContainer @label='SKU' @vertical={{true}}>
          <@fields.sku />
        </FieldContainer>
        <FieldContainer @label='Qty' @vertical={{true}}>
          <@fields.quantity />
        </FieldContainer>
        <FieldContainer @label='Unit price' @vertical={{true}}>
          <@fields.unitPrice />
        </FieldContainer>
      </div>

      <style scoped>
        .li-edit {
          display: grid;
          gap: var(--boxel-sp-xs);
          grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        }
      </style>
    </template>
  };
}

export default FulfilmentLineItemField;
