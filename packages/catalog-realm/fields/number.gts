import NumberField from 'https://cardstack.com/base/number';
import {
  Component,
  FieldDef,
  contains,
  field,
} from 'https://cardstack.com/base/card-api';
import { BoxelInput, BoxelInputGroup } from '@cardstack/boxel-ui/components';
import { not } from '@cardstack/boxel-ui/helpers';
import { TextInputValidator } from 'https://cardstack.com/base/text-input-validator';
import { NumberSerializer } from '@cardstack/runtime-common';
import { action } from '@ember/object';
import { fn } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import { on } from '@ember/modifier';
import { or } from '@cardstack/boxel-ui/helpers';

interface NumberConstraints {
  min?: number;
  max?: number;
  step?: number;
  allowNegative?: boolean;
  placeholder?: string;
  decimals?: number;
}

function deserializeForUI(value: string | number | null): number | null {
  const validationError = NumberSerializer.validate(value);
  if (validationError) {
    return null;
  }
  return NumberSerializer.deserializeSync(value);
}

function serializeForUI(val: number | null): string | undefined {
  let serialized = NumberSerializer.serialize(val);
  if (serialized != null) {
    return String(serialized);
  }
  return undefined;
}

function clampValue(
  value: number | null,
  cfg: NumberConstraints,
): number | null {
  if (value == null) {
    return value;
  }
  let min = cfg.min;
  if (cfg.allowNegative === false && (min == null || min < 0)) {
    min = 0;
  }
  if (typeof min === 'number' && value < min) {
    value = min;
  }
  if (typeof cfg.max === 'number' && value > cfg.max) {
    value = cfg.max;
  }
  return value;
}

