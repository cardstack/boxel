import { Component } from 'https://cardstack.com/base/card-api';
import NumberField, {
  deserializeForUI,
  serializeForUI,
} from 'https://cardstack.com/base/number';
import { TextInputValidator } from 'https://cardstack.com/base/text-input-validator';
import { NumberSerializer } from '@cardstack/runtime-common';
import { BoxelInput } from '@cardstack/boxel-ui/components';
import { hasValue, getFormattedDisplayValue, clamp, type ScoresConfig } from './util/index';

export default class ScoresField extends NumberField {
  static displayName = 'Scores Number Field';

  static configuration = {
    presentation: {
      type: 'scores',
      decimals: 0,
      min: 0,
      max: 100,
    },
  };

  static edit = class Edit extends Component<typeof this> {
    get config(): ScoresConfig {
      return {
        min: 0,
        max: 100,
        decimals: 0,
        ...this.args.configuration?.presentation,
      };
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
        const min = this.config.min;
        const max = this.config.max;
        if (min != null && max != null) {
          num = clamp(num, min, max);
        }
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
    get config(): ScoresConfig {
      return {
        min: 0,
        max: 100,
        decimals: 0,
        ...this.args.configuration?.presentation,
      };
    }

    get displayValue() {
      return getFormattedDisplayValue(this.args.model, this.config);
    }

    <template>
      <span class='scores-field-atom'>{{this.displayValue}}</span>

      <style scoped>
        .scores-field-atom {
          display: inline-flex;
          align-items: center;
          font-weight: 700;
          font-size: 0.875rem;
          color: var(--foreground, var(--boxel-dark));
          font-family: var(--font-mono, monospace);
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    get config(): ScoresConfig {
      return {
        min: 0,
        max: 100,
        decimals: 0,
        ...this.args.configuration?.presentation,
      };
    }

    get displayValue() {
      return getFormattedDisplayValue(this.args.model, this.config);
    }

    <template>
      <div class='scores-field-embedded'>
        <span class='score-value'>{{this.displayValue}}</span>
        <div class='score-bars'>
          <div class='score-bar score-bar-red'></div>
          <div class='score-bar score-bar-orange'></div>
          <div class='score-bar score-bar-yellow'></div>
          <div class='score-bar score-bar-green'></div>
        </div>
      </div>

      <style scoped>
        .scores-field-embedded {
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.375rem 0.625rem;
          background: var(--muted, var(--boxel-100));
          border: 1px solid var(--border, var(--boxel-border));
          border-radius: 0.375rem;
        }
        .score-value {
          font-weight: 700;
          font-family: var(--font-family, var(--boxel-font-family));
          color: var(--foreground, var(--boxel-dark));
        }
        .score-bars {
          display: flex;
          gap: 2px;
          height: 0.5rem;
        }
        .score-bar {
          width: 3px;
          border-radius: 1px;
        }
        .score-bar-red {
          background: var(--destructive, var(--boxel-red));
        }
        .score-bar-orange {
          background: var(--warning, var(--boxel-orange));
        }
        .score-bar-yellow {
          background: var(--accent, var(--boxel-yellow));
        }
        .score-bar-green {
          background: var(--success, var(--boxel-green));
        }
      </style>
    </template>
  };
}
