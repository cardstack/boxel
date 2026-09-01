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
import AmountWithCurrency from '@cardstack/base/amount-with-currency';
import { statusField, canTransition, nextStatuses } from './status-field';
import { Listing } from './listing';
import { SoleVaultPerson } from './sole-vault-person';
import HandshakeIcon from '@cardstack/boxel-icons/handshake';
import TagIcon from '@cardstack/boxel-icons/tag';
import CalendarIcon from '@cardstack/boxel-icons/calendar';
import MessageCircleIcon from '@cardstack/boxel-icons/message-circle';
import AlertTriangleIcon from '@cardstack/boxel-icons/alert-triangle';
import { tracked } from '@glimmer/tracking';
import {
  Accordion,
  FieldContainer,
  FittedCard,
  LoadingIndicator,
} from '@cardstack/boxel-ui/components';
import { identifyCard } from '@cardstack/runtime-common';
import { StatePill } from './components/state-pill';
import { formatMoney } from './money-format';

// Offer — a buyer proposing a price below asking, and the negotiation that
// follows. The spec's v1.1 "Offer System" (offer / counter / negotiate).
//
// ONE CARD PER OFFER, NOT ONE PER NEGOTIATION. A counter-offer is a NEW Offer
// linked back to the one it answers, rather than an edit to the original. Two
// reasons, and the first is the one that matters:
//
//   1. An offer is a commitment someone made at a moment. Overwriting `amount`
//      when the seller counters destroys the record of what the buyer actually
//      offered — which is exactly what both parties argue about later.
//   2. It makes the thread queryable. "Every offer on this listing" and "the
//      chain that produced this deal" are both plain queries over links, with no
//      array of embedded revisions to walk.
//
// `counterTo` is therefore the negotiation's spine: a null value means this is
// an opening offer, and following the chain backwards reconstructs the whole
// exchange in order.
//
// WHY THE AMOUNT IS NOT COMPARED TO ASKING IN A STORED FIELD: `listingPrice` is
// denormalized for fitted (below), but the DIFFERENCE is computed at render
// time. A stored discount goes stale the moment the seller re-prices, and a
// stale "18% below asking" is worse than no badge at all.

export type OfferStatus =
  | 'open'
  | 'countered'
  | 'accepted'
  | 'declined'
  | 'withdrawn'
  | 'expired';

export const OfferStatusField = statusField({
  displayName: 'Offer Status',
  icon: HandshakeIcon,
  options: [
    {
      value: 'open',
      label: 'Open',
      hue: 'blue',
      meaning: 'Awaiting the other side. The only state that needs an answer.',
    },
    {
      value: 'countered',
      label: 'Countered',
      hue: 'purple',
      terminal: true,
      holds: true,
      meaning:
        'Answered with a different price. This offer is closed; the counter is its own card.',
    },
    {
      value: 'accepted',
      label: 'Accepted',
      hue: 'green',
      terminal: true,
      holds: true,
      meaning: 'Agreed. An Order should now exist at this amount.',
    },
    {
      value: 'declined',
      label: 'Declined',
      hue: 'red',
      terminal: true,
      holds: true,
      meaning: 'Refused outright, with no counter.',
    },
    {
      value: 'withdrawn',
      label: 'Withdrawn',
      hue: 'slate',
      terminal: true,
      holds: true,
      meaning: 'Pulled by the party who made it, before an answer.',
    },
    {
      value: 'expired',
      label: 'Expired',
      hue: 'amber',
      terminal: true,
      holds: true,
      meaning: 'Ran past its own expiry without an answer.',
    },
  ],
  // `open` is the ONLY non-terminal state, and that is the whole design. Every
  // other value closes this card permanently:
  //   * A counter does not reopen this offer — it terminates it and starts a new
  //     one, so `countered` leads nowhere.
  //   * `accepted` leads nowhere because the next step is an Order, a different
  //     card with its own graph. Letting an accepted offer be un-accepted would
  //     orphan that order.
  //   * `declined` / `withdrawn` / `expired` are terminal for the same reason:
  //     re-offering is a new offer, and the history of the refused one is
  //     evidence.
  transitions: {
    open: ['countered', 'accepted', 'declined', 'withdrawn', 'expired'],
    countered: [],
    accepted: [],
    declined: [],
    withdrawn: [],
    expired: [],
  },
});

