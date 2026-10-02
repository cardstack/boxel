// Pretui — AmountInput: a locale-aware amount in a unit such as a currency or a mass.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { guidFor } from '@ember/object/internals';
import { Select } from './select';
import { SegmentedControl } from './segmented-control';
import type { SelectOption } from './select';
import type { SegmentOption } from './segmented-control';
import { amountAffixes, describeAmount, formatAmountPlain, parseAmount, roundToUnit } from '../internal/money';
import type { AmountUnit } from '../internal/money';

// ═══════════════════════════════════════════════════════════════════════
// The component
// ═══════════════════════════════════════════════════════════════════════

export interface AmountInputSignature {
  Args: {
    /** the amount, controlled. Omit and the component keeps its own from
     * `@defaultValue` — the hybrid `Select` uses. */
    value?: number | null;
    /** uncontrolled seed */
    defaultValue?: number;
    /** the current unit's `value`, controlled */
    unit?: string;
    /** uncontrolled seed; otherwise the first unit in the list */
    defaultUnit?: string;
    /** the unit choices. One entry renders as a static mark rather than a
     * picker; none renders a plain number. */
    units?: AmountUnit[];
    /** BCP-47 tag deciding separators, symbol placement and the readout. */
    locale?: string;
    /** decimal places when the unit does not declare its own */
    precision?: number;
    /** clamped on commit, not while typing — a reader who is halfway through
     * `120` must be allowed to pass through `1` and `12` */
    min?: number;
    max?: number;
    /** arrow-key step; a unit's own `step` wins */
    step?: number;
    /** dimmed and inert */
    disabled?: boolean;
    /** paint the error state; the readout still explains itself */
    invalid?: boolean;
    /** native required on the amount box */
    required?: boolean;
    /** supplied by `Field`; when absent the control owns its id and renders
     * its own visually-hidden label */
    controlId?: string;
    /** the amount box's accessible name. Ignored when `@controlId` is given,
     * because then a real `<label for>` already exists outside. */
    label?: string;
    /** ghost text drawn behind an empty box. Deliberately NOT a `placeholder`
     * attribute: a placeholder doubles as the accessible name, so a field
     * named by its placeholder loses its name the moment you type. */
    hint?: string;
    /** accessible name for the unit picker */
    unitLabel?: string;
    /** `'auto'` (default) draws the mark only for currencies, where the
     * symbol and the code are different things; `'never'` suppresses it;
     * `'always'` draws whatever mark the unit has. */
    affix?: 'auto' | 'always' | 'never';
    /** `'auto'` (default) segments three or fewer units and drops to a
     * searchable select above that */
    unitControl?: 'auto' | 'select' | 'segmented' | 'static';
    /** suppress the spelled-out confirmation row */
    quiet?: boolean;
    /** fires on every keystroke with the parsed amount and the current unit.
     * The amount is `undefined` for an empty or unparseable box — never 0,
     * because "nothing" and "zero" are different facts. */
    onChange?: (value: number | undefined, unit: string | undefined) => void;
    /** fires when the unit changes; the amount is re-reported through
     * `@onChange` in the same turn, rounded to the new unit's precision */
    onUnitChange?: (unit: string) => void;
  };
  Element: HTMLDivElement;
}

export class AmountInput extends Component<AmountInputSignature> {
  private guid = guidFor(this);

  /** What is in the box while the reader is typing. `undefined` means "not
   * being edited", and the box shows the canonical form instead. Clearing it
   * on blur is the whole reformat-on-commit behaviour — no timers, no focus
   * bookkeeping, one flag. */
  @tracked private draft: string | undefined = undefined;
  @tracked private ownValue: number | undefined = undefined;
  @tracked private ownUnit: string | undefined = undefined;
  @tracked private seeded = false;

  get locale(): string {
    return this.args.locale ?? 'en-US';
  }

  get units(): AmountUnit[] {
    return this.args.units ?? [];
  }

