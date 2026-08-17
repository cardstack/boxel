import {
  CardDef,
  Component,
  StringField,
  contains,
  field,
  linksTo,
} from '@cardstack/base/card-api';
import BooleanField from '@cardstack/base/boolean';
import AmountWithCurrency from '@cardstack/base/amount-with-currency';
import PackageIcon from '@cardstack/boxel-icons/package';
import ParcelDimensionsField from './parcel-dimensions';
import { FulfilmentVendor } from './fulfilment-vendor';

// Product (Pr) — a SKU as fulfilment sees it. Deliberately not the retail
// product card: this one carries the things you need to *move* an item (weight,
// box size, barcode, who supplies it), not the things you need to sell it.
//
// Named distinctly from the realm's existing retail `product.gts` so the two
// can coexist. A merge would force one card to carry both jobs.
export class FulfilmentProduct extends CardDef {
  static displayName = 'Product';
  static icon = PackageIcon;

  @field sku = contains(StringField);
  @field productName = contains(StringField);
  @field category = contains(StringField);
  @field barcode = contains(StringField);
  @field imageUrl = contains(StringField);

  // Second consumer for the parcel block: a product's shipping profile is the
  // same shape as a parcel's, so the packing station can pre-fill from it.
  @field shippingProfile = contains(ParcelDimensionsField);

  @field vendor = linksTo(() => FulfilmentVendor);
  @field vendorSku = contains(StringField);
  @field cost = contains(AmountWithCurrency);
  @field price = contains(AmountWithCurrency);

