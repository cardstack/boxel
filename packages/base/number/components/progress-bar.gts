import { htmlSafe } from '@ember/template';
import GlimmerComponent from '@glimmer/component';
import {
  getNumericValue,
  calculatePercentage,
  getFormattedDisplayValue,
  statusRampColor,
} from '../util/index';

export interface ProgressBarOptions {
  min?: number;
  max?: number;
  label?: string;
  useGradient?: boolean;
  showValue?: boolean;
  valueFormat?: 'percentage' | 'fraction';
  decimals?: number;
  prefix?: string;
  suffix?: string;
}

interface ProgressBarConfiguration {
  presentation?: 'progress-bar';
  options?: ProgressBarOptions;
}

interface ProgressBarSignature {
  Args: {
    model: number | null;
    configuration?: ProgressBarConfiguration;
  };
}

export class ProgressBarAtom extends GlimmerComponent<ProgressBarSignature> {
  get options() {
    return this.args.configuration?.options ?? {};
  }

  get numericValue() {
    return getNumericValue(this.args.model);
  }

  get minValue() {
    return this.options.min ?? 0;
  }

  get maxValue() {
    return this.options.max ?? 100;
  }

  get percentage() {
    return Math.min(
      100,
      Math.max(
        0,
        calculatePercentage(this.numericValue, this.minValue, this.maxValue),
      ),
    );
  }

  get fillColor() {
    if (this.options.useGradient === false) {
      return 'var(--primary)';
    }
    return statusRampColor(this.percentage);
  }

  get fillStyle() {
    return htmlSafe(
      `width: ${this.percentage}%; background: ${this.fillColor};`,
    );
  }

  <template>
    <span class='progress-bar-atom'>
      <div class='progress-bar-track'>
        <div
          class='progress-bar-fill'
          style={{this.fillStyle}}
          data-test-progress-bar-fill
        ></div>
      </div>
    </span>

    <style scoped>
      .progress-bar-atom {
        display: inline-flex;
        align-items: center;
        width: 4rem;
      }
      .progress-bar-track {
        position: relative;
        width: 100%;
        height: 0.5rem;
        background: var(--muted);
        border-radius: 999px;
        overflow: hidden;
      }
      .progress-bar-fill {
        position: absolute;
        inset: 0 auto 0 0;
        height: 100%;
        border-radius: inherit;
        transition:
          width 0.4s ease,
          background 0.3s ease;
      }
    </style>
  </template>
}

export class ProgressBarEmbedded extends GlimmerComponent<ProgressBarSignature> {
  get options() {
    return this.args.configuration?.options ?? {};
  }

  get numericValue() {
    return getNumericValue(this.args.model);
  }

  get minValue() {
    return this.options.min ?? 0;
  }

  get maxValue() {
    return this.options.max ?? 100;
  }

  get percentage() {
    return Math.min(
      100,
      Math.max(
        0,
        calculatePercentage(this.numericValue, this.minValue, this.maxValue),
      ),
    );
  }

  get fillColor() {
    if (this.options.useGradient === false) {
      return 'var(--primary)';
    }
    return statusRampColor(this.percentage);
  }

  get fillStyle() {
    return htmlSafe(
      `width: ${this.percentage}%; background: ${this.fillColor};`,
    );
  }

  get isGradient() {
    return this.options.useGradient !== false;
  }

  get displayValue() {
    // If custom label is provided, use it
    if (this.options.label) {
      return this.options.label;
    }
    // Otherwise, format the numeric value
    const format = this.options.valueFormat || 'percentage';
    if (format === 'percentage') {
      // Percentage format always renders % with calculated percentage
      const percentageValue = `${Math.round(this.percentage)}%`;
      // If suffix is provided, append it after the % (e.g., "75% completed")
      if (this.options.suffix) {
        return `${percentageValue} ${this.options.suffix}`;
      }
      return percentageValue;
    }
    // Fraction format: use formatted display value if prefix/suffix/decimals are provided
    if (
      this.options.suffix !== undefined ||
      this.options.prefix !== undefined ||
      this.options.decimals !== undefined
    ) {
      return getFormattedDisplayValue(this.args.model, this.options);
    }
    // Default fraction format
    return `${this.numericValue} / ${this.maxValue}`;
  }

  get shouldShowText() {
    // Default to true if not specified
    return this.options.showValue !== false;
  }

  <template>
    <div class='progress-bar-container'>
      <div class='progress-bar-track'>
        <div
          class='progress-bar-fill {{if this.isGradient "gradient" "solid"}}'
          style={{this.fillStyle}}
          data-test-progress-bar-fill
        >
          {{#if this.shouldShowText}}
            <div class='progress-bar-info'>
              <span class='progress-bar-label'>{{this.displayValue}}</span>
            </div>
          {{/if}}
        </div>
      </div>
    </div>

    <style scoped>
      .progress-bar-container {
        position: relative;
        width: 100%;
        height: var(--progress-bar-height, 0.75rem);
      }
      .progress-bar-track {
        position: relative;
        width: 100%;
        height: 100%;
        background: var(--muted);
        border-radius: 999px;
        overflow: hidden;
      }
      .progress-bar-fill {
        position: absolute;
        inset: 0 auto 0 0;
        height: 100%;
        border-radius: inherit;
        transition:
          width 0.4s ease,
          background 0.3s ease;
      }
      .progress-bar-info {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        display: flex;
        align-items: center;
        justify-content: flex-end;
        padding: 0 0.5rem;
      }
      .progress-bar-label {
        font-size: 0.625rem;
        font-weight: 600;
        color: var(--primary-foreground);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
    </style>
  </template>
}
