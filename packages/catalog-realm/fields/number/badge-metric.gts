import { Component } from 'https://cardstack.com/base/card-api';
import NumberInput from './components/number-input';

import NumberField, {
  deserializeForUI,
  serializeForUI,
} from 'https://cardstack.com/base/number';
import { TextInputValidator } from 'https://cardstack.com/base/text-input-validator';
import { NumberSerializer } from '@cardstack/runtime-common';

import { getFormattedDisplayValue } from './util/index';
import type { BadgeMetricConfig } from './util/types';

interface Configuration {
  presentation: BadgeMetricConfig;
}

class MetricAtom extends Component<typeof BadgeMetricField> {
  get config() {
    return this.args.configuration?.presentation;
  }

  get displayValue() {
    return getFormattedDisplayValue(this.args.model, this.config);
  }

  get BadgeIcon() {
    return this.config.icon;
  }

  <template>
    <span class='badge-metric-atom'>
      {{#if this.BadgeIcon}}
        <this.BadgeIcon width='12' height='12' />
      {{/if}}
      <span class='value'>{{this.displayValue}}</span>
    </span>

    <style scoped>
      .badge-metric-atom {
        display: inline-flex;
        align-items: center;
        gap: calc(var(--spacing, 0.25rem) * 1.5);
        padding: calc(var(--spacing, 0.25rem) * 1.5)
          calc(var(--spacing, 0.25rem) * 3);
        background: var(--muted, #f1f5f9);
        border-radius: 999px;
      }
      .badge-metric-atom svg {
        color: var(--muted-foreground, #64748b);
      }
      .value {
        font-size: 0.6875rem;
        font-weight: 600;
        color: var(--foreground, #1a1a1a);
      }
    </style>
  </template>
}

class MetricEmbedded extends Component<typeof BadgeMetricField> {
  get config() {
    return this.args.configuration?.presentation;
  }

  get displayValue() {
    return getFormattedDisplayValue(this.args.model, this.config);
  }

  get label() {
    return this.config.label ?? '';
  }

  get BadgeIcon() {
    return this.config.icon;
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
        color: var(--foreground, #1a1a1a);
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

export default class BadgeMetricField extends NumberField {
  static displayName = 'Badge Metric Field';

  static configuration: Configuration = {
    presentation: {
      type: 'badge-metric',
      label: '',
      decimals: 2,
      min: 0,
      max: 1000,
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

  static atom = MetricAtom;
  static embedded = MetricEmbedded;
}