function readConfig<T extends Record<string, unknown>>(
  configuration: any,
  defaults: T,
): T {
  let raw = (configuration?.presentation ?? {}) as Partial<T> | undefined;
  if (!raw) {
    return defaults;
  }
  let result: Record<string, unknown> = { ...defaults };
  for (let [key, value] of Object.entries(raw)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result as T;
}

function percentage(
  value: number | null | undefined,
  max: number | undefined,
): number {
  let numeric = typeof value === 'number' ? value : 0;
  let limit = typeof max === 'number' && max !== 0 ? max : 100;
  let pct = (numeric / limit) * 100;
  if (!Number.isFinite(pct)) {
    pct = 0;
  }
  return Math.max(0, Math.min(100, pct));
}

function formatDisplayValue(
  value: unknown,
  suffix?: string,
  fallback = '—',
): string {
  if (typeof value === 'number') {
    return `${value}${suffix ?? ''}`;
  }
  if (value == null) {
    return fallback;
  }
  return `${value}`;
}

// Basic number input -------------------------------------------------------

type BasicConfig = NumberConstraints;

class BasicNumberFieldEdit extends Component<typeof BasicNumberField> {
  get config(): BasicConfig {
    return readConfig(this.args.configuration, {
      min: undefined,
      max: undefined,
      step: undefined,
      allowNegative: true,
      placeholder: 'Enter a number',
    });
  }

  get minAttr() {
    if (
      this.config.allowNegative === false &&
      (this.config.min == null || this.config.min < 0)
    ) {
      return 0;
    }
    return this.config.min;
  }

  textInputValidator: TextInputValidator<number> = new TextInputValidator(
    () => this.args.model,
    (inputVal) => this.args.set(clampValue(inputVal ?? null, this.config)),
    deserializeForUI,
    serializeForUI,
    NumberSerializer.validate,
  );

  <template>
    <BoxelInput
      @type='number'
      @value={{this.textInputValidator.asString}}
      @onInput={{this.textInputValidator.onInput}}
      @errorMessage={{this.textInputValidator.errorMessage}}
      @state={{if this.textInputValidator.isInvalid 'invalid' 'none'}}
      @disabled={{not @canEdit}}
      @placeholder={{this.config.placeholder}}
      min={{this.minAttr}}
      max={{this.config.max}}
      step={{this.config.step}}
    />
  </template>
}

class BasicNumberField extends NumberField {
  static displayName = 'Basic Number';
  static edit = BasicNumberFieldEdit;
}

// Percentage ---------------------------------------------------------------

type PercentageConfig = NumberConstraints & {
  suffix: string;
};

class PercentageNumberFieldEdit extends Component<
  typeof PercentageNumberField
> {
  get config(): PercentageConfig {
    return readConfig(this.args.configuration, {
      min: 0,
      max: 100,
      step: 1,
      allowNegative: false,
      placeholder: '0',
      suffix: '%',
    });
  }

  textInputValidator: TextInputValidator<number> = new TextInputValidator(
    () => this.args.model,
    (inputVal) => this.args.set(clampValue(inputVal ?? null, this.config)),
    deserializeForUI,
    serializeForUI,
    NumberSerializer.validate,
  );

  get minAttr() {
    if (
      this.config.allowNegative === false &&
      (this.config.min == null || this.config.min < 0)
    ) {
      return 0;
    }
    return this.config.min;
  }

  <template>
    <BoxelInputGroup
      @placeholder={{this.config.placeholder}}
      @value={{this.textInputValidator.asString}}
      @onInput={{this.textInputValidator.onInput}}
      @invalid={{this.textInputValidator.isInvalid}}
      @autocomplete='off'
      @inputmode='decimal'
      @type='number'
      @min={{this.minAttr}}
      @max={{this.config.max}}
      @step={{this.config.step}}
      class='percentage-input'
    >
      <:after as |Accessories|>
        <Accessories.Text>{{this.config.suffix}}</Accessories.Text>
      </:after>
    </BoxelInputGroup>
    <style scoped>
      .percentage-input {
        width: 100%;
      }
    </style>
  </template>
}

class PercentageNumberField extends NumberField {
  static displayName = 'Percentage Number';
  static edit = PercentageNumberFieldEdit;
  static atom = class PercentageNumberEmbedded extends Component<
    typeof PercentageNumberField
  > {
    get config(): PercentageConfig {
      return readConfig(this.args.configuration, {
        min: 0,
        max: 100,
        step: 1,
        allowNegative: false,
        placeholder: '0',
        suffix: '%',
      });
    }
    get displayValue() {
      let val = typeof this.args.model === 'number' ? this.args.model : null;
      return formatDisplayValue(val, this.config.suffix);
    }
    <template>
      <span class='percentage-embedded'>{{this.displayValue}}</span>
      <style scoped>
        .percentage-embedded {
          font-weight: 500;
        }
      </style>
    </template>
  };
  static embedded = PercentageNumberField.atom;
}

// Slider -------------------------------------------------------------------

type SliderConfig = NumberConstraints & {
  showValue: boolean;
};

class SliderNumberFieldEdit extends Component<typeof SliderNumberField> {
  textInputValidator: TextInputValidator<number> = new TextInputValidator(
    () => this.args.model,
    (inputVal) => this.args.set(inputVal ?? null),
    deserializeForUI,
    serializeForUI,
    NumberSerializer.validate,
  );

  get config(): SliderConfig {
    return readConfig(this.args.configuration, {
      min: 0,
      max: 100,
      step: 1,
      allowNegative: false,
      placeholder: undefined,
      showValue: true,
    });
  }

  get value(): number {
    let val =
      typeof this.args.model === 'number'
        ? this.args.model
        : this.config.min ?? 0;
    return (clampValue(val, this.config) ?? 0) as number;
  }

  get valueAsString() {
    return String(this.value);
  }

  get minLabel() {
    return this.config.allowNegative === false &&
      (this.config.min == null || this.config.min < 0)
      ? 0
      : this.config.min ?? 0;
  }

  handleInput = (next: string) => {
    let parsed = deserializeForUI(next);
    let clamped = clampValue(parsed, this.config);
    this.args.set(clamped);
  };

  <template>
    <div class='slider'>
      {{#if this.config.showValue}}
        <div class='slider__value'>{{this.value}}</div>
      {{/if}}
      <BoxelInput
        @type='range'
        @value={{this.valueAsString}}
        @onInput={{this.handleInput}}
        min={{this.minLabel}}
        max={{this.config.max}}
        step={{this.config.step}}
        class='slider__input'
      />
      <div class='slider__labels'>
        <span>{{this.minLabel}}</span>
        <span>{{this.config.max}}</span>
      </div>
    </div>
    <style scoped>
      @layer boxelComponentL1 {
        .slider {
          width: 100%;
        }
        .slider__value {
          color: var(--primary, var(--boxel-blue));
          font-weight: 600;
          margin-bottom: var(--boxel-sp-xxs);
        }
        .slider__input input[type='range'] {
          width: 100%;
          appearance: none;
          height: 0.5rem;
          background: var(--track, var(--boxel-200));
          border-radius: 9999px;
        }
        .slider__labels {
          display: flex;
          justify-content: space-between;
          color: var(--muted-foreground, var(--boxel-450));
          font-size: var(--boxel-font-size-sm);
          margin-top: var(--boxel-sp-xxs);
        }
      }
    </style>
  </template>
}

class SliderNumberField extends NumberField {
  static displayName = 'Slider Number';
  static edit = SliderNumberFieldEdit;
}

// Stepper ------------------------------------------------------------------

type StepperConfig = NumberConstraints;

class StepperNumberFieldEdit extends Component<typeof StepperNumberField> {
  get config(): StepperConfig {
    return readConfig(this.args.configuration, {
      min: 0,
      max: undefined,
      step: 1,
      allowNegative: false,
      placeholder: '0',
    });
  }

  get value(): number {
    let val =
      typeof this.args.model === 'number'
        ? this.args.model
        : this.config.min ?? 0;
    return (clampValue(val, this.config) ?? 0) as number;
  }

  get decrementDisabled() {
    if (this.config.min == null) {
      return false;
    }
    return this.value <= this.config.min;
  }

  textInputValidator: TextInputValidator<number> = new TextInputValidator(
    () => this.args.model,
    (inputVal) => this.args.set(clampValue(inputVal ?? null, this.config)),
    deserializeForUI,
    serializeForUI,
    NumberSerializer.validate,
  );

  setValue(next: number) {
    this.args.set(clampValue(next, this.config));
  }

  @action decrement() {
    this.setValue(this.value - (this.config.step ?? 1));
  }

  @action increment() {
    this.setValue(this.value + (this.config.step ?? 1));
  }

  <template>
    <div class='stepper'>
      <button
        type='button'
        class='stepper__btn stepper__btn--dec'
        {{on 'click' this.decrement}}
        disabled={{this.decrementDisabled}}
      >-</button>
      <BoxelInput
        @placeholder={{this.config.placeholder}}
        @type='number'
        @value={{this.textInputValidator.asString}}
        @onInput={{this.textInputValidator.onInput}}
        @errorMessage={{this.textInputValidator.errorMessage}}
        @state={{if this.textInputValidator.isInvalid 'invalid' 'none'}}
        class='stepper__input'
      />
      <button
        type='button'
        class='stepper__btn stepper__btn--inc'
        {{on 'click' this.increment}}
      >+</button>
    </div>
    <style scoped>
      @layer boxelComponentL1 {
        .stepper {
          display: inline-flex;
          align-items: center;
          border: var(--boxel-border);
          border-radius: var(--boxel-border-radius);
        }
        .stepper__btn {
          background: var(--background, var(--boxel-light));
          color: var(--foreground, var(--boxel-650));
          padding: 0 var(--boxel-sp-sm);
          font-weight: 600;
          border: none;
          cursor: pointer;
        }
        .stepper__btn[disabled] {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .stepper__btn--dec {
          border-right: var(--boxel-border);
        }
        .stepper__btn--inc {
          border-left: var(--boxel-border);
        }
        .stepper__input {
          width: 4.5rem;
          text-align: center;
        }
      }
    </style>
  </template>
}

class StepperNumberField extends NumberField {
  static displayName = 'Stepper Number';
  static edit = StepperNumberFieldEdit;
}

// Rating -------------------------------------------------------------------

type RatingConfig = {
  maxStars: number;
};

class RatingNumberFieldEdit extends Component<typeof RatingNumberField> {
  get config(): RatingConfig {
    return readConfig(this.args.configuration, {
      maxStars: 5,
    });
  }

  textInputValidator: TextInputValidator<number> = new TextInputValidator(
    () => this.args.model,
    (inputVal) =>
      this.args.set(
        clampValue(inputVal ?? null, {
          min: 0,
          max: this.config.maxStars,
          allowNegative: false,
        }),
      ),
    deserializeForUI,
    serializeForUI,
    NumberSerializer.validate,
  );

  get currentRating() {
    return typeof this.args.model === 'number' ? this.args.model : 0;
  }

  get stars() {
    return Array.from({ length: this.config.maxStars }, (_, idx) => ({
      value: idx + 1,
      filled: idx + 1 <= this.currentRating,
    }));
  }

  @action
  chooseStar(star: number) {
    this.args.set(
      clampValue(star, {
        min: 0,
        max: this.config.maxStars,
        allowNegative: false,
      }),
    );
  }

  <template>
    <div class='rating'>
      {{#each this.stars as |star|}}
        <button
          type='button'
          class='rating__btn {{if star.filled "rating__btn--filled"}}'
          aria-label='rate {{star.value}}'
          {{on 'click' (fn this.chooseStar star.value)}}
        >
          <span class='rating__star'>★</span>
        </button>
      {{/each}}
      <span class='rating__label'>{{this.currentRating}}
        /
        {{this.config.maxStars}}</span>
    </div>
    <style scoped>
      @layer boxelComponentL1 {
        .rating {
          display: inline-flex;
          align-items: center;
          gap: var(--boxel-sp-xxs);
        }
        .rating__btn {
          background: none;
          border: none;
          cursor: pointer;
          padding: 0;
          transition: transform 0.1s ease;
        }
        .rating__btn:hover {
          transform: scale(1.1);
        }
        .rating__star {
          font-size: 1.5rem;
          color: var(--boxel-300);
          transition: color 0.2s ease;
        }
        .rating__btn--filled .rating__star {
          color: #fbbf24;
        }
        .rating__label {
          margin-left: var(--boxel-sp-xs);
          color: var(--boxel-450);
          font-size: var(--boxel-font-size-sm);
        }
      }
    </style>
  </template>
}

class RatingNumberField extends NumberField {
  static displayName = 'Rating Number';
  static edit = RatingNumberFieldEdit;
  static atom = class RatingNumberAtom extends Component<
    typeof RatingNumberField
  > {
    get config(): RatingConfig {
      return readConfig(this.args.configuration, {
        maxStars: 5,
      });
    }
    get currentRating() {
      return typeof this.args.model === 'number' ? this.args.model : 0;
    }
    get stars() {
      return Array.from({ length: this.config.maxStars }, (_, idx) => ({
        value: idx + 1,
        filled: idx + 1 <= this.currentRating,
      }));
    }
    <template>
      <div class='rating rating--atom'>
        {{#each this.stars as |star|}}
          <span
            class='rating__star {{if star.filled "rating__star--filled"}}'
          >★</span>
        {{/each}}
      </div>
      <style scoped>
        @layer boxelComponentL1 {
          .rating--atom {
            display: inline-flex;
            align-items: center;
            gap: var(--boxel-sp-xxs);
          }
          .rating__star {
            font-size: 1.25rem;
            color: var(--boxel-300);
          }
          .rating__star--filled {
            color: #fbbf24;
          }
        }
      </style>
    </template>
  };
  static embedded = RatingNumberField.atom;
}

// Quantity -----------------------------------------------------------------

type QuantityConfig = NumberConstraints & {
  stock?: number;
};

class QuantityNumberFieldEdit extends Component<typeof QuantityNumberField> {
  textInputValidator: TextInputValidator<number> = new TextInputValidator(
    () => this.args.model,
    (inputVal) => this.args.set(clampValue(inputVal ?? null, this.config)),
    deserializeForUI,
    serializeForUI,
    NumberSerializer.validate,
  );

  get config(): QuantityConfig {
    return readConfig(this.args.configuration, {
      min: 1,
      max: undefined,
      step: 1,
      allowNegative: false,
      stock: undefined,
      placeholder: undefined,
    });
  }

  get value(): number {
    let val =
      typeof this.args.model === 'number'
        ? this.args.model
        : this.config.min ?? 0;
    return (clampValue(val, this.config) ?? 0) as number;
  }

  get decrementDisabled() {
    if (this.config.min == null) {
      return false;
    }
    return this.value <= this.config.min;
  }

  setValue(next: number) {
    this.args.set(clampValue(next, this.config));
  }

  @action decrement() {
    this.setValue(this.value - (this.config.step ?? 1));
  }

  @action increment() {
    this.setValue(this.value + (this.config.step ?? 1));
  }

  <template>
    <div class='quantity'>
      <button
        type='button'
        class='quantity__btn'
        {{on 'click' this.decrement}}
        disabled={{this.decrementDisabled}}
      >-</button>
      <span class='quantity__value'>{{this.value}}</span>
      <button
        type='button'
        class='quantity__btn'
        {{on 'click' this.increment}}
      >+</button>
    </div>
    {{#if this.config.stock}}
      <div class='quantity__stock'>{{this.config.stock}} in stock</div>
    {{/if}}
    <style scoped>
      @layer boxelComponentL1 {
        .quantity {
          display: inline-flex;
          align-items: center;
          gap: var(--boxel-sp-sm);
        }
        .quantity__btn {
          width: 2.5rem;
          height: 2.5rem;
          border-radius: 9999px;
          border: 2px solid var(--boxel-300);
          background: transparent;
          color: var(--boxel-650);
          font-weight: 600;
          cursor: pointer;
        }
        .quantity__btn[disabled] {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .quantity__value {
          width: 3rem;
          text-align: center;
          font-weight: 600;
          font-size: var(--boxel-font-size-lg);
        }
        .quantity__stock {
          color: var(--boxel-450);
          font-size: var(--boxel-font-size-sm);
          margin-top: var(--boxel-sp-xxs);
        }
      }
    </style>
  </template>
}

class QuantityNumberField extends NumberField {
  static displayName = 'Quantity Number';
  static edit = QuantityNumberFieldEdit;
}

// PIN / OTP Input ----------------------------------------------------------
// Simple PIN input: type digit → go to next, backspace → go to previous

type PinConfig = {
  length: number;
  label?: string;
  description?: string;
};

class PinNumberFieldEdit extends Component<typeof PinNumberField> {
  textInputValidator: TextInputValidator<number> = new TextInputValidator(
    () => this.args.model,
    (inputVal) => this.args.set(inputVal ?? null),
    deserializeForUI,
    serializeForUI,
    NumberSerializer.validate,
  );

  get config(): PinConfig {
    return readConfig(this.args.configuration, {
      length: 4,
      label: undefined,
      description: undefined,
    });
  }

  get inputSlots() {
    return Array.from({ length: this.config.length }, (_, idx) => idx);
  }

  get pinDigits(): string[] {
    let model = this.args.model;
    if (typeof model !== 'number') {
      return Array(this.config.length).fill('');
    }
    let str = String(model).padStart(this.config.length, '0');
    return str.slice(0, this.config.length).split('');
  }

  pinInputId(index: number) {
    return `pin-input-${index}`;
  }

  getDigitAt = (index: number): string => {
    return this.pinDigits[index] || '';
  };

  focusInput(index: number) {
    if (index < 0 || index >= this.config.length) return;
    let input = document.getElementById(
      this.pinInputId(index),
    ) as HTMLInputElement | null;
    input?.focus();
  }

  collectPinValue() {
    let digits: string[] = [];
    for (let i = 0; i < this.config.length; i++) {
      let input = document.getElementById(
        this.pinInputId(i),
      ) as HTMLInputElement | null;
      if (input?.value) {
        digits.push(input.value);
      } else {
        // Empty slot, consider as incomplete
        digits.push('');
      }
    }

    // Check if all slots are filled (no empty strings)
    let allFilled = digits.every((d) => d !== '');

    if (allFilled && digits.length === this.config.length) {
      // All digits entered, save as number
      let pinNumber = parseInt(digits.join(''), 10);
      this.args.set(pinNumber);
    } else if (digits.every((d) => d === '')) {
      // All slots are empty, clear the value
      this.args.set(null);
    }
    // If partially filled, don't save anything (keep previous value)
  }

  handleInput = (index: number, event: Event) => {
    let input = event.target as HTMLInputElement;
    let value = input.value;

    // Only allow digits
    if (value && !/^\d$/.test(value)) {
      input.value = '';
      return;
    }

    // Collect and save PIN value
    this.collectPinValue();

    // If user typed a digit, move to next input
    if (value && index < this.config.length - 1) {
      this.focusInput(index + 1);
    }
  };

  handleKeyDown = (index: number, event: KeyboardEvent) => {
    // Backspace: clear current input and move to previous
    if (event.key === 'Backspace') {
      let input = event.target as HTMLInputElement;
      event.preventDefault();
      input.value = '';

      // Collect and save PIN value after clearing
      this.collectPinValue();

      if (index > 0) {
        this.focusInput(index - 1);
      }
    }
  };

  <template>
    <div class='pin-container'>
      {{#if this.config.label}}
        <label class='pin-container__label'>{{this.config.label}}</label>
      {{/if}}

      <div class='pin-group' role='group' aria-label='PIN code input'>
        {{#each this.inputSlots as |idx|}}
          <input
            id={{this.pinInputId idx}}
            data-pin-index={{idx}}
            type='text'
            inputmode='numeric'
            maxlength='1'
            class='pin-slot'
            autocomplete='one-time-code'
            aria-label='Digit {{idx}}'
            value={{this.getDigitAt idx}}
            {{on 'input' (fn this.handleInput idx)}}
            {{on 'keydown' (fn this.handleKeyDown idx)}}
          />
        {{/each}}
      </div>

      {{#if this.config.description}}
        <p class='pin-container__description'>{{this.config.description}}</p>
      {{/if}}
    </div>

    <style scoped>
      @layer boxelComponentL1 {
        .pin-container {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-xs);
        }

        .pin-container__label {
          font-size: var(--boxel-font-size-sm);
          font-weight: 500;
          color: var(--foreground, var(--boxel-dark));
        }

        .pin-group {
          display: inline-flex;
          gap: var(--boxel-sp-xxs);
          align-items: center;
        }

        .pin-slot {
          width: 3rem;
          height: 3rem;
          text-align: center;
          font-weight: 600;
          font-size: var(--boxel-font-size-lg);
          border: 1px solid var(--input, var(--boxel-border-color));
          border-radius: var(--radius, var(--boxel-border-radius));
          background: var(--background, var(--boxel-light));
          color: var(--foreground, var(--boxel-dark));
          transition: all 0.15s ease;
        }

        .pin-slot:focus {
          outline: none;
          border-color: var(--ring, var(--boxel-highlight));
          box-shadow: 0 0 0 2px var(--ring, var(--boxel-highlight));
          transform: scale(1.02);
        }

        .pin-slot:disabled {
          cursor: not-allowed;
          opacity: 0.5;
        }

        .pin-container__description {
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
          margin: 0;
        }
      }
    </style>
  </template>
}

class PinNumberField extends NumberField {
  static displayName = 'PIN Number';
  static edit = PinNumberFieldEdit;

  static atom = class PinNumberAtom extends Component<typeof PinNumberField> {
    get config(): PinConfig {
      return readConfig(this.args.configuration, {
        length: 4,
        label: undefined,
        description: undefined,
      });
    }

    get displayValue(): string {
      let model = this.args.model;
      if (typeof model !== 'number') {
        return '';
      }
      return String(model).padStart(this.config.length, '0');
    }

    <template>
      <span class='pin-atom'>
        {{#if this.config.label}}
          {{this.config.label}}:
        {{/if}}
        {{this.displayValue}}
      </span>
      <style scoped>
        .pin-atom {
          font-weight: 600;
          color: var(--boxel-650);
        }
      </style>
    </template>
  };

  static embedded = PinNumberField.atom;
}

// Stat display -------------------------------------------------------------

type StatConfig = {
  label: string;
  prefix?: string;
  suffix?: string;
  delta?: number;
  deltaDirection?: 'up' | 'down';
};

class StatNumberAtom extends Component<typeof StatNumberField> {
  get config(): StatConfig {
    return readConfig(this.args.configuration, {
      label: 'Metric',
      prefix: '',
      suffix: '',
      delta: undefined,
      deltaDirection: 'up',
    });
  }

  get hasDelta() {
    return typeof this.config.delta === 'number';
  }

  get deltaIcon() {
    return this.config.deltaDirection === 'down' ? '↓' : '↑';
  }

  get isDeltaDown() {
    return this.config.deltaDirection === 'down';
  }

  <template>
    <div class='stat'>
      <div class='stat__header'>
        <span class='stat__label'>{{this.config.label}}</span>
      </div>
      <div class='stat__value'>{{if
          this.config.prefix
          this.config.prefix
        }}{{@model}}{{if this.config.suffix this.config.suffix}}</div>
      {{#if this.hasDelta}}
        <div class='stat__delta'>
          <span
            class='stat__delta-icon
              {{if
                this.isDeltaDown
                "stat__delta-icon--down"
                "stat__delta-icon--up"
              }}'
          >{{this.deltaIcon}} {{this.config.delta}}</span>
          <span class='stat__delta-copy'>vs last period</span>
        </div>
      {{/if}}
    </div>
    <style scoped>
      @layer boxelComponentL1 {
        .stat {
          background: linear-gradient(
            135deg,
            var(--boxel-100),
            var(--boxel-200)
          );
          border: var(--boxel-border-card);
          padding: var(--boxel-sp);
          border-radius: var(--boxel-border-radius-lg);
        }
        .stat__label {
          color: var(--boxel-700);
          font-weight: 600;
        }
        .stat__value {
          font-size: var(--boxel-font-size-xl);
          font-weight: 700;
          color: var(--boxel-700);
          margin-top: var(--boxel-sp-xxs);
        }
        .stat__delta {
          margin-top: var(--boxel-sp-xxs);
          font-size: var(--boxel-font-size-sm);
          color: var(--boxel-600);
          display: flex;
          gap: var(--boxel-sp-xxs);
          align-items: baseline;
        }
        .stat__delta-icon--up {
          color: var(--success, var(--boxel-success-100));
        }
        .stat__delta-icon--down {
          color: var(--destructive, var(--boxel-error-100));
        }
      }
    </style>
  </template>
}

class StatNumberField extends NumberField {
  static displayName = 'Stat Number Display';
  static atom = StatNumberAtom;
  static embedded = StatNumberAtom;
}

// Progress bar -------------------------------------------------------------

type ProgressConfig = {
  max: number;
  label?: string;
  helperText?: string;
  valueFormat?: 'percent' | 'raw' | 'none';
  valueSuffix?: string;
};

class ProgressBarAtom extends Component<typeof ProgressBarNumberField> {
  get config(): ProgressConfig {
    return readConfig(this.args.configuration, {
      max: 100,
      label: undefined,
      helperText: undefined,
      valueFormat: 'percent',
      valueSuffix: undefined,
    });
  }

  get pct() {
    return percentage(this.args.model, this.config.max);
  }

  get pctRounded() {
    return Math.round(this.pct);
  }

  get displayValue() {
    let format = this.config.valueFormat ?? 'percent';
    if (format === 'none') {
      return undefined;
    }
    if (format === 'raw') {
      return formatDisplayValue(this.args.model, this.config.valueSuffix);
    }
    return `${this.pctRounded}%`;
  }

  get fillStyle() {
    return htmlSafe(`width: ${this.pct}%`);
  }

  <template>
    <div class='progress'>
      {{#if (or this.config.label this.displayValue)}}
        <div class='progress__header'>
          {{#if this.config.label}}
            <div class='progress__label'>{{this.config.label}}</div>
          {{/if}}
          {{#if this.displayValue}}
            <div class='progress__value'>{{this.displayValue}}</div>
          {{/if}}
        </div>
      {{/if}}
      <div class='progress__track'>
        <div class='progress__fill' style={{this.fillStyle}}></div>
      </div>
      {{#if this.config.helperText}}
        <div class='progress__helper'>{{this.config.helperText}}</div>
      {{/if}}
    </div>
    <style scoped>
      @layer boxelComponentL1 {
        .progress {
          width: 100%;
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-xxs);
        }
        .progress__header {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          font-size: var(--boxel-font-size-sm);
          color: var(--boxel-600);
        }
        .progress__label {
          font-weight: 600;
          color: var(--boxel-650);
        }
        .progress__value {
          font-weight: 600;
          color: var(--primary, var(--boxel-blue));
        }
        .progress__track {
          background: var(--track, var(--boxel-200));
          border-radius: 9999px;
          height: 0.75rem;
          overflow: hidden;
        }
        .progress__fill {
          background: var(--primary, var(--boxel-blue));
          height: 100%;
          border-radius: 9999px;
          transition: width var(--boxel-transition);
        }
        .progress__helper {
          font-size: var(--boxel-font-size-sm);
          color: var(--boxel-450);
        }
      }
    </style>
  </template>
}

class ProgressBarNumberField extends NumberField {
  static displayName = 'Progress Bar Number';
  static atom = ProgressBarAtom;
  static embedded = ProgressBarAtom;
}

// Progress circle ----------------------------------------------------------

type ProgressCircleConfig = {
  max: number;
  size: number;
  label?: string;
  helperText?: string;
  valueFormat?: 'percent' | 'raw';
  valueSuffix?: string;
  strokeWidth?: number;
};

class ProgressCircleAtom extends Component<typeof ProgressCircleNumberField> {
  get config(): ProgressCircleConfig {
    return readConfig(this.args.configuration, {
      max: 100,
      size: 96,
      label: undefined,
      helperText: undefined,
      valueFormat: 'percent',
      valueSuffix: undefined,
      strokeWidth: 8,
    });
  }

  get pct() {
    return percentage(this.args.model, this.config.max);
  }

  get strokeWidth() {
    let configured = this.config.strokeWidth;
    if (typeof configured === 'number' && configured > 0) {
      return configured;
    }
    return 8;
  }

  get center() {
    return this.config.size / 2;
  }

  get radius() {
    let radius = this.center - this.strokeWidth;
    return radius > 0
      ? radius
      : Math.max(0, this.center - this.strokeWidth / 2);
  }

  get circumference() {
    return 2 * Math.PI * this.radius;
  }

  get offset() {
    return this.circumference * (1 - this.pct / 100);
  }

  get pctRounded() {
    return Math.round(this.pct);
  }

  get valueDisplay() {
    let format = this.config.valueFormat ?? 'percent';
    if (format === 'raw') {
      return formatDisplayValue(this.args.model, this.config.valueSuffix);
    }
    return `${this.pctRounded}%`;
  }

  get circleDimensionsStyle() {
    return htmlSafe(
      `width:${this.config.size}px; height:${this.config.size}px;`,
    );
  }

  get viewBoxValue() {
    let size = this.config.size;
    return `0 0 ${size} ${size}`;
  }

  <template>
    <div class='progress-circle'>
      <div
        class='progress-circle__graphic'
        style={{this.circleDimensionsStyle}}
      >
        <svg class='progress-circle__ring' viewBox={{this.viewBoxValue}}>
          <circle
            cx={{this.center}}
            cy={{this.center}}
            r={{this.radius}}
            stroke-width={{this.strokeWidth}}
            fill='transparent'
            class='progress-circle__track'
          />
          <circle
            cx={{this.center}}
            cy={{this.center}}
            r={{this.radius}}
            stroke-width={{this.strokeWidth}}
            fill='transparent'
            class='progress-circle__fill'
            stroke-dasharray={{this.circumference}}
            stroke-dashoffset={{this.offset}}
            stroke-linecap='round'
          />
        </svg>
        <div class='progress-circle__center'>{{this.valueDisplay}}</div>
      </div>
      {{#if this.config.label}}
        <div class='progress-circle__label'>{{this.config.label}}</div>
      {{/if}}
      {{#if this.config.helperText}}
        <div class='progress-circle__helper'>{{this.config.helperText}}</div>
      {{/if}}
    </div>
    <style scoped>
      @layer boxelComponentL1 {
        .progress-circle {
          display: inline-flex;
          flex-direction: column;
          align-items: center;
          gap: var(--boxel-sp-xxs);
        }
        .progress-circle__graphic {
          position: relative;
          display: inline-block;
        }
        .progress-circle__ring {
          transform: rotate(-90deg);
        }
        .progress-circle__track {
          stroke: var(--track, var(--boxel-200));
        }
        .progress-circle__fill {
          stroke: var(--primary, var(--boxel-success-100));
          transition: stroke-dashoffset var(--boxel-transition);
        }
        .progress-circle__center {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 700;
          color: var(--boxel-700);
        }
        .progress-circle__label {
          font-weight: 600;
          color: var(--boxel-650);
        }
        .progress-circle__helper {
          font-size: var(--boxel-font-size-sm);
          color: var(--boxel-450);
          text-align: center;
        }
      }
    </style>
  </template>
}

class ProgressCircleNumberField extends NumberField {
  static displayName = 'Progress Circle Number';
  static atom = ProgressCircleAtom;
  static embedded = ProgressCircleAtom;
}

// Gauge --------------------------------------------------------------------

type GaugeConfig = {
  max: number;
  label?: string;
  helperText?: string;
  valueFormat?: 'percent' | 'raw';
  valueSuffix?: string;
  strokeWidth?: number;
};

const GAUGE_ARC_LENGTH = 251.327;

class GaugeNumberAtom extends Component<typeof GaugeNumberField> {
  get config(): GaugeConfig {
    return readConfig(this.args.configuration, {
      max: 100,
      label: undefined,
      helperText: undefined,
      valueFormat: 'raw',
      valueSuffix: undefined,
      strokeWidth: 20,
    });
  }

  get pct() {
    return percentage(this.args.model, this.config.max);
  }

  get pctRounded() {
    return Math.round(this.pct);
  }

  get offset() {
    return GAUGE_ARC_LENGTH * (1 - this.pct / 100);
  }

  get arcLength() {
    return GAUGE_ARC_LENGTH;
  }

  get strokeWidth() {
    let configured = this.config.strokeWidth;
    if (typeof configured === 'number' && configured > 0) {
      return configured;
    }
    return 20;
  }

  get valueDisplay() {
    let format = this.config.valueFormat ?? 'raw';
    if (format === 'percent') {
      return `${this.pctRounded}%`;
    }
    return formatDisplayValue(this.args.model, this.config.valueSuffix);
  }

  get customPropertyStyle() {
    let width = this.strokeWidth;
    if (width === 20) {
      return undefined;
    }
    return htmlSafe(`--stroke-width:${width}`);
  }

  <template>
    <div class='gauge' style={{this.customPropertyStyle}}>
      <svg viewBox='0 0 200 100' class='gauge__svg'>
        <path
          d='M 20 100 A 80 80 0 0 1 180 100'
          fill='none'
          class='gauge__track'
          stroke-width={{this.strokeWidth}}
        />
        <path
          d='M 20 100 A 80 80 0 0 1 180 100'
          fill='none'
          class='gauge__fill'
          stroke-dasharray={{this.arcLength}}
          stroke-dashoffset={{this.offset}}
          stroke-width={{this.strokeWidth}}
        />
      </svg>
      <div class='gauge__center'>
        <div class='gauge__value'>{{this.valueDisplay}}</div>
        {{#if this.config.label}}
          <div class='gauge__label'>{{this.config.label}}</div>
        {{/if}}
        {{#if this.config.helperText}}
          <div class='gauge__helper'>{{this.config.helperText}}</div>
        {{/if}}
      </div>
    </div>
    <style scoped>
      @layer boxelComponentL1 {
        .gauge {
          position: relative;
          width: 200px;
          height: 120px;
        }
        .gauge__svg {
          width: 100%;
          height: 100%;
        }
        .gauge__track {
          stroke: var(--track, var(--boxel-200));
          stroke-width: var(--stroke-width, 20);
        }
        .gauge__fill {
          stroke: var(--primary, var(--boxel-blue));
          stroke-width: var(--stroke-width, 20);
          stroke-linecap: round;
          transition: stroke-dashoffset var(--boxel-transition);
        }
        .gauge__center {
          position: absolute;
          bottom: -5%;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: flex-end;
          gap: var(--boxel-sp-xxxs);
          transform: scale(0.8);
          max-width: 100%;
          padding: 1.2rem;
          padding-bottom: 0;
        }
        .gauge__value {
          font-size: var(--boxel-font-size-xl);
          font-weight: 700;
          color: var(--boxel-700);
          max-width: 100%;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .gauge__label {
          font-weight: 600;
          color: var(--boxel-650);
          max-width: 100%;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .gauge__helper {
          font-size: var(--boxel-font-size-sm);
          color: var(--boxel-450);
          max-width: 100%;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      }
    </style>
  </template>
}

class GaugeNumberField extends NumberField {
  static displayName = 'Gauge Number';
  static atom = GaugeNumberAtom;
  static embedded = GaugeNumberAtom;
}

// Badge --------------------------------------------------------------------

type BadgeConfig = {
  label?: string;
};

class BadgeNumberAtom extends Component<typeof BadgeNumberField> {
  get config(): BadgeConfig {
    return readConfig(this.args.configuration, {
      label: '',
    });
  }

  <template>
    <div class='badge'>
      {{#if this.config.label}}
        <span class='badge__label'>{{this.config.label}}</span>
      {{/if}}
      <span class='badge__count'>{{@model}}</span>
    </div>
    <style scoped>
      @layer boxelComponentL1 {
        .badge {
          display: inline-flex;
          align-items: center;
          gap: var(--boxel-sp-xxs);
          background: var(--badge-bg, #111);
          color: var(--badge-fg, #fff);
          padding: var(--boxel-sp-xxs) var(--boxel-sp-xs);
          border-radius: var(--boxel-border-radius-sm);
        }
        .badge__label {
          font-size: var(--boxel-font-size-xs);
          letter-spacing: var(--boxel-lsp-xs);
        }
        .badge__count {
          font-weight: 700;
          font-size: var(--boxel-font-size-lg);
        }
      }
    </style>
  </template>
}

class BadgeNumberField extends NumberField {
  static displayName = 'Badge Number';
  static atom = BadgeNumberAtom;
  static embedded = BadgeNumberAtom;
}

// Animated counter ---------------------------------------------------------

type AnimatedCounterConfig = {
  label: string;
  prefix?: string;
  suffix?: string;
};

class AnimatedCounterAtom extends Component<typeof AnimatedCounterNumberField> {
  get config(): AnimatedCounterConfig {
    return readConfig(this.args.configuration, {
      label: 'Counter',
      prefix: '',
      suffix: '',
    });
  }

  <template>
    <div class='animated-counter'>
      <div class='animated-counter__title'>{{this.config.label}}</div>
      <div class='animated-counter__value'>{{if
          this.config.prefix
          this.config.prefix
        }}{{@model}}{{if this.config.suffix this.config.suffix}}</div>
    </div>
    <style scoped>
      @layer boxelComponentL1 {
        .animated-counter {
          text-align: center;
          padding: var(--boxel-sp);
          background: var(--bg-color, var(--boxel-100));
          border: var(--boxel-border-card);
          border-radius: var(--boxel-border-radius-lg);
        }
        .animated-counter__title {
          color: var(--boxel-700);
          margin-bottom: var(--boxel-sp-xxs);
          font-weight: 600;
        }
        .animated-counter__value {
          font-size: var(--boxel-font-size-xxl);
          font-weight: 700;
          color: var(--boxel-700);
        }
      }
    </style>
  </template>
}

class AnimatedCounterNumberField extends NumberField {
  static displayName = 'Animated Counter Number';
  static atom = AnimatedCounterAtom;
  static embedded = AnimatedCounterAtom;
}

// Score --------------------------------------------------------------------

type ScoreConfig = {
  label: string;
};

class ScoreNumberAtom extends Component<typeof ScoreNumberField> {
  get config(): ScoreConfig {
    return readConfig(this.args.configuration, {
      label: 'Score',
    });
  }

  <template>
    <div class='score'>
      <div class='score__top'>
        <div class='score__label'>{{this.config.label}}</div>
        <div class='score__value'>{{@model}}</div>
      </div>
      <div class='score__bars'>
        <div class='score__bar score__bar--red'></div>
        <div class='score__bar score__bar--orange'></div>
        <div class='score__bar score__bar--yellow'></div>
        <div class='score__bar score__bar--green'></div>
      </div>
    </div>
    <style scoped>
      @layer boxelComponentL1 {
        .score {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-xs);
        }
        .score__label {
          color: var(--boxel-700);
          font-weight: 600;
        }
        .score__value {
          color: var(--success, var(--boxel-700));
          font-size: var(--boxel-font-size-xl);
          font-weight: 700;
        }
        .score__bars {
          display: flex;
          gap: 2px;
          height: 0.5rem;
        }
        .score__bar {
          flex: 1 1 0;
          border-radius: 4px;
        }
        .score__bar--red {
          background: #ef4444;
        }
        .score__bar--orange {
          background: #f97316;
        }
        .score__bar--yellow {
          background: #eab308;
        }
        .score__bar--green {
          background: #22c55e;
        }
      }
    </style>
  </template>
}

class ScoreNumberField extends NumberField {
  static displayName = 'Score Number';
  static atom = ScoreNumberAtom;
  static embedded = ScoreNumberAtom;
}

// Dual range ---------------------------------------------------------------

type RangeConfig = {
  min: number;
  max: number;
  step: number;
};

class NumberRangeEdit extends Component<typeof NumberRange> {
  get config(): RangeConfig {
    return readConfig(this.args.configuration, {
      min: 0,
      max: 100,
      step: 1,
    });
  }

  get rawMin() {
    return typeof this.args.model.min === 'number'
      ? this.args.model.min
      : this.config.min;
  }

  get rawMax() {
    return typeof this.args.model.max === 'number'
      ? this.args.model.max
      : this.config.max;
  }

  get minValue() {
    let min = this.rawMin;
    let max = this.rawMax;
    if (min > max - this.config.step) {
      min = max - this.config.step;
    }
    if (min < this.config.min) {
      min = this.config.min;
    }
    return min;
  }

  get maxValue() {
    let min = this.rawMin;
    let max = this.rawMax;
    if (max < min + this.config.step) {
      max = min + this.config.step;
    }
    if (max > this.config.max) {
      max = this.config.max;
    }
    return max;
  }

  setMin = (next: string) => {
    let parsed = deserializeForUI(next);
    if (parsed == null) {
      parsed = this.config.min;
    }
    if (parsed > this.rawMax - this.config.step) {
      parsed = this.rawMax - this.config.step;
    }
    if (parsed < this.config.min) {
      parsed = this.config.min;
    }
    this.args.model.min = parsed;
  };

  setMax = (next: string) => {
    let parsed = deserializeForUI(next);
    if (parsed == null) {
      parsed = this.config.max;
    }
    if (parsed < this.rawMin + this.config.step) {
      parsed = this.rawMin + this.config.step;
    }
    if (parsed > this.config.max) {
      parsed = this.config.max;
    }
    this.args.model.max = parsed;
  };

  <template>
    <div class='range'>
      <BoxelInput
        @type='range'
        @value={{this.minValue}}
        @onInput={{this.setMin}}
        min={{this.config.min}}
        max={{this.config.max}}
        step={{this.config.step}}
        class='range__slider'
      />
      <BoxelInput
        @type='range'
        @value={{this.maxValue}}
        @onInput={{this.setMax}}
        min={{this.config.min}}
        max={{this.config.max}}
        step={{this.config.step}}
        class='range__slider'
      />
    </div>
    <div class='range__label'>{{this.minValue}} – {{this.maxValue}}</div>
    <style scoped>
      @layer boxelComponentL1 {
        .range {
          display: grid;
          gap: var(--boxel-sp-xxs);
        }
        .range__slider input[type='range'] {
          width: 100%;
          appearance: none;
          height: 0.5rem;
          background: var(--track, var(--boxel-200));
          border-radius: 9999px;
        }
        .range__label {
          color: var(--boxel-blue);
          font-weight: 600;
          margin-top: var(--boxel-sp-xxs);
        }
      }
    </style>
  </template>
}

class NumberRange extends FieldDef {
  static displayName = 'Number Range';
  @field min = contains(NumberField);
  @field max = contains(NumberField);
  static edit = NumberRangeEdit;
  static atom = class Atom extends Component<typeof NumberRange> {
    <template>
      <span>{{@model.min}} – {{@model.max}}</span>
    </template>
  };
  static embedded = NumberRange.atom;
}

export {
  AnimatedCounterNumberField,
  BadgeNumberField,
  BasicNumberField,
  GaugeNumberField,
  NumberRange,
  PercentageNumberField,
  PinNumberField,
  ProgressBarNumberField,
  ProgressCircleNumberField,
  QuantityNumberField,
  RatingNumberField,
  ScoreNumberField,
  SliderNumberField,
  StatNumberField,
  StepperNumberField,
};
