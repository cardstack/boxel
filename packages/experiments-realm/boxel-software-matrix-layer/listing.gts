import {
  CardDef,
  field,
  contains,
  linksTo,
  StringField,
  Component,
  realmURL,
  getComponent,
} from '@cardstack/base/card-api';
import DateField from '@cardstack/base/date';
import BooleanField from '@cardstack/base/boolean';
import MarkdownField from '@cardstack/base/markdown';
import AmountWithCurrency from '@cardstack/base/amount-with-currency';
import { statusField } from './status-field';
import MultiImageSourceField from '@cardstack/catalog/fields/multi-image-source/multi-image-source';
import { tracked } from '@glimmer/tracking';
import {
  Accordion,
  FieldContainer,
  FittedCard,
  LoadingIndicator,
  Pill,
} from '@cardstack/boxel-ui/components';
import { identifyCard } from '@cardstack/runtime-common';
import { CollectionItem } from './collection-item';
import { CollectibleProduct } from './collectible-product';
import { SellerProfile } from './seller-profile';
// CYCLE-SAFE IMPORT. offer.gts imports THIS module, so this is circular by
// construction. It is legal only because `identifyCard(Offer)` is read inside
// the isolated view's reverse-query getter and never at module-evaluation
// time. Do not lift it into a top-level constant.
import { Offer } from './sole-vault-offer';
import TagIcon from '@cardstack/boxel-icons/tag';
import HandshakeIcon from '@cardstack/boxel-icons/handshake';
import ArchiveIcon from '@cardstack/boxel-icons/archive';
import TruckIcon from '@cardstack/boxel-icons/truck';
import NotebookIcon from '@cardstack/boxel-icons/notebook';
import AlertTriangleIcon from '@cardstack/boxel-icons/alert-triangle';
import { formatMoney } from './money-format';

// Listing — one seller offering one owned item for sale.
//
// The matrix has no neutral Listing concept: `l05-5-cm-property-listing` is
// property-specific, so this is a new element rather than a consume.
//
// EVERY FIELD A TILE NEEDS IS AN ATTRIBUTE. A marketplace's whole UI is grids of
// listings, grids are prerendered fitted, and prerendered fitted cannot resolve
// linksTo — so `productTitle`, `variantLabel` and `conditionCode` are computed
// (resolved at index time, stored in the search doc) rather than read through
// `collectionItem.*` in a template. Without that every tile in the marketplace
// renders blank, which is the single most expensive version of this mistake.

export type ListingStatus = 'active' | 'sold' | 'cancelled' | 'expired';

// CONSUMED, not rebuilt. This was originally a bare `enumField` here — a
// free-text dropdown that would happily move a listing from `sold` back to
// `active`, or `cancelled` straight to `sold`. `statusField` is the matrix's
// Status block (pulled into this realm) and it carries the part that matters:
// the transition graph, so the field can answer "may I?" rather than only
// "what are the choices?". It also carries `hue` as data and renders through
// StatePill, which is the self-diluting chip pattern — so status colour stops
// being a class list in each consumer's CSS.
//
// `nextStatuses(ListingStatusField, current)` is what an action menu should
// offer; `canTransition(...)` is what a command should check before writing.
export const ListingStatusField = statusField({
  displayName: 'Listing Status',
  options: [
    {
      value: 'active',
      label: 'Active',
      hue: 'green',
      meaning: 'Visible to buyers and accepting offers.',
    },
    {
      value: 'sold',
      label: 'Sold',
      hue: 'teal',
      terminal: true,
      holds: true,
      meaning: 'A buyer committed. The item is spoken for.',
    },
    {
      value: 'cancelled',
      label: 'Cancelled',
      hue: 'slate',
      terminal: true,
      holds: true,
      meaning: 'The seller pulled it. Nothing is owed either way.',
    },
    {
      value: 'expired',
      label: 'Expired',
      hue: 'amber',
      terminal: true,
      holds: true,
      meaning: 'Ran past its own expiry date without selling.',
    },
  ],
  // A sale is not reversible by editing a dropdown — unwinding one is a refund,
  // which is a command with money in it, not a status change. So `sold` leads
  // nowhere here. `cancelled` and `expired` may be relisted.
  transitions: {
    active: ['sold', 'cancelled', 'expired'],
    cancelled: ['active'],
    expired: ['active'],
    sold: [],
  },
});

export class Listing extends CardDef {
  static displayName = 'Listing';
  static icon = TagIcon;

  // The specific owned copy being sold.
  @field collectionItem = linksTo(() => CollectionItem, { searchable: true });

  // Denormalized link to the catalogue row, so "all listings for this SKU" is one
  // query rather than a walk through collectionItem.
  @field product = linksTo(() => CollectibleProduct, { searchable: true });

  @field price = contains(AmountWithCurrency);
  @field shippingPrice = contains(AmountWithCurrency);

