import { Component } from 'https://cardstack.com/base/card-api';
import NumberField, {
  deserializeForUI,
  serializeForUI,
} from 'https://cardstack.com/base/number';
import { TextInputValidator } from 'https://cardstack.com/base/text-input-validator';
import { NumberSerializer } from '@cardstack/runtime-common';
import { BoxelInput, ProgressBar } from '@cardstack/boxel-ui/components';
import { hasValue, clamp, getNumericValue, type ProgressBarConfig } from './util/index';

export default class ProgressBarField extends NumberField {
  static displayName = 'Progress Bar Number Field';

  static configuration = {
    presentation: {
      type: 'progress-bar',
      min: 0,
      max: 100,
      label: 'Progress',
    },
  };

  static edit = class Edit extends Component<typeof this> {
    get config(): ProgressBarConfig {
      return {
        min: 0,
        max: 100,
        label: 'Progress',
        ...this.args.configuration?.presentation,
      };
    }

    get inputValue() {
      // Return null for empty input, otherwise the numeric value
      return hasValue(this.args.model) ? this.args.model : null;
    }

    handleInputChange = (value: string) => {
      // Handle empty input by setting to null
      if (value === '' || value === null || value === undefined) {
        this.args.set(null);
        return;
      }
      let num = parseFloat(value);
      if (!isNaN(num)) {
        // Apply min/max clamping using utility function
        const min = this.config.min;
        const max = this.config.max;
        num = clamp(num, min, max);
        this.args.set(num);
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

  static embedded = class Embedded extends Component<typeof this> {
    get config(): ProgressBarConfig {
      return {
        min: 0,
        max: 100,
        label: 'Progress',
        ...this.args.configuration?.presentation,
      };
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
