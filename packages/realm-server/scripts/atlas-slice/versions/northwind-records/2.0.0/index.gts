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
import { minorUnits, isActive } from 'iso/money-codes';

// northwind/records 2.0.0 — THE BREAKING ONE.
//
// This Version exists to be searched ACROSS, not to be admired. Every other
// Version in this slice is compatible with its predecessor; this one is not,
// and it is not gently incompatible either. It changes shape in all four ways
// a major can:
//
//   KEPT IDENTICAL   `invoiceNumber`, `issuedOn`, `dueOn`
//                    — the fields a consumer can rely on across the boundary
//   SAME NAME, NEW SHAPE
//                    `currency` was `contains(CurrencyCodeField)`, addressed as
//                    `currency.code`. It is now a plain string. A filter
//                    written against 1.x addresses a field path that does not
//                    exist here.
//   RENAMED          `lines` → `items`, and the line's own `description`
//                    → `label`. Two levels of rename at once.
//   ADDED            `billTo`, which 1.x has no equivalent for at all.
//
// WHY A STRING FOR CURRENCY, WHEN 1.x HAD A FIELD. Because it is the change
// that hurts most and is therefore the one worth testing. A renamed field is
// obvious — a query naming `lines` on a card that has `items` is visibly wrong.
// A field that keeps its NAME and changes its INTERNAL SHAPE is the one that
// looks like it should work: `currency` is still there, still called currency,
// and `currency.code` still reads like a sentence. It is exactly the shape of
// mistake that survives review.
//
// The reduction is also defensible on its own terms rather than being damage
// invented for a test: 1.x stored a one-field object so the code list could
// hang validation off it, and a plain ISO string with the register consulted at
// use time is a legitimate simplification. Majors usually are legitimate. That
// is what makes them dangerous.
//
// WHAT THIS IS FOR. `README.md` §8 asks whether the index can unify search
// results across a major boundary when the shape moves underneath. The honest
// answer is "for the fields that survived, and not otherwise" — and this
// Version is what lets that be demonstrated with real rows rather than asserted.

// The line item, renamed and reshaped. `description` → `label`, and the
// per-line tax rate is gone: 2.0.0 moves tax to the invoice, which is the other
// half of the simplification and another field path that 1.x queries will miss.
export class Charge extends FieldDef {
  static displayName = 'Charge';

  @field label = contains(StringField);
  @field quantity = contains(NumberField);
  @field unitPrice = contains(MoneyField);

  get lineTotal(): number | undefined {
    let price = this.unitPrice?.value;
    let quantity = this.quantity;
    if (price == null || quantity == null) {
      return undefined;
    }
    return roundTo(price * quantity, minorUnits(this.unitPrice?.currency));
  }

  static embedded = class Embedded extends Component<typeof Charge> {
    <template>
      <div class='line'>
        <span class='label'>{{@model.label}}</span>
        <span class='qty'>{{@model.quantity}}</span>
        <span class='unit'><@fields.unitPrice /></span>
      </div>
      <style scoped>
        .line {
          display: grid;
          grid-template-columns: 1fr auto auto;
          align-items: baseline;
          gap: var(--boxel-sp-sm, 0.75rem);
          font-size: var(--boxel-font-size-sm, 0.8125rem);
        }
        .qty,
        .unit {
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }
        .qty {
          color: var(--muted-foreground, #6b6f80);
        }
      </style>
    </template>
  };
}

export class Invoice extends CardDef {
  static displayName = 'Invoice';

  // ─── SURVIVED THE BOUNDARY ────────────────────────────────────────────────
  @field invoiceNumber = contains(StringField);
  @field issuedOn = contains(DateField);
  @field dueOn = contains(DateField);

  // ─── SAME NAME, DIFFERENT SHAPE ───────────────────────────────────────────
  // 1.x: `contains(CurrencyCodeField)`, addressed as `currency.code`.
  // 2.0.0: the code itself. `currency.code` addresses nothing here.
  @field currency = contains(StringField);

  // ─── RENAMED ──────────────────────────────────────────────────────────────
  // 1.x called this `lines`, of a `LineItem` whose text field was
  // `description`. Both names moved.
  @field items = containsMany(Charge);