export function canOfferTransition(from?: string | null, to?: string | null) {
  return canTransition(OfferStatusField, from, to);
}

export function nextOfferStatuses(from?: string | null) {
  return nextStatuses(OfferStatusField, from);
}

// Shared gap math — offer vs. asking, computed at render time everywhere it
// appears (isolated hero, fitted footer, embedded row) so a re-price never
// leaves a stale percentage behind.
function computeGap(
  offerAmt?: number | null,
  askAmt?: number | null,
): { pct: number; label: string } | null {
  if (offerAmt == null || askAmt == null || askAmt === 0) {
    return null;
  }
  let pct = Math.round(((askAmt - offerAmt) / askAmt) * 100);
  if (pct === 0) {
    return { pct, label: 'at asking' };
  }
  return pct > 0
    ? { pct, label: `${pct}% below asking` }
    : { pct, label: `${Math.abs(pct)}% above asking` };
}

export class Offer extends CardDef {
  static displayName = 'Offer';
  static icon = HandshakeIcon;

  @field listing = linksTo(() => Listing, { searchable: true });

  // Who made THIS offer. On a counter this is the seller, which is why the
  // field is `offeredBy` rather than `buyer` — the roles swap down the chain.
  @field offeredBy = linksTo(() => SoleVaultPerson, { searchable: true });

  @field amount = contains(AmountWithCurrency);
  @field offerStatus = contains(OfferStatusField);

  // The negotiation spine. Null = an opening offer.
  @field counterTo = linksTo(() => Offer, { searchable: true });

  @field message = contains(StringField);

  @field offeredAt = contains(DateField);
  @field respondedAt = contains(DateField);
  @field expiresAt = contains(DateField);

  @field isOpen = contains(BooleanField, {
    computeVia: function (this: Offer) {
      return this.offerStatus === 'open';
    },
  });

  // A counter is identifiable without loading the chain — cheap, and a tile
  // needs it.
  @field isCounter = contains(BooleanField, {
    computeVia: function (this: Offer) {
      return this.counterTo != null;
    },
  });

  // --- denormalized for prerendered fitted (cannot resolve linksTo) ---
  @field productTitle = contains(StringField, {
    computeVia: function (this: Offer) {
      return this.listing?.productTitle ?? this.cardInfo?.name ?? '';
    },
  });

  @field offeredByName = contains(StringField, {
    computeVia: function (this: Offer) {
      return this.offeredBy?.title ?? '';
    },
  });

  // The asking price at index time, so a tile can show offer-vs-asking without
  // resolving the listing. The COMPARISON is computed at render time — see the
  // header note on why a stored discount goes stale.
  @field listingPrice = contains(AmountWithCurrency, {
    computeVia: function (this: Offer) {
      return this.listing?.price;
    },
  });

