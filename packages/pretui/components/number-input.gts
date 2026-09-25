// Pretui — NumberInput: a number field that clamps and rounds on commit.
import Component from '@glimmer/component';
import { BoxelInput } from '@cardstack/boxel-ui/components';
import { emit, firstDefined } from '../pretui-primitives';
import type { ControlNotifyArgs } from '../pretui-primitives';
import { TYPED_FONT } from '../internal/extras';

// BoxelInput @type='number' with the numeric knobs surfaced: @min/@max/
// @step ride the native control (spinners + keyboard), and values clamp to
// the bounds and round to @precision decimals on commit (change event —
// blur / Enter / spinners) so clamping never fights mid-keystroke.
// @onInput speaks number | null (null = empty/unparsable), Stepper-style.

export interface NumberInputSignature {
  Args: ControlNotifyArgs<number | null> & {
    value?: number | null;
    placeholder?: string;
    min?: number;
    max?: number;
    step?: number;
    /** decimal places applied on commit (0 = integers) */
    precision?: number;
    disabled?: boolean;
    required?: boolean;
    controlId?: string;
    onInput?: (value: number | null) => void;
    /**
     * Force the committed value back inside `@min`/`@max` (default true —
     * the behaviour this component has always had). Set false to let an
     * out-of-range value stand and be REPORTED instead: a silent clamp tells
     * the reader nothing about why their number changed, which is the whole
     * of the complaint against clamp-only number fields.
     */
    clamp?: boolean;
    /** force the invalid dress regardless of range */
    invalid?: boolean;
    /** aliases — React Aria / Base UI boolean spellings */
    isDisabled?: boolean;
    isRequired?: boolean;
    isInvalid?: boolean;
    /** message under the control; wins over the derived range message */
    errorMessage?: string;
    /** wording for the derived out-of-range message — receives (min, max),
     * either of which may be undefined */
    rangeMessage?: (min?: number, max?: number) => string;
  };
  Element: HTMLDivElement;
}

const defaultRangeMessage = (min?: number, max?: number) => {
  if (min !== undefined && max !== undefined) {
    return `Enter a number between ${min} and ${max}.`;
  }
  if (min !== undefined) {
    return `Enter ${min} or more.`;
  }
  if (max !== undefined) {
    return `Enter ${max} or less.`;
  }
  return 'Out of range.';
};

export class NumberInput extends Component<NumberInputSignature> {
  get boxelValue() {
    return this.args.value ?? null;
  }
  get disabled() {
    return firstDefined(this.args.disabled, this.args.isDisabled);
  }
  get required() {
    return firstDefined(this.args.required, this.args.isRequired);
  }
  get invalid() {
    return firstDefined(this.args.invalid, this.args.isInvalid) ?? false;
  }
  private notify(v: number | null) {
    emit(
      [this.args.onInput, this.args.onChange, this.args.onValueChange],
      v,
    );
  }
  get clamps() {
    return this.args.clamp ?? true;
  }
  /** A named tri-state, not a boolean: 'none' (nothing to say) is different
   * from 'valid' (checked and fine), and only 'invalid' dresses the field. */
  get rangeState(): 'valid' | 'invalid' | 'none' {
    let v = this.args.value;
    if (v === null || v === undefined || Number.isNaN(v)) return 'none';
    if (this.args.min === undefined && this.args.max === undefined) {
      return 'none';
    }
    let low = this.args.min !== undefined && v < this.args.min;
    let high = this.args.max !== undefined && v > this.args.max;
    return low || high ? 'invalid' : 'valid';
  }
  get state() {
    return this.invalid || this.rangeState === 'invalid' ? 'invalid' : 'none';
  }
  get errorMessage() {
    if (this.args.errorMessage) return this.args.errorMessage;
    if (this.rangeState !== 'invalid') return undefined;
    let format = this.args.rangeMessage ?? defaultRangeMessage;
    return format(this.args.min, this.args.max);
  }
  private roundOnly(v: number) {
    if (this.args.precision === undefined) return v;
    let m = Math.pow(10, this.args.precision);
    return Math.round(v * m) / m;
  }
  private clampRound(v: number) {
    if (this.args.min !== undefined) {
      v = Math.max(this.args.min, v);
    }
    if (this.args.max !== undefined) {
      v = Math.min(this.args.max, v);
    }
    if (this.args.precision !== undefined) {
      let m = Math.pow(10, this.args.precision);
      v = Math.round(v * m) / m;
    }
    return v;
  }
  handleInput = (val: string) => {
    let v = val === '' ? NaN : Number(val);
    this.notify(Number.isNaN(v) ? null : v);
  };
  handleChange = (ev: Event) => {
    let input = ev.target as HTMLInputElement;
    let v = input.value === '' ? NaN : Number(input.value);
    if (Number.isNaN(v)) {
      return; // empty stays empty; the browser blocks unparsable text
    }
    // Rounding still applies when clamping is off — precision is a display
    // contract, the bounds are a validity one.
    let next = this.clamps ? this.clampRound(v) : this.roundOnly(v);
    let display =
      this.args.precision !== undefined
        ? next.toFixed(this.args.precision)
        : String(next);
    if (input.value !== display) {
      input.value = display;
    }
    this.notify(next);
  };
  <template>
    <div
      class='pretui-boxelwrap'
      data-range-state={{this.rangeState}}
      data-test-pretui-number-input
      ...attributes
    >
      <BoxelInput
        @type='number'
        @value={{this.boxelValue}}
        @placeholder={{@placeholder}}
        @min={{@min}}
        @max={{@max}}
        @step={{@step}}
        @disabled={{this.disabled}}
        @required={{this.required}}
        @state={{this.state}}
        @errorMessage={{this.errorMessage}}
        @onInput={{this.handleInput}}
        @onChange={{this.handleChange}}
        id={{@controlId}}
        style={{TYPED_FONT}}
      />
    </div>
    <style scoped>
      /* Same re-skin channel as EmailInput — see that component's note. */
      .pretui-boxelwrap {
        width: 100%;
        font-size: var(--text-ui-md, 12.5px);
        letter-spacing: var(--track-ui, 0.01em);
        font-variant-numeric: tabular-nums;
        --background: var(--field, var(--boxel-light));
        --border: var(--input);
        --ring: var(--primary);
        --muted-foreground: var(--ink-3, var(--boxel-400));
        --boxel-form-control-height: var(--control-h, 28px);
        --boxel-input-height: var(--control-h, 28px);
        --boxel-form-control-border-radius: var(--radius);
        --boxel-sp-xs: 5px;
        --boxel-sp-sm: 9px;
      }
    </style>
  </template>
}