  // ─── ADDED ────────────────────────────────────────────────────────────────
  @field billTo = contains(StringField);
  // Tax is per-invoice now rather than per-line.
  @field taxRate = contains(PercentField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: Invoice) {
      return this.invoiceNumber?.trim()?.length
        ? this.invoiceNumber
        : `Untitled ${this.constructor.displayName}`;
    },
  });

  @field cardDescription = contains(StringField, {
    computeVia: function (this: Invoice) {
      return this.billTo ? `${this.totalDisplay} · ${this.billTo}` : this.totalDisplay;
    },
  });

  get subtotal(): number {
    return roundTo(
      (this.items ?? []).reduce((sum, line) => sum + (line.lineTotal ?? 0), 0),
      minorUnits(this.currency),
    );
  }

  get taxTotal(): number {
    return roundTo(this.subtotal * (this.taxRate?.rate ?? 0), minorUnits(this.currency));
  }

  get total(): number {
    return roundTo(this.subtotal + this.taxTotal, minorUnits(this.currency));
  }

  get subtotalDisplay() {
    return formatIn(this.subtotal, this.currency);
  }
  get taxTotalDisplay() {
    return formatIn(this.taxTotal, this.currency);
  }
  get totalDisplay() {
    return formatIn(this.total, this.currency);
  }

  get label() {
    return this.invoiceNumber ?? 'Invoice';
  }

  get currencyWarning(): string | undefined {
    let code = this.currency;
    if (!code) {
      return undefined;
    }
    return isActive(code)
      ? undefined
      : `${code.toUpperCase()} is not a current ISO 4217 code`;
  }

  static atom = class Atom extends Component<typeof Invoice> {
    <template>
      <span>{{@model.label}}</span>
    </template>
  };

  static embedded = class Embedded extends Component<typeof Invoice> {
    <template>
      <div class='row'>
        <span class='num'>{{@model.label}}</span>
        <span class='sum'>{{@model.totalDisplay}}</span>
      </div>
      <style scoped>
        .row {
          display: grid;
          grid-template-columns: 1fr auto;
          align-items: baseline;
          gap: var(--boxel-sp-xs, 0.625rem);
          font-size: var(--boxel-font-size-sm, 0.8125rem);
        }
        .num {
          font-family: var(--font-mono, ui-monospace, monospace);
        }
        .sum {
          font-variant-numeric: tabular-nums;
          font-weight: 600;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof Invoice> {
    <template>
      <div class='fit'>
        <span class='num'>{{@model.label}}</span>
        <span class='sum'>{{@model.totalDisplay}}</span>
        <span class='meta'>{{@model.billTo}}</span>
      </div>
      <style scoped>
        .fit {
          --iv-ink-2: var(--muted-foreground, #6b6f80);

          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 0.1rem;
          width: 100%;
          height: 100%;
          padding: var(--boxel-sp-xs, 0.625rem);
          overflow: hidden;
          font-family: var(--font-sans, system-ui, sans-serif);
        }
        .num {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: var(--boxel-font-size-xs, 0.6875rem);
          color: var(--iv-ink-2);
        }
        .sum {
          font-variant-numeric: tabular-nums;
          font-weight: 600;
        }
        .meta {
          font-size: var(--boxel-font-size-xs, 0.6875rem);
          color: var(--iv-ink-2);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        @container (max-width: 9rem) {
          .sum,
          .meta {
            display: none;
          }
        }
        @container (min-width: 24rem) {
          .sum {
            font-size: 1.25rem;
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
            <p class='eyebrow'>Invoice · v2</p>
            <h1>{{@model.label}}</h1>
          </div>
          <dl class='dates'>
            <div><dt>Billed to</dt><dd>{{@model.billTo}}</dd></div>
            <div><dt>Issued</dt><dd><@fields.issuedOn /></dd></div>
            <div><dt>Due</dt><dd><@fields.dueOn /></dd></div>
            <div><dt>Currency</dt><dd>{{@model.currency}}</dd></div>
          </dl>
        </header>

        {{#if @model.currencyWarning}}
          <p class='notice' role='status'>{{@model.currencyWarning}}</p>
        {{/if}}

        <table class='lines'>
          <thead>
            <tr>
              <th class='c-desc'>Charge</th>
              <th class='c-num'>Qty</th>
              <th class='c-num'>Unit</th>
            </tr>
          </thead>
          <tbody>
            {{#each @model.items as |line|}}
              <tr>
                <td class='c-desc'>{{line.label}}</td>
                <td class='c-num'>{{line.quantity}}</td>
                <td class='c-num quiet'>{{line.unitPrice.display}}</td>
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
        .lines .c-desc {
          text-align: left;
        }
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
        .totals {
          display: grid;
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
      </style>
    </template>
  };
}

function formatIn(value: number, code: string | undefined): string {
  let currency = (code ?? 'USD').trim().toUpperCase();
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
    }).format(value);
  } catch {
    return `${value} ${currency}`;
  }
}

function roundTo(value: number, places: number): number {
  let factor = 10 ** places;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