  // ISOLATED — the offer's landing page. Instrument direction: no image field
  // anywhere on an offer, so the plaque figure is the hero.
  //
  // Domain question: "how much, against what asking price, and is it still
  // live?" — all three are the hero (amount plaque + gap annotation + status).
  //
  // The negotiation THREAD is the section that makes this view worth opening:
  // `counterTo` looks backwards (a resolvable link, rendered directly) and the
  // counters that answer THIS offer look forwards — which is a REVERSE QUERY
  // over Offer itself ({ eq: { 'counterTo.id': id } }), no import cycle since
  // the query target is this very class.
  static isolated = class Isolated extends Component<typeof Offer> {
    get realms() {
      let realmUrl = this.args.model?.[realmURL];
      return realmUrl ? [realmUrl.href] : [];
    }

    private countersQuery = this.args.context?.getCards(
      this,
      () => {
        let ref = identifyCard(Offer);
        let id = this.args.model?.id;
        return ref && id
          ? { filter: { on: ref, every: [{ eq: { 'counterTo.id': id } }] } }
          : undefined;
      },
      () => this.realms,
      { isLive: true },
    );

    get counters() {
      return (this.countersQuery?.instances ?? []).filter(Boolean);
    }

    get countersLoading() {
      return Boolean(this.countersQuery) && !this.countersQuery?.instances;
    }

    get countersError() {
      return (this.countersQuery as any)?.error;
    }

    get amount() {
      return formatMoney(this.args.model?.amount);
    }

    get asking() {
      return formatMoney(this.args.model?.listingPrice);
    }

    // Derived at render time, never stored — a stored discount goes stale the
    // moment the seller re-prices. Same math as the fitted and embedded.
    get gap() {
      return computeGap(
        this.args.model?.amount?.amount,
        this.args.model?.listingPrice?.amount,
      );
    }

    get gapIsBelowAsking() {
      return Boolean(this.gap && this.gap.pct > 0);
    }

    <template>
      <article class='card'>
        <header class='hero'>
          <div class='hero-top'>
            <h1 class='hero-title'>{{if
                @model.productTitle
                @model.productTitle
                'Unlinked listing'
              }}</h1>
            {{#if @model.isCounter}}
              <span class='counter-flag'>Counter-offer</span>
            {{/if}}
          </div>

          <p class='parties'>
            {{#if @model.offeredByName}}
              <span class='party'>from
                <strong>{{@model.offeredByName}}</strong></span>
            {{/if}}
            {{#if this.asking}}
              <span class='party'>asking
                <strong class='mono'>{{this.asking}}</strong></span>
            {{/if}}
          </p>

          {{! THE PLAQUE — real gold surface area. The offered amount is the
              dominant element; the gap annotates it as a delta pill (a ratio
              is not an amount), the status qualifies it. }}
          <div class='plaque'>
            <div class='plaque-figure'>
              <p class='plaque-label'>Offered</p>
              <p class='plaque-amount'>{{if
                  this.amount
                  this.amount
                  '—'
                }}</p>
            </div>
            <div class='plaque-meta'>
              {{#if @model.offerStatus}}
                <@fields.offerStatus @format='embedded' />
              {{/if}}
              {{#if this.gap}}
                <span
                  class='delta
                    {{if this.gapIsBelowAsking "delta--down" "delta--up"}}'
                >{{this.gap.label}}</span>
              {{/if}}
            </div>
          </div>
        </header>

        {{! The negotiation thread — the section that makes this view worth
            opening. Given more visual weight than the utility panels below, so
            it does not read as a third identical icon+heading box. }}
        <section class='thread'>
          <h2 class='thread-h'><MessageCircleIcon
              class='thread-icon'
              aria-hidden='true'
            />Negotiation</h2>

          {{#if @model.message}}
            <blockquote class='msg'>
              “{{@model.message}}”
            </blockquote>
          {{/if}}

          {{#if @model.counterTo}}
            <p class='thread-k'>Answers</p>
            <ul class='links'>
              <li><@fields.counterTo @format='embedded' /></li>
            </ul>
          {{/if}}

          <p class='thread-k'>Countered by<span
              class='count'
            >{{this.counters.length}}</span></p>
          {{#if this.countersError}}
            <p class='err'>
              <AlertTriangleIcon
                width='18'
                height='18'
                aria-hidden='true'
              />Could not load counters.
            </p>
          {{else if this.countersLoading}}
            <p class='wait'><LoadingIndicator />Looking for counters…</p>
          {{else if this.counters.length}}
            <ul class='links'>
              {{! getCards instances have no `.component` — getComponent(card)
                  is the API; the property renders an empty row silently. }}
              {{#each this.counters as |c|}}
                <li>{{#let (getComponent c) as |CounterCard|}}
                    <CounterCard @format='embedded' />
                  {{/let}}</li>
              {{/each}}
            </ul>
          {{else}}
            <p class='empty'>
              <MessageCircleIcon
                width='18'
                height='18'
                aria-hidden='true'
              />No counter yet. A counter is a new Offer linked back to this
              one — this card is never edited to answer it.
            </p>
          {{/if}}
        </section>

        <div class='cols'>
          {{! Shape: a compact party rail — quieter utility panel, distinct
              from the thread's prose shape above and the ledger below. }}
          <section class='sec'>
            <h2 class='sec-h'><TagIcon
                class='sec-icon'
                aria-hidden='true'
              />Listing &amp; parties</h2>
            <ul class='links'>
              {{#if @model.listing}}
                <li><@fields.listing @format='embedded' /></li>
              {{else}}
                <li class='empty-li'>
                  <p class='empty'>
                    <TagIcon width='18' height='18' aria-hidden='true' />No
                    listing linked — an offer with nothing to buy.
                  </p>
                </li>
              {{/if}}
              {{#if @model.offeredBy}}
                <li><@fields.offeredBy @format='embedded' /></li>
              {{/if}}
            </ul>
          </section>

          {{! Shape: a mono ledger — a third, structurally different panel
              (definition list of dated facts, not a link list or prose). }}
          <section class='sec'>
            <h2 class='sec-h'><CalendarIcon
                class='sec-icon'
                aria-hidden='true'
              />Dates</h2>
            <dl class='facts'>
              <div class='f-row'>
                <dt>Offered</dt>
                <dd>{{#if @model.offeredAt}}<@fields.offeredAt
                      @format='atom'
                    />{{else}}—{{/if}}</dd>
              </div>
              <div class='f-row'>
                <dt>Responded</dt>
                <dd>{{#if @model.respondedAt}}<@fields.respondedAt
                      @format='atom'
                    />{{else}}—{{/if}}</dd>
              </div>
              <div class='f-row'>
                <dt>Expires</dt>
                <dd>{{#if @model.expiresAt}}<@fields.expiresAt
                      @format='atom'
                    />{{else}}—{{/if}}</dd>
              </div>
            </dl>
            <p class='facts-note'>Past its expiry an offer must be MOVED to
              expired — it does not lapse on its own.</p>
          </section>
        </div>
      </article>

      <style scoped>

        /* Rule 1: isolated gets NO host container — declare our own, named.
           Literal committed tokens, matching the Sole Vault app shell —
           nothing here is meant to be swappable. */
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
          padding: 2rem;
          display: flex;
          flex-direction: column;
          gap: 1.75rem;

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
        .mono {
          font-family: var(--font-mono);
          font-variant-numeric: tabular-nums;
        }

        /* ---------- hero ---------- */
        .hero {
          display: flex;
          flex-direction: column;
          gap: 0.85rem;
        }
        .hero-top {
          display: flex;
          flex-wrap: wrap;
          align-items: baseline;
          gap: 0.75rem;
        }
        .hero-title {
          margin: 0;
          font-family: var(--font-display);
          font-size: clamp(1.625rem, 1.1rem + 2cqi, 2.5rem);
          line-height: 1.1;
          font-weight: 900;
          letter-spacing: -0.015em;
        }
        /* A type label, not a kicker — sits beside the title rather than
           above it, and only appears when true. */
        .counter-flag {
          flex: none;
          padding: 0.3em 0.7em;
          border: 1px solid var(--hairline);
          border-radius: 999px;
          font-size: 0.6875rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--smoke);
        }
        .parties {
          margin: 0;
          display: flex;
          flex-wrap: wrap;
          gap: 0.35rem 1.1rem;
          font-size: 0.875rem;
          color: var(--smoke);
        }
        .party strong {
          color: var(--paper);
          font-weight: 600;
        }

        /* THE VAULT PLAQUE — light translation of the family signature:
           gold top-rule over the serif ink figure, matching the shell's
           ledger-hero. The dark-era filled slab reads orange on white. */
        .plaque {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
          gap: 1rem;
          background: var(--ink-800);
          border: 1px solid var(--hairline);
          border-top: 3px solid var(--gold);
          border-radius: 6px;
          padding: 1.25rem 1.6rem;
          box-shadow: var(--shadow-1);
        }
        .plaque-figure {
          display: grid;
          gap: 0.15rem;
        }
        .plaque-label {
          margin: 0;
          font-size: 0.75rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--gold-ink, var(--gold));
        }
        .plaque-amount {
          margin: 0;
          font-family: var(--font-display);
          font-size: clamp(2.25rem, 1.2rem + 4.5cqi, 3.5rem);
          line-height: 1;
          font-weight: 900;
          letter-spacing: -0.02em;
          color: var(--paper);
          font-variant-numeric: tabular-nums;
        }
        .plaque-meta {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 0.6rem;
        }
        /* The delta pill — the offer-vs-asking comparison as its own small
           moment, distinct in shape from a money figure. */
        .delta {
          padding: 0.3em 0.75em;
          border-radius: 999px;
          font-size: 0.75rem;
          font-weight: 700;
          white-space: nowrap;
          background: color-mix(
            in oklch,
            var(--ink-950, oklch(0.1 0.004 49.25)) 16%,
            transparent
          );
          color: var(--ink-950);
        }

        /* ---------- the negotiation thread: given weight, not one of three
           identical boxes ---------- */
        .thread {
          background: var(--ink-800);
          border: 1px solid var(--hairline);
          border-radius: 14px;
          padding: 1.4rem 1.6rem;
          box-shadow: var(--shadow-1);
        }
        .thread-h {
          margin: 0 0 0.85rem;
          display: flex;
          align-items: center;
          gap: 0.5em;
          font-family: var(--font-display);
          font-size: 1.375rem;
          font-weight: 700;
        }
        .thread-icon {
          width: max(16px, 1em);
          height: max(16px, 1em);
          color: var(--gold-ink, var(--gold));
          flex: none;
        }

        /* ---------- utility panels: link rail + mono ledger, each its own
           shape ---------- */
        .cols {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          gap: 1.25rem;
        }
        .sec {
          background: var(--ink-800);
          border: 1px solid var(--hairline);
          border-radius: 12px;
          padding: 1.1rem 1.3rem 1.3rem;
          min-width: 0;
          box-shadow: var(--shadow-1);
        }
        .sec-h {
          margin: 0 0 0.85rem;
          display: flex;
          align-items: center;
          gap: 0.5em;
          font-size: 0.6875rem;
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
          margin-left: 0.5em;
          font-family: var(--font-mono);
          font-variant-numeric: tabular-nums;
          color: var(--paper);
        }

        /* The buyer's own words — prose, a different shape from every list. */
        .msg {
          margin: 0 0 1rem;
          padding: 0 0 0 1rem;
          border-left: 2px solid var(--gold);
          font-size: 1rem;
          line-height: 1.55;
          font-style: italic;
          color: var(--paper);
        }
        .thread-k {
          margin: 1rem 0 0.5rem;
          display: flex;
          align-items: baseline;
          font-size: 0.6875rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.07em;
          color: var(--smoke);
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
          padding-bottom: 0.5rem;
          border-bottom: 1px solid var(--hairline);
          font-size: 0.875rem;
        }
        .f-row:last-of-type {
          border-bottom: 0;
          padding-bottom: 0;
        }
        .f-row dt {
          font-size: 0.6875rem;
          text-transform: uppercase;
          letter-spacing: 0.07em;
          color: var(--smoke);
        }
        .f-row dd {
          margin: 0;
          font-family: var(--font-mono);
          font-weight: 600;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }
        .facts-note {
          margin: 0.9rem 0 0;
          font-size: 0.75rem;
          line-height: 1.45;
          color: var(--smoke);
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
          color: var(--gold-ink, var(--gold));
        }

        @container card (width < 700px) {
          .plaque {
            flex-direction: column;
            align-items: flex-start;
          }
          .cols {
            grid-template-columns: 1fr;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .card * {
            transition: none !important;
            animation: none !important;
          }
        }
      </style>
    </template>
  };

  // EDIT — nine editable fields, grouped.
  //
  // `counterTo` gets prominent helper text because it is the one field on this
  // card whose EMPTY state carries meaning: blank means an opening offer, set
  // means a reply. Someone filling this form without knowing that will either
  // orphan a counter or accidentally chain an opening offer to an unrelated one.
  static edit = class Edit extends Component<typeof Offer> {
    @tracked threadOpen = true;
    @tracked datesOpen = false;

    toggleThread = () => (this.threadOpen = !this.threadOpen);
    toggleDates = () => (this.datesOpen = !this.datesOpen);

    <template>
      <div class='of-edit'>
        <header class='oe-head'>
          <FieldContainer @label='Listing' @tag='label' @vertical={{true}}>
            <@fields.listing />
          </FieldContainer>

          <div class='oe-identity'>
            <FieldContainer @label='Amount' @tag='label' @vertical={{true}}>
              <@fields.amount />
              <p class='oe-help'>Compared against the listing’s asking price at
                render time, never stored — so it stays correct if the seller
                re-prices.</p>
            </FieldContainer>
            <FieldContainer @label='Status' @tag='label' @vertical={{true}}>
              <@fields.offerStatus />
              <p class='oe-help'><code>open</code>
                is the only state that can change. Every other value closes this
                card for good.</p>
            </FieldContainer>
            <FieldContainer @label='Offered by' @tag='label' @vertical={{true}}>
              <@fields.offeredBy />
              <p class='oe-help'>On a counter this is the seller — the roles
                swap down the chain.</p>
            </FieldContainer>
          </div>
        </header>

        <Accordion class='oe-sections' @displayContainer={{false}} as |A|>
          <A.Item
            @id='thread'
            @isOpen={{this.threadOpen}}
            @onClick={{this.toggleThread}}
          >
            <:title>Negotiation thread</:title>
            <:content>
              <div class='oe-body'>
                <FieldContainer
                  @label='Counter to'
                  @tag='label'
                  @vertical={{true}}
                >
                  <@fields.counterTo />
                  <p class='oe-help'><strong>Leave empty for an opening offer.</strong>
                    Set it only when this offer answers another one — following
                    the chain backwards is how the whole exchange is
                    reconstructed, so a wrong link rewrites history.</p>
                </FieldContainer>
                <FieldContainer
                  @label='Message'
                  @tag='label'
                  @vertical={{true}}
                >
                  <@fields.message />
                </FieldContainer>
              </div>
            </:content>
          </A.Item>

          <A.Item
            @id='dates'
            @isOpen={{this.datesOpen}}
            @onClick={{this.toggleDates}}
          >
            <:title>Dates</:title>
            <:content>
              <div class='oe-body oe-grid-3'>
                <FieldContainer
                  @label='Offered'
                  @tag='label'
                  @vertical={{true}}
                >
                  <@fields.offeredAt />
                </FieldContainer>
                <FieldContainer
                  @label='Responded'
                  @tag='label'
                  @vertical={{true}}
                >
                  <@fields.respondedAt />
                </FieldContainer>
                <FieldContainer
                  @label='Expires'
                  @tag='label'
                  @vertical={{true}}
                >
                  <@fields.expiresAt />
                  <p class='oe-help'>Past this date the offer should be moved to
                    expired — it does not lapse on its own.</p>
                </FieldContainer>
              </div>
            </:content>
          </A.Item>
        </Accordion>
      </div>

      <style scoped>

        /* Rule 1: edit has no host container — declare our own, named. */
        .of-edit {
          container-type: inline-size;
          container-name: of-edit;
          box-sizing: border-box;

          --background: oklch(0.985 0.001 106.42);

          --ink-900: var(--background);
          --card: oklch(1 0 0);
          --card-foreground: oklch(0.147 0.004 49.25);
          --accent: oklch(0.769 0.188 70.08);
          --accent-foreground: oklch(0.216 0.006 56.04);
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

                    --font-mono: ui-monospace, 'SFMono-Regular', Menlo, Consolas,
            monospace;

          background: var(--ink-900);
          color: var(--paper);
          font-family: var(--font-sans, 'Inter', system-ui, -apple-system, sans-serif);
          height: 100%;
          overflow-y: auto;
          padding: 1.5rem;
          display: flex;
          flex-direction: column;
          gap: 1.25rem;

          scrollbar-color: var(--gold) var(--ink-800);
        }
        .of-edit::-webkit-scrollbar {
          width: 10px;
          height: 10px;
        }
        .of-edit::-webkit-scrollbar-track {
          background: var(--ink-800);
        }
        .of-edit::-webkit-scrollbar-thumb {
          background: var(--gold);
          border-radius: 999px;
          border: 2px solid var(--ink-800);
        }
        .of-edit ::selection {
          background: var(--gold);
          color: var(--ink-900);
        }
        .of-edit *:focus-visible {
          outline: 2px solid var(--gold);
          outline-offset: 2px;
        }
        .oe-head {
          display: flex;
          flex-direction: column;
          gap: 0.9rem;
          border-bottom: 1px solid var(--hairline);
          padding-bottom: 1.25rem;
        }
        .oe-identity {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 0.9rem;
        }
        .oe-body {
          padding: 0.75rem 0.4rem;
          display: grid;
          gap: 0.9rem;
        }
        .oe-grid-3 {
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }
        .oe-help {
          margin: 0.2rem 0 0;
          font-size: 0.75rem;
          line-height: 1.45;
          color: var(--smoke);
        }
        .oe-help code {
          font-family: var(--font-mono);
          background: var(--ink-800);
          border: 1px solid var(--hairline);
          padding: 0.05em 0.35em;
          border-radius: 3px;
          color: var(--paper);
        }
        .oe-help strong {
          color: var(--paper);
        }
        .of-edit :deep(.boxel-label) {
          text-transform: uppercase;
          letter-spacing: 0.08em;
          font-size: 0.75rem;
          font-weight: 500;
          color: var(--smoke);
        }

        @container of-edit (width < 640px) {
          .oe-identity,
          .oe-grid-3 {
            grid-template-columns: 1fr;
          }
        }
      </style>
    </template>
  };

  // FITTED — FittedCard, same fork and knobs as the family's other supporting
  // tiles.
  //
  // SLOT DISCIPLINE — four distinct facts, four slots:
  //   productTitle (eyebrow) · amount (title, the anchor) · status (badge) ·
  //   the offer-vs-asking gap (footer)
  //
  // NOTE ON THE GAP: it is computed here from `listingPrice`, which is
  // denormalized onto the card precisely so a PRERENDERED tile can show it —
  // prerendered fitted cannot resolve `linksTo`, so reading the listing
  // directly would render blank. The comparison itself is still derived at
  // render time, never stored, so it cannot go stale when the seller re-prices.
  static fitted = class Fitted extends Component<typeof Offer> {
    get amount() {
      return formatMoney(this.args.model?.amount);
    }

    get gap() {
      let g = computeGap(
        this.args.model?.amount?.amount,
        this.args.model?.listingPrice?.amount,
      );
      if (!g) {
        return null;
      }
      return g.pct === 0
        ? 'at ask'
        : g.pct > 0
        ? `${g.pct}% below ask`
        : `${Math.abs(g.pct)}% above ask`;
    }

    <template>
      <FittedCard class='of-fit' @titleTag='h3'>
        {{! Rule 2 anchor: no image field on an offer, so the tier-2 icon — the
            card's OWN static icon, shared with its isolated and atom formats. }}
        <:placeholder>
          <HandshakeIcon
            width='max(18px, 34%)'
            height='max(18px, 34%)'
            aria-hidden='true'
          />
        </:placeholder>

        <:eyebrow>{{if
            @model.productTitle
            @model.productTitle
            'Unlinked listing'
          }}</:eyebrow>

        {{! The amount is the main field of an offer, so it takes the title slot
            and FittedCard's own "title is loudest" behaviour points at the right
            value rather than being fought. }}
        <:title>{{if this.amount this.amount '—'}}</:title>

        <:badgeRight>
          {{#if @model.offerStatus}}
            <@fields.offerStatus @format='atom' />
          {{/if}}
        </:badgeRight>

        <:footer>
          {{#if this.gap}}
            <span class='of-gap'>{{this.gap}}</span>
          {{/if}}
          {{#if @model.isCounter}}
            <span class='of-counter'>Counter</span>
          {{/if}}
        </:footer>
      </FittedCard>

      <style scoped>
        /* No container-type / container-name — FittedCard queries the HOST's
           `fitted-card` container. */
        .of-fit {
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
          box-shadow: inset 2px 0 0 0 var(--gold);

          --fc-image-width: 34cqh;
          --fc-image-min-width: 2.5rem;
          --fc-image-max-width: 5rem;
          --fc-image-background: var(--ink-700);
          --fc-image-fade-color: var(--ink-800);

          --fc-content-padding: 0.5rem 0.75rem;
          --fc-header-gap: 0.15em;
          --fc-content-gap: 0.25rem;

          --fc-eyebrow-font-size: max(9px, 0.62em);
          --fc-eyebrow-line-height: 1.25;
          --fc-title-font-size: max(15px, 1.3em);
          --fc-title-line-height: 1.2;
          --fc-title-line-clamp: 1;
          --fc-footer-font-size: max(11px, 0.72em);
          --fc-footer-gap: 0.5rem;
          --fc-footer-justify: space-between;
          --fc-footer-flex-wrap: nowrap;
          --fc-badge-offset: 0.2rem;
        }

        /* The product name is the QUIET row here — clamped to one line so a long
           colourway cannot push the amount off the tile. */
        .of-fit :deep(.fc-eyebrow) {
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--smoke);
          font-weight: 600;
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 1;
          overflow: hidden;
        }
        /* The anchor — gold display serif, same as every money figure in the
           family's hero moments. */
        .of-fit :deep(.fc-title) {
          font-family: 'Playfair Display', Georgia, serif;
          color: var(--gold-ink, var(--gold));
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          letter-spacing: -0.01em;
          white-space: nowrap;
        }
        .of-fit :deep(.fc-footer) {
          line-height: 1.25;
        }

        /* A ratio is not an amount: muted mono and a step down, so it
           annotates the figure rather than reading as a second money value. */
        .of-gap {
          font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas,
            monospace;
          color: var(--smoke);
          white-space: nowrap;
        }
        /* A different KIND of mark from the gap beside it — uppercase and
           tracked, so the two footer values do not read as one wrapped field. */
        .of-counter {
          font-size: 0.85em;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.07em;
          color: var(--smoke);
          white-space: nowrap;
        }

        /* ---- quanta: visibility only ---- */
        @container fitted-card (height <= 50px) {
          .of-fit {
            --fc-footer-display: none;
            --fc-badge-right-display: none;
            --fc-content-padding: 0.15rem 0.35rem;
          }
          .of-fit :deep(.fc-eyebrow) {
            display: none;
          }
        }

        /* The counter mark goes before the gap does: the gap is the number the
           reader is deciding on, the mark is context. */
        @container fitted-card (width <= 220px) and (height <= 80px) {
          .of-fit .of-counter {
            display: none;
          }
        }

        @container fitted-card (width <= 150px) {
          .of-fit {
            --fc-image-max-width: 100%;
          }
          .of-fit :deep(.fc-eyebrow) {
            display: none;
          }
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof Offer> {
    get amount() {
      return formatMoney(this.args.model?.amount);
    }

    <template>
      <span class='of-atom'>
        <span class='of-amt'>{{if this.amount this.amount '—'}}</span>
        {{#if @model.offerStatus}}
          <@fields.offerStatus @format='atom' />
        {{/if}}
      </span>
      <style scoped>
        .of-atom {
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
        }
        .of-amt {
          font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas,
            monospace;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof Offer> {
    get amount() {
      return formatMoney(this.args.model?.amount);
    }

    // Computed at render time, never stored: the moment the seller re-prices,
    // a stored discount would be a confident lie.
    get gap() {
      let g = computeGap(
        this.args.model?.amount?.amount,
        this.args.model?.listingPrice?.amount,
      );
      return g?.label ?? null;
    }

    <template>
      <div class='of-row'>
        <span class='of-main'>
          {{! StatePill in CHROME mode, not a hand-rolled label span. "Counter"
              is a TYPE the reader parses once, not a state they scan for — which
              is precisely what `@chrome` exists for: it returns a transparent
              fill with muted-foreground text (verified in state-pill.gts's
              `colorArgs`), so it reads as chrome beside the coloured status pill
              at the end of the row rather than competing with it. Using the
              realm's own component also means the "Counter" marker matches every
              other type label in the app instead of being a private variant. }}
          {{#if @model.isCounter}}
            <StatePill @label='Counter' @chrome={{true}} />
          {{/if}}
          <span class='of-title'>{{if
              @model.productTitle
              @model.productTitle
              'Unlinked listing'
            }}</span>
        </span>
        <span class='of-money'>
          <span class='of-amt'>{{if this.amount this.amount '—'}}</span>
          {{#if this.gap}}<span class='of-gap'>{{this.gap}}</span>{{/if}}
        </span>
        {{#if @model.offerStatus}}
          <@fields.offerStatus @format='atom' />
        {{/if}}
      </div>
      <style scoped>
        /* Own inset — the host's CardContainer adds none. Literal committed
           tokens rather than theme-var fallbacks, matching the rest of the
           family. */
        .of-row {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto auto;
          gap: 0.75rem;
          align-items: center;
          padding: 0.5rem 0.75rem;
          background: var(--card, oklch(0.216 0.006 56.04));
          color: var(--foreground, oklch(0.985 0.001 106.42));
          font-family: var(--font-sans, 'Inter', system-ui, -apple-system, sans-serif);
        }
        .of-main {
          display: flex;
          align-items: baseline;
          gap: 0.4rem;
          min-width: 0;
        }
        /* No .of-tag rule any more — StatePill owns the chrome label's colour
           and density. It only needs to not shrink in the flex row. */
        .of-main :deep(.state-pill) {
          flex: none;
        }
        .of-title {
          font-weight: 600;
          font-size: 0.875rem;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .of-money {
          display: grid;
          justify-items: end;
        }
        .of-amt {
          font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas,
            monospace;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          color: var(--accent, oklch(0.828 0.189 84.43));
          white-space: nowrap;
        }
        /* A ratio is not an amount: it steps DOWN in size and weight so the
           money figure stays the one thing read first. */
        .of-gap {
          font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas,
            monospace;
          font-size: 0.75rem;
          color: var(--muted-foreground, oklch(0.709 0.01 56.26));
          white-space: nowrap;
        }
      </style>
    </template>
  };
}

export default Offer;
