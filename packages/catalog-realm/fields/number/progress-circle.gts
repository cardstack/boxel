import { Component } from 'https://cardstack.com/base/card-api';
import NumberField, {
  deserializeForUI,
  serializeForUI,
} from 'https://cardstack.com/base/number';
import { TextInputValidator } from 'https://cardstack.com/base/text-input-validator';
import { NumberSerializer } from '@cardstack/runtime-common';
import { BoxelInput, ProgressRadial } from '@cardstack/boxel-ui/components';
import { hasValue, clamp, getNumericValue, type ProgressCircleConfig } from './util/index';

export default class ProgressCircleField extends NumberField {
  static displayName = 'Progress Circle Number Field';

  static configuration = {
    presentation: {
      type: 'progress-circle',
      min: 0,
      max: 100,
    },
  };

  static edit = class Edit extends Component<typeof this> {
    get config(): ProgressCircleConfig {
      return {
        min: 0,
        max: 100,
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
    get config(): ProgressCircleConfig {
      return {
        min: 0,
        max: 100,
        ...this.args.configuration?.presentation,
      };
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
