import { Component } from 'https://cardstack.com/base/card-api';
import { eq } from '@cardstack/boxel-ui/helpers';
import NumberField from 'https://cardstack.com/base/number';
import NumberInput from './components/number-input';
import ProgressBarComponent from './components/progress-bar';
import ProgressCircleComponent from './components/progress-circle';

import { NumberSerializer } from '@cardstack/runtime-common';
import { TextInputValidator } from 'https://cardstack.com/base/text-input-validator';
import {
  deserializeForUI,
  serializeForUI,
} from 'https://cardstack.com/base/number';

import {
  getNumericValue,
  getFormattedDisplayValue,
  calculatePercentage,
} from './util/index';
import type { PercentageConfig } from './util/types';

interface Configuration {
  presentation: PercentageConfig;
}

export default class PercentageField extends NumberField {
  static displayName = 'Percentage Number Field';

  static configuration: Configuration = {
    presentation: {
      type: 'percentage',
      decimals: 1,
      min: 0,
      max: 100,
      visualStyle: 'bar',
      barStyle: 'gradient',
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

    get numericValue() {
      return getNumericValue(this.args.model);
    }

    get percentage() {
      const percent = calculatePercentage(
        this.numericValue,
        this.config.min,
        this.config.max,
      );
      return Math.round(percent);
    }

    get visualStyle() {
      return this.config.visualStyle ?? 'bar';
    }

    get displayValue() {
      if (this.config.valueFormat === 'fraction') {
        return `${this.numericValue} / ${this.config.max}`;
      }
      return `${this.percentage}%`;
    }

    get useGradient() {
      return this.config.barStyle === 'gradient';
    }

    <template>
      {{#if (eq this.visualStyle 'circle')}}
        <span class='percentage-circle-atom'>
          <ProgressCircleComponent
            @value={{this.numericValue}}
            @max={{this.config.max}}
            @useGradient={{this.useGradient}}
            @valueFormat={{this.config.valueFormat}}
            @showValue={{false}}
          />
          <span class='value'>{{this.displayValue}}</span>
        </span>
      {{else}}
        <span class='percentage-bar-atom'>
          {{#if this.config.label}}
            <span class='label'>{{this.config.label}}:</span>
          {{/if}}
          <span class='value'>{{this.displayValue}}</span>
        </span>
      {{/if}}

      <style scoped>
        .percentage-bar-atom {
          display: inline-flex;
          align-items: center;
          gap: var(--boxel-sp-5xs, 0.25rem);
          font-size: var(--boxel-font-size-xs, 0.6875rem);
        }
        .percentage-bar-atom .label {
          color: var(--muted-foreground, var(--boxel-450, #919191));
          font-weight: var(--boxel-font-weight-medium, 500);
        }
        .percentage-bar-atom .value {
          color: var(--foreground, var(--boxel-dark, #1a1a1a));
          font-weight: var(--boxel-font-weight-semibold, 600);
        }
        .percentage-circle-atom {
          display: inline-flex;
          align-items: center;
          gap: var(--boxel-sp-5xs, 0.25rem);
          --progress-circle-size: 16px;
        }
        .percentage-circle-atom .value {
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
      const numericValue = getNumericValue(this.args.model);
      return calculatePercentage(
        numericValue,
        this.config.min,
        this.config.max,
      );
    }

    get rangeLabel() {
      return `${this.config.min ?? 0} – ${this.config.max ?? 100}`;
    }

    get labelText() {
      return this.config.label ?? 'Percent complete';
    }

    get visualStyle() {
      return this.config.visualStyle ?? 'bar';
    }

    get barStyle() {
      return this.config.barStyle ?? 'gradient';
    }

    get valueDisplay() {
      if (this.config.valueFormat === 'fraction') {
        return `${this.numericValue} / ${this.config.max}`;
      }
      return this.displayValue;
    }

    get useGradient() {
      return this.config.barStyle === 'gradient';
    }

    <template>
      {{#if (eq this.visualStyle 'circle')}}
        <div class='percentage-circle-embedded'>
          <div class='percentage-header'>
            <span class='percentage-title'>{{this.labelText}}</span>
            {{#if this.config.showRange}}
              <span class='percentage-range'>{{this.rangeLabel}}</span>
            {{/if}}
          </div>
          <ProgressCircleComponent
            @value={{this.numericValue}}
            @max={{this.config.max}}
            @useGradient={{this.useGradient}}
            @valueFormat={{this.config.valueFormat}}
          />
        </div>
      {{else}}
        <div class='percentage-bar-embedded'>
          <div class='percentage-header'>
            <div class='percentage-info'>
              <span class='percentage-title'>{{this.labelText}}</span>
              {{#if this.config.showRange}}
                <span class='percentage-range'>{{this.rangeLabel}}</span>
              {{/if}}
            </div>
            <span class='percentage-value'>{{this.valueDisplay}}</span>
          </div>
          <ProgressBarComponent
            @value={{this.numericValue}}
            @max={{this.config.max}}
            @style={{this.barStyle}}
          />
        </div>
      {{/if}}

      <style scoped>
        .percentage-bar-embedded {
          width: 100%;
          display: flex;
          flex-direction: column;
          gap: calc(var(--spacing, 0.25rem) * 3);
          padding: calc(var(--spacing, 0.25rem) * 4);
          border-radius: var(--radius, 0.5rem);
          border: 1px solid var(--border, #e2e8f0);
          background: var(--card, #ffffff);
          --progress-bar-height: 0.875rem;
        }
        .percentage-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: calc(var(--spacing, 0.25rem) * 4);
        }
        .percentage-info {
          display: flex;
          flex-direction: column;
          gap: calc(var(--spacing, 0.25rem) * 1);
        }
        .percentage-title {
          font-size: 0.75rem;
          font-weight: 600;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--muted-foreground, #64748b);
        }
        .percentage-range {
          font-size: 0.8125rem;
          color: var(--muted-foreground, #64748b);
        }
        .percentage-value {
          font-size: 2rem;
          font-weight: 700;
          color: var(--foreground, #0f172a);
        }
        .percentage-circle-embedded {
          display: flex;
          flex-direction: column;
          gap: calc(var(--spacing, 0.25rem) * 4);
          align-items: center;
          padding: calc(var(--spacing, 0.25rem) * 4);
          border-radius: var(--radius, 0.5rem);
          border: 1px solid var(--border, #e2e8f0);
          background: var(--card, #ffffff);
        }
        .percentage-circle-embedded .percentage-header {
          width: 100%;
          flex-direction: column;
          align-items: center;
          text-align: center;
        }
      </style>
    </template>
  };
}
