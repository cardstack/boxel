import { Component } from 'https://cardstack.com/base/card-api';
import NumberField, {
  deserializeForUI,
  serializeForUI,
} from 'https://cardstack.com/base/number';
import { TextInputValidator } from 'https://cardstack.com/base/text-input-validator';
import { NumberSerializer } from '@cardstack/runtime-common';
import { BoxelInput } from '@cardstack/boxel-ui/components';
import { hasValue, getFormattedDisplayValue, clamp, type StatConfig } from './util/index';

export default class StatField extends NumberField {
  static displayName = 'Stat Number Field';

  static configuration = {
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
    get config(): StatConfig {
      return this.args.configuration?.presentation ?? {};
    }

    get inputValue() {
      // Return null for empty input, otherwise the numeric value
      return hasValue(this.args.model) ? this.args.model : null;
    }

    handleInputChange = (value: string) => {
      // Handle empty input by setting to null
      if (value === '' || value === null || value === undefined) {
        this.args.set(null);
        return;
      }
      let num = parseFloat(value);
      if (!isNaN(num)) {
        // Apply min/max clamping using utility function
        const min = this.config.min ?? -Infinity;
        const max = this.config.max ?? Infinity;
        num = clamp(num, min, max);
        this.args.set(num);
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
    get config(): StatConfig {
      return this.args.configuration?.presentation ?? {};
    }

    get displayValue() {
      return getFormattedDisplayValue(this.args.model, this.config);
    }

    <template>
      <span class='stat-field-atom'>{{this.displayValue}}</span>

      <style scoped>
        .stat-field-atom {
          display: inline-flex;
          font-size: 1rem;
          font-weight: 700;
          color: var(--primary, var(--boxel-purple));
          font-family: var(--font-mono, monospace);
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    get config(): StatConfig {
      return this.args.configuration?.presentation ?? {};
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
