// Pretui — EasingCurve: a cubic-bezier editor with presets and a live plot.
// Pretui — design-tools territory, wave 3: the curve editor.
//
// PORTED (not vendored) from figui3 v8.1.0 by Rogie King — MIT licensed
// (LICENSE verified in the source tree). `fig-easing-curve`, reimplemented
// in Pretui idiom on the `design-tools.gts` gesture foundation.
//
// ── Better than the inspiration ──────────────────────────────────────────
//
//  1. **The preview is the point, and it obeys the Motion Rule.** Upstream
//     draws the curve and stops. Here a preview dot travels the curve with
//     `animation-timing-function: cubic-bezier(...)` — motion that encodes
//     the value rather than decorating it (Law 5) — and under
//     `prefers-reduced-motion: reduce` it lands on the END state instead of
//     a frozen midpoint, with the curve plot carrying the same information
//     in a still frame (Law 8).
//  2. **Overshoot is a first-class value.** Upstream clamps handle Y to the
//     plot box, which makes `cubic-bezier(.34, 1.56, .64, 1)` — the single
//     most-used "back out" curve on the web — unreachable by dragging. The
//     plot here spans y ∈ [−0.5, 1.5] and says so with gridlines.
//  3. **Both handles are keyboard-operable, and named.** Each is a `Handle`
//     from the foundation: arrows with the shared Shift/Alt multipliers,
//     Home/End, a visible focus ring, and an accessible name carrying the
//     live coordinates ("Control point 1, 0.42, 0").
//  4. **The value is exact and it round-trips.** `@value` is four numbers;
//     `cssValue` is the string. Upstream stores a string and re-parses it,
//     so precision quietly drifts each time a handle moves.
//
// NOT ported: figui3's `spring(mass, stiffness, damping)` mode. A spring is
// not a cubic Bézier — it needs an integrator and a settle-time solver, and
// Pretui's motion territory (`motion-core.gts`) is the right owner. Named
// here rather than hidden (Law 7).
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { htmlSafe } from '@ember/template';
import { guidFor } from '@ember/object/internals';
import { Select } from './select';
import type { SelectOption } from './select';
import { Handle } from './handle';
import { ScrubInput } from './scrub-input';
import { bezierAt, clampRange, dragsSurface, roundTo } from '../internal/design-tools';
import type { SurfaceFrame } from '../internal/design-tools';

// ═══════════════════════════════════════════════════════════════════════
// The curve value and its plot geometry
// ═══════════════════════════════════════════════════════════════════════

