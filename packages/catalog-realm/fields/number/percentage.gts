import { Component } from 'https://cardstack.com/base/card-api';
import NumberField from 'https://cardstack.com/base/number';
import NumberInput from './components/number-input';

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
import type { PercentageConfig } from './util/types/index';

import { htmlSafe } from '@ember/template';

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

    get fillStyle() {
      return htmlSafe(`width: ${this.percentage}%;`);
    }

    get rangeLabel() {
      return `${this.config.min ?? 0} – ${this.config.max ?? 100}`;
    }

    <template>
      <div class='percentage-field-embedded'>
        <div class='percentage-header'>
          <div class='percentage-info'>
            <span class='percentage-title'>Percent complete</span>
            <span class='percentage-range'>{{this.rangeLabel}}</span>
          </div>
          <span class='percentage-value'>{{this.displayValue}}</span>
        </div>
        <div class='percentage-bar'>
          <div class='percentage-fill' style={{this.fillStyle}}></div>
        </div>
      </div>

      <style scoped>
        .percentage-field-embedded {
          width: 100%;
          display: flex;
          flex-direction: column;
          gap: calc(var(--spacing, 0.25rem) * 3);
          padding: calc(var(--spacing, 0.25rem) * 4);
          border-radius: var(--radius, 0.5rem);
          border: 1px solid var(--border, #e2e8f0);
          background: var(--card, #ffffff);
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
        .percentage-bar {
          position: relative;
          height: 0.875rem;
          background: var(--muted, #f1f5f9);
          border-radius: 999px;
          overflow: hidden;
        }
        .percentage-fill {
          position: absolute;
          height: 100%;
          background: var(--primary, #3b82f6);
          border-radius: inherit;
          transition: width 0.3s ease;
        }
      </style>
    </template>
  };
}
