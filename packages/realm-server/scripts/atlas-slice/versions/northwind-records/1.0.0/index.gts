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

// THE FIRST PACKAGE IN THE SLICE WITH DEPENDENCIES, which is the whole point
// of it. Everything published before this one stands alone; this one names two
// upstream packages by RANGE and receives two exact PINS at seal time.
import { MoneyField, PercentField } from 'cardstack/contracts';
import { CurrencyCodeField, minorUnits, isActive } from 'iso/money-codes';

// northwind/records — layer 05, Domain Record Types.
//
// A RECORD VENDOR SELLS SHAPE. Not formatting (layer 02 owns that), not
// controls (layer 03), not codes (layer 04) — the answer to "what IS an
// invoice", agreed once so that ten downstream systems stop each inventing
// their own nearly-compatible version.
//
// WHAT THE RANGES SAY, AND WHAT THE PINS SAY. This package declares
// `cardstack/contracts: ^1.0.0` and `iso/money-codes: ^1.0.0`. Those are what
// the AUTHOR would accept. At publish the resolver walks the store and writes
// down what those ranges actually resolved to ON THAT DAY, and the pack keeps
// both — so a reader a year later can see that this Version shipped against
// `iso/money-codes@1.1.0` while its author would equally have taken 1.0.0.
// A range alone cannot answer "what was this tested against"; a pin alone
// cannot answer "what else was acceptable". Keeping both is the only way to
// answer either.
//
// AND THE ONE THAT MATTERS: `^1.0.0` on the code list means this Version is
// sealed against a SNAPSHOT OF THE WORLD. That is deliberate. An invoice's
// total is arithmetic over its own currency's minor units, and if the register
// changes underneath a sealed record the arithmetic silently changes with it.
// Better to move deliberately, by republishing, than to have last month's
// totals quietly restated.

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
    // than assumed to be two. JPY has none and KWD has three, so a hardcoded
    // 2 is wrong in both directions — and wrong in a way that only shows up as
    // a one-cent discrepancy months later.
    return roundTo(price * quantity, minorUnits(this.unitPrice?.currency));
  }

  static embedded = class Embedded extends Component<typeof LineItem> {
    <template>
      <div class='line'>
        <span class='desc'>{{@model.description}}</span>
        <span class='qty'>×{{@model.quantity}}</span>
        <span class='unit'><@fields.unitPrice /></span>
      </div>
      <style scoped>
        .line {
          display: grid;
          grid-template-columns: 1fr auto auto;
          align-items: baseline;
          gap: var(--boxel-sp-xs, 0.625rem);
        }
        .qty {
          color: var(--muted-foreground, #6b6f80);
          font-variant-numeric: tabular-nums;
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

  // DERIVED, NOT STORED, and worth saying why: a stored total is a second
  // source of truth for a number the lines already determine, and the two
  // disagree the first time anyone edits a line through any path that forgets
  // to recompute. The cost is recomputation on read; the alternative is an
  // invoice whose total does not match its own lines, which is the single
  // worst bug this card can have.
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

  static isolated = class Isolated extends Component<typeof Invoice> {
    <template>
      <article class='invoice'>
        <header>
          <h2>Invoice {{@model.invoiceNumber}}</h2>
          <p class='dates'>
            Issued
            <@fields.issuedOn />
            · due
            <@fields.dueOn />
          </p>
          {{#if @model.currencyWarning}}
            <p class='warn' role='status'>{{@model.currencyWarning}}</p>
          {{/if}}
        </header>

        <ul class='lines'>
          {{#each @model.lines as |line|}}
            <li><LineItem.embedded @model={{line}} /></li>
          {{/each}}
        </ul>

        <dl class='totals'>
          <dt>Subtotal</dt>
          <dd>{{@model.subtotal}}</dd>
          <dt>Tax</dt>
          <dd>{{@model.taxTotal}}</dd>
          <dt class='grand'>Total</dt>
          <dd class='grand'>{{@model.total}}
            <@fields.currency /></dd>
        </dl>
      </article>
      <style scoped>
        .invoice {
          --nw-ink: var(--foreground, #1c1e26);
          --nw-ink-2: var(--muted-foreground, #6b6f80);
          --nw-line: var(--border, #dfe1ea);
          --nw-warn: var(--destructive, #b3261e);
          --nw-sp: var(--boxel-sp, 1rem);

          display: flex;
          flex-direction: column;
          gap: var(--nw-sp);
          padding: var(--nw-sp);
          color: var(--nw-ink);
          font-family: var(--font-sans, system-ui, sans-serif);
        }
        h2 {
          margin: 0;
          font-size: 1.125rem;
        }
        .dates {
          margin: 0.25rem 0 0;
          color: var(--nw-ink-2);
          font-size: 0.8125rem;
        }
        .warn {
          margin: 0.5rem 0 0;
          color: var(--nw-warn);
          font-size: 0.8125rem;
        }
        .lines {
          margin: 0;
          padding: 0;
          list-style: none;
          border-top: 1px solid var(--nw-line);
        }
        .lines li {
          padding: 0.5rem 0;
          border-bottom: 1px solid var(--nw-line);
        }
        .totals {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 0.25rem var(--nw-sp);
          margin: 0;
          justify-items: end;
        }
        .totals dt {
          justify-self: start;
          color: var(--nw-ink-2);
        }
        .totals dd {
          margin: 0;
          font-variant-numeric: tabular-nums;
        }
        .grand {
          font-weight: 700;
          color: var(--nw-ink);
        }
      </style>
    </template>
  };
}

// Rounds at a stated number of decimal places. `Math.round(x * 100) / 100`
// is the version everybody writes and it is wrong for 1.005 — the float is
// fractionally under, so it rounds DOWN and a cent goes missing. The epsilon
// nudge is the cheap fix that keeps this honest without pulling in a decimal
// library, which layer 05 has no business deciding for its consumers.
function roundTo(value: number, places: number): number {
  let factor = 10 ** places;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
