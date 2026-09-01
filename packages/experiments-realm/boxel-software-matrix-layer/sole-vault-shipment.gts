import {
  CardDef,
  field,
  contains,
  linksTo,
  StringField,
  Component,
} from '@cardstack/base/card-api';
import DateField from '@cardstack/base/date';
import BooleanField from '@cardstack/base/boolean';
import { statusField, canTransition, nextStatuses } from './status-field';
import { Order } from './sole-vault-order';
import PackageIcon from '@cardstack/boxel-icons/package';
import RouteIcon from '@cardstack/boxel-icons/route';
import MapPinIcon from '@cardstack/boxel-icons/map-pin';
import ReceiptIcon from '@cardstack/boxel-icons/receipt';
import AlertTriangleIcon from '@cardstack/boxel-icons/alert-triangle';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import {
  Accordion,
  Button,
  FieldContainer,
  FittedCard,
} from '@cardstack/boxel-ui/components';
import { and } from '@cardstack/boxel-ui/helpers';

// Shipment — one physical movement of one item, with its tracking.
//
// THE TWO-LEG SHAPE IS THE DOMAIN, NOT AN IMPLEMENTATION DETAIL. In an
// authenticated marketplace the item does NOT go seller → buyer. It goes
// seller → authentication centre → buyer, and those are two different shipments
// with two different tracking numbers, two carriers and two failure modes. The
// spec's user flow says exactly this ("Ships to auth center… Item ships to
// buyer"), so `leg` distinguishes them and an Order links to both.
//
// Collapsing them into one card with two tracking-number fields is the tempting
// shortcut and it breaks immediately: the inbound leg can be delivered while the
// outbound leg does not exist yet, and one status field cannot describe that.
//
// WHY THERE IS NO CARRIER API HERE. `carrier` and `trackingNumber` are recorded
// facts, and `trackingUrl` is a link a human clicks. This realm does not poll
// UPS. A command can update the status from a webhook payload someone else
// received; nothing here reaches out.

export type ShipmentLeg = 'to-authenticator' | 'to-buyer' | 'return-to-seller';

export type ShipmentStatus =
  | 'label-created'
  | 'in-transit'
  | 'delivered'
  | 'exception'
  | 'lost';

export const ShipmentStatusField = statusField({
  displayName: 'Shipment Status',
  icon: PackageIcon,
  options: [
    {
      value: 'label-created',
      label: 'Label created',
      hue: 'slate',
      meaning: 'A label exists; the carrier has not scanned the parcel yet.',
    },
    {
      value: 'in-transit',
      label: 'In transit',
      hue: 'blue',
      holds: true,
      meaning: 'Scanned and moving. Someone else physically holds the item.',
    },
    {
      value: 'delivered',
      label: 'Delivered',
      hue: 'green',
      terminal: true,
      holds: true,
      meaning: 'Arrived and signed for at this leg’s destination.',
    },
    {
      value: 'exception',
      label: 'Exception',
      hue: 'amber',
      holds: true,
      meaning:
        'The carrier reported a problem — damage, refusal, a bad address. Recoverable.',
    },
    {
      value: 'lost',
      label: 'Lost',
      hue: 'red',
      terminal: true,
      holds: true,
      meaning:
        'Written off. On a held order this is a refund trigger, not a status tidy-up.',
    },
  ],
  // `exception` is deliberately NOT terminal and NOT a dead end: most carrier
  // exceptions resolve and the parcel moves again, so it returns to
  // `in-transit`. Only `lost` and `delivered` end a leg.
  //
  // There is no edge from `delivered` to anything: a parcel that comes back is
  // the `return-to-seller` leg — a different Shipment card — not this one
  // reversing.
  transitions: {
    'label-created': ['in-transit', 'exception', 'lost'],
    'in-transit': ['delivered', 'exception', 'lost'],
    exception: ['in-transit', 'delivered', 'lost'],
    delivered: [],
    lost: [],
  },
});

export function canShipmentTransition(
  from?: string | null,
  to?: string | null,
) {
  return canTransition(ShipmentStatusField, from, to);
}

export function nextShipmentStatuses(from?: string | null) {
  return nextStatuses(ShipmentStatusField, from);
}

export class Shipment extends CardDef {
  static displayName = 'Shipment';
  static icon = PackageIcon;

  @field order = linksTo(() => Order, { searchable: true });

  // Which leg of the journey. See the header note — this is the field that
  // makes an authenticated marketplace's logistics representable at all.
  @field leg = contains(StringField);

