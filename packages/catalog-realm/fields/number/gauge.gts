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
  getNumericValue,
  calculatePercentage,
  getFormattedDisplayValue,
  clamp,
  type GaugeConfig,
} from './util/index';

export default class GaugeField extends NumberField {
  static displayName = 'Gauge Number Field';

  static configuration = {
    presentation: {
      type: 'gauge',
      min: 0,
      max: 100,
      decimals: 0,
      showValue: true,
      suffix: '',
      prefix: '',
      label: '',
    },
  };

  static edit = class Edit extends Component<typeof this> {
    get config(): GaugeConfig {
      return this.args.configuration?.presentation as GaugeConfig;
    }

    get inputValue() {
      return hasValue(this.args.model) ? this.args.model : null;
    }

    get displayValue() {
      return getFormattedDisplayValue(this.args.model, this.config);
    }

    get stepValue() {
      return this.config.decimals === 0 ? '1' : '0.1';
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

    textInputValidator: TextInputValidator<number> = new TextInputValidator(
      () => this.args.model,
      (inputVal) => this.args.set(inputVal),
      deserializeForUI,
      serializeForUI,
      NumberSerializer.validate,
    );

    <template>
      <div class='gauge-field-edit'>
        <BoxelInput
          @type='number'
          @value={{this.inputValue}}
          @onInput={{this.handleInputChange}}
          min={{this.config.min}}
          max={{this.config.max}}
          step={{this.stepValue}}
        />
        {{#if this.config.showValue}}
          <span class='gauge-value-display'>{{this.displayValue}}</span>
        {{/if}}
      </div>

      <style scoped>
        .gauge-field-edit {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xs, 0.5rem);
        }
        .gauge-value-display {
          font-family: var(
            --font-mono,
            var(--boxel-monospace-font-family, monospace)
          );
          font-weight: var(--boxel-font-weight-semibold, 600);
          font-size: var(--boxel-font-size-sm, 0.875rem);
          color: var(--primary, var(--boxel-purple, #6638ff));
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    get config(): GaugeConfig {
      return this.args.configuration?.presentation as GaugeConfig;
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

    get gaugeColor() {
      const numericValue = getNumericValue(this.args.model);
      const dangerThreshold = this.config.dangerThreshold;
      const warningThreshold = this.config.warningThreshold;

      if (dangerThreshold !== undefined && numericValue >= dangerThreshold) {
        return 'var(--destructive, var(--boxel-red, #ff5050))';
      }
      if (warningThreshold !== undefined && numericValue >= warningThreshold) {
        return 'var(--warning, var(--boxel-orange, #ff9800))';
      }
      return 'var(--primary, var(--boxel-purple, #6638ff))';
    }

    // Calculate the rotation angle for the gauge needle (0-180 degrees)
    get needleRotation() {
      const percentage = this.percentage;
      // Map 0-100% to 0-180 degrees
      return (percentage / 100) * 180;
    }

    get needleStyle() {
      return htmlSafe(`transform: rotate(${this.needleRotation}deg)`);
    }

    // SVG arc calculations for the atom view
    get arcDashArray() {
      return 125.66; // Circumference of the arc (π * radius * 180/180)
    }

    get arcDashOffset() {
      // Calculate the offset based on percentage
      return this.arcDashArray - (this.percentage * this.arcDashArray) / 100;
    }

    <template>
      <span class='gauge-atom'>
        <svg
          class='gauge-svg'
          viewBox='0 0 100 60'
          xmlns='http://www.w3.org/2000/svg'
        >
          {{! Background arc }}
          <path
            d='M 10 50 A 40 40 0 0 1 90 50'
            fill='none'
            stroke='var(--border, var(--boxel-200, #e0e0e0))'
            stroke-width='8'
            stroke-linecap='round'
          />
          {{! Value arc }}
          <path
            d='M 10 50 A 40 40 0 0 1 90 50'
            fill='none'
            stroke={{this.gaugeColor}}
            stroke-width='8'
            stroke-linecap='round'
            stroke-dasharray={{this.arcDashArray}}
            stroke-dashoffset={{this.arcDashOffset}}
            style='transition: stroke-dashoffset 0.3s ease, stroke 0.3s ease;'
          />
          {{! Center dot }}
          <circle
            cx='50'
            cy='50'
            r='3'
            fill='var(--foreground, var(--boxel-dark, #1a1a1a))'
          />
          {{! Needle }}
          <line
            x1='50'
            y1='50'
            x2='50'
            y2='20'
            stroke='var(--foreground, var(--boxel-dark, #1a1a1a))'
            stroke-width='2'
            stroke-linecap='round'
            style={{this.needleStyle}}
            transform-origin='50 50'
          />
        </svg>
        <span class='gauge-value'>{{this.displayValue}}</span>
      </span>

      <style scoped>
        .gauge-atom {
          display: inline-flex;
          flex-direction: column;
          align-items: center;
          gap: var(--boxel-sp-6xs, 0.125rem);
        }
        .gauge-svg {
          width: 3rem;
          height: 1.875rem;
        }
        .gauge-value {
          font-family: var(
            --font-mono,
            var(--boxel-monospace-font-family, monospace)
          );
          font-size: var(--boxel-font-size-xs, 0.6875rem);
          font-weight: var(--boxel-font-weight-bold, 700);
          color: var(--foreground, var(--boxel-dark, #1a1a1a));
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    get config(): GaugeConfig {
      return this.args.configuration?.presentation as GaugeConfig;
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

    get gaugeColor() {
      const numericValue = getNumericValue(this.args.model);
      const dangerThreshold = this.config.dangerThreshold;
      const warningThreshold = this.config.warningThreshold;

      if (dangerThreshold !== undefined && numericValue >= dangerThreshold) {
        return 'var(--destructive, var(--boxel-red, #ff5050))';
      }
      if (warningThreshold !== undefined && numericValue >= warningThreshold) {
        return 'var(--warning, var(--boxel-orange, #ff9800))';
      }
      return 'var(--primary, var(--boxel-purple, #6638ff))';
    }

    get needleRotation() {
      const percentage = this.percentage;
      return (percentage / 100) * 180;
    }

    get needleStyle() {
      return htmlSafe(`transform: rotate(${this.needleRotation}deg)`);
    }

    // SVG arc calculations for the embedded view
    get arcDashArray() {
      return 251.32; // Circumference of the arc for the larger gauge
    }

    get arcDashOffset() {
      // Calculate the offset based on percentage
      return this.arcDashArray - (this.percentage * this.arcDashArray) / 100;
    }

    <template>
      <div class='gauge-field-embedded'>
        {{#if this.config.label}}
          <div class='gauge-label'>{{this.config.label}}</div>
        {{/if}}
        <div class='gauge-container'>
          <svg
            class='gauge-svg-large'
            viewBox='0 0 200 120'
            xmlns='http://www.w3.org/2000/svg'
          >
            {{! Background arc }}
            <path
              d='M 20 100 A 80 80 0 0 1 180 100'
              fill='none'
              stroke='var(--border, var(--boxel-border, #e0e0e0))'
              stroke-width='16'
              stroke-linecap='round'
            />
            {{! Value arc }}
            <path
              d='M 20 100 A 80 80 0 0 1 180 100'
              fill='none'
              stroke={{this.gaugeColor}}
              stroke-width='16'
              stroke-linecap='round'
              stroke-dasharray={{this.arcDashArray}}
              stroke-dashoffset={{this.arcDashOffset}}
              style='transition: stroke-dashoffset 0.4s ease, stroke 0.3s ease;'
            />
            {{! Min label }}
            <text
              x='20'
              y='115'
              text-anchor='start'
              font-size='10'
              fill='var(--muted-foreground, var(--boxel-450, #666))'
            >
              {{this.config.min}}
            </text>
            {{! Max label }}
            <text
              x='180'
              y='115'
              text-anchor='end'
              font-size='10'
              fill='var(--muted-foreground, var(--boxel-450, #666))'
            >
              {{this.config.max}}
            </text>
            {{! Center dot }}
            <circle
              cx='100'
              cy='100'
              r='6'
              fill='var(--foreground, var(--boxel-dark, #1a1a1a))'
            />
            {{! Needle }}
            <line
              x1='100'
              y1='100'
              x2='100'
              y2='40'
              stroke='var(--foreground, var(--boxel-dark, #1a1a1a))'
              stroke-width='3'
              stroke-linecap='round'
              style={{this.needleStyle}}
              transform-origin='100 100'
            />
          </svg>
          {{#if this.config.showValue}}
            <div class='gauge-value-large'>{{this.displayValue}}</div>
          {{/if}}
        </div>
      </div>

      <style scoped>
        .gauge-field-embedded {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: var(--boxel-sp-xs, 0.5rem);
          padding: var(--boxel-sp, 1rem);
          background: var(--card, var(--boxel-light, #fff));
          border: 1px solid var(--border, var(--boxel-200, #e0e0e0));
          border-radius: var(--radius, var(--boxel-border-radius, 0.25rem));
        }
        .gauge-label {
          font-size: var(--boxel-font-size, 1rem);
          font-weight: var(--boxel-font-weight-semibold, 600);
          color: var(--foreground, var(--boxel-dark, #000));
        }
        .gauge-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: var(--boxel-sp-xs, 0.5rem);
          width: 100%;
        }
        .gauge-svg-large {
          width: 100%;
          max-width: 12rem;
          height: auto;
        }
        .gauge-value-large {
          font-family: var(
            --font-mono,
            var(--boxel-monospace-font-family, monospace)
          );
          font-size: var(--boxel-font-size-xl, 1.5rem);
          font-weight: var(--boxel-font-weight-bold, 700);
          color: var(--foreground, var(--boxel-dark, #000));
        }
      </style>
    </template>
  };
}
