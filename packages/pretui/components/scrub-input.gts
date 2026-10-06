// Pretui — ScrubInput: a numeric field you can drag to change, with keyboard nudges and stepped scales.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { guidFor } from '@ember/object/internals';
import { clampRange, formatMeasure, keyboardNudge, normalizeStops, parseMeasure, roundTo, scrubDelta, scrubMultiplier, scrubs, stopAt, stopIndexFor, stopStride, stopText } from '../internal/design-tools';
import type { DragModifiers, ScaleStop, ScaleStops, ScrubFrame } from '../internal/design-tools';

// ═══════════════════════════════════════════════════════════════════════
// ScrubInput — the control every design tool lives on (fig-input-number)
// ═══════════════════════════════════════════════════════════════════════

export interface ScrubInputSignature {
  Args: {
    /** the current value; null renders empty. Uncontrolled when omitted. */
    value?: number | null;
    /** starting value when uncontrolled */
    defaultValue?: number;
    min?: number;
    max?: number;
    /** one arrow press, one stepper click, and `pixelsPerStep` px of
     * horizontal scrub each move the value by this much (default 1) */
    step?: number;
    /** px of pointer travel that buys one `step` (default 1, figui3's
     * rate; 6 on a stepped scale, where one stop per pixel is unusable).
     * Raise it for a control that needs a slower hand. */
    pixelsPerStep?: number;
    /**
     * A STEPPED SCALE: the ordered list of legal values, which turns this
     * from a continuous spinbutton into a discrete one. Apertures, ISO
     * speeds, type ramps and zoom levels are numeric without being
     * continuous — the gaps between legal values are not uniform, so
     * `@step` cannot describe them.
     *
     * With `@steps` present the gesture addresses the scale by INDEX: a
     * scrub, an arrow press and a stepper click each travel whole stops,
     * `@min`/`@max` default to the ends of the list, a typed number snaps
     * to the nearest legal value on commit, and the field shows the stop's
     * label ('f/5.6') while `aria-valuenow` still carries the number.
     */
    steps?: ScaleStops;
    /** decimal places kept on commit (default 2) */
    precision?: number;
    /** unit appended (or prepended) in the field: 'px', '%', '°', 'ms' */
    unit?: string;
    unitPosition?: 'prefix' | 'suffix';
    /** short text shown in the grip when there is no unit. Defaults to the
     * unit; with neither, there is no grip and the field scrubs. */
    grip?: string;
    /** 'grip' scrubs from the affix only; 'field' makes the entire control
     * a scrub surface (text selection still works, because the field only
     * scrubs while not focused). Defaults to 'grip' when there is a grip
     * (a `@unit` or `@grip`), otherwise 'field'. */
    scrubFrom?: 'grip' | 'field' | 'none';
    /** accessible name — REQUIRED in practice; a bare spinbutton in a
     * panel of twenty is unusable without one */
    label?: string;
    placeholder?: string;
    /** show the up/down stepper pair (figui3's `fig-steppers`) */
    steppers?: boolean;
    /** multi-selection with differing values */
    mixed?: boolean;
    /** `readonly` + `aria-disabled`, so the row stays keyboard-reachable */
    disabled?: boolean;
    /** id to place on the inner input, so a PropertyRow label points here */
    controlId?: string;
    /** id of a description element */
    describedBy?: string;
    /** continuous — fires on every scrub frame and every keystroke */
    onInput?: (value: number | null) => void;
    /** committed — fires on blur, on Enter, on scrub release, on a stepper
     * click. This is the one to persist. */
    onChange?: (value: number | null) => void;
  };
  Blocks: {
    /** replaces the grip's content (an axis glyph, an icon) */
    grip: [];
  };
  Element: HTMLDivElement;
}

