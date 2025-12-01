import { eq } from '@cardstack/boxel-ui/helpers';
import { Component } from 'https://cardstack.com/base/card-api';
import BaseNumberField, {
  deserializeForUI,
  serializeForUI,
} from 'https://cardstack.com/base/number';
import { TextInputValidator } from 'https://cardstack.com/base/text-input-validator';
import { NumberSerializer } from '@cardstack/runtime-common';
import { getFormattedDisplayValue } from './number/util/index';

import NumberInput, {
  type NumberInputOptions,
} from './number/components/number-input';
import HashIcon from '@cardstack/boxel-icons/hash';

// Import presentation components
import { StatEmbedded, StatAtom } from './number/components/stat';
import { ScoreEmbedded, ScoreAtom } from './number/components/score';
import {
  ProgressBarEmbedded,
  ProgressBarAtom,
} from './number/components/progress-bar';
import {
  ProgressCircleEmbedded,
  ProgressCircleAtom,
} from './number/components/progress-circle';
import {
  BadgeNotificationEmbedded,
  BadgeNotificationAtom,
} from './number/components/badge-notification';
import {
  BadgeMetricEmbedded,
  BadgeMetricAtom,
} from './number/components/badge-metric';
import {
  BadgeCounterEmbedded,
  BadgeCounterAtom,
} from './number/components/badge-counter';
import { GaugeEmbedded, GaugeAtom } from './number/components/gauge';

// Import config types from components
import type { StatOptions } from './number/components/stat';
import type { ScoreOptions } from './number/components/score';
import type { ProgressBarOptions } from './number/components/progress-bar';
import type { ProgressCircleOptions } from './number/components/progress-circle';
import type { BadgeNotificationOptions } from './number/components/badge-notification';
import type { BadgeMetricOptions } from './number/components/badge-metric';
import type { BadgeCounterOptions } from './number/components/badge-counter';
import type { GaugeOptions } from './number/components/gauge';

// Type definitions
type NumberPresentationType =
  | 'standard'
  | 'stat'
  | 'score'
  | 'progress-bar'
  | 'progress-circle'
  | 'badge-notification'
  | 'badge-metric'
  | 'badge-counter'
  | 'gauge';

// Common options for standard presentation
export interface StandardOptions {
  decimals?: number;
  prefix?: string;
  suffix?: string;
  min?: number;
  max?: number;
}

// TypeScript configuration interface
// Following the same pattern as image-field with union types
export type NumberFieldConfiguration =
  | {
      presentation?: 'standard';
      options?: StandardOptions;
    }
  | {
      presentation?: 'stat';
      options?: StatOptions;
    }
  | {
      presentation?: 'score';
      options?: ScoreOptions;
    }
  | {
      presentation?: 'progress-bar';
      options?: ProgressBarOptions;
    }
  | {
      presentation?: 'progress-circle';
      options?: ProgressCircleOptions;
    }
  | {
      presentation?: 'badge-notification';
      options?: BadgeNotificationOptions;
    }
  | {
      presentation?: 'badge-metric';
      options?: BadgeMetricOptions;
    }
  | {
      presentation?: 'badge-counter';
      options?: BadgeCounterOptions;
    }
  | {
      presentation?: 'gauge';
      options?: GaugeOptions;
    };

export default class NumberField extends BaseNumberField {
  static displayName = 'Number Field';
  static icon = HashIcon;

