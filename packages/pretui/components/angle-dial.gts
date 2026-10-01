// Pretui — AngleDial: a rotary control for an angle, in degrees, radians or turns.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { htmlSafe } from '@ember/template';
import { ScrubInput } from './scrub-input';
import { clampRange, dragsSurface, keyboardNudge, pointerDegrees, roundTo, shortestAngleDelta, wrapDegrees } from '../internal/design-tools';
import type { DragModifiers, SurfaceFrame } from '../internal/design-tools';
import { rovingTabindex } from '../focus';

// ═══════════════════════════════════════════════════════════════════════
// Angle units — display only. The model is always degrees.
// ═══════════════════════════════════════════════════════════════════════

export type AngleUnit = 'deg' | 'rad' | 'turn';

/** Degrees → the display unit. */
export function fromDegrees(degrees: number, unit: AngleUnit): number {
  if (unit === 'rad') {
    return (degrees * Math.PI) / 180;
  }
  if (unit === 'turn') {
    return degrees / 360;
  }
  return degrees;
}

/** The display unit → degrees. */
export function toDegrees(value: number, unit: AngleUnit): number {
  if (unit === 'rad') {
    return (value * 180) / Math.PI;
  }
  if (unit === 'turn') {
    return value * 360;
  }
  return value;
}

/** The symbol shown in a field for each unit. `°` reads better than `deg`
 * in a 60px-wide inspector column, which is the whole reason it exists. */
export function angleSymbol(unit: AngleUnit): string {
  return unit === 'rad' ? 'rad' : unit === 'turn' ? 'turn' : '°';
}

/** Whole rotations contained in an angle — the `×2` badge. */
export function rotationCount(degrees: number): number {
  return Math.floor(Math.abs(degrees) / 360);
}

// ═══════════════════════════════════════════════════════════════════════
// AngleDial
// ═══════════════════════════════════════════════════════════════════════

export interface AngleDialSignature {
  Args: {
    /** angle in DEGREES — unbounded unless `@min`/`@max` are given, so a
     * value of 765 is two-and-a-bit turns and stays that way */
    value?: number;
    defaultValue?: number;
    min?: number;
    max?: number;
    /** degrees per arrow press (default 1) */
    step?: number;
    /** degrees the dial snaps to while Shift is held during a drag
     * (default 15; set 0 to disable) */
    snap?: number;
    /** DISPLAY unit only — the value in and out is always degrees */
    unit?: AngleUnit;
    /** decimal places in the paired field (default 1) */
    precision?: number;
    /** render the circular dial (default true) */
    showDial?: boolean;
    /** render the paired numeric field (default true).
     * Named `showInput` rather than `input` because the realm's
     * `no-passed-in-event-handlers` rule reserves DOM-event names for
     * handlers — and `@input` reading as a boolean was confusing anyway. */
    showInput?: boolean;
    /** show the ×N rotation badge, and fold it into `aria-valuetext` */
    rotations?: boolean;
    label?: string;
    disabled?: boolean;
    onInput?: (degrees: number) => void;
    onChange?: (degrees: number) => void;
  };
  Element: HTMLDivElement;
}

export class AngleDial extends Component<AngleDialSignature> {
  @tracked private internal = this.args.defaultValue ?? 0;
  /** the raw pointer angle at the previous frame, so the accumulated value
   * can wind past 360 instead of snapping back through zero */
  private lastPointerAngle: number | null = null;

  get degrees(): number {
    return this.args.value ?? this.internal;
  }
  get unit(): AngleUnit {
    return this.args.unit ?? 'deg';
  }
  get precision(): number {
    return this.args.precision ?? 1;
  }
  get step(): number {
    return this.args.step ?? 1;
  }
  get snap(): number {
    return this.args.snap ?? 15;
  }
  get dialVisible(): boolean {
    return this.args.showDial ?? true;
  }
  get inputVisible(): boolean {
    return this.args.showInput ?? true;
  }
  /** the dial is the composite's single tab stop unless it is disabled */
  get dialFocusable(): boolean {
    return !this.args.disabled;
  }
  get unitSymbol(): string {
    return angleSymbol(this.unit);
  }
  get displayValue(): number {
    return roundTo(fromDegrees(this.degrees, this.unit), this.precision);
  }
  get rotations(): number {
    return rotationCount(this.degrees);
  }
  get rotationBadge(): string {
    return this.rotations > 0 ? '×' + this.rotations : '';
  }
  get valueText(): string {
    let base = this.displayValue + angleSymbol(this.unit);
    if (this.args.rotations && this.rotations > 0) {
      return base + ', ' + this.rotations + ' full turns';
    }
    return base;
  }
  get dialLabel(): string {
    return this.args.label ?? 'Angle';
  }
  /** aria bounds fall back to a single turn when the angle is unbounded —
   * a slider with no declared range announces nothing useful. */
  get ariaMin(): number {
    return this.args.min ?? 0;
  }
  get ariaMax(): number {
    return this.args.max ?? 360;
  }
  get handStyle() {
    // wrapDegrees keeps the CSS rotation inside one turn (the hand looks
    // identical either way) and guarantees a finite, clamped number.
    let angle = wrapDegrees(Number.isFinite(this.degrees) ? this.degrees : 0);
    return htmlSafe('--pretui-dial-angle: ' + roundTo(angle, 3) + 'deg');
  }

