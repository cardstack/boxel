import {
  CardDef,
  Component,
  StringField,
  contains,
  field,
  linksTo,
  realmURL,
} from '@cardstack/base/card-api';
import NumberField from '@cardstack/base/number';
import DatetimeField from '@cardstack/base/datetime';
import { htmlSafe } from '@ember/template';
import BoxesIcon from '@cardstack/boxel-icons/boxes';
import Package from '@cardstack/boxel-icons/package';
import RotateCcw from '@cardstack/boxel-icons/rotate-ccw';
import { FulfilmentProduct } from './fulfilment-product';
import { Warehouse } from './warehouse';
import { identifyCard, type getCards } from '@cardstack/runtime-common';
import type Owner from '@ember/owner';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import Network from '@cardstack/boxel-icons/git-fork';
import { eq } from '@cardstack/boxel-ui/helpers';

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

  // Denormalized for the same reason as `sku` and `productName`: a prerendered
  // fitted cannot resolve a linksTo, so a stock tile that wants the product
  // photo has to be handed the resolved URL rather than the linked card.
  @field productImageUrl = contains(StringField, {
    computeVia: function (this: InventoryStock) {
      return this.product?.image?.resolvedUrl;
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

  // A row that has not been filled in yet is not a stock signal. Without this
  // guard a freshly created blank row counted as out-of-stock the moment it was
  // saved, so "Add Stock Row" incremented the OUT OF STOCK KPI that purchasing
  // acts on — a number pointing at a shortage that does not exist.
  // Deliberately NOT `product == null || warehouse == null`: those are linksTo,
  // and a linked card reads as null in prerender and index contexts, so that
  // test marked every saved row a draft and emptied the out-of-stock count.
  // `binLocation` and the quantities are local, so they mean the same thing
  // wherever the row is evaluated.
  get isDraft() {
    return (
      !this.binLocation &&
      this.quantityOnHand == null &&
      this.quantityReserved == null &&
      this.quantityIncoming == null &&
      this.reorderPoint == null
    );
  }

  get isOutOfStock() {
    if (this.isDraft) {
      return false;
    }
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
      if (this.isDraft) {
        return 'draft';
      }
      if (this.isOutOfStock) {
        return 'out';
      }
      return this.isLowStock ? 'low' : 'ok';
    },
  });

  get stockHue() {
    if (this.isDraft) {
      return '#94a3b8';
    }
    if (this.isOutOfStock) {
      return '#ef4444';
    }
    return this.isLowStock ? '#f59e0b' : '#15803d';
  }

  // The four stock figures are not four facts — they are one whole and a future
  // arrival. On-hand splits exactly into available + reserved, and incoming is
  // stock that is not here yet. Printed as four separate numbers, every one of
  // those relationships is invisible and the reader has to do the arithmetic:
  // "18 available, 18 on hand" only means "nothing is reserved" once you have
  // subtracted. Drawn as one bar it is a single glance.
  //
  // The bar's full length is on-hand PLUS incoming, so the ghost segment shows
  // how much of what this SKU is about to have has actually landed. The reorder
  // point is a tick on the same scale, which is what makes "below the line"
  // legible without reading a second number.
  get stockComposition() {
    let onHand = this.quantityOnHand ?? 0;
    let reserved = Math.min(this.quantityReserved ?? 0, onHand);
    let available = Math.max(0, onHand - reserved);
    let incoming = this.quantityIncoming ?? 0;
    let total = onHand + incoming;
    if (total <= 0) {
      return undefined;
    }
    let point = this.reorderPoint;
    return {
      onHand,
      available,
      reserved,
      incoming,
      total,
      availablePct: (available / total) * 100,
      reservedPct: (reserved / total) * 100,
      incomingPct: (incoming / total) * 100,
      // Only a reorder point that falls inside the drawn scale can be drawn on
      // it. Off-scale, the tick would sit on the end cap and assert a threshold
      // it is not measuring.
      reorderPct:
        point != null && point > 0 && point <= total
          ? (point / total) * 100
          : undefined,
      reorderPoint: point,
    };
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
    // A row on its own cannot answer the question a short pick actually raises:
    // "is there any elsewhere?". That is a sibling query on the same product.
    private siblingQuery: ReturnType<getCards> | undefined;

    constructor(owner: Owner, args: any) {
      super(owner, args);
      this.siblingQuery = this.args.context?.getCards(
        this,
        () => {
          let ref = identifyCard(InventoryStock);
          let productId = (this.args.model as any)?.product?.id;
          if (!ref || !productId) {
            return undefined;
          }
          return {
            filter: { on: ref, every: [{ eq: { 'product.id': productId } }] },
          };
        },
        () => this.realms,
        { isLive: true },
      );
    }

    // A live query resolving AFTER first paint is why this card asserted "no
    // sibling rows" about data it had not received. `getCards` publishes `isLoading`
    // and nothing here read it. Guarded on emptiness too, so a background
    // refresh of an already-populated list does not flash a skeleton.
    get isQueryLoading() {
      let q = this.siblingQuery as any;
      return Boolean(q?.isLoading) && !(q?.instances ?? []).filter(Boolean).length;
    }

    private get realms(): string[] | undefined {
      let url = (this.args.model as any)?.[realmURL];
      return url ? [url.href] : undefined;
    }

    // The query returns this row too; drop it so "elsewhere" means elsewhere.
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
      let entries = (this.siblingQuery as any)?.errors as any[] | undefined;
      if (!entries?.length) {
        return undefined;
      }
      return entries[0]?.error?.message ?? 'The query failed.';
    }

    get elsewhere(): any[] {
      let self = this.args.model?.id;
      return (this.siblingQuery?.instances ?? [])
        .filter(Boolean)
        .filter((r: any) => r.id !== self);
    }

    get elsewhereTotal() {
      return this.elsewhere.reduce(
        (n, r: any) => n + (r.quantityAvailable ?? 0),
        0,
      );
    }

    <template>
      {{! The stock hue is forwarded once, at the root, rather than per element:
          the composition bar, its legend swatches and the status chip then all
          read one value, so "low" cannot be amber in one place and green in
          another. Previously only the embedded and fitted views set it, so the
          isolated bar would have fallen back to the generic highlight and lost
          the low/out signal entirely. }}
      <article class='stk' style={{stockAccent @model.stockHue}}>
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

        {{! The headline figure keeps its own size — "how many can I promise" is
            the question this card exists to answer, and it is one number. What
            changed is everything under it: the other three used to be equal
            tiles of equal weight, which spent a full row saying less than the
            bar now says in one line. }}
        {{! The headline figure, the composition bar and the arithmetic note are
            ONE unit — they explain a single number together. Wrapped, so the
            root's 28.4px rhythm separates units and this group keeps its own
            tight internal spacing. Unwrapped, each part was a root sibling and
            the bar drifted 28px away from the figure it belongs to. }}
        <div class='stock-summary'>
          <div class='stock-figure'>
          <span class='sf-label'>Available to promise</span>
          <span class='sf-value'>{{if
              @model.quantityAvailable
              @model.quantityAvailable
              0
            }}</span>
          <span class='sf-unit'>{{if
              (eq @model.quantityAvailable 1)
              'unit'
              'units'
            }}</span>
        </div>

        {{#if @model.stockComposition}}
          {{#let @model.stockComposition as |c|}}
            {{! aria-hidden on the drawing only: the legend below carries every
                number the bar encodes, in text, so nothing is available to
                sighted readers alone. }}
            <div class='comp'>
              <div class='comp-bar' aria-hidden='true'>
                <span
                  class='comp-seg seg-avail'
                  style={{segStyle c.availablePct}}
                ></span>
                <span
                  class='comp-seg seg-resv'
                  style={{segStyle c.reservedPct}}
                ></span>
                <span
                  class='comp-seg seg-inc'
                  style={{segStyle c.incomingPct}}
                ></span>
                {{#if c.reorderPct}}
                  <span
                    class='comp-tick'
                    style={{tickStyle c.reorderPct}}
                  ></span>
                {{/if}}
              </div>
              <dl class='comp-legend'>
                <div class='cl cl-avail'>
                  <dt>Available</dt>
                  <dd>{{c.available}}</dd>
                </div>
                <div class='cl cl-resv'>
                  <dt>Reserved</dt>
                  <dd>{{c.reserved}}</dd>
                </div>
                <div class='cl cl-inc'>
                  <dt>Incoming</dt>
                  <dd>{{c.incoming}}</dd>
                </div>
                <div class='cl cl-total'>
                  <dt>On hand</dt>
                  <dd>{{c.onHand}}</dd>
                </div>
                {{#if c.reorderPoint}}
                  <div class='cl cl-tick'>
                    <dt>Reorder at</dt>
                    <dd>{{c.reorderPoint}}</dd>
                  </div>
                {{/if}}
              </dl>
            </div>
          {{/let}}
        {{else}}
          <p class='arith'>No quantities recorded yet, so there is nothing to
            draw. Add an on-hand count to see the split.</p>
        {{/if}}

          <p class='arith'>
            On hand splits into available and reserved; incoming has not landed
            yet. Available is computed on every read, so a reservation shows up
            here the moment an order claims it.
          </p>
        </div>

        <section class='sec'>
          <h2><RotateCcw class='sec-icon' role='presentation' />Reordering</h2>
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

        <section class='sec'>
          <h2><Network class='sec-icon' role='presentation' />Elsewhere in the
            network</h2>
          {{#if this.queryError}}
            <p class='q-error' role='alert'>Could not check other locations.
              {{this.queryError}}</p>
          {{! Loading is not empty. Space is reserved so the section does not
              jump when the query lands. }}
          {{else if this.isQueryLoading}}
            <ul class='sk-rows' aria-busy='true'>
              <li class='sk-line'></li>
              <li class='sk-line'></li>
              <li class='sk-line'></li>
            </ul>
          {{else if this.elsewhere.length}}
            <p class='else-total'><strong>{{this.elsewhereTotal}}</strong>
              available in
              {{this.elsewhere.length}}
              other
              {{if (eq this.elsewhere.length 1) 'location' 'locations'}}</p>
            <ul class='else-rows'>
              {{#each this.elsewhere as |row|}}
                <li class='else-row-li'>
                  <button
                    type='button'
                    class='else-row els-{{row.stockState}}'
                    {{on 'click' (fn this.open row)}}
                  >
                  <span class='el-wh'>{{if
                      row.warehouseCode
                      row.warehouseCode
                      '—'
                    }}</span>
                  <span class='el-bin'>{{if row.binLocation row.binLocation ''}}</span>
                  <span class='el-qty'>{{row.quantityAvailable}}</span>
                  <span class='el-state'>{{row.stockState}}</span>
                </button>
                </li>
              {{/each}}
            </ul>
          {{else}}
            <p class='hint'>This is the only place this product is stocked. A
              short pick here cannot be covered from another bin.</p>
          {{/if}}
        </section>

        {{#if @model.product}}
          <section class='sec'>
            <h2><Package class='sec-icon' role='presentation' />Product</h2>
            <@fields.product @format='embedded' />
          </section>
        {{/if}}
      </article>

      <style scoped>
        .stk {
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
             so the measured gap above a two-column group was 0px while the gap
             above a stacked section was 28.4px. A tinted panel colliding with
             the text above it is what that 0 looks like. */
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
        .sku {
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
        .where {
          display: flex;
          gap: 8px;
          margin: 6px 0 0;
        }
        .wh,
        .bin {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: var(--t-micro);
          font-weight: 700;
          letter-spacing: 0.08em;
          padding: 2px 7px;
          border-radius: 3px;
          border: 1px solid var(--ful-border, var(--boxel-border-color));
          color: var(--ful-muted-fg, var(--boxel-500));
        }
        .state {
          font-size: var(--t-micro);
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
        /* The one figure the card exists to answer, at the size that says so.
           No box around it: a border earns its place by separating things that
           would otherwise run together, and nothing here would. */
        .stock-summary {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-xs);
        }
        .stock-figure {
          display: flex;
          align-items: baseline;
          gap: var(--boxel-sp-xs);
          margin: 0;
          flex-wrap: wrap;
        }
        .sf-label {
          font-size: var(--t-micro);
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--ful-muted-fg, var(--boxel-500));
          flex: 1 0 100%;
        }
        .sf-value {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-variant-numeric: tabular-nums;
          font-size: calc(var(--t-xl) * 1.5);
          font-weight: 800;
          line-height: 1;
        }
        .sf-unit {
          font-size: var(--t-sm);
          color: var(--ful-muted-fg, var(--boxel-500));
        }

        /* One length, three segments, one threshold tick. The composition is the
           point: on-hand splits into available + reserved, and the ghost tail is
           stock that has not arrived. */
        .comp {
          margin: 0;
        }
        .comp-bar {
          position: relative;
          display: flex;
          height: 14px;
          border-radius: 7px;
          overflow: hidden;
          background: var(--ful-sunk, color-mix(in oklch, currentColor 4%, transparent));
        }
        .comp-seg {
          display: block;
          flex-grow: 0;
          flex-shrink: 0;
          min-width: 0;
        }
        /* Available is the stock hue — the same hue the status chip and the
           fitted gauge use, so "healthy" is one colour across the card.
           The fallback was `--boxel-highlight`, the brand teal: with no hue in
           the data the bar turned teal, asserting a status colour the data never
           supplied. boxel-theming §1c wants a data hue to degrade to a NEUTRAL
           that still follows the theme, which is exactly what this file's own
           `statusHue()` already does (fulfilment-status-chip.gts:68). */
        .seg-avail {
          background: var(--stock-hue, var(--muted-foreground, var(--boxel-500)));
        }
        /* Reserved is present but spoken for: the same hue, diluted, rather than
           a second colour that would read as a different KIND of thing. */
        .seg-resv {
          background: color-mix(
            in oklch,
            var(--stock-hue, var(--muted-foreground, var(--boxel-500))) 38%,
            transparent
          );
        }
        /* Incoming is not here yet, so it is drawn as absence with an edge:
           hatched, not filled. */
        .seg-inc {
          background: repeating-linear-gradient(
            135deg,
            color-mix(in oklch, var(--foreground) 14%, transparent) 0 3px,
            transparent 3px 6px
          );
        }
        .comp-tick {
          position: absolute;
          top: -2px;
          bottom: -2px;
          width: 2px;
          transform: translateX(-1px);
          background: var(--ful-fg, var(--boxel-dark));
        }
        .comp-legend {
          display: flex;
          flex-wrap: wrap;
          gap: var(--boxel-sp-xs) var(--boxel-sp);
          margin: var(--boxel-sp-xs) 0 0;
        }
        /* Each legend entry carries its own swatch, so the mapping from colour
           to number never depends on reading order. */
        .cl {
          display: flex;
          align-items: baseline;
          gap: 5px;
        }
        .cl dt {
          display: flex;
          align-items: center;
          gap: 5px;
          font-size: var(--t-micro);
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--ful-muted-fg, var(--boxel-500));
        }
        .cl dt::before {
          content: '';
          width: 9px;
          height: 9px;
          border-radius: 2px;
          flex: none;
        }
        .cl-avail dt::before {
          background: var(--stock-hue, var(--muted-foreground, var(--boxel-500)));
        }
        .cl-resv dt::before {
          background: color-mix(
            in oklch,
            var(--stock-hue, var(--muted-foreground, var(--boxel-500))) 38%,
            transparent
          );
        }
        .cl-inc dt::before {
          background: repeating-linear-gradient(
            135deg,
            color-mix(in oklch, var(--foreground) 24%, transparent) 0 2px,
            transparent 2px 4px
          );
        }
        /* On hand is the sum, not a segment, so it gets a rule rather than a
           swatch — and the tick's marker matches the tick on the bar. */
        .cl-total dt::before {
          background: none;
          border-top: 2px solid var(--ful-perf);
          height: 0;
          border-radius: 0;
        }
        .cl-tick dt::before {
          background: none;
          width: 2px;
          height: 11px;
          border-radius: 0;
          background: var(--ful-fg, var(--boxel-dark));
        }
        .cl dd {
          margin: 0;
          font-family: var(--font-mono, ui-monospace, monospace);
          font-variant-numeric: tabular-nums;
          font-size: var(--t-sm);
          font-weight: 700;
        }
        .arith {
          margin: 0;
          font-size: var(--t-micro);
          color: var(--ful-muted-fg, var(--boxel-500));
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
          grid-template-columns: 9rem minmax(0, 1fr);
          gap: var(--boxel-sp-xs);
        }
        .kv dt {
          font-size: var(--t-micro);
          color: var(--ful-muted-fg, var(--boxel-500));
        }
        .kv dd {
          margin: 0;
          font-size: var(--t-sm);
          font-variant-numeric: tabular-nums;
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
      
        .else-total {
          margin: 0 0 var(--boxel-sp-xs);
          font-size: var(--t-body);
        }
        .else-total strong {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: var(--t-lg);
          font-weight: 800;
        }
        .else-rows {
          margin: 0;
          padding: 0;
          list-style: none;
        }
        .else-row {
          display: grid;
          grid-template-columns: 7rem minmax(0, 1fr) 4rem 4.5rem;
          align-items: baseline;
          gap: var(--boxel-sp-xs);
          padding: 6px 0;
          border-top: 1px solid var(--ful-rule, var(--boxel-border-color));
          font-size: var(--t-sm);
        }
        .el-wh,
        .el-bin,
        .el-qty {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-variant-numeric: tabular-nums;
        }
        .el-bin {
          color: var(--ful-muted-fg, var(--boxel-500));
        }
        .el-qty {
          text-align: right;
          font-weight: 700;
        }
        .el-state {
          text-align: right;
          font-size: var(--t-micro);
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }
        .els-out .el-state,
        .els-out .el-qty {
          color: var(--ful-danger);
        }
        .els-low .el-state,
        .els-low .el-qty {
          color: var(--ful-warn);
        }
      
        .else-row-li {
          list-style: none;
        }
        /* The row became a button: strip the chrome, keep the grid, and give it a
           real affordance. 160ms sits inside the 150-300ms micro-interaction
           window; `prefers-reduced-motion` removes it rather than shortening it. */
        button.else-row {
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
        button.else-row:hover {
          background: color-mix(in oklch, var(--foreground) 5%, transparent);
        }
        button.else-row:focus-visible {
          outline: 2px solid var(--ring, var(--boxel-highlight));
          outline-offset: -2px;
        }
        @media (prefers-reduced-motion: reduce) {
          button.else-row {
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
            {{! Rule 2's first-choice anchor when the linked product has a photo;
                the drawn glyph stays as the no-photo state. Reads from the
                denormalized URL because a prerendered fitted has no link. }}
            {{#if @model.productImageUrl}}
              <img class='thumb' src={{@model.productImageUrl}} alt='' loading='lazy' />
            {{else}}
              <BoxesIcon class='glyph' />
            {{/if}}
            <span class='sku'>{{@model.sku}}</span>
          </div>
          <h3 class='headline'>{{@model.productName}}</h3>
        </div>
        <div class='r-body'>
          <div class='big'>
            <span class='qty'>{{@model.quantityAvailable}}</span>
            <span class='qty-label'>available</span>
          </div>
          {{#if @model.productImageUrl}}
            {{! A tall tile had ~250px of empty body under the gauge while the
                photo sat in the eyebrow at glyph size, reading as a favicon.
                Above 180px the photo becomes the anchor it is meant to be and
                fills the row that was blank. }}
            <img class='photo' src={{@model.productImageUrl}} alt='' loading='lazy' />
          {{/if}}
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
          --meta-size: max(11px, calc(var(--type-base) / var(--type-ratio)));
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
        .photo {
          display: none;
          width: 100%;
          height: 100%;
          min-height: 0;
          object-fit: cover;
          border-radius: 4px;
          background: color-mix(in oklch, var(--card-foreground) 8%, transparent);
        }
        @container fitted-card (height > 180px) {
          .r-body {
            display: grid;
            grid-template-rows: auto auto minmax(0, 1fr);
            gap: 5px;
          }
          /* Explicit rows, not DOM order: the gauge is conditional, so with
             positional placement a tile without one pushed the photo up a row
             and a tile with one drew it under the photo. */
          .big {
            grid-row: 1;
          }
          .gauge {
            grid-row: 2;
          }
          .photo {
            grid-row: 3;
            display: block;
          }
          /* the eyebrow copy goes back to the glyph — one photo per tile */
          .thumb {
            display: none;
          }
        }
        .thumb {
          flex: 0 0 auto;
          width: var(--glyph-size);
          height: var(--glyph-size);
          object-fit: cover;
          border-radius: 3px;
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

// Percentages come straight from `stockComposition`, so they are already a
// consistent scale; these only turn them into a length and a position.
function segStyle(pct: number | undefined) {
  return htmlSafe(`flex-basis: ${Math.max(0, Math.min(100, pct ?? 0))}%`);
}

function tickStyle(pct: number | undefined) {
  return htmlSafe(`left: ${Math.max(0, Math.min(100, pct ?? 0))}%`);
}

function gaugeStyle(pct: number | undefined, hue: string | undefined) {
  return htmlSafe(
    `width: ${Math.min(100, Math.max(0, pct ?? 0))}%; --stock-hue: ${
      hue ?? 'var(--muted-foreground)'
    }`,
  );
}

export default InventoryStock;
