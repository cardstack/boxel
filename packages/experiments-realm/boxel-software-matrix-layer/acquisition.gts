import {
  FieldDef,
  field,
  contains,
  StringField,
  Component,
} from '@cardstack/base/card-api';
import DateField from '@cardstack/base/date';
import AmountWithCurrency from '@cardstack/base/amount-with-currency';
import ReceiptIcon from '@cardstack/boxel-icons/receipt';
import { formatMoney } from './money-format';

// Acquisition — how an item entered someone's possession: what was paid, when,
// from where, and against which reference.
//
// Reused rather than rebuilt: `price` is base `amount-with-currency`
// ({ amount, currency }), not a NumberField plus a separate code string.

/**
 * Format a Date as a calendar day (`YYYY-MM-DD`) using its LOCAL components.
 *
 * `new Date('9/30/2026').toISOString()` yields the 29th anywhere east of UTC,
 * so an acquisition date round-tripped through ISO silently moves back a day.
 * An acquisition happened on a calendar day, not at an instant — read
 * getFullYear/getMonth/getDate and build the string.
 */
export function toCalendarDay(date: Date | null | undefined): string {
  if (!date) {
    return '';
  }
  let year = date.getFullYear();
  let month = String(date.getMonth() + 1).padStart(2, '0');
  let day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export class Acquisition extends FieldDef {
  static displayName = 'Acquisition';
  static icon = ReceiptIcon;

  @field price = contains(AmountWithCurrency);
  @field acquiredOn = contains(DateField);

  // Where it came from: 'Retail', 'StockX', 'Local meetup', 'Estate sale'.
  // A fixed-ish list — the consumer supplies enum options if it wants a select.
  @field source = contains(StringField);

  // Order number, receipt id, lot number — whatever proves the purchase.
  @field reference = contains(StringField);

  @field acquiredOnDay = contains(StringField, {
    computeVia: function (this: Acquisition) {
      return toCalendarDay(this.acquiredOn);
    },
  });

  static atom = class Atom extends Component<typeof Acquisition> {
    // Routed through the one formatter, NOT `<@fields.price @format='atom'/>`.
    // The field atom does no number formatting at all, so it prints 11.5 for
    // 11.50 — a price missing a digit is not a price.
    get paid() {
      return formatMoney(this.args.model?.price);
    }

    <template>
      <span class='acq'>
        {{#if this.paid}}<span class='amt'>{{this.paid}}</span>{{/if}}
        {{#if @model.source}}<span class='src'>· {{@model.source}}</span>{{/if}}
      </span>
      <style scoped>
        /* Sole Vault family palette, defined locally — this field renders
           inline inside other cards, so it carries its own literal tokens
           rather than reaching for boxel-token fallbacks. */
        .acq {
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
          --accent: oklch(0.769 0.188 70.08);
          --accent-foreground: oklch(0.216 0.006 56.04);
          --gold-bright: var(--accent);

          font-size: 0.8125rem;
          color: var(--paper);
        }
        .amt {
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          color: var(--gold-ink, var(--gold));
        }
        .src {
          color: var(--smoke);
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof Acquisition> {
    get paid() {
      return formatMoney(this.args.model?.price);
    }

    <template>
      <dl class='acquisition'>
        <div class='pair'>
          <dt>Paid</dt>
          <dd class='amt'>{{if this.paid this.paid '—'}}</dd>
        </div>
        <div class='pair'>
          <dt>Acquired</dt>
          <dd>{{#if
              @model.acquiredOnDay
            }}{{@model.acquiredOnDay}}{{else}}—{{/if}}</dd>
        </div>
        <div class='pair'>
          <dt>Source</dt>
          <dd>{{#if @model.source}}{{@model.source}}{{else}}—{{/if}}</dd>
        </div>
        {{#if @model.reference}}
          <div class='pair'>
            <dt>Ref</dt>
            <dd class='ref'>{{@model.reference}}</dd>
          </div>
        {{/if}}
      </dl>
      <style scoped>
        .acquisition {
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
          --accent: oklch(0.769 0.188 70.08);
          --accent-foreground: oklch(0.216 0.006 56.04);
          --gold-bright: var(--accent);
          --font-mono: ui-monospace, 'SFMono-Regular', Menlo, Consolas,
            monospace;

          display: grid;
          gap: 0.2rem;
          margin: 0;
        }
        .pair {
          display: grid;
          grid-template-columns: 5.5rem 1fr;
          gap: 0.5rem;
          align-items: baseline;
        }
        dt {
          font-size: 0.6875rem;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--smoke);
        }
        dd {
          margin: 0;
          font-size: 0.8125rem;
          color: var(--paper);
        }
        .amt {
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          color: var(--gold-ink, var(--gold));
        }
        .ref {
          font-family: var(--font-mono);
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }
      </style>
    </template>
  };
}

export default Acquisition;
