// External dependencies
import { Component } from 'https://cardstack.com/base/card-api';
import { on } from '@ember/modifier';
import { lte, gte } from '@cardstack/boxel-ui/helpers';

import NumberField, {
  deserializeForUI,
  serializeForUI,
} from 'https://cardstack.com/base/number';
import { TextInputValidator } from 'https://cardstack.com/base/text-input-validator';
import { NumberSerializer } from '@cardstack/runtime-common';
import Grid2x2Icon from '@cardstack/boxel-icons/grid-2x2';

import { getNumericValue, clamp } from './number/util/index';

// Options interface for quantity field
export interface QuantityOptions {
  min?: number;
  max?: number;
}

// TypeScript configuration interface
export type QuantityFieldConfiguration = {
  presentation?: 'quantity';
  options?: QuantityOptions;
};

export default class QuantityField extends NumberField {
  static displayName = 'Quantity Number Field';

  static edit = class Edit extends Component<typeof this> {
    get config() {
      return (this.args.configuration as QuantityFieldConfiguration) ?? {};
    }

    get options() {
      return this.config.options ?? {};
    }

    get numericValue() {
      return getNumericValue(this.args.model);
    }

    get minValue() {
      return this.options.min ?? 0;
    }

    get maxValue() {
      return this.options.max ?? Infinity;
    }

    increment = () => {
      this.args.set(clamp(this.numericValue + 1, this.minValue, this.maxValue));
    };

    decrement = () => {
      this.args.set(clamp(this.numericValue - 1, this.minValue, this.maxValue));
    };

    handleInput = (event: Event) => {
      const target = event.target as HTMLInputElement;
      const value = target.value;
      const num = parseFloat(value);
      if (!isNaN(num)) {
        this.args.set(clamp(num, this.minValue, this.maxValue));
      } else if (value === '') {
        this.args.set(this.minValue);
      }
    };

    <template>
      <div class='quantity-field-edit'>
        <label for='quantity-input' class='sr-only'>Quantity</label>
        <button
          type='button'
          class='qty-btn'
          {{on 'click' this.decrement}}
          disabled={{if (lte this.numericValue this.minValue) 'true'}}
        >−</button>
        <input
          id='quantity-input'
          type='number'
          class='qty-input'
          value={{this.numericValue}}
          min={{this.minValue}}
          max={{this.maxValue}}
          {{on 'input' this.handleInput}}
        />
        <button
          type='button'
          class='qty-btn'
          {{on 'click' this.increment}}
          disabled={{if (gte this.numericValue this.maxValue) 'true'}}
        >+</button>
      </div>

      <style scoped>
        .sr-only {
          position: absolute;
          width: 1px;
          height: 1px;
          padding: 0;
          margin: -1px;
          overflow: hidden;
          clip: rect(0, 0, 0, 0);
          border: 0;
        }
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
    get config() {
      return (this.args.configuration as QuantityFieldConfiguration) ?? {};
    }

    get options() {
      return this.config.options ?? {};
    }

    get numericValue() {
      return getNumericValue(this.args.model);
    }

    <template>
      <span class='quantity-field-embedded'>
        <Grid2x2Icon class='qty-icon' />
        <span class='qty-value'>{{this.numericValue}}</span>
      </span>

      <style scoped>
        .quantity-field-embedded {
          display: inline-flex;
          align-items: center;
          gap: calc(var(--spacing, 0.25rem) * 2);
          padding: calc(var(--spacing, 0.25rem) * 2)
            calc(var(--spacing, 0.25rem) * 3);
          background: var(--muted, #f1f5f9);
          border-radius: var(--radius, 0.5rem);
          border: 1px solid var(--border, #e2e8f0);
        }

        .qty-icon {
          width: 1.25rem;
          height: 1.25rem;
          color: var(--muted-foreground, #64748b);
          flex-shrink: 0;
        }

        .qty-value {
          font-size: 1.125rem;
          font-weight: 700;
          color: var(--foreground, #0f172a);
          line-height: 1;
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    get config() {
      return (this.args.configuration as QuantityFieldConfiguration) ?? {};
    }

    get options() {
      return this.config.options ?? {};
    }

    get numericValue() {
      return getNumericValue(this.args.model);
    }

    <template>
      <span class='quantity-atom'>QTY:
        {{this.numericValue}}</span>

      <style scoped>
        .quantity-atom {
          font-size: 0.6875rem;
          font-weight: 600;
          color: var(--foreground, #0f172a);
          text-transform: uppercase;
          letter-spacing: 0.01em;
        }
      </style>
    </template>
  };
}