  get unitValue(): string | undefined {
    if (this.args.unit !== undefined) {
      return this.args.unit;
    }
    if (this.ownUnit !== undefined) {
      return this.ownUnit;
    }
    if (this.args.defaultUnit !== undefined) {
      return this.args.defaultUnit;
    }
    return this.units.length > 0 ? this.units[0]?.value : undefined;
  }

  get activeUnit(): AmountUnit | undefined {
    let wanted = this.unitValue;
    return this.units.find((u) => u.value === wanted) ?? this.units[0];
  }

  /** The committed amount: the caller's when controlled, ours otherwise. */
  get committed(): number | undefined {
    if (this.args.value !== undefined && this.args.value !== null) {
      return this.args.value;
    }
    if (this.args.value === null) {
      return undefined;
    }
    if (this.seeded) {
      return this.ownValue;
    }
    return this.args.defaultValue;
  }

  /** What the box shows: the raw draft while typing, the canonical grouped
   * form the rest of the time. */
  get boxText(): string {
    if (this.draft !== undefined) {
      return this.draft;
    }
    return formatAmountPlain(
      this.committed,
      this.activeUnit,
      this.locale,
      this.args.precision,
    );
  }

  get empty(): boolean {
    return this.boxText.trim().length === 0;
  }

  /** The live amount, whether typed or committed. */
  get amount(): number | undefined {
    if (this.draft === undefined) {
      return this.committed;
    }
    return parseAmount(this.draft, { locale: this.locale });
  }

  /** A typed box with digits in it that did not parse, or a parsed amount
   * outside the caller's range. Empty is not an error. */
  get issue(): string | undefined {
    if (this.draft !== undefined && this.draft.trim().length > 0) {
      if (this.amount === undefined) {
        return 'That is not a number.';
      }
    }
    let value = this.amount;
    if (value === undefined) {
      return undefined;
    }
    if (this.args.min !== undefined && value < this.args.min) {
      return (
        'Below the minimum of ' +
        formatAmountPlain(
          this.args.min,
          this.activeUnit,
          this.locale,
          this.args.precision,
        ) +
        '.'
      );
    }
    if (this.args.max !== undefined && value > this.args.max) {
      return (
        'Above the maximum of ' +
        formatAmountPlain(
          this.args.max,
          this.activeUnit,
          this.locale,
          this.args.precision,
        ) +
        '.'
      );
    }
    return undefined;
  }

  get invalid(): boolean {
    return this.args.invalid === true || this.issue !== undefined;
  }

  /** The spelled-out confirmation, or the reason there isn't one. */
  get readout(): string {
    if (this.issue) {
      return this.issue;
    }
    return describeAmount(this.amount, this.activeUnit, this.locale);
  }

  get affixMode(): 'auto' | 'always' | 'never' {
    return this.args.affix ?? 'auto';
  }

  get affixes(): { prefix: string; suffix: string } {
    if (this.affixMode === 'never') {
      return { prefix: '', suffix: '' };
    }
    if (this.affixMode === 'auto' && !this.activeUnit?.currency) {
      return { prefix: '', suffix: '' };
    }
    return amountAffixes(this.activeUnit, this.locale);
  }

  get unitMode(): 'select' | 'segmented' | 'static' | 'none' {
    if (this.units.length === 0) {
      return 'none';
    }
    let asked = this.args.unitControl ?? 'auto';
    if (asked !== 'auto') {
      return asked;
    }
    if (this.units.length === 1) {
      return 'static';
    }
    return this.units.length <= 3 ? 'segmented' : 'select';
  }

  get unitIsStatic(): boolean {
    return this.unitMode === 'static';
  }
  get unitIsSegmented(): boolean {
    return this.unitMode === 'segmented';
  }
  get unitIsSelect(): boolean {
    return this.unitMode === 'select';
  }

  get selectOptions(): SelectOption[] {
    return this.units.map((u) => ({
      value: u.value,
      label: u.search ? u.label + ' · ' + u.search : u.label,
    }));
  }

