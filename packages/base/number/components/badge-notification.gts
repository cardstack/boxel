import GlimmerComponent from '@glimmer/component';
import { getFormattedDisplayValue, getNumericValue } from '../util/index';
import type IconComponent from '@cardstack/boxel-icons/captions';
import BellIcon from '@cardstack/boxel-icons/bell';

export interface BadgeNotificationOptions {
  decimals?: number;
  prefix?: string;
  suffix?: string;
  min?: number;
  max?: number;
  label?: string;
  placeholder?: string;
  icon?: typeof IconComponent;
}

interface BadgeNotificationConfiguration {
  presentation?: 'badge-notification';
  options?: BadgeNotificationOptions;
}

interface BadgeNotificationSignature {
  Args: {
    model: number | null;
    configuration?: BadgeNotificationConfiguration;
  };
}

export class BadgeNotificationAtom extends GlimmerComponent<BadgeNotificationSignature> {
  get options() {
    return this.args.configuration?.options ?? {};
  }

  get numericValue() {
    return getNumericValue(this.args.model) || 0;
  }

  get maxValue() {
    return this.options.max ?? 99;
  }

  get displayValue() {
    if (this.numericValue > this.maxValue) {
      return `${this.maxValue}+`;
    }
    return getFormattedDisplayValue(this.args.model, this.options);
  }

  get BadgeIcon() {
    return this.options?.icon ?? BellIcon;
  }

  <template>
    <span class='badge-notification-atom'>
      <this.BadgeIcon width='14' height='14' />
      <span class='badge-count'>{{this.displayValue}}</span>
    </span>

    <style scoped>
      .badge-notification-atom {
        display: inline-flex;
        align-items: center;
        gap: 0.25rem;
        min-width: 1.25rem;
        height: 1.25rem;
        padding: 0 0.375rem;
        background: var(--destructive, #ef4444);
        color: var(--destructive-foreground, #ffffff);
        border-radius: 999px;
        font-size: 0.6875rem;
        font-weight: 700;
        line-height: 1;
        box-shadow: 0 2px 4px rgba(239, 68, 68, 0.3);
      }
      .badge-notification-atom svg {
        flex-shrink: 0;
      }
      .badge-count {
        line-height: 1;
      }
    </style>
  </template>
}

export class BadgeNotificationEmbedded extends GlimmerComponent<BadgeNotificationSignature> {
  get options() {
    return this.args.configuration?.options ?? {};
  }

  get numericValue() {
    return getNumericValue(this.args.model) || 0;
  }

  get maxValue() {
    return this.options.max ?? 99;
  }

  get displayValue() {
    if (this.numericValue > this.maxValue) {
      return `${this.maxValue}+`;
    }
    return getFormattedDisplayValue(this.args.model, this.options);
  }

  get BadgeIcon() {
    return this.options?.icon ?? BellIcon;
  }

  get label() {
    return this.options?.label ?? 'Notifications';
  }

  <template>
    <div class='badge-notification-embedded'>
      <div class='badge-container'>
        <div class='icon-wrapper'>
          <this.BadgeIcon width='48' height='48' />
          <span class='notification-badge'>{{this.displayValue}}</span>
        </div>
      </div>
      <span class='badge-label'>{{this.label}}</span>
    </div>

    <style scoped>
      .badge-notification-embedded {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.75rem;
        padding: 1.25rem;
        border-radius: 0.75rem;
        background: var(--card, #ffffff);
        border: 1px solid var(--border, #e2e8f0);
      }
      .badge-container {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .icon-wrapper {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .icon-wrapper svg {
        color: var(--muted-foreground, #64748b);
      }
      .notification-badge {
        position: absolute;
        top: -0.5rem;
        right: -0.5rem;
        min-width: 1.75rem;
        height: 1.75rem;
        padding: 0 0.5rem;
        background: linear-gradient(
          135deg,
          var(--destructive, #ef4444) 0%,
          #dc2626 100%
        );
        color: var(--destructive-foreground, #ffffff);
        border-radius: 999px;
        font-size: 0.875rem;
        font-weight: 800;
        display: flex;
        align-items: center;
        justify-content: center;
        line-height: 1;
        border: 2px solid var(--background, #ffffff);
        box-shadow: 0 4px 6px rgba(239, 68, 68, 0.3);
        animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
      }
      @keyframes pulse {
        0%,
        100% {
          opacity: 1;
        }
        50% {
          opacity: 0.8;
          transform: scale(1.05);
        }
      }
      .badge-label {
        font-size: 0.875rem;
        font-weight: 600;
        color: var(--foreground, #0f172a);
      }
    </style>
  </template>
}
