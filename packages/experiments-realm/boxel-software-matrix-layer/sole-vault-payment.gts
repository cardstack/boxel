import {
  CardDef,
  field,
  contains,
  linksTo,
  StringField,
  Component,
} from '@cardstack/base/card-api';
import DateField from '@cardstack/base/date';
import AmountWithCurrency from '@cardstack/base/amount-with-currency';
import { statusField, canTransition, nextStatuses } from './status-field';
import { Order } from './sole-vault-order';
import CreditCardIcon from '@cardstack/boxel-icons/credit-card';
import ReceiptIcon from '@cardstack/boxel-icons/receipt';
import CoinsIcon from '@cardstack/boxel-icons/coins';
import ClockIcon from '@cardstack/boxel-icons/clock';
import { tracked } from '@glimmer/tracking';
import {
  Accordion,
  FieldContainer,
  FittedCard,
} from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';
import { formatMoney } from './money-format';

// Payment — the RECORD of one money movement against one Order.
//
// READ THIS BEFORE EXTENDING IT: this card does not move money and cannot. A
// realm has no processor, no card vault and no balance. Everything here is a
// record of what an external processor reported, and the commands that write it
// are SIMULATIONS. That is a deliberate boundary, not an unfinished feature —
// the spec's own technical section puts escrow behind Stripe Connect, which is
// server-side infrastructure this layer has no business impersonating.
//
// WHY IT IS SEPARATE FROM Order. An order has one lifecycle; its money can have
// several movements — an authorization, a capture, a partial refund, a chargeback
// reversal. Folding them into Order would force one status to describe two
// different things, and the moment a refund is partial the model breaks. One
// Order links to many Payment records; each is immutable history.
//
// THE AMOUNT IS SIGNED BY DIRECTION, NOT BY A NEGATIVE NUMBER. `direction`
// says charge or refund and `amount` is always positive. A negative money amount
// renders as "-$175.00" in some formatters and "($175.00)" in others, and every
// aggregate then has to remember which convention it is summing.

export type PaymentState =
  | 'pending'
  | 'authorized'
  | 'captured'
  | 'failed'
  | 'refunded';

export type PaymentDirection = 'charge' | 'refund';

export const PaymentStateField = statusField({
  displayName: 'Payment State',
  icon: CreditCardIcon,
  options: [
    {
      value: 'pending',
      label: 'Pending',
      hue: 'slate',
      meaning: 'Submitted to the processor, no answer yet.',
    },
    {
      value: 'authorized',
      label: 'Authorized',
      hue: 'blue',
      holds: true,
      meaning:
        'The processor is holding the funds. This is the escrow state — money reserved, not yet taken.',
    },
    {
      value: 'captured',
      label: 'Captured',
      hue: 'green',
      terminal: true,
      holds: true,
      meaning: 'Funds actually taken and settled to the platform.',
    },
    {
      value: 'failed',
      label: 'Failed',
      hue: 'red',
      terminal: true,
      meaning: 'Declined or errored. No money moved.',
    },
    {
      value: 'refunded',
      label: 'Refunded',
      hue: 'orange',
      terminal: true,
      holds: true,
      meaning: 'Returned to the payer. Recorded, never edited away.',
    },
  ],
  // A processor's own state machine, mirrored rather than invented:
  //   * `pending` can only resolve — it never goes back to itself.
  //   * An authorization can be captured, can expire into failure, or can be
  //     released as a refund before capture.
  //   * `captured → refunded` is the only edge out of a settled payment, and it
  //     is one-way. A refund is never "un-refunded"; that is a new charge.
  //   * `failed` is terminal because a retry is a NEW payment record. Reusing
  //     this one would erase the evidence that the first attempt was declined.
  transitions: {
    pending: ['authorized', 'captured', 'failed'],
    authorized: ['captured', 'failed', 'refunded'],
    captured: ['refunded'],
    failed: [],
    refunded: [],
  },
});

export function canPaymentTransition(from?: string | null, to?: string | null) {
  return canTransition(PaymentStateField, from, to);
}

export function nextPaymentStates(from?: string | null) {
  return nextStatuses(PaymentStateField, from);
}

