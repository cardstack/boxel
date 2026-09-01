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
import { SellerProfile } from './seller-profile';
import ReceiptIcon from '@cardstack/boxel-icons/receipt';
import CalendarIcon from '@cardstack/boxel-icons/calendar';
import CoinsIcon from '@cardstack/boxel-icons/coins';
import CreditCardIcon from '@cardstack/boxel-icons/credit-card';
import PackageIcon from '@cardstack/boxel-icons/package';
import LockIcon from '@cardstack/boxel-icons/lock';
import AlertTriangleIcon from '@cardstack/boxel-icons/alert-triangle';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import {
  Accordion,
  Button,
  FieldContainer,
  LoadingIndicator,
} from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';
import { identifyCard } from '@cardstack/runtime-common';
// CYCLE-SAFE IMPORTS. Both of these modules import THIS one, so these are
// circular by construction. They are legal only because `identifyCard(...)` is
// read inside the reverse-query getters below and never at module-evaluation
// time. Do not lift them into a top-level constant.
import { Shipment } from './sole-vault-shipment';
import { Payment } from './sole-vault-payment';
import { formatMoney } from './money-format';

// Order — one escrow-protected purchase of one Listing.
//
// This is the spec's Feature 4 core, and the block the app has been missing:
// without it there is no checkout, so the marketplace can only be browsed.
//
// THE ESCROW GRAPH IS THE POINT. An order is not a record with a status string
// on it; it is a state machine holding someone's money. `statusField` carries the
// transition graph so the field can answer "may I?" rather than only "what are
// the choices?" — see the transitions block below for why each edge exists and,
// more importantly, why the missing edges are missing.
//
// MONEY IS FIVE SEPARATE AMOUNTS, NOT ONE. Item price, shipping, authentication
// fee and platform fee are each their own `AmountWithCurrency`, and the total is
// COMPUTED from them rather than stored. A stored total is the classic
// reconciliation bug: it survives a change to any component and then disagrees
// with the sum of its own parts, and nothing in the UI reveals which is right.
//
// FEES ARE SNAPSHOTS, NOT RATES. `platformFee` holds the money actually charged,
// not "3%". A rate re-derived at read time silently rewrites the history of every
// past order the day the rate changes — the buyer's receipt must not move.
//
// WHAT THIS BLOCK DOES NOT DO: charge anything. A realm cannot hold funds, so
// `Payment` is a RECORD of an external processor's state and the commands that
// move this graph are simulations. That is stated here rather than implied,
// because a card that looks like it takes money and does not is worse than one
// that never pretended.

export type OrderStatus =
  | 'pending-payment'
  | 'paid'
  | 'shipped'
  | 'authenticating'
  | 'delivered'
  | 'completed'
  | 'disputed'
  | 'refunded';

export const OrderStatusField = statusField({
  displayName: 'Order Status',
  icon: ReceiptIcon,
  options: [
    {
      value: 'pending-payment',
      label: 'Pending payment',
      hue: 'slate',
      meaning: 'Placed, but the buyer has not paid yet. Nothing is held.',
    },
    {
      value: 'paid',
      label: 'Paid',
      hue: 'blue',
      holds: true,
      meaning:
        'Funds are held in escrow. The seller owes a shipment; the platform owes a refund if anything fails.',
    },
    {
      value: 'shipped',
      label: 'Shipped',
      hue: 'purple',
      holds: true,
      meaning: 'In transit to the authentication centre, not to the buyer.',
    },
    {
      value: 'authenticating',
      label: 'Authenticating',
      hue: 'amber',
      holds: true,
      meaning:
        'Received and under inspection. The verdict decides whether this completes or refunds.',
    },
    {
      value: 'delivered',
      label: 'Delivered',
      hue: 'teal',
      holds: true,
      meaning: 'With the buyer, awaiting their confirmation.',
    },
    {
      value: 'completed',
      label: 'Completed',
      hue: 'green',
      terminal: true,
      holds: true,
      meaning: 'Buyer confirmed. Funds released to the seller.',
    },
    {
      value: 'disputed',
      label: 'Disputed',
      hue: 'orange',
      holds: true,
      meaning: 'Someone has raised a problem. Funds stay held until resolved.',
    },
    {
      value: 'refunded',
      label: 'Refunded',
      hue: 'red',
      terminal: true,
      holds: true,
      meaning: 'Money returned to the buyer. The item goes back to the seller.',
    },
  ],
  // The edges that are ABSENT carry as much meaning as the ones present:
  //
  //   * Nothing returns to `pending-payment`. Un-charging a card is a refund,
  //     which is its own terminal state with its own money movement.
  //   * `completed` leads nowhere. Once funds are released the platform no
  //     longer holds anything, so there is nothing left for this graph to move;
  //     a later problem is a new dispute record, not an edit to this one.
  //   * `refunded` leads nowhere for the same reason, in the other direction.
  //   * Authentication failure is `authenticating → refunded`, never
  //     `authenticating → delivered`. The spec is explicit: a failed legit check
  //     refunds the buyer and returns the item, so there must be no path that
  //     ships a fake onward.
  //   * Every money-holding state can reach `disputed`, because a problem can
  //     surface at any point while funds are held.
  transitions: {
    'pending-payment': ['paid', 'refunded'],
    paid: ['shipped', 'disputed', 'refunded'],
    shipped: ['authenticating', 'disputed', 'refunded'],
    authenticating: ['delivered', 'refunded', 'disputed'],
    delivered: ['completed', 'disputed'],
    disputed: ['completed', 'refunded'],
    completed: [],
    refunded: [],
  },
});

/** Re-exported so a command can ask permission without importing the field. */
export function canOrderTransition(from?: string | null, to?: string | null) {
  return canTransition(OrderStatusField, from, to);
}

/** What an action menu should offer for the current state. */
export function nextOrderStatuses(from?: string | null) {
  return nextStatuses(OrderStatusField, from);
}

export class Order extends CardDef {
  static displayName = 'Order';
  static icon = ReceiptIcon;

  // Human-facing reference — 'SV-2024-1234' in the spec. A StringField and not
  // a computed one: it is issued once and then quoted in emails, support
  // threads and disputes, so it must never change because a field it derived
  // from changed.
  @field reference = contains(StringField);