  @field shipmentStatus = contains(ShipmentStatusField);

  @field carrier = contains(StringField);

  // An identifier a human reads aloud and types into a carrier's site: never
  // truncated in any format, in any card that renders it.
  @field trackingNumber = contains(StringField);

  // A real link the user clicks. Kept as a StringField rather than base `url`
  // deliberately: carrier tracking URLs carry query strings, and `UrlField`
  // silently drops a URL that has one — the whole field vanishes from the
  // search doc with no error. Verified local addendum, not a guess.
  @field trackingUrl = contains(StringField);

  @field shippedFrom = contains(StringField);
  @field shippedTo = contains(StringField);

  @field labelCreatedAt = contains(DateField);
  @field shippedAt = contains(DateField);
  @field deliveredAt = contains(DateField);
  @field estimatedDelivery = contains(DateField);

  // Event-fact derivation, same rule as the rest of the family.
  @field isDelivered = contains(BooleanField, {
    computeVia: function (this: Shipment) {
      return this.deliveredAt != null;
    },
  });

  // Needs attention = a carrier problem on a parcel nobody has yet resolved.
  // A queue view filters on this, so it is worth deriving once here rather than
  // re-deriving the same boolean in every consumer.
  @field needsAttention = contains(BooleanField, {
    computeVia: function (this: Shipment) {
      return this.shipmentStatus === 'exception';
    },
  });

  // --- denormalized for prerendered fitted (cannot resolve linksTo) ---
  @field orderReference = contains(StringField, {
    computeVia: function (this: Shipment) {
      return this.order?.reference ?? '';
    },
  });

  @field productTitle = contains(StringField, {
    computeVia: function (this: Shipment) {
      return this.order?.productTitle ?? this.cardInfo?.name ?? '';
    },
  });

  // Human label for the leg, derived so no consumer hand-maps the three values
  // and drifts from the others.
  @field legLabel = contains(StringField, {
    computeVia: function (this: Shipment) {
      switch (this.leg) {
        case 'to-authenticator':
          return 'To authenticator';
        case 'to-buyer':
          return 'To buyer';
        case 'return-to-seller':
          return 'Return to seller';
        default:
          return '';
      }
    },
  });

