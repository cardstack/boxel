import { Component } from 'https://cardstack.com/base/card-api';
import NumberField, {
  deserializeForUI,
  serializeForUI,
} from 'https://cardstack.com/base/number';
import { TextInputValidator } from 'https://cardstack.com/base/text-input-validator';
import { NumberSerializer } from '@cardstack/runtime-common';
import { BoxelInput } from '@cardstack/boxel-ui/components';
import {
  hasValue,
  getFormattedDisplayValue,
  clamp,
  type StatConfig,
} from './util/index';

interface Configuration {
  presentation: StatConfig;
}

export default class StatField extends NumberField {
  static displayName = 'Stat Number Field';

  static configuration: Configuration = {
    presentation: {
      type: 'stat',
      prefix: '',
      suffix: '',
      decimals: 0,
      min: 0,
      max: 100,
    },
  };

  static edit = class Edit extends Component<typeof this> {
    get config() {
      return this.args.configuration?.presentation;
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
    get config() {
      return this.args.configuration?.presentation;
    }

    get displayValue() {
      return getFormattedDisplayValue(this.args.model, this.config);
    }

    <template>
      <span class='stat-field-atom'>
        <span class='stat-indicator'></span>
        <span class='stat-text'>{{this.displayValue}}</span>
      </span>

      <style scoped>
        .stat-field-atom {
          display: inline-flex;
          align-items: center;
          gap: var(--boxel-sp-5xs, 0.25rem);
          padding: calc(var(--boxel-sp-6xs, 0.125rem) * 1.5)
            var(--boxel-sp-xs, 0.5rem);
          background: var(--primary, var(--boxel-purple, #6638ff));
          color: var(--primary-foreground, var(--boxel-light, #ffffff));
          border-radius: var(
            --radius,
            var(--boxel-border-radius-xl, 0.9375rem)
          );
          font-size: var(--boxel-font-size-xs, 0.6875rem);
          font-weight: var(--boxel-font-weight-semibold, 600);
          font-family: var(
            --font-mono,
            var(--boxel-monospace-font-family, monospace)
          );
          line-height: 1;
        }
        .stat-indicator {
          width: 0.375rem;
          height: 0.375rem;
          border-radius: 50%;
          background: var(--primary-foreground, var(--boxel-light, #ffffff));
          opacity: 0.8;
          flex-shrink: 0;
        }
        .stat-text {
          display: flex;
          align-items: center;
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    get config() {
      return this.args.configuration?.presentation;
    }

    get displayValue() {
      return getFormattedDisplayValue(this.args.model, this.config);
    }

    <template>
      <div class='stat-field-embedded'>
        <div class='stat-label'>{{this.config.label}}</div>
        <div class='stat-value'>{{this.displayValue}}</div>
      </div>

      <style scoped>
        .stat-field-embedded {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
          padding: 0.75rem;
          background: var(--muted, var(--boxel-100));
          border: 1px solid var(--border, var(--boxel-border));
          border-radius: 0.5rem;
        }
        .stat-label {
          font-size: 0.75rem;
          font-weight: 600;
          color: var(--muted-foreground, var(--boxel-450));
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .stat-value {
          font-size: 1.5rem;
          font-weight: 700;
          color: var(--primary, var(--boxel-purple));
          font-family: var(--font-family, var(--boxel-font-family));
        }
      </style>
    </template>
  };
}
