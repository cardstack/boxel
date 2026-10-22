// Pretui — ValueInput: one editor for any typed value, picking the right control for its kind.
import Component from '@glimmer/component';
import { Checkbox } from './checkbox';
import { Input } from './input';
import { Select } from './select';
import type { SelectOption } from './select';
import { ScrubInput } from './scrub-input';
import type { PropertyRowSignature } from './property-row';
import { AngleDial } from './angle-dial';
import { Joystick } from './joystick';
import { OriginGrid } from './origin-grid';
import type { Point2 } from './joystick';
import { EasingCurve } from './easing-curve';
import type { CubicBezier } from './easing-curve';

/** The value vocabulary this territory can edit. Extend through the
 * `<:custom>` block rather than by widening this union in a fork. */
export type ValueKind =
  | 'number'
  | 'text'
  | 'toggle'
  | 'select'
  | 'angle'
  | 'point'
  | 'origin'
  | 'curve'
  | 'custom';

export type ValueOf =
  | number
  | string
  | boolean
  | Point2
  | CubicBezier
  | null
  | undefined;

/** One row of a property sheet: what to edit, how, and in what state. */
export interface ValueSpec {
  /** stable key — the sheet uses it to address the value */
  key: string;
  kind: ValueKind;
  label?: string;
  hint?: string;
  /** numeric kinds */
  min?: number;
  max?: number;
  step?: number;
  precision?: number;
  unit?: string;
  /** select kind */
  options?: SelectOption[];
  /** text kind */
  placeholder?: string;
  /** multi-selection with differing values */
  mixed?: boolean;
  /** differs from default — reveals the row's reset control */
  modified?: boolean;
  disabled?: boolean;
  /** row layout override; the sheet's own default otherwise */
  layout?: PropertyRowSignature['Args']['layout'];
}

const ORIGIN_DEFAULT: Point2 = { x: 50, y: 50 };
const CURVE_DEFAULT: CubicBezier = { x1: 0.42, y1: 0, x2: 0.58, y2: 1 };

function isPoint(value: ValueOf): value is Point2 {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Point2).x === 'number' &&
    typeof (value as Point2).y === 'number'
  );
}

function isCurve(value: ValueOf): value is CubicBezier {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as CubicBezier).x1 === 'number' &&
    typeof (value as CubicBezier).y2 === 'number'
  );
}

export interface ValueInputSignature {
  Args: {
    /** which control to render */
    kind: ValueKind;
    /** the value, in whatever shape the kind implies */
    value?: ValueOf;
    /** knobs for the chosen kind; unrelated fields are simply unread */
    spec?: Partial<ValueSpec>;
    /** id to put on the control, so a PropertyRow label points at it */
    controlId?: string;
    describedBy?: string;
    disabled?: boolean;
    onChange?: (value: ValueOf) => void;
  };
  Blocks: {
    /** kinds this component does not own — colour above all. Receives the
     * kind, the raw value and whether the control is disabled. */
    custom: [ValueKind, ValueOf, boolean];
  };
  Element: HTMLDivElement;
}

export class ValueInput extends Component<ValueInputSignature> {
  get spec(): Partial<ValueSpec> {
    return this.args.spec ?? {};
  }
  get label(): string {
    return this.spec.label ?? 'Value';
  }
  get disabled(): boolean {
    return this.args.disabled ?? this.spec.disabled ?? false;
  }
  get options(): SelectOption[] {
    return this.spec.options ?? [];
  }

  // ── narrowing, done here so no template ever narrows ────────────────
  get asNumber(): number | null {
    return typeof this.args.value === 'number' ? this.args.value : null;
  }
  /** AngleDial's model is a plain number (an angle is never "empty"), so
   * an absent value reads as 0 rather than null. */
  get asAngle(): number {
    return typeof this.args.value === 'number' ? this.args.value : 0;
  }
  get asText(): string {
    return typeof this.args.value === 'string' ? this.args.value : '';
  }
  get asBoolean(): boolean {
    return this.args.value === true;
  }
  get asPoint(): Point2 {
    return isPoint(this.args.value) ? this.args.value : ORIGIN_DEFAULT;
  }
  get asCurve(): CubicBezier {
    return isCurve(this.args.value) ? this.args.value : CURVE_DEFAULT;
  }

