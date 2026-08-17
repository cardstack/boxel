import {
  CardDef,
  Component,
  StringField,
  contains,
  field,
  linksTo,
} from '@cardstack/base/card-api';
import NumberField from '@cardstack/base/number';
import DatetimeField from '@cardstack/base/datetime';
import { htmlSafe } from '@ember/template';
import BoxesIcon from '@cardstack/boxel-icons/boxes';
import { FulfilmentProduct } from './fulfilment-product';
import { Warehouse } from './warehouse';

// Inventory Stock — one product, in one warehouse, at one bin.
//
// Three quantities are stored and one is computed, and which is which is the
// whole design. On-hand is what a count would find. Reserved is what is already
// promised to orders. AVAILABLE IS NEVER STORED — it is on-hand minus reserved,
// and a stored copy would drift the moment either half moved.
//
// Low stock is likewise derived from the reorder point rather than stored as a
// flag: a stored flag has to be recomputed by whoever last touched the row, and
// eventually someone forgets.
export class InventoryStock extends CardDef {
  static displayName = 'Inventory Item';
  static icon = BoxesIcon;

  @field product = linksTo(() => FulfilmentProduct);
  @field warehouse = linksTo(() => Warehouse);
  @field binLocation = contains(StringField);

  @field quantityOnHand = contains(NumberField);
  @field quantityReserved = contains(NumberField);
  @field quantityIncoming = contains(NumberField);
  @field reorderPoint = contains(NumberField);
  @field reorderQuantity = contains(NumberField);

  @field lastCountedAt = contains(DatetimeField);
  @field lastMovementAt = contains(DatetimeField);

  @field quantityAvailable = contains(NumberField, {
    computeVia: function (this: InventoryStock) {
      return (this.quantityOnHand ?? 0) - (this.quantityReserved ?? 0);
    },
  });

  // Snapshots of the linked cards, as computed fields rather than template
  // traversals. Prerendered fitted does not resolve links, so a fitted template
  // reading `@model.product.sku` renders blank; reading `@model.sku` — an
  // attribute the indexer filled in — renders everywhere.
  @field sku = contains(StringField, {
    computeVia: function (this: InventoryStock) {
      return this.product?.sku;
    },
  });

  @field productName = contains(StringField, {
    computeVia: function (this: InventoryStock) {
      return this.product?.productName;
    },
  });

  @field warehouseCode = contains(StringField, {
    computeVia: function (this: InventoryStock) {
      return this.warehouse?.code;
    },
  });

  @field cardTitle = contains(StringField, {
    computeVia: function (this: InventoryStock) {
      let sku = this.product?.sku;
      let wh = this.warehouse?.code;
      if (!sku) {
        return 'Untitled stock row';
      }
      return wh ? `${sku} @ ${wh}` : sku;
    },
  });

  get isOutOfStock() {
    return (this.quantityAvailable ?? 0) <= 0;
  }

  get isLowStock() {
    let point = this.reorderPoint;
    if (point == null) {
      return false;
    }
    return !this.isOutOfStock && (this.quantityAvailable ?? 0) <= point;
  }

  // What the row is telling you to do, in one word. Used for the stock hue and
  // for filtering the inventory tab — one definition, several readers.
  //
  // It is a FIELD rather than a getter because a consumer needs to filter on it
  // through the index: a getter is invisible to a realm query, so a grid backed
  // by a wire query could not honour a "low stock" filter that a table computed
  // in JS, and the two views would silently disagree about which rows exist.
  @field stockState = contains(StringField, {
    computeVia: function (this: InventoryStock) {
      if (this.isOutOfStock) {
        return 'out';
      }
      return this.isLowStock ? 'low' : 'ok';
    },
  });

  get stockHue() {
    if (this.isOutOfStock) {
      return '#ef4444';
    }
    return this.isLowStock ? '#f59e0b' : '#15803d';
  }

  // How full this row is against its own reorder point, capped at 100. With no
  // reorder point there is nothing to measure against, so nothing is drawn.
  get fillPercent() {
    let point = this.reorderPoint;
    if (!point || point <= 0) {
      return undefined;
    }
    let ratio = (this.quantityAvailable ?? 0) / (point * 2);
    return Math.max(0, Math.min(100, Math.round(ratio * 100)));
  }

