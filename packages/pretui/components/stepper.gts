// Pretui — Stepper: a number input flanked by minus and plus buttons.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { emit, firstDefined } from '../pretui-primitives';

// Fresh — the property-panel number control neither library ships
// standalone: a centered number input flanked by −/+ buttons sharing one
// hairline. Kit contract state: @tracked internal seeded from
// defaultValue, args.value ?? internal wins. Values clamp at the bounds
// and the flanking buttons disable when the value sits on them. The text
// field commits on 'change' (blur / Enter / native spinners) so clamping
// never fights mid-keystroke.

export interface StepperSignature {
  Args: {
    value?: number;
    defaultValue?: number;
    min?: number;
    max?: number;
    step?: number;
    disabled?: boolean;
    controlId?: string;
    onValueChange?: (value: number) => void;
    /** aliases — the HTML/Mantine notify, the Aria boolean spelling */
    onChange?: (value: number) => void;
    isDisabled?: boolean;
  };
  Element: HTMLDivElement;
}

export class Stepper extends Component<StepperSignature> {
  @tracked internal = this.args.defaultValue ?? this.args.min ?? 0;

  get value() {
    return this.args.value ?? this.internal;
  }
  get step() {
    return this.args.step ?? 1;
  }
  get atMin() {
    return this.args.min !== undefined && this.value <= this.args.min;
  }
  get atMax() {
    return this.args.max !== undefined && this.value >= this.args.max;
  }
  get disabled() {
    return firstDefined(this.args.disabled, this.args.isDisabled) ?? false;
  }
  get decDisabled() {
    return this.disabled || this.atMin;
  }
  get incDisabled() {
    return this.disabled || this.atMax;
  }

  private clamp(v: number) {
    if (this.args.min !== undefined) {
      v = Math.max(this.args.min, v);
    }
    if (this.args.max !== undefined) {
      v = Math.min(this.args.max, v);
    }
    return v;
  }
  private commit(v: number) {
    let next = this.clamp(v);
    if (this.args.value === undefined) {
      this.internal = next;
    }
    emit([this.args.onValueChange, this.args.onChange], next);
  }
  decrement = (_e: Event) => {
    this.commit(this.value - this.step);
  };
  increment = (_e: Event) => {
    this.commit(this.value + this.step);
  };
  handleChange = (ev: Event) => {
    let input = ev.target as HTMLInputElement;
    let v = parseFloat(input.value);
    if (Number.isNaN(v)) {
      // restore the last good value on unparsable text
      input.value = String(this.value);
      return;
    }
    this.commit(v);
    input.value = String(this.clamp(v));
  };
  <template>
    <div
      class='pretui-stepper'
      data-disabled={{if this.disabled 'true'}}
      data-test-pretui-stepper
      ...attributes
    >
      <button
        type='button'
        class='pretui-stepper-btn'
        aria-label='Decrement'
        disabled={{this.decDisabled}}
        {{on 'click' this.decrement}}
      >
        <svg width='10' height='10' viewBox='0 0 10 10' aria-hidden='true'><path
            d='M2 5h6'
            fill='none'
            stroke='currentColor'
            stroke-width='1.5'
            stroke-linecap='round'
          /></svg>
      </button>
      <input
        id={{@controlId}}
        class='pretui-stepper-input'
        type='number'
        value={{this.value}}
        min={{@min}}
        max={{@max}}
        step={{this.step}}
        disabled={{this.disabled}}
        {{on 'change' this.handleChange}}
      />
      <button
        type='button'
        class='pretui-stepper-btn'
        aria-label='Increment'
        disabled={{this.incDisabled}}
        {{on 'click' this.increment}}
      >
        <svg width='10' height='10' viewBox='0 0 10 10' aria-hidden='true'><path
            d='M5 2v6M2 5h6'
            fill='none'
            stroke='currentColor'
            stroke-width='1.5'
            stroke-linecap='round'
          /></svg>
      </button>
    </div>
    <style scoped>
      .pretui-stepper {
        display: inline-flex;
        align-items: stretch;
        height: var(--control-h, 28px);
        border-radius: var(--radius);
        background: var(--field, var(--boxel-light));
        box-shadow: 0 0 0 1px var(--input);
        overflow: hidden;
      }
      .pretui-stepper:has(.pretui-stepper-input:focus-visible) {
        outline: 2px solid transparent;
        outline-offset: 1px;
        box-shadow: 0 0 0 2px var(--primary),
          var(--pretui-shadow-inset, inset 0 1px 2px rgb(0 0 0 / 0.16));
      }
      .pretui-stepper[data-disabled] {
        opacity: 0.45;
      }
      .pretui-stepper-btn {
        display: grid;
        place-items: center;
        width: 26px;
        border: 0;
        padding: 0;
        background: none;
        color: var(--muted-foreground);
        cursor: pointer;
        flex: none;
      }
      .pretui-stepper-btn:hover:not(:disabled) {
        background: var(--hover, var(--boxel-100));
        color: var(--foreground);
      }
      .pretui-stepper-btn:disabled {
        opacity: 0.35;
        cursor: default;
      }
      .pretui-stepper-input {
        width: var(--pretui-stepper-w, 52px);
        min-width: 0;
        border: 0;
        padding: 0 2px;
        background: transparent;
        text-align: center;
        font: inherit;
        font-size: var(--text-ui-md, 12.5px);
        letter-spacing: var(--track-ui, 0.01em);
        font-variant-numeric: tabular-nums;
        color: var(--foreground);
        appearance: textfield;
        outline: none;
      }
      .pretui-stepper-input::-webkit-outer-spin-button,
      .pretui-stepper-input::-webkit-inner-spin-button {
        appearance: none;
        margin: 0;
      }
    </style>
  </template>
}
