import {
  FieldDef,
  Component,
  contains,
  field,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import NumberField from '@cardstack/base/number';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';

// cardstack/contracts 1.2.1 — the house style, in the layer that draws money.
//
// FIELD SHAPE UNCHANGED from 1.1.0. What changes is the EDGE of every control:
// an input was outlined with `border: 1px solid`, and it is now a hairline
// shadow plus a soft inset. That is not a preference. A border occupies layout
// and elevation occupies shadow, so a system that uses both has two ladders
// and no way to say which is nearer; using only shadow leaves one. The inset
// is what makes a field read as recessed — the affordance that says "type
// here" without a label saying it.
//
// A minor rather than a patch: a consumer with a screenshot test will see it.
// 1.1.0 and 0.2.0 and 0.1.0 all stay published, which is what lets the showcase
// put four generations of the same field on one row.

// cardstack/contracts — layer 02, Universal Value & Render Contracts.
//
// PASS 3, and the release that earns a 1.0.0. Pass 2 formatted money
// correctly and then offered exactly one way to look at it. A money field
// with only `embedded` is unusable where money actually appears: a dense
// table wants no chrome, a grid slot wants to adapt to whatever size it is
// given, and above all an author needs to TYPE one, which pass 2 made
// impossible.
//
// Three things this pass fixes, in order of how badly they were wrong:
//
//   1. NO EDIT FORMAT. You could not author a money value at all.
//   2. NO THEME. Pass 2 hardcoded hex colours and rem values, so a money
//      field ignored the theme of every card that rendered it. Everything
//      here is now a theme variable, with each fallback stated exactly once
//      at the component root and bare var() reads below it.
//   3. ONE FORMAT. Now five, each designed for its context: atom inline,
//      embedded in flow, fitted for grid slots (with badge/strip/tile/card
//      subformats via container queries, and no chrome of its own because
//      the parent draws that), isolated for the full picture, edit to author.
//
// THE EDIT TEMPLATE IS THE REAL WORK. A currency input looks trivial and is
// not, and the failure everyone ships first is reformatting the text while
// the user is still typing — which moves the caret, so typing "1234" yields
// "4,123" and the user gives up. Every good implementation solves it the same
// way and so does this one:
//
//   FOCUSED   → the raw string the user is editing. Nothing reformats.
//   BLURRED   → the canonical formatted value.
//
// Around that: inputmode='decimal' so phones raise a numeric keypad; parsing
// generous enough to accept a pasted "$1,234.56", a European "1.234,56" or an
// accounting "(400)"; arrow keys to step; and a live preview of what was
// actually parsed, because the only thing worse than refusing input is
// silently storing a different number than the author meant.
//
// SELF-CONTAINED. Base realm and the ambient framework only, so the pack has
// nothing to pin and runs on any server that holds it.

// ─── PASS 4 (1.1.0): it has to be shippable, not just correct ──────────────
//
// Two things 1.0.0 did that are fine in a demo and wrong in a product, both
// found by looking at this field COMPOSED into somebody else's card rather
// than on its own.
//
// 1. THE VERSION STAMP WAS ALWAYS ON. `$0.00 cardstack/contracts 1.2.1`
//    reads as debug output the moment it appears in a form row, which is
//    exactly where a money field spends its life. But deleting it would throw
//    away the one affordance that makes coexisting versions VISIBLE. So it is
//    now off by default and a page opts in:
//
//        .my-demo { --boxel-provenance-display: inline; }
//
//    A custom property rather than an argument, because provenance is a
//    property of the PAGE ("this page is about versions"), not of each field
//    on it — an argument would have to be threaded through every caller in
//    between, and the ones in between do not care.
//
// 2. EMBEDDED DREW ITS OWN BOX. A border, a radius and a fill make a value
//    look like a disabled input, and next to a real control it reads as a
//    broken one. Embedded is a value IN A SENTENCE: the parent owns the
//    chrome. The box moves to `isolated`, where this field really is the
//    subject and the surface is its own to draw.
//
// COMPATIBLE: presentation only, no field or argument moved.

// ── Currency knowledge ──────────────────────────────────────────────────────

// Offered in `edit` for one click instead of ten keystrokes. NOT a validation
// list: any ISO 4217 code may be stored and Intl will format it.
const COMMON: { code: string; name: string }[] = [
  { code: 'USD', name: 'US Dollar' },
  { code: 'EUR', name: 'Euro' },
  { code: 'GBP', name: 'Pound Sterling' },
  { code: 'JPY', name: 'Japanese Yen' },
  { code: 'CHF', name: 'Swiss Franc' },
  { code: 'CAD', name: 'Canadian Dollar' },
  { code: 'AUD', name: 'Australian Dollar' },
];

// ISO 4217 codes are upper case, and an author typing 'usd' is not naming a
// different currency. Normalising on READ leaves the stored bytes exactly as
// authored while making every Intl call below total.
function normalise(raw: string | undefined): string {
  return typeof raw === 'string' && raw.trim()
    ? raw.trim().toUpperCase()
    : 'USD';
}

// How many minor units this currency has — 2 for USD, 0 for JPY, 3 for BHD.
// Asked of Intl rather than kept in a table here, so it stays correct as the
// platform's own data is maintained.
function minorUnits(code: string): number {
  try {
    return (
      new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: code,
      }).resolvedOptions().maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
}

function currencyName(code: string): string {
  let known = COMMON.find((c) => c.code === code);
  if (known) {
    return known.name;
  }
  try {
    return (
      new Intl.DisplayNames(undefined, { type: 'currency' }).of(code) ?? code
    );
  } catch {
    return code;
  }
}

// ── Formatting ──────────────────────────────────────────────────────────────

function formatMoney(
  value: number | undefined,
  currency: string | undefined,
): string | undefined {
  if (value == null || Number.isNaN(value)) {
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
    // number the ledger holds. Show it plainly so the odd code gets noticed.
    return `${value} ${code}`;
  }
}

// Digits only, no symbol — what belongs in an input the author is editing,
// where a symbol would have to be typed around.
function formatBare(value: number | undefined, code: string): string {
  if (value == null || Number.isNaN(value)) {
    return '';
  }
  let digits = minorUnits(code);
  try {
    return new Intl.NumberFormat(undefined, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value);
  } catch {
    return String(value);
  }
}

function formatPercent(rate: number | undefined): string | undefined {
  if (rate == null || Number.isNaN(rate)) {
    return undefined;
  }
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'percent',
      minimumFractionDigits: 0,
      // Three, so 0.00125 (12.5 basis points) survives instead of rounding to
      // a flat 0%.
      maximumFractionDigits: 3,
    }).format(rate);
  } catch {
    return `${rate * 100}%`;
  }
}