  get segmentOptions(): SegmentOption[] {
    return this.units.map((u) => ({ value: u.value, label: u.label }));
  }

  get stepValue(): number | undefined {
    return this.activeUnit?.step ?? this.args.step;
  }

  get inputId(): string {
    return this.args.controlId ?? this.guid + '-amount';
  }

  /** Only when no wrapper handed us an id: a control that owns its id must
   * also own its label, and an `aria-label` alongside an `id` is counted as a
   * second, competing name by the realm's lint. */
  get ownsLabel(): boolean {
    return this.args.controlId === undefined;
  }

  get fallbackLabel(): string {
    return this.args.label ?? 'Amount';
  }

  get readoutId(): string {
    return this.guid + '-readout';
  }

  get unitName(): string {
    return this.args.unitLabel ?? 'Unit';
  }

  private report(value: number | undefined) {
    this.args.onChange?.(value, this.unitValue);
  }

  private commitValue(value: number | undefined) {
    this.seeded = true;
    this.ownValue = value;
    this.report(value);
  }

  onAmountInput = (event: Event) => {
    let target = event.target as HTMLInputElement | null;
    this.draft = target ? target.value : '';
    let parsed = parseAmount(this.draft, { locale: this.locale });
    this.seeded = true;
    this.ownValue = parsed;
    this.report(parsed);
  };

  /**
   * Commit: clamp, round to the unit's precision, and drop the draft so the
   * box snaps to its canonical form.
   *
   * Clamping happens HERE and not on input, because a reader typing `120` into
   * a box with a minimum of 10 passes through `1` on the way and having the
   * box rewrite itself to `10` mid-word is the single most infuriating thing a
   * numeric input can do.
   */
  onAmountCommit = () => {
    let parsed = this.amount;
    // An unparseable draft stays in the box with its reason, so the reader
    // can correct it rather than lose it.
    if (parsed === undefined && this.draft !== undefined && this.draft.trim().length > 0) {
      return;
    }
    if (parsed !== undefined) {
      if (this.args.min !== undefined && parsed < this.args.min) {
        parsed = this.args.min;
      }
      if (this.args.max !== undefined && parsed > this.args.max) {
        parsed = this.args.max;
      }
      parsed = roundToUnit(
        parsed,
        this.activeUnit,
        this.locale,
        this.args.precision,
      );
    }
    this.draft = undefined;
    this.commitValue(parsed);
  };

