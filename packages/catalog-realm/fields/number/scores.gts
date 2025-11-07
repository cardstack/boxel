import { htmlSafe } from '@ember/template';
import { Component } from 'https://cardstack.com/base/card-api';
import NumberInput from './components/number-input';

import NumberField, {
  deserializeForUI,
  serializeForUI,
} from 'https://cardstack.com/base/number';
import { TextInputValidator } from 'https://cardstack.com/base/text-input-validator';
import { NumberSerializer } from '@cardstack/runtime-common';

import {
  getFormattedDisplayValue,
  getNumericValue,
  calculatePercentage,
} from './util/index';
import type { ScoresConfig } from './util/types/index';

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

    <template>
      <NumberInput
        @value={{this.args.model}}
        @config={{this.config}}
        @onChange={{this.args.set}}
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
          border: 1px solid rgba(0, 0, 0, 0.08);
          background: #0f172a;
          color: var(--boxel-light);
          box-shadow: 0 14px 28px rgba(2, 6, 23, 0.4);
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
          color: rgba(255, 255, 255, 0.8);
        }
        .scores-tier {
          display: block;
          font-size: 0.8125rem;
          color: rgba(255, 255, 255, 0.6);
        }
        .score-value {
          font-size: 2rem;
          font-weight: 700;
        }
        .score-meter {
          position: relative;
          height: 0.65rem;
          width: 100%;
          background: rgba(255, 255, 255, 0.12);
          border-radius: 999px;
          overflow: hidden;
        }
        .score-meter-fill {
          position: absolute;
          inset: 0 auto 0 0;
          background: linear-gradient(
            90deg,
            #ff4d4d 0%,
            #ffb347 35%,
            #ffe259 60%,
            #37eb77 100%
          );
          border-radius: inherit;
          transition: width 0.3s ease;
        }
        .score-scale {
          display: flex;
          justify-content: space-between;
          font-size: 0.75rem;
          color: rgba(255, 255, 255, 0.6);
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }
      </style>
    </template>
  };
}
