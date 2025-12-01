import GlimmerComponent from '@glimmer/component';
import { getFormattedDisplayValue } from '../util/index';
import type IconComponent from '@cardstack/boxel-icons/captions';

export interface BadgeCounterOptions {
  decimals?: number;
  prefix?: string;
  suffix?: string;
  min?: number;
  max?: number;
  label?: string;
  placeholder?: string;
  icon?: typeof IconComponent;
}

interface BadgeCounterConfiguration {
  presentation?: 'badge-counter';
  options?: BadgeCounterOptions;
}

interface BadgeCounterSignature {
  Args: {
    model: number | null;
    configuration?: BadgeCounterConfiguration;
  };
}

export class BadgeCounterAtom extends GlimmerComponent<BadgeCounterSignature> {
  get options() {
    return this.args.configuration?.options ?? {};
  }

  get displayValue() {
    return getFormattedDisplayValue(this.args.model, this.options);
  }

  <template>
    <span class='badge-counter-atom'>
      <span class='value'>{{this.displayValue}}</span>
    </span>

    <style scoped>
      .badge-counter-atom {
        display: inline-flex;
        align-items: center;
        padding: 0.25rem 0.625rem;
        background: var(--primary, #3b82f6);
        color: var(--primary-foreground, #ffffff);
        border-radius: 999px;
      }
      .value {
        font-size: 0.875rem;
        font-weight: 700;
        line-height: 1;
      }
    </style>
  </template>
}

export class BadgeCounterEmbedded extends GlimmerComponent<BadgeCounterSignature> {
  get options() {
    return this.args.configuration?.options ?? {};
  }

  get displayValue() {
    return getFormattedDisplayValue(this.args.model, this.options);
  }

  get label() {
    return this.options.label ?? '';
  }

  <template>
    <div class='badge-counter-embedded'>
      <span class='label'>{{this.label}}</span>
      <span class='value'>{{this.displayValue}}</span>
    </div>

    <style scoped>
      .badge-counter-embedded {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
        padding: 0.75rem 1rem;
        background: var(--primary, #3b82f6);
        color: var(--primary-foreground, #ffffff);
        border-radius: var(--radius, 0.75rem);
        box-shadow: 0 2px 4px rgba(59, 130, 246, 0.2);
      }
      .label {
        font-size: 0.75rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        opacity: 0.75;
      }
      .value {
        font-size: 1.25rem;
        font-weight: 700;
      }
    </style>
  </template>
}
