import {
  FieldDef,
  Component,
  contains,
  field,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import NumberField from '@cardstack/base/number';

// cardstack/contracts — layer 02, Universal Value & Render Contracts.
//
// PASS 2, after reading pass 1 back. `{{@model.value}} {{@model.currency}}`
// printed `1200 USD` where every other piece of financial software on the
// planet prints `$1,200.00`, and it printed `1200 JPY` where the correct
// answer is `¥1,200` — yen has no minor units. Pass 1 had no table of that
// and was never going to grow a correct one.
//
// THE FIX IS ONE CALL. `Intl.NumberFormat` with `style: 'currency'` knows the
// symbol, WHERE THE SYMBOL GOES (kr trails in sv-SE, $ leads in en-US), the
// grouping separator, the decimal separator, and the minor-unit count for
// every ISO 4217 code — all of it locale-aware, all of it maintained by the
// platform rather than by us. A hand-rolled formatter is a hundred lines and
// a permanent bug queue. This is the single highest-leverage change the
// package will ever make.
//
// WHY 0.2.0 AND NOT 0.1.1. Under 0.x a MINOR is the compatibility boundary —
// `^0.1.0` does not admit 0.2.0, by npm's rule and ours. That is deliberate
// here: PercentField is new API, and a consumer pinned to `^0.1.0` should have
// to opt in rather than silently receive a differently-rendered money field
// on their next index. Documented so that when B7 asserts `^0.1.0` excludes
// 0.2.0, the reason is a decision rather than a coincidence.

// ISO 4217 codes are upper case, and an author typing 'usd' is not naming a
// different currency. Normalising on READ leaves the stored bytes exactly as
// authored while making every `Intl` call below total.
function normalise(raw: string | undefined): string {
  return typeof raw === 'string' && raw.trim()
    ? raw.trim().toUpperCase()
    : 'USD';
}

function formatMoney(
  value: number | undefined,
  currency: string | undefined,
): string | undefined {
  if (value == null) {
    return undefined;
  }
  let code = normalise(currency);
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: code,
    }).format(value);
  } catch {
    // An unrecognised code is an authoring mistake, not a reason to hide the
    // number the ledger actually holds. Show it plainly and let the odd-looking
    // code be the thing that gets noticed.
    return `${value} ${code}`;
  }
}

export class MoneyField extends FieldDef {
  static displayName = 'Money';

  @field value = contains(NumberField);
  @field currency = contains(StringField);

  static embedded = class Embedded extends Component<typeof MoneyField> {
    get formatted() {
      return formatMoney(this.args.model?.value, this.args.model?.currency);
    }

    // What a screen reader should hear. The visual form is compact and the
    // symbol alone is ambiguous — '$' is at least five different currencies —
    // so the label spells the code out.
    get spoken() {
      let value = this.args.model?.value;
      return value == null
        ? 'no amount'
        : `${value} ${normalise(this.args.model?.currency)}`;
    }

    <template>
      {{#if this.formatted}}
        <span class='money' aria-label={{this.spoken}}>
          {{this.formatted}}
          <span class='stamp'>cardstack/contracts 0.2.0</span>
        </span>
      {{else}}
        <span class='money empty' aria-label='no amount'>
          —
          <span class='stamp'>cardstack/contracts 0.2.0</span>
        </span>
      {{/if}}
      <style scoped>
        .money {
          font-family: ui-monospace, monospace;
          font-variant-numeric: tabular-nums;
          color: #333;
        }
        .empty {
          color: #aab;
        }
        .stamp {
          margin-left: 0.4em;
          font-size: 0.65em;
          color: #99a;
          white-space: nowrap;
        }
      </style>
    </template>
  };
}

// New in 0.2.0. Tax lines, discount lines and interest rates were all being
// stored as bare numbers by consumers, each with their own opinion about
// whether 8.25 meant 8.25% or 825%. Layer 02 owes them one answer.
export class PercentField extends FieldDef {
  static displayName = 'Percent';

  // Stored as a FRACTION — 0.0825, not 8.25 — because that is what every
  // arithmetic consumer wants and because `Intl` with `style: 'percent'`
  // expects it. Storing the display form is how a tax line ends up a hundred
  // times too large exactly once, in production.
  @field rate = contains(NumberField);

  static embedded = class Embedded extends Component<typeof PercentField> {
    get shown() {
      let rate = this.args.model?.rate;
      if (rate == null) {
        return undefined;
      }
      return new Intl.NumberFormat(undefined, {
        style: 'percent',
        minimumFractionDigits: 0,
        // Three, so a rate like 0.00125 (12.5 basis points) survives instead
        // of rounding to 0%.
        maximumFractionDigits: 3,
      }).format(rate);
    }

    <template>
      {{#if this.shown}}
        <span class='pct'>{{this.shown}}</span>
      {{else}}
        <span class='pct empty' aria-label='no rate'>—</span>
      {{/if}}
      <style scoped>
        .pct {
          font-family: ui-monospace, monospace;
          font-variant-numeric: tabular-nums;
        }
        .empty {
          color: #aab;
        }
      </style>
    </template>
  };
}
