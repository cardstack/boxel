import {
  CardDef,
  FieldDef,
  Component,
  contains,
  containsMany,
  field,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import NumberField from '@cardstack/base/number';
import DateField from '@cardstack/base/date';

import { MoneyField, PercentField } from 'cardstack/contracts';
import { CurrencyCodeField, minorUnits, isActive } from 'iso/money-codes';

// northwind/records — layer 05, Domain Record Types.
//
// A RECORD VENDOR SELLS SHAPE. Not formatting (layer 02 owns that), not
// controls (layer 03), not codes (layer 04) — the agreed answer to "what IS an
// invoice", so ten downstream systems stop each inventing their own
// nearly-compatible version.
//
// WHAT THE RANGES SAY, AND WHAT THE PINS SAY. This package declares
// `cardstack/contracts: ^1.0.0` and `iso/money-codes: ^1.0.0` — what the
// AUTHOR would accept. At publish the resolver writes down what those ranges
// actually resolved to ON THAT DAY, and the pack keeps both, so a reader a
// year later can see this Version shipped against `iso/money-codes@1.1.0`
// while its author would equally have taken 1.0.0. A range alone cannot answer
// "what was this tested against"; a pin alone cannot answer "what else was
// acceptable".
//
// ─── PASS 2 (1.1.0): an invoice that looks like an invoice ──────────────────
//
// 1.0.0 had exactly one format, `isolated`, and it was a definition list and a
// bulleted list stacked on top of each other. That is a data dump wearing a
// card's clothes, and it fell apart the moment anything linked to it — a
// linked invoice renders FITTED, which 1.0.0 did not have, so it appeared as a
// bare title chip saying "Untitled Invoice".
//
// A record type has to be presentable in every slot a consumer will put it in,
// or the consumer ends up rebuilding it. So:
//
//   * FITTED, with real badge/strip/tile/card subformats through container
//     queries, and NO chrome of its own — the parent draws that.
//   * EMBEDDED, a single line: number, total, status. What a row wants.
//   * ISOLATED rebuilt as a DOCUMENT: header block, a line-items table with
//     aligned money columns, and a totals block that reads bottom-right the
//     way every invoice anyone has ever been handed does.
//
// TABULAR MONEY IS NOT DECORATION. Right-aligned, tabular-nums, one decimal
// column: it is what lets a reader add a column up with their eye and catch
// the line that is an order of magnitude out. A left-aligned money column
// silently removes that ability.
//
// COMPATIBLE: two new formats and a redesign of a third. No field moved.

// A line is a FieldDef and not a CardDef, and that is a real decision rather
// than a default. An invoice line has no independent existence — nobody links
// to line 3, nobody searches for it alone, and deleting the invoice must take
// it with them. Making it a card would buy an id and a URL nothing wants, and
// cost a link traversal on every render of every invoice.
export class LineItem extends FieldDef {
  static displayName = 'Line Item';

  @field description = contains(StringField);
  @field quantity = contains(NumberField);
  @field unitPrice = contains(MoneyField);

  // Stored per line, because tax is a property of WHAT WAS SOLD and not of the
  // invoice. A single invoice-level rate is the shortcut that has to be undone
  // the first time somebody sells a book and a laptop on one document.
  @field taxRate = contains(PercentField);

  get lineTotal(): number | undefined {
    let price = this.unitPrice?.value;
    let quantity = this.quantity;
    if (price == null || quantity == null) {
      return undefined;
    }
    // Rounded to the currency's own minor units, asked of the code list rather
    // than assumed to be two. JPY has none and KWD has three, so a hardcoded 2
    // is wrong in both directions — and wrong in a way that only shows up as a
    // one-cent discrepancy months later.
    return roundTo(price * quantity, minorUnits(this.unitPrice?.currency));
  }

  get lineTotalDisplay(): string | undefined {
    let total = this.lineTotal;
    if (total == null) {
      return undefined;
    }
    return formatIn(total, this.unitPrice?.currency);
  }

  static embedded = class Embedded extends Component<typeof LineItem> {
    <template>
      <div class='line'>
        <span class='desc'>{{@model.description}}</span>
        <span class='qty'>{{@model.quantity}}</span>
        <span class='unit'><@fields.unitPrice /></span>
        <span class='total'>{{@model.lineTotalDisplay}}</span>
      </div>
      <style scoped>
        .line {
          --li-ink-2: var(--muted-foreground, #6b6f80);

          display: grid;
          grid-template-columns: 1fr auto auto auto;
          align-items: baseline;
          gap: var(--boxel-sp-sm, 0.75rem);
          font-size: var(--boxel-font-size-sm, 0.8125rem);
        }
        .desc {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        /* Every numeric column right-aligned and tabular, so a reader can add
           the column up by eye and spot the line that is 10x out. */
        .qty,
        .unit,
        .total {
          text-align: right;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }
        .qty,
        .unit {
          color: var(--li-ink-2);
        }
        .qty {
          min-width: 2.5rem;
        }
        .unit {
          min-width: 5.5rem;
        }
        .total {
          min-width: 6rem;
          font-weight: 600;
        }
      </style>
    </template>
  };
}

export class Invoice extends CardDef {
  static displayName = 'Invoice';

  @field invoiceNumber = contains(StringField);
  @field issuedOn = contains(DateField);
  @field dueOn = contains(DateField);
  @field currency = contains(CurrencyCodeField);
  @field lines = containsMany(LineItem);

  // DERIVED, NEVER STORED. A stored total is a second source of truth for a
  // number the lines already determine, and the two disagree the first time
  // anyone edits a line through a path that forgot to recompute. The cost is
  // recomputation on read; the alternative is an invoice whose total does not
  // match its own lines, which is the worst bug this card can have.
  get subtotal(): number {
    return roundTo(
      (this.lines ?? []).reduce((sum, line) => sum + (line.lineTotal ?? 0), 0),
      minorUnits(this.currency?.code),
    );
  }

  get taxTotal(): number {
    return roundTo(
      (this.lines ?? []).reduce(
        (sum, line) => sum + (line.lineTotal ?? 0) * (line.taxRate?.rate ?? 0),
        0,
      ),
      minorUnits(this.currency?.code),
    );
  }

  get total(): number {
    return roundTo(
      this.subtotal + this.taxTotal,
      minorUnits(this.currency?.code),
    );
  }

  get subtotalDisplay() {
    return formatIn(this.subtotal, this.currency?.code);
  }
  get taxTotalDisplay() {
    return formatIn(this.taxTotal, this.currency?.code);
  }
  get totalDisplay() {
    return formatIn(this.total, this.currency?.code);
  }

  get label() {
    return this.invoiceNumber ?? 'Invoice';
  }

  // A record vendor's job includes saying when a record is questionable, and
  // NOT refusing to hold it. An invoice denominated in a withdrawn currency is
  // a real invoice — it just needs a human to look.
  get currencyWarning(): string | undefined {
    let code = this.currency?.code;
    if (!code) {
      return undefined;
    }
    return isActive(code)
      ? undefined
      : `${code.toUpperCase()} is not a current ISO 4217 code`;
  }

  static atom = class Atom extends Component<typeof Invoice> {
    <template>
      <span class='atom'>{{@model.label}}
        <span class='sum'>{{@model.totalDisplay}}</span></span>
      <style scoped>
        .atom {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }
        .sum {
          color: var(--muted-foreground, #6b6f80);
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof Invoice> {
    <template>
      <div class='row'>
        <span class='num'>{{@model.label}}</span>
        {{#if @model.currencyWarning}}
          <span class='flag' title={{@model.currencyWarning}}>historic</span>
        {{/if}}
        <span class='sum'>{{@model.totalDisplay}}</span>
      </div>
      <style scoped>
        /* No border, radius or fill: the PARENT draws the chrome around an
           embedded card, and a second frame inside it reads as a mistake. */
        .row {
          display: grid;
          grid-template-columns: 1fr auto auto;
          align-items: baseline;
          gap: var(--boxel-sp-xs, 0.625rem);
          font-family: var(--font-sans, system-ui, sans-serif);
          font-size: var(--boxel-font-size-sm, 0.8125rem);
        }
        .num {
          font-family: var(--font-mono, ui-monospace, monospace);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .flag {
          padding: 0 var(--boxel-sp-xxs, 0.5rem);
          border-radius: 999px;
          background: color-mix(in srgb, currentColor 12%, transparent);
          color: #a35c00;
          font-size: var(--boxel-font-size-xs, 0.6875rem);
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }
        .sum {
          font-variant-numeric: tabular-nums;
          font-weight: 600;
          white-space: nowrap;
        }
      </style>
    </template>
  };

  // A grid slot whose size this card does not control: it might be a badge, a
  // strip, a tile or a card. Container queries answer all four from one
  // template, and there is deliberately NO border or radius — for a fitted
  // format the parent draws the chrome.
  static fitted = class Fitted extends Component<typeof Invoice> {
    <template>
      <div class='fit'>
        <span class='num'>{{@model.label}}</span>
        <span class='sum'>{{@model.totalDisplay}}</span>
        <span class='meta'>due
          <@fields.dueOn /></span>
      </div>
      <style scoped>
        .fit {
          --iv-ink: var(--foreground, #16181f);
          --iv-ink-2: var(--muted-foreground, #6b6f80);

          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 0.1rem;
          width: 100%;
          height: 100%;
          padding: var(--boxel-sp-xs, 0.625rem);
          color: var(--iv-ink);
          font-family: var(--font-sans, system-ui, sans-serif);
          overflow: hidden;
        }
        .num {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: var(--boxel-font-size-xs, 0.6875rem);
          color: var(--iv-ink-2);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .sum {
          font-variant-numeric: tabular-nums;
          font-weight: 600;
          white-space: nowrap;
        }
        .meta {
          font-size: var(--boxel-font-size-xs, 0.6875rem);
          color: var(--iv-ink-2);
          white-space: nowrap;
        }
        /* BADGE. Room for the number the reader is looking for, nothing else. */
        @container (max-width: 9rem) {
          .sum,
          .meta {
            display: none;
          }
          .num {
            color: var(--iv-ink);
          }
        }
        /* STRIP. The number and what it costs. */
        @container (min-width: 9rem) and (max-width: 15rem) {
          .meta {
            display: none;
          }
        }
        /* TILE and CARD. The amount becomes the hero. */
        @container (min-width: 15rem) {
          .sum {
            font-size: 1.125rem;
          }
        }
        @container (min-width: 24rem) {
          .fit {
            padding: var(--boxel-sp-sm, 0.75rem);
          }
          .sum {
            font-size: 1.375rem;
          }
        }
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof Invoice> {
    <template>
      <article class='invoice'>
        <header class='head'>
          <div class='id'>
            <p class='eyebrow'>Invoice</p>
            <h1>{{@model.label}}</h1>
          </div>
          <dl class='dates'>
            <div><dt>Issued</dt><dd><@fields.issuedOn /></dd></div>
            <div><dt>Due</dt><dd><@fields.dueOn /></dd></div>
            <div><dt>Currency</dt><dd><@fields.currency /></dd></div>
          </dl>
        </header>

        {{#if @model.currencyWarning}}
          {{! Marked, never refused. A record vendor says when a record is
              questionable and still holds it. }}
          <p class='notice' role='status'>{{@model.currencyWarning}}</p>
        {{/if}}

        <table class='lines'>
          <thead>
            <tr>
              <th class='c-desc'>Description</th>
              <th class='c-num'>Qty</th>
              <th class='c-num'>Unit</th>
              <th class='c-num'>Amount</th>
            </tr>
          </thead>
          <tbody>
            {{#each @model.lines as |line|}}
              <tr>
                <td class='c-desc'>{{line.description}}</td>
                <td class='c-num'>{{line.quantity}}</td>
                <td class='c-num quiet'>{{line.unitPrice.display}}</td>
                <td class='c-num strong'>{{line.lineTotalDisplay}}</td>
              </tr>
            {{/each}}
          </tbody>
        </table>

        <dl class='totals'>
          <div><dt>Subtotal</dt><dd>{{@model.subtotalDisplay}}</dd></div>
          <div><dt>Tax</dt><dd>{{@model.taxTotalDisplay}}</dd></div>
          <div class='grand'><dt>Total</dt><dd>{{@model.totalDisplay}}</dd></div>
        </dl>
      </article>

      <style scoped>
        .invoice {
          /* Each fallback stated once at the root; every read below is a bare
             var(), so a theme can move any of them without this file holding a
             second opinion. */
          --iv-surface: var(--card, #ffffff);
          --iv-ink: var(--foreground, #16181f);
          --iv-ink-2: var(--muted-foreground, #6b6f80);
          --iv-line: var(--border, #e3e5ec);
          --iv-warn: #a35c00;
          --iv-sp: var(--boxel-sp, 1rem);
          --iv-sp-lg: var(--boxel-sp-lg, 1.5rem);
          --iv-sp-sm: var(--boxel-sp-xs, 0.625rem);
          --iv-mono: var(--font-mono, ui-monospace, monospace);

          display: flex;
          flex-direction: column;
          gap: var(--iv-sp-lg);
          padding: var(--iv-sp-lg);
          background-color: var(--iv-surface);
          color: var(--iv-ink);
          font-family: var(--font-sans, system-ui, sans-serif);
          font-size: var(--boxel-font-size, 0.875rem);
        }

        .head {
          display: flex;
          flex-wrap: wrap;
          align-items: flex-start;
          justify-content: space-between;
          gap: var(--iv-sp);
        }
        .eyebrow {
          margin: 0;
          color: var(--iv-ink-2);
          font-size: var(--boxel-font-size-xs, 0.6875rem);
          font-weight: 600;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .head h1 {
          margin: 0.15rem 0 0;
          font-family: var(--iv-mono);
          font-size: 1.25rem;
          font-weight: 600;
        }
        .dates {
          display: flex;
          flex-wrap: wrap;
          gap: var(--iv-sp-lg);
          margin: 0;
        }
        .dates dt {
          color: var(--iv-ink-2);
          font-size: var(--boxel-font-size-xs, 0.6875rem);
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }
        .dates dd {
          margin: 0.1rem 0 0;
          font-variant-numeric: tabular-nums;
        }

        .notice {
          margin: 0;
          padding: var(--iv-sp-sm) var(--iv-sp);
          border-radius: var(--boxel-border-radius-sm, 0.5rem);
          background: color-mix(in srgb, var(--iv-warn) 10%, transparent);
          color: var(--iv-warn);
          font-size: var(--boxel-font-size-sm, 0.8125rem);
        }

        .lines {
          width: 100%;
          border-collapse: collapse;
        }
        .lines th {
          padding: 0 0 var(--iv-sp-sm);
          border-bottom: 1px solid var(--iv-line);
          color: var(--iv-ink-2);
          font-size: var(--boxel-font-size-xs, 0.6875rem);
          font-weight: 600;
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }
        .lines td {
          padding: var(--iv-sp-sm) 0;
          border-bottom: 1px solid var(--iv-line);
        }
        .c-desc {
          text-align: left;
        }
        /* The whole reason for a table rather than a list: one decimal column,
           right-aligned and tabular, so the eye can add it up. */
        .c-num {
          width: 1%;
          padding-left: var(--iv-sp-lg);
          text-align: right;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }
        .quiet {
          color: var(--iv-ink-2);
        }
        .strong {
          font-weight: 600;
        }

        .totals {
          display: grid;
          /* Sits under the amount column, right-aligned, the way every invoice
             anyone has been handed does it. */
          justify-content: end;
          gap: 0.35rem;
          margin: 0;
        }
        .totals > div {
          display: grid;
          grid-template-columns: auto minmax(7rem, auto);
          gap: var(--iv-sp-lg);
        }
        .totals dt {
          color: var(--iv-ink-2);
        }
        .totals dd {
          margin: 0;
          text-align: right;
          font-variant-numeric: tabular-nums;
        }
        .grand {
          margin-top: 0.35rem;
          padding-top: 0.5rem;
          border-top: 1px solid var(--iv-line);
          font-size: 1.0625rem;
          font-weight: 700;
        }
        .grand dt {
          color: var(--iv-ink);
        }

        @container (max-width: 30rem) {
          .invoice {
            padding: var(--iv-sp);
          }
          .c-num:nth-child(2),
          .c-num:nth-child(3) {
            display: none;
          }
        }
      </style>
    </template>
  };
}

// Formatted in the invoice's own currency. Layer 02 owns money FORMATTING, and
// this asks the platform the same way it does rather than inventing a second
// opinion about where a symbol goes.
function formatIn(value: number, code: string | undefined): string {
  let currency = (code ?? 'USD').trim().toUpperCase();
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
    }).format(value);
  } catch {
    // An unrecognised code is an authoring mistake, not a reason to hide the
    // number the ledger actually holds.
    return `${value} ${currency}`;
  }
}

// Rounds at a stated number of decimal places. `Math.round(x * 100) / 100` is
// the version everybody writes and it is wrong for 1.005 — the float is
// fractionally under, so it rounds DOWN and a cent goes missing. The epsilon
// nudge is the cheap fix that keeps this honest without pulling in a decimal
// library, which layer 05 has no business choosing for its consumers.
function roundTo(value: number, places: number): number {
  let factor = 10 ** places;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