  @field listing = linksTo(() => Listing, { searchable: true });
  @field buyer = linksTo(() => SoleVaultPerson, { searchable: true });
  // Narrowed to SellerProfile, not the plain SoleVaultPerson buyer uses one
  // line up — a seller carries a rating, a buyer does not.
  @field seller = linksTo(() => SellerProfile, { searchable: true });

  // --- money, as four snapshots + one computed total ---
  @field price = contains(AmountWithCurrency);
  @field shippingPrice = contains(AmountWithCurrency);
  @field authFee = contains(AmountWithCurrency);
  @field platformFee = contains(AmountWithCurrency);

  @field orderStatus = contains(OrderStatusField);

  // --- lifecycle as event facts, same rule as the rest of this family: store
  // the date the thing happened, derive every boolean from it. ---
  @field placedAt = contains(DateField);
  @field paidAt = contains(DateField);
  @field shippedAt = contains(DateField);
  @field authenticatedAt = contains(DateField);
  @field deliveredAt = contains(DateField);
  @field completedAt = contains(DateField);

  @field trackingNumber = contains(StringField);

  // The processor's own reference. Deliberately a plain string: this realm does
  // not model a card, a token or a balance, and pretending otherwise would
  // invite someone to treat it as authoritative.
  @field paymentReference = contains(StringField);

  // TOTAL IS COMPUTED. Currency comes from `price` — mixing currencies inside
  // one order is not a sum, it is a bug, so the code is taken from the item
  // price and the components are added as bare amounts.
  @field total = contains(AmountWithCurrency, {
    computeVia: function (this: Order) {
      let parts = [
        this.price,
        this.shippingPrice,
        this.authFee,
        this.platformFee,
      ];
      let sum = 0;
      let seen = false;
      for (let p of parts) {
        if (p?.amount != null) {
          sum += p.amount;
          seen = true;
        }
      }
      if (!seen) {
        return undefined;
      }
      // A REAL AmountWithCurrency instance, not a `{ amount, currency }`
      // literal. The index's searchable walker calls peekAtField on this
      // value, and a plain object throws "the card Object does not have a
      // field 'amount'" — which error-rows not just this Order but every
      // Payment/Shipment whose searchable `order` link walks into it.
      return new AmountWithCurrency({
        amount: sum,
        currency: this.price?.currency,
      });
    },
  });

  // Escrow is holding money in every state the graph marks `holds`, minus the
  // two terminals. Derived, so it cannot disagree with the status.
  @field fundsHeld = contains(BooleanField, {
    computeVia: function (this: Order) {
      let s = this.orderStatus;
      return (
        s === 'paid' ||
        s === 'shipped' ||
        s === 'authenticating' ||
        s === 'delivered' ||
        s === 'disputed'
      );
    },
  });

  @field isPaid = contains(BooleanField, {
    computeVia: function (this: Order) {
      return this.paidAt != null;
    },
  });

  // --- DENORMALIZED FOR PRERENDERED FITTED ---
  //
  // An Orders tab is a grid, a grid is prerendered fitted, and prerendered
  // fitted CANNOT resolve linksTo. A tile that reads `listing.productTitle`
  // directly renders blank — which is every tile in the tab, since the product
  // name is the tile's headline. These are resolved at INDEX time and stored in
  // the search document, so they are plain attributes by the time fitted runs.
  //
  // Defensive on purpose: every link here is optional and may be unloaded.
  @field productTitle = contains(StringField, {
    computeVia: function (this: Order) {
      return this.listing?.productTitle ?? this.cardInfo?.name ?? '';
    },
  });

  @field sellerName = contains(StringField, {
    computeVia: function (this: Order) {
      return this.seller?.title ?? '';
    },
  });

  @field buyerName = contains(StringField, {
    computeVia: function (this: Order) {
      return this.buyer?.title ?? '';
    },
  });

  @field conditionCode = contains(StringField, {
    computeVia: function (this: Order) {
      return this.listing?.conditionCode ?? '';
    },
  });

