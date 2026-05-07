import GlimmerComponent from '@glimmer/component';
import { eq, not } from '@cardstack/boxel-ui/helpers';
import { BoxelInput } from '@cardstack/boxel-ui/components';
import {
  Component,
  NumberField as BaseNumberField,
  deserializeForUI,
  serializeForUI,
} from './card-api';
import { NumberSerializer } from '@cardstack/runtime-common';
import { getFormattedDisplayValue } from './number/util/index';
import HashIcon from '@cardstack/boxel-icons/hash';
import { TextInputValidator } from './text-input-validator';

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

import type { StatOptions } from './number/components/stat';
import type { ScoreOptions } from './number/components/score';
import type { ProgressBarOptions } from './number/components/progress-bar';
import type { ProgressCircleOptions } from './number/components/progress-circle';
import type { BadgeNotificationOptions } from './number/components/badge-notification';
import type { BadgeMetricOptions } from './number/components/badge-metric';
import type { BadgeCounterOptions } from './number/components/badge-counter';
import type { GaugeOptions } from './number/components/gauge';

export { deserializeForUI, serializeForUI };

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

export interface StandardOptions {
  decimals?: number;
  prefix?: string;
  suffix?: string;
  min?: number;
  max?: number;
}

export type NumberFieldConfiguration =
  | { presentation?: 'standard'; options?: StandardOptions }
  | { presentation?: 'stat'; options?: StatOptions }
  | { presentation?: 'score'; options?: ScoreOptions }
  | { presentation?: 'progress-bar'; options?: ProgressBarOptions }
  | { presentation?: 'progress-circle'; options?: ProgressCircleOptions }
  | { presentation?: 'badge-notification'; options?: BadgeNotificationOptions }
  | { presentation?: 'badge-metric'; options?: BadgeMetricOptions }
  | { presentation?: 'badge-counter'; options?: BadgeCounterOptions }
  | { presentation?: 'gauge'; options?: GaugeOptions };

interface DispatcherSignature {
  Args: {
    model: number | null;
    configuration: any;
  };
}

class AtomDispatcher extends GlimmerComponent<DispatcherSignature> {
  get config() {
    return (this.args.configuration as NumberFieldConfiguration) ?? {};
  }

  get options() {
    return this.config.options ?? {};
  }

  get presentation(): NumberPresentationType {
    return (this.config.presentation as NumberPresentationType) || 'standard';
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
      <ProgressCircleAtom @model={{@model}} @configuration={{@configuration}} />
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
}

class EmbeddedDispatcher extends GlimmerComponent<DispatcherSignature> {
  get config() {
    return (this.args.configuration as NumberFieldConfiguration) ?? {};
  }

  get options() {
    return this.config.options ?? {};
  }

  get presentation(): NumberPresentationType {
    return (this.config.presentation as NumberPresentationType) || 'standard';
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
}

export default class NumberField extends BaseNumberField {
  static displayName = 'Number Field';
  static icon = HashIcon;

  static atom = class Atom extends Component<typeof this> {
    <template>
      <AtomDispatcher @model={{@model}} @configuration={{@configuration}} />
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <EmbeddedDispatcher @model={{@model}} @configuration={{@configuration}} />
    </template>
  };

  static edit = class Edit extends Component<typeof this> {
    <template>
      <BoxelInput
        @value={{this.textInputValidator.asString}}
        @onInput={{this.textInputValidator.onInput}}
        @errorMessage={{this.textInputValidator.errorMessage}}
        @state={{if this.textInputValidator.isInvalid 'invalid' 'none'}}
        @min={{numberOption @configuration 'min'}}
        @max={{numberOption @configuration 'max'}}
        @disabled={{not @canEdit}}
        data-test-number-input
      />
    </template>

    textInputValidator: TextInputValidator<number> = new TextInputValidator(
      () => this.args.model ?? null,
      (inputVal) => this.args.set(inputVal ?? null),
      deserializeForUI,
      serializeForUI,
      NumberSerializer.validate,
    );
  };
}

function numberOption(
  configuration: unknown,
  key: 'min' | 'max',
): number | undefined {
  let config = configuration as NumberFieldConfiguration | undefined;
  let raw = (config?.options as { min?: unknown; max?: unknown } | undefined)?.[
    key
  ];
  let num = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(num) ? num : undefined;
}
