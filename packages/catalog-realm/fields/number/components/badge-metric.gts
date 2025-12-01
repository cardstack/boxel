import GlimmerComponent from '@glimmer/component';
import { getFormattedDisplayValue } from '../util/index';
import type IconComponent from '@cardstack/boxel-icons/captions';

export interface BadgeMetricOptions {
  decimals?: number;
  prefix?: string;
  suffix?: string;
  min?: number;
  max?: number;
  label?: string;
  placeholder?: string;
  icon?: typeof IconComponent;
}

interface BadgeMetricConfiguration {
  presentation?: 'badge-metric';
  options?: BadgeMetricOptions;
}

interface BadgeMetricSignature {
  Args: {
    model: number | null;
    configuration?: BadgeMetricConfiguration;
  };
}

export class BadgeMetricAtom extends GlimmerComponent<BadgeMetricSignature> {
  get options() {
    return this.args.configuration?.options ?? {};
  }

  get displayValue() {
    return getFormattedDisplayValue(this.args.model, this.options);
  }

  get BadgeIcon() {
    return this.options.icon;
  }

  <template>
    <span class='badge-metric-atom'>
      {{#if this.BadgeIcon}}
        <this.BadgeIcon width='14' height='14' />
      {{/if}}
      <span class='value'>{{this.displayValue}}</span>
    </span>

    <style scoped>
      .badge-metric-atom {
        display: inline-flex;
        align-items: center;
        gap: 0.375rem;
        padding: 0.25rem 0.625rem;
        background: var(--muted, #f1f5f9);
        border-radius: 999px;
        border: 1px solid var(--border, #e2e8f0);
      }
      .badge-metric-atom svg {
        color: var(--muted-foreground, #64748b);
        flex-shrink: 0;
      }
      .value {
        font-size: 0.875rem;
        font-weight: 700;
        color: var(--foreground, #1a1a1a);
        line-height: 1;
      }
    </style>
  </template>
}

export class BadgeMetricEmbedded extends GlimmerComponent<BadgeMetricSignature> {
  get options() {
    return this.args.configuration?.options ?? {};
  }

  get displayValue() {
    return getFormattedDisplayValue(this.args.model, this.options);
  }

  get label() {
    return this.options.label ?? '';
  }

  get BadgeIcon() {
    return this.options.icon;
  }

  <template>
    <div class='badge-metric-embedded'>
      {{#if this.BadgeIcon}}
        <this.BadgeIcon width='20' height='20' />
      {{/if}}
      <span class='value'>{{this.displayValue}}</span>
      <span class='label'>{{this.label}}</span>
    </div>

    <style scoped>
      .badge-metric-embedded {
        display: flex;
        align-items: center;
        gap: calc(var(--spacing, 0.25rem) * 3);
        padding: calc(var(--spacing, 0.25rem) * 3)
          calc(var(--spacing, 0.25rem) * 4);
        background: var(--muted, #f1f5f9);
        border-radius: 999px;
        border: var(--border, var(--boxel-border));
      }
      .badge-metric-embedded svg {
        color: var(--muted-foreground, #64748b);
      }
      .value {
        font-size: 1rem;
        font-weight: 700;
        color: var(--foreground, #0f172a);
      }
      .label {
        margin-left: auto;
        font-size: 0.875rem;
        font-weight: 500;
        color: var(--muted-foreground, #64748b);
      }
    </style>
  </template>
}
