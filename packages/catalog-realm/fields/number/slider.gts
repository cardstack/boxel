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

    <template>
      <div class='slider-field-embedded'>
        <div class='slider-track'>
          <div class='slider-fill' style={{this.fillStyle}}></div>
          <div class='slider-thumb' style={{this.thumbStyle}}></div>
        </div>
        {{#if this.config.showValue}}
          <span class='slider-label'>{{this.displayValue}}</span>
        {{/if}}
      </div>

      <style scoped>
        .slider-field-embedded {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp);
          width: 100%;
        }
        .slider-track {
          position: relative;
          flex: 1;
          height: 0.5rem;
          background: var(--border, var(--boxel-border));
          border-radius: 0.25rem;
        }
        .slider-fill {
          position: absolute;
          height: 100%;
          background: var(--primary, var(--boxel-purple));
          border-radius: 0.25rem;
          transition: width 0.3s ease;
        }
        .slider-thumb {
          position: absolute;
          top: 50%;
          transform: translate(-50%, -50%);
          width: 1rem;
          height: 1rem;
          background: white;
          border: 2px solid var(--primary, var(--boxel-purple));
          border-radius: 50%;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
          transition: left 0.3s ease;
        }
        .slider-label {
          font-weight: 600;
          color: var(--primary, var(--boxel-purple));
          min-width: 3rem;
          text-align: right;
          font-family: var(--font-mono, monospace);
        }
      </style>
    </template>
  };
}