export class ScrubInput extends Component<ScrubInputSignature> {
  /**
   * The name comes from a real `<label for>`, never from `aria-label`.
   *
   * When a wrapper (`PropertyRow`, `Field`) hands down a `@controlId` it
   * owns the visible label and this component renders none; standalone, the
   * component generates its own id and emits a visually-hidden label from
   * `@label`. Carrying BOTH an `id` and an `aria-label` is what the realm's
   * `require-input-label` rule calls "multiple labels", and it is right:
   * two competing names is a defect, not belt-and-braces.
   */
  private guid = guidFor(this);
  get inputId(): string {
    return this.args.controlId ?? this.guid + '-scrub';
  }
  get ownsLabel(): boolean {
    return this.args.controlId === undefined;
  }
  @tracked private internal: number | null =
    this.args.defaultValue ?? null;
  /** the raw text while the field has focus — a half-typed "-" or "1." must
   * survive until commit, so display is NOT derived from the number then */
  @tracked private draft: string | null = null;
  /** value at pointerdown; every scrub frame is an absolute offset from it,
   * so rounding cannot accumulate across a long drag */
  private scrubOrigin = 0;
  private scrubStart: number | null = null;
  private scrubValue: number | null | undefined;
  /** the same idea in index space, for a stepped scale */
  private scrubOriginIndex = 0;

  get value(): number | null {
    return this.args.value !== undefined ? this.args.value : this.internal;
  }

  // ── stepped scale ──────────────────────────────────────────────────
  get scaleStops(): ScaleStop[] {
    return normalizeStops(this.args.steps);
  }
  get isScale(): boolean {
    return this.scaleStops.length > 0;
  }
  get scaleIndex(): number {
    return this.args.mixed ? -1 : stopIndexFor(this.value, this.scaleStops);
  }
  get currentStop(): ScaleStop | undefined {
    let index = this.scaleIndex;
    return index < 0 ? undefined : this.scaleStops[index];
  }
  /** The effective bounds. On a scale the ends of the list ARE the range,
   * so Home/End and `aria-valuemin/max` work without the caller restating
   * numbers that are already in `@steps`. */
  get lowBound(): number | undefined {
    if (this.args.min !== undefined) {
      return this.args.min;
    }
    let stops = this.scaleStops;
    return stops.length > 0 ? stops[0].value : undefined;
  }
  get highBound(): number | undefined {
    if (this.args.max !== undefined) {
      return this.args.max;
    }
    let stops = this.scaleStops;
    return stops.length > 0 ? stops[stops.length - 1].value : undefined;
  }
  /** One stop per 6px by default: 1px per stop — the continuous default —
   * crosses a thirteen-stop aperture scale in thirteen pixels, which is a
   * twitch, not a gesture. */
  get travelPerStep(): number {
    return this.args.pixelsPerStep ?? (this.isScale ? 6 : 1);
  }
  get step(): number {
    let step = this.args.step ?? 1;
    return Number.isFinite(step) && step !== 0 ? Math.abs(step) : 1;
  }
  get precision(): number {
    return this.args.precision ?? 2;
  }
  get unit(): string {
    return this.args.unit ?? '';
  }
  get unitPosition(): 'prefix' | 'suffix' {
    return this.args.unitPosition === 'prefix' ? 'prefix' : 'suffix';
  }
  get gripText(): string {
    return this.args.grip ?? this.unit;
  }
  get scrubFrom(): 'grip' | 'field' | 'none' {
    if (this.args.scrubFrom) {
      return this.args.scrubFrom;
    }
    // without a grip element there is nothing else to drag from
    return this.gripText ? 'grip' : 'field';
  }
  get inert(): boolean {
    return this.args.disabled === true;
  }
  get scrubDisabled(): boolean {
    return this.inert || this.scrubFrom === 'none';
  }
  /** Set from the input's own focus/blur. Deliberately tracked: it gates a
   *  modifier argument, so the scrub surface re-arms when focus moves. */
  @tracked private fieldFocused = false;

