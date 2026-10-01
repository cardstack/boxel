// Pretui — PipScale: the labelled value scale under a slider.
//
// Chris asked what was worth taking from `svelte-range-slider-pips`
// (MPL-2.0, https://github.com/simeydotme/svelte-range-slider-pips). The
// answer is its *affordance vocabulary*, not its engine. Pretui's `Slider`
// already carries two-thumb range, the interval ladder, `aria-valuetext` and
// thinned ticks over two overlaid native `<input type='range'>` elements.
// What it does not carry is a SCALE: pips drawn at the values they name,
// lighting up as a range sweeps across them, clickable to jump.
//
// **Licence disposition.** Nothing here is a copy. MPL-2.0 is a file-level
// copyleft, so a copied file would stay MPL; the ideas carry no obligation
// and the ideas are all that was taken. The arithmetic below was derived
// independently and corrects two defects in the source's — see
// `derivePipStep` and `decimalsOf`, both of which are exported and unit
// tested precisely so the claim is checkable.
//
// **Why a component and not an argument on `Slider`.** The scale is useful
// with no slider under it — a labelled axis beneath a histogram, a facet
// filter, a meter. It imports nothing from `Slider`, which still draws its
// own plain ticks from `@ticks` or `@interval`; leave both unset and place a
// PipScale under the Slider for labelled pips.
//
// **What was declined, and why.** The source's `vertical` and `reversed`
// axes are not here: Pretui's `Slider` is horizontal-only, so a vertical
// scale would have no partner, and every position here is a CSS logical
// property, which gives RTL — the half of `reversed` that occurs in real
// documents — for free and for nothing. The spring-animated handle positions
// are not here either: they are a re-arming `requestAnimationFrame` loop,
// which is exactly the realm law's forbidden shape, and they animate a
// control that native inputs already move.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { htmlSafe } from '@ember/template';
import { focusWhen, rovingTabindex } from '../focus';

// ── Vocabulary ───────────────────────────────────────────────────────────

/**
 * What a pip draws. The source spells this `true | false | 'label'`, a union
 * that reads badly in a template and whose `'label'` member is truthy, so
 * `{{#if}}` on it silently means "ticks or labels". Three names, no union
 * arithmetic.
 */
export type PipMode = 'none' | 'ticks' | 'labels';

/** Where a pip sits on the rail. The two ends are addressable separately
 * because they are the two a reader actually anchors on. */
export type PipPlace = 'first' | 'rest' | 'last';

/**
 * How a pip relates to the current selection. Precedence is
 * limit > selected > span > plain: a pip outside the selectable window is
 * reported as unavailable whatever else is true of it.
 */
export type PipState = 'plain' | 'span' | 'selected' | 'limit';

/** Never round finer than this, whatever the step claims. */
const MAX_DECIMALS = 10;

/** Ten page-jumps cross the whole scale. */
const PAGE_DIVISOR = 10;

// ── Geometry, as pure functions ──────────────────────────────────────────
//
// Exported and free of DOM so the arithmetic is testable without rendering.
// This is where the two corrections to the source live.

/**
 * Decimal places implied by a step.
 *
 * The source takes a `precision` prop that **defaults to 2** and rounds every
 * pip value through it, so a slider with `step={0.001}` cannot express its own
 * step: each pip collapses onto the nearest hundredth and several land on the
 * same value. Deriving the precision from the step instead makes the default
 * always correct and removes the prop.
 */
export function decimalsOf(step: number): number {
  if (!isFinite(step) || step === 0) {
    return 0;
  }
  let text = String(Math.abs(step));
  if (text.indexOf('e') >= 0) {
    return MAX_DECIMALS;
  }
  let dot = text.indexOf('.');
  return dot < 0 ? 0 : Math.min(MAX_DECIMALS, text.length - dot - 1);
}

/** Round to the precision a step implies, killing binary-float noise. */
export function roundTo(value: number, decimals: number): number {
  return Number(value.toFixed(decimals));
}

