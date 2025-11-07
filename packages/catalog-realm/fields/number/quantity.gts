import { Component } from 'https://cardstack.com/base/card-api';
import NumberField, {
  deserializeForUI,
  serializeForUI,
} from 'https://cardstack.com/base/number';
import { TextInputValidator } from 'https://cardstack.com/base/text-input-validator';
import { NumberSerializer } from '@cardstack/runtime-common';
import { on } from '@ember/modifier';
import { lte, gte } from '@cardstack/boxel-ui/helpers';
import {
  getNumericValue,
  clamp,
  calculatePercentage,
  type QuantityConfig,
} from './util/index';

interface Configuration {
  presentation: QuantityConfig;
}

export default class QuantityField extends NumberField {
  static displayName = 'Quantity Number Field';

  static configuration: Configuration = {
    presentation: {
      type: 'quantity',
      min: 0,
      max: 999,
    },
  };

  static edit = class Edit extends Component<typeof this> {
    get config() {
      return this.args.configuration?.presentation;
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
          font-family: var(
            --font-mono,
            var(--boxel-monospace-font-family, monospace)
          );
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
      return this.args.configuration?.presentation;
    }

    get numericValue() {
      return getNumericValue(this.args.model);
    }

    get percentage() {
      return calculatePercentage(
        this.numericValue,
        this.config.min,
        this.config.max,
      );
    }

    get progressStyle() {
      return `width: ${this.percentage}%`;
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
        <div class='quantity-card-header'>
          <span class='quantity-card-title'>Quantity</span>
          <span class='quantity-card-value'>{{this.numericValue}}</span>
        </div>
        <div class='quantity-card-meta'>
          <span>Min {{this.config.min}}</span>
          <span>Max {{this.config.max}}</span>
        </div>
        <div class='quantity-progress'>
          <div class='quantity-progress-fill' style={{this.progressStyle}}></div>
        </div>
      </div>

      <style scoped>
        .quantity-field-embedded {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-xxs, 0.65rem);
          padding: var(--boxel-sp, 1rem);
          background: linear-gradient(
            135deg,
            rgba(63, 94, 251, 0.06) 0%,
            rgba(252, 70, 107, 0.08) 100%
          );
          border-radius: var(--boxel-border-radius-lg, 0.75rem);
          border: 1px solid var(--boxel-200);
        }
        .quantity-card-header {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
        }
        .quantity-card-title {
          font-size: 0.75rem;
          font-weight: 600;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--boxel-450);
        }
        .quantity-card-value {
          font-size: 2rem;
          font-weight: 700;
          font-family: var(--boxel-monospace-font-family, monospace);
          color: var(--boxel-700);
        }
        .quantity-card-meta {
          display: flex;
          justify-content: space-between;
          font-size: 0.8125rem;
          color: var(--boxel-500);
          font-family: var(--boxel-monospace-font-family, monospace);
        }
        .quantity-progress {
          position: relative;
          width: 100%;
          height: 0.4rem;
          background: rgba(0, 0, 0, 0.08);
          border-radius: 999px;
          overflow: hidden;
        }
        .quantity-progress-fill {
          position: absolute;
          inset: 0 auto 0 0;
          background: linear-gradient(
            90deg,
            var(--boxel-green),
            var(--boxel-teal)
          );
          border-radius: inherit;
          transition: width 0.3s ease;
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    get config() {
      return this.args.configuration?.presentation;
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
          font-family: var(
            --font-sans,
            var(--boxel-font-family, system-ui, sans-serif)
          );
          text-transform: uppercase;
          letter-spacing: var(--boxel-lsp-xs, 0.01em);
        }
      </style>
    </template>
  };
}
