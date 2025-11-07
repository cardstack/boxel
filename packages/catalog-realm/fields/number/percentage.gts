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
          <div>
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
          gap: var(--boxel-sp-xxs, 0.65rem);
          padding: var(--boxel-sp, 1rem);
          border-radius: var(--boxel-border-radius-lg, 0.75rem);
          border: 1px solid rgba(0, 0, 0, 0.08);
          background: linear-gradient(
            145deg,
            rgba(255, 255, 255, 0.9),
            rgba(245, 244, 255, 0.95)
          );
          box-shadow: 0 8px 18px rgba(15, 6, 56, 0.08);
        }
        .percentage-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: var(--boxel-sp);
        }
        .percentage-title {
          font-size: 0.75rem;
          font-weight: 600;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--boxel-450);
          display: block;
        }
        .percentage-range {
          font-size: 0.8125rem;
          color: var(--boxel-500);
        }
        .percentage-value {
          font-size: 2rem;
          font-weight: 700;
          color: var(--boxel-700);
        }
        .percentage-bar {
          position: relative;
          height: 0.85rem;
          background: rgba(0, 0, 0, 0.08);
          border-radius: 999px;
          overflow: hidden;
          border: 1px solid rgba(0, 0, 0, 0.05);
        }
        .percentage-fill {
          position: absolute;
          height: 100%;
          background: linear-gradient(
            90deg,
            var(--success, var(--boxel-green, #37eb77)) 0%,
            var(--boxel-dark-green, #00ac3d) 100%
          );
          border-radius: inherit;
          transition:
            width 0.3s ease,
            background 0.3s ease;
        }
      </style>
    </template>
  };
}
