import {
  CardDef,
  Component,
  StringField,
  contains,
  field,
} from '@cardstack/base/card-api';
import NumberField from '@cardstack/base/number';
import BooleanField from '@cardstack/base/boolean';
import AddressField from '@cardstack/base/address';
import EmailField from '@cardstack/base/email';
import AmountWithCurrency from '@cardstack/base/amount-with-currency';
import FactoryIcon from '@cardstack/boxel-icons/building-factory';

// Vendor (Ve) — a supplier. Two jobs, and it matters that they are separate:
// restocking your own shelves (lead time, minimum order), and dropshipping
// straight to your customer (supported or not, and what the fee is).
//
// A vendor that does not support dropship still restocks; a vendor that only
// dropships has no lead time worth recording. Both are valid cards.
export class FulfilmentVendor extends CardDef {
  static displayName = 'Vendor';
  static icon = FactoryIcon;

  @field code = contains(StringField);
  @field vendorName = contains(StringField);
  @field contactEmail = contains(EmailField);
  @field contactPhone = contains(StringField);
  @field address = contains(AddressField);

  @field leadTimeDays = contains(NumberField);
  @field minimumOrder = contains(AmountWithCurrency);

  @field supportsDropship = contains(BooleanField);
  @field dropshipFee = contains(AmountWithCurrency);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: FulfilmentVendor) {
      return this.vendorName?.length ? this.vendorName : 'Untitled Vendor';
    },
  });

  get leadTimeLabel() {
    let d = this.leadTimeDays;
    if (d == null) {
      return undefined;
    }
    return d === 1 ? '1 day lead' : `${d} day lead`;
  }

  // Vendor Workspace (VW): everything you need before placing a restock or
  // handing a dropship order over, on one surface.
  static isolated = class Isolated extends Component<typeof FulfilmentVendor> {
    <template>
      <article class='vendor'>
        <header class='hd'>
          <div>
            <span class='code'>{{@model.code}}</span>
            <h1 class='name'>{{@model.vendorName}}</h1>
          </div>
          {{#if @model.supportsDropship}}
            <span class='badge'>Dropship enabled</span>
          {{/if}}
        </header>

        <dl class='stats'>
          <div>
            <dt>Lead time</dt>
            <dd>{{#if @model.leadTimeDays}}{{@model.leadTimeDays}}<span
                  class='unit'
                >d</span>{{else}}—{{/if}}</dd>
          </div>
          <div>
            <dt>Minimum order</dt>
            <dd>{{#if @model.minimumOrder.amount}}<@fields.minimumOrder
                  @format='atom'
                />{{else}}—{{/if}}</dd>
          </div>
          <div>
            <dt>Dropship fee</dt>
            <dd>{{#if @model.dropshipFee.amount}}<@fields.dropshipFee
                  @format='atom'
                />{{else}}—{{/if}}</dd>
          </div>
        </dl>

        <div class='cols'>
          <section class='sec'>
            <h2>Contact</h2>
            <dl class='kv'>
              <div>
                <dt>Email</dt>
                <dd><@fields.contactEmail @format='atom' /></dd>
              </div>
              <div>
                <dt>Phone</dt>
                <dd class='mono'>{{if @model.contactPhone @model.contactPhone '—'}}</dd>
              </div>
            </dl>
          </section>
          <section class='sec'>
            <h2>Ships from</h2>
            <@fields.address @format='embedded' />
          </section>
        </div>

        {{#unless @model.supportsDropship}}
          <p class='note'>
            This vendor restocks your warehouses only. Orders for their products
            are picked from your own shelves, never forwarded.
          </p>
        {{/unless}}
      </article>

      <style scoped>
        .vendor {
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
        .code {
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
        .unit {
          font-size: 0.8rem;
          color: var(--ful-muted-fg, var(--boxel-500));
        }
        .cols {
          display: grid;
          gap: var(--boxel-sp-lg);
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
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
          grid-template-columns: 4.5rem minmax(0, 1fr);
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
        .note {
          margin: var(--boxel-sp-lg) 0 0;
          padding: var(--boxel-sp-sm);
          border-left: 3px solid var(--ful-border, var(--boxel-border-color));
          font-size: 0.85rem;
          color: var(--ful-muted-fg, var(--boxel-500));
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof FulfilmentVendor> {
    <template>
      <div class='v-emb'>
        <span class='v-code'>{{@model.code}}</span>
        <span class='v-name'>{{@model.vendorName}}</span>
        <span class='v-slot'>{{if @model.leadTimeLabel @model.leadTimeLabel '—'}}</span>
        <span class='v-slot'>{{if @model.supportsDropship 'Dropship' '—'}}</span>
      </div>

      <style scoped>
        .v-emb {
          display: grid;
          grid-template-columns: 5.5rem minmax(0, 1fr) 7rem 5.5rem;
          align-items: baseline;
          gap: var(--boxel-sp-xs);
          font-size: 0.9rem;
        }
        .v-code {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 0.7rem;
          font-weight: 700;
          letter-spacing: 0.1em;
          color: var(--muted-foreground, var(--boxel-500));
        }
        .v-name {
          font-weight: 600;
          color: var(--foreground, var(--boxel-dark));
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .v-slot {
          text-align: right;
          font-size: 0.78rem;
          color: var(--muted-foreground, var(--boxel-500));
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof FulfilmentVendor> {
    <template>
      <span class='v-atom'>{{if @model.vendorName @model.vendorName @model.code}}</span>
      <style scoped>
        .v-atom {
          font-weight: 600;
          font-size: 0.85em;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof FulfilmentVendor> {
    <template>
      <article class='fit'>
        <div class='r-head'>
          <div class='eyebrow'>
            <FactoryIcon class='glyph' />
            <span class='code'>{{@model.code}}</span>
          </div>
          <h3 class='headline'>{{@model.vendorName}}</h3>
        </div>
        <div class='r-body'>
          {{#if @model.minimumOrder.amount}}
            <p class='min'>Minimum order
              <@fields.minimumOrder @format='atom' /></p>
          {{/if}}
        </div>
        <div class='r-meta'>
          <span class='lead'>{{if @model.leadTimeLabel @model.leadTimeLabel '—'}}</span>
          {{#if @model.supportsDropship}}
            <span class='ds'>Dropship</span>
          {{/if}}
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
          --headline-size: max(
            11px,
            min(calc(var(--type-base) * pow(var(--type-ratio), 2)), 26cqb)
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
          font-size: var(--meta-size);
          color: var(--muted-foreground, var(--boxel-500));
        }
        .code {
          display: block;
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: var(--meta-size);
          font-weight: 700;
          letter-spacing: 0.14em;
          color: var(--muted-foreground, var(--boxel-500));
        }
        .headline {
          margin: 0;
          font-size: var(--headline-size);
          line-height: 1.2;
          font-weight: 700;
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;
          overflow: hidden;
        }
        .min {
          margin: 4px 0 0;
          font-size: var(--meta-size);
          color: var(--muted-foreground, var(--boxel-500));
        }
        .lead {
          font-weight: 700;
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
        @container fitted-card (50px < height <= 130px) {
          .r-body {
            display: none;
          }
        }
        @container fitted-card (width <= 130px) {
          .ds {
            display: none;
          }
        }
      </style>
    </template>
  };
}

export default FulfilmentVendor;