export class Payment extends CardDef {
  static displayName = 'Payment';
  static icon = CreditCardIcon;

  @field order = linksTo(() => Order, { searchable: true });

  @field amount = contains(AmountWithCurrency);
  @field paymentState = contains(PaymentStateField);

  // 'charge' | 'refund'. Plain string with a documented pair rather than an
  // enum field, because the two values never grow — a chargeback is a refund
  // with a different reason, not a third direction.
  @field direction = contains(StringField);

  // The processor's reference ('pi_3abc123' in the spec's sample). The only
  // handle support has when reconciling against the processor's dashboard, so
  // it is treated as an identifier: never truncated in any format.
  @field processorReference = contains(StringField);

  // 'Stripe', 'simulated'. Naming the simulator explicitly in the data is what
  // stops a demo record being mistaken for a real settlement later.
  @field processor = contains(StringField);

  @field initiatedAt = contains(DateField);
  @field settledAt = contains(DateField);

  // Why a refund happened — 'authentication failed', 'buyer dispute'. Empty on
  // a charge.
  @field reason = contains(StringField);

  // --- denormalized for prerendered fitted (cannot resolve linksTo) ---
  @field orderReference = contains(StringField, {
    computeVia: function (this: Payment) {
      return this.order?.reference ?? '';
    },
  });

  @field productTitle = contains(StringField, {
    computeVia: function (this: Payment) {
      return this.order?.productTitle ?? this.cardInfo?.name ?? '';
    },
  });

  // Signed display string, derived once here so the atom, the row and any future
  // ledger view cannot disagree about how a refund is written.
  @field signedAmount = contains(StringField, {
    computeVia: function (this: Payment) {
      let money = formatMoney(this.amount);
      if (!money) {
        return '';
      }
      return this.direction === 'refund' ? `−${money}` : money;
    },
  });