/**
 * How many steps one pip spans.
 *
 * The source computes this as `(max - min) / (stepMax / 5)` — a value in
 * RAIL units assigned to a variable that is then multiplied by `step`, so the
 * result only lands near the intended pip count when `step` happens to be 1.
 * Two measurements of its own formula, target ~20 pips:
 *
 *   min 0, max 100, step 0.1  → 200 pips (ten times too many)
 *   min 0, max 10000, step 10 → 2 pips   (ten times too few)
 *
 * The count of pips is a function of the count of STEPS, not of the rail's
 * numeric width, so the ratio has to be dimensionless. It is here, and the
 * two cases above both yield 21.
 *
 * @param totalSteps how many steps the rail is divided into
 * @param targetPips roughly how many pips are wanted
 * @param maxPips hard ceiling; the span doubles until the count fits
 */
export function derivePipStep(
  totalSteps: number,
  targetPips: number,
  maxPips: number,
): number {
  let steps = Math.max(1, Math.floor(totalSteps));
  let target = Math.max(1, Math.floor(targetPips));
  let cap = Math.max(2, Math.floor(maxPips));
  let pipStep = Math.max(1, Math.ceil(steps / target));
  while (steps / pipStep + 1 > cap) {
    pipStep *= 2;
  }
  return pipStep;
}

/**
 * The pip values themselves.
 *
 * The trailing pip gets merged into `max` rather than appended beside it when
 * the two are less than half an interval apart. Without that, a rail of
 * 0…10 at an interval of 3 draws pips at 0, 3, 6, 9 and then 10 — two pips
 * a tenth of the rail apart, whose labels overlap into mush. The source has
 * this collision (it renders first and last unconditionally and filters the
 * interior on a strict `> min && < max`).
 */
export function pipValuesFor(
  min: number,
  max: number,
  step: number,
  pipStep: number,
  decimals: number,
): number[] {
  let stepSize = step > 0 ? step : 1;
  let interval = stepSize * Math.max(1, pipStep);
  if (!(max > min) || !isFinite(interval) || interval <= 0) {
    return [roundTo(min, decimals)];
  }
  let count = Math.floor((max - min) / interval);
  let out: number[] = [];
  for (let i = 0; i <= count; i++) {
    out.push(roundTo(min + i * interval, decimals));
  }
  let tail = out[out.length - 1];
  if (tail === undefined) {
    return [roundTo(min, decimals), roundTo(max, decimals)];
  }
  if (max - tail < interval / 2) {
    out[out.length - 1] = roundTo(max, decimals);
  } else {
    out.push(roundTo(max, decimals));
  }
  return out;
}

/**
 * Every Nth pip carries a label.
 *
 * The governor the source does not have: its `all='label'` labels every
 * single pip, so a twenty-pip scale on a narrow rail overlaps twenty
 * `white-space: nowrap` strings. Separating tick density from LABEL density
 * is the whole fix — dense hairlines read as texture, sparse labels read as
 * a scale.
 */
export function labelEveryFor(pipCount: number, maxLabels: number): number {
  let cap = Math.max(2, Math.floor(maxLabels));
  if (pipCount <= cap) {
    return 1;
  }
  return Math.max(1, Math.ceil((pipCount - 1) / (cap - 1)));
}

/**
 * Whether a pip falls inside the selected span. `'min'` fills from the rail
 * start up to the single value, `'max'` from the value to the rail end, and
 * `true` fills between a pair.
 */
export function inSpan(
  value: number,
  values: number[],
  span: boolean | 'min' | 'max' | undefined,
): boolean {
  let lo = values[0];
  if (lo === undefined || span === undefined || span === false) {
    return false;
  }
  if (span === 'min') {
    return value < lo;
  }
  if (span === 'max') {
    return value > lo;
  }
  let hi = values[1];
  return hi === undefined ? false : value > lo && value < hi;
}

/** A pip, fully resolved for rendering. */
export interface Pip {
  key: string;
  index: number;
  value: number;
  pct: number;
  /** the accessible name — prefix + formatted value + suffix */
  name: string;
  /** the visible label, or `undefined` when this pip is a bare tick */
  text: string | undefined;
  place: PipPlace;
  state: PipState;
  style: ReturnType<typeof htmlSafe>;
}

/** A pip plus the roving-focus state that changes as arrow keys move. */
export interface PipView extends Pip {
  tabStop: boolean;
  grabFocus: boolean;
}

