import { Component } from 'https://cardstack.com/base/card-api';
import NumberInput from './components/number-input';

import NumberField, {
  deserializeForUI,
  serializeForUI,
} from 'https://cardstack.com/base/number';
import { TextInputValidator } from 'https://cardstack.com/base/text-input-validator';
import { NumberSerializer } from '@cardstack/runtime-common';

import { hasValue, getFormattedDisplayValue } from './util/index';
import type { BadgeConfig } from './util/types/index';

interface Configuration {
  presentation: BadgeConfig;
}

class View extends Component<typeof BadgeField> {
  get config() {
    return this.args.configuration?.presentation;
  }

  get displayValue() {
    return getFormattedDisplayValue(this.args.model, this.config);
  }

  get valueText() {
    if (hasValue(this.args.model)) {
      return this.displayValue;
    }
    return this.config.placeholder ?? '—';
  }

  get label() {
    return this.config.label ?? '';
  }

  get BadgeIcon() {
    return this.config.icon;
  }

  <template>
    <div class='badge-leading'>
      {{#if this.BadgeIcon}}
        <div class='badge-icon-wrapper'>
          <this.BadgeIcon width='28' height='28' />
          <span class='badge-icon-dot'>{{this.valueText}}</span>
        </div>
      {{else}}
        <div class='badge-counter'>
          <span class='badge-counter-label'>{{this.label}}</span>
          <span class='badge-counter-value'>{{this.valueText}}</span>
        </div>
      {{/if}}
    </div>

    <style scoped>
      .badge-leading {
        display: flex;
        align-items: center;
        gap: calc(var(--spacing, 0.25rem) * 3);
      }
      .badge-icon-wrapper {
        position: relative;
        width: 2.5rem;
        height: 2.5rem;
        border-radius: var(--radius, 0.5rem);
        background: var(--muted, #f1f5f9);
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--muted-foreground, #64748b);
      }
      .badge-icon-dot {
        position: absolute;
        top: -0.3rem;
        right: -0.3rem;
        min-width: 1.2rem;
        min-height: 1.2rem;
        padding: 0 calc(var(--spacing, 0.25rem) * 1);
        border-radius: 999px;
        background: var(--destructive, #ef4444);
        color: var(--destructive-foreground, #ffffff);
        font-size: 0.6875rem;
        font-weight: 700;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 2px solid var(--background, #ffffff);
      }
      .badge-counter {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: calc(var(--spacing, 0.25rem) * 3);
        padding: calc(var(--spacing, 0.25rem) * 2.5)
          calc(var(--spacing, 0.25rem) * 3.5);
        border-radius: var(--radius, 0.5rem);
        background: var(--primary, #3b82f6);
        color: var(--primary-foreground, #ffffff);
      }
      .badge-counter-label {
        font-size: 0.75rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        opacity: 0.75;
      }
      .badge-counter-value {
        font-weight: 700;
        font-size: 1.1rem;
      }
    </style>
  </template>
}

export default class BadgeField extends NumberField {
  static displayName = 'Badge Number Field';

  static configuration: Configuration = {
    presentation: {
      type: 'badge',
      label: '',
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
        @value={{this.args.model}}
        @config={{this.config}}
        @onChange={{this.args.set}}
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

  static atom = View;

  static embedded = View;
}