  get fieldScrubDisabled(): boolean {
    // `while not focused` was documented on @scrubFrom and never implemented.
    // It is what lets one control be both draggable and typable: drag from the
    // resting field, and once you are editing, the pointer selects text
    // normally instead of scrubbing the value out from under the caret.
    return (
      this.scrubDisabled || this.scrubFrom !== 'field' || this.fieldFocused
    );
  }
  get gripScrubDisabled(): boolean {
    return this.scrubDisabled || this.scrubFrom !== 'grip';
  }
  get display(): string {
    if (this.draft !== null) {
      return this.draft;
    }
    if (this.args.mixed) {
      return '';
    }
    if (this.isScale) {
      // The label IS the value's name on a scale. Falling back to the
      // formatted number keeps a bare-number scale (a type ramp, a zoom
      // list) from needing a label per entry.
      return stopText(
        this.currentStop,
        this.precision,
        this.unit,
        this.unitPosition,
      );
    }
    return formatMeasure(
      this.value,
      this.precision,
      this.unit,
      this.unitPosition,
    );
  }
  get placeholder(): string {
    return this.args.mixed ? 'Mixed' : (this.args.placeholder ?? '');
  }
  get valueText(): string {
    if (this.args.mixed) {
      return 'Mixed';
    }
    let text = this.display;
    return text === '' ? 'Empty' : text;
  }
  get ariaNow(): string | undefined {
    if (this.args.mixed || this.value === null) {
      return undefined;
    }
    return String(this.value);
  }
  get fallbackLabel(): string {
    return this.args.label ?? 'Value';
  }
  get increaseLabel(): string {
    return this.args.label ? 'Increase ' + this.args.label : 'Increase';
  }
  get decreaseLabel(): string {
    return this.args.label ? 'Decrease ' + this.args.label : 'Decrease';
  }
  get atMin(): boolean {
    let bound = this.lowBound;
    return bound !== undefined && this.value !== null && this.value <= bound;
  }
  get atMax(): boolean {
    let bound = this.highBound;
    return bound !== undefined && this.value !== null && this.value >= bound;
  }
  get upDisabled(): boolean {
    return this.inert || this.atMax;
  }
  get downDisabled(): boolean {
    return this.inert || this.atMin;
  }

  private normalize(raw: number): number {
    let clamped = clampRange(raw, this.lowBound, this.highBound);
    if (this.isScale) {
      // Anything arriving from outside a gesture — a typed number, a
      // pasted one — lands on the nearest legal stop rather than between
      // two of them. A scale with an illegal value in it is not a scale.
      let stop = stopAt(stopIndexFor(clamped, this.scaleStops), this.scaleStops);
      return stop ? stop.value : clamped;
    }
    return roundTo(clamped, this.precision);
  }
  /** Travels `delta` value-units as whole stops from the current one, and
   * commits. An empty/mixed field lands on the low end first, so the first
   * arrow press is never a silent no-op. */
  private stepScale(delta: number, commit: boolean) {
    let stops = this.scaleStops;
    if (stops.length === 0) {
      return;
    }
    if (this.scaleIndex < 0) {
      this.write(stops[0].value, commit);
      return;
    }
    let stop = stopAt(this.scaleIndex + stopStride(delta), stops);
    if (stop) {
      this.write(stop.value, commit);
    }
  }
  private write(next: number | null, commit: boolean) {
    if (this.args.value === undefined) {
      this.internal = next;
    }
    this.args.onInput?.(next);
    if (commit) {
      this.args.onChange?.(next);
    }
  }
  /** the number a gesture starts from: the current value, or 0 when the
   * field is empty or mixed (a scrub on "Mixed" sets one value for all) */
  private get base(): number {
    return this.value === null || this.args.mixed ? 0 : this.value;
  }

