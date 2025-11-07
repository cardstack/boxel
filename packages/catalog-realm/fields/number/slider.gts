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
  getNumericValue,
  calculatePercentage,
  getFormattedDisplayValue,
  type SliderConfig,
} from './util/index';

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
      <div class='slider-field-edit'>
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
          font-family: var(--font-mono, monospace);
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
      <span class='slider-atom'>
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
          font-family: var(
            --font-mono,
            var(--boxel-monospace-font-family, monospace)
          );
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
          gap: var(--boxel-sp-xs, 0.5rem);
          width: 100%;
          padding: var(--boxel-sp-sm, 0.75rem) var(--boxel-sp, 1rem);
          background: var(--boxel-light, #fff);
          border: 1px solid var(--boxel-200, #e8e8e8);
          border-radius: var(--boxel-border-radius-lg, 0.75rem);
          box-shadow: 0 6px 16px rgba(20, 17, 37, 0.08);
        }
        .slider-card-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--boxel-sp-sm, 0.75rem);
        }
        .slider-card-title {
          font-size: 0.75rem;
          font-weight: 600;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--boxel-450);
        }
        .slider-card-value {
          font-size: 1.5rem;
          font-weight: 700;
          font-family: var(--boxel-monospace-font-family, monospace);
          color: var(--boxel-700);
        }
        .slider-track {
          position: relative;
          flex: 1;
          height: 0.75rem;
          background: var(--boxel-100);
          border-radius: 999px;
          overflow: hidden;
          border: 1px solid var(--boxel-200);
        }
        .slider-fill {
          position: absolute;
          height: 100%;
          background: linear-gradient(
            90deg,
            var(--boxel-purple) 0%,
            var(--boxel-teal) 100%
          );
          border-radius: inherit;
          transition: width 0.3s ease;
        }
        .slider-thumb {
          position: absolute;
          top: 50%;
          transform: translate(-50%, -50%);
          width: 1.25rem;
          height: 1.25rem;
          background: var(--boxel-light);
          border: 2px solid var(--boxel-purple);
          border-radius: 50%;
          box-shadow: 0 4px 12px rgba(102, 56, 255, 0.25);
          transition: left 0.3s ease;
        }
        .slider-label {
          align-self: flex-end;
          font-weight: 600;
          color: var(--boxel-purple);
          font-family: var(--boxel-monospace-font-family, monospace);
        }
        .slider-range {
          display: flex;
          justify-content: space-between;
          font-size: 0.75rem;
          color: var(--boxel-500);
          font-family: var(--boxel-monospace-font-family, monospace);
        }
      </style>
    </template>
  };
}
