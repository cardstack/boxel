import { Component } from 'https://cardstack.com/base/card-api';
import { BoxelInput } from '@cardstack/boxel-ui/components';

import NumberField, {
  deserializeForUI,
  serializeForUI,
} from 'https://cardstack.com/base/number';
import { TextInputValidator } from 'https://cardstack.com/base/text-input-validator';
import { NumberSerializer } from '@cardstack/runtime-common';

import { getNumericValue, getFormattedDisplayValue } from './number/util/index';
import {
  ProgressBarEmbedded,
  ProgressBarAtom,
} from './number/components/progress-bar';

// Options interface for slider field
export interface SliderOptions {
  decimals?: number;
  prefix?: string;
  suffix?: string;
  min?: number;
  max?: number;
  showValue?: boolean;
}

// TypeScript configuration interface
export type SliderFieldConfiguration = {
  presentation?: 'slider';
  options?: SliderOptions;
};

export default class SliderField extends NumberField {
  static displayName = 'Slider Number Field';

  static edit = class Edit extends Component<typeof this> {
    get config() {
      return (this.args.configuration as SliderFieldConfiguration) ?? {};
    }

    get options() {
      return this.config.options ?? {};
    }

    get displayValue() {
      return getFormattedDisplayValue(this.args.model, this.options);
    }

    get minValue() {
      return this.options.min ?? 0;
    }

    get maxValue() {
      return this.options.max ?? 100;
    }

    handleInput = (value: string) => {
      this.args.set(parseFloat(value));
    };

    <template>
      <div class='slider-field-edit' data-test-slider-edit>
        <BoxelInput
          @type='range'
          @value={{getNumericValue @model}}
          @min={{this.minValue}}
          @max={{this.maxValue}}
          @onInput={{this.handleInput}}
        />
        {{#if this.options.showValue}}
          <span class='slider-value'>{{this.displayValue}}</span>
        {{/if}}
      </div>

      <style scoped>
        .slider-field-edit {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp);
          width: 100%;
        }
        .slider-value {
          font-weight: 600;
          font-size: var(--boxel-font-sm);
          color: var(--primary, var(--boxel-purple));
          text-align: right;
          flex-shrink: 0;
        }
      </style>
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
      return (this.args.configuration as SliderFieldConfiguration) ?? {};
    }

    get options() {
      return this.config.options ?? {};
    }

    get minValue() {
      return this.options.min ?? 0;
    }

    get maxValue() {
      return this.options.max ?? 100;
    }

    get progressBarConfig() {
      return {
        presentation: 'progress-bar' as const,
        options: {
          min: this.minValue,
          max: this.maxValue,
          useGradient: false,
          showValue: false,
        },
      };
    }

    get displayValue() {
      return getFormattedDisplayValue(this.args.model, this.options);
    }

    <template>
      <span class='slider-atom' data-test-slider-atom>
        <ProgressBarAtom
          @model={{@model}}
          @configuration={{this.progressBarConfig}}
        />
        <span class='slider-value'>{{this.displayValue}}</span>
      </span>

      <style scoped>
        .slider-atom {
          display: inline-flex;
          align-items: center;
          gap: var(--boxel-sp-5xs, 0.25rem);
        }
        .slider-value {
          font-size: 0.6875rem;
          font-weight: 600;
          color: var(--foreground, #0f172a);
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    get config() {
      return (this.args.configuration as SliderFieldConfiguration) ?? {};
    }

    get options() {
      return this.config.options ?? {};
    }

    get minValue() {
      return this.options.min ?? 0;
    }

    get maxValue() {
      return this.options.max ?? 100;
    }

    get progressBarConfig() {
      return {
        presentation: 'progress-bar' as const,
        options: {
          min: this.minValue,
          max: this.maxValue,
          useGradient: false,
          showValue: this.options.showValue !== false,
          valueFormat: 'fraction' as const,
        },
      };
    }

    <template>
      <div class='slider-field-embedded'>
        <ProgressBarEmbedded
          @model={{@model}}
          @configuration={{this.progressBarConfig}}
        />
      </div>

      <style scoped>
        .slider-field-embedded {
          width: 100%;
        }
      </style>
    </template>
  };
}