export interface PipScaleSignature {
  Args: {
    min?: number;
    max?: number;
    step?: number;
    /** steps per pip; derived towards `@targetPips` when omitted */
    pipStep?: number;
    /** roughly how many pips to derive (default 20) */
    targetPips?: number;
    /** hard ceiling on pips drawn (default 120) */
    maxPips?: number;
    /** hard ceiling on pips that carry a LABEL (default 8) */
    maxLabels?: number;
    /** base mode for every pip; the three below override it per position */
    pips?: PipMode;
    first?: PipMode;
    rest?: PipMode;
    last?: PipMode;
    /** the selected value, or the [lower, upper] pair of a range */
    values?: number[];
    /** paint the pips between the values, or below/above a single value */
    span?: boolean | 'min' | 'max';
    /** the selectable window; pips outside it draw quiet and take no clicks */
    limits?: [number, number];
    formatValue?: (value: number) => string;
    prefix?: string;
    suffix?: string;
    disabled?: boolean;
    /** accessible name for the group of pip buttons */
    label?: string;
    /**
     * Fires with a pip's value when one is picked. **Omitting it makes the
     * scale decorative** — no buttons are rendered at all and the whole
     * element is `aria-hidden`. A scale that moved something without telling
     * its owner would be the ship-blocking case; a scale that is purely a
     * drawing should not be in the tab order.
     */
    onPick?: (value: number) => void;
  };
  Element: HTMLDivElement;
}

/**
 * A labelled value scale.
 *
 * Four things here are deliberately better than the library the vocabulary
 * came from, and each is a defect in it rather than a matter of taste:
 *
 * 1. **The pips are reachable.** The source's are `aria-hidden` spans with
 *    `pointerdown`/`pointerup` handlers — a pointer-only affordance with no
 *    keyboard path at all. Here each pip is a real `<button>` in a
 *    roving-tabindex group: one tab stop for the whole scale, arrows to
 *    move, Home/End to the ends, Enter or Space to pick. That is not merely
 *    parity with the pointer — it is a capability the slider thumb does not
 *    have, since it jumps straight to a named stop instead of arrowing
 *    through forty steps to reach it.
 * 2. **The targets are hittable.** The source's pips are 1px wide, an order
 *    of magnitude under WCAG 2.5.8's 24px floor. Here the visible tick stays
 *    a hairline while an invisible button covers the full height and as much
 *    width as the pip spacing allows — `min(24px, one interval)`, so
 *    neighbouring targets grow to the limit and never overlap.
 * 3. **Selection does not reflow the scale.** The source bolds a selected
 *    (and hovered) pip's label, which changes its width and shoves its
 *    neighbours; its own stylesheet pins `font-weight 0s linear` to stop the
 *    jitter animating, which concedes the problem. Here selection is carried
 *    by tick height and colour, both of which are free of layout.
 * 4. **The end labels stay inside the box.** The source centres every label
 *    on its pip, so the first and last hang half their width off each end of
 *    the rail. Here the two ends align inward instead.
 */
export class PipScale extends Component<PipScaleSignature> {
  @tracked rovingIndex = 0;
  /** Focus only follows the roving index once a key has actually moved it,
   * so mounting a scale never steals focus from the page. */
  @tracked keyboardActive = false;

  get min() {
    return this.args.min ?? 0;
  }
  get max() {
    return this.args.max ?? 100;
  }
  get stepSize() {
    let step = this.args.step ?? 1;
    return step > 0 ? step : 1;
  }
  get decimals() {
    return decimalsOf(this.stepSize);
  }
  get totalSteps() {
    return Math.max(1, Math.round((this.max - this.min) / this.stepSize));
  }
  /** Caller-supplied spans are still put through the ceiling: a hand-set
   * `@pipStep` of 1 on a ten-thousand-step rail must not draw ten thousand
   * elements. */
  get pipStep() {
    let asked = this.args.pipStep;
    let cap = this.args.maxPips ?? 120;
    if (asked !== undefined && asked > 0) {
      let pipStep = Math.max(1, Math.round(asked));
      while (this.totalSteps / pipStep + 1 > Math.max(2, cap)) {
        pipStep *= 2;
      }
      return pipStep;
    }
    return derivePipStep(this.totalSteps, this.args.targetPips ?? 20, cap);
  }
  get values(): number[] {
    return this.args.values ?? [];
  }
  get baseMode(): PipMode {
    return this.args.pips ?? 'ticks';
  }
  get interactive() {
    return this.args.onPick !== undefined && this.args.disabled !== true;
  }