  @field isDropship = contains(BooleanField);
  @field isActive = contains(BooleanField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: FulfilmentProduct) {
      return this.productName?.length ? this.productName : 'Untitled Product';
    },
  });

  get marginPercent() {
    let cost = this.cost?.amount;
    let price = this.price?.amount;
    if (!cost || !price || price <= 0) {
      return undefined;
    }
    return Math.round(((price - cost) / price) * 100);
  }

  static isolated = class Isolated extends Component<typeof FulfilmentProduct> {
    <template>
      <article class='prod'>
        <header class='hd'>
          <div class='hd-id'>
            <span class='sku'>{{@model.sku}}</span>
            <h1 class='name'>{{@model.productName}}</h1>
            {{#if @model.category}}
              <p class='cat'>{{@model.category}}</p>
            {{/if}}
          </div>
          {{#if @model.isDropship}}
            <span class='badge'>Dropship — no stock held</span>
          {{/if}}
        </header>

        <dl class='stats'>
          <div>
            <dt>Cost</dt>
            <dd>{{#if @model.cost.amount}}<@fields.cost
                  @format='atom'
                />{{else}}—{{/if}}</dd>
          </div>
          <div>
            <dt>Price</dt>
            <dd>{{#if @model.price.amount}}<@fields.price
                  @format='atom'
                />{{else}}—{{/if}}</dd>
          </div>
          <div>
            <dt>Margin</dt>
            <dd>{{#if @model.marginPercent}}{{@model.marginPercent}}%{{else}}—{{/if}}</dd>
          </div>
        </dl>

        <div class='cols'>
          <section class='sec'>
            <h2>Shipping profile</h2>
            <@fields.shippingProfile @format='embedded' />
            <p class='hint'>Pre-fills the packing station when this item is the
              only thing in the box.</p>
          </section>

          <section class='sec'>
            <h2>Identifiers</h2>
            <dl class='kv'>
              <div>
                <dt>Barcode</dt>
                <dd class='mono'>{{if @model.barcode @model.barcode '—'}}</dd>
              </div>
              <div>
                <dt>Vendor SKU</dt>
                <dd class='mono'>{{if @model.vendorSku @model.vendorSku '—'}}</dd>
              </div>
            </dl>
          </section>
        </div>

        {{#if @model.vendor}}
          <section class='sec'>
            <h2>Supplied by</h2>
            <@fields.vendor @format='embedded' />
          </section>
        {{/if}}
      </article>

      <style scoped>
        .prod {
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
        .cat {
          margin: 4px 0 0;
          font-size: 0.85rem;
          color: var(--ful-muted-fg, var(--boxel-500));
        }
        .badge {
          font-size: 0.7rem;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          padding: 3px 9px;
          border-radius: 3px;
          color: var(--ful-muted-fg, var(--boxel-500));
          background: color-mix(
            in oklch,
            var(--muted-foreground, var(--boxel-500)) 12%,
            transparent
          );
        }
        .stats {
          display: flex;
          flex-wrap: wrap;
          gap: var(--boxel-sp-xl);
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
          font-size: 1.3rem;
          font-weight: 700;
        }
        .cols {
          display: grid;
          gap: var(--boxel-sp-lg);
          grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
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
        .hint {
          margin: var(--boxel-sp-xs) 0 0;
          font-size: 0.75rem;
          color: var(--ful-muted-fg, var(--boxel-500));
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
        .mono {
          font-family: var(--font-mono, ui-monospace, monospace);
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof FulfilmentProduct> {
    <template>
      <div class='p-emb'>
        <span class='p-sku'>{{@model.sku}}</span>
        <span class='p-name'>{{@model.productName}}</span>
        <span class='p-slot'>{{#if @model.price.amount}}<@fields.price
              @format='atom'
            />{{else}}—{{/if}}</span>
      </div>

      <style scoped>
        .p-emb {
          display: grid;
          grid-template-columns: 6rem minmax(0, 1fr) 5.5rem;
          align-items: baseline;
          gap: var(--boxel-sp-xs);
          font-size: 0.9rem;
        }
        .p-sku {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 0.72rem;
          font-weight: 700;
          letter-spacing: 0.08em;
          color: var(--muted-foreground, var(--boxel-500));
        }
        .p-name {
          font-weight: 600;
          color: var(--foreground, var(--boxel-dark));
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .p-slot {
          text-align: right;
          font-family: var(--font-mono, ui-monospace, monospace);
          font-variant-numeric: tabular-nums;
          font-weight: 700;
          color: var(--foreground, var(--boxel-dark));
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof FulfilmentProduct> {
    <template>
      <span class='p-atom'>{{if @model.sku @model.sku @model.productName}}</span>
      <style scoped>
        .p-atom {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 0.85em;
          font-weight: 700;
          letter-spacing: 0.05em;
        }
      </style>
    </template>
  };

  // The pick card. A picker reads the SKU first and the name second, so the
  // SKU is what survives to badge size — the reverse of a normal card, and the
  // reason this fitted is hand-rolled rather than a FittedCard.
  static fitted = class Fitted extends Component<typeof FulfilmentProduct> {
    <template>
      <article class='fit'>
        <div class='r-head'>
          <div class='eyebrow'>
            <PackageIcon class='glyph' />
          </div>
          <span class='sku'>{{@model.sku}}</span>
          <h3 class='headline'>{{@model.productName}}</h3>
        </div>
        <div class='r-body'>
          <div class='bars' aria-hidden='true'>
            <span></span><span></span><span></span><span></span><span></span>
            <span></span><span></span><span></span><span></span><span></span>
          </div>
          {{#if @model.barcode}}
            <p class='barcode'>{{@model.barcode}}</p>
          {{/if}}
        </div>
        <div class='r-meta'>
          <span class='cat'>{{if @model.category @model.category '—'}}</span>
          {{#if @model.price.amount}}
            <span class='price'><@fields.price @format='atom' /></span>
          {{/if}}
        </div>
      </article>

      <style scoped>
        .fit {
          --type-ratio: 1.22;
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
          --sku-size: max(
            10px,
            min(
              calc(var(--type-base) * pow(var(--type-ratio), 2)),
              26cqb,
              7.5cqi
            )
          );
          --headline-size: max(9px, var(--type-base));
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
          font-size: var(--meta-size);
          color: var(--muted-foreground, var(--boxel-500));
        }
        /* SKU is the headline here, so it takes the display size. */
        .sku {
          display: block;
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: var(--sku-size);
          font-weight: 800;
          letter-spacing: 0.04em;
          line-height: 1.2;
          color: var(--card-foreground, var(--boxel-dark));
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .headline {
          margin: 1px 0 0;
          font-size: var(--headline-size);
          font-weight: 500;
          line-height: 1.2;
          color: var(--muted-foreground, var(--boxel-500));
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;
          overflow: hidden;
        }
        .bars {
          display: flex;
          align-items: stretch;
          gap: 2px;
          height: 18px;
          margin-top: 6px;
        }
        .bars span {
          display: block;
          background: color-mix(in oklch, var(--card-foreground) 70%, transparent);
        }
        .bars span:nth-child(odd) {
          width: 2px;
        }
        .bars span:nth-child(even) {
          width: 4px;
          opacity: 0.55;
        }
        .barcode {
          margin: 3px 0 0;
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: var(--meta-size);
          letter-spacing: 0.18em;
          color: var(--muted-foreground, var(--boxel-500));
          white-space: nowrap;
          overflow: hidden;
        }
        .price {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-variant-numeric: tabular-nums;
          font-weight: 700;
          color: var(--card-foreground, var(--boxel-dark));
        }
        .cat {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        @container fitted-card (height <= 50px) {
          .fit {
            grid-template-rows: auto;
          }
          .r-body,
          .r-meta,
          .headline {
            display: none;
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
          .barcode {
            display: none;
          }
          .bars {
            height: 12px;
          }
        }
        @container fitted-card (width <= 140px) {
          .cat {
            display: none;
          }
        }
      </style>
    </template>
  };
}

export default FulfilmentProduct;