  // ── scrub ──────────────────────────────────────────────────────────
  handleScrub = (part: ScrubFrame) => {
    if (this.inert) {
      return;
    }
    if (part.phase === 'start') {
      this.scrubOrigin = this.base;
      this.scrubStart = this.value;
      this.scrubValue = undefined;
      this.scrubOriginIndex = Math.max(0, this.scaleIndex);
      return;
    }
    if (part.phase === 'cancel') {
      if (this.scrubValue !== undefined) {
        this.scrubValue = undefined;
        this.write(this.scrubStart, false);
      }
      return;
    }
    if (part.phase === 'end') {
      if (this.scrubValue !== undefined) {
        let committed = this.scrubValue;
        this.scrubValue = undefined;
        this.args.onChange?.(committed);
      }
      // `scrubs` calls preventDefault on pointerdown to suppress the text
      // selection a drag would otherwise start — which also suppresses the
      // focus a plain click would have given the input. Below the movement
      // threshold the gesture was a click, so hand focus back explicitly.
      if (Math.abs(part.dx) < 3 && this.scrubFrom === 'field') {
        let input = document.getElementById(this.inputId);
        if (input instanceof HTMLElement) {
          input.focus();
        }
      }
      return;
    }
    if (this.isScale) {
      // Absolute from the index the gesture started on — the same
      // no-accumulated-drift rule as the continuous path, one dimension up.
      let stride = Math.round(
        scrubDelta(part.dx, 1, part, this.travelPerStep),
      );
      let stop = stopAt(this.scrubOriginIndex + stride, this.scaleStops);
      this.draft = null;
      if (stop) {
        this.scrubValue = stop.value;
        this.write(stop.value, false);
      }
      return;
    }
    let delta = scrubDelta(part.dx, this.step, part, this.travelPerStep);
    this.draft = null;
    this.scrubValue = this.normalize(this.scrubOrigin + delta);
    this.write(this.scrubValue, false);
  };

  // ── steppers ───────────────────────────────────────────────────────
  private nudge(direction: number, keys: DragModifiers) {
    if (this.inert) {
      return;
    }
    this.draft = null;
    if (this.isScale) {
      this.stepScale(scrubMultiplier(keys) * direction, true);
      return;
    }
    let delta = this.step * scrubMultiplier(keys) * direction;
    this.write(this.normalize(this.base + delta), true);
  }
  stepUp = (event: Event) => {
    let click = event as MouseEvent;
    this.nudge(1, { shift: click.shiftKey, alt: click.altKey });
  };
  stepDown = (event: Event) => {
    let click = event as MouseEvent;
    this.nudge(-1, { shift: click.shiftKey, alt: click.altKey });
  };

  // ── keyboard ───────────────────────────────────────────────────────
  handleKeyDown = (event: Event) => {
    if (this.inert) {
      return;
    }
    let key = event as KeyboardEvent;
    if (key.key === 'Enter') {
      event.preventDefault();
      this.commitDraft();
      return;
    }
    if (key.key === 'Escape') {
      // Abandon the half-typed text and fall back to the model value.
      this.draft = null;
      return;
    }
    // Left/Right belong to the caret inside a text field, so only the
    // vertical half of the shared intent is consumed here.
    if (key.key === 'ArrowLeft' || key.key === 'ArrowRight') {
      return;
    }
    let intent = keyboardNudge(
      key.key,
      { shift: key.shiftKey, alt: key.altKey, meta: key.metaKey },
      this.step,
    );
    if (!intent.handled) {
      return;
    }
    if (intent.toMin || intent.toMax) {
      let bound = intent.toMin ? this.lowBound : this.highBound;
      if (bound === undefined) {
        return;
      }
      event.preventDefault();
      this.draft = null;
      this.write(this.normalize(bound), true);
      return;
    }
    event.preventDefault();
    this.draft = null;
    if (this.isScale) {
      this.stepScale(intent.delta, true);
      return;
    }
    this.write(this.normalize(this.base + intent.delta), true);
  };

