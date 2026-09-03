import GlimmerComponent from '@glimmer/component';
import { hasValue, getFormattedDisplayValue } from '../util/index';
import type IconComponent from '@cardstack/boxel-icons/captions';

export interface StatOptions {
  decimals?: number;
  prefix?: string;
  suffix?: string;
  min?: number;
  max?: number;
  label?: string;
  placeholder?: string;
  subtitle?: string;
  icon?: typeof IconComponent;
}

interface StatConfiguration {
  presentation?: 'stat';
  options?: StatOptions;
}

interface StatSignature {
  Args: {
    model: number | null;
    configuration?: StatConfiguration;
  };
}

export class StatAtom extends GlimmerComponent<StatSignature> {
  get options() {
    return this.args.configuration?.options ?? {};
  }

  get displayValue() {
    return getFormattedDisplayValue(this.args.model, this.options);
  }

  get StatIcon() {
    return this.options.icon;
  }

  <template>
    <span class='stat-field-atom'>
      {{#if this.StatIcon}}
        <div class='stat-icon-pill'>
          <this.StatIcon width='14' height='14' />
        </div>
      {{/if}}
      <span class='stat-value'>{{this.displayValue}}</span>
    </span>

    <style scoped>
      .stat-field-atom {
        display: inline-flex;
        align-items: center;
        gap: 0.375rem;
        padding: 0.25rem 0.625rem;
        background: var(--muted);
        border-radius: 999px;
        border: 1px solid var(--border);
      }
      .stat-icon-pill {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 1.25rem;
        height: 1.25rem;
        border-radius: 0.375rem;
        background: var(--primary);
        color: var(--primary-foreground);
        flex-shrink: 0;
      }
      .stat-value {
        font-size: 0.875rem;
        font-weight: 700;
        color: var(--foreground);
        line-height: 1;
      }
    </style>
  </template>
}

export class StatEmbedded extends GlimmerComponent<StatSignature> {
  get options() {
    return this.args.configuration?.options ?? {};
  }

  get hasValue() {
    return hasValue(this.args.model);
  }

  get displayValue() {
    return getFormattedDisplayValue(this.args.model, this.options);
  }

  get valueText() {
    if (this.hasValue) {
      return this.displayValue;
    }
    return this.options.placeholder ?? '—';
  }

  get labelText() {
    return this.options.label ?? 'Key metric';
  }

  get StatIcon() {
    return this.options.icon;
  }

  get hasRange() {
    const min = this.options.min;
    const max = this.options.max;
    return typeof min === 'number' && typeof max === 'number';
  }

  <template>
    <div class='stat-field-embedded'>
      <div class='stat-header'>
        <span class='stat-label'>{{this.labelText}}</span>
        {{#if this.StatIcon}}
          <div class='stat-icon-container'>
            <this.StatIcon width='20' height='20' />
          </div>
        {{/if}}
      </div>
      <div class='stat-main'>
        <span class='stat-value'>{{this.valueText}}</span>
        {{#if this.options.subtitle}}
          <div class='stat-subtitle'>{{this.options.subtitle}}</div>
        {{/if}}
      </div>
      {{#if this.hasRange}}
        <div class='stat-footer'>
          <span class='stat-range-label'>Range:</span>
          <span class='stat-range-value'>{{this.options.min}}
            -
            {{this.options.max}}</span>
        </div>
      {{/if}}
    </div>

    <style scoped>
      .stat-field-embedded {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        padding: 1.25rem;
        border-radius: 0.75rem;
        background: linear-gradient(135deg, var(--card) 0%, var(--muted) 100%);
        border: 1px solid var(--border);
        box-shadow:
          0 4px 6px -1px rgb(0 0 0 / 0.05),
          0 2px 4px -1px rgb(0 0 0 / 0.03);
        transition: all 0.2s ease;
      }
      .stat-field-embedded:hover {
        box-shadow:
          0 10px 15px -3px rgb(0 0 0 / 0.1),
          0 4px 6px -2px rgb(0 0 0 / 0.05);
        border-color: var(--ring);
      }
      .stat-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
      }
      .stat-label {
        font-size: 0.875rem;
        font-weight: 600;
        letter-spacing: 0.025em;
        text-transform: uppercase;
        color: var(--muted-foreground);
      }
      .stat-icon-container {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 2.25rem;
        height: 2.25rem;
        border-radius: 0.5rem;
        background: var(--primary);
        color: var(--primary-foreground);
        box-shadow: 0 2px 4px rgba(59, 130, 246, 0.2);
      }
      .stat-main {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
      }
      .stat-value {
        font-size: 2.5rem;
        font-weight: 800;
        line-height: 1;
        color: var(--foreground);
        letter-spacing: -0.025em;
      }
      .stat-subtitle {
        font-size: 0.875rem;
        font-weight: 600;
        color: var(--success);
        display: flex;
        align-items: center;
        gap: 0.25rem;
      }
      .stat-footer {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding-top: 0.5rem;
        border-top: 1px solid var(--border);
      }
      .stat-range-label {
        font-size: 0.75rem;
        font-weight: 600;
        color: var(--muted-foreground);
      }
      .stat-range-value {
        font-size: 0.75rem;
        font-weight: 500;
        color: var(--foreground);
      }
    </style>
  </template>
}