  private commit(next: number, done: boolean) {
    let bounded = clampRange(next, this.args.min, this.args.max);
    let value = roundTo(bounded, 4);
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
    if (part.phase === 'end') {
      this.lastPointerAngle = null;
      this.args.onChange?.(this.degrees);
      return;
    }
    // Centre of the dial in the surface's own normalized space.
    let raw = pointerDegrees(0.5, 0.5, part.rawX, part.rawY);
    if (part.shift && this.snap > 0) {
      raw = wrapDegrees(Math.round(raw / this.snap) * this.snap);
    }
    if (part.phase === 'start') {
      // Jump to the pressed angle within the current turn, preserving the
      // whole rotations already accumulated.
      this.lastPointerAngle = raw;
      this.commit(this.degrees + shortestAngleDelta(this.degrees, raw), false);
      return;
    }
    let previous = this.lastPointerAngle ?? raw;
    this.lastPointerAngle = raw;
    this.commit(this.degrees + shortestAngleDelta(previous, raw), false);
  };

  handleKeyDown = (event: Event) => {
    if (this.args.disabled) {
      return;
    }
    let key = event as KeyboardEvent;
    let keys: DragModifiers = {
      shift: key.shiftKey,
      alt: key.altKey,
      meta: key.metaKey,
    };
    let intent = keyboardNudge(key.key, keys, this.step);
    if (!intent.handled) {
      return;
    }
    event.preventDefault();
    if (intent.toMin) {
      this.commit(this.args.min ?? 0, true);
      return;
    }
    if (intent.toMax) {
      this.commit(this.args.max ?? 360, true);
      return;
    }
    // On a dial, Right and Up both wind clockwise: `delta` is the
    // value-space half of the shared intent, which already says so.
    this.commit(this.degrees + intent.delta, true);
  };

  handleField = (value: number | null) => {
    if (value === null) {
      return;
    }
    this.commit(toDegrees(value, this.unit), false);
  };
  handleFieldCommit = (value: number | null) => {
    if (value === null) {
      return;
    }
    this.commit(toDegrees(value, this.unit), true);
  };

  <template>
    <div
      class='pretui-angle'
      data-disabled={{if @disabled 'true'}}
      data-test-pretui-angle-dial
      ...attributes
    >
      {{#if this.dialVisible}}
        <div
          class='pretui-angle-dial'
          role='slider'
          aria-label={{this.dialLabel}}
          aria-valuemin={{this.ariaMin}}
          aria-valuemax={{this.ariaMax}}
          aria-valuenow={{this.degrees}}
          aria-valuetext={{this.valueText}}
          aria-disabled={{if @disabled 'true'}}
          style={{this.handStyle}}
          {{rovingTabindex this.dialFocusable}}
          {{dragsSurface this.handleDrag @disabled}}
          {{on 'keydown' this.handleKeyDown}}
          data-test-pretui-angle-plane
        >
          <span class='pretui-angle-hand'></span>
        </div>
      {{/if}}

      {{#if this.inputVisible}}
        <div class='pretui-angle-field'>
          <ScrubInput
            @label={{this.dialLabel}}
            @value={{this.displayValue}}
            @min={{@min}}
            @max={{@max}}
            @step={{this.step}}
            @precision={{this.precision}}
            @unit={{this.unitSymbol}}
            @disabled={{@disabled}}
            @onInput={{this.handleField}}
            @onChange={{this.handleFieldCommit}}
          />
          {{#if this.rotationBadge}}
            <span class='pretui-angle-turns' data-test-pretui-angle-turns>
              {{this.rotationBadge}}
            </span>
          {{/if}}
        </div>
      {{/if}}
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-angle {
          display: flex;
          align-items: center;
          gap: var(--space-3, 8px);
          min-width: 0;
        }
        .pretui-angle[data-disabled='true'] {
          opacity: 0.5;
        }
        .pretui-angle-dial {
          position: relative;
          flex: none;
          width: var(--pretui-dial-size, 28px);
          height: var(--pretui-dial-size, 28px);
          border-radius: 50%;
          background: var(--field, var(--boxel-light));
          box-shadow: 0 0 0 1px var(--input);
          cursor: grab;
          touch-action: none;
        }
        .pretui-angle-dial[data-dragging] {
          cursor: grabbing;
        }
        .pretui-angle-dial:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 2px;
        }
        /* The hand: one element rotated by a single custom property, so the
           only thing a season or a value changes is that property. */
        .pretui-angle-hand {
          position: absolute;
          inset: 0;
          border-radius: inherit;
          rotate: var(--pretui-dial-angle, 0deg);
        }
        .pretui-angle-hand::after {
          content: '';
          position: absolute;
          top: 50%;
          left: 50%;
          width: calc(50% - 3px);
          height: 2px;
          translate: 0 -50%;
          transform-origin: 0 50%;
          border-radius: 1px;
          background: var(--primary);
        }
        .pretui-angle-hand::before {
          content: '';
          position: absolute;
          top: 50%;
          left: 50%;
          width: 3px;
          height: 3px;
          translate: -50% -50%;
          border-radius: 50%;
          background: var(--muted-foreground);
        }
        .pretui-angle-field {
          display: flex;
          align-items: center;
          gap: 4px;
          min-width: 0;
          flex: 1 1 auto;
        }
        .pretui-angle-turns {
          flex: none;
          font-family: var(--font-mono);
          font-size: var(--text-ui-xs, 11px);
          color: var(--muted-foreground);
          font-variant-numeric: tabular-nums;
        }
        @media (pointer: coarse) {
          .pretui-angle-dial {
            width: max(var(--pretui-dial-size, 28px), 44px);
            height: max(var(--pretui-dial-size, 28px), 44px);
          }
        }
      }
    </style>
  </template>
}
