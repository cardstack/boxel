import NumberField from 'https://cardstack.com/base/number';
import StringField from 'https://cardstack.com/base/string';
import {
  Component,
  FieldDef,
  contains,
  field,
} from 'https://cardstack.com/base/card-api';
import {
  BoxelInput,
  BoxelInputGroup,
  ProgressBar,
  ProgressRadial,
} from '@cardstack/boxel-ui/components';
import { not } from '@cardstack/boxel-ui/helpers';
import { TextInputValidator } from 'https://cardstack.com/base/text-input-validator';
import { NumberSerializer } from '@cardstack/runtime-common';
import { action } from '@ember/object';
import { fn } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import { on } from '@ember/modifier';

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

interface ConfigWithPresentation<T> {
  presentation?: Partial<T>;
}

function readConfig<T extends Record<string, unknown>>(
  configuration: ConfigWithPresentation<T> | undefined,
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
      max: undefined,
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
        max: undefined,
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
          align-items: stretch;
          border: var(--boxel-border);
          border-radius: var(--boxel-border-radius);
          width: min-content;
          overflow: hidden;
        }
        .stepper__btn {
          background: var(--background, var(--boxel-light));
          color: var(--foreground, var(--boxel-650));
          padding: 0 var(--boxel-sp-sm);
          font-weight: 600;
          cursor: pointer;
          border: none;
          outline: none;
          height: auto;
        }
        .stepper__btn[disabled] {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .stepper__input {
          border-radius: 0;
          text-align: center;
          border: none;
          outline: none;
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

  getDigitAt = (index: number): string => {
    return this.pinDigits[index] || '';
  };

  getAriaLabel = (index: number): string => {
    return `Digit ${index + 1} of ${this.config.length}`;
  };

  focusInput(index: number) {
    if (index < 0 || index >= this.config.length) return;
    let input = document.querySelector(
      `.pin-slot[data-pin-index="${index}"]`,
    ) as HTMLInputElement | null;
    input?.focus();
  }

  /**
   * Collects the current PIN value from DOM inputs and updates the model.
   * Note: This reads from DOM rather than using pinDigits getter because
   * we need to capture the current input state during user interaction,
   * before it's committed to the model.
   */
  collectPinValue() {
    let digits: string[] = [];
    for (let i = 0; i < this.config.length; i++) {
      let input = document.querySelector(
        `.pin-slot[data-pin-index="${i}"]`,
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
        <div class='pin-container__label'>{{this.config.label}}</div>
      {{/if}}

      <div class='pin-group' role='group' aria-label='PIN code input'>
        {{#each this.inputSlots as |idx|}}
          <input
            data-pin-index={{idx}}
            type='text'
            inputmode='numeric'
            maxlength='1'
            class='pin-slot'
            autocomplete='one-time-code'
            aria-label={{this.getAriaLabel idx}}
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
          border-color: var(--ring, var(--boxel-blue));
          box-shadow: 0 0 0 2px var(--ring, var(--boxel-blue));
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
};

class ProgressBarAtom extends Component<typeof ProgressBarNumberField> {
  get config(): ProgressConfig {
    return readConfig(this.args.configuration, {
      max: 100,
      label: undefined,
      helperText: undefined,
    });
  }

  get numericValue(): number {
    return typeof this.args.model === 'number' ? this.args.model : 0;
  }

  <template>
    <div class='progress-wrapper'>
      {{#if this.config.label}}
        <div class='progress__label'>{{this.config.label}}</div>
      {{/if}}
      <ProgressBar @max={{this.config.max}} @value={{this.numericValue}} />
      {{#if this.config.helperText}}
        <div class='progress__helper'>{{this.config.helperText}}</div>
      {{/if}}
    </div>
    <style scoped>
      @layer boxelComponentL1 {
        .progress-wrapper {
          width: 100%;
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-xxs);
        }
        .progress__label {
          font-weight: 600;
          color: var(--boxel-650);
          font-size: var(--boxel-font-size-sm);
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
};

class ProgressCircleAtom extends Component<typeof ProgressCircleNumberField> {
  get config(): ProgressCircleConfig {
    return readConfig(this.args.configuration, {
      max: 100,
      size: 96,
      label: undefined,
      helperText: undefined,
    });
  }

  get numericValue(): number {
    return typeof this.args.model === 'number' ? this.args.model : 0;
  }

  get sizeStyle() {
    return htmlSafe(`--boxel-progress-radial-size: ${this.config.size}px;`);
  }

  <template>
    <div class='progress-circle' style={{this.sizeStyle}}>
      <ProgressRadial @max={{this.config.max}} @value={{this.numericValue}} />
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
          font-size: var(--boxel-font-size);
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

// Dual Range Slider --------------------------------------------------------

type DualRangeSliderConfig = NumberConstraints & {
  currency?: string;
  showInputs?: boolean;
};

function formatRangeValue(
  value: number | null,
  config: DualRangeSliderConfig,
): string {
  if (value == null) {
    return '—';
  }
  let decimals = config.decimals ?? 0;
  let formatter = new Intl.NumberFormat(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  let formatted = formatter.format(value);
  let currency = config.currency ?? '';
  return `${currency}${formatted}`;
}

class DualRangeSliderFieldEdit extends Component<typeof DualRangeSliderField> {
  minInputValidator: TextInputValidator<number> = new TextInputValidator(
    () => {
      let raw = this.args.model.min;
      return typeof raw === 'number' ? raw : this.rawMinValue ?? null;
    },
    (inputVal) => this.setLowerBound(inputVal),
    deserializeForUI,
    serializeForUI,
    NumberSerializer.validate,
  );

  maxInputValidator: TextInputValidator<number> = new TextInputValidator(
    () => {
      let raw = this.args.model.max;
      return typeof raw === 'number' ? raw : this.rawMaxValue ?? null;
    },
    (inputVal) => this.setUpperBound(inputVal),
    deserializeForUI,
    serializeForUI,
    NumberSerializer.validate,
  );

  get config(): DualRangeSliderConfig {
    return readConfig(this.args.configuration, {
      min: 0,
      max: 1000,
      step: 10,
      allowNegative: false,
      decimals: 0,
      currency: '$',
      showInputs: true,
    });
  }

  get sliderMin(): number {
    let configuredMin = this.config.min;
    if (
      this.config.allowNegative === false &&
      (configuredMin == null || configuredMin < 0)
    ) {
      return 0;
    }
    return typeof configuredMin === 'number' ? configuredMin : 0;
  }

  get sliderMax(): number {
    let configuredMax = this.config.max;
    if (typeof configuredMax === 'number') {
      return configuredMax;
    }
    let fallback = this.sliderMin + 100;
    let currentMin = this.rawMinValue;
    let currentMax = this.rawMaxValue;
    if (typeof currentMin === 'number') {
      fallback = Math.max(fallback, currentMin);
    }
    if (typeof currentMax === 'number') {
      fallback = Math.max(fallback, currentMax);
    }
    return fallback;
  }

  get sliderSpan(): number {
    let span = this.sliderMax - this.sliderMin;
    return span <= 0 ? 1 : span;
  }

  get rawMinValue(): number | null {
    let raw = this.args.model.min;
    if (typeof raw === 'number') {
      return clampValue(raw, this.config) ?? null;
    }
    return null;
  }

  get rawMaxValue(): number | null {
    let raw = this.args.model.max;
    if (typeof raw === 'number') {
      return clampValue(raw, this.config) ?? null;
    }
    return null;
  }

  get minValue(): number {
    let value = this.rawMinValue;
    if (typeof value === 'number') {
      return Math.min(value, this.sliderMax);
    }
    return this.sliderMin;
  }

  get maxValue(): number {
    let value = this.rawMaxValue;
    if (typeof value === 'number') {
      return Math.max(value, this.minValue);
    }
    return Math.max(this.sliderMin, this.sliderMax);
  }

  get minValueString(): string {
    return serializeForUI(this.minValue) ?? '';
  }

  get maxValueString(): string {
    return serializeForUI(this.maxValue) ?? '';
  }

  get minDisplayValue(): string {
    return this.rawMinValue != null
      ? formatRangeValue(this.rawMinValue, this.config)
      : 'Any';
  }

  get maxDisplayValue(): string {
    return this.rawMaxValue != null
      ? formatRangeValue(this.rawMaxValue, this.config)
      : 'Any';
  }

  get minBoundLabel(): string {
    return formatRangeValue(this.sliderMin, this.config);
  }

  get maxBoundLabel(): string {
    return formatRangeValue(this.sliderMax, this.config);
  }

  get sliderRangeStyle() {
    let start = ((this.minValue - this.sliderMin) / this.sliderSpan) * 100;
    let end = ((this.maxValue - this.sliderMin) / this.sliderSpan) * 100;
    let clampedStart = Math.max(0, Math.min(100, start));
    let clampedEnd = Math.max(0, Math.min(100, end));
    if (clampedEnd < clampedStart) {
      [clampedStart, clampedEnd] = [clampedEnd, clampedStart];
    }
    return htmlSafe(
      `--range-start:${clampedStart}%; --range-end:${clampedEnd}%;`,
    );
  }

  setLowerBound(inputVal: number | null | undefined) {
    if (inputVal == null) {
      this.args.model.min = undefined;
      return;
    }
    let clamped = clampValue(inputVal, this.config);
    if (clamped == null) {
      this.args.model.min = undefined;
      return;
    }
    let currentMax = this.maxValue;
    if (clamped > currentMax) {
      this.args.model.max = clamped;
    }
    this.args.model.min = clamped;
  }

  setUpperBound(inputVal: number | null | undefined) {
    if (inputVal == null) {
      this.args.model.max = undefined;
      return;
    }
    let clamped = clampValue(inputVal, this.config);
    if (clamped == null) {
      this.args.model.max = undefined;
      return;
    }
    let currentMin = this.minValue;
    if (clamped < currentMin) {
      this.args.model.min = clamped;
    }
    this.args.model.max = clamped;
  }

  @action handleMinSliderInput(event: Event) {
    let target = event.target as HTMLInputElement | null;
    if (!target) {
      return;
    }
    this.minInputValidator.onInput(target.value);
  }

  @action handleMaxSliderInput(event: Event) {
    let target = event.target as HTMLInputElement | null;
    if (!target) {
      return;
    }
    this.maxInputValidator.onInput(target.value);
  }

  <template>
    <div class='dual-range'>
      <div class='dual-range__values'>
        <div class='dual-range__value'>
          <span class='dual-range__value-label'>Minimum</span>
          <span class='dual-range__value-amount'>{{this.minDisplayValue}}</span>
        </div>
        <div class='dual-range__value dual-range__value--right'>
          <span class='dual-range__value-label'>Maximum</span>
          <span class='dual-range__value-amount'>{{this.maxDisplayValue}}</span>
        </div>
      </div>

      <div class='dual-range__slider'>
        <div class='dual-range__track' style={{this.sliderRangeStyle}}></div>
        <input
          type='range'
          class='dual-range__input dual-range__input--min'
          value={{this.minValueString}}
          min={{this.sliderMin}}
          max={{this.sliderMax}}
          step={{this.config.step}}
          {{on 'input' this.handleMinSliderInput}}
          disabled={{not @canEdit}}
          aria-label='Minimum value'
        />
        <input
          type='range'
          class='dual-range__input dual-range__input--max'
          value={{this.maxValueString}}
          min={{this.sliderMin}}
          max={{this.sliderMax}}
          step={{this.config.step}}
          {{on 'input' this.handleMaxSliderInput}}
          disabled={{not @canEdit}}
          aria-label='Maximum value'
        />
      </div>

      {{#if this.config.showInputs}}
        <div class='dual-range__inputs'>
          <BoxelInputGroup
            @type='number'
            @value={{this.minInputValidator.asString}}
            @onInput={{this.minInputValidator.onInput}}
            @state={{if this.minInputValidator.isInvalid 'invalid' 'none'}}
            @errorMessage={{this.minInputValidator.errorMessage}}
            @placeholder='Min'
            @inputmode='decimal'
            @min={{this.sliderMin}}
            @max={{this.sliderMax}}
            @step={{this.config.step}}
            @disabled={{not @canEdit}}
            class='dual-range__input-control'
          >
            <:before as |Accessories|>
              {{#if this.config.currency}}
                <Accessories.Text>{{this.config.currency}}</Accessories.Text>
              {{/if}}
            </:before>
          </BoxelInputGroup>
          <span class='dual-range__separator'>to</span>
          <BoxelInputGroup
            @type='number'
            @value={{this.maxInputValidator.asString}}
            @onInput={{this.maxInputValidator.onInput}}
            @state={{if this.maxInputValidator.isInvalid 'invalid' 'none'}}
            @errorMessage={{this.maxInputValidator.errorMessage}}
            @placeholder='Max'
            @inputmode='decimal'
            @min={{this.sliderMin}}
            @max={{this.sliderMax}}
            @step={{this.config.step}}
            @disabled={{not @canEdit}}
            class='dual-range__input-control'
          >
            <:before as |Accessories|>
              {{#if this.config.currency}}
                <Accessories.Text>{{this.config.currency}}</Accessories.Text>
              {{/if}}
            </:before>
          </BoxelInputGroup>
        </div>
      {{/if}}

      <div class='dual-range__bounds'>
        <span>Min {{this.minBoundLabel}}</span>
        <span>Max {{this.maxBoundLabel}}</span>
      </div>
    </div>
    <style scoped>
      @layer boxelComponentL1 {
        .dual-range {
          display: grid;
          gap: var(--boxel-sp);
        }
        .dual-range__values {
          display: flex;
          justify-content: space-between;
          gap: var(--boxel-sp);
        }
        .dual-range__value {
          display: grid;
          gap: var(--boxel-sp-xxxs);
        }
        .dual-range__value-label {
          font-size: var(--boxel-font-size-xs);
          font-weight: var(--boxel-font-weight-semibold);
          text-transform: uppercase;
          letter-spacing: var(--boxel-lsp);
          color: var(--muted-foreground, var(--boxel-450));
        }
        .dual-range__value-amount {
          font-size: var(--boxel-font-size-lg);
          font-weight: var(--boxel-font-weight-semibold);
          color: var(--primary, var(--boxel-dark));
        }
        .dual-range__slider {
          position: relative;
          height: 2.25rem;
          display: flex;
          align-items: center;
        }
        .dual-range__track {
          position: absolute;
          width: 100%;
          height: var(--boxel-sp-xxs);
          border-radius: var(--boxel-border-radius-xl);
          background: linear-gradient(
            to right,
            var(--track-bg, var(--boxel-200)) var(--range-start, 0%),
            var(--active-bg, var(--boxel-blue)) var(--range-start, 0%),
            var(--active-bg, var(--boxel-blue)) var(--range-end, 100%),
            var(--track-bg, var(--boxel-200)) var(--range-end, 100%)
          );
        }
        .dual-range__input {
          pointer-events: none;
          position: absolute;
          width: 100%;
          height: 100%;
          margin: 0;
          appearance: none;
          background: none;
        }
        .dual-range__input--min {
          z-index: 2;
        }
        .dual-range__input--max {
          z-index: 3;
        }
        .dual-range__input:disabled {
          pointer-events: none;
        }
        .dual-range__input::-webkit-slider-runnable-track {
          appearance: none;
          background: transparent;
        }
        .dual-range__input::-moz-range-track {
          background: transparent;
        }
        .dual-range__input::-webkit-slider-thumb {
          pointer-events: auto;
          appearance: none;
          width: var(--boxel-icon-sm);
          height: var(--boxel-icon-sm);
          border-radius: var(--boxel-border-radius-xl);
          background: var(--thumb-bg, var(--boxel-light));
          border: 2px solid var(--thumb-border, var(--boxel-blue));
          box-shadow: var(--boxel-box-shadow);
          transition: var(--boxel-transition);
        }
        .dual-range__input::-moz-range-thumb {
          pointer-events: auto;
          width: var(--boxel-icon-sm);
          height: var(--boxel-icon-sm);
          border-radius: var(--boxel-border-radius-xl);
          background: var(--thumb-bg, var(--boxel-light));
          border: 2px solid var(--thumb-border, var(--boxel-blue));
          box-shadow: var(--boxel-box-shadow);
          transition: var(--boxel-transition);
        }
        .dual-range__input:hover::-webkit-slider-thumb {
          box-shadow: var(--boxel-box-shadow-hover);
        }
        .dual-range__input:hover::-moz-range-thumb {
          box-shadow: var(--boxel-box-shadow-hover);
        }
        .dual-range__input:focus-visible::-webkit-slider-thumb {
          outline: var(--boxel-outline);
          outline-offset: 2px;
        }
        .dual-range__input:focus-visible::-moz-range-thumb {
          outline: var(--boxel-outline);
          outline-offset: 2px;
        }
        .dual-range__input:disabled::-webkit-slider-thumb,
        .dual-range__input:disabled::-moz-range-thumb {
          border-color: var(--boxel-300);
          background: var(--boxel-light-500);
          box-shadow: none;
          opacity: 0.5;
        }
        .dual-range__inputs {
          display: grid;
          grid-template-columns: 1fr auto 1fr;
          gap: var(--boxel-sp-xs);
          align-items: center;
        }
        .dual-range__input-control {
          width: 100%;
        }
        .dual-range__separator {
          font-size: var(--boxel-font-size-sm);
          font-weight: var(--boxel-font-weight-normal);
          color: var(--muted-foreground, var(--boxel-450));
        }
        .dual-range__bounds {
          display: flex;
          justify-content: space-between;
          font-size: var(--boxel-font-size-xs);
          font-weight: var(--boxel-font-weight-normal);
          letter-spacing: var(--boxel-lsp-xs);
          color: var(--muted-foreground, var(--boxel-500));
        }
      }
    </style>
  </template>
}

class DualRangeSliderField extends FieldDef {
  static displayName = 'Dual Range Slider';
  @field min = contains(NumberField);
  @field max = contains(NumberField);
  static edit = DualRangeSliderFieldEdit;
  static atom = class DualRangeSliderAtom extends Component<
    typeof DualRangeSliderField
  > {
    get config(): DualRangeSliderConfig {
      return readConfig(this.args.configuration, {
        min: 0,
        max: 1000,
        step: 10,
        allowNegative: false,
        decimals: 0,
        currency: '$',
        showInputs: true,
      });
    }

    get minValue(): number | null {
      let raw = this.args.model.min;
      if (typeof raw === 'number') {
        return clampValue(raw, this.config);
      }
      return null;
    }

    get maxValue(): number | null {
      let raw = this.args.model.max;
      if (typeof raw === 'number') {
        return clampValue(raw, this.config);
      }
      return null;
    }

    get displayValue() {
      let minLabel =
        this.minValue != null
          ? formatRangeValue(this.minValue, this.config)
          : 'Any';
      let maxLabel =
        this.maxValue != null
          ? formatRangeValue(this.maxValue, this.config)
          : 'Any';

      if (minLabel === 'Any' && maxLabel === 'Any') {
        return 'Any range';
      }
      return `${minLabel} - ${maxLabel}`;
    }

    <template>
      <span class='dual-range-atom'>{{this.displayValue}}</span>
      <style scoped>
        .dual-range-atom {
          font-weight: var(--boxel-font-weight-semibold);
          color: var(--primary, var(--boxel-dark));
        }
      </style>
    </template>
  };
  static embedded = DualRangeSliderField.atom;
}

// Unit Number Field --------------------------------------------------------

type UnitOption = {
  value: string;
  label: string;
  conversionFactor?: number;
};

type UnitConfig = NumberConstraints & {
  units: UnitOption[];
  defaultUnit?: string;
};

class UnitNumberEdit extends Component<typeof UnitNumberField> {
  get config(): UnitConfig {
    return readConfig(this.args.configuration, {
      min: 0,
      max: undefined,
      step: 1,
      allowNegative: false,
      placeholder: '0',
      units: [
        { value: 'kg', label: 'kg' },
        { value: 'lb', label: 'lb', conversionFactor: 2.20462 },
      ],
      defaultUnit: 'kg',
    });
  }

  textInputValidator: TextInputValidator<number> = new TextInputValidator(
    () => {
      let val = this.args.model.value;
      return typeof val === 'number' ? val : null;
    },
    (inputVal) => {
      let clamped = clampValue(inputVal ?? null, this.config);
      this.args.model.value = clamped === null ? undefined : clamped;
    },
    deserializeForUI,
    serializeForUI,
    NumberSerializer.validate,
  );

  get unitOptions() {
    return this.config.units.map((u) => ({
      label: u.label,
      value: u.value,
    }));
  }

  get selectedUnit() {
    let current = this.args.model.unit;
    if (!current && this.config.defaultUnit) {
      this.args.model.unit = this.config.defaultUnit;
      current = this.config.defaultUnit;
    }
    return this.unitOptions.find((opt) => opt.value === current);
  }

  selectUnit = (option: { label: string; value: string }) => {
    this.args.model.unit = option.value;
  };

  <template>
    <BoxelInputGroup
      @type='number'
      @value={{this.textInputValidator.asString}}
      @onInput={{this.textInputValidator.onInput}}
      @errorMessage={{this.textInputValidator.errorMessage}}
      @state={{if this.textInputValidator.isInvalid 'invalid' 'none'}}
      @disabled={{not @canEdit}}
      @placeholder={{this.config.placeholder}}
      @min={{this.config.min}}
      @max={{this.config.max}}
      @step={{this.config.step}}
      class='unit-number'
    >
      <:after as |Accessories|>
        <Accessories.Select
          @searchEnabled={{true}}
          @options={{this.unitOptions}}
          @selected={{this.selectedUnit}}
          @onChange={{this.selectUnit}}
          @placeholder='Unit'
          @searchField='label'
          as |opt|
        >
          {{opt.label}}
        </Accessories.Select>
      </:after>
    </BoxelInputGroup>
    <style scoped>
      @layer boxelComponentL1 {
        .unit-number {
          width: 100%;
        }
      }
    </style>
  </template>
}

class UnitNumberField extends FieldDef {
  static displayName = 'Unit Number';
  @field value = contains(NumberField);
  @field unit = contains(StringField);
  static edit = UnitNumberEdit;
  static atom = class UnitNumberAtom extends Component<typeof UnitNumberField> {
    get config(): UnitConfig {
      return readConfig(this.args.configuration, {
        min: 0,
        max: undefined,
        step: 1,
        allowNegative: false,
        placeholder: '0',
        units: [
          { value: 'kg', label: 'kg' },
          { value: 'lb', label: 'lb' },
        ],
        defaultUnit: 'kg',
      });
    }
    get displayValue() {
      let val =
        typeof this.args.model.value === 'number'
          ? this.args.model.value
          : null;
      let unit = this.args.model.unit || this.config.defaultUnit || '';
      return formatDisplayValue(val, ` ${unit}`);
    }
    <template>
      <span class='unit-number-atom'>{{this.displayValue}}</span>
      <style scoped>
        .unit-number-atom {
          font-weight: 500;
        }
      </style>
    </template>
  };
  static embedded = UnitNumberField.atom;
}

// Formatted Number Field ---------------------------------------------------

type FormattedNumberConfig = NumberConstraints & {
  thousandsSeparator?: string;
  decimalSeparator?: string;
  prefix?: string;
  suffix?: string;
};

function formatNumber(
  value: number | null,
  config: FormattedNumberConfig,
): string {
  if (value == null) {
    return '';
  }

  let num = value;
  let decimals = config.decimals ?? 0;
  let thousandsSeparator = config.thousandsSeparator ?? ',';
  let decimalSeparator = config.decimalSeparator ?? '.';

  // Round to decimal scale
  let factor = Math.pow(10, decimals);
  num = Math.round(num * factor) / factor;

  // Split into integer and decimal parts
  let parts = num.toFixed(decimals).split('.');
  let integerPart = parts[0] || '0';
  let decimalPart = parts[1];

  // Add thousands separator
  integerPart = integerPart.replace(
    /\B(?=(\d{3})+(?!\d))/g,
    thousandsSeparator,
  );

  // Combine
  let formatted =
    decimals > 0 && decimalPart
      ? `${integerPart}${decimalSeparator}${decimalPart}`
      : integerPart;

  return formatted;
}

class FormattedNumberFieldEdit extends Component<typeof FormattedNumberField> {
  get config(): FormattedNumberConfig {
    return readConfig(this.args.configuration, {
      min: undefined,
      max: undefined,
      step: undefined,
      allowNegative: true,
      placeholder: '0',
      decimals: 2,
      thousandsSeparator: ',',
      decimalSeparator: '.',
      prefix: '',
      suffix: '',
    });
  }

  textInputValidator: TextInputValidator<number> = new TextInputValidator(
    () => this.args.model,
    (inputVal) => this.args.set(clampValue(inputVal ?? null, this.config)),
    deserializeForUI,
    serializeForUI,
    NumberSerializer.validate,
  );

  get formattedValue() {
    let val = typeof this.args.model === 'number' ? this.args.model : null;
    return formatNumber(val, this.config);
  }

  get displayValue() {
    let formatted = this.formattedValue;
    if (!formatted) {
      return '';
    }
    return `${this.config.prefix ?? ''}${formatted}${this.config.suffix ?? ''}`;
  }

  <template>
    <div class='formatted-number'>
      <BoxelInput
        @type='number'
        @value={{this.textInputValidator.asString}}
        @onInput={{this.textInputValidator.onInput}}
        @errorMessage={{this.textInputValidator.errorMessage}}
        @state={{if this.textInputValidator.isInvalid 'invalid' 'none'}}
        @disabled={{not @canEdit}}
        @placeholder={{this.config.placeholder}}
        min={{this.config.min}}
        max={{this.config.max}}
        step={{this.config.step}}
        class='formatted-number__input'
      />
      {{#if this.displayValue}}
        <div class='formatted-number__preview'>
          Preview:
          {{this.displayValue}}
        </div>
      {{/if}}
    </div>
    <style scoped>
      @layer boxelComponentL1 {
        .formatted-number {
          display: grid;
          gap: var(--boxel-sp-xxs);
        }
        .formatted-number__preview {
          font-size: var(--boxel-font-size-sm);
          color: var(--boxel-500);
          padding: var(--boxel-sp-xxxs) var(--boxel-sp-xs);
          background: var(--boxel-100);
          border-radius: var(--boxel-border-radius);
          font-family: var(--boxel-font-family-mono);
        }
      }
    </style>
  </template>
}

class FormattedNumberField extends NumberField {
  static displayName = 'Formatted Number';
  static edit = FormattedNumberFieldEdit;
  static atom = class FormattedNumberAtom extends Component<
    typeof FormattedNumberField
  > {
    get config(): FormattedNumberConfig {
      return readConfig(this.args.configuration, {
        min: undefined,
        max: undefined,
        step: undefined,
        allowNegative: true,
        placeholder: '0',
        decimals: 2,
        thousandsSeparator: ',',
        decimalSeparator: '.',
        prefix: '',
        suffix: '',
      });
    }
    get displayValue() {
      let val = typeof this.args.model === 'number' ? this.args.model : null;
      let formatted = formatNumber(val, this.config);
      if (!formatted) {
        return '—';
      }
      return `${this.config.prefix ?? ''}${formatted}${
        this.config.suffix ?? ''
      }`;
    }
    <template>
      <span class='formatted-number-atom'>{{this.displayValue}}</span>
      <style scoped>
        .formatted-number-atom {
          font-family: var(--boxel-font-family-mono);
          font-weight: 500;
        }
      </style>
    </template>
  };
  static embedded = FormattedNumberField.atom;
}

// Masked Number Field ------------------------------------------------------

type MaskedNumberConfig = NumberConstraints & {
  maskChar?: string;
  visibleDigits?: number;
  pattern?: string;
};

class MaskedNumberFieldEdit extends Component<typeof MaskedNumberField> {
  get config(): MaskedNumberConfig {
    return readConfig(this.args.configuration, {
      min: undefined,
      max: undefined,
      step: undefined,
      allowNegative: false,
      placeholder: 'Enter number',
      maskChar: '*',
      visibleDigits: 4,
      pattern: undefined,
    });
  }

  textInputValidator: TextInputValidator<number> = new TextInputValidator(
    () => this.args.model,
    (inputVal) => this.args.set(clampValue(inputVal ?? null, this.config)),
    deserializeForUI,
    serializeForUI,
    NumberSerializer.validate,
  );

  get maskedDisplay() {
    let val = typeof this.args.model === 'number' ? this.args.model : null;
    if (val == null) {
      return '';
    }

    // Extract sign and work with absolute value
    let isNegative = val < 0;
    let absVal = Math.abs(val);
    let str = String(absVal);
    let visibleDigits = this.config.visibleDigits ?? 4;
    let maskChar = this.config.maskChar ?? '*';

    if (str.length <= visibleDigits) {
      return isNegative ? `-${str}` : str;
    }

    let masked = maskChar.repeat(str.length - visibleDigits);
    let visible = str.slice(-visibleDigits);

    // Apply pattern if provided (e.g., "**** **** **** 1234")
    let pattern = this.config.pattern;
    if (pattern) {
      let full = masked + visible;
      let result = '';
      let digitIndex = 0;
      for (let char of pattern) {
        if (char === 'X' || char === '#') {
          result += full[digitIndex] || maskChar;
          digitIndex++;
        } else {
          result += char;
        }
      }
      return isNegative ? `-${result}` : result;
    }

    let maskedResult = `${masked}${visible}`;
    return isNegative ? `-${maskedResult}` : maskedResult;
  }

  <template>
    <div class='masked-number'>
      <BoxelInput
        @type='number'
        @value={{this.textInputValidator.asString}}
        @onInput={{this.textInputValidator.onInput}}
        @errorMessage={{this.textInputValidator.errorMessage}}
        @state={{if this.textInputValidator.isInvalid 'invalid' 'none'}}
        @disabled={{not @canEdit}}
        @placeholder={{this.config.placeholder}}
        min={{this.config.min}}
        max={{this.config.max}}
        step={{this.config.step}}
        class='masked-number__input'
      />
      {{#if this.maskedDisplay}}
        <div class='masked-number__display'>
          {{this.maskedDisplay}}
        </div>
      {{/if}}
    </div>
    <style scoped>
      @layer boxelComponentL1 {
        .masked-number {
          display: grid;
          gap: var(--boxel-sp-xxs);
        }
        .masked-number__display {
          font-family: var(--boxel-font-family-mono);
          font-size: var(--boxel-font-size);
          color: var(--boxel-600);
          padding: var(--boxel-sp-xs);
          background: var(--boxel-100);
          border-radius: var(--boxel-border-radius);
          letter-spacing: 0.1em;
        }
      }
    </style>
  </template>
}

class MaskedNumberField extends NumberField {
  static displayName = 'Masked Number';
  static edit = MaskedNumberFieldEdit;
  static atom = class MaskedNumberAtom extends Component<
    typeof MaskedNumberField
  > {
    get config(): MaskedNumberConfig {
      return readConfig(this.args.configuration, {
        min: undefined,
        max: undefined,
        step: undefined,
        allowNegative: false,
        placeholder: 'Enter number',
        maskChar: '*',
        visibleDigits: 4,
        pattern: undefined,
      });
    }
    get maskedDisplay() {
      let val = typeof this.args.model === 'number' ? this.args.model : null;
      if (val == null) {
        return '—';
      }

      // Extract sign and work with absolute value
      let isNegative = val < 0;
      let absVal = Math.abs(val);
      let str = String(absVal);
      let visibleDigits = this.config.visibleDigits ?? 4;
      let maskChar = this.config.maskChar ?? '*';

      if (str.length <= visibleDigits) {
        return isNegative ? `-${str}` : str;
      }

      let masked = maskChar.repeat(str.length - visibleDigits);
      let visible = str.slice(-visibleDigits);

      let pattern = this.config.pattern;
      if (pattern) {
        let full = masked + visible;
        let result = '';
        let digitIndex = 0;
        for (let char of pattern) {
          if (char === 'X' || char === '#') {
            result += full[digitIndex] || maskChar;
            digitIndex++;
          } else {
            result += char;
          }
        }
        return isNegative ? `-${result}` : result;
      }

      let maskedResult = `${masked}${visible}`;
      return isNegative ? `-${maskedResult}` : maskedResult;
    }
    <template>
      <span class='masked-number-atom'>{{this.maskedDisplay}}</span>
      <style scoped>
        .masked-number-atom {
          font-family: var(--boxel-font-family-mono);
          letter-spacing: 0.1em;
        }
      </style>
    </template>
  };
  static embedded = MaskedNumberField.atom;
}

export {
  AnimatedCounterNumberField,
  BadgeNumberField,
  BasicNumberField,
  DualRangeSliderField,
  FormattedNumberField,
  GaugeNumberField,
  MaskedNumberField,
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
  UnitNumberField,
};
