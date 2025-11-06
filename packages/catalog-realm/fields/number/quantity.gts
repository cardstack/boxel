import { Component } from 'https://cardstack.com/base/card-api';
import NumberField, {
  deserializeForUI,
  serializeForUI,
} from 'https://cardstack.com/base/number';
import { TextInputValidator } from 'https://cardstack.com/base/text-input-validator';
import { NumberSerializer } from '@cardstack/runtime-common';
import { on } from '@ember/modifier';
import { lte, gte } from '@cardstack/boxel-ui/helpers';
import { getNumericValue, clamp, type QuantityConfig } from './util/index';

export default class QuantityField extends NumberField {
  static displayName = 'Quantity Number Field';

  static configuration = {
    presentation: {
      type: 'quantity',
      min: 0,
      max: 999,
    },
  };

  static edit = class Edit extends Component<typeof this> {
    get config(): QuantityConfig {
      return (
        this.args.configuration?.presentation ?? {
          min: 0,
          max: 999,
        }
      );
    }

    get numericValue() {
      return getNumericValue(this.args.model);
    }

    increment = () => {
      this.args.set(
        clamp(this.numericValue + 1, this.config.min, this.config.max),
      );
    };

    decrement = () => {
      this.args.set(
        clamp(this.numericValue - 1, this.config.min, this.config.max),
      );
    };

    handleInput = (event: Event) => {
      const target = event.target as HTMLInputElement;
      const value = target.value;
      const num = parseFloat(value);
      if (!isNaN(num)) {
        this.args.set(clamp(num, this.config.min, this.config.max));
      } else if (value === '') {
        this.args.set(this.config.min);
      }
    };

    <template>
      <div class='quantity-field-edit'>
        <button
          type='button'
          class='qty-btn'
          {{on 'click' this.decrement}}
          disabled={{if (lte this.numericValue this.config.min) 'true'}}
        >−</button>
        <input
          type='number'
          class='qty-input'
          value={{this.numericValue}}
          min={{this.config.min}}
          max={{this.config.max}}
          {{on 'input' this.handleInput}}
        />
        <button
          type='button'
          class='qty-btn'
          {{on 'click' this.increment}}
          disabled={{if (gte this.numericValue this.config.max) 'true'}}
        >+</button>
      </div>

      <style scoped>
        .quantity-field-edit {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xs, 0.5rem);
        }
        .qty-btn {
          width: 2.5rem;
          height: 2.5rem;
          border-radius: 50%;
          border: 2px solid var(--border, var(--boxel-200, #e0e0e0));
          background: var(--background, var(--boxel-light, #ffffff));
          font-size: 1.25rem;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.2s;
          color: var(--foreground, var(--boxel-dark, #1a1a1a));
          flex-shrink: 0;
        }
        .qty-btn:hover:not(:disabled) {
          background: var(--primary, var(--boxel-purple, #6638ff));
          color: var(--primary-foreground, var(--boxel-light, #ffffff));
          border-color: var(--primary, var(--boxel-purple, #6638ff));
        }
        .qty-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .qty-input {
          width: 4rem;
          height: 2.5rem;
          text-align: center;
          font-size: 1.125rem;
          font-weight: 700;
          padding: 0;
          border: 2px solid var(--border, var(--boxel-200, #e0e0e0));
          border-radius: var(--boxel-border-radius-xs, 0.25rem);
          background: var(--background, var(--boxel-light, #ffffff));
          color: var(--foreground, var(--boxel-dark, #1a1a1a));
          font-family: var(--font-mono, var(--boxel-monospace-font-family, monospace));
          outline: none;
          transition: border-color 0.2s;
        }
        .qty-input:focus {
          border-color: var(--primary, var(--boxel-purple, #6638ff));
        }
        .qty-input::-webkit-inner-spin-button,
        .qty-input::-webkit-outer-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }
        .qty-input[type='number'] {
          -moz-appearance: textfield;
        }
      </style>
    </template>

    textInputValidator: TextInputValidator<number> = new TextInputValidator(
      () => this.args.model,
      (inputVal) => this.args.set(inputVal),
      deserializeForUI,
      serializeForUI,
      NumberSerializer.validate,
    );
  };

  static embedded = class Embedded extends Component<typeof this> {
    get config(): QuantityConfig {
      return (
        this.args.configuration?.presentation ?? {
          min: 0,
          max: 999,
        }
      );
    }

    get numericValue() {
      return getNumericValue(this.args.model);
    }

    increment = () => {
      if (!this.args.set) return;
      this.args.set(
        clamp(this.numericValue + 1, this.config.min, this.config.max),
      );
    };

    decrement = () => {
      if (!this.args.set) return;
      this.args.set(
        clamp(this.numericValue - 1, this.config.min, this.config.max),
      );
    };

    <template>
      <div class='quantity-field-embedded'>
        <div class='quantity-display'>
          <span class='quantity-label'>Qty:</span>
          <span class='quantity-value'>{{this.numericValue}}</span>
        </div>
      </div>

      <style scoped>
        .quantity-field-embedded {
          display: inline-flex;
          align-items: center;
          gap: 0.75rem;
          padding: 0.5rem 0.75rem;
          background: var(--muted, var(--boxel-100));
          border-radius: 0.375rem;
        }
        .quantity-display {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        .quantity-label {
          font-size: 0.875rem;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .quantity-value {
          font-size: 1.125rem;
          font-weight: 700;
          font-family: var(--font-family, var(--boxel-font-family));
          color: var(--foreground, var(--boxel-dark));
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    get config(): QuantityConfig {
      return (
        this.args.configuration?.presentation ?? {
          min: 0,
          max: 999,
        }
      );
    }

    get numericValue() {
      return getNumericValue(this.args.model);
    }

    <template>
      <span class='quantity-atom'>QTY:
        {{this.numericValue}}</span>

      <style scoped>
        .quantity-atom {
          font-size: var(--boxel-font-size-xs, 0.6875rem);
          font-weight: var(--boxel-font-weight-semibold, 600);
          color: var(--foreground, var(--boxel-dark, #1a1a1a));
          font-family: var(--font-sans, var(--boxel-font-family, system-ui, sans-serif));
          text-transform: uppercase;
          letter-spacing: var(--boxel-lsp-xs, 0.01em);
        }
      </style>
    </template>
  };
}