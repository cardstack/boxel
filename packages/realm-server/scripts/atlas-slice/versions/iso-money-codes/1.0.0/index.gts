import {
  FieldDef,
  Component,
  contains,
  field,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';

// iso/money-codes — layer 04, Standards & Code Lists.
//
// A STANDARDS BODY SHIPS DATA, NOT BEHAVIOUR, and that changes what its
// versions mean. `cardstack/contracts` versions because someone improved the
// code. This package versions because THE WORLD CHANGED — a currency was
// introduced, redenominated, or withdrawn. Nobody refactored anything.
//
// That distinction has a consequence worth stating up front: a consumer
// pinned to `^1.0.0` here is not pinned to an old implementation, they are
// pinned to A SNAPSHOT OF REALITY. That is sometimes exactly right — an
// invoice issued in 2019 should be read against the 2019 code list, or a
// withdrawn code becomes retroactively invalid and a paid invoice starts
// failing validation. And it is sometimes badly wrong: a NEW invoice written
// against a stale list cannot name a currency that now exists.
//
// So this package deliberately does NOT validate by rejecting. `isKnown` is
// offered as information, and an unknown code still stores and still renders.
// A code list that refuses what it has not heard of turns every lag between
// the world and the registry into a data-entry failure.
//
// SCOPE. Deliberately narrow: the codes, their names, their minor units, and
// their status. Formatting belongs to `cardstack/contracts` (layer 02) and
// asking a standards package to render money would invert the layering.

export interface CurrencyRecord {
  code: string;
  name: string;
  /** ISO 4217 exponent: 2 for USD, 0 for JPY, 3 for KWD. */
  minorUnits: number;
  /** Numeric code. Present because payment rails ask for it and a consumer
   *  should not have to keep a second table to answer that. */
  numeric: string;
}

// The active list, 1.0.0. Trimmed to what the slice uses rather than all 180 —
// a fixture that claims completeness it does not have is worse than one that
// states its own scope.
const ACTIVE: CurrencyRecord[] = [
  { code: 'USD', name: 'US Dollar', minorUnits: 2, numeric: '840' },
  { code: 'EUR', name: 'Euro', minorUnits: 2, numeric: '978' },
  { code: 'GBP', name: 'Pound Sterling', minorUnits: 2, numeric: '826' },
  { code: 'JPY', name: 'Yen', minorUnits: 0, numeric: '392' },
  { code: 'CHF', name: 'Swiss Franc', minorUnits: 2, numeric: '756' },
  { code: 'SEK', name: 'Swedish Krona', minorUnits: 2, numeric: '752' },
  { code: 'CAD', name: 'Canadian Dollar', minorUnits: 2, numeric: '124' },
  { code: 'BRL', name: 'Brazilian Real', minorUnits: 2, numeric: '986' },
  { code: 'MXN', name: 'Mexican Peso', minorUnits: 2, numeric: '484' },
  // Three minor units, so anything that assumed two is wrong here. Included
  // for exactly that reason.
  { code: 'KWD', name: 'Kuwaiti Dinar', minorUnits: 3, numeric: '414' },
];

const BY_CODE: Map<string, CurrencyRecord> = new Map(
  ACTIVE.map((record) => [record.code, record]),
);

/** The list, for anyone building a picker. A copy, so a consumer cannot
 *  mutate the registry for everybody else in the page. */
export function currencies(): CurrencyRecord[] {
  return ACTIVE.map((record) => ({ ...record }));
}

export function lookup(code: string | undefined): CurrencyRecord | undefined {
  return code ? BY_CODE.get(code.trim().toUpperCase()) : undefined;
}

export function isKnown(code: string | undefined): boolean {
  return lookup(code) !== undefined;
}

/** ISO 4217 exponent, defaulting to 2 for codes this Version has not heard
 *  of. Two is the right guess — it is the overwhelming majority — and the
 *  caller can ask `isKnown` if a guess is not good enough. */
export function minorUnits(code: string | undefined): number {
  return lookup(code)?.minorUnits ?? 2;
}

export class CurrencyCodeField extends FieldDef {
  static displayName = 'Currency Code';

  // Stored as the authored string, normalised only on READ. Rewriting what
  // an author typed is how a round-trip stops being a round-trip.
  @field code = contains(StringField);

  static embedded = class Embedded extends Component<
    typeof CurrencyCodeField
  > {
    get record() {
      return lookup(this.args.model?.code);
    }

    get shown() {
      return this.args.model?.code?.trim().toUpperCase();
    }

    <template>
      {{#if this.shown}}
        <span
          class='code {{unless this.record "is-unknown"}}'
          title={{if this.record this.record.name 'Not in ISO 4217 1.0.0'}}
        >
          {{this.shown}}
          {{#if this.record}}
            <span class='name'>{{this.record.name}}</span>
          {{else}}
            {{! Marked, NOT rejected. The registry lagging the world is a fact
                about the registry, and turning it into a validation failure
                makes the standards body everybody's blocker. }}
            <span class='name unknown'>unrecognised</span>
          {{/if}}
        </span>
      {{else}}
        <span class='code empty'>—</span>
      {{/if}}
      <style scoped>
        .code {
          --iso-ink: var(--foreground, #1c1e26);
          --iso-ink-2: var(--muted-foreground, #6b6f80);
          --iso-warn: var(--destructive, #b3261e);

          display: inline-flex;
          align-items: baseline;
          gap: var(--boxel-sp-6xs, 0.25rem);
          color: var(--iso-ink);
          font-family: ui-monospace, monospace;
          font-variant-numeric: tabular-nums;
        }
        .name {
          color: var(--iso-ink-2);
          font-family: var(--font-sans, system-ui, sans-serif);
          font-size: 0.8125em;
        }
        .name.unknown {
          color: var(--iso-warn);
        }
        .code.empty {
          color: var(--iso-ink-2);
        }
      </style>
    </template>
  };
}
