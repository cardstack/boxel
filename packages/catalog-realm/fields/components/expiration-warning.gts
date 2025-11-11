import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

interface ExpirationConfiguration {
  expirationOptions?: {
    itemName?: string;
  };
}

interface ExpirationSignature {
  Args: {
    model?: any;
    config?: ExpirationConfiguration;
  };
}

export class ExpirationWarning extends GlimmerComponent<ExpirationSignature> {
  @tracked currentTime = Date.now();
  private intervalId: number | null = null;

  constructor(owner: any, args: any) {
    super(owner, args);
    this.intervalId = window.setInterval(() => {
      this.currentTime = Date.now();
    }, 60000); // Update every minute
  }

  willDestroy() {
    super.willDestroy();
    if (this.intervalId) {
      window.clearInterval(this.intervalId);
    }
  }

  get config(): ExpirationConfiguration | undefined {
    return this.args.config as ExpirationConfiguration | undefined;
  }

  get expirationDate() {
    return this.args.model?.value ?? this.args.model;
  }

  get itemName() {
    return this.config?.expirationOptions?.itemName || 'Your access';
  }

  get timeUntilExpiration() {
    if (!this.expirationDate) return null;

    const expirationTime = new Date(this.expirationDate).getTime();
    const remaining = expirationTime - this.currentTime;

    if (remaining <= 0) return { expired: true, text: 'Expired' };

    const hours = Math.floor(remaining / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));

    if (days > 0) {
      return {
        expired: false,
        text: `${days} day${days > 1 ? 's' : ''} ${remainingHours} hour${
          remainingHours > 1 ? 's' : ''
        }`,
      };
    }
    if (hours > 0) {
      return {
        expired: false,
        text: `${hours} hour${hours > 1 ? 's' : ''} ${minutes} minute${
          minutes > 1 ? 's' : ''
        }`,
      };
    }
    return {
      expired: false,
      text: `${minutes} minute${minutes > 1 ? 's' : ''}`,
    };
  }

  get severity() {
    if (!this.expirationDate) return 'info';

    const expirationTime = new Date(this.expirationDate).getTime();
    const remaining = expirationTime - this.currentTime;
    const hours = remaining / (1000 * 60 * 60);

    if (remaining <= 0) return 'expired';
    if (hours < 24) return 'critical';
    if (hours < 72) return 'warning';
    return 'info';
  }

  <template>
    <div
      class='expiration-warning {{this.severity}}'
      data-test-expiration-warning
    >
      <div class='warning-icon'>
        <svg
          class='icon'
          viewBox='0 0 24 24'
          fill='none'
          stroke='currentColor'
          stroke-width='2'
        >
          <circle cx='12' cy='12' r='10'></circle>
          <line x1='12' y1='8' x2='12' y2='12'></line>
          <line x1='12' y1='16' x2='12.01' y2='16'></line>
        </svg>
      </div>
      <div class='warning-content'>
        <div class='warning-title'>
          {{#if this.timeUntilExpiration.expired}}
            Expired
          {{else}}
            Expires Soon
          {{/if}}
        </div>
        <div class='warning-message'>
          {{this.itemName}}
          {{#if this.timeUntilExpiration.expired}}
            has expired
          {{else}}
            expires in
            <strong>{{this.timeUntilExpiration.text}}</strong>
          {{/if}}
        </div>
        {{#unless this.timeUntilExpiration.expired}}
          <button type='button' class='renew-button'>
            Renew Now →
          </button>
        {{/unless}}
      </div>
    </div>

    <style scoped>
      .expiration-warning {
        display: flex;
        align-items: flex-start;
        gap: 0.75rem;
        padding: 1rem;
        border-radius: var(--radius, 0.5rem);
        border-left: 4px solid;
      }

      .expiration-warning.info {
        background: rgba(59, 130, 246, 0.1);
        border-left-color: var(--primary, #3b82f6);
      }

      .expiration-warning.warning {
        background: rgba(251, 146, 60, 0.1);
        border-left-color: var(--chart3, #fb923c);
      }

      .expiration-warning.critical {
        background: rgba(239, 68, 68, 0.1);
        border-left-color: var(--destructive, #ef4444);
      }

      .expiration-warning.expired {
        background: rgba(107, 114, 128, 0.1);
        border-left-color: var(--muted-foreground, #6b7280);
      }

      .warning-icon {
        flex-shrink: 0;
        width: 1.25rem;
        height: 1.25rem;
        margin-top: 0.125rem;
      }

      .icon {
        width: 100%;
        height: 100%;
      }

      .expiration-warning.info .icon {
        color: var(--primary, #3b82f6);
      }

      .expiration-warning.warning .icon {
        color: var(--chart3, #fb923c);
      }

      .expiration-warning.critical .icon,
      .expiration-warning.expired .icon {
        color: var(--destructive, #ef4444);
      }

      .warning-content {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .warning-title {
        font-weight: 600;
        font-size: 0.875rem;
      }

      .expiration-warning.info .warning-title {
        color: var(--primary, #3b82f6);
      }

      .expiration-warning.warning .warning-title {
        color: var(--chart3, #fb923c);
      }

      .expiration-warning.critical .warning-title,
      .expiration-warning.expired .warning-title {
        color: var(--destructive, #ef4444);
      }

      .warning-message {
        font-size: 0.8125rem;
        color: var(--foreground, #1a1a1a);
      }

      .renew-button {
        align-self: flex-start;
        padding: 0.25rem 0;
        background: none;
        border: none;
        font-size: 0.8125rem;
        font-weight: 500;
        cursor: pointer;
        transition: opacity 0.15s ease;
      }

      .expiration-warning.info .renew-button {
        color: var(--primary, #3b82f6);
      }

      .expiration-warning.warning .renew-button {
        color: var(--chart3, #fb923c);
      }

      .expiration-warning.critical .renew-button {
        color: var(--destructive, #ef4444);
      }

      .renew-button:hover {
        opacity: 0.8;
      }
    </style>
  </template>
}
