import { Component } from 'https://cardstack.com/base/card-api';
import NumberInput from './components/number-input';
import { ProgressBar } from '@cardstack/boxel-ui/components';

import NumberField, {
  deserializeForUI,
  serializeForUI,
} from 'https://cardstack.com/base/number';
import { TextInputValidator } from 'https://cardstack.com/base/text-input-validator';
import { NumberSerializer } from '@cardstack/runtime-common';

import { getNumericValue, calculatePercentage } from './util/index';
import type { ProgressBarConfig } from './util/types';

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
      label: '',
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
        }
        .label {
          color: var(--muted-foreground, var(--boxel-450, #919191));
          font-weight: var(--boxel-font-weight-medium, 500);
        }
        .value {
          color: var(--foreground, var(--boxel-dark, #1a1a1a));
          font-weight: var(--boxel-font-weight-semibold, 600);
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

    get percentage() {
      return Math.round(
        calculatePercentage(
          this.numericValue,
          this.config.min,
          this.config.max,
        ),
      );
    }

    get labelText() {
      return this.config.label ?? 'Progress';
    }

    <template>
      <div class='progress-bar-field'>
        <div class='progress-bar-header'>
          <span class='progress-bar-title'>{{this.labelText}}</span>
          <span class='progress-bar-value'>
            {{this.numericValue}}
            /
            {{this.config.max}}
          </span>
        </div>
        <ProgressBar
          @label={{this.percentage}}
          @value={{this.numericValue}}
          @max={{this.config.max}}
          @position='right'
        />
      </div>

      <style scoped>
        .progress-bar-field {
          display: flex;
          flex-direction: column;
          gap: calc(var(--spacing, 0.25rem) * 2.5);
          width: 100%;
          padding: calc(var(--spacing, 0.25rem) * 4);
          border-radius: var(--radius, 0.75rem);
          background: var(--card, #ffffff);
          border: 1px solid var(--border, #e2e8f0);
          box-shadow: var(--shadow-md, 0 4px 6px -1px rgb(0 0 0 / 0.1));
        }
        .progress-bar-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          font-size: 0.75rem;
          color: var(--muted-foreground, #64748b);
        }
        .progress-bar-value {
          color: var(--foreground, #0f172a);
          font-weight: 600;
        }
      </style>
    </template>
  };
}
