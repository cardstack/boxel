import { Component } from 'https://cardstack.com/base/card-api';
import NumberField, {
  deserializeForUI,
  serializeForUI,
} from 'https://cardstack.com/base/number';
import { TextInputValidator } from 'https://cardstack.com/base/text-input-validator';
import { NumberSerializer } from '@cardstack/runtime-common';
import { on } from '@ember/modifier';
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

    <template>
      <div class='quantity-field-edit'>
        <button
          type='button'
          class='qty-btn'
          {{on 'click' this.decrement}}
        >−</button>
        <span class='qty-value'>{{this.numericValue}}</span>
        <button
          type='button'
          class='qty-btn'
          {{on 'click' this.increment}}
        >+</button>
      </div>

      <style scoped>
        .quantity-field-edit {
          display: flex;
          align-items: center;
          gap: 1rem;
        }
        .qty-btn {
          width: 2.5rem;
          height: 2.5rem;
          border-radius: 50%;
          border: 2px solid var(--border, var(--boxel-border));
          background: var(--background, var(--boxel-light));
          font-size: 1.25rem;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.2s;
          color: var(--foreground, var(--boxel-dark));
        }
        .qty-btn:hover {
          background: var(--primary, var(--boxel-purple));
          color: var(--primary-foreground, white);
          border-color: var(--primary, var(--boxel-purple));
        }
        .qty-value {
          min-width: 3rem;
          text-align: center;
          font-size: 1.25rem;
          font-weight: 700;
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
      <div class='quantity-display'>
        <span class='quantity-label'>Qty:</span>
        <span class='quantity-value'>{{this.numericValue}}</span>
      </div>

      <style scoped>
        .quantity-display {
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
        }
      </style>
    </template>
  };
}
