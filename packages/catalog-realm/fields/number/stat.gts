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
  getFormattedDisplayValue,
  clamp,
  type StatConfig,
} from './util/index';

interface Configuration {
  presentation: StatConfig;
}

export default class StatField extends NumberField {
  static displayName = 'Stat Number Field';

  static configuration: Configuration = {
    presentation: {
      type: 'stat',
      prefix: '',
      suffix: '',
      decimals: 0,
      min: 0,
      max: 100,
    },
  };

  static edit = class Edit extends Component<typeof this> {
    get config() {
      return this.args.configuration?.presentation;
    }
    get inputValue() {
      // Return null for empty input, otherwise the numeric value
      return hasValue(this.args.model) ? this.args.model : null;
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

    <template>
      <BoxelInput
        @type='number'
        @value={{this.inputValue}}
        @onInput={{this.handleInputChange}}
        min={{this.config.min}}
        max={{this.config.max}}
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
      <span class='stat-field-atom'>
        <span class='stat-indicator'></span>
        <span class='stat-text'>{{this.displayValue}}</span>
      </span>

      <style scoped>
        .stat-field-atom {
          display: inline-flex;
          align-items: center;
          gap: var(--boxel-sp-5xs, 0.25rem);
          padding: calc(var(--boxel-sp-6xs, 0.125rem) * 1.5)
            var(--boxel-sp-xs, 0.5rem);
          background: var(--primary, var(--boxel-purple, #6638ff));
          color: var(--primary-foreground, var(--boxel-light, #ffffff));
          border-radius: var(
            --radius,
            var(--boxel-border-radius-xl, 0.9375rem)
          );
          font-size: var(--boxel-font-size-xs, 0.6875rem);
          font-weight: var(--boxel-font-weight-semibold, 600);
          font-family: var(
            --font-mono,
            var(--boxel-monospace-font-family, monospace)
          );
          line-height: 1;
        }
        .stat-indicator {
          width: 0.375rem;
          height: 0.375rem;
          border-radius: 50%;
          background: var(--primary-foreground, var(--boxel-light, #ffffff));
          opacity: 0.8;
          flex-shrink: 0;
        }
        .stat-text {
          display: flex;
          align-items: center;
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    get config() {
      return this.args.configuration?.presentation;
    }

    get hasValue() {
      return hasValue(this.args.model);
    }

    get displayValue() {
      return getFormattedDisplayValue(this.args.model, this.config);
    }

    get valueText() {
      if (this.hasValue) {
        return this.displayValue;
      }
      return this.config.placeholder ?? '—';
    }

    get labelText() {
      return this.config.label ?? 'Key metric';
    }

    get StatIcon() {
      return this.config.icon;
    }

    get hasRange() {
      return (
        typeof this.config.min === 'number' &&
        typeof this.config.max === 'number'
      );
    }

    <template>
      <div class='stat-field-embedded'>
        <div class='stat-header'>
          <span class='stat-chip'>{{this.labelText}}</span>
          {{#if this.StatIcon}}
            <div class='stat-icon-pill'>
              <this.StatIcon width='18' height='18' />
            </div>
          {{/if}}
        </div>
        <div class='stat-value-row'>
          <span class='stat-value'>{{this.valueText}}</span>
        </div>
        {{#if this.config.subtitle}}
          <div class='stat-subtitle'>{{this.config.subtitle}}</div>
        {{/if}}
        {{#if this.hasRange}}
          <div class='stat-range'>Min {{this.config.min}} · Max {{this.config.max}}</div>
        {{/if}}
      </div>

      <style scoped>
        .stat-field-embedded {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-xxs, 0.65rem);
          padding: var(--boxel-sp, 1rem);
          border-radius: var(--boxel-border-radius-lg, 0.75rem);
          background: var(
            --stat-card-bg,
            linear-gradient(
              135deg,
              color-mix(in srgb, var(--boxel-light, #ffffff) 95%, transparent),
              color-mix(in srgb, var(--boxel-purple, #6638ff) 15%, var(--boxel-light, #ffffff) 85%)
            )
          );
          color: var(--stat-card-color, var(--boxel-700, #272330));
          border: 1px solid
            var(
              --stat-card-border,
              color-mix(in srgb, var(--boxel-blue, #0069f9) 15%, transparent)
            );
          box-shadow: 0 10px 24px
            color-mix(in srgb, var(--boxel-700, #272330) 15%, transparent);
        }
        .stat-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: var(--boxel-sp, 1rem);
        }
        .stat-chip {
          padding: 0.25rem 0.75rem;
          border-radius: 999px;
          border: 1px solid
            var(
              --stat-chip-border,
              color-mix(in srgb, var(--boxel-blue, #0069f9) 30%, transparent)
            );
          font-size: 0.75rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--boxel-500);
          background: var(
            --stat-chip-bg,
            color-mix(in srgb, var(--boxel-light, #ffffff) 90%, transparent)
          );
        }
        .stat-icon-pill {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 2rem;
          height: 2rem;
          border-radius: 999px;
          background: var(
            --stat-icon-bg,
            color-mix(in srgb, var(--boxel-blue, #0069f9) 12%, transparent)
          );
          color: var(--stat-icon-color, var(--boxel-blue, #0069f9));
        }
        .stat-range {
          font-size: 0.8125rem;
          color: var(--boxel-500);
        }
        .stat-value-row {
          display: flex;
          align-items: baseline;
          gap: 0.5rem;
        }
        .stat-value {
          font-size: 2.25rem;
          font-weight: 700;
          font-family: var(--boxel-monospace-font-family, monospace);
          color: var(--boxel-700);
        }
        .stat-subtitle {
          font-size: 0.875rem;
          font-weight: 600;
          color: var(--boxel-green, #37eb77);
        }
      </style>
    </template>
  };
}
