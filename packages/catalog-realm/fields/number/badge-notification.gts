import { Component } from 'https://cardstack.com/base/card-api';
import NumberInput from './components/number-input';

import NumberField, {
  deserializeForUI,
  serializeForUI,
} from 'https://cardstack.com/base/number';
import { TextInputValidator } from 'https://cardstack.com/base/text-input-validator';
import { NumberSerializer } from '@cardstack/runtime-common';

import type { BadgeNotificationConfig } from './util/types';

interface Configuration {
  presentation: BadgeNotificationConfig;
}

class NotificationAtom extends Component<typeof BadgeNotificationField> {
  get config() {
    return this.args.configuration?.presentation;
  }

  get numericValue() {
    return this.args.model ?? 0;
  }

  get displayValue() {
    return this.numericValue > 9 ? '9+' : String(this.numericValue);
  }

  get BadgeIcon() {
    return this.config.icon;
  }

  <template>
    <span class='badge-notification-atom'>
      {{#if this.BadgeIcon}}
        <span class='icon-wrapper'>
          <this.BadgeIcon width='16' height='16' />
          <span class='notification-badge'>{{this.displayValue}}</span>
        </span>
      {{/if}}
    </span>

    <style scoped>
      .badge-notification-atom {
        display: inline-flex;
        align-items: center;
      }
      .icon-wrapper {
        position: relative;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      .icon-wrapper svg {
        color: var(--muted-foreground, #64748b);
      }
      .notification-badge {
        position: absolute;
        top: -0.2rem;
        right: -0.5rem;
        min-width: 0.875rem;
        height: 0.875rem;
        padding: 0 calc(var(--spacing, 0.25rem) * 0.75);
        background: var(--destructive, #ef4444);
        color: var(--destructive-foreground, #ffffff);
        border-radius: 999px;
        font-size: 0.5625rem;
        font-weight: 700;
        display: flex;
        align-items: center;
        justify-content: center;
        line-height: 1;
        border: 1px solid var(--background, #ffffff);
      }
    </style>
  </template>
}

class NotificationEmbedded extends Component<typeof BadgeNotificationField> {
  get config() {
    return this.args.configuration?.presentation;
  }

  get numericValue() {
    return this.args.model ?? 0;
  }

  get displayValue() {
    return this.numericValue > 9 ? '9+' : String(this.numericValue);
  }

  get BadgeIcon() {
    return this.config.icon;
  }

  get label() {
    return this.config.label ?? '';
  }

  <template>
    <div class='badge-notification-embedded'>
      {{#if this.BadgeIcon}}
        <div class='icon-container'>
          <this.BadgeIcon width='40' height='40' />
          <span class='notification-badge-large'>{{this.displayValue}}</span>
        </div>
        <span class='label'>{{this.label}}</span>
      {{/if}}
    </div>

    <style scoped>
      .badge-notification-embedded {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: calc(var(--spacing, 0.25rem) * 2);
      }
      .icon-container {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .icon-container svg {
        color: var(--muted-foreground, #64748b);
      }
      .notification-badge-large {
        position: absolute;
        top: -0.375rem;
        right: -0.375rem;
        min-width: 1.5rem;
        height: 1.5rem;
        padding: 0 calc(var(--spacing, 0.25rem) * 1.5);
        background: var(--destructive, #ef4444);
        color: var(--destructive-foreground, #ffffff);
        border-radius: 999px;
        font-size: 0.75rem;
        font-weight: 700;
        display: flex;
        align-items: center;
        justify-content: center;
        line-height: 1;
        border: 2px solid var(--background, #ffffff);
      }
      .label {
        font-size: 0.875rem;
        font-weight: 500;
        color: var(--muted-foreground, #64748b);
      }
    </style>
  </template>
}

export default class BadgeNotificationField extends NumberField {
  static displayName = 'Badge Notification Field';

  static configuration: Configuration = {
    presentation: {
      type: 'badge-notification',
      label: '',
      decimals: 0,
      min: 0,
      max: 99,
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

  static atom = NotificationAtom;
  static embedded = NotificationEmbedded;
}