  // ── typing ─────────────────────────────────────────────────────────
  handleInput = (event: Event) => {
    if (this.inert) {
      return;
    }
    let text = (event.target as HTMLInputElement).value;
    this.draft = text;
    let parsed = parseMeasure(text);
    // Continuous callback only — no clamping while typing, or "5" on the
    // way to "50" gets rewritten under the caret.
    this.args.onInput?.(parsed);
    if (this.args.value === undefined) {
      this.internal = parsed;
    }
  };
  private commitDraft() {
    if (this.draft === null) {
      return;
    }
    let parsed = parseMeasure(this.draft);
    this.draft = null;
    this.write(parsed === null ? null : this.normalize(parsed), true);
  }
  handleBlur = () => {
    this.fieldFocused = false;
    this.commitDraft();
  };
  handleFocus = (event: Event) => {
    this.fieldFocused = true;
    // Select the numeric part so a typed digit replaces the value, which is
    // what every design tool does. figui3 needed a setTimeout(0) for this;
    // the focus event is already late enough in Glimmer.
    let input = event.target as HTMLInputElement;
    input.select();
  };
  <template>
    <div
      class='pretui-scrub'
      data-mixed={{if @mixed 'true'}}
      data-scale={{if this.isScale 'true'}}
      data-scrub-from={{this.scrubFrom}}
      data-disabled={{if this.inert 'true'}}
      {{scrubs this.handleScrub this.fieldScrubDisabled}}
      data-test-pretui-scrub-input
      ...attributes
    >
      {{#if this.gripText}}
        <span
          class='pretui-scrub-grip'
          data-position={{this.unitPosition}}
          aria-hidden='true'
          {{scrubs this.handleScrub this.gripScrubDisabled}}
          data-test-pretui-scrub-grip
        >
          {{#if (has-block 'grip')}}{{yield to='grip'}}{{else}}{{this.gripText}}{{/if}}
        </span>
      {{/if}}

      {{#if this.ownsLabel}}
        <label class='pretui-sr' for={{this.inputId}}>{{this.fallbackLabel}}</label>
      {{/if}}

      {{! A text input is allowed the spinbutton role (ARIA in HTML); the lint
          rule reads it as redundant, which it is not. }}
      {{! template-lint-disable no-redundant-role }}
      <input
        type='text'
        class='pretui-scrub-input'
        id={{this.inputId}}
        role='spinbutton'
        inputmode='decimal'
        autocomplete='off'
        spellcheck='false'
        aria-describedby={{@describedBy}}
        aria-valuenow={{this.ariaNow}}
        aria-valuemin={{this.lowBound}}
        aria-valuemax={{this.highBound}}
        aria-valuetext={{this.valueText}}
        aria-disabled={{if this.inert 'true'}}
        readonly={{this.inert}}
        placeholder={{this.placeholder}}
        value={{this.display}}
        {{on 'input' this.handleInput}}
        {{on 'keydown' this.handleKeyDown}}
        {{on 'focus' this.handleFocus}}
        {{on 'blur' this.handleBlur}}
      />

      {{#if @steppers}}
        <span class='pretui-scrub-steppers'>
          <button
            type='button'
            class='pretui-scrub-step'
            tabindex='-1'
            aria-label={{this.increaseLabel}}
            aria-disabled={{if this.upDisabled 'true'}}
            {{on 'click' this.stepUp}}
            data-test-pretui-scrub-up
          ><span class='pretui-scrub-caret' data-dir='up'></span></button>
          <button
            type='button'
            class='pretui-scrub-step'
            tabindex='-1'
            aria-label={{this.decreaseLabel}}
            aria-disabled={{if this.downDisabled 'true'}}
            {{on 'click' this.stepDown}}
            data-test-pretui-scrub-down
          ><span class='pretui-scrub-caret' data-dir='down'></span></button>
        </span>
      {{/if}}
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-scrub {
          display: flex;
          align-items: stretch;
          min-width: 0;
          width: 100%;
          height: var(--control-h, 28px);
          border-radius: var(--radius);
          background: var(--field, var(--boxel-light));
          box-shadow: 0 0 0 1px var(--input);
          color: var(--foreground);
          font-size: var(--text-ui-md, 12.5px);
          letter-spacing: var(--track-ui, 0.01em);
          font-variant-numeric: tabular-nums;
          overflow: hidden;
        }
        .pretui-scrub:hover {
          box-shadow: 0 0 0 1px var(--line-strong, var(--boxel-400));
        }
        /* The inner input drops its own outline and the field wraps it in a
           box-shadow ring, so the ring costs no layout. Forced-colors mode
           paints no box-shadow at all, so the ring is doubled by a transparent
           outline: invisible and layout-free in normal rendering, forced to a
           system colour in high contrast. */
        .pretui-scrub:has(.pretui-scrub-input:focus-visible) {
          outline: 2px solid transparent;
          outline-offset: 1px;
          box-shadow: 0 0 0 2px var(--ring);
        }
        .pretui-scrub[data-disabled='true'] {
          opacity: 0.5;
        }
        /* The whole field is a scrub surface only in scrubFrom='field'. */
        .pretui-scrub[data-scrub-from='field'] {
          cursor: ew-resize;
          touch-action: none;
        }
        /* Scoped CSS does not cross a component boundary, so the sr-only
           rule is repeated here rather than shared with PropertyRow's. */
        .pretui-sr {
          position: absolute;
          width: 1px;
          height: 1px;
          overflow: hidden;
          clip-path: inset(50%);
          white-space: nowrap;
        }
        .pretui-scrub-input {
          flex: 1 1 auto;
          min-width: 0;
          width: 100%;
          border: 0;
          background: transparent;
          color: inherit;
          font: inherit;
          letter-spacing: inherit;
          font-variant-numeric: inherit;
          padding-inline: var(--space-2, 6px);
          outline: none;
        }
        .pretui-scrub-input::placeholder {
          color: var(--ink-3, var(--boxel-400));
          font-family: var(--font-mono);
          font-size: var(--text-ui-xs, 11px);
        }
        /* The grip: a permanently visible ew-resize affordance. This is the
           discoverability figui3 leaves to a hidden Alt chord. */
        .pretui-scrub-grip {
          flex: none;
          display: flex;
          align-items: center;
          justify-content: center;
          min-width: 22px;
          padding-inline: 5px;
          font-family: var(--font-mono);
          font-size: var(--text-ui-xs, 11px);
          color: var(--muted-foreground);
          user-select: none;
          touch-action: none;
        }
        .pretui-scrub[data-scrub-from='grip'] .pretui-scrub-grip {
          cursor: ew-resize;
          background: color-mix(in oklch, var(--foreground) 4%, transparent);
        }
        .pretui-scrub[data-scrub-from='grip'] .pretui-scrub-grip:hover,
        .pretui-scrub-grip[data-scrubbing] {
          color: var(--foreground);
          background: color-mix(in oklch, var(--foreground) 9%, transparent);
        }
        .pretui-scrub-grip[data-position='suffix'] {
          order: 2;
        }
        .pretui-scrub-steppers {
          flex: none;
          order: 3;
          display: grid;
          grid-template-rows: 1fr 1fr;
          width: 18px;
          border-inline-start: 1px solid var(--border);
        }
        .pretui-scrub-step {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0;
          border: 0;
          background: transparent;
          color: var(--muted-foreground);
          cursor: pointer;
        }
        .pretui-scrub-step:hover {
          background: var(--hover, rgb(0 0 0 / 0.05));
          color: var(--foreground);
        }
        .pretui-scrub-step[aria-disabled='true'] {
          opacity: 0.35;
          cursor: default;
        }
        .pretui-scrub-caret {
          width: 0;
          height: 0;
          border-inline: 3px solid transparent;
        }
        .pretui-scrub-caret[data-dir='up'] {
          border-block-end: 3.5px solid currentColor;
        }
        .pretui-scrub-caret[data-dir='down'] {
          border-block-start: 3.5px solid currentColor;
        }
        /* Coarse pointers get a real target on the steppers, and the grip
           widens so a thumb can find it. */
        @media (pointer: coarse) {
          .pretui-scrub {
            height: max(var(--control-h, 28px), 36px);
          }
          .pretui-scrub-steppers {
            width: 28px;
          }
          .pretui-scrub-grip {
            min-width: 32px;
          }
        }
      }
    </style>
  </template>
}