  static edit = class Edit extends Component<typeof this> {
    get config() {
      return (this.args.configuration as NumberFieldConfiguration) ?? {};
    }

    get options() {
      return this.config.options ?? {};
    }

    get inputOptions(): NumberInputOptions {
      // Extract only the properties compatible with NumberInput
      // (decimals, prefix, suffix, min, max)
      // For editing, we always use standard input options regardless of presentation type
      const opts = this.options;
      // Type guard: if presentation is 'standard', options will be StandardOptions
      // Otherwise, we extract only the compatible properties
      if (this.config.presentation === 'standard') {
        return (opts as StandardOptions) ?? {};
      }
      // For other presentation types, extract only NumberInput-compatible properties
      const standardProps = opts as Partial<StandardOptions>;
      return {
        decimals: standardProps.decimals,
        prefix: standardProps.prefix,
        suffix: standardProps.suffix,
        min: standardProps.min,
        max: standardProps.max,
      };
    }

    <template>
      <NumberInput
        @value={{@model}}
        @config={{this.inputOptions}}
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

  static atom = class Atom extends Component<typeof this> {
    get config() {
      return (this.args.configuration as NumberFieldConfiguration) ?? {};
    }

    get options() {
      return this.config.options ?? {};
    }

    get presentation(): NumberPresentationType {
      const presentation =
        (this.config.presentation as NumberPresentationType) || 'standard';
      return presentation;
    }

    get displayValue() {
      return getFormattedDisplayValue(this.args.model, this.options as any);
    }

    <template>
      {{#if (eq this.presentation 'stat')}}
        <StatAtom @model={{@model}} @configuration={{@configuration}} />
      {{else if (eq this.presentation 'score')}}
        <ScoreAtom @model={{@model}} @configuration={{@configuration}} />
      {{else if (eq this.presentation 'progress-bar')}}
        <ProgressBarAtom @model={{@model}} @configuration={{@configuration}} />
      {{else if (eq this.presentation 'progress-circle')}}
        <ProgressCircleAtom
          @model={{@model}}
          @configuration={{@configuration}}
        />
      {{else if (eq this.presentation 'badge-notification')}}
        <BadgeNotificationAtom
          @model={{@model}}
          @configuration={{@configuration}}
        />
      {{else if (eq this.presentation 'badge-metric')}}
        <BadgeMetricAtom @model={{@model}} @configuration={{@configuration}} />
      {{else if (eq this.presentation 'badge-counter')}}
        <BadgeCounterAtom @model={{@model}} @configuration={{@configuration}} />
      {{else if (eq this.presentation 'gauge')}}
        <GaugeAtom @model={{@model}} @configuration={{@configuration}} />
      {{else}}
        <span
          class='number-field-atom'
          data-test-number-field-atom
        >{{this.displayValue}}</span>
      {{/if}}
      <style scoped>
        .number-field-atom {
          display: inline-flex;
          align-items: baseline;
          gap: 0.125rem;
          font-size: 0.875rem;
          font-weight: 600;
          color: var(--foreground, #0f172a);
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    get config() {
      return (this.args.configuration as NumberFieldConfiguration) ?? {};
    }

    get options() {
      return this.config.options ?? {};
    }

    get presentation(): NumberPresentationType {
      const presentation =
        (this.config.presentation as NumberPresentationType) || 'standard';
      return presentation;
    }

    <template>
      {{#if (eq this.presentation 'stat')}}
        <StatEmbedded @model={{@model}} @configuration={{@configuration}} />
      {{else if (eq this.presentation 'score')}}
        <ScoreEmbedded @model={{@model}} @configuration={{@configuration}} />
      {{else if (eq this.presentation 'progress-bar')}}
        <ProgressBarEmbedded
          @model={{@model}}
          @configuration={{@configuration}}
        />
      {{else if (eq this.presentation 'progress-circle')}}
        <ProgressCircleEmbedded
          @model={{@model}}
          @configuration={{@configuration}}
        />
      {{else if (eq this.presentation 'badge-notification')}}
        <BadgeNotificationEmbedded
          @model={{@model}}
          @configuration={{@configuration}}
        />
      {{else if (eq this.presentation 'badge-metric')}}
        <BadgeMetricEmbedded
          @model={{@model}}
          @configuration={{@configuration}}
        />
      {{else if (eq this.presentation 'badge-counter')}}
        <BadgeCounterEmbedded
          @model={{@model}}
          @configuration={{@configuration}}
        />
      {{else if (eq this.presentation 'gauge')}}
        <GaugeEmbedded @model={{@model}} @configuration={{@configuration}} />
      {{else}}
        <span
          class='number-field-embedded'
          data-test-number-field-embedded
        >{{getFormattedDisplayValue @model this.options}}</span>
      {{/if}}
      <style scoped>
        .number-field-embedded {
          display: inline-flex;
          font-weight: 600;
          color: var(--foreground, #0f172a);
          font-size: 1.125rem;
        }
      </style>
    </template>
  };
}
