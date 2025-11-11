import GlimmerComponent from '@glimmer/component';
import { BoxelInput } from '@cardstack/boxel-ui/components';
import { hasValue, clamp } from '../util/index';
import type {
  NumberDisplayConfig,
  NumericRangeConfig,
} from '../util/types';

interface Signature {
  Args: {
    value: number | null;
    config: NumberDisplayConfig;
    onChange: (value: number | null) => void;
  };
}

export default class NumberInput extends GlimmerComponent<Signature> {
  get config() {
    return this.args.config;
  }

  get rangeConfig() {
    // Type guard: safely access min/max properties if they exist
    return this.args.config as Partial<NumericRangeConfig>;
  }

  get value() {
    // Return null for empty input, otherwise the numeric value
    return hasValue(this.args.value) ? this.args.value : null;
  }

  handleInputChange = (val: string) => {
    if (val === '' || val === null || val === undefined) {
      this.args.onChange(null);
      return;
    }
    const num = parseFloat(val);
    if (!isNaN(num)) {
      const min = this.rangeConfig.min ?? -Infinity;
      const max = this.rangeConfig.max ?? Infinity;
      this.args.onChange(clamp(num, min, max));
    }
  };

  <template>
    <BoxelInput
      @type='number'
      @value={{this.value}}
      @onInput={{this.handleInputChange}}
      @min={{this.rangeConfig.min}}
      @max={{this.rangeConfig.max}}
      data-test-number-input
    />
  </template>
}
