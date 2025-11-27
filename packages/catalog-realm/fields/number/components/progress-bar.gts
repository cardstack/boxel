import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';

interface Signature {
  Args: {
    value?: number;
    max?: number;
    label?: string; // Custom label text (overrides numeric value display)
    style?: 'gradient' | 'solid'; // 'gradient' for state-based colors, 'solid' for single color (default: 'solid')
    showValue?: boolean; // Show value text inside bar (default: true). Set false to hide text
    valueFormat?: 'percentage' | 'fraction'; // Display format: 'percentage' shows "75%", 'fraction' shows "75/100" (default: 'percentage')
  };
}

export default class ProgressBarComponent extends Component<Signature> {
  get percentage() {
    const { value = 0, max = 100 } = this.args;
    return Math.min(100, Math.max(0, (value / max) * 100));
  }

  get fillColor() {
    if (this.args.style !== 'gradient') {
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

  get fillStyle() {
    return htmlSafe(
      `width: ${this.percentage}%; background: ${this.fillColor};`,
    );
  }

  get isGradient() {
    return this.args.style === 'gradient';
  }

  get displayValue() {
    // If custom label is provided, use it
    if (this.args.label) {
      return this.args.label;
    }

    // Otherwise, format the numeric value
    const { value = 0, max = 100 } = this.args;
    const format = this.args.valueFormat || 'percentage';

    if (format === 'percentage') {
      return `${Math.round(this.percentage)}%`;
    }
    return `${value} / ${max}`;
  }

  get shouldShowText() {
    // Default to true if not specified
    return this.args.showValue !== false;
  }

  <template>
    <div class='progress-bar-container'>
      <div class='progress-bar-track'>
        <div
          class='progress-bar-fill {{if this.isGradient "gradient" "solid"}}'
          style={{this.fillStyle}}
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
        background: var(--muted, #f1f5f9);
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
        color: var(--primary-foreground, #ffffff);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
    </style>
  </template>
}