  // ISOLATED — the payment's landing page. Instrument direction: this is a
  // ledger entry someone opens while reconciling, so the layout is the plaque
  // figure plus reference data, with no queries — a payment points AT its
  // order; nothing points at a payment.
  //
  // Domain question: "did money move, how much, which way, and can I find it
  // on the processor's dashboard?" The first three are the hero; the fourth is
  // the reconciliation section, where the processor reference renders mono and
  // whole — it is the only handle support has.
  static isolated = class Isolated extends Component<typeof Payment> {
    <template>
      <article class='card'>
        <header class='hero'>
          <div class='hero-copy'>
            <h1 class='hero-title'>{{if
                @model.productTitle
                @model.productTitle
                'Unlinked order'
              }}</h1>
            <p class='hero-meta'>
              {{#if @model.orderReference}}
                <span class='meta-item'>order
                  <strong class='mono'>{{@model.orderReference}}</strong></span>
              {{/if}}
              {{#if @model.reason}}
                <span class='meta-item'>{{@model.reason}}</span>
              {{/if}}
            </p>
          </div>

          {{! THE PLAQUE — the signed amount is the dominant element; the
              direction/processor caption sits BELOW the figure, never above it
              as a kicker. A refund's minus sign is carried by `signedAmount`
              itself, derived once for every format. }}
          <div
            class='plaque {{if (eq @model.direction "refund") "plaque--out"}}'
          >
            <p
              class='plaque-amt {{if (eq @model.direction "refund") "plaque-amt--out"}}'
            >{{if @model.signedAmount @model.signedAmount '—'}}</p>
            <p class='plaque-caption'>
              {{if (eq @model.direction 'refund') 'Refund' 'Charge'}}
              {{#if @model.processor}}
                <span class='plaque-sep'>·</span>
                {{@model.processor}}
              {{/if}}
            </p>
            {{#if @model.paymentState}}
              <div class='plaque-state'>
                <@fields.paymentState @format='embedded' />
              </div>
            {{/if}}
          </div>
        </header>

        <div class='cols'>
          {{! Shape 1: a printed ledger strip — leader-dot rows, no icon
              header. }}
          <section class='ledger'>
            <h2 class='sec-label'>Ledger</h2>
            <div class='ledger-row'>
              <span class='ledger-key'>Processor</span>
              <span class='ledger-leader'></span>
              <span class='ledger-val'>{{if
                  @model.processor
                  @model.processor
                  '—'
                }}</span>
            </div>
            <div class='ledger-row'>
              <span class='ledger-key'>Reference</span>
              <span class='ledger-leader'></span>
              {{! The only handle support has against the processor's
                  dashboard: mono, tabular, never truncated. }}
              <span class='ledger-val mono'>{{if
                  @model.processorReference
                  @model.processorReference
                  '—'
                }}</span>
            </div>
            <div class='ledger-row'>
              <span class='ledger-key'>Direction</span>
              <span class='ledger-leader'></span>
              <span class='ledger-val'>{{if
                  (eq @model.direction 'refund')
                  'Refund'
                  'Charge'
                }}</span>
            </div>
            <p class='ledger-note'>A record, not a movement — this realm has
              no processor. “simulated” here is what separates a demo from a
              settlement.</p>
          </section>

          {{! Shape 2: a vertical rail — the two moments, connected. }}
          <section class='timing'>
            <h2 class='sec-label'><ClockIcon
                class='sec-icon'
                aria-hidden='true'
              />Timing</h2>
            <ol class='rail'>
              <li class='rail-node'>
                <span class='rail-dot'></span>
                <span class='rail-label'>Initiated</span>
                <span class='rail-val'>{{#if @model.initiatedAt}}<@fields.initiatedAt
                      @format='atom'
                    />{{else}}—{{/if}}</span>
              </li>
              <li class='rail-node'>
                <span class='rail-dot'></span>
                <span class='rail-label'>Settled</span>
                <span class='rail-val'>{{#if @model.settledAt}}<@fields.settledAt
                      @format='atom'
                    />{{else}}—{{/if}}</span>
              </li>
            </ol>
            <p class='rail-note'>Empty settled while only authorized —
              settlement is when money actually moved.</p>
          </section>
        </div>

        {{! Shape 3: the receipt stub — a linked card, torn from the top. }}
        <section class='stub'>
          <h2 class='sec-label'><ReceiptIcon
              class='sec-icon'
              aria-hidden='true'
            />Order</h2>
          {{#if @model.order}}
            <div class='stub-body'>
              <@fields.order @format='embedded' />
            </div>
          {{else}}
            <p class='empty'>
              <ReceiptIcon width='18' height='18' aria-hidden='true' />No order
              linked — a payment with nothing to settle.
            </p>
          {{/if}}
        </section>
      </article>

      <style scoped>

        /* Rule 1: isolated gets NO host container — declare our own, named.
           Literal committed palette, matching the app shell — nothing here
           is meant to be swappable by a theme. */
        .card {
          container-type: inline-size;
          container-name: card;
          width: 100%;
          height: 100%;
          overflow-y: auto;

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
          --rose: var(--destructive, oklch(0.7 0.16 24));
          --rose-bright: oklch(0.76 0.17 27);
          --shadow-2: 0 8px 24px -8px oklch(0.05 0 0 / 0.14);
          --shadow-3: 0 20px 48px -16px oklch(0.05 0 0 / 0.18);

          --font-display: var(--font-serif, 'Playfair Display', Georgia, serif);
                    --font-mono: ui-monospace, 'SFMono-Regular', Menlo, Consolas,
            monospace;

          background: var(--ink-900);
          background-image: radial-gradient(
            ellipse 1100px 600px at 85% -10%,
            var(--ink-800) 0%,
            transparent 60%
          );
          color: var(--paper);
          font-family: var(--font-sans, 'Inter', system-ui, -apple-system, sans-serif);
          padding: var(--boxel-sp-lg);
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-lg);
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
          gap: var(--boxel-sp-lg);
        }
        .hero-copy {
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-xs);
        }
        .hero-title {
          margin: 0;
          font-family: var(--font-display);
          font-size: 1.75rem;
          line-height: 1.15;
          font-weight: 700;
          letter-spacing: -0.01em;
        }
        .hero-meta {
          margin: 0;
          display: flex;
          flex-wrap: wrap;
          gap: var(--boxel-sp-xs) var(--boxel-sp);
          font-size: 0.8125rem;
          color: var(--smoke);
        }
        .meta-item strong {
          color: var(--paper);
          font-weight: 600;
        }
        .mono {
          font-family: var(--font-mono);
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }

        /* THE PLAQUE — same filled-panel device as the rest of the family
           (radius/shadow match CollectionItem's --panel-radius convention):
           gold for an inflow, rose for an outflow — the fill is data-driven,
           never a bare-text figure like the family's other cards. Caption
           sits BELOW the figure, never above it as a kicker. */
        /* Light translation of the plaque signature: white ground, the
           top-rule carrying the money's DIRECTION — gold for a charge, the
           destructive rose for money leaving (a refund). The old filled
           gradient slabs were dark-era surfaces. */
        .plaque {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: var(--boxel-sp-4xs);
          text-align: right;
          margin-top: auto;
          background: var(--ink-800);
          border: 1px solid var(--hairline);
          border-top: 3px solid var(--gold);
          border-radius: 6px;
          padding: 1.1rem 1.4rem;
          box-shadow: var(--shadow-1);
        }
        .plaque--out {
          border-top-color: var(--rose);
        }
        .plaque-amt {
          margin: 0;
          font-family: var(--font-mono);
          color: var(--paper);
          font-size: 2.75rem;
          line-height: 1.05;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          letter-spacing: -0.01em;
          white-space: nowrap;
        }
        .plaque-amt--out {
          color: var(--rose);
        }
        .plaque-caption {
          margin: 0;
          font-size: 0.75rem;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--gold-ink, var(--gold));
        }
        .plaque-sep {
          opacity: 0.6;
          margin: 0 0.3em;
        }
        .plaque-state {
          margin-top: var(--boxel-sp-xxs);
        }

        /* ---------- section label, shared but not a repeated panel ---------- */
        .sec-label {
          margin: 0 0 var(--boxel-sp-sm);
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

        .cols {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          gap: var(--boxel-sp-lg);
        }

        /* Shape 1: LEDGER — a printed strip, leader-dot rows. */
        .ledger {
          background: var(--ink-800);
          padding: var(--boxel-sp) var(--boxel-sp-lg) var(--boxel-sp-lg);
          border-radius: 8px;
          border: 1px solid var(--hairline);
          box-shadow: var(--shadow-2);
          min-width: 0;
        }
        .ledger-row {
          display: flex;
          align-items: baseline;
          gap: var(--boxel-sp-xs);
          font-size: 0.875rem;
          padding: 0.3em 0;
        }
        .ledger-key {
          font-size: 0.6875rem;
          text-transform: uppercase;
          letter-spacing: 0.07em;
          color: var(--smoke);
          flex: none;
        }
        .ledger-leader {
          flex: 1 1 auto;
          border-bottom: 1px dotted var(--hairline);
          min-width: 1rem;
          transform: translateY(-0.3em);
        }
        .ledger-val {
          font-weight: 600;
          font-variant-numeric: tabular-nums;
          text-align: right;
        }
        .ledger-note {
          margin: var(--boxel-sp-sm) 0 0;
          font-size: 0.75rem;
          line-height: 1.45;
          color: var(--smoke);
        }

        /* Shape 2: TIMING — a vertical rail with two connected nodes. */
        .timing {
          background: var(--ink-800);
          padding: var(--boxel-sp) var(--boxel-sp-lg) var(--boxel-sp-lg);
          border-radius: 8px;
          border: 1px solid var(--hairline);
          box-shadow: var(--shadow-2);
          min-width: 0;
        }
        .rail {
          list-style: none;
          margin: 0;
          padding: 0 0 0 0.4rem;
          position: relative;
        }
        .rail::before {
          content: '';
          position: absolute;
          left: 0.4rem;
          top: 0.5rem;
          bottom: 0.5rem;
          width: 1px;
          background: var(--hairline);
        }
        .rail-node {
          position: relative;
          display: grid;
          grid-template-columns: auto 1fr auto;
          align-items: baseline;
          gap: var(--boxel-sp-xs);
          padding: 0.4em 0 0.4em 1.1rem;
          font-size: 0.875rem;
        }
        .rail-dot {
          position: absolute;
          left: -0.05rem;
          top: 0.75em;
          width: 0.55rem;
          height: 0.55rem;
          border-radius: 999px;
          background: var(--gold);
          box-shadow: 0 0 0 3px var(--ink-800);
        }
        .rail-label {
          font-size: 0.6875rem;
          text-transform: uppercase;
          letter-spacing: 0.07em;
          color: var(--smoke);
        }
        .rail-val {
          font-weight: 600;
          font-variant-numeric: tabular-nums;
          text-align: right;
        }
        .rail-note {
          margin: var(--boxel-sp-sm) 0 0;
          font-size: 0.75rem;
          line-height: 1.45;
          color: var(--smoke);
        }

        /* Shape 3: STUB — a receipt torn from the page, holding the linked
           Order. The dashed top edge with circular "punches" is the family's
           one signature flourish on this card. */
        .stub {
          position: relative;
          background: var(--ink-800);
          padding: var(--boxel-sp-lg);
          padding-top: calc(var(--boxel-sp-lg) + 0.5rem);
          border-radius: 8px;
          border: 1px solid var(--hairline);
          box-shadow: var(--shadow-2);
        }
        .stub::before {
          content: '';
          position: absolute;
          top: 0;
          left: var(--boxel-sp-lg);
          right: var(--boxel-sp-lg);
          height: 0;
          border-top: 2px dashed var(--hairline);
        }
        .stub-body {
          border-radius: 6px;
          transition: transform 180ms cubic-bezier(0.16, 1, 0.3, 1),
            box-shadow 180ms cubic-bezier(0.16, 1, 0.3, 1);
        }
        .stub-body:hover,
        .stub-body:focus-within {
          transform: translateY(-3px);
          box-shadow: var(--shadow-3);
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

        @media (prefers-reduced-motion: reduce) {
          .stub-body {
            transition: none;
          }
          .stub-body:hover,
          .stub-body:focus-within {
            transform: none;
          }
        }

        @container card (width < 700px) {
          .hero {
            flex-direction: column;
            align-items: flex-start;
          }
          .plaque {
            align-items: flex-start;
            text-align: left;
          }
          .cols {
            grid-template-columns: 1fr;
          }
        }
      </style>
    </template>
  };

  // EDIT — nine editable fields, so grouped rather than a flat list.
  //
  // The identity row carries the two facts that decide what this record MEANS
  // (direction and state); everything else is reference data and dates.
  //
  // `direction` and `processor` both get helper text because both are free
  // strings whose accepted values are not discoverable from the input, and
  // getting either wrong is the difference between a demo record and something
  // a reader believes settled real money.
  static edit = class Edit extends Component<typeof Payment> {
    @tracked refsOpen = true;
    @tracked datesOpen = false;

    toggleRefs = () => (this.refsOpen = !this.refsOpen);
    toggleDates = () => (this.datesOpen = !this.datesOpen);

    <template>
      <div class='pay-edit'>
        <header class='pe-head'>
          <FieldContainer @label='Order' @tag='label' @vertical={{true}}>
            <@fields.order />
          </FieldContainer>

          <div class='pe-identity'>
            <FieldContainer @label='Amount' @tag='label' @vertical={{true}}>
              <@fields.amount />
              <p class='pe-help'>Always positive. Direction decides the sign — a
                negative amount here renders inconsistently across formatters.</p>
            </FieldContainer>
            <FieldContainer @label='Direction' @tag='label' @vertical={{true}}>
              <@fields.direction />
              <p class='pe-help'>Either
                <code>charge</code>
                or
                <code>refund</code>. A chargeback is a refund with a reason, not
                a third value.</p>
            </FieldContainer>
            <FieldContainer @label='State' @tag='label' @vertical={{true}}>
              <@fields.paymentState />
              <p class='pe-help'><code>authorized</code>
                is the escrow state: reserved with the processor, not yet taken.</p>
            </FieldContainer>
          </div>
        </header>

        <Accordion class='pe-sections' @displayContainer={{false}} as |A|>
          <A.Item
            @id='refs'
            @isOpen={{this.refsOpen}}
            @onClick={{this.toggleRefs}}
          >
            <:title>Processor &amp; reason</:title>
            <:content>
              <div class='pe-body pe-grid-2'>
                <FieldContainer
                  @label='Processor'
                  @tag='label'
                  @vertical={{true}}
                >
                  <@fields.processor />
                  <p class='pe-help'>Write
                    <code>simulated</code>
                    unless a real processor produced this record. Naming the
                    simulator in the data is what stops a demo being read as a
                    settlement.</p>
                </FieldContainer>
                <FieldContainer
                  @label='Processor reference'
                  @tag='label'
                  @vertical={{true}}
                >
                  <@fields.processorReference />
                  <p class='pe-help'>The only handle support has when
                    reconciling against the processor’s dashboard.</p>
                </FieldContainer>
                <FieldContainer @label='Reason' @tag='label' @vertical={{true}}>
                  <@fields.reason />
                  <p class='pe-help'>Why a refund happened. Leave empty on a
                    charge.</p>
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
              <div class='pe-body pe-grid-2'>
                <FieldContainer
                  @label='Initiated'
                  @tag='label'
                  @vertical={{true}}
                >
                  <@fields.initiatedAt />
                </FieldContainer>
                <FieldContainer
                  @label='Settled'
                  @tag='label'
                  @vertical={{true}}
                >
                  <@fields.settledAt />
                  <p class='pe-help'>Empty while the payment is only authorized
                    — settlement is when money actually moved.</p>
                </FieldContainer>
              </div>
            </:content>
          </A.Item>
        </Accordion>
      </div>

      <style scoped>

        /* Rule 1: edit has no host container — declare our own, named. Same
           literal committed palette as isolated, not theme fallbacks. */
        .pay-edit {
          container-type: inline-size;
          container-name: pay-edit;

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
          padding: var(--boxel-sp);
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp);
          box-sizing: border-box;

          scrollbar-color: var(--gold) var(--ink-800);
        }
        .pay-edit ::selection {
          background: var(--gold);
          color: var(--ink-900);
        }
        .pay-edit *:focus-visible {
          outline: 2px solid var(--gold);
          outline-offset: 2px;
        }
        .pe-head {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-sm);
          border-bottom: 1px solid var(--hairline);
          padding-bottom: var(--boxel-sp);
        }
        .pe-identity {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: var(--boxel-sp-sm);
        }
        .pe-body {
          padding: var(--boxel-sp-sm) var(--boxel-sp-xs);
        }
        .pe-grid-2 {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: var(--boxel-sp-sm);
        }
        .pe-help {
          margin: var(--boxel-sp-4xs) 0 0;
          font-size: var(--boxel-font-size-xs);
          line-height: 1.45;
          color: var(--smoke);
        }
        /* An accepted literal shown inline reads as a value to type, not prose. */
        .pe-help code {
          font-family: var(--font-mono);
          background: var(--ink-700);
          padding: 0.05em 0.3em;
          border-radius: 3px;
          color: var(--paper);
        }
        .pay-edit :deep(.boxel-label) {
          text-transform: uppercase;
          letter-spacing: 0.08em;
          font-size: var(--boxel-font-size-xs);
          font-weight: 500;
          color: var(--smoke);
        }

        @container pay-edit (width < 640px) {
          .pe-identity,
          .pe-grid-2 {
            grid-template-columns: 1fr;
          }
        }
      </style>
    </template>
  };

  // FITTED — FittedCard, unlike Order's hand-rolled tile. A payment IS a
  // standard composition (glyph + eyebrow + title + badge + footer), and the
  // family already runs seven of these, so forking an eighth idiom would cost
  // consistency for nothing.
  //
  // SLOT DISCIPLINE — four distinct facts, four slots:
  //   direction (eyebrow) · signedAmount (title, the anchor) · state (badge) ·
  //   processorReference (footer)
  // `<:subtitle>` and `<:meta>` are NOT rendered: the values left over are the
  // order reference and the product title, both of which belong to the Order
  // tile, not here — a payment row that repeats them reads as a duplicate order.
  static fitted = class Fitted extends Component<typeof Payment> {
    <template>
      <FittedCard class='pay-fit' @titleTag='h3'>
        {{! Rule 2 anchor: no image field on a payment, so this is the tier-2
            icon — the card's OWN static icon, the same one its atom uses. }}
        <:placeholder>
          <CreditCardIcon
            width='max(18px, 34%)'
            height='max(18px, 34%)'
            aria-hidden='true'
          />
        </:placeholder>

        {{! The eyebrow carries the PROCESSOR, not the direction.
            Direction was the obvious choice and it is wrong twice over: the
            minus sign in `signedAmount` already states it, and on a settled
            refund an eyebrow reading "REFUND" sits directly above a badge
            reading "Refunded" — two slots saying one thing, which reads as a
            single field wrapped onto two lines.
            The processor is the fact nothing else on the tile carries, and it
            is the one worth surfacing: 'simulated' is how a reader tells a demo
            record from a real settlement. }}
        <:eyebrow>{{@model.processor}}</:eyebrow>

        {{! The amount is the title BECAUSE it is the main field of a payment —
            which keeps FittedCard's own "title is loudest" behaviour pointing at
            the right value instead of fighting it. }}
        <:title>{{if @model.signedAmount @model.signedAmount '—'}}</:title>

        <:badgeRight>
          {{#if @model.paymentState}}
            <@fields.paymentState @format='atom' />
          {{/if}}
        </:badgeRight>

        <:footer>
          {{! A processor reference is reconciled by hand against a dashboard:
              mono, nowrap, and hidden WHOLE at the narrow quanta rather than
              truncated to an unusable stub. }}
          {{#if @model.processorReference}}
            <span class='pay-ref'>{{@model.processorReference}}</span>
          {{/if}}
        </:footer>
      </FittedCard>

      <style scoped>
        /* No container-type / container-name — FittedCard queries the HOST's
           `fitted-card` container. Literal committed palette, same as
           isolated/edit. */
        .pay-fit {
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
                    --font-mono: ui-monospace, 'SFMono-Regular', Menlo, Consolas,
            monospace;

          background: var(--ink-800);
          color: var(--paper);
          font-family: var(--font-sans, 'Inter', system-ui, -apple-system, sans-serif);
          /* Family plaque — inset gold edge, never a border. */
          box-shadow: inset 2px 0 0 0 var(--gold);

          --fc-image-width: 34cqh;
          --fc-image-min-width: 2.5rem;
          --fc-image-max-width: 5rem;
          --fc-image-background: var(--ink-700);
          --fc-image-fade-color: var(--ink-800);

          --fc-content-padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
          --fc-header-gap: 0.15em;
          --fc-content-gap: var(--boxel-sp-xxs);

          /* line-height >= 1.15 on every role so a descender is never sheared
             even when the clamp math "fits". */
          --fc-eyebrow-font-size: max(9px, 0.62em);
          --fc-eyebrow-line-height: 1.25;
          --fc-title-font-size: max(15px, 1.3em);
          --fc-title-line-height: 1.2;
          --fc-title-line-clamp: 1;
          --fc-footer-font-size: max(11px, 0.72em);
          --fc-footer-gap: var(--boxel-sp-xs);
          --fc-footer-justify: flex-start;
          --fc-footer-flex-wrap: nowrap;
          --fc-badge-offset: var(--boxel-sp-xxs);
        }

        /* The eyebrow stays quiet so the amount wins by CONTRAST, not size. */
        .pay-fit :deep(.fc-eyebrow) {
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--smoke);
          font-weight: 600;
        }
        /* The anchor: gold tabular monospace, receipt-style, never wrapped.
           Same figure treatment as every other money value in the family. */
        .pay-fit :deep(.fc-title) {
          font-family: var(--font-mono);
          color: var(--gold-ink, var(--gold));
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          letter-spacing: -0.01em;
          white-space: nowrap;
        }
        .pay-fit :deep(.fc-footer) {
          line-height: 1.25;
        }

        .pay-ref {
          font-family: var(--font-mono);
          font-variant-numeric: tabular-nums;
          color: var(--smoke);
          white-space: nowrap;
        }

        /* ---- quanta: visibility only, never a shrink-into-a-clip ---- */
        @container fitted-card (height <= 50px) {
          .pay-fit {
            --fc-footer-display: none;
            --fc-badge-right-display: none;
            --fc-content-padding: var(--boxel-sp-4xs) var(--boxel-sp-xxs);
          }
          .pay-fit :deep(.fc-eyebrow) {
            display: none;
          }
        }

        /* The reference goes whole rather than becoming a stub. */
        @container fitted-card (width <= 220px) and (height <= 80px) {
          .pay-fit .pay-ref {
            display: none;
          }
        }

        @container fitted-card (width <= 150px) {
          .pay-fit {
            --fc-image-max-width: 100%;
          }
          .pay-fit :deep(.fc-eyebrow) {
            display: none;
          }
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof Payment> {
    <template>
      <span class='pay-atom'>
        <span
          class='pay-amt {{if (eq @model.direction "refund") "pay-amt--out"}}'
        >{{if @model.signedAmount @model.signedAmount '—'}}</span>
        {{#if @model.paymentState}}
          <@fields.paymentState @format='atom' />
        {{/if}}
      </span>
      <style scoped>
        .pay-atom {
          display: inline-flex;
          align-items: center;
          gap: var(--boxel-sp-xxs);
          font-family: var(--font-sans, 'Inter', system-ui, -apple-system, sans-serif);
        }
        .pay-amt {
          font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas,
            monospace;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
          color: var(--primary, oklch(0.769 0.188 70.08));
        }
        /* A refund reads as an outflow — a distinct rose hue from the family's
           gold inflow tone. */
        .pay-amt--out {
          color: var(--destructive, oklch(0.7 0.16 24));
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof Payment> {
    <template>
      <div class='pay-row'>
        <span class='pay-ref'>{{if
            @model.processorReference
            @model.processorReference
            '—'
          }}</span>
        <span class='pay-main'>
          <span class='pay-dir'>{{if
              (eq @model.direction 'refund')
              'Refund'
              'Charge'
            }}</span>
          {{#if @model.reason}}
            <span class='pay-reason'>· {{@model.reason}}</span>
          {{/if}}
        </span>
        {{#if @model.paymentState}}
          <@fields.paymentState @format='atom' />
        {{/if}}
        <span
          class='pay-amt {{if (eq @model.direction "refund") "pay-amt--out"}}'
        >{{if @model.signedAmount @model.signedAmount '—'}}</span>
      </div>
      <style scoped>
        /* Own inset — the host adds none. Literal committed palette,
           self-contained since this template has no root to inherit tokens
           from. */
        .pay-row {
          display: grid;
          grid-template-columns: 9rem minmax(0, 1fr) auto auto;
          gap: var(--boxel-sp-sm);
          align-items: center;
          padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
          background: var(--card, oklch(0.216 0.006 56.04));
          color: var(--foreground, oklch(0.985 0.001 106.42));
          font-family: var(--font-sans, 'Inter', system-ui, -apple-system, sans-serif);
          font-size: var(--boxel-font-size-sm);
        }
        /* A processor reference is reconciled against a dashboard by hand. */
        .pay-ref {
          font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas,
            monospace;
          font-size: var(--boxel-font-size-xs);
          white-space: nowrap;
        }
        .pay-dir {
          font-weight: 600;
        }
        .pay-reason {
          color: var(--muted-foreground, oklch(0.709 0.01 56.26));
        }
        .pay-amt {
          font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas,
            monospace;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
          color: var(--accent, oklch(0.828 0.189 84.43));
        }
        .pay-amt--out {
          color: var(--destructive, oklch(0.7 0.16 24));
        }
        @container (width < 520px) {
          .pay-row {
            grid-template-columns: minmax(0, 1fr) auto;
          }
          .pay-ref {
            display: none;
          }
        }
      </style>
    </template>
  };
}

export default Payment;
