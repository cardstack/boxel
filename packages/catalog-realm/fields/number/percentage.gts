import { htmlSafe } from '@ember/template';
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
  getNumericValue,
  getFormattedDisplayValue,
  calculatePercentage,
  clamp,
  type PercentageConfig,
} from './util/index';

export default class PercentageField extends NumberField {
  static displayName = 'Percentage Number Field';

  static configuration = {
    presentation: {
      type: 'percentage',
      decimals: 1,
      min: 0,
      max: 100,
    },
  };

  static edit = class Edit extends Component<typeof this> {
    get config(): PercentageConfig {
      return {
        type: 'percentage',
        decimals: 1,
        min: 0,
        max: 100,
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
    get config(): PercentageConfig {
      return {
        type: 'percentage',
        decimals: 1,
        min: 0,
        max: 100,
        ...this.args.configuration?.presentation,
      };
    }

    get numericValue() {
      return getNumericValue(this.args.model);
    }

    <template>
      <span class='percentage-field-atom'>{{this.numericValue}}%</span>

      <style scoped>
        .percentage-field-atom {
          font-size: var(--boxel-font-size-xs, 0.6875rem);
          font-weight: var(--boxel-font-weight-semibold, 600);
          color: var(--foreground, var(--boxel-dark, #1a1a1a));
          font-family: var(--font-mono, var(--boxel-monospace-font-family, monospace));
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    get config(): PercentageConfig {
      return {
        type: 'percentage',
        decimals: 1,
        min: 0,
        max: 100,
        ...this.args.configuration?.presentation,
      };
    }

    get displayValue() {
      return getFormattedDisplayValue(this.args.model, this.config);
    }

    get percentage() {
      const numericValue = getNumericValue(this.args.model);
      return calculatePercentage(
        numericValue,
        this.config.min,
        this.config.max,
      );
    }

    get percentageColor() {
      const pct = this.percentage;
      if (pct < 33) return 'var(--success, var(--boxel-green))';
      if (pct < 66) return 'var(--warning, var(--boxel-orange))';
      return 'var(--destructive, var(--boxel-red))';
    }

    get fillStyle() {
      return htmlSafe(
        `width: ${this.percentage}%; background: ${this.percentageColor}`,
      );
    }

    <template>
      <div class='percentage-field-embedded'>
        <div class='percentage-bar'>
          <div class='percentage-fill' style={{this.fillStyle}}></div>
          <span class='percentage-text'>{{this.displayValue}}</span>
        </div>
      </div>

      <style scoped>
        .percentage-field-embedded {
          width: 100%;
        }
        .percentage-bar {
          position: relative;
          height: 2rem;
          background: var(--muted, var(--boxel-200));
          border-radius: 0.5rem;
          overflow: hidden;
        }
        .percentage-fill {
          position: absolute;
          height: 100%;
          transition:
            width 0.3s ease,
            background 0.3s ease;
        }
        .percentage-text {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          font-weight: 600;
          color: var(--foreground, var(--boxel-dark));
          font-size: 0.875rem;
          z-index: 1;
        }
      </style>
    </template>
  };
}