  private modeFor(place: PipPlace): PipMode {
    if (place === 'first') {
      return this.args.first ?? this.baseMode;
    }
    if (place === 'last') {
      return this.args.last ?? this.baseMode;
    }
    return this.args.rest ?? this.baseMode;
  }

  private nameFor(value: number): string {
    let body = this.args.formatValue?.(value) ?? String(value);
    return (this.args.prefix ?? '') + body + (this.args.suffix ?? '');
  }

  private stateFor(value: number): PipState {
    let limits = this.args.limits;
    if (limits !== undefined && (value < limits[0] || value > limits[1])) {
      return 'limit';
    }
    let tolerance = Math.pow(10, -this.decimals) / 2;
    if (this.values.some((v) => Math.abs(v - value) < tolerance)) {
      return 'selected';
    }
    return inSpan(value, this.values, this.args.span) ? 'span' : 'plain';
  }

  get pips(): Pip[] {
    let raw = pipValuesFor(
      this.min,
      this.max,
      this.stepSize,
      this.pipStep,
      this.decimals,
    );
    let count = raw.length;
    let every = labelEveryFor(count, this.args.maxLabels ?? 8);
    let width = this.max - this.min;
    let drawn: Pip[] = [];
    raw.forEach((value, slot) => {
      let place: PipPlace =
        slot === 0 ? 'first' : slot === count - 1 ? 'last' : 'rest';
      let mode = this.modeFor(place);
      if (mode === 'none') {
        return;
      }
      // The two ends always carry their label when their mode asks for one:
      // they are the anchors a reader reads the scale from, and thinning
      // them to satisfy a density rule would remove exactly the two numbers
      // that make the rest of the scale legible.
      let labelled =
        mode === 'labels' && (place !== 'rest' || slot % every === 0);
      let pct = width > 0 ? ((value - this.min) / width) * 100 : 0;
      let name = this.nameFor(value);
      drawn.push({
        key: 'pip-' + String(value),
        // Re-numbered over the DRAWN pips, so roving focus and the click
        // handler index the same array the template rendered.
        index: drawn.length,
        value,
        pct,
        name,
        text: labelled ? name : undefined,
        place,
        state: this.stateFor(value),
        style: htmlSafe('--pretui-pip-at: ' + pct.toFixed(4) + '%'),
      });
    });
    return drawn;
  }

  /** Geometry and roving state are separate getters so an arrow key
   * recomputes two booleans per pip rather than the whole scale. */
  get pipViews(): PipView[] {
    let active = this.rovingIndex;
    return this.pips.map((pip) => ({
      ...pip,
      tabStop: pip.index === active,
      grabFocus: this.keyboardActive && pip.index === active,
    }));
  }

  get hasLabels(): string {
    return this.pips.some((pip) => pip.text !== undefined) ? 'true' : 'false';
  }
  get visible() {
    return this.pips.length > 0;
  }
  get scaleStyle() {
    let count = this.pips.length;
    let gap = count > 1 ? 100 / (count - 1) : 100;
    return htmlSafe('--pretui-pip-gap: ' + gap.toFixed(4) + '%');
  }
  get groupRole(): string | undefined {
    return this.interactive ? 'group' : undefined;
  }
  get groupLabel(): string | undefined {
    return this.interactive ? (this.args.label ?? 'Value scale') : undefined;
  }
  /** Decorative scales are hidden wholesale; interactive ones expose only
   * their buttons, with the drawn face hidden per-element. */
  get hiddenFlag(): string | undefined {
    return this.interactive ? undefined : 'true';
  }
  get disabledFlag(): string {
    return this.args.disabled === true ? 'true' : 'false';
  }
  get interactiveFlag(): string {
    return this.interactive ? 'true' : 'false';
  }
  get pageJump() {
    return Math.max(1, Math.round(this.pips.length / PAGE_DIVISOR));
  }

  private indexOfEvent(event: Event): number {
    let el = event.currentTarget as HTMLElement | null;
    let raw = el === null ? null : el.getAttribute('data-pip-index');
    return raw === null ? -1 : Number(raw);
  }

