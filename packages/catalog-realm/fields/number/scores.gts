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
          gap: calc(var(--spacing, 0.25rem) * 2.5);
          padding: calc(var(--spacing, 0.25rem) * 4);
          border-radius: var(--radius, 0.75rem);
          border: 1px solid var(--border, #e2e8f0);
          background: var(--card, #ffffff);
          box-shadow: var(--shadow-md, 0 4px 6px -1px rgb(0 0 0 / 0.1));
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
          color: var(--muted-foreground, #64748b);
        }
        .scores-tier {
          display: block;
          font-size: 0.8125rem;
          color: var(--muted-foreground, #64748b);
        }
        .score-value {
          font-size: 2rem;
          font-weight: 700;
          color: var(--foreground, #0f172a);
        }
        .score-meter {
          position: relative;
          height: 0.65rem;
          width: 100%;
          background: var(--muted, #f1f5f9);
          border-radius: 999px;
          overflow: hidden;
        }
        .score-meter-fill {
          position: absolute;
          inset: 0 auto 0 0;
          background: var(--primary, #3b82f6);
          border-radius: inherit;
          transition: width 0.3s ease;
        }
        .score-scale {
          display: flex;
          justify-content: space-between;
          font-size: 0.75rem;
          color: var(--muted-foreground, #64748b);
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }
      </style>
    </template>
  };
}