  @field listingStatus = contains(ListingStatusField);
  @field shipsFrom = contains(StringField);
  @field photos = contains(MultiImageSourceField);
  @field listingNotes = contains(MarkdownField);

  // Consumed rather than left as `linksTo(CardDef)`: SellerProfile is the
  // app's own marketplace-seller building block (extends the matrix's Person
  // block, `person-base.gts`, pulled and kept unmodified). Narrowing it is
  // what gives a listing row the seller's name, avatar and rating without
  // this card modelling a person.
  @field seller = linksTo(() => SellerProfile, { searchable: true });

  // Lifecycle as event facts, same rule as CollectionItem: store the date the
  // thing happened, derive any boolean from it.
  @field listedAt = contains(DateField);
  @field soldAt = contains(DateField);
  @field expiresAt = contains(DateField);

  // --- denormalized for prerendered fitted; see the header note ---
  @field productTitle = contains(StringField, {
    computeVia: function (this: Listing) {
      return (
        this.product?.displayTitle ??
        this.collectionItem?.itemTitle ??
        this.cardInfo?.name ??
        ''
      );
    },
  });

  @field variantLabel = contains(StringField, {
    computeVia: function (this: Listing) {
      return this.collectionItem?.variantLabel ?? '';
    },
  });

  @field conditionCode = contains(StringField, {
    computeVia: function (this: Listing) {
      return this.collectionItem?.condition?.code ?? '';
    },
  });

  // Boolean, not a string. `CollectionItem.verified` models the identical concept
  // as a BooleanField, and two cards disagreeing about the type of one concept is
  // how a consumer ends up rendering the literal text "verified" in a badge. Only
  // consumed via `{{#if}}`, and computed rather than stored, so this costs no
  // migration.
  @field verified = contains(BooleanField, {
    computeVia: function (this: Listing) {
      return Boolean(this.collectionItem?.verified);
    },
  });