  // ISOLATED — the order's landing page.
  //
  // DOMAIN QUESTION: "where is my money, and what happens next?" Everyone who
  // opens an order — buyer, seller, support — wants those two things, and
  // neither is a field on this card:
  //
  //   * "where is my money" is the escrow state plus the Payment records that
  //     link TO this order — a reverse query.
  //   * "what happens next" is the shipment legs, also a reverse query, plus
  //     the transition graph's own answer for the current state.
  //
  // A version of this card that rendered its own fields tidily and answered
  // neither would pass every technical check and still be useless — which is
  // exactly the failure the domain-question rule exists to catch.
  //
  // Direction: Instrument, the family's operational register. Signature element:
  // the vault plaque (gold hairline over the headline figure) plus the same
  // lifecycle rail CollectionItem's provenance and AuthenticationRecord's
  // progress use. One mark reused across the family, not a new marquee per card.
  // EDIT — 17 editable fields, so grouping is not optional: a flat list in
  // declaration order would bury the reference behind four money fields and six
  // dates, and nothing would signal which of them someone actually touches.
  //
  // The identity row up top carries what is glanced at (reference, status), the
  // parties sit just below, and the money, timeline and fulfilment fields go
  // into independently collapsible sections. `total`, `fundsHeld`, `isPaid` and
  // the four denormalized strings are computed and deliberately absent.
  //
  // HELPER TEXT EARNS ITS PLACE HERE more than on most cards, because two things
  // about this form are genuinely counter-intuitive and both cost money if
  // guessed wrong: the fee fields are recorded amounts rather than rates, and
  // the status is a graph rather than a free dropdown.
  static edit = class Edit extends Component<typeof Order> {
    @tracked moneyOpen = true;
    @tracked timelineOpen = false;
    @tracked fulfilmentOpen = false;

    toggleMoney = () => (this.moneyOpen = !this.moneyOpen);
    toggleTimeline = () => (this.timelineOpen = !this.timelineOpen);
    toggleFulfilment = () => (this.fulfilmentOpen = !this.fulfilmentOpen);

    <template>
      <div class='o-edit'>
        <header class='oe-head'>
          <div class='oe-identity'>
            <FieldContainer @label='Reference' @tag='label' @vertical={{true}}>
              <@fields.reference />
              <p class='oe-help'>Issued once, then quoted in emails and disputes
                — changing it breaks every reference to this order.</p>
            </FieldContainer>
            <FieldContainer @label='Status' @tag='label' @vertical={{true}}>
              <@fields.orderStatus />
              <p class='oe-help'>Moves along a fixed graph. A failed
                authentication must refund, so there is no path from
                authenticating straight to delivered.</p>
            </FieldContainer>
          </div>

          <div class='oe-parties'>
            <FieldContainer @label='Listing' @tag='label' @vertical={{true}}>
              <@fields.listing />
            </FieldContainer>
            <FieldContainer @label='Buyer' @tag='label' @vertical={{true}}>
              <@fields.buyer />
            </FieldContainer>
            <FieldContainer @label='Seller' @tag='label' @vertical={{true}}>
              <@fields.seller />
            </FieldContainer>
          </div>
        </header>

        <Accordion class='oe-sections' @displayContainer={{false}} as |A|>
          <A.Item
            @id='money'
            @isOpen={{this.moneyOpen}}
            @onClick={{this.toggleMoney}}
          >
            <:title>Money</:title>
            <:content>
              <div class='oe-body oe-grid-2'>
                <FieldContainer
                  @label='Item price'
                  @tag='label'
                  @vertical={{true}}
                >
                  <@fields.price />
                </FieldContainer>
                <FieldContainer
                  @label='Shipping'
                  @tag='label'
                  @vertical={{true}}
                >
                  <@fields.shippingPrice />
                </FieldContainer>
                <FieldContainer
                  @label='Authentication fee'
                  @tag='label'
                  @vertical={{true}}
                >
                  <@fields.authFee />
                </FieldContainer>
                <FieldContainer
                  @label='Platform fee'
                  @tag='label'
                  @vertical={{true}}
                >
                  <@fields.platformFee />
                </FieldContainer>
              </div>
              <p class='oe-note'>These are the amounts actually charged, not
                rates. The total is computed from them and is not editable — a
                stored total drifts from the sum of its own parts.</p>
            </:content>
          </A.Item>

          <A.Item
            @id='timeline'
            @isOpen={{this.timelineOpen}}
            @onClick={{this.toggleTimeline}}
          >
            <:title>Timeline</:title>
            <:content>
              <div class='oe-body oe-grid-3'>
                <FieldContainer @label='Placed' @tag='label' @vertical={{true}}>
                  <@fields.placedAt />
                </FieldContainer>
                <FieldContainer @label='Paid' @tag='label' @vertical={{true}}>
                  <@fields.paidAt />
                </FieldContainer>
                <FieldContainer
                  @label='Shipped'
                  @tag='label'
                  @vertical={{true}}
                >
                  <@fields.shippedAt />
                </FieldContainer>
                <FieldContainer
                  @label='Authenticated'
                  @tag='label'
                  @vertical={{true}}
                >
                  <@fields.authenticatedAt />
                </FieldContainer>
                <FieldContainer
                  @label='Delivered'
                  @tag='label'
                  @vertical={{true}}
                >
                  <@fields.deliveredAt />
                </FieldContainer>
                <FieldContainer
                  @label='Completed'
                  @tag='label'
                  @vertical={{true}}
                >
                  <@fields.completedAt />
                </FieldContainer>
              </div>
              <p class='oe-note'>These dates drive the escrow rail on the detail
                view, and “funds held” is derived from the status — neither is
                stored separately, so a date left blank shows as a step not yet
                reached.</p>
            </:content>
          </A.Item>

          <A.Item
            @id='fulfilment'
            @isOpen={{this.fulfilmentOpen}}
            @onClick={{this.toggleFulfilment}}
          >
            <:title>Fulfilment &amp; payment refs</:title>
            <:content>
              <div class='oe-body oe-grid-2'>
                <FieldContainer
                  @label='Tracking number'
                  @tag='label'
                  @vertical={{true}}
                >
                  <@fields.trackingNumber />
                  <p class='oe-help'>The summary reference. Per-leg tracking
                    lives on the Shipment cards, which is where an exception is
                    actually resolved.</p>
                </FieldContainer>
                <FieldContainer
                  @label='Payment reference'
                  @tag='label'
                  @vertical={{true}}
                >
                  <@fields.paymentReference />
                  <p class='oe-help'>The processor’s own id. This realm records
                    it; it never charges anything.</p>
                </FieldContainer>
              </div>
            </:content>
          </A.Item>
        </Accordion>
      </div>

      <style scoped>

        /* Rule 1: the edit format has NO host-provided container — the same law
           as isolated — so this root declares its own, NAMED, or every
           @container rule below is inert CSS. */
        .o-edit {
          container-type: inline-size;
          container-name: o-edit;

          /* Literal Sole Vault tokens — same names and values as the app shell
             and this card's isolated/fitted slices, on purpose. */
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

          --font-display: var(--font-serif, 'Playfair Display', Georgia, serif);
                    --font-mono: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;

          background: var(--ink-900);
          color: var(--paper);
          font-family: var(--font-sans, 'Inter', system-ui, -apple-system, sans-serif);
          height: 100%;
          overflow-y: auto;
          padding: 1.5rem;
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
          box-sizing: border-box;

          scrollbar-color: var(--gold) var(--ink-800);
        }
        .o-edit ::selection {
          background: var(--gold);
          color: var(--ink-950);
        }
        .o-edit *:focus-visible {
          outline: 2px solid var(--gold);
          outline-offset: 2px;
        }
        .oe-head {
          display: flex;
          flex-direction: column;
          gap: 0.85rem;
          border-bottom: 1px solid var(--hairline);
          padding-bottom: 1.25rem;
        }
        /* Content-sized, not 1fr 1fr: a reference code and a status select do
           not want the same width as each other. */
        .oe-identity {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
          gap: 0.85rem;
        }
        .oe-parties {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 0.85rem;
        }
        .oe-body {
          padding: 0.6rem 0.35rem;
        }
        .oe-grid-2 {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 0.85rem;
        }
        .oe-grid-3 {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 0.85rem;
        }
        .oe-help,
        .oe-note {
          margin: 0.2rem 0 0;
          font-size: 0.75rem;
          line-height: 1.45;
          color: var(--smoke);
        }
        .oe-note {
          padding: 0 0.35rem;
        }
        /* Uppercase Inter labels, per the design system's form spec. */
        .o-edit :deep(.boxel-label) {
          text-transform: uppercase;
          letter-spacing: 0.08em;
          font-size: 0.75rem;
          font-weight: 500;
          color: var(--smoke);
        }

        @container o-edit (width < 640px) {
          .oe-identity,
          .oe-parties,
          .oe-grid-2,
          .oe-grid-3 {
            grid-template-columns: 1fr;
          }
        }
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof Order> {
    get realms() {
      let realmUrl = this.args.model?.[realmURL];
      return realmUrl ? [realmUrl.href] : [];
    }

    // REVERSE QUERIES. `{ eq: { 'order.id': <this card's id> } }` is the shape,
    // and `on: ref` is not optional — without the anchor the field path resolves
    // against CardDef and the request fails with HTTP 500.
    //
    // IMPORT CYCLE, ON PURPOSE: shipment.gts and payment.gts both import THIS
    // module, so importing them back here is a cycle. ES modules tolerate it
    // because `identifyCard(Shipment)` is only ever read inside this getter —
    // never at module-evaluation time. Do not hoist these to a top-level const
    // "for clarity"; that is what breaks it.
    private shipmentsQuery = this.args.context?.getCards(
      this,
      () => {
        let ref = identifyCard(Shipment);
        let id = this.args.model?.id;
        return ref && id
          ? { filter: { on: ref, every: [{ eq: { 'order.id': id } }] } }
          : undefined;
      },
      () => this.realms,
      { isLive: true },
    );

    private paymentsQuery = this.args.context?.getCards(
      this,
      () => {
        let ref = identifyCard(Payment);
        let id = this.args.model?.id;
        return ref && id
          ? { filter: { on: ref, every: [{ eq: { 'order.id': id } }] } }
          : undefined;
      },
      () => this.realms,
      { isLive: true },
    );

    // `.instances` read at the point of use, dead slots filtered: a deleted
    // target leaves its slot in place, so a raw iteration renders an empty row.
    get shipments() {
      return (this.shipmentsQuery?.instances ?? []).filter(Boolean);
    }

    get payments() {
      return (this.paymentsQuery?.instances ?? []).filter(Boolean);
    }

    // Absent query (no `context` in some render modes) and unresolved query are
    // different states, and only one of them may paint "none".
    get shipmentsLoading() {
      return Boolean(this.shipmentsQuery) && !this.shipmentsQuery?.instances;
    }

    get paymentsLoading() {
      return Boolean(this.paymentsQuery) && !this.paymentsQuery?.instances;
    }

    // A failed query must render its message where the section would be, not
    // silently as empty — otherwise an HTTP 500 reads as "no results".
    get shipmentsError() {
      return (this.shipmentsQuery as any)?.error;
    }

    get paymentsError() {
      return (this.paymentsQuery as any)?.error;
    }

    get total() {
      return formatMoney(this.args.model?.total);
    }

    get itemPrice() {
      return formatMoney(this.args.model?.price);
    }

    get shipping() {
      return formatMoney(this.args.model?.shippingPrice);
    }

    get authFee() {
      return formatMoney(this.args.model?.authFee);
    }

    get platformFee() {
      return formatMoney(this.args.model?.platformFee);
    }

    // The escrow rail. Each step is `done` from its own event DATE rather than
    // from the status string, so the rail cannot disagree with the timeline —
    // and a refunded order correctly shows the steps it did reach.
    get steps() {
      let m = this.args.model;
      return [
        { key: 'placed', label: 'Placed', done: Boolean(m?.placedAt) },
        { key: 'paid', label: 'Paid into escrow', done: Boolean(m?.paidAt) },
        { key: 'shipped', label: 'Shipped', done: Boolean(m?.shippedAt) },
        {
          key: 'authenticated',
          label: 'Authenticated',
          done: Boolean(m?.authenticatedAt),
        },
        {
          key: 'delivered',
          label: 'Delivered',
          done: Boolean(m?.deliveredAt),
        },
        {
          key: 'completed',
          label: 'Funds released',
          done: Boolean(m?.completedAt),
        },
      ];
    }

    // What the graph itself permits from here. Rendered as TEXT for the moves
    // that still have no command (a shipment's own delivery events drive
    // `authenticating`/`delivered`; `completed` and `disputed` have no tool at
    // all) — a control that looks live and no-ops teaches the user to
    // distrust every other control on the page. The three moves that DO have
    // commands render as real buttons below instead of appearing here.
    get allowedNext() {
      // GUARD THE UNSET CASE. `nextStatuses` with no `from` falls back to
      // "everything except the current value" — which, when the status is
      // blank, is all eight states. Listing all eight as "permitted next" is
      // worse than saying nothing, so an order with no status offers none.
      let from = this.args.model?.orderStatus;
      if (!from) {
        return [];
      }
      return nextOrderStatuses(from).filter(
        // These three are the buttons now — repeating them as text would be
        // the fitted-card "one value in two slots" defect wearing a new hat.
        (n) => !['paid', 'shipped', 'refunded'].includes(n.value),
      );
    }

    // ---- command wiring ----
    // Buttons render ONLY when a command context exists (interactive render)
    // AND the state machine permits the move — otherwise nothing, per the
    // no-lying-affordances rule. The command modules import this one for the
    // transition guards, so importing them back statically is a cycle that
    // evaluates `extends`-time code — the exact bug seller-profile hit. They
    // are loaded dynamically inside the click instead, where the cycle cannot
    // exist because the click happens after every module has evaluated.
    @tracked private acting: string | undefined;
    @tracked private actionError: string | undefined;

    get isBusy() {
      return Boolean(this.acting);
    }

    get commandContext() {
      return this.args.context?.commandContext;
    }

    get canProcessPayment() {
      return canOrderTransition(this.args.model?.orderStatus, 'paid');
    }

    get canDispatch() {
      return canOrderTransition(this.args.model?.orderStatus, 'shipped');
    }

    get canRefund() {
      return canOrderTransition(this.args.model?.orderStatus, 'refunded');
    }

    private runAction = async (name: string, make: () => Promise<unknown>) => {
      if (this.acting || !this.commandContext) {
        return;
      }
      this.acting = name;
      this.actionError = undefined;
      try {
        await make();
      } catch (e: any) {
        // Render at the action, not in a toast — the reader must see which
        // move failed and why, next to the button that made it.
        this.actionError = e?.message ?? String(e);
      } finally {
        this.acting = undefined;
      }
    };

    processPayment = () =>
      this.runAction('pay', async () => {
        let { default: ProcessPaymentCommand } = await import(
          './process-payment-command'
        );
        await new ProcessPaymentCommand(this.commandContext!).execute({
          orderId: this.args.model?.id,
        } as any);
      });

    dispatchShipment = () =>
      this.runAction('ship', async () => {
        let { default: DispatchShipmentCommand } = await import(
          './sole-vault-dispatch-shipment-command'
        );
        await new DispatchShipmentCommand(this.commandContext!).execute({
          orderId: this.args.model?.id,
        } as any);
      });

    refundOrder = () =>
      this.runAction('refund', async () => {
        let { default: RefundOrderCommand } = await import(
          './refund-order-command'
        );
        await new RefundOrderCommand(this.commandContext!).execute({
          orderId: this.args.model?.id,
        } as any);
      });

    <template>
      <article class='card'>
        <header class='hero'>
          <div class='hero-head'>
            <h1 class='hero-title'>{{if
                @model.productTitle
                @model.productTitle
                'Unlinked listing'
              }}</h1>

            <p class='hero-sub'>
              <ReceiptIcon
                width='max(12px, 0.9em)'
                height='max(12px, 0.9em)'
                aria-hidden='true'
              />
              {{#if @model.reference}}
                <span class='ref'>{{@model.reference}}</span>
              {{/if}}
              {{#if @model.sellerName}}
                <span class='sep'>·</span>
                <span class='party'>from
                  <strong>{{@model.sellerName}}</strong></span>
              {{/if}}
              {{#if @model.buyerName}}
                <span class='sep'>·</span>
                <span class='party'>to
                  <strong>{{@model.buyerName}}</strong></span>
              {{/if}}
            </p>
          </div>

          {{! THE PLAQUE — the total is the dominant element, with the escrow
              state beside it as the thing that qualifies it. Two facts, and the
              money is the loud one. }}
          <div class='answer'>
            <p class='total'>{{if this.total this.total '—'}}</p>
            <div class='answer-meta'>
              {{#if @model.orderStatus}}
                <@fields.orderStatus @format='embedded' />
              {{/if}}
              {{#if @model.fundsHeld}}
                <p class='held'>
                  <LockIcon
                    width='max(12px, 0.85em)'
                    height='max(12px, 0.85em)'
                    aria-hidden='true'
                  />
                  Funds held in escrow
                </p>
              {{/if}}
            </div>
          </div>
        </header>

        {{! AT A GLANCE — shape: ol. The escrow rail, the family signature. }}
        <section class='sec'>
          <h2><CalendarIcon class='sec-icon' aria-hidden='true' />Escrow
            progress</h2>
          <ol class='steps'>
            {{#each this.steps as |s|}}
              <li class='step {{if s.done "step--done"}}'>
                <span class='step-label'>{{s.label}}</span>
              </li>
            {{/each}}
          </ol>
          {{! ACTIONS — real commands, state-machine gated, only in an
              interactive render. Each button IS one of the ten spec tools. }}
          {{#if this.commandContext}}
            <div class='actions'>
              {{#if this.canProcessPayment}}
                <Button
                  @kind='primary'
                  @size='small'
                  @loading={{eq this.acting 'pay'}}
                  @disabled={{this.isBusy}}
                  {{on 'click' this.processPayment}}
                >Process payment</Button>
              {{/if}}
              {{#if this.canDispatch}}
                <Button
                  @kind='primary'
                  @size='small'
                  @loading={{eq this.acting 'ship'}}
                  @disabled={{this.isBusy}}
                  {{on 'click' this.dispatchShipment}}
                >Dispatch shipment</Button>
              {{/if}}
              {{#if this.canRefund}}
                <Button
                  @kind='secondary'
                  @size='small'
                  @loading={{eq this.acting 'refund'}}
                  @disabled={{this.isBusy}}
                  {{on 'click' this.refundOrder}}
                >Refund order</Button>
              {{/if}}
            </div>
            {{#if this.actionError}}
              <p class='action-err' role='alert'>
                <AlertTriangleIcon width='14' height='14' aria-hidden='true' />
                {{this.actionError}}
              </p>
            {{/if}}
          {{/if}}
          {{#if this.allowedNext.length}}
            {{! Text, not buttons — these moves have no command of their own;
                see `allowedNext`. }}
            <p class='next'>
              <span class='next-k'>Permitted next</span>
              {{! `label` is optional on StatusOption, so fall back to the raw
                  value rather than rendering nothing. }}
              {{#each this.allowedNext as |n|}}
                <span class='next-v'>{{if n.label n.label n.value}}</span>
              {{/each}}
            </p>
          {{/if}}
        </section>

        <div class='cols'>
          {{! DETAIL — shape: dl. The receipt. Every amount through the one
              formatter so minor units survive, and the total is visually a step
              above its components rather than a fifth row. }}
          <section class='sec'>
            <h2><CoinsIcon class='sec-icon' aria-hidden='true' />Receipt</h2>
            <dl class='receipt'>
              <div class='r-row'>
                <dt>Item</dt>
                <dd>{{if this.itemPrice this.itemPrice '—'}}</dd>
              </div>
              <div class='r-row'>
                <dt>Shipping</dt>
                <dd>{{if this.shipping this.shipping '—'}}</dd>
              </div>
              <div class='r-row'>
                <dt>Authentication</dt>
                <dd>{{if this.authFee this.authFee '—'}}</dd>
              </div>
              <div class='r-row'>
                <dt>Platform fee</dt>
                <dd>{{if this.platformFee this.platformFee '—'}}</dd>
              </div>
              <div class='r-row r-row--total'>
                <dt>Total</dt>
                <dd>{{if this.total this.total '—'}}</dd>
              </div>
            </dl>
            <p class='receipt-note'>Fees are the amounts charged, not rates —
              re-deriving them would rewrite this receipt if the rate ever
              changed.</p>
          </section>

          {{! DETAIL — shape: linked cards. A different shape from the dl beside
              it, and the answer to "what happens next". }}
          <section class='sec'>
            <h2><PackageIcon
                class='sec-icon'
                aria-hidden='true'
              />Shipments<span
                class='count'
              >{{this.shipments.length}}</span></h2>

            {{#if this.shipmentsError}}
              <p class='err'>
                <AlertTriangleIcon
                  width='18'
                  height='18'
                  aria-hidden='true'
                />Could not load shipments.
              </p>
            {{else if this.shipmentsLoading}}
              <p class='wait'><LoadingIndicator />Looking for shipments…</p>
            {{else if this.shipments.length}}
              <ul class='links'>
                {{! getCards instances are bare card instances with NO
                    `.component` property — rendering `s.component` silently
                    yields an empty row. getComponent(card) is the API. }}
                {{#each this.shipments as |s|}}
                  <li>{{#let (getComponent s) as |ShipmentCard|}}
                      <ShipmentCard @format='embedded' />
                    {{/let}}</li>
                {{/each}}
              </ul>
            {{else}}
              <p class='empty'>
                <PackageIcon width='18' height='18' aria-hidden='true' />Nothing
                shipped yet. The seller ships to the authenticator first, not to
                the buyer.
              </p>
            {{/if}}
          </section>
        </div>

        {{! DETAIL — shape: linked cards again, but this is the money ledger and
            it earns its own full-width row: a partial refund is the case where
            several rows matter at once. }}
        <section class='sec'>
          <h2><CreditCardIcon
              class='sec-icon'
              aria-hidden='true'
            />Payments<span class='count'>{{this.payments.length}}</span></h2>

          {{#if this.paymentsError}}
            <p class='err'>
              <AlertTriangleIcon
                width='18'
                height='18'
                aria-hidden='true'
              />Could not load payments.
            </p>
          {{else if this.paymentsLoading}}
            <p class='wait'><LoadingIndicator />Looking for payments…</p>
          {{else if this.payments.length}}
            <ul class='links'>
              {{#each this.payments as |p|}}
                <li>{{#let (getComponent p) as |PaymentCard|}}
                    <PaymentCard @format='embedded' />
                  {{/let}}</li>
              {{/each}}
            </ul>
          {{else}}
            <p class='empty'>
              <CreditCardIcon width='18' height='18' aria-hidden='true' />No
              payment recorded. Nothing is held.
            </p>
          {{/if}}
        </section>
      </article>

      <style scoped>

        /* Rule 1: an isolated card gets NO host container — every ancestor
           reports `container-type: normal` — so this template declares its own,
           NAMED, or every @container rule below is inert CSS. `inline-size`, not
           `size`: this column scrolls and `size` needs a definite block size. */
        .card {
          container-type: inline-size;
          container-name: card;
          width: 100%;
          height: 100%;
          overflow-y: auto;

          /* Literal Sole Vault palette — same names and values as the app
             shell, so the family reads as one continuous surface. */
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
                    --font-mono: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;

          background: var(--ink-900);
          background-image: radial-gradient(
            ellipse 1200px 640px at 15% -10%,
            var(--ink-800) 0%,
            transparent 60%
          );
          color: var(--paper);
          font-family: var(--font-sans, 'Inter', system-ui, -apple-system, sans-serif);
          padding: 1.75rem;
          /* ONE rhythm mechanism — the parent's gap. No child margin-top, so
             there is no override to undo it. */
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
          box-sizing: border-box;

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

        /* ---------- hero ---------- */
        .hero {
          display: flex;
          flex-wrap: wrap;
          align-items: flex-end;
          justify-content: space-between;
          gap: 1.25rem;
        }
        .hero-head {
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 0.4rem;
        }
        .hero-title {
          margin: 0;
          font-family: var(--font-display);
          font-size: clamp(1.5rem, 1.1rem + 1.6cqi, 2rem);
          line-height: 1.15;
          font-weight: 700;
          letter-spacing: -0.01em;
        }
        .hero-sub {
          margin: 0;
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 0.45em;
          font-size: 0.8125rem;
          color: var(--smoke);
        }
        .sep {
          opacity: 0.6;
        }
        /* An order reference is quoted into support threads and emails: mono,
           tabular, and never truncated. */
        .ref {
          font-family: var(--font-mono);
          font-variant-numeric: tabular-nums;
          letter-spacing: 0.04em;
          white-space: nowrap;
          color: var(--paper);
        }
        .party strong {
          color: var(--paper);
          font-weight: 600;
        }

        /* THE VAULT PLAQUE — gold hairline over the headline figure, the same
           mark as CollectionItem's worth and AuthenticationRecord's verdict. */
        .answer {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 0.3rem;
          border-top: 1px solid
            color-mix(in oklch, var(--gold) 45%, transparent);
          padding-top: 0.6rem;
        }
        /* The dominant element: hero figure against an 0.875rem body. */
        .total {
          margin: 0;
          font-family: var(--font-display);
          color: var(--gold-ink, var(--gold));
          font-size: clamp(2.25rem, 1.4rem + 3.5cqi, 2.75rem);
          line-height: 1.05;
          font-weight: 900;
          font-variant-numeric: tabular-nums;
          letter-spacing: -0.02em;
        }
        .answer-meta {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 0.6rem;
        }
        .held {
          margin: 0;
          display: inline-flex;
          align-items: center;
          gap: 0.35em;
          font-size: 0.6875rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--smoke);
        }

        /* ---------- the one panel primitive ---------- */
        .sec {
          background: var(--ink-800);
          padding: 1rem 1.25rem 1.35rem;
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
          font-size: 0.6875rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.09em;
          color: var(--smoke);
        }
        /* Rule 5: section icons are muted and identical in size across every
           header — one loud thing per card, and it is the total. */
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
          /* Content-sized, not 1fr 1fr: a dl of short rows and a list of linked
             cards should not be forced to equal widths. */
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          gap: 1.5rem;
        }

        /* ---------- escrow rail (signature) ---------- */
        .steps {
          list-style: none;
          margin: 0;
          padding: 0 0 0 1.25rem;
          border-left: 2px solid var(--hairline);
          display: grid;
          gap: 0.6rem;
        }
        .step {
          position: relative;
          font-size: 0.875rem;
          color: var(--smoke);
          transition: color 180ms cubic-bezier(0.16, 1, 0.3, 1);
        }
        .step::before {
          content: '';
          position: absolute;
          left: calc(-1.25rem - 6px);
          top: 0.4em;
          width: 9px;
          height: 9px;
          border-radius: 50%;
          background: var(--ink-700);
          border: 2px solid var(--ink-800);
          transition: background 180ms cubic-bezier(0.16, 1, 0.3, 1);
        }
        /* A reached milestone is a vault mark — gold, matching the provenance
           rail on CollectionItem. */
        .step--done::before {
          background: var(--gold);
        }
        .step--done {
          color: var(--paper);
          font-weight: 600;
        }
        /* The action row: gold primary buttons through Button's own knobs —
           the semantic set pinned at .card is what these resolve from. */
        .actions {
          margin-top: 1rem;
          display: flex;
          flex-wrap: wrap;
          gap: 0.6rem;
        }
        .action-err {
          margin: 0.6rem 0 0;
          display: flex;
          align-items: center;
          gap: 0.45em;
          font-size: 0.8125rem;
          color: var(--destructive, oklch(0.577 0.245 27.32));
        }
        .next {
          margin: 1rem 0 0;
          display: flex;
          flex-wrap: wrap;
          align-items: baseline;
          gap: 0.6rem;
          font-size: 0.8125rem;
        }
        .next-k {
          font-size: 0.6875rem;
          text-transform: uppercase;
          letter-spacing: 0.07em;
          color: var(--smoke);
        }
        .next-v {
          font-weight: 600;
          color: var(--paper);
        }

        /* ---------- receipt ---------- */
        .receipt {
          display: grid;
          gap: 0.55rem;
          margin: 0;
        }
        .r-row {
          display: flex;
          flex-wrap: wrap;
          align-items: baseline;
          justify-content: space-between;
          gap: 0.6rem;
          font-size: 0.875rem;
        }
        .r-row dt {
          font-size: 0.6875rem;
          text-transform: uppercase;
          letter-spacing: 0.07em;
          color: var(--smoke);
        }
        .r-row dd {
          margin: 0;
          font-weight: 600;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
          color: var(--paper);
        }
        /* The total steps ABOVE its components rather than reading as a fifth
           row of the same weight. */
        .r-row--total {
          border-top: 1px solid var(--hairline);
          padding-top: 0.6rem;
        }
        .r-row--total dd {
          font-family: var(--font-display);
          font-size: 1.25rem;
          font-weight: 700;
          color: var(--gold-ink, var(--gold));
        }
        .receipt-note {
          margin: 0.75rem 0 0;
          font-size: 0.75rem;
          line-height: 1.45;
          color: var(--smoke);
        }

        /* ---------- linked-card lists ---------- */
        .links {
          list-style: none;
          margin: 0;
          padding: 0;
          display: grid;
          gap: 0.6rem;
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
          color: var(--destructive, oklch(0.704 0.191 22.216));
        }

        @media (prefers-reduced-motion: reduce) {
          .step,
          .step::before {
            transition: none;
          }
        }

        /* Rule 1: these fire because .card declares the container above. */
        @container card (width < 700px) {
          .cols {
            grid-template-columns: 1fr;
          }
          .hero {
            flex-direction: column;
            align-items: flex-start;
          }
        }
      </style>
    </template>
  };

  // FITTED — hand-rolled, and this is the one card in the family where that
  // fork is right rather than lazy.
  //
  // Order has NO image field, and its anchor is a FIGURE, not a title: the
  // reader scanning an Orders grid is looking for the amount and the state, not
  // the product name. FittedCard's slot model makes the title the loud element,
  // so bending it to put a 2× gold serif number in the footer would fight the
  // component the whole way. The isolated view already established the plaque
  // idiom for exactly this figure, so the tile reuses it.
  //
  // SLOT DISCIPLINE — four distinct facts, four slots, zero repeats:
  //   reference (head) · total (anchor) · productTitle (body) · status (meta)
  // Nothing is printed twice, and no slot is padded with a value already shown.
  static fitted = class Fitted extends Component<typeof Order> {
    get total() {
      return formatMoney(this.args.model?.total);
    }

    <template>
      <div class='fit'>
        <div class='r-head'>
          <ReceiptIcon class='glyph' aria-hidden='true' />
          {{#if @model.reference}}
            <span class='ref'>{{@model.reference}}</span>
          {{/if}}
        </div>

        <div class='r-body'>
          {{! THE ANCHOR — the total, decisively the loudest thing at every one
              of the 16 sizes. Data is all-or-nothing: a money value is never
              ellipsised, so this is nowrap and the whole row is hidden at the
              quanta where it cannot fit. }}
          <p class='total'>{{if this.total this.total '—'}}</p>
          <p class='title'>{{if
              @model.productTitle
              @model.productTitle
              'Unlinked listing'
            }}</p>
        </div>

        <div class='r-meta'>
          {{#if @model.orderStatus}}
            <@fields.orderStatus @format='atom' />
          {{/if}}
        </div>
      </div>

      <style scoped>

        /* NO container-type / container-name anywhere — the HOST wrapper
           declares `container-type: size; container-name: fitted-card`, and
           declaring one here would capture those queries and leave every rule
           below inert. */
        .fit {
          width: 100%;
          height: 100%;
          display: grid;
          /* Text rows are auto; only the body flexes. A fixed height on a text
             row under overflow:hidden is what shears type through the middle of
             its letters. */
          grid-template-rows: auto minmax(0, 1fr) auto;
          grid-template-areas: 'head' 'body' 'meta';
          gap: 0.2rem;

          --card: oklch(1 0 0);

          --card-foreground: oklch(0.147 0.004 49.25);

          --background: oklch(0.985 0.001 106.42);

          --border: oklch(0.869 0.005 56.37);

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

          /* ONE type scale for the template, and the cap is on --type-base
             ITSELF rather than per role. A per-role cqb cap never binds in a
             wide+short cell: cqb is tiny there, so the cap sits far above what
             the cqi term produces and the row shears anyway. Capping the base
             at 10cqb fixes every role at once, and tall cells are unchanged
             because the cqi term still governs there — min() only bites when
             the cell is short.
             Plain multipliers rather than pow(): the requirement is one derived
             scale with no stepped font-size blocks, and multipliers satisfy it
             without depending on CSS pow() support.
             (The skill's formula carries an aspect-ratio correction term; it is
             omitted here because CSS cannot compute an aspect ratio from
             container units, and the cqb cap is what actually prevents the
             shear.) */
          --type-base: clamp(10px, min(calc(3px + 2.1cqi + 1cqb), 10cqb), 17px);

          background: var(--ink-800);
          color: var(--paper);
          font-family: var(--font-sans, 'Inter', system-ui, -apple-system, sans-serif);
          padding: 0.5rem 0.75rem;
          box-sizing: border-box;
          /* The family's miniature vault plaque — inset gold edge, not a border,
             because the host draws the chrome. */
          box-shadow: inset 2px 0 0 0 var(--gold);
          overflow: hidden;
        }

        .r-head {
          grid-area: head;
          min-height: 0;
          overflow: hidden;
          display: flex;
          align-items: center;
          gap: 0.4em;
        }
        /* Rule 2: the glyph identifies, it does not compete — and it is the
           card's OWN static icon, the same one its isolated view uses. */
        .glyph {
          width: max(12px, 1em);
          height: max(12px, 1em);
          color: var(--gold-ink, var(--gold));
          flex: none;
        }
        /* An order reference is quoted into support threads: mono, tabular, and
           never ellipsised. It is hidden whole at the narrowest quanta. */
        .ref {
          font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;
          font-size: max(9px, calc(var(--type-base) * 0.8));
          line-height: 1.25;
          font-variant-numeric: tabular-nums;
          letter-spacing: 0.04em;
          color: var(--smoke);
          white-space: nowrap;
          overflow: hidden;
        }

        .r-body {
          grid-area: body;
          min-height: 0;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 0.1em;
        }
        /* THE ANCHOR: 1.75× the base, gold display serif — the same figure
           treatment as the isolated plaque and the money values on the sibling
           tiles. line-height 1.15 so descenders survive at the floor. */
        .total {
          margin: 0;
          font-family: 'Playfair Display', Georgia, serif;
          color: var(--gold-ink, var(--gold));
          font-size: calc(var(--type-base) * 1.75);
          line-height: 1.15;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          letter-spacing: -0.01em;
          white-space: nowrap;
        }
        /* Quiet by contrast, so the figure wins by more than size alone. */
        .title {
          margin: 0;
          font-size: var(--type-base);
          line-height: 1.25;
          font-weight: 600;
          color: var(--paper);
          /* Clamped at a LINE boundary with an ellipsis — never half a letter. */
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;
          overflow: hidden;
        }

        .r-meta {
          grid-area: meta;
          min-height: 0;
          overflow: hidden;
          display: flex;
          align-items: center;
        }

        /* ---- quanta: structure and visibility only; the scale never steps ---- */

        /* Badge tier (h <= 50): the figure is the only survivor. For an order
           the amount is the identity — a status pill without a number tells the
           reader nothing they can act on. */
        @container fitted-card (height <= 50px) {
          .fit {
            grid-template-rows: 1fr;
            padding: var(--boxel-sp-4xs) var(--boxel-sp-xxs);
          }
          .r-head,
          .r-meta {
            display: none;
          }
          .title {
            display: none;
          }
        }

        /* Strip tier (50–80): the status comes back, the product name does not —
           two text rows plus the figure would exceed the block budget. */
        @container fitted-card (height > 50px) and (height <= 80px) {
          .title {
            display: none;
          }
        }

        /* Thin body (80–130): one line of product name rather than two. */
        @container fitted-card (height > 80px) and (height <= 130px) {
          .title {
            -webkit-line-clamp: 1;
          }
        }

        /* Narrow cells: the reference is dropped WHOLE rather than truncated to
           a meaningless stub, and the glyph goes with it so the row does not sit
           there holding only decoration. */
        @container fitted-card (width <= 150px) {
          .r-head {
            display: none;
          }
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof Order> {
    get total() {
      return formatMoney(this.args.model?.total);
    }

    <template>
      <span class='o-atom'>
        <span class='o-ref'>{{if @model.reference @model.reference '—'}}</span>
        {{#if this.total}}<span class='o-total'>{{this.total}}</span>{{/if}}
      </span>
      <style scoped>
        .o-atom {
          display: inline-flex;
          align-items: baseline;
          gap: 0.3rem;
          font-family: var(--font-sans, 'Inter', system-ui, -apple-system, sans-serif);
        }
        /* An order reference is quoted into support threads — mono, never cut. */
        .o-ref {
          font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;
          font-weight: 600;
          white-space: nowrap;
        }
        .o-total {
          font-variant-numeric: tabular-nums;
          color: var(--muted-foreground, oklch(0.709 0.01 56.26));
        }
      </style>
    </template>
  };

  // Row-shaped, for an Orders list. Trailing slots use an em-dash when empty so
  // a consumer's list column-aligns.
  static embedded = class Embedded extends Component<typeof Order> {
    get total() {
      return formatMoney(this.args.model?.total);
    }

    <template>
      <div class='o-row'>
        <span class='o-ref'>{{if @model.reference @model.reference '—'}}</span>
        <span class='o-title'>{{if
            @model.productTitle
            @model.productTitle
            'Unlinked listing'
          }}</span>
        <span class='o-status'>
          {{#if @model.orderStatus}}<@fields.orderStatus
              @format='atom'
            />{{else}}—{{/if}}
        </span>
        <span class='o-total'>{{if this.total this.total '—'}}</span>
      </div>
      <style scoped>
        /* Own inset — the host's CardContainer draws a boundary and adds NO
           padding, so without this the text sits flush against the pill. */
        .o-row {
          display: grid;
          grid-template-columns: 8rem minmax(0, 1fr) auto auto;
          gap: 0.75rem;
          align-items: center;
          padding: 0.5rem 0.75rem;
          background: var(--card, oklch(0.216 0.006 56.04));
          color: var(--foreground, oklch(0.985 0.001 106.42));
          font-family: var(--font-sans, 'Inter', system-ui, -apple-system, sans-serif);
        }
        .o-ref {
          font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;
          font-size: 0.75rem;
          font-weight: 600;
          color: var(--muted-foreground, oklch(0.709 0.01 56.26));
          white-space: nowrap;
        }
        .o-title {
          font-weight: 600;
          font-size: 0.875rem;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .o-total {
          font-family: 'Playfair Display', Georgia, serif;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          color: var(--accent, oklch(0.828 0.189 84.43));
          white-space: nowrap;
        }
        @container (width < 500px) {
          .o-row {
            grid-template-columns: minmax(0, 1fr) auto;
          }
          .o-ref,
          .o-status {
            display: none;
          }
        }
      </style>
    </template>
  };
}

export default Order;
