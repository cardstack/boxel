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
      <span class='scores-field-atom'>
        <svg
          class='chart-icon'
          viewBox='0 0 16 16'
          fill='none'
          xmlns='http://www.w3.org/2000/svg'
        >
          <rect x='2' y='10' width='3' height='4' rx='0.5' fill='currentColor' />
          <rect
            x='6.5'
            y='6'
            width='3'
            height='8'
            rx='0.5'
            fill='currentColor'
          />
          <rect x='11' y='2' width='3' height='12' rx='0.5' fill='currentColor' />
        </svg>
        <span class='value'>{{this.displayValue}}</span>
      </span>

      <style scoped>
        .scores-field-atom {
          display: inline-flex;
          align-items: center;
          gap: var(--boxel-sp-5xs, 0.25rem);
        }
        .chart-icon {
          width: var(--boxel-icon-xxs, 0.75rem);
          height: var(--boxel-icon-xxs, 0.75rem);
          color: var(--primary, var(--boxel-purple, #6638ff));
        }
        .value {
          font-size: var(--boxel-font-size-xs, 0.6875rem);
          font-weight: var(--boxel-font-weight-semibold, 600);
          color: var(--foreground, var(--boxel-dark, #1a1a1a));
          font-family: var(--font-mono, var(--boxel-monospace-font-family, monospace));
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
