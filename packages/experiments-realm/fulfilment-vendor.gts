import {
  CardDef,
  Component,
  StringField,
  contains,
  field,
  realmURL,
} from '@cardstack/base/card-api';
import NumberField from '@cardstack/base/number';
import BooleanField from '@cardstack/base/boolean';
import AddressField from '@cardstack/base/address';
import EmailField from '@cardstack/base/email';
import AmountWithCurrency from '@cardstack/base/amount-with-currency';
import FactoryIcon from '@cardstack/boxel-icons/building-factory';
import MapPin from '@cardstack/boxel-icons/map-pin';
import User from '@cardstack/boxel-icons/user';
import { money } from './fulfilment-format';
import { identifyCard, type getCards } from '@cardstack/runtime-common';
import type Owner from '@ember/owner';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import Package from '@cardstack/boxel-icons/package';
// Cyclic with fulfilment-product.gts (it links to this vendor); the binding is
// only read inside the constructor, never at module evaluation.
import { FulfilmentProduct } from './fulfilment-product';

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
    // "What do we buy from them" is the question, and the answer lives on the
    // products pointing at this vendor.
    private productQuery: ReturnType<getCards> | undefined;

    constructor(owner: Owner, args: any) {
      super(owner, args);
      this.productQuery = this.args.context?.getCards(
        this,
        () => {
          let ref = identifyCard(FulfilmentProduct);
          let id = this.args.model?.id;
          if (!ref || !id) {
            return undefined;
          }
          return { filter: { on: ref, every: [{ eq: { 'vendor.id': id } }] } };
        },
        () => this.realms,
        { isLive: true },
      );
    }

    // A live query resolving AFTER first paint is why this card asserted "no
    // products" about data it had not received. `getCards` publishes `isLoading`
    // and nothing here read it. Guarded on emptiness too, so a background
    // refresh of an already-populated list does not flash a skeleton.
    get isQueryLoading() {
      let q = this.productQuery as any;
      return Boolean(q?.isLoading) && !(q?.instances ?? []).filter(Boolean).length;
    }

    private get realms(): string[] | undefined {
      let url = (this.args.model as any)?.[realmURL];
      return url ? [url.href] : undefined;
    }

    // `getCards` returns a SearchResource, whose `errors` the exported duck type
    // omits — so it is reached by cast. Without reading it a failed query is
    // indistinguishable from an empty realm, and the section would assert
    // "there are none" when the truth is "we could not look".
    // Rows name real cards; opening them is the next step of the task, and a
    // <button> gets the keyboard path and focus ring for free.
    @action open(card: any) {
      (this.args as any).viewCard?.(card, 'isolated');
    }

    get queryError(): string | undefined {
      let entries = (this.productQuery as any)?.errors as any[] | undefined;
      if (!entries?.length) {
        return undefined;
      }
      return entries[0]?.error?.message ?? 'The query failed.';
    }

    get products(): any[] {
      return (this.productQuery?.instances ?? []).filter(Boolean);
    }

    get dropshipCount() {
      return this.products.filter((p) => p.isDropship).length;
    }

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
            <dd>{{#if @model.minimumOrder.amount}}{{money @model.minimumOrder.amount @model.minimumOrder.currency.code}}{{else}}—{{/if}}</dd>
          </div>
          <div>
            <dt>Dropship fee</dt>
            <dd>{{#if @model.dropshipFee.amount}}{{money @model.dropshipFee.amount @model.dropshipFee.currency.code}}{{else}}—{{/if}}</dd>
          </div>
          <div>
            <dt>Products supplied</dt>
            <dd>{{this.products.length}}</dd>
          </div>
        </dl>

        <div class='cols'>
          <section class='sec'>
            <h2><User class='sec-icon' role='presentation' />Contact</h2>
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
            <h2><MapPin class='sec-icon' role='presentation' />Ships from</h2>
            <@fields.address @format='embedded' />
          </section>
        </div>

        <section class='sec'>
          <h2><Package class='sec-icon' role='presentation' />Products supplied</h2>
          {{#if this.queryError}}
            <p class='q-error' role='alert'>Could not read this vendor's products.
              {{this.queryError}}</p>
          {{! Loading is not empty. Space is reserved so the section does not
              jump when the query lands. }}
          {{else if this.isQueryLoading}}
            <ul class='sk-rows' aria-busy='true'>
              <li class='sk-line'></li>
              <li class='sk-line'></li>
              <li class='sk-line'></li>
            </ul>
          {{else if this.products.length}}
            <ul class='vp-rows'>
              {{#each this.products as |p|}}
                <li class='vp-row-li'>
                  <button
                    type='button'
                    class='vp-row'
                    {{on 'click' (fn this.open p)}}
                  >
                  {{#if p.image.resolvedUrl}}
                    <img class='vp-thumb' src={{p.image.resolvedUrl}} alt='' loading='lazy' />
                  {{else}}
                    <span class='vp-thumb vp-blank'></span>
                  {{/if}}
                  <span class='vp-sku'>{{if p.sku p.sku '—'}}</span>
                  <span class='vp-name'>{{if p.productName p.productName ''}}</span>
                  <span class='vp-vsku'>{{if p.vendorSku p.vendorSku ''}}</span>
                  <span class='vp-cost'>{{#if p.cost.amount}}{{money
                        p.cost.amount
                        p.cost.currency.code
                      }}{{else}}—{{/if}}</span>
                </button>
                </li>
              {{/each}}
            </ul>
            {{#if this.dropshipCount}}
              <p class='hint'>{{this.dropshipCount}}
                of these ship direct from this vendor rather than from your own
                shelves.</p>
            {{/if}}
          {{else}}
            <p class='hint'>No products name this vendor yet. Set a product's
              supplier to see it here.</p>
          {{/if}}
        </section>

        {{#unless @model.supportsDropship}}
          <p class='note'>
            This vendor restocks your warehouses only. Orders for their products
            are picked from your own shelves, never forwarded.
          </p>
        {{/unless}}
      </article>

      <style scoped>
        .vendor {
          /* Type scale, mapped to the house 1.333 modular scale rather than the
             28 hand-picked rem values these cards used to carry — 44 of which
             fell below 12px, under the smallest token the design system has. */
          --t-micro: var(--boxel-font-size-xs);
          --t-sm: var(--boxel-font-size-sm);
          --t-body: var(--boxel-font-size);
          --t-lg: var(--boxel-font-size-lg);
          --t-xl: var(--boxel-font-size-xl);
          /* Isolated gets NO container from the host — every ancestor up to the
             panel is `container-type: normal`, so an `@container` rule here is
             inert until this declares its own. `inline-size`, not `size`: the
             card scrolls, and `size` needs a definite block size. */
          container-type: inline-size;
          container-name: card-iso;
          --ful-bg: var(--background);
          --ful-fg: var(--foreground);
          --ful-muted-fg: var(--muted-foreground);
          --ful-border: var(--border);

          /* ONE panel primitive. Every full-width tinted block on this card —
             section, note, alert, callout — takes its ground, inset and radius
             from here, because a background makes spacing VISIBLE: while
             sections were separated by whitespace alone, a note padded
             `sp-sm` and a section padded `sp-lg` looked the same. Tint them
             both and their text edges no longer line up down the page, and
             every gap between them reads as a mis-registration rather than a
             rhythm. The inset is the thing that must agree; the tint only
             exposed it. */
          /* State colours through the adapter block, not as literal hex. These
             were `#b91c1c` / `#b45309` / `#15803d` written straight into `color:`
             declarations — a text colour no theme can move, and the exact thing
             boxel-theming C1 forbids. Each is now the semantic state token mixed
             TOWARD `--foreground`, which is what keeps it legible on a dark ground
             as well as a light one: --foreground flips, so the mix flips with it.
             `--warning` is `initial` in some themes, hence a `--boxel-*` fallback
             on every one. */
          --ful-danger: color-mix(
            in oklch,
            var(--destructive, var(--boxel-danger)) 58%,
            var(--foreground, var(--boxel-dark))
          );
          --ful-warn: color-mix(
            in oklch,
            var(--warning, var(--boxel-warning)) 58%,
            var(--foreground, var(--boxel-dark))
          );
          --ful-ok: color-mix(
            in oklch,
            var(--success, var(--boxel-success)) 58%,
            var(--foreground, var(--boxel-dark))
          );
          --panel-bg: color-mix(in oklch, var(--foreground) 3%, transparent);
          --panel-pad: var(--boxel-sp) var(--boxel-sp-lg) var(--boxel-sp-lg);
          --panel-radius: var(--radius, 8px);
          /* The ONE vertical rhythm. It used to be `margin-top` on `.sec` plus a
             `.cols .sec { margin-top: 0 }` override for the side-by-side case —
             two mechanisms for one relationship, and `.cols` itself had neither,
             so the gap above a two-column group measured 0px while the gap above
             a stacked section measured 28.4px. A tinted panel colliding with the
             text above it is what that 0 looks like. */
          --panel-gap: var(--boxel-sp-xl);
          --ful-rule: color-mix(in oklch, var(--foreground) 12%, transparent);

          display: flex;
          flex-direction: column;
          gap: var(--panel-gap);
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
          font-size: var(--t-micro);
          font-weight: 700;
          letter-spacing: 0.16em;
          color: var(--ful-muted-fg, var(--boxel-500));
        }
        .name {
          margin: 0.1rem 0 0;
          font-size: var(--t-xl);
          line-height: 1.05;
          font-family: var(--font-heading, inherit);
        }
        .badge {
          font-size: var(--t-micro);
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
          margin: 0;
        }
        .stats div {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .stats dt {
          font-size: var(--t-micro);
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--ful-muted-fg, var(--boxel-500));
        }
        .stats dd {
          margin: 0;
          font-family: var(--font-mono, ui-monospace, monospace);
          font-variant-numeric: tabular-nums;
          font-size: var(--t-lg);
          font-weight: 700;
        }
        .unit {
          font-size: var(--t-micro);
          color: var(--ful-muted-fg, var(--boxel-500));
        }
        .cols {
          display: grid;
          gap: var(--boxel-sp-lg);
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        }
        .sec {
          /* A surface, not just a gap. Sections were told apart only by spacing,
             and their headings were 12px uppercase muted — pixel-identical to
             every table column label on the card, so "where does a section
             start" had no answer. The ground is mixed toward --foreground so it
             follows the theme in both modes rather than being a grey. */
          padding: var(--panel-pad);
          border-radius: var(--panel-radius);
          background: var(--panel-bg);
        }
        .sec h2 {
          /* The section heading is now the loudest uppercase thing on the card:
             --foreground against the column labels' --muted-foreground. Weight
             alone (500 vs 400) was not a readable difference. */
          display: flex;
          align-items: center;
          gap: 7px;
          margin: 0 0 var(--boxel-sp-xs);
          font-size: var(--t-micro);
          font-weight: 700;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: var(--ful-fg, var(--foreground, var(--boxel-dark)));
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
          font-size: var(--t-micro);
          color: var(--ful-muted-fg, var(--boxel-500));
        }
        .kv dd {
          margin: 0;
          font-size: var(--t-sm);
        }
        .mono {
          font-family: var(--font-mono, ui-monospace, monospace);
        }
        /* Measured before: padL 12.0 / radius 0 / no ground, against panels at
           padL 21.3 / radius 10 / 3% tint. Same page, two insets — so its text
           started 9px left of every heading above it. It keeps its quiet voice
           (no ground) but takes the panel geometry so it registers. */
        .note {
          margin: 0;
          padding: var(--panel-pad);
          border-radius: var(--panel-radius);
          border-left: 3px solid var(--ful-border, var(--boxel-border-color));
          font-size: var(--t-sm);
          color: var(--ful-muted-fg, var(--boxel-500));
        }
      
        /* Section icons: one size, one muted colour, everywhere. They make the
           card scannable by shape; they must never compete with the heading. */
        h2 .sec-icon {
          width: max(14px, 1em);
          height: max(14px, 1em);
          flex: 0 0 auto;
          color: var(--ful-muted-fg, var(--boxel-500));
        }

        /* One collapse stop. The card is rendered in a resizable stack panel, so
           this fires when a second card opens beside it — not only on a phone. */
        @container card-iso (width < 720px) {
          .cols,
          .grid,
          .two {
            grid-template-columns: 1fr;
          }
        }
      
        .vp-rows {
          margin: 0;
          padding: 0;
          list-style: none;
        }
        .vp-row {
          display: grid;
          grid-template-columns: 34px 6rem minmax(0, 1fr) 7rem 5rem;
          align-items: center;
          gap: var(--boxel-sp-xs);
          padding: 6px 0;
          border-top: 1px solid var(--ful-rule, var(--boxel-border-color));
          font-size: var(--t-sm);
        }
        .vp-thumb {
          width: 34px;
          height: 34px;
          object-fit: cover;
          border-radius: 4px;
        }
        .vp-blank {
          background: color-mix(in oklch, var(--foreground) 8%, transparent);
        }
        .vp-sku,
        .vp-vsku,
        .vp-cost {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-variant-numeric: tabular-nums;
        }
        .vp-name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .vp-vsku {
          font-size: var(--t-micro);
          color: var(--ful-muted-fg, var(--boxel-500));
        }
        .vp-cost {
          text-align: right;
          font-weight: 700;
        }
      
        .vp-row-li {
          list-style: none;
        }
        /* The row became a button: strip the chrome, keep the grid, and give it a
           real affordance. 160ms sits inside the 150-300ms micro-interaction
           window; `prefers-reduced-motion` removes it rather than shortening it. */
        button.vp-row {
          width: 100%;
          border: 0;
          border-top: 1px solid var(--ful-rule, var(--boxel-border-color));
          background: none;
          font: inherit;
          color: inherit;
          text-align: left;
          cursor: pointer;
          transition: background-color 160ms ease-out;
        }
        button.vp-row:hover {
          background: color-mix(in oklch, var(--foreground) 5%, transparent);
        }
        button.vp-row:focus-visible {
          outline: 2px solid var(--ring, var(--boxel-highlight));
          outline-offset: -2px;
        }
        @media (prefers-reduced-motion: reduce) {
          button.vp-row {
            transition: none;
          }
        }
        /* Skeleton rows hold the height the real rows will take. Motion is
           opt-in via prefers-reduced-motion; the shape is not. */
        .sk-rows {
          margin: 0;
          padding: 0;
          list-style: none;
          display: grid;
          gap: 8px;
        }
        .sk-line {
          height: 14px;
          border-radius: 3px;
          background: color-mix(in oklch, var(--foreground) 7%, transparent);
        }
        @media (prefers-reduced-motion: no-preference) {
          .sk-line {
            animation: sk-pulse 1.4s ease-in-out infinite;
          }
        }
        @keyframes sk-pulse {
          50% {
            opacity: 0.45;
          }
        }
        .q-error {
          margin: 0;
          padding: var(--boxel-sp-xs) 0;
          font-size: var(--t-sm);
          color: var(--ful-danger);
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
        /* A CardDef's embedded template must supply its OWN inset. The host wraps
           a linksTo render in a CardContainer that draws a rounded boundary and
           deliberately adds no padding — field-component.gts:513 says so in as
           many words, because padding there would move the container-query
           breakpoints the card reasons about. With none on either side the text
           sits flush against the pill, which is what "Northline Supply" looked
           like inside Supplied by. FieldDef embeddeds get no boundary and so
           never showed this. */
        .v-emb {
          padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
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
          --meta-size: max(11px, calc(var(--type-base) / var(--type-ratio)));
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