  static isolated = class Isolated extends Component<typeof InventoryStock> {
    <template>
      <article class='stk'>
        <header class='hd'>
          <div>
            <span class='sku'>{{@model.sku}}</span>
            <h1 class='name'>{{@model.productName}}</h1>
            <p class='where'>
              {{#if @model.warehouseCode}}<span
                  class='wh'
                >{{@model.warehouseCode}}</span>{{/if}}
              {{#if @model.binLocation}}<span
                  class='bin'
                >{{@model.binLocation}}</span>{{/if}}
            </p>
          </div>
          <span class='state state-{{@model.stockState}}'>
            {{#if @model.isOutOfStock}}Out of stock{{else if
              @model.isLowStock
            }}Low stock{{else}}In stock{{/if}}
          </span>
        </header>

        <dl class='quants'>
          <div class='q q-primary'>
            <dt>Available</dt>
            <dd>{{@model.quantityAvailable}}</dd>
          </div>
          <div class='q'>
            <dt>On hand</dt>
            <dd>{{if @model.quantityOnHand @model.quantityOnHand 0}}</dd>
          </div>
          <div class='q'>
            <dt>Reserved</dt>
            <dd>{{if @model.quantityReserved @model.quantityReserved 0}}</dd>
          </div>
          <div class='q'>
            <dt>Incoming</dt>
            <dd>{{if @model.quantityIncoming @model.quantityIncoming 0}}</dd>
          </div>
        </dl>

        <p class='arith'>
          Available is on hand minus reserved. It is computed on every read, so a
          reservation shows up here the moment an order claims it.
        </p>

        <section class='sec'>
          <h2>Reordering</h2>
          <dl class='kv'>
            <div>
              <dt>Reorder point</dt>
              <dd>{{if @model.reorderPoint @model.reorderPoint '—'}}</dd>
            </div>
            <div>
              <dt>Reorder quantity</dt>
              <dd>{{if @model.reorderQuantity @model.reorderQuantity '—'}}</dd>
            </div>
            <div>
              <dt>Last counted</dt>
              <dd><@fields.lastCountedAt @format='atom' /></dd>
            </div>
            <div>
              <dt>Last movement</dt>
              <dd><@fields.lastMovementAt @format='atom' /></dd>
            </div>
          </dl>
        </section>

        {{#if @model.product}}
          <section class='sec'>
            <h2>Product</h2>
            <@fields.product @format='embedded' />
          </section>
        {{/if}}
      </article>

      <style scoped>
        .stk {
          --ful-bg: var(--background);
          --ful-fg: var(--foreground);
          --ful-muted-fg: var(--muted-foreground);
          --ful-border: var(--border);
          --ful-rule: color-mix(in oklch, var(--foreground) 12%, transparent);

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
          border-bottom: 2px solid var(--ful-rule);
        }
        .sku {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 0.72rem;
          font-weight: 700;
          letter-spacing: 0.16em;
          color: var(--ful-muted-fg, var(--boxel-500));
        }
        .name {
          margin: 0.1rem 0 0;
          font-size: 1.9rem;
          line-height: 1.05;
          font-family: var(--font-heading, inherit);
        }
        .where {
          display: flex;
          gap: 8px;
          margin: 6px 0 0;
        }
        .wh,
        .bin {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 0.72rem;
          font-weight: 700;
          letter-spacing: 0.08em;
          padding: 2px 7px;
          border-radius: 3px;
          border: 1px solid var(--ful-border, var(--boxel-border-color));
          color: var(--ful-muted-fg, var(--boxel-500));
        }
        .state {
          font-size: 0.72rem;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          padding: 4px 10px;
          border-radius: 3px;
          color: var(--ful-muted-fg, var(--boxel-500));
          background: color-mix(
            in oklch,
            var(--muted-foreground, var(--boxel-500)) 12%,
            transparent
          );
        }
        .state-out {
          color: color-mix(
            in oklch,
            var(--destructive, var(--boxel-danger)) 60%,
            var(--foreground, var(--boxel-dark))
          );
          background: color-mix(
            in oklch,
            var(--destructive, var(--boxel-danger)) 12%,
            transparent
          );
        }
        .quants {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
          gap: var(--boxel-sp);
          margin: var(--boxel-sp) 0 0;
        }
        .q {
          display: flex;
          flex-direction: column;
          gap: 2px;
          padding: var(--boxel-sp-sm);
          border: 1px solid var(--ful-border, var(--boxel-border-color));
          border-radius: var(--boxel-border-radius, 8px);
        }
        .q dt {
          font-size: 0.65rem;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--ful-muted-fg, var(--boxel-500));
        }
        .q dd {
          margin: 0;
          font-family: var(--font-mono, ui-monospace, monospace);
          font-variant-numeric: tabular-nums;
          font-size: 1.5rem;
          font-weight: 700;
        }
        .q-primary {
          border-width: 2px;
          border-color: var(--ful-rule);
        }
        .q-primary dd {
          font-size: 2.2rem;
        }
        .arith {
          margin: var(--boxel-sp-sm) 0 0;
          font-size: 0.78rem;
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
        .kv {
          display: grid;
          gap: 6px;
          margin: 0;
        }
        .kv div {
          display: grid;
          grid-template-columns: 9rem minmax(0, 1fr);
          gap: var(--boxel-sp-xs);
        }
        .kv dt {
          font-size: 0.8rem;
          color: var(--ful-muted-fg, var(--boxel-500));
        }
        .kv dd {
          margin: 0;
          font-size: 0.85rem;
          font-variant-numeric: tabular-nums;
        }
      </style>
    </template>
  };

  // The stock row: the identity surface for this card, because this is where
  // it is read a hundred times a day. Trailing numeric slots are constant width
  // so a warehouse's worth of rows column-aligns.
  static embedded = class Embedded extends Component<typeof InventoryStock> {
    <template>
      <div class='row'>
        <span class='bar' style={{stockAccent @model.stockHue}} aria-hidden='true'
        ></span>
        <div class='id'>
          <span class='sku'>{{if @model.sku @model.sku '—'}}</span>
          <span class='name'>{{if @model.productName @model.productName ''}}</span>
        </div>
        <span class='where'>
          {{if @model.warehouseCode @model.warehouseCode '—'}}
          {{#if @model.binLocation}}<span
              class='bin'
            >{{@model.binLocation}}</span>{{/if}}
        </span>
        <span class='num'>{{if @model.quantityOnHand @model.quantityOnHand 0}}</span>
        <span class='num'>{{if
            @model.quantityReserved
            @model.quantityReserved
            0
          }}</span>
        <span class='num avail'>{{@model.quantityAvailable}}</span>
      </div>

      <style scoped>
        .row {
          display: grid;
          grid-template-columns: 3px minmax(0, 1fr) 9rem 3.5rem 3.5rem 4rem;
          align-items: center;
          gap: var(--boxel-sp-xs);
          padding: var(--boxel-sp-xxs) 0;
          font-size: 0.85rem;
        }
        /* The state stripe is the only place the stock hue appears, and it
           carries no text — a hue chosen as data is never contrast-safe. */
        .bar {
          align-self: stretch;
          border-radius: 2px;
          background: color-mix(
            in oklch,
            var(--stock-hue, var(--muted-foreground, var(--boxel-400))) 70%,
            transparent
          );
        }
        .id {
          display: flex;
          flex-direction: column;
          min-width: 0;
        }
        .sku {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 0.75rem;
          font-weight: 700;
          letter-spacing: 0.06em;
          color: var(--foreground, var(--boxel-dark));
        }
        .name {
          font-size: 0.75rem;
          color: var(--muted-foreground, var(--boxel-500));
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .where {
          display: flex;
          align-items: center;
          gap: 5px;
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 0.72rem;
          color: var(--muted-foreground, var(--boxel-500));
        }
        .bin {
          padding: 1px 5px;
          border-radius: 2px;
          background: color-mix(
            in oklch,
            var(--muted-foreground, var(--boxel-500)) 10%,
            transparent
          );
        }
        .num {
          text-align: right;
          font-family: var(--font-mono, ui-monospace, monospace);
          font-variant-numeric: tabular-nums;
          color: var(--muted-foreground, var(--boxel-500));
        }
        .avail {
          font-weight: 800;
          font-size: 0.95rem;
          color: var(--foreground, var(--boxel-dark));
        }
        @container (width < 420px) {
          .row {
            grid-template-columns: 3px minmax(0, 1fr) 4rem;
          }
          .where,
          .num:not(.avail) {
            display: none;
          }
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof InventoryStock> {
    <template>
      <span class='s-atom'>
        <span class='s-sku'>{{@model.sku}}</span>
        <span class='s-qty'>{{@model.quantityAvailable}}</span>
      </span>
      <style scoped>
        .s-atom {
          display: inline-flex;
          align-items: baseline;
          gap: 5px;
          font-size: 0.85em;
        }
        .s-sku {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-weight: 700;
        }
        .s-qty {
          font-variant-numeric: tabular-nums;
          color: var(--muted-foreground, var(--boxel-500));
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof InventoryStock> {
    <template>
      <article class='fit'>
        <div class='r-head'>
          <div class='eyebrow'>
            <BoxesIcon class='glyph' />
            <span class='sku'>{{@model.sku}}</span>
          </div>
          <h3 class='headline'>{{@model.productName}}</h3>
        </div>
        <div class='r-body'>
          <div class='big'>
            <span class='qty'>{{@model.quantityAvailable}}</span>
            <span class='qty-label'>available</span>
          </div>
          {{#if @model.fillPercent}}
            <div class='gauge' aria-hidden='true'>
              <span
                class='gauge-fill'
                style={{gaugeStyle @model.fillPercent @model.stockHue}}
              ></span>
            </div>
          {{/if}}
        </div>
        <div class='r-meta'>
          <span class='wh'>{{if @model.warehouseCode @model.warehouseCode '—'}}</span>
          <span class='bin'>{{if @model.binLocation @model.binLocation ''}}</span>
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
          --headline-size: max(9px, var(--type-base));
          --qty-size: max(
            14px,
            min(calc(var(--type-base) * pow(var(--type-ratio), 2.4)), 34cqb)
          );
          --pad: clamp(6px, calc(2px + 1.7cqi), 14px);

          width: 100%;
          height: 100%;
          box-sizing: border-box;
          display: grid;
          grid-template-rows: auto minmax(0, 1fr) auto;
          gap: 2px;
          padding: var(--pad);
          overflow: hidden;
          background: var(--card, var(--boxel-light));
          color: var(--card-foreground, var(--boxel-dark));
          font-family: var(--font-sans, inherit);
        }
        /* The card's own icon, the same one its isolated view uses — the
           fitted's visual anchor. It sits on the quiet eyebrow row so it can
           never compete with the headline, and it is the first thing dropped
           at the badge quantum. */
        .eyebrow {
          display: flex;
          align-items: center;
          gap: 4px;
          min-width: 0;
        }
        .glyph {
          flex: none;
          width: var(--glyph-size);
          height: var(--glyph-size);
          color: var(--muted-foreground, var(--boxel-400));
        }
        .r-head,
        .r-body,
        .r-meta {
          overflow: hidden;
          min-height: 0;
        }
        .r-meta {
          display: flex;
          gap: 8px;
          justify-content: space-between;
          align-items: baseline;
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: var(--meta-size);
          color: var(--muted-foreground, var(--boxel-500));
        }
        .sku {
          display: block;
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: var(--meta-size);
          font-weight: 700;
          letter-spacing: 0.12em;
          color: var(--muted-foreground, var(--boxel-500));
        }
        .headline {
          margin: 0;
          font-size: var(--headline-size);
          font-weight: 700;
          line-height: 1.2;
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;
          overflow: hidden;
        }
        .big {
          display: flex;
          align-items: baseline;
          gap: 5px;
          margin-top: 2px;
        }
        .qty {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-variant-numeric: tabular-nums;
          font-size: var(--qty-size);
          font-weight: 800;
          line-height: 1.2;
        }
        .qty-label {
          font-size: var(--meta-size);
          color: var(--muted-foreground, var(--boxel-500));
        }
        .gauge {
          margin-top: 6px;
          height: 4px;
          border-radius: 999px;
          background: color-mix(in oklch, var(--card-foreground) 12%, transparent);
          overflow: hidden;
        }
        .gauge-fill {
          display: block;
          height: 100%;
          background: color-mix(
            in oklch,
            var(--stock-hue, var(--muted-foreground)) 65%,
            transparent
          );
        }

        @container fitted-card (height <= 50px) {
          .fit {
            grid-template-rows: auto;
          }
          .eyebrow,
          .r-body,
          .r-meta {
            display: none;
          }
          .headline {
            -webkit-line-clamp: 1;
          }
        }
        @container fitted-card (50px < height <= 80px) {
          .r-body {
            display: none;
          }
          .headline {
            -webkit-line-clamp: 1;
          }
        }
        @container fitted-card (80px < height <= 130px) {
          .gauge {
            display: none;
          }
        }
        @container fitted-card (width <= 140px) {
          .bin {
            display: none;
          }
        }
      </style>
    </template>
  };
}

function stockAccent(hue: string | undefined) {
  return htmlSafe(`--stock-hue: ${hue ?? 'var(--muted-foreground)'}`);
}

function gaugeStyle(pct: number | undefined, hue: string | undefined) {
  return htmlSafe(
    `width: ${Math.min(100, Math.max(0, pct ?? 0))}%; --stock-hue: ${
      hue ?? 'var(--muted-foreground)'
    }`,
  );
}

export default InventoryStock;
