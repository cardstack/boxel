import Component from '@glimmer/component';

interface Signature {
  Args: {
    value?: number;
    max?: number;
    useGradient?: boolean; // Use state-based colors (default: true). Set false for solid primary color
    valueFormat?: 'percentage' | 'fraction'; // Display format: 'percentage' shows "75%", 'fraction' shows "75/100" (default: 'fraction')
    showValue?: boolean; // Show internal text value (default: true). Set false to show only the circle shape
  };
}

export default class ProgressCircleComponent extends Component<Signature> {
  get percentage() {
    const { value = 0, max = 100 } = this.args;
    return Math.min(100, Math.max(0, (value / max) * 100));
  }

  get strokeColor() {
    if (this.args.useGradient === false) {
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
    if (this.args.valueFormat === 'percentage') {
      return `${Math.round(this.percentage)}%`;
    }
    // Default: fraction format
    return this.args.value;
  }

  get showMaxLabel() {
    return this.args.valueFormat !== 'percentage';
  }

  get circumference() {
    // Circumference for r=42: 2 * PI * 42 = 263.893
    // Reduced from r=45 to accommodate thicker stroke (stroke-width=12, so need 6px clearance on each side)
    return 263.893;
  }

  get strokeDashoffset() {
    return this.circumference - (this.circumference * this.percentage) / 100;
  }

  get shouldShowValue() {
    return this.args.showValue !== false;
  }

  <template>
    <div class='progress-circle-container'>
      <svg class='progress-circle-svg' viewBox='0 0 100 100'>
        {{! Background circle }}
        <circle
          class='progress-circle-track'
          cx='50'
          cy='50'
          r='42'
          fill='none'
        />
        {{! Progress circle }}
        <circle
          class='progress-circle-fill'
          cx='50'
          cy='50'
          r='42'
          fill='none'
          stroke={{this.strokeColor}}
          stroke-dasharray={{this.circumference}}
          stroke-dashoffset={{this.strokeDashoffset}}
          transform='rotate(-90 50 50)'
        />
      </svg>
      {{#if this.shouldShowValue}}
        <div class='progress-circle-content'>
          <span class='progress-circle-value'>{{this.displayValue}}</span>
          {{#if this.showMaxLabel}}
            <span class='progress-circle-max'>/{{@max}}</span>
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
      }
      .progress-circle-svg {
        display: block;
        width: 100%;
        height: 100%;
      }
      .progress-circle-track {
        stroke: var(--muted, #f1f5f9);
        stroke-width: var(--progress-circle-stroke-width, 10);
        opacity: 0.3;
      }
      .progress-circle-fill {
        stroke-width: var(--progress-circle-stroke-width, 10);
        stroke-linecap: round;
        transition:
          stroke-dashoffset 0.4s ease,
          stroke 0.3s ease;
      }
      .progress-circle-content {
        position: absolute;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
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
        margin-top: 0.25rem;
      }
    </style>
  </template>
}
