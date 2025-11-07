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
  type BadgeConfig,
} from './util/index';

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
        gap: var(--boxel-sp-sm, 0.75rem);
      }
      .badge-icon-wrapper {
        position: relative;
        width: 2.5rem;
        height: 2.5rem;
        border-radius: 0.75rem;
        background: rgba(9, 9, 11, 0.04);
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--boxel-dark);
      }
      .badge-icon-dot {
        position: absolute;
        top: -0.3rem;
        right: -0.3rem;
        min-width: 1.2rem;
        min-height: 1.2rem;
        padding: 0 0.25rem;
        border-radius: 999px;
        background: var(--boxel-red);
        color: var(--boxel-light);
        font-size: 0.6875rem;
        font-weight: 700;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 2px solid #fff;
      }
      .badge-label {
        font-size: 0.75rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--boxel-blue, #0069f9);
      }
      .badge-counter {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--boxel-sp-sm);
        padding: 0.65rem 0.85rem;
        border-radius: 0.65rem;
        background: #0f172a;
        color: var(--boxel-light);
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
        font-family: var(--boxel-monospace-font-family, monospace);
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

  static atom = View;

  static embedded = View;
}
