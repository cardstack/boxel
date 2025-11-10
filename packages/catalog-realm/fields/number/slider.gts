import { htmlSafe } from '@ember/template';
import { Component } from 'https://cardstack.com/base/card-api';
import { BoxelInput } from '@cardstack/boxel-ui/components';

import NumberField, {
  deserializeForUI,
  serializeForUI,
} from 'https://cardstack.com/base/number';
import { TextInputValidator } from 'https://cardstack.com/base/text-input-validator';
import { NumberSerializer } from '@cardstack/runtime-common';

import {
  getNumericValue,
  calculatePercentage,
  getFormattedDisplayValue,
} from './util/index';
import type { SliderConfig } from './util/types';

interface Configuration {
  presentation: SliderConfig;
}

export default class SliderField extends NumberField {
  static displayName = 'Slider Number Field';

  static configuration: Configuration = {
    presentation: {
      type: 'slider',
      min: 0,
      max: 100,
      suffix: '%',
      prefix: '',
      decimals: 0,
      showValue: true,
    },
  };

  static edit = class Edit extends Component<typeof this> {
    get config() {
      return this.args.configuration?.presentation;
    }

    get displayValue() {
      return getFormattedDisplayValue(this.args.model, this.config);
    }

    handleInput = (value: string) => {
      this.args.set(parseFloat(value));
    };

    <template>
      <div class='slider-field-edit' data-test-slider-edit>
        <BoxelInput
          @type='range'
          @value={{getNumericValue @model}}
          @min={{this.config.min}}
          @max={{this.config.max}}
          @onInput={{this.handleInput}}
        />
        {{#if this.config.showValue}}
          <span class='slider-value'>{{this.displayValue}}</span>
        {{/if}}
      </div>

      <style scoped>
        .slider-field-edit {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp);
          width: 100%;
        }
        .slider-value {
          font-weight: 600;
          font-size: var(--boxel-font-sm);
          color: var(--primary, var(--boxel-purple));
          text-align: right;
          flex-shrink: 0;
        }
      </style>
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

    get percentage() {
      const numericValue = getNumericValue(this.args.model);
      return calculatePercentage(
        numericValue,
        this.config.min,
        this.config.max,
      );
    }

    get displayValue() {
      return getFormattedDisplayValue(this.args.model, this.config);
    }

    get fillStyle() {
      return htmlSafe(`width: ${this.percentage}%`);
    }

    <template>
      <span class='slider-atom' data-test-slider-atom>
        <span class='slider-mini-track'>
          <span class='slider-mini-fill' style={{this.fillStyle}}></span>
        </span>
        <span class='slider-value'>{{this.displayValue}}</span>
      </span>

      <style scoped>
        .slider-atom {
          display: inline-flex;
          align-items: center;
          gap: var(--boxel-sp-5xs, 0.25rem);
        }
        .slider-mini-track {
          position: relative;
          width: 2rem;
          height: 0.25rem;
          background: var(--border, var(--boxel-200, #e0e0e0));
          border-radius: var(--boxel-border-radius-xs, 0.125rem);
          overflow: hidden;
        }
        .slider-mini-fill {
          position: absolute;
          height: 100%;
          background: var(--primary, var(--boxel-purple, #6638ff));
          border-radius: var(--boxel-border-radius-xs, 0.125rem);
        }
        .slider-value {
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

    get percentage() {
      const numericValue = getNumericValue(this.args.model);
      return calculatePercentage(
        numericValue,
        this.config.min,
        this.config.max,
      );
    }

    get displayValue() {
      return getFormattedDisplayValue(this.args.model, this.config);
    }

    get fillStyle() {
      return htmlSafe(`width: ${this.percentage}%`);
    }

    get thumbStyle() {
      return htmlSafe(`left: ${this.percentage}%`);
    }

    get hasRange() {
      return (
        typeof this.config?.min === 'number' &&
        typeof this.config?.max === 'number'
      );
    }

    <template>
      <div class='slider-field-embedded'>
        <div class='slider-card-header'>
          <span class='slider-card-title'>Current value</span>
          <span class='slider-card-value'>{{this.displayValue}}</span>
        </div>
        <div class='slider-track'>
          <div class='slider-fill' style={{this.fillStyle}}></div>
          <div class='slider-thumb' style={{this.thumbStyle}}></div>
        </div>
        {{#if this.config.showValue}}
          <span class='slider-label'>{{this.displayValue}}</span>
        {{/if}}
        {{#if this.hasRange}}
          <div class='slider-range'>
            <span>Min {{this.config.min}}</span>
            <span>Max {{this.config.max}}</span>
          </div>
        {{/if}}
      </div>

      <style scoped>
        .slider-field-embedded {
          display: flex;
          flex-direction: column;
          gap: calc(var(--spacing, 0.25rem) * 2);
          width: 100%;
          padding: calc(var(--spacing, 0.25rem) * 3)
            calc(var(--spacing, 0.25rem) * 4);
          background: var(--card, #ffffff);
          border: 1px solid var(--border, #e2e8f0);
          border-radius: var(--radius, 0.75rem);
          box-shadow: var(--shadow, 0 1px 3px 0 rgb(0 0 0 / 0.1));
        }
        .slider-card-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: calc(var(--spacing, 0.25rem) * 3);
        }
        .slider-card-title {
          font-size: 0.75rem;
          font-weight: 600;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--muted-foreground, #64748b);
        }
        .slider-card-value {
          font-size: 1.5rem;
          font-weight: 700;
          color: var(--foreground, #0f172a);
        }
        .slider-track {
          position: relative;
          flex: 1;
          height: 0.75rem;
          background: var(--muted, #f1f5f9);
          border-radius: 999px;
          overflow: hidden;
          border: 1px solid var(--border, #e2e8f0);
        }
        .slider-fill {
          position: absolute;
          height: 100%;
          background: var(--primary, #3b82f6);
          border-radius: inherit;
          transition: width 0.3s ease;
        }
        .slider-thumb {
          position: absolute;
          top: 50%;
          transform: translate(-50%, -50%);
          width: 1.25rem;
          height: 1.25rem;
          background: var(--background, #ffffff);
          border: 2px solid var(--primary, #3b82f6);
          border-radius: 50%;
          box-shadow: var(--shadow-sm, 0 1px 2px 0 rgb(0 0 0 / 0.05));
          transition: left 0.3s ease;
        }
        .slider-label {
          align-self: flex-end;
          font-weight: 600;
          color: var(--primary, #3b82f6);
        }
        .slider-range {
          display: flex;
          justify-content: space-between;
          font-size: 0.75rem;
          color: var(--muted-foreground, #64748b);
        }
      </style>
    </template>
  };
}
