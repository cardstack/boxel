import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { BoxelInput } from '@cardstack/boxel-ui/components';
import { hasValue, clamp } from '../util/index';

// Options interface for number input
export interface NumberInputOptions {
  decimals?: number;
  prefix?: string;
  suffix?: string;
  min?: number;
  max?: number;
}

interface Signature {
  Args: {
    value: number | null;
    config: NumberInputOptions;
    onChange: (value: number | null) => void;
  };
}

export default class NumberInput extends GlimmerComponent<Signature> {
  @tracked isOutOfRange = false;

  get config() {
    return this.args.config;
  }

  get rangeConfig() {
    // Type guard: safely access min/max properties if they exist
    return this.args.config as Partial<Pick<NumberInputOptions, 'min' | 'max'>>;
  }

  get value() {
    // Return null for empty input, otherwise the numeric value
    return hasValue(this.args.value) ? this.args.value : null;
  }

  get validationState() {
    return this.isOutOfRange ? 'invalid' : 'none';
  }

  get errorMessage() {
    if (!this.isOutOfRange) return undefined;

    const min = this.rangeConfig.min;
    const max = this.rangeConfig.max;

    if (min !== undefined && max !== undefined) {
      return `Value must be between ${min} and ${max}`;
    } else if (min !== undefined) {
      return `Value must be at least ${min}`;
    } else if (max !== undefined) {
      return `Value must be at most ${max}`;
    }
    return undefined;
  }

  handleInputChange = (val: string) => {
    if (val === '' || val === null || val === undefined) {
      this.isOutOfRange = false;
      this.args.onChange(null);
      return;
    }
    const num = parseFloat(val);
    if (!isNaN(num)) {
      // Check if value is out of range for visual feedback
      const min = this.rangeConfig.min ?? -Infinity;
      const max = this.rangeConfig.max ?? Infinity;
      this.isOutOfRange = num < min || num > max;

      // Don't clamp during typing - just set the value
      this.args.onChange(num);
    }
  };

  handleBlur = (ev: Event) => {
    // Enforce min/max constraints when user finishes editing
    const val = (ev.target as HTMLInputElement)?.value;
    if (val === '' || val === null || val === undefined) {
      this.isOutOfRange = false;
      return;
    }
    const num = parseFloat(val);
    if (!isNaN(num)) {
      const min = this.rangeConfig.min ?? -Infinity;
      const max = this.rangeConfig.max ?? Infinity;
      const clampedValue = clamp(num, min, max);
      if (clampedValue !== num) {
        this.args.onChange(clampedValue);
      }
      // Clear error state after clamping
      this.isOutOfRange = false;
    }
  };

  <template>
    <BoxelInput
      @type='number'
      @value={{this.value}}
      @onInput={{this.handleInputChange}}
      @onBlur={{this.handleBlur}}
      @min={{this.rangeConfig.min}}
      @max={{this.rangeConfig.max}}
      @state={{this.validationState}}
      @errorMessage={{this.errorMessage}}
      data-test-number-input
    />
  </template>
}