  // ISOLATED — the listing's landing page. Object direction: the photo leads,
  // full-bleed, because a marketplace listing IS the thing being shown for
  // sale. Crossed with Instrument for the price: the plaque is a real gold
  // surface, not a hairline accent, because the asking price is the reason
  // anyone opened this card.
  //
  // Domain question: "what is being sold, for how much, and is anyone biting?"
  // The first two are the hero (photo + plaque price + status); the third is a
  // REVERSE QUERY over Offers — an offer links to its listing, not the other
  // way round, so the negotiation activity on this listing is a query, not a
  // field. Same shape and same cycle caveat as Order's shipments/payments.
  static isolated = class Isolated extends Component<typeof Listing> {
    get realms() {
      let realmUrl = this.args.model?.[realmURL];
      return realmUrl ? [realmUrl.href] : [];
    }

    // `identifyCard(Offer)` only ever runs inside this getter — never at
    // module-evaluation time — which is what makes the circular import legal.
    private offersQuery = this.args.context?.getCards(
      this,
      () => {
        let ref = identifyCard(Offer);
        let id = this.args.model?.id;
        return ref && id
          ? { filter: { on: ref, every: [{ eq: { 'listing.id': id } }] } }
          : undefined;
      },
      () => this.realms,
      { isLive: true },
    );

    get offers() {
      return (this.offersQuery?.instances ?? []).filter(Boolean);
    }

    get offersLoading() {
      return Boolean(this.offersQuery) && !this.offersQuery?.instances;
    }

    get offersError() {
      return (this.offersQuery as any)?.error;
    }

    get price() {
      return formatMoney(this.args.model?.price);
    }

    get shipping() {
      return formatMoney(this.args.model?.shippingPrice);
    }

    <template>
      <article class='card'>
        <header class='hero'>
          {{#if @model.photos.primaryUrl}}
            <img
              class='hero-img'
              src={{@model.photos.primaryUrl}}
              alt={{@model.productTitle}}
            />
          {{else}}
            <div class='hero-img hero-img--empty'>
              <TagIcon width='40%' height='40%' aria-hidden='true' />
            </div>
          {{/if}}

          <div class='hero-body'>
            <div class='hero-head'>
              <h1 class='hero-title'>{{if
                  @model.productTitle
                  @model.productTitle
                  'Unlinked item'
                }}</h1>

              <p class='parties'>
                {{#if @model.variantLabel}}
                  <span class='party'>{{@model.variantLabel}}</span>
                {{/if}}
                {{#if @model.seller}}
                  <span class='party'>sold by
                    <strong>{{@model.seller.title}}</strong></span>
                {{/if}}
                {{#if @model.conditionCode}}
                  <span class='party'>condition
                    <strong>{{@model.conditionCode}}</strong></span>
                {{/if}}
              </p>
            </div>

            {{! THE PLAQUE — real gold surface area, not a hairline accent.
                The asking price is the dominant figure on the whole card; the
                status and verified badge qualify it, they do not compete. }}
            <div class='plaque'>
              <p class='plaque-price'>{{if this.price this.price '—'}}</p>
              <div class='plaque-meta'>
                {{#if @model.listingStatus}}
                  <@fields.listingStatus @format='embedded' />
                {{/if}}
                {{#if @model.verified}}
                  <Pill class='l-verified' @size='extra-small'>Verified</Pill>
                {{/if}}
              </div>
            </div>
          </div>
        </header>

        {{! Offers — the "is anyone biting?" section. Full width: on an active
            listing this is what the seller opens the card to check. }}
        <section class='sec'>
          <h2><HandshakeIcon class='sec-icon' aria-hidden='true' />Offers<span
              class='count'
            >{{this.offers.length}}</span></h2>

          {{#if this.offersError}}
            <p class='err'>
              <AlertTriangleIcon
                width='18'
                height='18'
                aria-hidden='true'
              />Could not load offers.
            </p>
          {{else if this.offersLoading}}
            <p class='wait'><LoadingIndicator />Looking for offers…</p>
          {{else if this.offers.length}}
            <ul class='links'>
              {{! getCards instances have no `.component` — getComponent(card)
                  is the API; the property renders an empty row silently. }}
              {{#each this.offers as |o|}}
                <li>{{#let (getComponent o) as |OfferCard|}}
                    <OfferCard @format='embedded' />
                  {{/let}}</li>
              {{/each}}
            </ul>
          {{else}}
            <p class='empty'>
              <HandshakeIcon width='18' height='18' aria-hidden='true' />No
              offers yet. Buyers can offer below asking; each counter is its own
              card linked back to the one it answers.
            </p>
          {{/if}}
        </section>

        <div class='cols'>
          {{! Shape: linked cards — the provenance chain behind this listing. }}
          <section class='sec'>
            <h2><ArchiveIcon
                class='sec-icon'
                aria-hidden='true'
              />Item &amp; seller</h2>
            <ul class='links'>
              {{#if @model.collectionItem}}
                <li><@fields.collectionItem @format='embedded' /></li>
              {{else}}
                <li class='empty-li'>
                  <p class='empty'>
                    <ArchiveIcon width='18' height='18' aria-hidden='true' />No
                    collection item linked — condition and authentication read
                    through it.
                  </p>
                </li>
              {{/if}}
              {{#if @model.product}}
                <li><@fields.product @format='embedded' /></li>
              {{/if}}
              {{#if @model.seller}}
                <li><@fields.seller @format='embedded' /></li>
              {{/if}}
            </ul>
          </section>

          {{! Shape: dl — fulfilment terms and the sale window. }}
          <section class='sec'>
            <h2><TruckIcon
                class='sec-icon'
                aria-hidden='true'
              />Fulfilment &amp; window</h2>
            <dl class='facts'>
              <div class='f-row'>
                <dt>Shipping</dt>
                <dd>{{if this.shipping this.shipping '—'}}</dd>
              </div>
              <div class='f-row'>
                <dt>Ships from</dt>
                <dd>{{if @model.shipsFrom @model.shipsFrom '—'}}</dd>
              </div>
              <div class='f-row'>
                <dt>Listed</dt>
                <dd>{{#if @model.listedAt}}<@fields.listedAt
                      @format='atom'
                    />{{else}}—{{/if}}</dd>
              </div>
              <div class='f-row'>
                <dt>Expires</dt>
                <dd>{{#if @model.expiresAt}}<@fields.expiresAt
                      @format='atom'
                    />{{else}}—{{/if}}</dd>
              </div>
              {{#if @model.soldAt}}
                <div class='f-row f-row--sold'>
                  <dt>Sold</dt>
                  <dd><@fields.soldAt @format='atom' /></dd>
                </div>
              {{/if}}
            </dl>
          </section>
        </div>

        {{#if @model.listingNotes}}
          {{! Shape: prose — the seller's own words, distinct from every dl. }}
          <section class='sec'>
            <h2><NotebookIcon
                class='sec-icon'
                aria-hidden='true'
              />Seller's notes</h2>
            <div class='notes'>
              <@fields.listingNotes />
            </div>
          </section>
        {{/if}}
      </article>

      <style scoped>

        /* Rule 1: an isolated card gets NO host container — declare our own,
           NAMED, or every @container rule below is inert. `inline-size`, not
           `size`: this column scrolls. Literal, committed tokens — never
           theme-var fallbacks. */
        .card {
          container-type: inline-size;
          container-name: card;
          width: 100%;
          height: 100%;
          overflow-y: auto;
          box-sizing: border-box;

          --ink-950: var(--primary-foreground, oklch(0.216 0.006 56.04));
          --background: oklch(0.985 0.001 106.42);
          --ink-900: var(--background);
          --card: oklch(1 0 0);
          --card-foreground: oklch(0.147 0.004 49.25);
          --ink-800: var(--card);
          --ink-700: color-mix(in oklch, var(--card, oklch(0.216 0.006 56.04)) 80%, var(--foreground, white) 20%);
          --foreground: oklch(0.147 0.004 49.25);
          --paper: var(--foreground);
          --muted: oklch(0.97 0.001 106.42);
          --secondary: oklch(0.923 0.003 48.72);
          --secondary-foreground: oklch(0.216 0.006 56.04);
          --input: oklch(1 0 0);
          --popover: oklch(1 0 0);
          --popover-foreground: oklch(0.147 0.004 49.25);
          --muted-foreground: oklch(0.553 0.013 58.07);
          --smoke: var(--muted-foreground);
          --border: oklch(0.869 0.005 56.37);
          --hairline: color-mix(in oklch, var(--border) 55%, transparent);
          --primary: oklch(0.666 0.179 58.32);
          --primary-foreground: oklch(0.216 0.006 56.04);
          --destructive: oklch(0.577 0.245 27.32);
          --destructive-foreground: oklch(0.985 0.001 106.42);
          --ring: var(--primary);
          --gold: var(--primary);
          /* Text-grade gold for sub-18px strings: bare --gold on white sits under
             AA. oklab, not oklch (hue-rotates against achromatic endpoints). */
          --gold-ink: color-mix(in oklab, var(--gold) 72%, var(--foreground));
          --accent: oklch(0.769 0.188 70.08);
          --accent-foreground: oklch(0.216 0.006 56.04);
          --gold-bright: var(--accent);
          --shadow-1: 0 1px 2px oklch(0.05 0 0 / 0.08);
          --shadow-2: 0 8px 24px -8px oklch(0.05 0 0 / 0.14);
          --shadow-3: 0 20px 48px -16px oklch(0.05 0 0 / 0.18);

          --font-display: var(--font-serif, 'Playfair Display', Georgia, serif);
                    --font-mono: ui-monospace, 'SFMono-Regular', Menlo, Consolas,
            monospace;

          background: var(--ink-900);
          color: var(--paper);
          font-family: var(--font-sans, 'Inter', system-ui, -apple-system, sans-serif);
          padding: 1.75rem;
          display: flex;
          flex-direction: column;
          gap: 1.5rem;

          scrollbar-color: var(--gold) var(--ink-800);
        }
        .card::-webkit-scrollbar {
          width: 10px;
          height: 10px;
        }
        .card::-webkit-scrollbar-track {
          background: var(--ink-800);
        }
        .card::-webkit-scrollbar-thumb {
          background: var(--gold);
          border-radius: 999px;
          border: 2px solid var(--ink-800);
        }
        .card ::selection {
          background: var(--gold);
          color: var(--ink-950);
        }
        .card *:focus-visible {
          outline: 2px solid var(--gold);
          outline-offset: 2px;
        }

        /* ---------- hero: full-bleed photo, Object direction ---------- */
        .hero {
          display: grid;
          grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
          gap: 1.75rem;
          align-items: stretch;
        }
        .hero-img {
          width: 100%;
          height: 100%;
          min-height: 320px;
          object-fit: cover;
          border-radius: 16px;
          background: var(--ink-800);
          box-shadow: var(--shadow-2);
        }
        .hero-img--empty {
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--smoke);
        }
        .hero-body {
          min-width: 0;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          gap: 1.5rem;
        }
        .hero-head {
          display: flex;
          flex-direction: column;
          gap: 0.6rem;
        }
        .hero-title {
          margin: 0;
          font-family: var(--font-display);
          font-size: clamp(1.75rem, 1.2rem + 2cqi, 2.75rem);
          line-height: 1.08;
          font-weight: 900;
          letter-spacing: -0.015em;
        }
        .parties {
          margin: 0;
          display: flex;
          flex-wrap: wrap;
          gap: 0.4rem 1rem;
          font-size: 0.875rem;
          color: var(--smoke);
        }
        .party strong {
          color: var(--paper);
          font-weight: 600;
        }

        /* THE PLAQUE — light translation of the family signature: gold
           top-rule over the serif ink price, matching the shell's
           ledger-hero. The dark-era gold slab reads as an orange block on
           white. */
        .plaque {
          display: grid;
          align-content: center;
          gap: 0.5rem;
          background: var(--ink-800);
          border: 1px solid var(--hairline);
          border-top: 3px solid var(--gold);
          border-radius: 6px;
          padding: 1.25rem 1.5rem;
          box-shadow: var(--shadow-1);
        }
        .plaque-price {
          margin: 0;
          font-family: var(--font-mono), var(--font-display);
          color: var(--paper);
          font-size: clamp(2.25rem, 1.6rem + 2.5cqi, 3.25rem);
          line-height: 1;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          letter-spacing: -0.01em;
        }
        .plaque-meta {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 0.6rem;
        }
        .l-verified {
          --pill-background-color: color-mix(
            in oklch,
            var(--ink-950) 16%,
            transparent
          );
          --pill-font-color: var(--ink-950);
          --pill-border-color: transparent;
          font-weight: 700;
        }

        /* ---------- one panel primitive ---------- */
        .sec {
          background: var(--ink-800);
          padding: 1.1rem 1.4rem 1.4rem;
          border-radius: 14px;
          border: 1px solid var(--hairline);
          box-shadow: var(--shadow-1);
          min-width: 0;
        }
        .sec h2 {
          margin: 0 0 0.75rem;
          display: flex;
          align-items: center;
          gap: 0.5em;
          font-size: 0.75rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.09em;
          color: var(--smoke);
        }
        .sec-icon {
          width: max(14px, 1em);
          height: max(14px, 1em);
          flex: none;
          color: var(--gold-ink, var(--gold));
        }
        .count {
          margin-left: auto;
          font-variant-numeric: tabular-nums;
          color: var(--paper);
        }

        .cols {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          gap: 1.5rem;
        }

        .links {
          list-style: none;
          margin: 0;
          padding: 0;
          display: grid;
          gap: 0.6rem;
        }
        .empty-li {
          display: contents;
        }

        .facts {
          display: grid;
          gap: 0.6rem;
          margin: 0;
        }
        .f-row {
          display: flex;
          flex-wrap: wrap;
          align-items: baseline;
          justify-content: space-between;
          gap: 0.6rem;
          font-size: 0.875rem;
        }
        .f-row dt {
          font-size: 0.6875rem;
          text-transform: uppercase;
          letter-spacing: 0.07em;
          color: var(--smoke);
        }
        .f-row dd {
          margin: 0;
          font-weight: 600;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }
        /* The sale's terminal fact steps above the routine rows. */
        .f-row--sold {
          border-top: 1px solid var(--hairline);
          padding-top: 0.6rem;
        }
        .f-row--sold dd {
          color: var(--gold-ink, var(--gold));
        }

        .notes {
          font-size: 0.9375rem;
          line-height: 1.6;
        }

        .empty,
        .wait,
        .err {
          margin: 0;
          display: flex;
          align-items: center;
          gap: 0.5em;
          font-size: 0.8125rem;
          line-height: 1.45;
          color: var(--smoke);
        }
        .err {
          color: var(--destructive, oklch(0.7 0.19 25));
        }

        /* Rule 1: fires because .card declares the container above. */
        @container card (width < 700px) {
          .hero {
            grid-template-columns: 1fr;
          }
          .hero-img {
            min-height: 240px;
          }
          .cols {
            grid-template-columns: 1fr;
          }
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof Listing> {
    get price() {
      return formatMoney(this.args.model?.price);
    }

    <template>
      <span class='l-atom'>
        <span class='l-price'>{{this.price}}</span>
        {{#if @model.conditionCode}}<span
            class='l-cond'
          >{{@model.conditionCode}}</span>{{/if}}
      </span>
      <style scoped>
        .l-atom {
          display: inline-flex;
          align-items: baseline;
          gap: 0.35em;
          font-family: var(--font-sans, 'Inter', system-ui, -apple-system, sans-serif);
        }
        .l-price {
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
          color: var(--accent, oklch(0.828 0.189 84.43));
        }
        .l-cond {
          font-size: 0.8125em;
          color: var(--muted-foreground, oklch(0.709 0.01 56.26));
        }
      </style>
    </template>
  };

  // Row-shaped: this is the "listings for size 10.5, sorted by price" row from
  // the spec's product page. Trailing slots are constant-width with an em-dash
  // when empty so a consumer's list column-aligns.
  static embedded = class Embedded extends Component<typeof Listing> {
    get price() {
      return formatMoney(this.args.model?.price);
    }

    get shipping() {
      return formatMoney(this.args.model?.shippingPrice);
    }

    <template>
      <div class='l-row'>
        <span class='l-price'>{{if this.price this.price '—'}}</span>
        <span class='l-cond'>
          {{if @model.conditionCode @model.conditionCode '—'}}
          {{#if @model.verified}}<span
              class='l-check'
              title='Authenticated'
            >✓</span>{{/if}}
        </span>
        <span class='l-from'>{{if @model.shipsFrom @model.shipsFrom '—'}}</span>
        <span class='l-ship'>{{if this.shipping this.shipping '—'}}</span>
      </div>
      <style scoped>
        .l-row {
          display: grid;
          grid-template-columns: 6rem 5rem minmax(0, 1fr) 5.5rem;
          gap: 0.75rem;
          align-items: baseline;
          padding: 0.5rem 0.75rem;
          font-size: 0.875rem;
          font-family: var(--font-sans, 'Inter', system-ui, -apple-system, sans-serif);
          color: var(--foreground, oklch(0.985 0.001 106.42));
        }
        .l-price {
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
          color: var(--accent, oklch(0.828 0.189 84.43));
        }
        .l-cond {
          white-space: nowrap;
        }
        .l-check {
          /* Same design-token green as the family's HUE.green — no literal. */
          color: var(--boxel-success);
          font-weight: 700;
        }
        .l-from {
          color: var(--muted-foreground, oklch(0.709 0.01 56.26));
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .l-ship {
          text-align: right;
          color: var(--muted-foreground, oklch(0.709 0.01 56.26));
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }
      </style>
    </template>
  };

  // EDIT — grouped, not the schema in declaration order (edit-card Rule 0).
  // What's listed and for how much sits up top; dates, fulfilment, photos and
  // notes are collapsible. `productTitle`, `variantLabel`, `conditionCode` and
  // `verified` are computed and deliberately absent.
  static edit = class Edit extends Component<typeof Listing> {
    @tracked datesOpen = true;
    @tracked fulfilmentOpen = false;
    @tracked photosOpen = false;
    @tracked notesOpen = false;

    toggleDates = () => (this.datesOpen = !this.datesOpen);
    toggleFulfilment = () => (this.fulfilmentOpen = !this.fulfilmentOpen);
    togglePhotos = () => (this.photosOpen = !this.photosOpen);
    toggleNotes = () => (this.notesOpen = !this.notesOpen);

    <template>
      <div class='l-edit'>
        <header class='le-head'>
          <div class='le-links'>
            <FieldContainer
              @label='Collection item'
              @tag='label'
              @vertical={{true}}
            >
              <@fields.collectionItem />
              <p class='le-help'>The owned copy being sold — condition and
                authentication read through it.</p>
            </FieldContainer>
            <FieldContainer @label='Product' @tag='label' @vertical={{true}}>
              <@fields.product />
            </FieldContainer>
          </div>
          <div class='le-pricing'>
            <FieldContainer @label='Price' @tag='label' @vertical={{true}}>
              <@fields.price />
            </FieldContainer>
            <FieldContainer @label='Shipping' @tag='label' @vertical={{true}}>
              <@fields.shippingPrice />
            </FieldContainer>
            <FieldContainer @label='Status' @tag='label' @vertical={{true}}>
              <@fields.listingStatus />
            </FieldContainer>
          </div>
        </header>

        <Accordion class='le-sections' @displayContainer={{false}} as |A|>
          <A.Item
            @id='dates'
            @isOpen={{this.datesOpen}}
            @onClick={{this.toggleDates}}
          >
            <:title>Dates</:title>
            <:content>
              <div class='le-body le-grid-3'>
                <FieldContainer
                  @label='Listed at'
                  @tag='label'
                  @vertical={{true}}
                >
                  <@fields.listedAt />
                </FieldContainer>
                <FieldContainer
                  @label='Sold at'
                  @tag='label'
                  @vertical={{true}}
                >
                  <@fields.soldAt />
                </FieldContainer>
                <FieldContainer
                  @label='Expires at'
                  @tag='label'
                  @vertical={{true}}
                >
                  <@fields.expiresAt />
                </FieldContainer>
              </div>
            </:content>
          </A.Item>

          <A.Item
            @id='fulfilment'
            @isOpen={{this.fulfilmentOpen}}
            @onClick={{this.toggleFulfilment}}
          >
            <:title>Fulfilment</:title>
            <:content>
              <div class='le-body le-grid-2'>
                <FieldContainer
                  @label='Ships from'
                  @tag='label'
                  @vertical={{true}}
                >
                  <@fields.shipsFrom />
                </FieldContainer>
                <FieldContainer @label='Seller' @tag='label' @vertical={{true}}>
                  <@fields.seller />
                </FieldContainer>
              </div>
            </:content>
          </A.Item>

          <A.Item
            @id='photos'
            @isOpen={{this.photosOpen}}
            @onClick={{this.togglePhotos}}
          >
            <:title>Photos</:title>
            <:content>
              <div class='le-body'>
                <@fields.photos />
              </div>
            </:content>
          </A.Item>

          <A.Item
            @id='notes'
            @isOpen={{this.notesOpen}}
            @onClick={{this.toggleNotes}}
          >
            <:title>Listing notes</:title>
            <:content>
              <div class='le-body'>
                <@fields.listingNotes />
              </div>
            </:content>
          </A.Item>
        </Accordion>
      </div>

      <style scoped>

        /* edit-card Rule 1: the edit format has no host-provided container —
           declare our own, named. Literal committed tokens, same as isolated. */
        .l-edit {
          container-type: inline-size;
          container-name: l-edit;

          --background: oklch(0.985 0.001 106.42);

          --ink-900: var(--background);
          --card: oklch(1 0 0);
          --card-foreground: oklch(0.147 0.004 49.25);
          --accent: oklch(0.769 0.188 70.08);
          --accent-foreground: oklch(0.216 0.006 56.04);
          --ink-800: var(--card);
          --foreground: oklch(0.147 0.004 49.25);
          --paper: var(--foreground);
          --muted: oklch(0.97 0.001 106.42);
          --secondary: oklch(0.923 0.003 48.72);
          --secondary-foreground: oklch(0.216 0.006 56.04);
          --input: oklch(1 0 0);
          --popover: oklch(1 0 0);
          --popover-foreground: oklch(0.147 0.004 49.25);
          --muted-foreground: oklch(0.553 0.013 58.07);
          --smoke: var(--muted-foreground);
          --border: oklch(0.869 0.005 56.37);
          --hairline: color-mix(in oklch, var(--border) 55%, transparent);
          --primary: oklch(0.666 0.179 58.32);
          --primary-foreground: oklch(0.216 0.006 56.04);
          --destructive: oklch(0.577 0.245 27.32);
          --destructive-foreground: oklch(0.985 0.001 106.42);
          --ring: var(--primary);
          --gold: var(--primary);
          /* Text-grade gold for sub-18px strings: bare --gold on white sits under
             AA. oklab, not oklch (hue-rotates against achromatic endpoints). */
          --gold-ink: color-mix(in oklab, var(--gold) 72%, var(--foreground));

          background: var(--ink-900);
          color: var(--paper);
          font-family: var(--font-sans, 'Inter', system-ui, -apple-system, sans-serif);
          height: 100%;
          overflow-y: auto;
          padding: 1.25rem;
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
          box-sizing: border-box;

          scrollbar-color: var(--gold) var(--ink-800);
        }
        .l-edit::-webkit-scrollbar {
          width: 10px;
          height: 10px;
        }
        .l-edit::-webkit-scrollbar-track {
          background: var(--ink-800);
        }
        .l-edit::-webkit-scrollbar-thumb {
          background: var(--gold);
          border-radius: 999px;
          border: 2px solid var(--ink-800);
        }
        .l-edit ::selection {
          background: var(--gold);
          color: var(--ink-900);
        }
        .l-edit *:focus-visible {
          outline: 2px solid var(--gold);
          outline-offset: 2px;
        }
        .le-head {
          display: flex;
          flex-direction: column;
          gap: 0.85rem;
          border-bottom: 1px solid var(--hairline);
          padding-bottom: 1.1rem;
        }
        .le-links {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 0.85rem;
        }
        .le-pricing {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 0.85rem;
        }
        .le-body {
          padding: 0.6rem 0.35rem;
        }
        .le-grid-3 {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 0.85rem;
        }
        .le-grid-2 {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 0.85rem;
        }
        .le-help {
          margin: 0.2rem 0 0;
          font-size: 0.75rem;
          line-height: 1.4;
          color: var(--smoke);
        }
        .l-edit :deep(.boxel-label) {
          text-transform: uppercase;
          letter-spacing: 0.08em;
          font-size: 0.75rem;
          font-weight: 500;
          color: var(--smoke);
        }

        @container l-edit (width < 640px) {
          .le-links,
          .le-pricing,
          .le-grid-3,
          .le-grid-2 {
            grid-template-columns: 1fr;
          }
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof Listing> {
    get price() {
      return formatMoney(this.args.model?.price);
    }

    <template>
      <FittedCard
        class='l-fit'
        @imageUrl={{@model.photos.primaryUrl}}
        @imageAlt={{@model.productTitle}}
        @titleTag='h3'
      >
        <:placeholder>
          <TagIcon
            width='max(18px, 34%)'
            height='max(18px, 34%)'
            aria-hidden='true'
          />
        </:placeholder>
        <:eyebrow>{{@model.variantLabel}}</:eyebrow>
        <:title>{{@model.productTitle}}</:title>
        <:badgeRight>
          {{#if @model.verified}}
            <Pill class='l-verified' @size='extra-small'>Verified</Pill>
          {{/if}}
        </:badgeRight>
        <:footer>
          {{#if this.price}}<span class='l-fprice'>{{this.price}}</span>{{/if}}
          {{#if @model.conditionCode}}<span
              class='l-fcond'
            >{{@model.conditionCode}}</span>{{/if}}
        </:footer>
      </FittedCard>

      <style scoped>
        /* NO container-type / container-name here — the host wrapper already
           declares `container-type: size; container-name: fitted-card`. */
        .l-fit {
          /* Literal committed tokens — no theme-var fallbacks. */
          --card: oklch(1 0 0);
          --card-foreground: oklch(0.147 0.004 49.25);
          --background: oklch(0.985 0.001 106.42);
          --border: oklch(0.869 0.005 56.37);
          --ink-800: var(--card);
          --ink-700: color-mix(in oklch, var(--card, oklch(0.216 0.006 56.04)) 80%, var(--foreground, white) 20%);
          --foreground: oklch(0.147 0.004 49.25);
          --paper: var(--foreground);
          --muted: oklch(0.97 0.001 106.42);
          --secondary: oklch(0.923 0.003 48.72);
          --secondary-foreground: oklch(0.216 0.006 56.04);
          --input: oklch(1 0 0);
          --popover: oklch(1 0 0);
          --popover-foreground: oklch(0.147 0.004 49.25);
          --muted-foreground: oklch(0.553 0.013 58.07);
          --smoke: var(--muted-foreground);
          --primary: oklch(0.666 0.179 58.32);
          --primary-foreground: oklch(0.216 0.006 56.04);
          --destructive: oklch(0.577 0.245 27.32);
          --destructive-foreground: oklch(0.985 0.001 106.42);
          --ring: var(--primary);
          --gold: var(--primary);
          /* Text-grade gold for sub-18px strings: bare --gold on white sits under
             AA. oklab, not oklch (hue-rotates against achromatic endpoints). */
          --gold-ink: color-mix(in oklab, var(--gold) 72%, var(--foreground));
          --accent: oklch(0.769 0.188 70.08);
          --accent-foreground: oklch(0.216 0.006 56.04);
          --gold-bright: var(--accent);
          background: var(--ink-800);
          color: var(--paper);
          font-family: var(--font-sans, 'Inter', system-ui, -apple-system, sans-serif);
          /* Miniature vault plaque: 2px gold edge as an inset shadow, never a
             border — the host draws the chrome. */
          box-shadow: inset 2px 0 0 0 var(--gold);

          --fc-image-width: 42cqh;
          --fc-image-min-width: 3.5rem;
          --fc-image-max-width: 11rem;
          --fc-image-background: var(--ink-700);
          --fc-image-fade-color: var(--ink-800);
          --fc-content-padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
          --fc-header-gap: 0.15em;
          --fc-eyebrow-font-size: max(9px, 0.62em);
          --fc-eyebrow-line-height: 1.25;
          --fc-title-font-size: max(13px, 1.05em);
          --fc-title-line-height: 1.2;
          --fc-title-line-clamp: 2;
          --fc-footer-font-size: max(11px, 0.78em);
          --fc-footer-gap: var(--boxel-sp-xs);
          --fc-footer-justify: space-between;
          --fc-footer-flex-wrap: nowrap;
          --fc-badge-offset: var(--boxel-sp-xxs);
        }
        .l-fit :deep(.fc-eyebrow) {
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--smoke);
          font-weight: 600;
        }
        .l-fit :deep(.fc-title) {
          font-family: 'Playfair Display', Georgia, serif;
          font-weight: 700;
          letter-spacing: -0.01em;
        }
        /* Diluted chip on the dark ground: 18% fill of its own hue, full-hue
           text — a solid green block would out-shout the gold. The hue is the
           same design-token green the family's StatePill hue map uses
           (utils/index.gts HUE.green), never a literal, so a token correction
           fixes every green in the app at once. */
        .l-verified {
          --pill-background-color: color-mix(
            in oklch,
            var(--boxel-success) 18%,
            transparent
          );
          --pill-font-color: var(--boxel-success);
          --pill-border-color: transparent;
          font-weight: 700;
        }
        /* The price is the reason a listing tile exists — it is the loudest thing
           in the footer and it is never truncated. Plaque value: serif + gold. */
        .l-fprice {
          font-family: 'Playfair Display', Georgia, serif;
          color: var(--gold-ink, var(--gold));
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }
        .l-fcond {
          color: var(--smoke);
          white-space: nowrap;
        }
        @container fitted-card (height <= 50px) {
          .l-fit {
            --fc-footer-display: none;
            --fc-badge-right-display: none;
            --fc-title-line-clamp: 1;
            --fc-content-padding: var(--boxel-sp-4xs) var(--boxel-sp-xxs);
          }
          .l-fit :deep(.fc-eyebrow) {
            display: none;
          }
        }
        /* Condition goes before price does — the price is the anchor fact. */
        @container fitted-card (width <= 200px) and (height <= 80px) {
          .l-fit .l-fcond {
            display: none;
          }
        }
        /* FittedCard's own Tile quantum (250-400 wide, 105-170 tall) hides
           the footer and badges by default — which deletes the PRICE and the
           Verified badge from a marketplace tile at exactly the size the
           market grid renders (measured 316x166 live). Reassert them; the
           doubled class (0,2,0) outranks the library's plain class rule. */
        @container fitted-card (1 < aspect-ratio) and (250px <= width < 400px) and (105px <= height < 170px) {
          .l-fit.l-fit {
            --fc-footer-display: flex;
            --fc-badge-right-display: flex;
          }
        }
      </style>
    </template>
  };
}

export default Listing;
