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

// northwind/records 1.3.0 — the 1.x line, wearing the house style.
//
// A STYLE PASS ON A MAINTAINED LINE. 1.2.0's fields are untouched: `lines`,
// `currency.code`, no `billTo`. Every consumer of ^1.0.0 can take this without
// reading, which is what makes it a minor and not a major — but a screenshot
// test will see it, which is what makes it a minor and not a patch.
//
// It goes out beside 2.1.0 on purpose. The slice's argument is that a realm can
// hold several generations of one package at once, and that argument is easier
// to believe when the generations LOOK like generations: 1.0.1 still draws its
// tables with borders and its status with a wash, because 1.0.1 is what it was.
//
// Three changes, each a rule: table rules become inset shadows (depth is one
// property); the status becomes a ringed chip derived from a single hue (one
// hue in, a complete treatment out); the withdrawn-code notice stops being a
// hand-picked brown. Every value is a theme token with its fallback stated
// once at the component root.
//
// // northwind/records — layer 05, Domain Record Types.
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
//
// ─── PASS 3 (1.1.1): the columns were touching ──────────────────────────────
//
// 1.1.0 rendered `3$1,200.00$3,600.00` — three numbers with no gutter between
// them, which is worse than a list, because a list at least does not invite
// you to read two figures as one.
//
// A SPECIFICITY LOSS, not a missing rule. The gutter lived on `.c-num`
// (0,1,0) and the cell padding on `.lines td` (0,1,1), so the padding won and
// zeroed it. Scoping the column rule to `.lines .c-num` (0,2,0) puts it back
// on top. Worth naming rather than silently fixing: this is the failure mode
// of styling a table by element AND by column at the same time, and the
// symptom — numbers running together — is exactly the thing the table was
// introduced to prevent.
//
// ─── PASS 4 (1.2.0): a record that says its own name ────────────────────────
//
// Every invoice reported itself as "Untitled Invoice" — in the browser tab, in
// the stack header, in the workspace feed, and inside anything that linked to
// one. The number was in the record the whole time; nothing was asking for it.
// `CardDef.cardTitle` computes from `cardInfo.name` and falls back to
// `Untitled <displayName>`, so a card that HAS a natural name has to say so.
//
// OVERRIDDEN, rather than asking authors to type the number a second time into
// `cardInfo.name`. The invoice number IS the invoice's name, and a second copy
// that can drift from the field beside it is worse than no copy.
//
// Also here: `cardDescription`, which is the line under the name in every
// list; and a STATUS the document can lead with, since "is this overdue" is
// the question anyone opening an invoice is actually asking.
//
// STATUS IS A PLAIN GETTER AND NOT A `@field`, deliberately. It depends on
// today's date. An indexed field whose value changes with the clock is stale
// the moment it is written and invalidates itself forever; a getter is
// recomputed at render, which is exactly when the answer is wanted.
//
// COMPATIBLE: two computed fields and a redesign of one format. Nothing moved.

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

  // The invoice number is the invoice's name. The base fallback is kept for
  // the record that genuinely has no number yet.
  @field cardTitle = contains(StringField, {
    computeVia: function (this: Invoice) {
      return this.invoiceNumber?.trim()?.length
        ? this.invoiceNumber
        : `Untitled ${this.constructor.displayName}`;
    },
  });

  // The line under the name in a list: what it costs, and when it is wanted.
  @field cardDescription = contains(StringField, {
    computeVia: function (this: Invoice) {
      let due = this.dueOn
        ? new Intl.DateTimeFormat(undefined, {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          }).format(this.dueOn)
        : undefined;
      return due
        ? `${this.totalDisplay} · due ${due}`
        : (this.totalDisplay ?? '');
    },
  });

  // Where this invoice stands TODAY. A getter and not a field — see the
  // header note: a stored answer to a question about the current date is
  // wrong within a day of being written.
  get status(): 'overdue' | 'due-soon' | 'open' {
    if (!this.dueOn) {
      return 'open';
    }
    // Compared at day granularity. An invoice due today is not overdue at
    // 9am and overdue at 5pm, and a comparison of raw timestamps would say
    // exactly that.
    let today = new Date();
    let startOfToday = Date.UTC(
      today.getUTCFullYear(),
      today.getUTCMonth(),
      today.getUTCDate(),
    );
    let due = Date.UTC(
      this.dueOn.getUTCFullYear(),
      this.dueOn.getUTCMonth(),
      this.dueOn.getUTCDate(),
    );
    let days = Math.round((due - startOfToday) / 86_400_000);
    if (days < 0) {
      return 'overdue';
    }
    return days <= 7 ? 'due-soon' : 'open';
  }

  get statusLabel(): string {
    return { overdue: 'Overdue', 'due-soon': 'Due soon', open: 'Open' }[
      this.status
    ];
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
        {{! Status rather than the raw due date: at tile size a reader has
            room for one more fact, and "Overdue" is worth more than a date
            they would have to compare against today themselves. }}
        <span class='meta status-{{@model.status}}'>{{@model.statusLabel}}</span>
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
          font-weight: 600;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          white-space: nowrap;
        }
        .meta.status-due-soon {
          color: var(--primary, #3d6bff);
        }
        .meta.status-overdue {
          color: var(--destructive, #b3261e);
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
            {{! The question a reader opens an invoice to answer, answered
                before they have to work it out from two dates. }}
            <p class='status status-{{@model.status}}'>{{@model.statusLabel}}</p>
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
          <div class='notice' role='status'>
            <span class='notice-title'>Withdrawn code</span>
            <span>{{@model.currencyWarning}}</span>
          </div>
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
          --iv-line-strong: var(--line-strong, #c9ccd8);
          --iv-accent: var(--primary, #3d6bff);
          --iv-accent-ink: var(--pretui-primary-ink, var(--primary, #3d6bff));
          --iv-warn: var(--warning, #a35c00);
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
        /* the eyebrow voice: small-caps mono, the house signature */
        .eyebrow {
          margin: 0;
          font-family: var(--iv-mono);
          color: var(--iv-ink-2);
          font-size: 11px;
          font-weight: 500;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .head h1 {
          margin: 0.15rem 0 0;
          font-family: var(--iv-mono);
          font-size: 1.35rem;
          font-weight: 600;
          letter-spacing: -0.01em;
          font-variant-numeric: tabular-nums;
        }
        /* Tinted from the status colour itself, so one declaration per state
           sets both the text and its wash. */
        /* A status is a discrete state, so it wears the chip: a hue-derived
           surface, hue-derived ink, and a ring — not a wash of currentColor. */
        .status {
          display: inline-flex;
          align-items: center;
          margin: 0.45rem 0 0;
          padding: 1px 8px;
          border-radius: var(--radius-chip, 6px);
          background: color-mix(in srgb, currentColor 16%, var(--iv-surface));
          box-shadow: 0 0 0 1px
            color-mix(in srgb, currentColor 40%, var(--iv-line));
          font-family: var(--iv-mono);
          font-size: 10.5px;
          font-weight: 500;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .status-open {
          color: var(--iv-ink-2);
        }
        .status-due-soon {
          color: var(--primary, #3d6bff);
        }
        .status-overdue {
          color: var(--destructive, #b3261e);
        }
        .dates {
          display: flex;
          flex-wrap: wrap;
          gap: var(--iv-sp-lg);
          margin: 0;
        }
        .dates dt {
          font-family: var(--iv-mono);
          color: var(--iv-ink-2);
          font-size: 10.5px;
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }
        .dates dd {
          margin: 0.2rem 0 0;
          font-variant-numeric: tabular-nums;
        }

        /* Law 2 — one hue in, a complete treatment out: the surface, the ink
           and the ring are all derived from --iv-warn, never hand-picked. */
        .notice {
          display: grid;
          gap: 3px;
          margin: 0;
          padding: 9px 12px;
          border-radius: var(--radius, 10px);
          background: color-mix(in srgb, var(--iv-warn) 16%, var(--iv-surface));
          color: color-mix(in srgb, var(--iv-ink) 46%, var(--iv-warn));
          box-shadow: 0 0 0 1px
            color-mix(in srgb, var(--iv-warn) 30%, var(--iv-line));
          font-size: 12.5px;
          line-height: 1.5;
        }
        .notice-title {
          font-weight: 600;
          color: color-mix(in srgb, var(--iv-ink) 60%, var(--iv-warn));
        }

        .lines {
          width: 100%;
          border-collapse: collapse;
        }
        /* Law 1 — depth is ONE property. These rules are inset shadows, not
           borders, so every separation in the card sits on one ladder. */
        .lines th {
          padding: 0 0 var(--iv-sp-sm);
          box-shadow: inset 0 -1px 0 var(--iv-line-strong);
          font-family: var(--iv-mono);
          color: var(--iv-ink-2);
          font-size: 10.5px;
          font-weight: 500;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .lines td {
          padding: var(--iv-sp-sm) 0;
          box-shadow: inset 0 -1px 0 var(--iv-line);
        }
        .lines .c-desc {
          text-align: left;
        }
        /* The whole reason for a table rather than a list: one decimal column,
           right-aligned and tabular, so the eye can add it up. */
        /* Scoped to `.lines` so it outranks `.lines td` — see the header
           note. Without that the gutter is silently dropped. */
        .lines .c-num {
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
          padding-top: 0.6rem;
          box-shadow: inset 0 1px 0 var(--iv-line-strong);
          font-size: 1.125rem;
          font-weight: 600;
          letter-spacing: -0.02em;
        }
        .grand dt {
          color: var(--iv-ink);
        }

        @container (max-width: 30rem) {
          .invoice {
            padding: var(--iv-sp);
          }
          .lines .c-num:nth-child(2),
          .lines .c-num:nth-child(3) {
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
