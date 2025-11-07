import { Component } from 'https://cardstack.com/base/card-api';
import NumberInput from './components/number-input';
import { ProgressRadial } from '@cardstack/boxel-ui/components';

import NumberField, {
  deserializeForUI,
  serializeForUI,
} from 'https://cardstack.com/base/number';
import { TextInputValidator } from 'https://cardstack.com/base/text-input-validator';
import { NumberSerializer } from '@cardstack/runtime-common';

import { getNumericValue, calculatePercentage } from './util/index';
import type { ProgressCircleConfig } from './util/types';

interface Configuration {
  presentation: ProgressCircleConfig;
}

export default class ProgressCircleField extends NumberField {
  static displayName = 'Progress Circle Number Field';

  static configuration: Configuration = {
    presentation: {
      type: 'progress-circle',
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

    get strokeDashoffset() {
      // Calculate the stroke-dashoffset for the progress circle
      // circumference ≈ 37.7 (for r=6: 2πr ≈ 37.7)
      const circumference = 37.7;
      const offset = circumference - (circumference * this.percentage) / 100;
      return offset;
    }

    <template>
      <span class='progress-circle-atom'>
        <span class='radial-mini'>
          <svg viewBox='0 0 16 16' class='radial-svg'>
            <circle
              cx='8'
              cy='8'
              r='6'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
              opacity='0.2'
            />
            <circle
              cx='8'
              cy='8'
              r='6'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
              stroke-dasharray='37.7'
              stroke-dashoffset={{this.strokeDashoffset}}
              stroke-linecap='round'
              transform='rotate(-90 8 8)'
            />
          </svg>
        </span>
        <span class='value'>{{this.percentage}}%</span>
      </span>

      <style scoped>
        .progress-circle-atom {
          display: inline-flex;
          align-items: center;
          gap: var(--boxel-sp-5xs, 0.25rem);
        }
        .radial-mini {
          display: inline-flex;
          width: var(--boxel-icon-xxs, 0.75rem);
          height: var(--boxel-icon-xxs, 0.75rem);
        }
        .radial-svg {
          width: 100%;
          height: 100%;
          color: var(--primary, var(--boxel-highlight));
        }
        .value {
          font-size: var(--boxel-font-size-xs, 0.6875rem);
          font-weight: var(--boxel-font-weight-semibold, 600);
          color: var(--foreground, var(--boxel-dark, #1a1a1a));
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
      <div class='progress-circle-field'>
        <ProgressRadial @value={{this.numericValue}} @max={{this.config.max}} />
      </div>

      <style scoped>
        .progress-circle-field {
          display: flex;
          justify-content: center;
          align-items: center;
          padding: 0.5rem;
        }
      </style>
    </template>
  };
}