// ── Parsing ─────────────────────────────────────────────────────────────────

// Deliberately generous, because the alternative is refusing a value the
// author obviously meant. Understands a pasted "$1,234.56", a European
// "1.234,56", a spaced "1 234.56", and the accounting "(400)" that every
// finance system emits for a negative.
//
// THE AMBIGUITY IS REAL AND THE RULE IS A CHOICE. "1,234" is 1234 under US
// grouping and 1.234 under European decimals, and nothing in the string says
// which. The rule below — a lone separator followed by exactly three digits
// is GROUPING, anything else is a decimal point — is what the mainstream
// libraries settled on. It is written down here so that when it is wrong for
// somebody it is wrong on purpose rather than by accident.
function parseMoney(raw: string): number | undefined {
  if (typeof raw !== 'string') {
    return undefined;
  }
  let text = raw.trim();
  if (!text) {
    return undefined;
  }
  let negative = /^\(.*\)$/.test(text) || text.includes('-');
  // Strip everything that is not a digit or a separator: symbols, codes,
  // spaces of every width, and the accounting parentheses.
  let cleaned = text.replace(/[^\d.,]/g, '');
  if (!cleaned) {
    return undefined;
  }

  let lastDot = cleaned.lastIndexOf('.');
  let lastComma = cleaned.lastIndexOf(',');
  let cut = Math.max(lastDot, lastComma);
  let whole = cleaned;
  let fraction = '';

  if (cut !== -1) {
    let tail = cleaned.slice(cut + 1);
    // With BOTH separators present the last one is the decimal point and the
    // other is grouping — true for 1,234.56 and for 1.234,56 alike.
    let bothPresent = lastDot !== -1 && lastComma !== -1;
    if (bothPresent || tail.length !== 3) {
      whole = cleaned.slice(0, cut);
      fraction = tail;
    }
  }

  let parsed = Number(
    `${whole.replace(/[.,]/g, '')}${fraction ? `.${fraction}` : ''}`,
  );
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return negative ? -parsed : parsed;
}

