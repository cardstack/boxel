import GlimmerComponent from '@glimmer/component';
import { BoxelInput } from '@cardstack/boxel-ui/components';
import { hasValue, clamp } from '../util/index';
import type { DisplayConfig } from '../util/types';

interface Signature {
  Args: {
    value: number | null;
    config: DisplayConfig;
    onChange: (value: number | null) => void;
  };
}

export default class NumberInput extends GlimmerComponent<Signature> {
  get config() {
    return this.args.config;
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
      const min = this.config.min ?? -Infinity;
      const max = this.config.max ?? Infinity;
      this.args.onChange(clamp(num, min, max));
    }
  };

  <template>
    <BoxelInput
      @type='number'
      @value={{this.value}}
      @onInput={{this.handleInputChange}}
      @min={{this.config.min}}
      @max={{this.config.max}}
      data-test-number-input
    />
  </template>
}