  pickFrom = (event: Event) => {
    let index = this.indexOfEvent(event);
    let pip = this.pips[index];
    if (pip === undefined || pip.state === 'limit') {
      return;
    }
    this.rovingIndex = index;
    this.args.onPick?.(pip.value);
  };

  // Typed as `Event` because that is what `{{on}}` promises its handler; the
  // narrow type is recovered here rather than asserted at the call site.
  onKeydown = (raw: Event) => {
    let event = raw as KeyboardEvent;
    let count = this.pips.length;
    let at = this.indexOfEvent(event);
    if (count === 0 || at < 0) {
      return;
    }
    let next = at;
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      next = Math.min(count - 1, at + 1);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      next = Math.max(0, at - 1);
    } else if (event.key === 'Home') {
      next = 0;
    } else if (event.key === 'End') {
      next = count - 1;
    } else if (event.key === 'PageUp') {
      next = Math.min(count - 1, at + this.pageJump);
    } else if (event.key === 'PageDown') {
      next = Math.max(0, at - this.pageJump);
    } else {
      return;
    }
    event.preventDefault();
    this.keyboardActive = true;
    this.rovingIndex = next;
  };

  <template>
    {{#if this.visible}}
      <div
        class='pretui-pipscale'
        data-test-pretui-pipscale
        data-pip-labels={{this.hasLabels}}
        data-pip-interactive={{this.interactiveFlag}}
        data-pip-disabled={{this.disabledFlag}}
        role={{this.groupRole}}
        aria-label={{this.groupLabel}}
        aria-hidden={{this.hiddenFlag}}
        style={{this.scaleStyle}}
        ...attributes
      >
        {{#each this.pipViews key='key' as |pip|}}
          <div
            class='pretui-pip'
            data-pip-place={{pip.place}}
            data-pip-state={{pip.state}}
            data-pip-value={{pip.value}}
            style={{pip.style}}
          >
            <span class='pretui-pip-tick' aria-hidden='true'></span>
            {{#if pip.text}}
              <span class='pretui-pip-label' aria-hidden='true'>{{pip.text}}</span>
            {{/if}}
            {{#if this.interactive}}
              <button
                type='button'
                class='pretui-pip-hit'
                aria-label={{pip.name}}
                data-pip-index={{pip.index}}
                {{rovingTabindex pip.tabStop}}
                {{focusWhen pip.grabFocus}}
                {{on 'click' this.pickFrom}}
                {{on 'keydown' this.onKeydown}}
              ></button>
            {{/if}}
          </div>
        {{/each}}
      </div>
    {{/if}}
    <style scoped>
      @layer PretComponent {
        /*
          The scale is inset by half a thumb on each side. A native
          `input[type=range]` moves its thumb CENTRE between thumb/2 and
          width - thumb/2, so a pip drawn at a true 0% of the full width sits
          half a thumb outside the position the slider can actually reach.
          Insetting the pip band by the same amount puts pip and thumb in
          register at both ends. Pretui's Slider thumb is 14px.
        */
        .pretui-pipscale {
          --pretui-pip-hit: min(24px, var(--pretui-pip-gap, 24px));
          position: relative;
          display: block;
          block-size: var(--pretui-pip-height, 1em);
          margin-inline: var(--pretui-pip-inset, 7px);
          font-family: var(--font-mono);
          font-size: var(--text-ui-xs, 11px);
          font-variant-numeric: tabular-nums;
          line-height: 1;
          color: var(--ink-3, var(--boxel-400));
        }
        /*
          A pickable scale reserves real height whether or not it carries
          labels. Without this a tick-only scale is one em tall, so its buttons
          would be an 11px target — the same WCAG 2.5.8 failure as the source's
          1px pips, moved from the horizontal axis to the vertical one. The
          extra height is invisible: the ticks stay pinned to the top and the
          space below them is hit area.
        */
        .pretui-pipscale[data-pip-interactive='true'] {
          block-size: max(var(--pretui-pip-height-hit, 1.9em), 24px);
        }
        .pretui-pipscale[data-pip-labels='true'] {
          block-size: max(var(--pretui-pip-height-labelled, 2.2em), 24px);
        }
        .pretui-pipscale[data-pip-disabled='true'] {
          opacity: 0.55;
        }
        /*
          Centring without a transform: the pip box is the hit width, and a
          negative logical start margin pulls it back by half. `margin-inline-
          start` flips under RTL where a `translateX(-50%)` would not.
        */
        .pretui-pip {
          position: absolute;
          inset-block: 0;
          inset-inline-start: var(--pretui-pip-at, 0%);
          inline-size: var(--pretui-pip-hit, 24px);
          margin-inline-start: calc(-0.5 * var(--pretui-pip-hit, 24px));
        }
        .pretui-pip-tick {
          position: absolute;
          inset-block-start: 0;
          inset-inline-start: 50%;
          inline-size: 1px;
          block-size: 0.4em;
          margin-inline-start: -0.5px;
          background: var(--line-strong, var(--boxel-400));
          transition:
            block-size var(--pretui-dur-snap, 180ms) var(--pretui-ease-snap, ease),
            background-color var(--pretui-dur-snap, 180ms)
              var(--pretui-ease-snap, ease);
        }
        .pretui-pip[data-pip-state='span'] .pretui-pip-tick {
          block-size: 0.58em;
          background: color-mix(
            in oklch,
            var(--primary) 55%,
            var(--line-strong, var(--boxel-400))
          );
        }
        .pretui-pip[data-pip-state='selected'] .pretui-pip-tick {
          inline-size: 2px;
          block-size: 0.78em;
          margin-inline-start: -1px;
          background: var(--primary);
        }
        .pretui-pip[data-pip-state='limit'] .pretui-pip-tick {
          background: color-mix(
            in oklch,
            var(--line-strong, var(--boxel-400)) 50%,
            transparent
          );
        }
        /*
          The label box overhangs its pip generously on both sides and centres
          its text — so the text centres on its own width with no transform and
          no measurement. The two ends align inward instead, which is what
          keeps them from hanging off the rail.
        */
        .pretui-pip-label {
          position: absolute;
          inset-block-start: 0.85em;
          inset-inline: -4em;
          display: flex;
          justify-content: center;
          white-space: nowrap;
          pointer-events: none;
        }
        .pretui-pip[data-pip-place='first'] .pretui-pip-label {
          inset-inline-start: 0;
          justify-content: flex-start;
        }
        .pretui-pip[data-pip-place='last'] .pretui-pip-label {
          inset-inline-end: 0;
          justify-content: flex-end;
        }
        /*
          Selection reads as colour, never as weight. Bolding a label changes
          its width and shoves its neighbours, which is the jitter the source
          pins `font-weight 0s` to hide rather than to fix.
        */
        .pretui-pip[data-pip-state='selected'] .pretui-pip-label,
        .pretui-pip[data-pip-state='span'] .pretui-pip-label {
          color: var(--foreground);
        }
        .pretui-pip[data-pip-state='limit'] .pretui-pip-label {
          opacity: 0.5;
        }
        /* The hit target: invisible, full height, as wide as spacing allows. */
        .pretui-pip-hit {
          position: absolute;
          inset: 0;
          padding: 0;
          border: 0;
          background: transparent;
          border-radius: var(--radius);
          cursor: pointer;
        }
        .pretui-pip[data-pip-state='limit'] .pretui-pip-hit {
          cursor: default;
        }
        .pretui-pip-hit:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 1px;
        }
        .pretui-pip:has(.pretui-pip-hit:hover) .pretui-pip-tick,
        .pretui-pip:has(.pretui-pip-hit:focus-visible) .pretui-pip-tick {
          block-size: 0.7em;
          background: var(--primary);
        }
        .pretui-pip:has(.pretui-pip-hit:active) .pretui-pip-tick {
          block-size: 0.88em;
          background: var(--primary);
        }
        .pretui-pip:has(.pretui-pip-hit:hover) .pretui-pip-label,
        .pretui-pip:has(.pretui-pip-hit:focus-visible) .pretui-pip-label {
          color: var(--foreground);
        }
        .pretui-pip[data-pip-state='limit']:has(.pretui-pip-hit:hover)
          .pretui-pip-tick {
          block-size: 0.4em;
          background: color-mix(
            in oklch,
            var(--line-strong, var(--boxel-400)) 50%,
            transparent
          );
        }
        @media (prefers-reduced-motion: reduce) {
          .pretui-pip-tick {
            transition: none;
          }
        }
      }
    </style>
  </template>
}
