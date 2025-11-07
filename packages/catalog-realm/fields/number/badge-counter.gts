import { Component } from 'https://cardstack.com/base/card-api';

import NumberInput from './components/number-input';
import NumberField, {
  deserializeForUI,
  serializeForUI,
} from 'https://cardstack.com/base/number';
import { TextInputValidator } from 'https://cardstack.com/base/text-input-validator';
import { NumberSerializer } from '@cardstack/runtime-common';

import { getFormattedDisplayValue } from './util/index';
import type { BadgeCounterConfig } from './util/types';

interface Configuration {
  presentation: BadgeCounterConfig;
}

class CounterAtom extends Component<typeof BadgeCounterField> {
  get config() {
    return this.args.configuration?.presentation;
  }

  get displayValue() {
    return getFormattedDisplayValue(this.args.model, this.config);
  }

  get label() {
    return this.config.label ?? '';
  }

  <template>
    <span class='badge-counter-atom'>
      <span class='label'>{{this.label}}</span>
      <span class='value'>{{this.displayValue}}</span>
    </span>

    <style scoped>
      .badge-counter-atom {
        display: inline-flex;
        align-items: center;
        justify-content: space-between;
        gap: calc(var(--spacing, 0.25rem) * 2);
        padding: calc(var(--spacing, 0.25rem) * 1.5)
          calc(var(--spacing, 0.25rem) * 2.5);
        background: var(--primary, #3b82f6);
        color: var(--primary-foreground, #ffffff);
        border-radius: var(--radius, 0.5rem);
      }
      .label {
        font-size: 0.625rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        opacity: 0.75;
      }
      .value {
        font-size: 0.875rem;
        font-weight: 700;
      }
    </style>
  </template>
}

class CounterEmbedded extends Component<typeof BadgeCounterField> {
  get config() {
    return this.args.configuration?.presentation;
  }

  get displayValue() {
    return getFormattedDisplayValue(this.args.model, this.config);
  }

  get label() {
    return this.config.label ?? '';
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
        gap: calc(var(--spacing, 0.25rem) * 3);
        padding: calc(var(--spacing, 0.25rem) * 3)
          calc(var(--spacing, 0.25rem) * 4);
        background: var(--primary, #3b82f6);
        color: var(--primary-foreground, #ffffff);
        border-radius: var(--radius, 0.75rem);
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

export default class BadgeCounterField extends NumberField {
  static displayName = 'Badge Counter Field';

  static configuration: Configuration = {
    presentation: {
      type: 'badge-counter',
      label: '',
      decimals: 0,
      min: 0,
      max: 9999,
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

  static atom = CounterAtom;
  static embedded = CounterEmbedded;
}