export interface CubicBezier {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Vertical extent of the plot. Overshoot and undershoot are legal CSS and
 * must therefore be reachable by dragging — this is the range that makes
 * `cubic-bezier(.34, 1.56, .64, 1)` a place a handle can go. */
export const PLOT_MIN = -0.5;
export const PLOT_MAX = 1.5;

/** Curve-space y → the plot box's top-down percentage. */
export function plotY(y: number): number {
  return ((PLOT_MAX - y) / (PLOT_MAX - PLOT_MIN)) * 100;
}

/** The plot box's top-down 0–1 fraction → curve-space y. */
export function unplotY(fraction: number): number {
  return PLOT_MAX - fraction * (PLOT_MAX - PLOT_MIN);
}

/** Clamps a control point to the legal CSS range: x ∈ [0, 1] by spec,
 * y unbounded in principle but held to the plot so a value is always
 * reachable again by dragging. */
export function clampControl(x: number, y: number): { x: number; y: number } {
  return {
    x: roundTo(clampRange(x, 0, 1), 4),
    y: roundTo(clampRange(y, PLOT_MIN, PLOT_MAX), 4),
  };
}

/** The `cubic-bezier(...)` string for a value. Every component is rounded
 * and range-checked first, so this is safe to interpolate into CSS. */
export function bezierCss(value: CubicBezier): string {
  let a = clampControl(value.x1, value.y1);
  let b = clampControl(value.x2, value.y2);
  return (
    'cubic-bezier(' + a.x + ', ' + a.y + ', ' + b.x + ', ' + b.y + ')'
  );
}

/** An SVG polyline of the curve in a 0…100 viewBox, sampled at `steps`
 * points. Pure geometry: no DOM, no component state. */
export function bezierPoints(value: CubicBezier, steps = 48): string {
  let a = clampControl(value.x1, value.y1);
  let b = clampControl(value.x2, value.y2);
  let out: string[] = [];
  for (let i = 0; i <= steps; i++) {
    let t = i / steps;
    let x = bezierAt(t, a.x, b.x) * 100;
    let y = plotY(bezierAt(t, a.y, b.y));
    out.push(roundTo(x, 2) + ',' + roundTo(y, 2));
  }
  return out.join(' ');
}

/** The CSS-named easings, plus the two overshoot curves every motion system
 * ends up wanting. Exported so a preset picker elsewhere can reuse them. */
export const EASING_PRESETS: ReadonlyArray<{
  value: string;
  label: string;
  curve: CubicBezier;
}> = [
  { value: 'linear', label: 'Linear', curve: { x1: 0, y1: 0, x2: 1, y2: 1 } },
  { value: 'ease', label: 'Ease', curve: { x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 } },
  { value: 'ease-in', label: 'Ease in', curve: { x1: 0.42, y1: 0, x2: 1, y2: 1 } },
  { value: 'ease-out', label: 'Ease out', curve: { x1: 0, y1: 0, x2: 0.58, y2: 1 } },
  {
    value: 'ease-in-out',
    label: 'Ease in out',
    curve: { x1: 0.42, y1: 0, x2: 0.58, y2: 1 },
  },
  {
    value: 'back-out',
    label: 'Back out',
    curve: { x1: 0.34, y1: 1.56, x2: 0.64, y2: 1 },
  },
  {
    value: 'back-in',
    label: 'Back in',
    curve: { x1: 0.36, y1: 0, x2: 0.66, y2: -0.56 },
  },
  {
    value: 'anticipate',
    label: 'Anticipate',
    curve: { x1: 0.68, y1: -0.6, x2: 0.32, y2: 1.6 },
  },
];

/** The preset whose curve matches, or 'custom'. */
export function presetFor(value: CubicBezier, tolerance = 0.005): string {
  let match = EASING_PRESETS.find(
    (preset) =>
      Math.abs(preset.curve.x1 - value.x1) <= tolerance &&
      Math.abs(preset.curve.y1 - value.y1) <= tolerance &&
      Math.abs(preset.curve.x2 - value.x2) <= tolerance &&
      Math.abs(preset.curve.y2 - value.y2) <= tolerance,
  );
  return match ? match.value : 'custom';
}

const PRESET_OPTIONS: SelectOption[] = [
  ...EASING_PRESETS.map((preset) => ({
    value: preset.value,
    label: preset.label,
  })),
  { value: 'custom', label: 'Custom' },
];

// ═══════════════════════════════════════════════════════════════════════
// EasingCurve
// ═══════════════════════════════════════════════════════════════════════

export interface EasingCurveSignature {
  Args: {
    /** the four cubic-bezier control-point coordinates */
    value?: CubicBezier;
    defaultValue?: CubicBezier;
    /** render the preset picker (default true) */
    presets?: boolean;
    /** render the four numeric fields (default true) — the exact-value path
     * that makes the two draggable handles an enhancement rather than the
     * only way to author a curve */
    fields?: boolean;
    /** render the travelling preview dot (default true) */
    preview?: boolean;
    /** preview duration in ms (default 1200) */
    previewDuration?: number;
    /** decimal places (default 2 — CSS authors write two) */
    precision?: number;
    label?: string;
    disabled?: boolean;
    onInput?: (value: CubicBezier) => void;
    onChange?: (value: CubicBezier) => void;
  };
  Element: HTMLDivElement;
}

const DEFAULT_CURVE: CubicBezier = { x1: 0.42, y1: 0, x2: 0.58, y2: 1 };

export class EasingCurve extends Component<EasingCurveSignature> {
  @tracked private internal: CubicBezier =
    this.args.defaultValue ?? DEFAULT_CURVE;
  /** which control point the current drag grabbed: 1, 2, or 0 for none */
  private grabbed = 0;
  private guid = guidFor(this);

