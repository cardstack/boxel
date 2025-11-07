import { Component } from 'https://cardstack.com/base/card-api';
import NumberField, {
  deserializeForUI,
  serializeForUI,
} from 'https://cardstack.com/base/number';
import { TextInputValidator } from 'https://cardstack.com/base/text-input-validator';
import { NumberSerializer } from '@cardstack/runtime-common';
import { BoxelInput, ProgressBar } from '@cardstack/boxel-ui/components';
import {
  hasValue,
  clamp,
  getNumericValue,
  calculatePercentage,
  type ProgressBarConfig,
} from './util/index';

interface Configuration {
  presentation: ProgressBarConfig;
}

export default class ProgressBarField extends NumberField {
  static displayName = 'Progress Bar Number Field';

  static configuration: Configuration = {
    presentation: {
      type: 'progress-bar',
      min: 0,
      max: 100,
      label: 'Progress',
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

  static atom = class Atom extends Component<typeof this> {
    get config() {
      return this.args.configuration?.presentation;
    }

    get numericValue() {
      return getNumericValue(this.args.model);
    }

    get percentage() {
      const percent = calculatePercentage(
        this.numericValue,
        this.config.min,
        this.config.max,
      );
      return Math.round(percent);
    }

    <template>
      <span class='progress-bar-atom'>
        {{#if this.config.label}}
          <span class='label'>{{this.config.label}}:</span>
        {{/if}}
        <span class='value'>{{this.percentage}}%</span>
      </span>

      <style scoped>
        .progress-bar-atom {
          display: inline-flex;
          align-items: center;
          gap: var(--boxel-sp-5xs, 0.25rem);
          font-size: var(--boxel-font-size-xs, 0.6875rem);
          font-family: var(
            --font-sans,
            var(--boxel-font-family, system-ui, sans-serif)
          );
        }
        .label {
          color: var(--muted-foreground, var(--boxel-450, #919191));
          font-weight: var(--boxel-font-weight-medium, 500);
        }
        .value {
          color: var(--foreground, var(--boxel-dark, #1a1a1a));
          font-weight: var(--boxel-font-weight-semibold, 600);
          font-family: var(
            --font-mono,
            var(--boxel-monospace-font-family, monospace)
          );
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    get config() {
      return this.args.configuration?.presentation;
    }

    get numericValue() {
      return getNumericValue(this.args.model);
    }

    <template>
      <div class='progress-bar-field'>
        <ProgressBar
          @label={{this.config.label}}
          @value={{this.numericValue}}
          @max={{this.config.max}}
          @position='end'
        />
      </div>

      <style scoped>
        .progress-bar-field {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          width: 100%;
        }
      </style>
    </template>
  };
}
