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
  getFormattedDisplayValue,
  clamp,
  getNumericValue,
  calculatePercentage,
  type ScoresConfig,
} from './util/index';

interface Configuration {
  presentation: ScoresConfig;
}

export default class ScoresField extends NumberField {
  static displayName = 'Scores Number Field';

  static configuration: Configuration = {
    presentation: {
      type: 'scores',
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
      <span class='scores-field-atom'>
        <svg
          class='chart-icon'
          viewBox='0 0 16 16'
          fill='none'
          xmlns='http://www.w3.org/2000/svg'
        >
          <rect
            x='2'
            y='10'
            width='3'
            height='4'
            rx='0.5'
            fill='currentColor'
          />
          <rect
            x='6.5'
            y='6'
            width='3'
            height='8'
            rx='0.5'
            fill='currentColor'
          />
          <rect
            x='11'
            y='2'
            width='3'
            height='12'
            rx='0.5'
            fill='currentColor'
          />
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
          font-family: var(
            --font-mono,
            var(--boxel-monospace-font-family, monospace)
          );
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

    get percentage() {
      const numericValue = getNumericValue(this.args.model);
      return calculatePercentage(
        numericValue,
        this.config.min,
        this.config.max,
      );
    }

    get tierLabel() {
      if (this.percentage >= 75) return 'Excellent';
      if (this.percentage >= 50) return 'Good';
      if (this.percentage >= 25) return 'Average';
      return 'Needs attention';
    }

    get fillStyle() {
      return htmlSafe(`width: ${this.percentage}%;`);
    }

    <template>
      <div class='scores-field-embedded'>
        <div class='scores-header'>
          <div>
            <span class='scores-title'>Score</span>
            <span class='scores-tier'>{{this.tierLabel}}</span>
          </div>
          <span class='score-value'>{{this.displayValue}}</span>
        </div>
        <div class='score-meter'>
          <div class='score-meter-fill' style={{this.fillStyle}}></div>
        </div>
        <div class='score-scale'>
          <span>Low</span>
          <span>Avg</span>
          <span>High</span>
        </div>
      </div>

      <style scoped>
        .scores-field-embedded {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-xxs, 0.65rem);
          padding: var(--boxel-sp, 1rem);
          border-radius: var(--boxel-border-radius-lg, 0.75rem);
          border: 1px solid
            var(
              --scores-card-border,
              color-mix(in srgb, var(--boxel-900, #1a1a1a) 20%, transparent)
            );
          background: var(--scores-card-bg, var(--boxel-700, #272330));
          color: var(--scores-card-color, var(--boxel-light, #ffffff));
          box-shadow: 0 14px 28px
            color-mix(in srgb, var(--boxel-900, #1a1a1a) 35%, transparent);
        }
        .scores-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
        }
        .scores-title {
          font-size: 0.75rem;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(
            --scores-title-color,
            color-mix(in srgb, var(--boxel-light, #ffffff) 80%, transparent)
          );
        }
        .scores-tier {
          display: block;
          font-size: 0.8125rem;
          color: var(
            --scores-tier-color,
            color-mix(in srgb, var(--boxel-light, #ffffff) 60%, transparent)
          );
        }
        .score-value {
          font-size: 2rem;
          font-weight: 700;
          font-family: var(--boxel-monospace-font-family, monospace);
        }
        .score-meter {
          position: relative;
          height: 0.65rem;
          width: 100%;
          background: var(
            --scores-meter-track,
            color-mix(in srgb, var(--boxel-light, #ffffff) 12%, transparent)
          );
          border-radius: 999px;
          overflow: hidden;
        }
        .score-meter-fill {
          position: absolute;
          inset: 0 auto 0 0;
          background: linear-gradient(
            90deg,
            var(--scores-meter-stop-red, var(--boxel-red, #ff5050)) 0%,
            var(--scores-meter-stop-orange, var(--boxel-orange, #ff7f00)) 35%,
            var(--scores-meter-stop-yellow, var(--boxel-yellow, #ffd800)) 60%,
            var(--scores-meter-stop-green, var(--boxel-green, #37eb77)) 100%
          );
          border-radius: inherit;
          transition: width 0.3s ease;
        }
        .score-scale {
          display: flex;
          justify-content: space-between;
          font-size: 0.75rem;
          color: var(
            --scores-scale-color,
            color-mix(in srgb, var(--boxel-light, #ffffff) 60%, transparent)
          );
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }
      </style>
    </template>
  };
}
