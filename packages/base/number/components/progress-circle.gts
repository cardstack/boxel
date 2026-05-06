import { htmlSafe } from '@ember/template';
import { concat } from '@ember/helper';
import GlimmerComponent from '@glimmer/component';
import {
  getNumericValue,
  calculatePercentage,
  getFormattedDisplayValue,
} from '../util/index';

export interface ProgressCircleOptions {
  min?: number;
  max?: number;
  useGradient?: boolean;
  valueFormat?: 'percentage' | 'fraction';
  showValue?: boolean;
  decimals?: number;
  prefix?: string;
  suffix?: string;
}

interface ProgressCircleConfiguration {
  presentation?: 'progress-circle';
  options?: ProgressCircleOptions;
}

interface ProgressCircleSignature {
  Args: {
    model: number | null;
    configuration?: ProgressCircleConfiguration;
  };
}

export class ProgressCircleAtom extends GlimmerComponent<ProgressCircleSignature> {
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
      return 'var(--primary, #3b82f6)';
    }
    const p = this.percentage;
    if (p <= 25) {
      return 'var(--destructive, #ef4444)';
    }
    if (p <= 50) {
      return 'var(--warning, #f59e0b)';
    }
    if (p <= 75) {
      return 'var(--accent, #eab308)';
    }
    return 'var(--success, #22c55e)';
  }

  <template>
    <span
      class='progress-circle-atom'
      style={{htmlSafe
        (concat
          '--percentage: '
          this.percentage
          '%; --fill-color: '
          this.fillColor
          ';'
        )
      }}
    >
      <div class='progress-circle-track'>
        <div class='progress-circle-fill'></div>
      </div>
    </span>

    <style scoped>
      .progress-circle-atom {
        position: relative;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 2rem;
        height: 2rem;
        border-radius: 50%;
        background: var(--muted, #f1f5f9);
        overflow: hidden;
      }
      .progress-circle-track {
        position: absolute;
        inset: 0;
        background: conic-gradient(
          var(--fill-color) 0%,
          var(--fill-color) var(--percentage),
          transparent var(--percentage),
          transparent 100%
        );
        transform: rotate(-90deg);
      }
      .progress-circle-fill {
        position: absolute;
        inset: 0.25rem;
        background: var(--background, #ffffff);
        border-radius: 50%;
      }
    </style>
  </template>
}

export class ProgressCircleEmbedded extends GlimmerComponent<ProgressCircleSignature> {
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
      return 'var(--primary, #3b82f6)';
    }
    const p = this.percentage;
    // State-based colors based on progress percentage
    // 0-25%: Red (low progress)
    if (p <= 25) {
      return 'var(--destructive, #ef4444)';
    }
    // 25-50%: Orange (moderate progress)
    if (p <= 50) {
      return 'var(--warning, #f59e0b)';
    }
    // 50-75%: Yellow (good progress)
    if (p <= 75) {
      return 'var(--accent, #eab308)';
    }
    // 75-100%: Green (excellent progress)
    return 'var(--success, #22c55e)';
  }

  get displayValue() {
    // Format the numeric value based on valueFormat
    if (this.options.valueFormat === 'percentage') {
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
    // Default: fraction format (just the numeric value)
    return this.numericValue;
  }

  get showMaxLabel() {
    return this.options.valueFormat !== 'percentage';
  }

  get shouldShowValue() {
    return this.options.showValue !== false;
  }

  <template>
    <div
      class='progress-circle-container'
      style={{htmlSafe
        (concat
          '--percentage: '
          this.percentage
          '%; --fill-color: '
          this.fillColor
          ';'
        )
      }}
    >
      <div class='progress-circle-track'>
        <div class='progress-circle-fill'></div>
      </div>
      {{#if this.shouldShowValue}}
        <div class='progress-circle-content'>
          <span class='progress-circle-value'>{{this.displayValue}}</span>
          {{#if this.showMaxLabel}}
            <span class='progress-circle-max'>/{{this.maxValue}}</span>
          {{/if}}
        </div>
      {{/if}}
    </div>

    <style scoped>
      .progress-circle-container {
        position: relative;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: var(--progress-circle-size, 120px);
        height: var(--progress-circle-size, 120px);
        border-radius: 50%;
        background: var(--muted, #f1f5f9);
        overflow: hidden;
      }
      .progress-circle-track {
        position: absolute;
        inset: 0;
        background: conic-gradient(
          var(--fill-color) 0%,
          var(--fill-color) var(--percentage),
          transparent var(--percentage),
          transparent 100%
        );
        transform: rotate(-90deg);
      }
      .progress-circle-fill {
        position: absolute;
        inset: var(--progress-circle-stroke-width, 10px);
        background: var(--background, #ffffff);
        border-radius: 50%;
      }
      .progress-circle-content {
        position: absolute;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 0.25rem;
        pointer-events: none;
        z-index: 3;
      }
      .progress-circle-value {
        font-size: var(--progress-circle-value-size, 1.5rem);
        font-weight: 700;
        color: var(--foreground, #0f172a);
        line-height: 1;
      }
      .progress-circle-max {
        font-size: var(--progress-circle-max-size, 0.875rem);
        font-weight: 500;
        color: var(--muted-foreground, #64748b);
      }
    </style>
  </template>
}
