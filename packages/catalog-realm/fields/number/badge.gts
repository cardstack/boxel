import { Component } from 'https://cardstack.com/base/card-api';
import NumberField, {
  deserializeForUI,
  serializeForUI,
} from 'https://cardstack.com/base/number';
import { TextInputValidator } from 'https://cardstack.com/base/text-input-validator';
import { NumberSerializer } from '@cardstack/runtime-common';
import { BoxelInput } from '@cardstack/boxel-ui/components';
import { hasValue, getFormattedDisplayValue, clamp, type BadgeConfig } from './util/index';

export default class BadgeField extends NumberField {
  static displayName = 'Badge Number Field';

  static configuration = {
    presentation: {
      type: 'badge',
      label: '',
      decimals: 0,
      min: 0,
      max: 100,
    },
  };

  static edit = class Edit extends Component<typeof this> {
    get config(): BadgeConfig {
      return {
        min: 0,
        max: 100,
        decimals: 0,
        label: '',
        ...this.args.configuration?.presentation,
      };
    }

    get inputValue() {
      // Return null for empty input, otherwise the numeric value
      return hasValue(this.args.model) ? this.args.model : null;
    }

    handleInputChange = (value: string) => {
      if (value === '' || value === null || value === undefined) {
        this.args.set(null);
        return;
      }
      const num = parseFloat(value);
      if (!isNaN(num)) {
        const min = this.config.min ?? -Infinity;
        const max = this.config.max ?? Infinity;
        this.args.set(clamp(num, min, max));
      }
    };

    <template>
      <BoxelInput
        @type='number'
        @value={{this.inputValue}}
        @onInput={{this.handleInputChange}}
        min={{this.config.min}}
        max={{this.config.max}}
      />
    </template>

    textInputValidator: TextInputValidator<number> = new TextInputValidator(
      () => this.args.model,
      (inputVal) => this.args.set(inputVal),
      deserializeForUI,
      serializeForUI,
      NumberSerializer.validate,
    );
  };

  static atom = class Atom extends Component<typeof this> {
    get config(): BadgeConfig {
      return {
        min: 0,
        max: 100,
        decimals: 0,
        label: '',
        ...this.args.configuration?.presentation,
      };
    }

    get displayValue() {
      return getFormattedDisplayValue(this.args.model, this.config);
    }

    <template>
      <span class='badge-field-atom'>{{this.displayValue}}</span>

      <style scoped>
        .badge-field-atom {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: var(--boxel-icon-xs, 1rem);
          height: var(--boxel-icon-xs, 1rem);
          padding: calc(var(--boxel-sp-6xs, 0.125rem) * 1.5) var(--boxel-sp-xs, 0.5rem);
          background: var(--destructive, var(--boxel-red, #ff5050));
          color: var(--destructive-foreground, var(--boxel-light, #ffffff));
          border-radius: var(--radius, var(--boxel-border-radius-xl, 0.9375rem));
          font-size: var(--boxel-font-size-xs, 0.6875rem);
          font-weight: var(--boxel-font-weight-semibold, 600);
          font-family: var(--font-mono, var(--boxel-monospace-font-family, monospace));
          line-height: 1;
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    get config(): BadgeConfig {
      return {
        min: 0,
        max: 100,
        decimals: 0,
        label: '',
        ...this.args.configuration?.presentation,
      };
    }

    get displayValue() {
      return getFormattedDisplayValue(this.args.model, this.config);
    }

    <template>
      <div class='badge-field-embedded'>
        {{#if this.config.label}}
          <span class='badge-label'>{{this.config.label}}</span>
        {{/if}}
        <span class='badge-count'>{{this.displayValue}}</span>
      </div>

      <style scoped>
        .badge-field-embedded {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          padding: 0.25rem 0.625rem;
          background: var(--foreground, var(--boxel-dark));
          color: var(--background, var(--boxel-light));
          border-radius: 9999px;
          font-size: 0.75rem;
          font-weight: 600;
        }
        .badge-label {
          opacity: 0.9;
        }
        .badge-count {
          font-weight: 700;
        }
      </style>
    </template>
  };
}
