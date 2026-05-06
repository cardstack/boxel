import { htmlSafe } from '@ember/template';
import { concat } from '@ember/helper';
import GlimmerComponent from '@glimmer/component';
import {
  getNumericValue,
  calculatePercentage,
  getFormattedDisplayValue,
} from '../util/index';

export interface GaugeOptions {
  decimals?: number;
  prefix?: string;
  suffix?: string;
  min?: number;
  max?: number;
  label?: string;
  showValue?: boolean;
  dangerThreshold?: number;
  warningThreshold?: number;
}

interface GaugeConfiguration {
  presentation?: 'gauge';
  options?: GaugeOptions;
}

interface GaugeSignature {
  Args: {
    model: number | null;
    configuration?: GaugeConfiguration;
  };
}

export class GaugeAtom extends GlimmerComponent<GaugeSignature> {
  get options() {
    return this.args.configuration?.options ?? {};
  }

  get percentage() {
    const numericValue = getNumericValue(this.args.model);
    return calculatePercentage(
      numericValue,
      this.options.min ?? 0,
      this.options.max ?? 100,
    );
  }

  get gaugeColor() {
    const numericValue = getNumericValue(this.args.model);
    const dangerThreshold = this.options.dangerThreshold;
    const warningThreshold = this.options.warningThreshold;

    if (dangerThreshold !== undefined && numericValue >= dangerThreshold) {
      return 'var(--destructive, #ef4444)';
    }
    if (warningThreshold !== undefined && numericValue >= warningThreshold) {
      return 'var(--warning, #f59e0b)';
    }
    return 'var(--primary, #3b82f6)';
  }

  get needleRotation() {
    const percentage = this.percentage;
    return (percentage / 100) * 180;
  }

  get needleStyle() {
    return htmlSafe(`transform: rotate(${this.needleRotation}deg)`);
  }

  get arcDashArray() {
    return 251.32;
  }

  get arcDashOffset() {
    return this.arcDashArray - (this.percentage * this.arcDashArray) / 100;
  }

  <template>
    <span class='gauge-atom'>
      <svg
        class='gauge-svg'
        viewBox='0 0 200 120'
        xmlns='http://www.w3.org/2000/svg'
      >
        <path
          d='M 20 100 A 80 80 0 0 1 180 100'
          fill='none'
          stroke='var(--muted, #f1f5f9)'
          stroke-width='16'
          stroke-linecap='round'
        />
        <path
          d='M 20 100 A 80 80 0 0 1 180 100'
          fill='none'
          stroke-width='16'
          stroke-linecap='round'
          stroke-dasharray={{this.arcDashArray}}
          stroke-dashoffset={{this.arcDashOffset}}
          style={{htmlSafe
            (concat
              'stroke: '
              this.gaugeColor
              '; transition: stroke-dashoffset 0.3s ease, stroke 0.3s ease;'
            )
          }}
        />
        <circle cx='100' cy='100' r='6' fill='var(--foreground, #1e293b)' />
        <line
          x1='100'
          y1='100'
          x2='100'
          y2='40'
          stroke='var(--foreground, #1e293b)'
          stroke-width='3'
          stroke-linecap='round'
          style={{this.needleStyle}}
          transform-origin='100 100'
        />
      </svg>
    </span>

    <style scoped>
      .gauge-atom {
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      .gauge-svg {
        width: 3rem;
        height: auto;
      }
    </style>
  </template>
}

export class GaugeEmbedded extends GlimmerComponent<GaugeSignature> {
  get options() {
    return this.args.configuration?.options ?? {};
  }

  get percentage() {
    const numericValue = getNumericValue(this.args.model);
    return calculatePercentage(
      numericValue,
      this.options.min ?? 0,
      this.options.max ?? 100,
    );
  }

  get displayValue() {
    return getFormattedDisplayValue(this.args.model, this.options);
  }

  get gaugeColor() {
    const numericValue = getNumericValue(this.args.model);
    const dangerThreshold = this.options.dangerThreshold;
    const warningThreshold = this.options.warningThreshold;

    if (dangerThreshold !== undefined && numericValue >= dangerThreshold) {
      return 'var(--destructive, #ef4444)';
    }
    if (warningThreshold !== undefined && numericValue >= warningThreshold) {
      return 'var(--warning, #f59e0b)';
    }
    return 'var(--primary, #3b82f6)';
  }

  get needleRotation() {
    const percentage = this.percentage;
    return (percentage / 100) * 180;
  }

  get needleStyle() {
    return htmlSafe(`transform: rotate(${this.needleRotation}deg)`);
  }

  get arcDashArray() {
    return 251.32;
  }

  get arcDashOffset() {
    return this.arcDashArray - (this.percentage * this.arcDashArray) / 100;
  }

  get minValue() {
    return this.options.min ?? 0;
  }

  get maxValue() {
    return this.options.max ?? 100;
  }

  get shouldShowValue() {
    return this.options.showValue !== false;
  }

  <template>
    <div class='gauge-embedded'>
      {{#if this.options.label}}
        <div class='gauge-label'>{{this.options.label}}</div>
      {{/if}}
      <div class='gauge-display'>
        <svg
          class='gauge-svg'
          viewBox='0 0 200 120'
          xmlns='http://www.w3.org/2000/svg'
        >
          <path
            d='M 20 100 A 80 80 0 0 1 180 100'
            fill='none'
            stroke='var(--muted, #f1f5f9)'
            stroke-width='16'
            stroke-linecap='round'
          />
          <path
            d='M 20 100 A 80 80 0 0 1 180 100'
            fill='none'
            stroke-width='16'
            stroke-linecap='round'
            stroke-dasharray={{this.arcDashArray}}
            stroke-dashoffset={{this.arcDashOffset}}
            style={{htmlSafe
              (concat
                'stroke: '
                this.gaugeColor
                '; transition: stroke-dashoffset 0.3s ease, stroke 0.3s ease;'
              )
            }}
          />
          <text
            x='20'
            y='115'
            text-anchor='start'
            font-size='10'
            fill='var(--muted-foreground, #94a3b8)'
          >
            {{this.minValue}}
          </text>
          <text
            x='180'
            y='115'
            text-anchor='end'
            font-size='10'
            fill='var(--muted-foreground, #94a3b8)'
          >
            {{this.maxValue}}
          </text>
          <circle cx='100' cy='100' r='6' fill='var(--foreground, #1e293b)' />
          <line
            x1='100'
            y1='100'
            x2='100'
            y2='40'
            stroke='var(--foreground, #1e293b)'
            stroke-width='3'
            stroke-linecap='round'
            style={{this.needleStyle}}
            transform-origin='100 100'
          />
        </svg>
        {{#if this.shouldShowValue}}
          <div class='gauge-value'>{{this.displayValue}}</div>
        {{/if}}
      </div>
    </div>

    <style scoped>
      .gauge-embedded {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: calc(var(--spacing, 0.25rem) * 2);
        padding: calc(var(--spacing, 0.25rem) * 4);
      }
      .gauge-label {
        font-size: 0.875rem;
        font-weight: 600;
        text-align: center;
      }
      .gauge-display {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: calc(var(--spacing, 0.25rem) * 2);
        width: 100%;
      }
      .gauge-svg {
        width: 100%;
        max-width: 12rem;
        height: auto;
      }
      .gauge-value {
        font-size: 1.5rem;
        font-weight: 700;
      }
    </style>
  </template>
}