// ── Money ───────────────────────────────────────────────────────────────────

export class MoneyField extends FieldDef {
  static displayName = 'Money';

  @field value = contains(NumberField);
  @field currency = contains(StringField);

  // Formatted money as a plain string, so a consumer can put it in a
  // sentence, a title attribute or an export without reaching into this
  // field's rendering. The single most-asked-for thing 0.x did not have.
  @field display = contains(StringField, {
    computeVia: function (this: MoneyField) {
      return formatMoney(this.value, this.currency) ?? '';
    },
  });

  // Dense contexts — a table cell, a chip, a breadcrumb — where padding and a
  // version stamp are noise. Same number, no chrome, tabular so columns align
  // without the caller styling anything.
  static atom = class Atom extends Component<typeof MoneyField> {
    get spoken() {
      let value = this.args.model?.value;
      return value == null
        ? 'no amount'
        : `${value} ${normalise(this.args.model?.currency)}`;
    }

    <template>
      <span class='money-atom' aria-label={{this.spoken}}>{{if
          @model.display
          @model.display
          '—'
        }}</span>
      <style scoped>
        .money-atom {
          --money-font: var(--font-mono, ui-monospace, monospace);
          font-family: var(--money-font);
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof MoneyField> {
    // The visual form is compact and a symbol alone is ambiguous — '$' is at
    // least five different currencies — so the label spells the code out.
    get spoken() {
      let value = this.args.model?.value;
      return value == null
        ? 'no amount'
        : `${value} ${normalise(this.args.model?.currency)}`;
    }

    <template>
      <span
        class='money {{unless @model.display "is-empty"}}'
        aria-label={{this.spoken}}
      >
        {{if @model.display @model.display '—'}}
        <span class='stamp'>cardstack/contracts 1.2.1</span>
      </span>
      <style scoped>
        /* PROVENANCE MARKER, off unless the page asks. Declared FIRST so the
           container queries below can still hide it at small sizes — a rule
           placed last would beat them and put a version string on a badge. */
        .stamp {
          display: var(--boxel-provenance-display, none);
        }
        .money {
          /* Each fallback stated exactly once, here at the root; every read
             below is a bare var(). */
          --money-font: var(--font-mono, ui-monospace, monospace);
          --money-pad-y: var(--boxel-sp-6xs, 0.125rem);
          --money-pad-x: var(--boxel-sp-4xs, 0.35rem);
          --money-radius: var(--boxel-border-radius-xs, 0.25rem);
          --money-border: var(--border, #dfe1ea);
          --money-surface: var(--muted, #f6f7fb);
          --money-ink: var(--foreground, #22242c);
          --money-quiet: var(--muted-foreground, #71748a);
          --money-stamp-size: var(--boxel-font-size-xs, 0.6875rem);

          /* NO border, radius or fill: embedded is a value in a sentence
             and the parent owns the chrome. A boxed number sitting next to a
             real control reads as a disabled input. */
          display: inline;
          color: var(--money-ink);
          font-family: var(--money-font);
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }
        .is-empty {
          color: var(--money-quiet);
        }
        .stamp {
          margin-left: var(--money-pad-x);
          color: var(--money-quiet);
          font-size: var(--money-stamp-size);
          white-space: nowrap;
        }
      </style>
    </template>
  };

  // A grid slot whose size this field does not control: it might be a badge,
  // a strip, a tile or a card. Container queries answer all four from one
  // template, and there is deliberately NO border or radius here — the parent
  // draws the chrome for a fitted format.
  static fitted = class Fitted extends Component<typeof MoneyField> {
    get code() {
      return normalise(this.args.model?.currency);
    }

    get name() {
      return currencyName(this.code);
    }

    <template>
      <div class='money-fit'>
        <span class='amount'>{{if @model.display @model.display '—'}}</span>
        <span class='name'>{{this.name}}</span>
        <span class='stamp'>contracts 1.2.1</span>
      </div>
      <style scoped>
        /* PROVENANCE MARKER, off unless the page asks. Declared FIRST so the
           container queries below can still hide it at small sizes — a rule
           placed last would beat them and put a version string on a badge. */
        .stamp {
          display: var(--boxel-provenance-display, none);
        }
        .money-fit {
          --money-font: var(--font-mono, ui-monospace, monospace);
          --money-gap: var(--boxel-sp-6xs, 0.125rem);
          --money-pad: var(--boxel-sp-4xs, 0.35rem);
          --money-ink: var(--foreground, #22242c);
          --money-quiet: var(--muted-foreground, #71748a);
          --money-amount-size: var(--boxel-font-size, 0.875rem);
          --money-meta-size: var(--boxel-font-size-xs, 0.6875rem);

          container-type: inline-size;
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: var(--money-gap);
          width: 100%;
          height: 100%;
          padding: var(--money-pad);
          font-family: var(--money-font);
          font-variant-numeric: tabular-nums;
          overflow: hidden;
        }
        .amount {
          color: var(--money-ink);
          font-size: var(--money-amount-size);
          line-height: 1.2;
        }
        .name,
        .stamp {
          color: var(--money-quiet);
          font-size: var(--money-meta-size);
          line-height: 1.2;
        }
        /* BADGE. Too small for anything but the number. */
        @container (max-width: 9rem) {
          .name,
          .stamp {
            display: none;
          }
        }
        /* STRIP. Room for the currency name beside the amount. */
        @container (min-width: 9rem) and (max-width: 15rem) {
          .stamp {
            display: none;
          }
        }
        /* TILE and CARD. Everything, and the amount grows into the space. */
        @container (min-width: 15rem) {
          .amount {
            font-size: var(--boxel-font-size-lg, 1.125rem);
          }
        }
        @container (min-width: 24rem) {
          .amount {
            font-size: var(--boxel-font-size-xl, 1.375rem);
          }
        }
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof MoneyField> {
    get code() {
      return normalise(this.args.model?.currency);
    }

    get name() {
      return currencyName(this.code);
    }

    get precision() {
      return minorUnits(this.code);
    }

    <template>
      <section class='money-panel' aria-labelledby='money-headline'>
        <p class='headline' id='money-headline'>{{if
            @model.display
            @model.display
            '—'
          }}</p>
        <dl class='facts'>
          <dt>Currency</dt>
          <dd>{{this.name}} ({{this.code}})</dd>
          <dt>Minor units</dt>
          <dd>{{this.precision}}</dd>
          <dt>Stored value</dt>
          <dd class='mono'>{{if @model.value @model.value 'not set'}}</dd>
        </dl>
        <p class='stamp'>cardstack/contracts 1.2.1</p>
      </section>
      <style scoped>
        /* PROVENANCE MARKER, off unless the page asks. Declared FIRST so the
           container queries below can still hide it at small sizes — a rule
           placed last would beat them and put a version string on a badge. */
        .stamp {
          display: var(--boxel-provenance-display, none);
        }
        .money-panel {
          --money-font: var(--font-mono, ui-monospace, monospace);
          --money-body-font: var(--font-sans, system-ui, sans-serif);
          --money-pad: var(--boxel-sp, 1rem);
          --money-gap: var(--boxel-sp-4xs, 0.35rem);
          --money-ink: var(--foreground, #22242c);
          --money-quiet: var(--muted-foreground, #71748a);
          --money-accent: var(--primary, #14683a);
          --money-headline-size: var(--boxel-font-size-2xl, 1.75rem);
          --money-label-size: var(--boxel-font-size-sm, 0.8125rem);
          --money-stamp-size: var(--boxel-font-size-xs, 0.6875rem);

          padding: var(--money-pad);
          color: var(--money-ink);
          font-family: var(--money-body-font);
          font-size: var(--boxel-font-size, 0.875rem);
          line-height: 1.5;
        }
        .headline {
          margin: 0 0 var(--boxel-sp-sm, 0.75rem);
          color: var(--money-accent);
          font-family: var(--money-font);
          font-variant-numeric: tabular-nums;
          font-size: var(--money-headline-size);
          line-height: 1.2;
        }
        .facts {
          display: grid;
          grid-template-columns: max-content 1fr;
          gap: var(--money-gap) var(--boxel-sp, 1rem);
          margin: 0;
        }
        dt {
          color: var(--money-quiet);
          font-size: var(--money-label-size);
        }
        dd {
          margin: 0;
        }
        .mono {
          font-family: var(--money-font);
        }
        .stamp {
          margin: var(--boxel-sp, 1rem) 0 0;
          color: var(--money-quiet);
          font-family: var(--money-font);
          font-size: var(--money-stamp-size);
        }
      </style>
    </template>
  };

  static edit = class Edit extends Component<typeof MoneyField> {
    // The string being edited, held only while the input has focus.
    // `undefined` means "not editing", and the input shows the canonical
    // formatted value instead. This one piece of state is the entire
    // caret-safety mechanism.
    @tracked draft: string | undefined;
    @tracked rejected = false;

    get code() {
      return normalise(this.args.model?.currency);
    }

    get shown() {
      return this.draft ?? formatBare(this.args.model?.value, this.code);
    }

    // Built with `selected` resolved here rather than compared in the
    // template, because template comparison would need a helper this pack
    // deliberately does not import.
    get options() {
      let current = this.code;
      let list = COMMON.some((c) => c.code === current)
        ? COMMON
        : [{ code: current, name: currencyName(current) }, ...COMMON];
      return list.map((c) => ({ ...c, selected: c.code === current }));
    }

    // Typing NEVER reformats. The draft is kept verbatim and only parsed, so
    // the caret stays exactly where the author put it.
    @action onInput(event: Event) {
      let raw = (event.target as HTMLInputElement).value;
      this.draft = raw;
      if (!raw.trim()) {
        this.args.model.value = undefined;
        this.rejected = false;
        return;
      }
      let parsed = parseMoney(raw);
      // A value that cannot be parsed is REPORTED, not swallowed and not
      // written. Silently storing a different number than the author typed is
      // the worst outcome available to an input like this.
      this.rejected = parsed === undefined;
      if (parsed !== undefined) {
        this.args.model.value = parsed;
      }
    }

    // Leaving the field is when it becomes canonical: drop the draft and let
    // the formatted value show through.
    @action onBlur() {
      this.draft = undefined;
      this.rejected = false;
    }

    // Arrow keys step, which is what anyone who has used a spreadsheet
    // expects. Shift steps by ten, matching every other numeric input.
    @action onKeydown(event: KeyboardEvent) {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
        return;
      }
      event.preventDefault();
      let step = event.shiftKey ? 10 : 1;
      let current = this.args.model?.value ?? 0;
      let next = event.key === 'ArrowUp' ? current + step : current - step;
      this.args.model.value = next;
      this.draft = formatBare(next, this.code);
      this.rejected = false;
    }

    @action onCurrency(event: Event) {
      this.args.model.currency = (event.target as HTMLSelectElement).value;
    }

    <template>
      <div class='money-edit'>
        <div class='row'>
          <label class='lab lab-amount'>
            <span class='cap'>Amount</span>
            <input
              class='amount {{if this.rejected "is-bad"}}'
              type='text'
              inputmode='decimal'
              autocomplete='off'
              spellcheck='false'
              aria-label='Amount'
              aria-invalid={{if this.rejected 'true' 'false'}}
              aria-describedby='money-preview'
              value={{this.shown}}
              {{on 'input' this.onInput}}
              {{on 'blur' this.onBlur}}
              {{on 'keydown' this.onKeydown}}
            />
          </label>
          <label class='lab'>
            <span class='cap'>Currency</span>
            <select
              class='currency'
              aria-label='Currency'
              {{on 'change' this.onCurrency}}
            >
              {{#each this.options as |opt|}}
                <option value={{opt.code}} selected={{opt.selected}}>
                  {{opt.code}}
                  — {{opt.name}}
                </option>
              {{/each}}
            </select>
          </label>
        </div>
        <p
          id='money-preview'
          class='preview {{if this.rejected "is-bad"}}'
          role='status'
        >
          {{#if this.rejected}}
            That is not a number I can read — try 1234.56
          {{else if @model.display}}
            {{@model.display}}
          {{else}}
            no amount yet
          {{/if}}
        </p>
      </div>
      <style scoped>
        .money-edit {
          --money-font: var(--font-mono, ui-monospace, monospace);
          --money-body-font: var(--font-sans, system-ui, sans-serif);
          --money-gap: var(--boxel-sp-xs, 0.5rem);
          --money-pad-y: var(--boxel-sp-5xs, 0.25rem);
          --money-pad-x: var(--boxel-sp-4xs, 0.35rem);
          --money-radius: var(--boxel-border-radius-sm, 0.5rem);
          --money-border: var(--border, #dfe1ea);
          --money-input: var(--input, #ffffff);
          --money-ink: var(--foreground, #22242c);
          --money-quiet: var(--muted-foreground, #71748a);
          --money-bad: var(--destructive, #b0264a);
          --money-ring: var(--ring, #6a7cff);
          --money-cap-size: var(--boxel-font-size-xs, 0.6875rem);

          font-family: var(--money-body-font);
          font-size: var(--boxel-font-size, 0.875rem);
        }
        .row {
          display: flex;
          gap: var(--money-gap);
          align-items: end;
        }
        .lab {
          display: grid;
          gap: var(--boxel-sp-6xs, 0.125rem);
        }
        .lab-amount {
          flex: 1 1 auto;
          min-width: 0;
        }
        .cap {
          color: var(--money-quiet);
          font-size: var(--money-cap-size);
          letter-spacing: var(--boxel-lsp-sm, 0.02em);
          text-transform: uppercase;
        }
        /* Law 1 — an input's edge is a hairline SHADOW plus a soft inset, so
           the control reads as recessed rather than outlined, and it sits on
           the same elevation ladder as every surface around it. */
        .amount,
        .currency {
          padding: var(--money-pad-y) var(--money-pad-x);
          border: 0;
          border-radius: var(--money-radius);
          background-color: var(--money-input);
          color: var(--money-ink);
          box-shadow:
            0 0 0 1px var(--money-border),
            var(--pretui-shadow-inset, inset 0 1px 2px rgb(0 0 0 / 0.08));
        }
        .amount {
          width: 100%;
          font-family: var(--money-font);
          font-variant-numeric: tabular-nums;
          /* Money reads right-to-left from the decimal point; left-aligning
             makes a column of inputs impossible to compare. */
          text-align: right;
        }
        .amount:focus-visible,
        .currency:focus-visible {
          outline: 2px solid var(--money-ring);
          outline-offset: 1px;
        }
        .amount.is-bad {
          border-color: var(--money-bad);
        }
        .currency {
          font-family: var(--money-body-font);
        }
        .preview {
          margin: var(--boxel-sp-5xs, 0.25rem) 0 0;
          color: var(--money-quiet);
          font-family: var(--money-font);
          font-size: var(--boxel-font-size-sm, 0.8125rem);
        }
        .preview.is-bad {
          color: var(--money-bad);
        }
      </style>
    </template>
  };
}

// ── Percent ─────────────────────────────────────────────────────────────────

export class PercentField extends FieldDef {
  static displayName = 'Percent';

  // Stored as a FRACTION — 0.0825, not 8.25 — because that is what every
  // arithmetic consumer wants and what Intl's percent style expects. Storing
  // the display form is how a tax line ends up a hundred times too large
  // exactly once, in production.
  @field rate = contains(NumberField);

  @field display = contains(StringField, {
    computeVia: function (this: PercentField) {
      return formatPercent(this.rate) ?? '';
    },
  });

  static atom = class Atom extends Component<typeof PercentField> {
    <template>
      <span class='pct-atom'>{{if @model.display @model.display '—'}}</span>
      <style scoped>
        .pct-atom {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof PercentField> {
    <template>
      <span class='pct {{unless @model.display "is-empty"}}'>{{if
          @model.display
          @model.display
          '—'
        }}</span>
      <style scoped>
        .pct {
          --pct-quiet: var(--muted-foreground, #71748a);
          font-family: var(--font-mono, ui-monospace, monospace);
          font-variant-numeric: tabular-nums;
        }
        .is-empty {
          color: var(--pct-quiet);
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof PercentField> {
    <template>
      <div class='pct-fit'>
        <span class='rate'>{{if @model.display @model.display '—'}}</span>
      </div>
      <style scoped>
        .pct-fit {
          container-type: inline-size;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 100%;
          height: 100%;
          padding: var(--boxel-sp-4xs, 0.35rem);
          color: var(--foreground, #22242c);
          font-family: var(--font-mono, ui-monospace, monospace);
          font-variant-numeric: tabular-nums;
        }
        .rate {
          font-size: var(--boxel-font-size, 0.875rem);
        }
        @container (min-width: 15rem) {
          .rate {
            font-size: var(--boxel-font-size-lg, 1.125rem);
          }
        }
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof PercentField> {
    <template>
      <section class='pct-panel' aria-labelledby='pct-headline'>
        <p class='headline' id='pct-headline'>{{if
            @model.display
            @model.display
            '—'
          }}</p>
        <dl class='facts'>
          <dt>Stored fraction</dt>
          <dd class='mono'>{{if @model.rate @model.rate 'not set'}}</dd>
        </dl>
        <p class='stamp'>cardstack/contracts 1.2.1</p>
      </section>
      <style scoped>
        /* PROVENANCE MARKER, off unless the page asks. Declared FIRST so the
           container queries below can still hide it at small sizes — a rule
           placed last would beat them and put a version string on a badge. */
        .stamp {
          display: var(--boxel-provenance-display, none);
        }
        .pct-panel {
          --pct-quiet: var(--muted-foreground, #71748a);
          --pct-mono: var(--font-mono, ui-monospace, monospace);
          padding: var(--boxel-sp, 1rem);
          color: var(--foreground, #22242c);
          font-family: var(--font-sans, system-ui, sans-serif);
          font-size: var(--boxel-font-size, 0.875rem);
        }
        .headline {
          margin: 0 0 var(--boxel-sp-sm, 0.75rem);
          color: var(--primary, #14683a);
          font-family: var(--pct-mono);
          font-variant-numeric: tabular-nums;
          font-size: var(--boxel-font-size-2xl, 1.75rem);
        }
        .facts {
          display: grid;
          grid-template-columns: max-content 1fr;
          gap: var(--boxel-sp-4xs, 0.35rem) var(--boxel-sp, 1rem);
          margin: 0;
        }
        dt {
          color: var(--pct-quiet);
          font-size: var(--boxel-font-size-sm, 0.8125rem);
        }
        dd {
          margin: 0;
        }
        .mono {
          font-family: var(--pct-mono);
        }
        .stamp {
          margin: var(--boxel-sp, 1rem) 0 0;
          color: var(--pct-quiet);
          font-family: var(--pct-mono);
          font-size: var(--boxel-font-size-xs, 0.6875rem);
        }
      </style>
    </template>
  };

  static edit = class Edit extends Component<typeof PercentField> {
    @tracked draft: string | undefined;

    // The author types 8.25 meaning 8.25%, and the field stores 0.0825.
    // Doing that conversion here — visibly, in one place — is the entire
    // reason this field exists rather than a bare number.
    get shown() {
      if (this.draft !== undefined) {
        return this.draft;
      }
      let rate = this.args.model?.rate;
      return rate == null ? '' : String(Number((rate * 100).toFixed(4)));
    }

    @action onInput(event: Event) {
      let raw = (event.target as HTMLInputElement).value;
      this.draft = raw;
      if (!raw.trim()) {
        this.args.model.rate = undefined;
        return;
      }
      let asPercent = Number(raw.replace(/[^\d.-]/g, ''));
      if (Number.isFinite(asPercent)) {
        this.args.model.rate = asPercent / 100;
      }
    }

    @action onBlur() {
      this.draft = undefined;
    }

    <template>
      <label class='pct-edit'>
        <span class='cap'>Rate</span>
        <span class='wrap'>
          <input
            class='input'
            type='text'
            inputmode='decimal'
            autocomplete='off'
            aria-label='Rate as a percentage'
            value={{this.shown}}
            {{on 'input' this.onInput}}
            {{on 'blur' this.onBlur}}
          />
          <span class='suffix' aria-hidden='true'>%</span>
        </span>
      </label>
      <style scoped>
        .pct-edit {
          --pct-quiet: var(--muted-foreground, #71748a);
          --pct-border: var(--border, #dfe1ea);
          display: grid;
          gap: var(--boxel-sp-6xs, 0.125rem);
          font-family: var(--font-sans, system-ui, sans-serif);
          font-size: var(--boxel-font-size, 0.875rem);
        }
        .cap {
          color: var(--pct-quiet);
          font-size: var(--boxel-font-size-xs, 0.6875rem);
          letter-spacing: var(--boxel-lsp-sm, 0.02em);
          text-transform: uppercase;
        }
        .wrap {
          display: inline-flex;
          align-items: center;
          gap: var(--boxel-sp-6xs, 0.125rem);
        }
        .input {
          width: 6rem;
          padding: var(--boxel-sp-5xs, 0.25rem) var(--boxel-sp-4xs, 0.35rem);
          border: 0;
          border-radius: var(--radius, 0.5rem);
          box-shadow:
            0 0 0 1px var(--pct-border),
            var(--pretui-shadow-inset, inset 0 1px 2px rgb(0 0 0 / 0.08));
          background-color: var(--field, var(--input, #ffffff));
          color: var(--foreground, #22242c);
          font-family: var(--font-mono, ui-monospace, monospace);
          font-variant-numeric: tabular-nums;
          text-align: right;
        }
        .input:focus-visible {
          outline: 2px solid var(--ring, #6a7cff);
          outline-offset: 1px;
        }
        .suffix {
          color: var(--pct-quiet);
        }
      </style>
    </template>
  };
}
