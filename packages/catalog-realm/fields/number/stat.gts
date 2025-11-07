import { Component } from 'https://cardstack.com/base/card-api';
import NumberInput from './components/number-input';

import NumberField, {
  deserializeForUI,
  serializeForUI,
} from 'https://cardstack.com/base/number';
import { TextInputValidator } from 'https://cardstack.com/base/text-input-validator';
import { NumberSerializer } from '@cardstack/runtime-common';

import { hasValue, getFormattedDisplayValue } from './util/index';
import type { StatConfig } from './util/types';

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
          <div class='stat-range'>Min
            {{this.config.min}}
            · Max
            {{this.config.max}}</div>
        {{/if}}
      </div>

      <style scoped>
        .stat-field-embedded {
          display: flex;
          flex-direction: column;
          gap: calc(var(--spacing, 0.25rem) * 2.5);
          padding: calc(var(--spacing, 0.25rem) * 4);
          border-radius: var(--radius, 0.75rem);
          background: var(--card, #ffffff);
          border: 1px solid var(--border, #e2e8f0);
          box-shadow: var(--shadow-lg, 0 10px 15px -3px rgb(0 0 0 / 0.1));
        }
        .stat-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: calc(var(--spacing, 0.25rem) * 4);
        }
        .stat-chip {
          padding: calc(var(--spacing, 0.25rem) * 1)
            calc(var(--spacing, 0.25rem) * 3);
          border-radius: 999px;
          border: 1px solid var(--border, #e2e8f0);
          font-size: 0.75rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--muted-foreground, #64748b);
          background: var(--background, #ffffff);
        }
        .stat-icon-pill {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 2rem;
          height: 2rem;
          border-radius: 999px;
          background: var(--muted, #f1f5f9);
          color: var(--primary, #3b82f6);
        }
        .stat-range {
          font-size: 0.8125rem;
          color: var(--muted-foreground, #64748b);
        }
        .stat-value-row {
          display: flex;
          align-items: baseline;
          gap: calc(var(--spacing, 0.25rem) * 2);
        }
        .stat-value {
          font-size: 2.25rem;
          font-weight: 700;
          color: var(--foreground, #0f172a);
        }
        .stat-subtitle {
          font-size: 0.875rem;
          font-weight: 600;
          color: var(--accent, #10b981);
        }
      </style>
    </template>
  };
}
