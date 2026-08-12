import {
  FieldDef,
  Component,
  contains,
  field,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';

// iso/money-codes — layer 04, Standards & Code Lists.
//
// A STANDARDS BODY SHIPS DATA, NOT BEHAVIOUR. This package versions because
// THE WORLD CHANGED, not because anyone refactored: a consumer pinned to
// `^1.0.0` is pinned to a SNAPSHOT OF REALITY. Codes are marked, never
// rejected — a registry that refuses what it has not heard of turns every lag
// between the world and the list into a data-entry failure.
//
// ─── PASS 2 (1.1.0): the withdrawn register ─────────────────────────────────
//
// 1.0.0 knew only what is current, and that was a bug disguised as tidiness.
// An invoice raised in 2001 in Deutsche Mark is not invalid — it is HISTORY,
// and a code list that has forgotten DEM renders that invoice as
// "unrecognised" forever. The archive is not clutter; it is the reason
// anybody keeps a register at all.
//
// So 1.1.0 adds WITHDRAWN codes, each with the date it stopped being current
// and (where there was one) its successor. Three things fall out of that,
// which is a good sign the shape is right rather than bolted on:
//
//   * An old document renders correctly instead of shouting.
//   * `supersededBy` lets a consumer offer "DEM → EUR" without keeping its
//     own migration table, which it would otherwise write badly.
//   * The distinction between "withdrawn" and "never existed" becomes
//     answerable, and those two want completely different remedies.
//
// WHY 1.1.0 AND NOT 2.0.0. Everything here is additive. `currencies()` still
// returns exactly the active list it returned before, in the same order —
// changing that to include withdrawn codes would silently put DEM in every
// currency picker in the world, which is precisely the kind of "small data
// change" that is actually a major. New facts go through NEW functions.

export type CurrencyStatus = 'active' | 'withdrawn';

export interface CurrencyRecord {
  code: string;
  name: string;
  /** ISO 4217 exponent: 2 for USD, 0 for JPY, 3 for KWD. */
  minorUnits: number;
  /** Numeric code. Present because payment rails ask for it. */
  numeric: string;
  // ── new in 1.1.0 ──
  status: CurrencyStatus;
  /** ISO date the code stopped being current. Withdrawn codes only. */
  withdrawnOn?: string;
  /** What replaced it, where anything did. */
  supersededBy?: string;
}

const ACTIVE: CurrencyRecord[] = [
  { code: 'USD', name: 'US Dollar', minorUnits: 2, numeric: '840', status: 'active' },
  { code: 'EUR', name: 'Euro', minorUnits: 2, numeric: '978', status: 'active' },
  { code: 'GBP', name: 'Pound Sterling', minorUnits: 2, numeric: '826', status: 'active' },
  { code: 'JPY', name: 'Yen', minorUnits: 0, numeric: '392', status: 'active' },
  { code: 'CHF', name: 'Swiss Franc', minorUnits: 2, numeric: '756', status: 'active' },
  { code: 'SEK', name: 'Swedish Krona', minorUnits: 2, numeric: '752', status: 'active' },
  { code: 'CAD', name: 'Canadian Dollar', minorUnits: 2, numeric: '124', status: 'active' },
  { code: 'BRL', name: 'Brazilian Real', minorUnits: 2, numeric: '986', status: 'active' },
  { code: 'MXN', name: 'Mexican Peso', minorUnits: 2, numeric: '484', status: 'active' },
  // Three minor units, so anything that assumed two is wrong here.
  { code: 'KWD', name: 'Kuwaiti Dinar', minorUnits: 3, numeric: '414', status: 'active' },
];

// New in 1.1.0. The point of a register.
const WITHDRAWN: CurrencyRecord[] = [
  {
    code: 'DEM',
    name: 'Deutsche Mark',
    minorUnits: 2,
    numeric: '276',
    status: 'withdrawn',
    withdrawnOn: '2002-03-01',
    supersededBy: 'EUR',
  },
  {
    code: 'FRF',
    name: 'French Franc',
    minorUnits: 2,
    numeric: '250',
    status: 'withdrawn',
    withdrawnOn: '2002-03-01',
    supersededBy: 'EUR',
  },
  {
    // Redenominated rather than replaced by another country's currency, and
    // with a DIFFERENT minor-unit count from its successor — which is exactly
    // the case that breaks a consumer who assumed the exponent is a property
    // of the country rather than of the code.
    code: 'BYR',
    name: 'Belarusian Ruble (old)',
    minorUnits: 0,
    numeric: '974',
    status: 'withdrawn',
    withdrawnOn: '2016-07-01',
    supersededBy: 'BYN',
  },
];

const BY_CODE: Map<string, CurrencyRecord> = new Map(
  [...ACTIVE, ...WITHDRAWN].map((record) => [record.code, record]),
);

/** The ACTIVE list, unchanged from 1.0.0 in contents and order. Withdrawn
 *  codes deliberately do not appear: quietly adding DEM to every currency
 *  picker would be a breaking change wearing a data change's clothes. */
export function currencies(): CurrencyRecord[] {
  return ACTIVE.map((record) => ({ ...record }));
}

/** New in 1.1.0. Active and withdrawn together, for anything that reads
 *  history rather than offers a choice. */
export function allCurrencies(): CurrencyRecord[] {
  return [...ACTIVE, ...WITHDRAWN].map((record) => ({ ...record }));
}

/** Resolves withdrawn codes too, so an old document reads correctly. */
export function lookup(code: string | undefined): CurrencyRecord | undefined {
  return code ? BY_CODE.get(code.trim().toUpperCase()) : undefined;
}

export function isKnown(code: string | undefined): boolean {
  return lookup(code) !== undefined;
}

/** New in 1.1.0. "Can I still invoice in this?" — a different question from
 *  "have you heard of it?", and consumers were conflating them because 1.0.0
 *  gave them no way not to. */
export function isActive(code: string | undefined): boolean {
  return lookup(code)?.status === 'active';
}

/** New in 1.1.0. Follows the chain, so BYR resolves through to BYN even if a
 *  future Version inserts a step between them. Guarded against a cycle,
 *  because a register is edited by hand and one will eventually appear. */
export function successorOf(code: string | undefined): string | undefined {
  let seen = new Set<string>();
  let current = lookup(code);
  let result: string | undefined;
  while (current?.supersededBy && !seen.has(current.code)) {
    seen.add(current.code);
    result = current.supersededBy;
    current = lookup(result);
  }
  return result;
}

export function minorUnits(code: string | undefined): number {
  return lookup(code)?.minorUnits ?? 2;
}

// ─── PASS 3 (1.2.0): a code that composes ───────────────────────────────────
//
// 1.1.0 rendered `USD US Dollar` as one inline run, which is right in prose
// and wrong everywhere else — in a totals block it competes with the number it
// annotates, and in a narrow slot the name simply overflows. A code list's
// field spends its life INSIDE other people's layouts, so it has to shrink
// gracefully rather than assume it is the subject.
//
// The code is the identifier and stays; the name is a gloss and yields first.
// `atom` is the code alone, which is what a dense table wants. COMPATIBLE.

export class CurrencyCodeField extends FieldDef {
  static displayName = 'Currency Code';

  // Stored as the authored string, normalised only on READ. Rewriting what an
  // author typed is how a round-trip stops being a round-trip.
  @field code = contains(StringField);

  static atom = class Atom extends Component<typeof CurrencyCodeField> {
    get shown() {
      return this.args.model?.code?.trim().toUpperCase();
    }
    <template>
      <span class='code'>{{if this.shown this.shown '—'}}</span>
      <style scoped>
        .code {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof CurrencyCodeField> {
    get record() {
      return lookup(this.args.model?.code);
    }

    get shown() {
      return this.args.model?.code?.trim().toUpperCase();
    }

    // Three states, three treatments, because they need three different
    // responses from the reader: fine, historical, and check this.
    get tone() {
      if (!this.record) {
        return 'is-unknown';
      }
      return this.record.status === 'withdrawn' ? 'is-withdrawn' : '';
    }

    get gloss() {
      let record = this.record;
      if (!record) {
        return 'unrecognised';
      }
      if (record.status === 'withdrawn') {
        let successor = successorOf(record.code);
        return successor
          ? `withdrawn ${record.withdrawnOn} → ${successor}`
          : `withdrawn ${record.withdrawnOn}`;
      }
      return record.name;
    }

    <template>
      {{#if this.shown}}
        <span
          class='wrap {{this.tone}}'
          title={{if this.record this.record.name 'Not in ISO 4217 1.2.0'}}
        >
          <span class='code'>{{this.shown}}</span>
          <span class='gloss'>{{this.gloss}}</span>
        </span>
      {{else}}
        <span class='wrap is-empty'><span class='code'>—</span></span>
      {{/if}}
      <style scoped>
        .wrap {
          --iso-ink: var(--foreground, #16181f);
          --iso-ink-2: var(--muted-foreground, #6b6f80);
          --iso-warn: var(--destructive, #b3261e);

          display: inline-flex;
          align-items: baseline;
          gap: var(--boxel-sp-xxs, 0.5rem);
          min-width: 0;
          color: var(--iso-ink);
        }
        /* The IDENTIFIER. Mono, tabular, never wraps, never yields — it is the
           part a reader may retype. */
        .code {
          flex: none;
          font-family: var(--font-mono, ui-monospace, monospace);
          font-variant-numeric: tabular-nums;
          letter-spacing: 0.02em;
        }
        /* The GLOSS. Prose, quiet, and the first thing to go when the slot is
           tight — losing the name costs nothing a reader cannot recover. */
        .gloss {
          min-width: 0;
          color: var(--iso-ink-2);
          font-family: var(--font-sans, system-ui, sans-serif);
          font-size: var(--boxel-font-size-xs, 0.6875rem);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        /* Withdrawn is HISTORY, not an error: struck rather than reddened, so
           a 2001 invoice reads as old instead of broken. The gloss carries the
           date and successor, so the strike does not have to be decoded. */
        .is-withdrawn .code {
          text-decoration: line-through;
          text-decoration-thickness: 1px;
        }
        .is-unknown .gloss {
          color: var(--iso-warn);
        }
        .is-empty {
          color: var(--iso-ink-2);
        }
        @container (max-width: 12rem) {
          .gloss {
            display: none;
          }
        }
      </style>
    </template>
  };
}