  // ISOLATED — the shipment's landing page. Instrument direction: no image
  // and no money figure, so the anchor is TYPOGRAPHIC and it is the leg, same
  // reasoning as the fitted — which journey this is decides whose problem an
  // exception is.
  //
  // Domain question: "where is the parcel, and on which journey?" The hero
  // answers both (leg + route line); the manifest strip beneath carries
  // status/carrier/tracking, and the SIGNATURE ELEMENT is the manifest rail —
  // a real tracking timeline, each stop lit from its own event DATE so it
  // cannot disagree with the dates list below it, same rule as Order's
  // escrow rail.
  static isolated = class Isolated extends Component<typeof Shipment> {
    // ---- command wiring ----
    // One real action: Mark delivered — the spec tool that closes a leg and
    // advances the linked Order (leg-aware; see mark-delivered-command.ts).
    // Rendered only when a command context exists AND the state machine
    // permits `→ delivered`, per the no-lying-affordances rule. The command
    // module imports this one for `canShipmentTransition`, so it is loaded
    // dynamically inside the click — a static import back would be a cycle
    // that evaluates `extends`-time code (the seller-profile bug).
    @tracked private acting = false;
    @tracked private actionError: string | undefined;

    get commandContext() {
      return this.args.context?.commandContext;
    }

    get canMarkDelivered() {
      return canShipmentTransition(
        this.args.model?.shipmentStatus,
        'delivered',
      );
    }

    markDelivered = async () => {
      if (this.acting || !this.commandContext) {
        return;
      }
      this.acting = true;
      this.actionError = undefined;
      try {
        let { default: MarkDeliveredCommand } = await import(
          './mark-delivered-command'
        );
        await new MarkDeliveredCommand(this.commandContext).execute({
          shipmentId: this.args.model?.id,
        } as any);
      } catch (e: any) {
        this.actionError = e?.message ?? String(e);
      } finally {
        this.acting = false;
      }
    };

    <template>
      <article class='card'>
        <header class='hero'>
          {{! No kicker above the heading — the leg IS the heading. }}
          <h1 class='hero-title'>{{if
              @model.legLabel
              @model.legLabel
              'Shipment'
            }}</h1>

          {{#if @model.shippedFrom}}
            <p class='route'>
              <span class='route-end'>{{@model.shippedFrom}}</span>
              <RouteIcon class='route-arrow' aria-hidden='true' />
              <span class='route-end'>{{if
                  @model.shippedTo
                  @model.shippedTo
                  '…'
                }}</span>
            </p>
          {{/if}}

          {{#if @model.productTitle}}
            <p class='hero-sub'>{{@model.productTitle}}</p>
          {{/if}}
        </header>

        {{! THE MANIFEST — status, carrier, tracking and ETA together, as one
            stamped plaque rather than scattered field rows. Real gold surface,
            not a hairline accent. }}
        <section class='manifest'>
          <div class='manifest-status'>
            {{#if @model.shipmentStatus}}
              <@fields.shipmentStatus @format='embedded' />
            {{/if}}
            {{#if @model.needsAttention}}
              <p class='attn'>
                <AlertTriangleIcon
                  width='max(13px, 0.9em)'
                  height='max(13px, 0.9em)'
                  aria-hidden='true'
                />
                Needs attention
              </p>
            {{/if}}
          </div>

          <div class='manifest-grid'>
            <div class='m-cell'>
              <span class='m-k'>Carrier</span>
              <span class='m-v'>{{if @model.carrier @model.carrier '—'}}</span>
            </div>
            <div class='m-cell m-cell--wide'>
              <span class='m-k'>Tracking number</span>
              {{! Read aloud and typed into a carrier's site: mono, whole. }}
              <span class='m-v mono'>{{if
                  @model.trackingNumber
                  @model.trackingNumber
                  '—'
                }}</span>
            </div>
            <div class='m-cell'>
              <span class='m-k'>Estimated delivery</span>
              <span class='m-v'>{{#if @model.estimatedDelivery}}<@fields.estimatedDelivery
                    @format='atom'
                  />{{else}}—{{/if}}</span>
            </div>
          </div>

          {{#if (and this.commandContext this.canMarkDelivered)}}
            <div class='actions'>
              <Button
                @kind='primary'
                @size='small'
                @loading={{this.acting}}
                @disabled={{this.acting}}
                {{on 'click' this.markDelivered}}
              >Mark delivered</Button>
            </div>
            {{#if this.actionError}}
              <p class='action-err' role='alert'>
                <AlertTriangleIcon width='14' height='14' aria-hidden='true' />
                {{this.actionError}}
              </p>
            {{/if}}
          {{/if}}

          {{#if @model.trackingUrl}}
            <a
              href={{@model.trackingUrl}}
              target='_blank'
              rel='noopener noreferrer'
              class='track-btn'
            >Track with the carrier ↗</a>
          {{else}}
            <p class='facts-note'>No tracking link recorded — this realm does
              not poll carriers; a command records what a webhook reported.</p>
          {{/if}}
        </section>

        {{! THE SIGNATURE ELEMENT — a real tracking rail, each stop lit from
            its own event date (rendered through the card's own date field, so
            it cannot disagree with the manifest above), dated inline rather
            than a bare checklist. }}
        <section class='rail-wrap'>
          <h2 class='rail-h'>Tracking history</h2>
          <ol class='rail'>
            <li class='stop {{if @model.labelCreatedAt "stop--done"}}'>
              <span class='stop-dot' aria-hidden='true'>
                <ReceiptIcon width='13' height='13' aria-hidden='true' />
              </span>
              <span class='stop-label'>Label created</span>
              <span class='stop-when'>{{#if @model.labelCreatedAt}}
                  <@fields.labelCreatedAt @format='atom' />
                {{else}}
                  pending
                {{/if}}</span>
            </li>
            <li class='stop {{if @model.shippedAt "stop--done"}}'>
              <span class='stop-dot' aria-hidden='true'>
                <RouteIcon width='13' height='13' aria-hidden='true' />
              </span>
              <span class='stop-label'>In transit</span>
              <span class='stop-when'>{{#if @model.shippedAt}}
                  <@fields.shippedAt @format='atom' />
                {{else}}
                  pending
                {{/if}}</span>
            </li>
            <li class='stop {{if @model.deliveredAt "stop--done"}}'>
              <span class='stop-dot' aria-hidden='true'>
                <MapPinIcon width='13' height='13' aria-hidden='true' />
              </span>
              <span class='stop-label'>Delivered</span>
              <span class='stop-when'>{{#if @model.deliveredAt}}
                  <@fields.deliveredAt @format='atom' />
                {{else}}
                  pending
                {{/if}}</span>
            </li>
          </ol>
        </section>

        <section class='order-sec'>
          <h2 class='order-h'><ReceiptIcon
              class='order-icon'
              aria-hidden='true'
            />Order</h2>
          {{#if @model.order}}
            <div class='order-embed'><@fields.order @format='embedded' /></div>
          {{else}}
            <p class='empty'>
              <ReceiptIcon width='18' height='18' aria-hidden='true' />No
              order linked.
            </p>
          {{/if}}
        </section>
      </article>

      <style scoped>

        /* Rule 1: isolated gets NO host container — declare our own, named. */
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
          background-image: radial-gradient(
            ellipse 1100px 560px at 12% -12%,
            var(--ink-800) 0%,
            transparent 60%
          );
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

        /* ---------- hero: no kicker, the leg is the heading itself ---------- */
        .hero-title {
          margin: 0;
          font-family: var(--font-display);
          font-size: clamp(1.75rem, 1.2rem + 2cqi, 2.75rem);
          line-height: 1.05;
          font-weight: 900;
          letter-spacing: -0.01em;
        }
        .route {
          margin: 0.5rem 0 0;
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 0.5rem;
          font-size: 1rem;
          font-weight: 600;
        }
        .route-end {
          color: var(--paper);
        }
        .route-arrow {
          width: max(14px, 1em);
          height: max(14px, 1em);
          color: var(--gold-ink, var(--gold));
          flex: none;
        }
        .hero-sub {
          margin: 0.35rem 0 0;
          font-size: 0.875rem;
          color: var(--smoke);
        }

        /* ---------- manifest: real gold surface, the family's plaque ---------- */
        .manifest {
          background: var(--ink-800);
          border: 1px solid var(--hairline);
          border-top: 3px solid var(--gold);
          border-radius: 6px;
          padding: 1.25rem 1.5rem;
          box-shadow: var(--shadow-1);
          display: grid;
          gap: 1rem;
        }
        .manifest-status {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 0.75rem;
        }
        .attn {
          margin: 0;
          display: inline-flex;
          align-items: center;
          gap: 0.4em;
          font-size: 0.75rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--gold-ink, var(--gold));
        }
        .manifest-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 1rem;
          border-top: 1px solid var(--hairline);
          padding-top: 1rem;
        }
        .m-cell {
          display: grid;
          gap: 0.3rem;
          min-width: 0;
        }
        .m-k {
          font-size: 0.6875rem;
          text-transform: uppercase;
          letter-spacing: 0.07em;
          color: var(--smoke);
        }
        .m-v {
          font-size: 1rem;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          color: var(--paper);
        }
        .mono {
          font-family: var(--font-mono);
          white-space: nowrap;
          overflow-x: auto;
        }
        .facts-note {
          margin: 0;
          font-size: 0.8125rem;
          line-height: 1.45;
          color: var(--smoke);
        }
        .actions {
          display: flex;
          flex-wrap: wrap;
          gap: 0.6rem;
        }
        .action-err {
          margin: 0;
          display: flex;
          align-items: center;
          gap: 0.45em;
          font-size: 0.8125rem;
          color: var(--destructive, oklch(0.577 0.245 27.32));
        }
        .track-btn {
          justify-self: start;
          display: inline-flex;
          align-items: center;
          gap: 0.4em;
          padding: 0.6rem 1.1rem;
          border-radius: 8px;
          background: var(--gold);
          color: var(--ink-950);
          font-weight: 700;
          font-size: 0.875rem;
          text-decoration: none;
          box-shadow: var(--shadow-1);
          transition:
            transform 180ms cubic-bezier(0.16, 1, 0.3, 1),
            box-shadow 180ms cubic-bezier(0.16, 1, 0.3, 1),
            background 180ms ease-out;
        }
        .track-btn:hover {
          background: var(--gold-bright);
          transform: translateY(-3px);
          box-shadow: var(--shadow-2);
        }
        @media (prefers-reduced-motion: reduce) {
          .track-btn {
            transition: none;
          }
          .track-btn:hover {
            transform: none;
          }
        }

        /* ---------- the signature element: the tracking rail ---------- */
        .rail-wrap {
          min-width: 0;
        }
        .rail-h {
          margin: 0 0 1rem;
          font-family: var(--font-display);
          font-size: 1.375rem;
          font-weight: 700;
          letter-spacing: -0.01em;
        }
        .rail {
          list-style: none;
          margin: 0;
          padding: 0;
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 0;
          position: relative;
        }
        .stop {
          position: relative;
          display: grid;
          justify-items: center;
          gap: 0.5rem;
          text-align: center;
          padding-top: 0.25rem;
        }
        /* the connecting line, drawn once behind every stop */
        .stop::before {
          content: '';
          position: absolute;
          top: 1.05rem;
          left: -50%;
          width: 100%;
          height: 2px;
          background: var(--hairline);
        }
        .stop:first-child::before {
          content: none;
        }
        .stop--done::before {
          background: var(--gold);
        }
        .stop-dot {
          position: relative;
          z-index: 1;
          display: grid;
          place-items: center;
          width: 2.1rem;
          height: 2.1rem;
          border-radius: 50%;
          background: var(--ink-800);
          border: 2px solid var(--hairline);
          color: var(--smoke);
        }
        .stop--done .stop-dot {
          background: var(--gold);
          border-color: var(--gold-ink, var(--gold));
          color: var(--ink-950);
        }
        .stop-label {
          font-size: 0.875rem;
          font-weight: 700;
          color: var(--smoke);
        }
        .stop--done .stop-label {
          color: var(--paper);
        }
        .stop-when {
          font-size: 0.75rem;
          font-variant-numeric: tabular-nums;
          color: var(--smoke);
        }

        /* ---------- order: an open list, deliberately NOT a boxed panel —
           the rail above already earns the family's one heavy shape here ---------- */
        .order-sec {
          border-top: 1px solid var(--hairline);
          padding-top: 1.25rem;
        }
        .order-h {
          margin: 0 0 0.85rem;
          display: flex;
          align-items: center;
          gap: 0.5em;
          font-family: var(--font-display);
          font-size: 1.125rem;
          font-weight: 700;
        }
        .order-icon {
          width: max(15px, 1em);
          height: max(15px, 1em);
          color: var(--gold-ink, var(--gold));
          flex: none;
        }
        .order-embed {
          border-radius: 10px;
          overflow: hidden;
          box-shadow: var(--shadow-1);
        }
        .empty {
          margin: 0;
          display: flex;
          align-items: center;
          gap: 0.5em;
          font-size: 0.8125rem;
          line-height: 1.45;
          color: var(--smoke);
        }

        @container card (width < 640px) {
          .manifest-grid {
            grid-template-columns: 1fr;
          }
          .rail {
            grid-template-columns: 1fr;
            gap: 1rem;
          }
          .stop {
            grid-template-columns: auto 1fr auto;
            justify-items: start;
            text-align: left;
            display: grid;
            align-items: center;
          }
          .stop::before {
            top: -0.5rem;
            left: 1.05rem;
            width: 2px;
            height: 0.5rem;
          }
        }
      </style>
    </template>
  };

  // EDIT — twelve editable fields, grouped.
  //
  // `leg` is the field this form exists to get right. It is a free string with
  // exactly three accepted values, none of them discoverable from the input, and
  // it is what makes an authenticated marketplace's logistics representable at
  // all — so the accepted literals are spelled out rather than left to a guess
  // and a rejected save.
  static edit = class Edit extends Component<typeof Shipment> {
    @tracked routeOpen = true;
    @tracked datesOpen = false;

    toggleRoute = () => (this.routeOpen = !this.routeOpen);
    toggleDates = () => (this.datesOpen = !this.datesOpen);

    <template>
      <div class='sh-edit'>
        <header class='se-head'>
          <FieldContainer @label='Order' @tag='label' @vertical={{true}}>
            <@fields.order />
          </FieldContainer>

          <div class='se-identity'>
            <FieldContainer @label='Leg' @tag='label' @vertical={{true}}>
              <@fields.leg />
              <p class='se-help'>One of
                <code>to-authenticator</code>,
                <code>to-buyer</code>
                or
                <code>return-to-seller</code>. Each leg is its own card: an item
                goes seller → authenticator → buyer, and those journeys have
                different carriers and different failure modes.</p>
            </FieldContainer>
            <FieldContainer @label='Status' @tag='label' @vertical={{true}}>
              <@fields.shipmentStatus />
              <p class='se-help'>An exception can return to in-transit — most
                resolve. Only delivered and lost end a leg.</p>
            </FieldContainer>
          </div>
        </header>

        <Accordion class='se-sections' @displayContainer={{false}} as |A|>
          <A.Item
            @id='route'
            @isOpen={{this.routeOpen}}
            @onClick={{this.toggleRoute}}
          >
            <:title>Carrier &amp; route</:title>
            <:content>
              <div class='se-body se-grid-2'>
                <FieldContainer
                  @label='Carrier'
                  @tag='label'
                  @vertical={{true}}
                >
                  <@fields.carrier />
                </FieldContainer>
                <FieldContainer
                  @label='Tracking number'
                  @tag='label'
                  @vertical={{true}}
                >
                  <@fields.trackingNumber />
                  <p class='se-help'>Gets read aloud and typed into a carrier’s
                    site, so it is never truncated anywhere it renders.</p>
                </FieldContainer>
                <FieldContainer
                  @label='Tracking URL'
                  @tag='label'
                  @vertical={{true}}
                >
                  <@fields.trackingUrl />
                  <p class='se-help'>A plain string on purpose — carrier URLs
                    carry query strings, and a URL field silently drops those,
                    taking the whole value out of the search index with it.</p>
                </FieldContainer>
                <FieldContainer
                  @label='Ships from'
                  @tag='label'
                  @vertical={{true}}
                >
                  <@fields.shippedFrom />
                </FieldContainer>
                <FieldContainer
                  @label='Ships to'
                  @tag='label'
                  @vertical={{true}}
                >
                  <@fields.shippedTo />
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
              <div class='se-body se-grid-2'>
                <FieldContainer
                  @label='Label created'
                  @tag='label'
                  @vertical={{true}}
                >
                  <@fields.labelCreatedAt />
                </FieldContainer>
                <FieldContainer
                  @label='Shipped'
                  @tag='label'
                  @vertical={{true}}
                >
                  <@fields.shippedAt />
                </FieldContainer>
                <FieldContainer
                  @label='Estimated delivery'
                  @tag='label'
                  @vertical={{true}}
                >
                  <@fields.estimatedDelivery />
                </FieldContainer>
                <FieldContainer
                  @label='Delivered'
                  @tag='label'
                  @vertical={{true}}
                >
                  <@fields.deliveredAt />
                  <p class='se-help'>Setting this is what marks the leg
                    delivered — the boolean is derived, not stored.</p>
                </FieldContainer>
              </div>
            </:content>
          </A.Item>
        </Accordion>
      </div>

      <style scoped>

        /* Rule 1: edit has no host container — declare our own, named. */
        .sh-edit {
          container-type: inline-size;
          container-name: sh-edit;

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
          --font-display: var(--font-serif, 'Playfair Display', Georgia, serif);
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
          gap: 1.5rem;
          box-sizing: border-box;
        }
        .sh-edit *:focus-visible {
          outline: 2px solid var(--gold);
          outline-offset: 2px;
        }
        .se-head {
          display: flex;
          flex-direction: column;
          gap: 1rem;
          border-bottom: 1px solid var(--hairline);
          padding-bottom: 1.25rem;
        }
        .se-identity {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 1rem;
        }
        .se-body {
          padding: 0.85rem 0.25rem;
        }
        .se-grid-2 {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 1rem;
        }
        .se-help {
          margin: 0.3rem 0 0;
          font-size: 0.75rem;
          line-height: 1.45;
          color: var(--smoke);
        }
        .se-help code {
          font-family: var(--font-mono);
          background: var(--ink-700);
          padding: 0.05em 0.3em;
          border-radius: 3px;
          color: var(--paper);
          white-space: nowrap;
        }
        .sh-edit :deep(.boxel-field > .label-container .label) {
          text-transform: uppercase;
          letter-spacing: 0.08em;
          font-size: 0.75rem;
          font-weight: 600;
          color: var(--smoke);
        }
        .sh-edit :deep(.boxel-accordion-container) {
          --accordion-border: 1px solid var(--hairline);
          background: var(--ink-800);
        }
        .sh-edit :deep(.boxel-accordion-item) {
          --boxel-accordion-trigger-padding-inline: 1.1rem;
          --boxel-accordion-item-padding-inline: 0;
        }
        .sh-edit :deep(.boxel-accordion-item-trigger) {
          font-family: var(--font-display);
          font-size: 1rem;
          font-weight: 700;
        }
        .sh-edit :deep(.boxel-accordion-item-icon) {
          color: var(--gold-ink, var(--gold));
        }

        @container sh-edit (width < 640px) {
          .se-identity,
          .se-grid-2 {
            grid-template-columns: 1fr;
          }
        }
      </style>
    </template>
  };

  // FITTED — FittedCard, same fork and knobs as the family's supporting tiles.
  //
  // THE ANCHOR IS TYPOGRAPHIC AND IT IS THE LEG, NOT THE PRODUCT. A shipment has
  // no image and no money figure; what a reader scanning a transit queue needs
  // first is *which journey this is* ("To authenticator" vs "To buyer"), because
  // that is what tells them whose problem an exception is. So the leg takes the
  // title slot at 700 weight and the product name is the quiet eyebrow.
  //
  // SLOT DISCIPLINE — four distinct facts, four slots:
  //   productTitle (eyebrow) · legLabel (title, the anchor) · status (badge) ·
  //   trackingNumber (footer)
  // `<:subtitle>`/`<:meta>` unrendered: what is left is the carrier and the
  // order reference, and the carrier alone is not worth a row that costs the
  // tracking number its space at the tighter quanta.
  static fitted = class Fitted extends Component<typeof Shipment> {
    <template>
      <FittedCard class='sh-fit' @titleTag='h3'>
        {{! Rule 2 anchor, tier 2: the card's OWN static icon, shared with its
            isolated, embedded and atom formats — the icon is the identity. }}
        <:placeholder>
          <PackageIcon
            width='max(18px, 34%)'
            height='max(18px, 34%)'
            aria-hidden='true'
          />
        </:placeholder>

        <:eyebrow>{{if
            @model.productTitle
            @model.productTitle
            'Unlinked order'
          }}</:eyebrow>

        <:title>{{if @model.legLabel @model.legLabel 'Shipment'}}</:title>

        <:badgeRight>
          {{#if @model.shipmentStatus}}
            <@fields.shipmentStatus @format='atom' />
          {{/if}}
        </:badgeRight>

        <:footer>
          {{! A tracking number gets typed into a carrier's site — mono, tabular,
              never ellipsised, hidden WHOLE at the narrow quanta instead. }}
          {{#if @model.trackingNumber}}
            <span class='sh-track'>{{@model.trackingNumber}}</span>
          {{/if}}
        </:footer>
      </FittedCard>

      <style scoped>

        /* No container-type / container-name — FittedCard queries the HOST's
           `fitted-card` container. */
        .sh-fit {
          --card: oklch(1 0 0);
          --card-foreground: oklch(0.147 0.004 49.25);
          --background: oklch(0.985 0.001 106.42);
          --border: oklch(0.869 0.005 56.37);
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
          --primary: oklch(0.666 0.179 58.32);
          --primary-foreground: oklch(0.216 0.006 56.04);
          --destructive: oklch(0.577 0.245 27.32);
          --destructive-foreground: oklch(0.985 0.001 106.42);
          --ring: var(--primary);
          --gold: var(--primary);
          /* Text-grade gold for sub-18px strings: bare --gold on white sits under
             AA. oklab, not oklch (hue-rotates against achromatic endpoints). */
          --gold-ink: color-mix(in oklab, var(--gold) 72%, var(--foreground));

          background: var(--ink-800);
          color: var(--paper);
          font-family: var(--font-sans, 'Inter', system-ui, -apple-system, sans-serif);
          box-shadow: inset 3px 0 0 0 var(--gold);

          --fc-image-width: 34cqh;
          --fc-image-min-width: 2.5rem;
          --fc-image-max-width: 5rem;
          --fc-image-background: var(--ink-700);
          --fc-image-fade-color: var(--ink-800);

          --fc-content-padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
          --fc-header-gap: 0.15em;
          --fc-content-gap: var(--boxel-sp-xxs);

          --fc-eyebrow-font-size: max(9px, 0.62em);
          --fc-eyebrow-line-height: 1.25;
          --fc-title-font-size: max(13px, 1.05em);
          --fc-title-line-height: 1.2;
          --fc-title-line-clamp: 1;
          --fc-footer-font-size: max(11px, 0.72em);
          --fc-footer-gap: var(--boxel-sp-xs);
          --fc-footer-justify: flex-start;
          --fc-footer-flex-wrap: nowrap;
          --fc-badge-offset: var(--boxel-sp-xxs);
        }

        .sh-fit :deep(.fc-eyebrow) {
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--smoke);
          font-weight: 600;
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 1;
          overflow: hidden;
        }
        /* The typographic anchor: the leg, decisively the loudest thing. No
           serif here — this is a logistics label, not a money figure, and
           reserving the display serif for amounts is what keeps the family's
           figures reading as figures. */
        .sh-fit :deep(.fc-title) {
          font-weight: 700;
          letter-spacing: -0.01em;
          white-space: nowrap;
        }
        .sh-fit :deep(.fc-footer) {
          line-height: 1.25;
        }

        .sh-track {
          font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas,
            monospace;
          font-variant-numeric: tabular-nums;
          color: var(--smoke);
          white-space: nowrap;
        }

        /* ---- quanta: visibility only, never a shrink-into-a-clip ---- */
        @container fitted-card (height <= 50px) {
          .sh-fit {
            --fc-footer-display: none;
            --fc-badge-right-display: none;
            --fc-content-padding: var(--boxel-sp-4xs) var(--boxel-sp-xxs);
          }
          .sh-fit :deep(.fc-eyebrow) {
            display: none;
          }
        }

        /* The tracking number is long: it goes whole at the tighter strips
           rather than becoming a stub nobody can use. */
        @container fitted-card (width <= 260px) and (height <= 80px) {
          .sh-fit .sh-track {
            display: none;
          }
        }

        @container fitted-card (width <= 150px) {
          .sh-fit {
            --fc-image-max-width: 100%;
          }
          .sh-fit :deep(.fc-eyebrow) {
            display: none;
          }
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof Shipment> {
    <template>
      <span class='sh-atom'>
        <PackageIcon width='13' height='13' aria-hidden='true' />
        {{#if @model.shipmentStatus}}
          <@fields.shipmentStatus @format='atom' />
        {{else}}
          <span class='sh-none'>not shipped</span>
        {{/if}}
      </span>
      <style scoped>
        /* An atom sits inline in someone else's text, so it inherits colour
           rather than pinning its own ground — only the muted fallback state
           gets a literal tone. */
        .sh-atom {
          display: inline-flex;
          align-items: center;
          gap: 0.3em;
        }
        .sh-none {
          font-size: 0.8125em;
          color: color-mix(
            in oklch,
            var(--muted-foreground, oklch(0.709 0.01 56.26)) 85%,
            transparent
          );
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof Shipment> {
    <template>
      <div class='sh-row'>
        <span class='sh-main'>
          <span class='sh-leg'>{{if
              @model.legLabel
              @model.legLabel
              'Shipment'
            }}</span>
          {{#if @model.carrier}}
            <span class='sh-carrier'>· {{@model.carrier}}</span>
          {{/if}}
        </span>
        {{#if @model.trackingNumber}}
          <span class='sh-track'>{{@model.trackingNumber}}</span>
        {{/if}}
        {{#if @model.shipmentStatus}}
          <@fields.shipmentStatus @format='atom' />
        {{/if}}
      </div>
      <style scoped>

        /* Self-contained row: the family's ink panel, own gold inset — this
           renders inside a plain <li>, not a themed host container. */
        .sh-row {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto auto;
          gap: 0.75rem;
          align-items: center;
          padding: 0.6rem 0.9rem;
          background: var(--card, oklch(0.216 0.006 56.04));
          border: 1px solid oklch(0.32 0.012 55 / 0.55);
          border-radius: 8px;
          box-shadow: inset 2px 0 0 0 var(--primary, oklch(0.769 0.188 70.08));
          color: var(--foreground, oklch(0.985 0.001 106.42));
          font-family: var(--font-sans, 'Inter', system-ui, -apple-system, sans-serif);
          font-size: 0.875rem;
        }
        .sh-main {
          min-width: 0;
          display: flex;
          align-items: baseline;
          gap: 0.35rem;
        }
        .sh-leg {
          font-weight: 700;
          white-space: nowrap;
        }
        .sh-carrier {
          color: var(--muted-foreground, oklch(0.709 0.01 56.26));
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        /* A tracking number is typed into a carrier's site — mono, tabular, and
           never ellipsised. It is hidden whole at narrow widths instead. */
        .sh-track {
          font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas,
            monospace;
          font-size: 0.75rem;
          font-variant-numeric: tabular-nums;
          color: var(--muted-foreground, oklch(0.709 0.01 56.26));
          white-space: nowrap;
        }
        @container (width < 480px) {
          .sh-track {
            display: none;
          }
        }
      </style>
    </template>
  };
}

export default Shipment;
