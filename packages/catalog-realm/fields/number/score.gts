import { htmlSafe } from '@ember/template';
import { concat } from '@ember/helper';
import { Component } from 'https://cardstack.com/base/card-api';
import NumberInput from './components/number-input';
import SegmentedScoreBarComponent from './components/segmented-score-bar';

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
import type { ScoreConfig } from './util/types';

interface Configuration {
  presentation: ScoreConfig;
}

export default class ScoreField extends NumberField {
  static displayName = 'Score Number Field';

  static configuration: Configuration = {
    presentation: {
      type: 'score',
      decimals: 0,
      min: 0,
      max: 100,
      label: 'Score',
    },
  };

  static edit = class Edit extends Component<typeof this> {
    get config() {
      return this.args.configuration?.presentation;
    }
    <template>
      <NumberInput
        @value={{@model}}
        @config={{this.config}}
        @onChange={{@set}}
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

    get numericValue() {
      return getNumericValue(this.args.model);
    }

    get percentage() {
      return calculatePercentage(
        this.numericValue,
        this.config.min,
        this.config.max,
      );
    }

    get iconColor() {
      if (this.percentage >= 75) return 'var(--success, #22c55e)';
      if (this.percentage >= 50) return 'var(--accent, #eab308)';
      if (this.percentage >= 25) return 'var(--warning, #f59e0b)';
      return 'var(--destructive, #ef4444)';
    }

    <template>
      <span class='score-field-atom'>
        <svg
          class='chart-icon'
          style={{htmlSafe (concat 'color: ' this.iconColor)}}
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
        .score-field-atom {
          display: inline-flex;
          align-items: center;
          gap: var(--boxel-sp-5xs, 0.25rem);
        }
        .chart-icon {
          width: var(--boxel-icon-xxs, 0.75rem);
          height: var(--boxel-icon-xxs, 0.75rem);
          transition: color 0.3s ease;
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

    get numericValue() {
      return getNumericValue(this.args.model);
    }

    get percentage() {
      return calculatePercentage(
        this.numericValue,
        this.config.min,
        this.config.max,
      );
    }

    get tierLabel() {
      if (this.percentage >= 75) return 'Excellent';
      if (this.percentage >= 50) return 'Good';
      if (this.percentage >= 25) return 'Fair';
      return 'Poor';
    }

    get scoreColor() {
      if (this.percentage >= 75) return 'var(--success, #22c55e)';
      if (this.percentage >= 50) return 'var(--accent, #eab308)';
      if (this.percentage >= 25) return 'var(--warning, #f59e0b)';
      return 'var(--destructive, #ef4444)';
    }

    get percentile() {
      // Calculate inverse percentile (higher score = lower percentile number = better)
      const inversePercentage = 100 - this.percentage;
      if (inversePercentage < 15) return 'Top 15%';
      if (inversePercentage < 30) return 'Top 30%';
      if (inversePercentage < 50) return 'Top 50%';
      return 'Below Average';
    }

    get label() {
      return this.config.label ?? 'Score';
    }

    <template>
      <div class='score-field-embedded'>
        <span class='score-label'>{{this.label}}</span>
        <div class='score-content'>
          <span
            class='score-value'
            style={{htmlSafe (concat 'color: ' this.scoreColor)}}
          >
            {{this.displayValue}}
          </span>
          <div class='score-status'>
            <span class='score-tier'>{{this.tierLabel}}</span>
            <span class='score-percentile'>{{this.percentile}}</span>
          </div>
        </div>
        <SegmentedScoreBarComponent
          @value={{this.numericValue}}
          @min={{this.config.min}}
          @max={{this.config.max}}
          @height='0.5rem'
        />
      </div>

      <style scoped>
        .score-field-embedded {
          display: flex;
          flex-direction: column;
          gap: calc(var(--spacing, 0.25rem) * 4);
          padding: calc(var(--spacing, 0.25rem) * 5);
          border-radius: var(--radius, 0.75rem);
          border: 1px solid var(--border, #e2e8f0);
          background: var(--card, #ffffff);
        }
        .score-label {
          font-size: 0.875rem;
          font-weight: 500;
          color: var(--foreground, #0f172a);
        }
        .score-content {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: calc(var(--spacing, 0.25rem) * 4);
        }
        .score-value {
          font-size: 3.5rem;
          font-weight: 700;
          line-height: 1;
          letter-spacing: -0.02em;
        }
        .score-status {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: calc(var(--spacing, 0.25rem) * 1);
          margin-top: 0.25rem;
        }
        .score-tier {
          font-size: 0.875rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--muted-foreground, #64748b);
        }
        .score-percentile {
          font-size: 0.8125rem;
          font-weight: 500;
          color: var(--muted-foreground, #64748b);
        }
      </style>
    </template>
  };
}