  /** Arrows nudge by the unit's step; ⇧ takes ten at a time, the same
   * modifier grammar `ScrubInput` uses. Enter commits, which is what a reader
   * pressing Enter in a money box means. */
  onAmountKey = (raw: Event) => {
    let event = raw as KeyboardEvent;
    if (event.key === 'Enter') {
      this.onAmountCommit();
      return;
    }
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
      return;
    }
    let step = this.stepValue;
    if (step === undefined) {
      return;
    }
    event.preventDefault();
    let multiplier = event.shiftKey ? 10 : 1;
    let direction = event.key === 'ArrowUp' ? 1 : -1;
    let base = this.amount ?? 0;
    let next = base + step * multiplier * direction;
    if (this.args.min !== undefined && next < this.args.min) {
      next = this.args.min;
    }
    if (this.args.max !== undefined && next > this.args.max) {
      next = this.args.max;
    }
    this.draft = undefined;
    this.commitValue(
      roundToUnit(next, this.activeUnit, this.locale, this.args.precision),
    );
  };

  /** A unit change re-rounds the amount, because the new unit may have fewer
   * decimals than the old one — switching USD → JPY with 12.34 in the box must
   * commit 12, not carry a fraction the currency has no way to write. */
  onUnitPick = (next: string) => {
    this.ownUnit = next;
    this.args.onUnitChange?.(next);
    let chosen = this.units.find((u) => u.value === next);
    let value = this.amount;
    let rounded =
      value === undefined
        ? undefined
        : roundToUnit(value, chosen, this.locale, this.args.precision);
    this.draft = undefined;
    this.seeded = true;
    this.ownValue = rounded;
    this.args.onChange?.(rounded, next);
  };

  <template>
    <div
      class='pretui-amount'
      data-invalid={{if this.invalid 'true'}}
      data-unit-mode={{this.unitMode}}
      data-test-pretui-amount
      ...attributes
    >
      {{#if this.ownsLabel}}
        <label class='pretui-amount-sr' for={{this.inputId}}>
          {{this.fallbackLabel}}
        </label>
      {{/if}}
      <div class='pretui-amount-shell'>
        {{#if this.affixes.prefix}}
          <span class='pretui-amount-mark' aria-hidden='true'>
            {{this.affixes.prefix}}
          </span>
        {{/if}}
        <span class='pretui-amount-box'>
          {{#if @hint}}
            {{#if this.empty}}
              <span class='pretui-amount-ghost' aria-hidden='true'>
                {{@hint}}
              </span>
            {{/if}}
          {{/if}}
          <input
            class='pretui-amount-input'
            id={{this.inputId}}
            type='text'
            inputmode='decimal'
            autocomplete='off'
            spellcheck='false'
            value={{this.boxText}}
            disabled={{@disabled}}
            required={{@required}}
            aria-invalid={{if this.invalid 'true'}}
            aria-describedby={{unless @quiet this.readoutId}}
            data-test-pretui-amount-input
            {{on 'input' this.onAmountInput}}
            {{on 'blur' this.onAmountCommit}}
            {{on 'keydown' this.onAmountKey}}
          />
        </span>
        {{#if this.affixes.suffix}}
          <span class='pretui-amount-mark' aria-hidden='true'>
            {{this.affixes.suffix}}
          </span>
        {{/if}}
        {{#if this.unitIsStatic}}
          <span class='pretui-amount-static' data-test-pretui-amount-unit>
            {{this.activeUnit.label}}
          </span>
        {{/if}}
        {{#if this.unitIsSegmented}}
          <SegmentedControl
            class='pretui-amount-segments'
            @options={{this.segmentOptions}}
            @value={{this.unitValue}}
            @label={{this.unitName}}
            @onValueChange={{this.onUnitPick}}
            data-test-pretui-amount-unit
          />
        {{/if}}
        {{#if this.unitIsSelect}}
          <Select
            class='pretui-amount-select'
            @options={{this.selectOptions}}
            @value={{this.unitValue}}
            @disabled={{@disabled}}
            @onValueChange={{this.onUnitPick}}
            aria-label={{this.unitName}}
            data-test-pretui-amount-unit
          />
        {{/if}}
      </div>
      {{#unless @quiet}}
        <p
          class='pretui-amount-readout'
          id={{this.readoutId}}
          role='status'
          aria-live='polite'
          data-test-pretui-amount-readout
        >{{this.readout}}</p>
      {{/unless}}
    </div>
    <style scoped>
      /* above Select's and SegmentedControl's layer, so these win by layer order, not file order */
      @layer PretComponent, PretComposite;
      @layer PretComposite {
        .pretui-amount {
          display: grid;
          gap: var(--space-2, 6px);
          container-type: inline-size;
        }
        /* Repeated per component: scoped CSS does not cross a component
           boundary, so a shared sr-only rule cannot be inherited. */
        .pretui-amount-sr {
          position: absolute;
          width: 1px;
          height: 1px;
          margin: -1px;
          padding: 0;
          overflow: hidden;
          clip-path: inset(50%);
          white-space: nowrap;
          border: 0;
        }
        /* Law 1 — the shell's depth is one token; nothing here sets a border
           for separation. The inner controls are inset by the encroachment
           constant so their radii stay concentric with the shell's. */
        .pretui-amount-shell {
          display: flex;
          align-items: center;
          gap: var(--space-2, 6px);
          min-height: var(--control-h, 32px);
          padding-inline: var(--space-3, 8px);
          border-radius: var(--radius);
          background: var(--field, var(--card));
          box-shadow: var(--pretui-shadow-control, 0 0 0 1px var(--border));
          transition:
            box-shadow 160ms var(--pretui-ease-snap, cubic-bezier(0.23, 1, 0.32, 1)),
            background-color 160ms var(--pretui-ease-snap, cubic-bezier(0.23, 1, 0.32, 1));
        }
        .pretui-amount-shell:focus-within {
          box-shadow:
            var(--pretui-shadow-control, 0 0 0 1px var(--border)),
            0 0 0 2px var(--ring);
        }
        .pretui-amount[data-invalid='true'] .pretui-amount-shell {
          box-shadow: 0 0 0 1px var(--destructive);
        }
        /* The mark reserves its own width so swapping USD → EUR moves nothing
           but the glyph. Icon-swaps-in-place, applied to a symbol. */
        .pretui-amount-mark {
          flex: 0 0 auto;
          min-width: var(--pretui-amount-mark-width, 1.25ch);
          text-align: center;
          font-size: var(--text-ui-md, 13px);
          color: var(--muted-foreground);
          font-variant-numeric: tabular-nums;
        }
        .pretui-amount-box {
          position: relative;
          flex: 1 1 auto;
          min-width: 0;
          display: flex;
        }
        .pretui-amount-ghost {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          pointer-events: none;
          font-size: var(--text-ui-md, 13px);
          font-variant-numeric: tabular-nums;
          color: var(--muted-foreground);
          opacity: 0.55;
        }
        .pretui-amount-input {
          width: 100%;
          min-width: 0;
          border: 0;
          background: none;
          padding: 0;
          font: inherit;
          font-size: var(--text-ui-md, 13px);
          /* Law 8 — every changing numeral is tabular, so a digit landing does
             not shift the ones beside it. */
          font-variant-numeric: tabular-nums;
          color: var(--foreground);
          text-align: var(--pretui-amount-align, end);
        }
        .pretui-amount-input:focus {
          outline: none;
        }
        .pretui-amount-input:disabled {
          color: var(--muted-foreground);
          cursor: not-allowed;
        }
        .pretui-amount-static {
          flex: 0 0 auto;
          font-size: var(--text-ui-sm, 11.5px);
          font-weight: var(--weight-medium, 500);
          color: var(--muted-foreground);
        }
        /* Reserved space (Appendix O.7): the readout appears and disappears as
           the box fills, and a row that changes height while you type is the
           defect this rule exists to prevent. */
        .pretui-amount-readout {
          margin: 0;
          min-height: 1.4em;
          font-size: var(--text-ui-sm, 11.5px);
          font-variant-numeric: tabular-nums;
          color: var(--muted-foreground);
        }
        .pretui-amount[data-invalid='true'] .pretui-amount-readout {
          color: var(--pretui-destructive-ink, var(--boxel-danger));
          font-weight: var(--weight-medium, 500);
        }
        /* A card knows its pane, not the viewport. Below the fold the unit
           control drops under the amount rather than squeezing it to nothing,
           and the shell keeps a full-width hit target on coarse pointers. */
        @container (max-width: 260px) {
          .pretui-amount-shell {
            flex-wrap: wrap;
            padding-block: var(--space-2, 6px);
          }
        }
        @media (pointer: coarse) {
          .pretui-amount-shell {
            min-height: 44px;
          }
        }
        .pretui-amount-shell .pretui-amount-segments,
        .pretui-amount-shell .pretui-amount-select {
          flex: 0 0 auto;
          margin-inline-start: auto;
        }
        .pretui-amount-shell .pretui-amount-select {
          min-width: var(--pretui-amount-select-width, 7.5rem);
        }
        @container (max-width: 260px) {
          .pretui-amount-shell .pretui-amount-segments,
          .pretui-amount-shell .pretui-amount-select {
            margin-inline-start: 0;
            width: 100%;
          }
        }
      }
    </style>
  </template>
}