  // ── adapters, one per kind ──────────────────────────────────────────
  emitNumber = (value: number | null) => {
    this.args.onChange?.(value);
  };
  emitText = (value: string) => {
    this.args.onChange?.(value);
  };
  emitBoolean = (value: boolean) => {
    this.args.onChange?.(value);
  };
  emitSelect = (value: string) => {
    this.args.onChange?.(value);
  };
  emitAngle = (value: number) => {
    this.args.onChange?.(value);
  };
  emitPoint = (value: Point2) => {
    this.args.onChange?.(value);
  };
  emitCurve = (value: CubicBezier) => {
    this.args.onChange?.(value);
  };
  <template>
    <div class='pretui-value' data-kind={{@kind}} data-test-pretui-value-input ...attributes>
      {{#if (eq @kind 'number')}}
        <ScrubInput
          @controlId={{@controlId}}
          @describedBy={{@describedBy}}
          @label={{this.label}}
          @value={{this.asNumber}}
          @min={{this.spec.min}}
          @max={{this.spec.max}}
          @step={{this.spec.step}}
          @precision={{this.spec.precision}}
          @unit={{this.spec.unit}}
          @mixed={{this.spec.mixed}}
          @disabled={{this.disabled}}
          @steppers={{true}}
          @onChange={{this.emitNumber}}
        />
      {{else if (eq @kind 'text')}}
        <Input
          @value={{this.asText}}
          @placeholder={{this.spec.placeholder}}
          @disabled={{this.disabled}}
          @controlId={{@controlId}}
          @onInput={{this.emitText}}
        />
      {{else if (eq @kind 'toggle')}}
        <Checkbox
          @checked={{this.asBoolean}}
          @label={{this.label}}
          @disabled={{this.disabled}}
          @onCheckedChange={{this.emitBoolean}}
        />
      {{else if (eq @kind 'select')}}
        <Select
          @options={{this.options}}
          @value={{this.asText}}
          @placeholder={{this.spec.placeholder}}
          @disabled={{this.disabled}}
          @controlId={{@controlId}}
          @onValueChange={{this.emitSelect}}
        />
      {{else if (eq @kind 'angle')}}
        <AngleDial
          @label={{this.label}}
          @value={{this.asAngle}}
          @min={{this.spec.min}}
          @max={{this.spec.max}}
          @step={{this.spec.step}}
          @precision={{this.spec.precision}}
          @rotations={{true}}
          @disabled={{this.disabled}}
          @onChange={{this.emitAngle}}
        />
      {{else if (eq @kind 'point')}}
        <Joystick
          @label={{this.label}}
          @value={{this.asPoint}}
          @step={{this.spec.step}}
          @precision={{this.spec.precision}}
          @disabled={{this.disabled}}
          @onChange={{this.emitPoint}}
        />
      {{else if (eq @kind 'origin')}}
        <OriginGrid
          @label={{this.label}}
          @value={{this.asPoint}}
          @precision={{this.spec.precision}}
          @disabled={{this.disabled}}
          @onChange={{this.emitPoint}}
        />
      {{else if (eq @kind 'curve')}}
        <EasingCurve
          @label={{this.label}}
          @value={{this.asCurve}}
          @precision={{this.spec.precision}}
          @disabled={{this.disabled}}
          @onChange={{this.emitCurve}}
        />
      {{else}}
        {{yield @kind @value this.disabled to='custom'}}
      {{/if}}
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-value {
          display: block;
          min-width: 0;
          width: 100%;
        }
      }
    </style>
  </template>
}

/** Strict-mode templates have no built-in equality helper, and the kit does
 * not ship one; a five-line local keeps `ValueInput` a single component
 * rather than nine wrapper classes. */
function eq(a: unknown, b: unknown): boolean {
  return a === b;
}
