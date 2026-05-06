import { htmlSafe } from '@ember/template';
import { concat } from '@ember/helper';
import GlimmerComponent from '@glimmer/component';
import {
  getFormattedDisplayValue,
  getNumericValue,
  calculatePercentage,
} from '../util/index';

export interface ScoreOptions {
  decimals?: number;
  prefix?: string;
  suffix?: string;
  min?: number;
  max?: number;
  label?: string;
}

interface ScoreConfiguration {
  presentation?: 'score';
  options?: ScoreOptions;
}

interface ScoreSignature {
  Args: {
    model: number | null;
    configuration?: ScoreConfiguration;
  };
}

export class ScoreAtom extends GlimmerComponent<ScoreSignature> {
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

  get iconColor() {
    const p = this.percentage;
    if (p >= 75) return 'var(--success, #22c55e)';
    if (p >= 50) return 'var(--accent, #eab308)';
    if (p >= 25) return 'var(--warning, #f59e0b)';
    return 'var(--destructive, #ef4444)';
  }

  get displayValue() {
    return getFormattedDisplayValue(this.args.model, this.options);
  }

  <template>
    <span class='score-field-atom'>
      <svg
        class='trophy-icon'
        style={{htmlSafe (concat 'color: ' this.iconColor)}}
        viewBox='0 0 16 16'
        fill='currentColor'
        xmlns='http://www.w3.org/2000/svg'
      >
        <path
          d='M8 2L10.09 6.26L14 7.27L11 10.14L11.18 14.02L8 12.77L4.82 14.02L5 10.14L2 7.27L5.91 6.26L8 2Z'
        />
      </svg>
      <span class='value'>{{this.displayValue}}</span>
    </span>

    <style scoped>
      .score-field-atom {
        display: inline-flex;
        align-items: center;
        gap: 0.375rem;
        padding: 0.25rem 0.625rem;
        background: var(--muted, #f1f5f9);
        border-radius: 999px;
        border: 1px solid var(--border, #e2e8f0);
      }
      .trophy-icon {
        width: 1rem;
        height: 1rem;
        flex-shrink: 0;
        transition: color 0.3s ease;
      }
      .value {
        font-size: 0.875rem;
        font-weight: 700;
        color: var(--foreground, var(--boxel-dark));
        line-height: 1;
      }
    </style>
  </template>
}

export class ScoreEmbedded extends GlimmerComponent<ScoreSignature> {
  get options() {
    return this.args.configuration?.options ?? {};
  }

  get displayValue() {
    return getFormattedDisplayValue(this.args.model, this.options);
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

  get scoreColor() {
    const p = this.percentage;
    if (p >= 75) return 'var(--success, #22c55e)';
    if (p >= 50) return 'var(--accent, #eab308)';
    if (p >= 25) return 'var(--warning, #f59e0b)';
    return 'var(--destructive, #ef4444)';
  }

  get tierLabel() {
    if (this.percentage >= 75) return 'Excellent';
    if (this.percentage >= 50) return 'Good';
    if (this.percentage >= 25) return 'Fair';
    return 'Poor';
  }

  get percentile() {
    // Calculate inverse percentile (higher score = lower percentile number = better)
    const inversePercentage = 100 - this.percentage;
    if (inversePercentage < 15) return 'Top 15%';
    if (inversePercentage < 30) return 'Top 30%';
    if (inversePercentage < 50) return 'Top 50%';
    return 'Below Average';
  }

  get label() {
    return this.options.label ?? 'Score';
  }

  <template>
    <div class='score-field-embedded'>
      <div class='score-header'>
        <span class='score-label'>Score</span>
        <div
          class='score-badge'
          style={{htmlSafe (concat 'background: ' this.scoreColor)}}
        >
          <svg
            class='badge-icon'
            viewBox='0 0 16 16'
            fill='currentColor'
            xmlns='http://www.w3.org/2000/svg'
          >
            <path
              d='M8 2L10.09 6.26L14 7.27L11 10.14L11.18 14.02L8 12.77L4.82 14.02L5 10.14L2 7.27L5.91 6.26L8 2Z'
            />
          </svg>
          <span class='badge-tier'>{{this.tierLabel}}</span>
        </div>
      </div>
      <div class='score-main'>
        <div class='score-display'>
          <span
            class='score-value'
            style={{htmlSafe (concat 'color: ' this.scoreColor)}}
          >
            {{this.displayValue}}
          </span>
          <span class='score-max'>/ {{this.maxValue}}</span>
        </div>
        <div class='score-percentile'>{{this.percentile}}</div>
      </div>
    </div>

    <style scoped>
      .score-field-embedded {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        padding: 1.5rem;
        border-radius: 1rem;
        background: linear-gradient(
          135deg,
          var(--card, #ffffff) 0%,
          var(--muted, #f8fafc) 100%
        );
        border: 2px solid var(--border, #e2e8f0);
        box-shadow:
          0 4px 6px -1px rgb(0 0 0 / 0.05),
          0 2px 4px -1px rgb(0 0 0 / 0.03);
      }
      .score-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .score-label {
        font-size: 0.875rem;
        font-weight: 600;
        letter-spacing: 0.025em;
        text-transform: uppercase;
        color: var(--muted-foreground, #64748b);
      }
      .score-badge {
        display: inline-flex;
        align-items: center;
        gap: 0.375rem;
        padding: 0.375rem 0.75rem;
        border-radius: 999px;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
      }
      .badge-icon {
        width: 0.875rem;
        height: 0.875rem;
        color: rgba(255, 255, 255, 0.9);
      }
      .badge-tier {
        font-size: 0.75rem;
        font-weight: 700;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        color: #ffffff;
      }
      .score-main {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 1rem;
      }
      .score-display {
        display: flex;
        align-items: baseline;
        gap: 0.5rem;
      }
      .score-value {
        font-size: 3.5rem;
        font-weight: 900;
        line-height: 1;
        letter-spacing: -0.03em;
      }
      .score-max {
        font-size: 1.5rem;
        font-weight: 600;
        color: var(--muted-foreground, #94a3b8);
      }
      .score-percentile {
        font-size: 0.875rem;
        font-weight: 600;
        padding: 0.375rem 0.75rem;
        background: var(--muted, #f1f5f9);
        border-radius: 0.5rem;
        color: var(--foreground, #0f172a);
        white-space: nowrap;
      }
    </style>
  </template>
}