  get curve(): CubicBezier {
    return this.args.value ?? this.internal;
  }
  get precision(): number {
    return this.args.precision ?? 2;
  }
  get showPresets(): boolean {
    return this.args.presets ?? true;
  }
  get showFields(): boolean {
    return this.args.fields ?? true;
  }
  get showPreview(): boolean {
    return this.args.preview ?? true;
  }
  get label(): string {
    return this.args.label ?? 'Easing curve';
  }
  get plotId(): string {
    return this.guid + '-plot';
  }
  get points(): string {
    return bezierPoints(this.curve);
  }
  get cssValue(): string {
    return bezierCss(this.curve);
  }
  get preset(): string {
    return presetFor(this.curve);
  }
  get p1X(): number {
    return clampRange(this.curve.x1, 0, 1) * 100;
  }
  get p1Y(): number {
    return plotY(clampRange(this.curve.y1, PLOT_MIN, PLOT_MAX));
  }
  get p2X(): number {
    return clampRange(this.curve.x2, 0, 1) * 100;
  }
  get p2Y(): number {
    return plotY(clampRange(this.curve.y2, PLOT_MIN, PLOT_MAX));
  }
  /* The same coordinates in the SVG's 0…100 viewBox, for the control legs.
     `preserveAspectRatio='none'` means the viewBox units ARE percentages. */
  get svgP1X(): number {
    return roundTo(this.p1X, 2);
  }
  get svgP1Y(): number {
    return roundTo(this.p1Y, 2);
  }
  get svgP2X(): number {
    return roundTo(this.p2X, 2);
  }
  get svgP2Y(): number {
    return roundTo(this.p2Y, 2);
  }
  get p1Text(): string {
    return roundTo(this.curve.x1, this.precision) + ', ' + roundTo(this.curve.y1, this.precision);
  }
  get p2Text(): string {
    return roundTo(this.curve.x2, this.precision) + ', ' + roundTo(this.curve.y2, this.precision);
  }
  /** The whole visual layer rides two custom properties plus the timing
   * function — every number clamped and rounded before it reaches CSS, so
   * no caller value can become a declaration. */
  get plotStyle() {
    let duration = Math.max(
      100,
      Math.min(10000, Math.round(Number(this.args.previewDuration ?? 1200) || 1200)),
    );
    return htmlSafe(
      '--pretui-curve-ease: ' +
        this.cssValue +
        '; --pretui-curve-dur: ' +
        duration +
        'ms',
    );
  }
  private commit(next: CubicBezier, done: boolean) {
    let a = clampControl(next.x1, next.y1);
    let b = clampControl(next.x2, next.y2);
    let value: CubicBezier = { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
    if (this.args.value === undefined) {
      this.internal = value;
    }
    this.args.onInput?.(value);
    if (done) {
      this.args.onChange?.(value);
    }
  }

  handleDrag = (part: SurfaceFrame) => {
    if (this.args.disabled) {
      return;
    }
    if (part.phase === 'start') {
      // Which handle did the press land on? `origin` is held stable for the
      // whole gesture by dragsSurface, so this is decided exactly once.
      let handle =
        part.origin instanceof Element
          ? part.origin.closest('[data-handle]')
          : null;
      let index = handle?.getAttribute('data-handle');
      if (index === '1' || index === '2') {
        this.grabbed = Number(index);
        return;
      }
      // A press on empty plot grabs the NEARER control point, which is what
      // makes the curve directly manipulable instead of handle-only.
      let x = part.nx;
      let y = part.ny;
      let d1 = Math.hypot(x - this.curve.x1, y - this.p1Y / 100);
      let d2 = Math.hypot(x - this.curve.x2, y - this.p2Y / 100);
      this.grabbed = d1 <= d2 ? 1 : 2;
    }
    if (this.grabbed === 0) {
      return;
    }
    if (part.phase === 'end') {
      this.grabbed = 0;
      this.args.onChange?.(this.curve);
      return;
    }
    let x = part.nx;
    let y = unplotY(part.ny);
    if (this.grabbed === 1) {
      this.commit({ ...this.curve, x1: x, y1: y }, false);
    } else {
      this.commit({ ...this.curve, x2: x, y2: y }, false);
    }
  };

  private nudge(which: 1 | 2, dx: number, dy: number) {
    // Handles report in PERCENT of the surface; the curve is in 0–1 for x
    // and spans two units of y, so the two axes scale differently.
    let stepX = dx / 100;
    let stepY = (-dy / 100) * (PLOT_MAX - PLOT_MIN);
    if (dx === -Infinity || dx === Infinity) {
      let edge = dx === -Infinity ? 0 : 1;
      this.commit(
        which === 1 ? { ...this.curve, x1: edge } : { ...this.curve, x2: edge },
        true,
      );
      return;
    }
    if (which === 1) {
      this.commit(
        { ...this.curve, x1: this.curve.x1 + stepX, y1: this.curve.y1 + stepY },
        true,
      );
    } else {
      this.commit(
        { ...this.curve, x2: this.curve.x2 + stepX, y2: this.curve.y2 + stepY },
        true,
      );
    }
  }
  nudgeP1 = (dx: number, dy: number) => this.nudge(1, dx, dy);
  nudgeP2 = (dx: number, dy: number) => this.nudge(2, dx, dy);

  setX1 = (v: number | null) => {
    if (v !== null) {
      this.commit({ ...this.curve, x1: v }, true);
    }
  };
  setY1 = (v: number | null) => {
    if (v !== null) {
      this.commit({ ...this.curve, y1: v }, true);
    }
  };
  setX2 = (v: number | null) => {
    if (v !== null) {
      this.commit({ ...this.curve, x2: v }, true);
    }
  };
  setY2 = (v: number | null) => {
    if (v !== null) {
      this.commit({ ...this.curve, y2: v }, true);
    }
  };

  presetOptions = PRESET_OPTIONS;
  choosePreset = (value: string) => {
    let preset = EASING_PRESETS.find((entry) => entry.value === value);
    if (preset) {
      this.commit({ ...preset.curve }, true);
    }
  };
  <template>
    <div
      class='pretui-curve'
      data-disabled={{if @disabled 'true'}}
      style={{this.plotStyle}}
      data-test-pretui-easing-curve
      ...attributes
    >
      <div
        class='pretui-curve-plot'
        {{dragsSurface this.handleDrag @disabled}}
        data-test-pretui-curve-plot
      >
        <svg
          class='pretui-curve-svg'
          viewBox='0 0 100 100'
          preserveAspectRatio='none'
          aria-hidden='true'
          focusable='false'
        >
          <line class='pretui-curve-base' x1='0' y1='75' x2='100' y2='75' />
          <line class='pretui-curve-base' x1='0' y1='25' x2='100' y2='25' />
          <line
            class='pretui-curve-leg'
            x1='0'
            y1='75'
            x2={{this.svgP1X}}
            y2={{this.svgP1Y}}
          />
          <line
            class='pretui-curve-leg'
            x1='100'
            y1='25'
            x2={{this.svgP2X}}
            y2={{this.svgP2Y}}
          />
          <polyline class='pretui-curve-line' points={{this.points}} />
        </svg>

        <Handle
          @index={{1}}
          @x={{this.p1X}}
          @y={{this.p1Y}}
          @label='Control point 1'
          @valueText={{this.p1Text}}
          @disabled={{@disabled}}
          @onNudge={{this.nudgeP1}}
        />
        <Handle
          @index={{2}}
          @x={{this.p2X}}
          @y={{this.p2Y}}
          @label='Control point 2'
          @valueText={{this.p2Text}}
          @disabled={{@disabled}}
          @onNudge={{this.nudgeP2}}
        />

        {{#if this.showPreview}}
          <span class='pretui-curve-track' aria-hidden='true'>
            <span class='pretui-curve-dot'></span>
          </span>
        {{/if}}
      </div>

      {{#if this.showPresets}}
        <Select
          @options={{this.presetOptions}}
          @value={{this.preset}}
          @disabled={{@disabled}}
          @onValueChange={{this.choosePreset}}
        />
      {{/if}}

      {{#if this.showFields}}
        <div class='pretui-curve-fields'>
          <ScrubInput
            @label='Control point 1 x'
            @grip='x1'
            @unitPosition='prefix'
            @value={{this.curve.x1}}
            @min={{0}}
            @max={{1}}
            @step={{0.01}}
            @pixelsPerStep={{2}}
            @precision={{this.precision}}
            @disabled={{@disabled}}
            @onChange={{this.setX1}}
          />
          <ScrubInput
            @label='Control point 1 y'
            @grip='y1'
            @unitPosition='prefix'
            @value={{this.curve.y1}}
            @min={{-0.5}}
            @max={{1.5}}
            @step={{0.01}}
            @pixelsPerStep={{2}}
            @precision={{this.precision}}
            @disabled={{@disabled}}
            @onChange={{this.setY1}}
          />
          <ScrubInput
            @label='Control point 2 x'
            @grip='x2'
            @unitPosition='prefix'
            @value={{this.curve.x2}}
            @min={{0}}
            @max={{1}}
            @step={{0.01}}
            @pixelsPerStep={{2}}
            @precision={{this.precision}}
            @disabled={{@disabled}}
            @onChange={{this.setX2}}
          />
          <ScrubInput
            @label='Control point 2 y'
            @grip='y2'
            @unitPosition='prefix'
            @value={{this.curve.y2}}
            @min={{-0.5}}
            @max={{1.5}}
            @step={{0.01}}
            @pixelsPerStep={{2}}
            @precision={{this.precision}}
            @disabled={{@disabled}}
            @onChange={{this.setY2}}
          />
        </div>
      {{/if}}

      <p class='pretui-curve-css' data-test-pretui-curve-css>{{this.cssValue}}</p>
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-curve {
          display: grid;
          gap: var(--space-2, 6px);
          min-width: 0;
        }
        .pretui-curve[data-disabled='true'] {
          opacity: 0.5;
        }
        .pretui-curve-plot {
          position: relative;
          width: 100%;
          aspect-ratio: 1 / 1;
          border-radius: var(--radius);
          background: var(--field, var(--boxel-light));
          box-shadow: inset 0 0 0 1px var(--input);
          touch-action: none;
        }
        .pretui-curve-svg {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          overflow: visible;
        }
        /* The two rules at y=0 and y=1: the plot spans −0.5…1.5, so these are
           what tell a reader that the space above and below is overshoot. */
        .pretui-curve-base {
          stroke: var(--border);
          stroke-width: 1;
          vector-effect: non-scaling-stroke;
        }
        .pretui-curve-line {
          fill: none;
          stroke: var(--primary);
          stroke-width: 2;
          stroke-linecap: round;
          stroke-linejoin: round;
          vector-effect: non-scaling-stroke;
        }
        /* The legs from each anchor to its control point — drawn in the SVG,
           because a straight line between two arbitrary points is geometry,
           not something CSS custom properties can express without trig. */
        .pretui-curve-leg {
          stroke: color-mix(in oklch, var(--primary) 45%, transparent);
          stroke-width: 1;
          stroke-dasharray: 3 3;
          vector-effect: non-scaling-stroke;
        }
        /* The preview: a dot that travels the curve. Motion that ENCODES the
           value — Law 5 — never decoration. */
        .pretui-curve-track {
          position: absolute;
          left: 0;
          right: 0;
          bottom: -14px;
          height: 8px;
          border-radius: 4px;
          background: color-mix(in oklch, var(--foreground) 6%, transparent);
          overflow: visible;
        }
        .pretui-curve-dot {
          position: absolute;
          top: 50%;
          left: 0;
          width: 8px;
          height: 8px;
          translate: -50% -50%;
          border-radius: 50%;
          background: var(--primary);
          animation: pretui-curve-run var(--pretui-curve-dur, 1200ms)
            var(--pretui-curve-ease, ease) infinite alternate;
        }
        @keyframes pretui-curve-run {
          from {
            left: 0;
          }
          to {
            left: 100%;
          }
        }
        .pretui-curve-fields {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: var(--space-2, 6px);
        }
        .pretui-curve-css {
          margin: 0;
          font-family: var(--font-mono);
          font-size: var(--text-ui-xs, 11px);
          color: var(--muted-foreground);
          overflow-x: auto;
          white-space: nowrap;
        }
        /* Reduced motion: the dot rests at the END state, never a frozen
           midpoint, and the plot carries the whole message in a still frame. */
        @media (prefers-reduced-motion: reduce) {
          .pretui-curve-dot {
            animation: none;
            left: 100%;
          }
        }
        @container (max-width: 220px) {
          .pretui-curve-fields {
            grid-template-columns: minmax(0, 1fr);
          }
        }
      }
    </style>
  </template>
}
