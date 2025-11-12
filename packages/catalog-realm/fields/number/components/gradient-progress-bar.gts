import GlimmerComponent from '@glimmer/component';
import { htmlSafe } from '@ember/template';

interface Signature {
  Args: {
    value: number;
    max: number;
    height?: string;
    showLabel?: boolean;
    useGradient?: boolean;
  };
}

export default class GradientProgressBar extends GlimmerComponent<Signature> {
  get percentage() {
    const value = this.args.value ?? 0;
    const max = this.args.max ?? 100;
    return Math.min(Math.max((value / max) * 100, 0), 100);
  }

  get fillColor() {
    if (this.args.useGradient === false) {
      return 'var(--primary, #3b82f6)';
    }

    const p = this.percentage;

    // 0-25%: Red to Orange
    if (p <= 25) {
      return 'var(--destructive, #ef4444)';
    }
    // 25-50%: Orange to Yellow
    if (p <= 50) {
      return 'var(--warning, #f59e0b)';
    }
    // 50-75%: Yellow to Light Green
    if (p <= 75) {
      return 'var(--accent, #eab308)';
    }
    // 75-100%: Light Green to Success Green
    return 'var(--success, #22c55e)';
  }

  get fillStyle() {
    return htmlSafe(
      `width: ${this.percentage}%; background: ${this.fillColor};`,
    );
  }

  get heightStyle() {
    const height = this.args.height ?? '0.5rem';
    return htmlSafe(`height: ${height};`);
  }

  <template>
    <div class='gradient-progress-bar' style={{this.heightStyle}}>
      <div class='progress-track'>
        <div class='progress-fill' style={{this.fillStyle}}></div>
      </div>
      {{#if @showLabel}}
        <span class='progress-label'>{{this.percentage}}%</span>
      {{/if}}
    </div>

    <style scoped>
      .gradient-progress-bar {
        width: 100%;
        display: flex;
        align-items: center;
        gap: calc(var(--spacing, 0.25rem) * 2);
      }
      .progress-track {
        position: relative;
        flex: 1;
        height: 100%;
        background: var(--muted, #f1f5f9);
        border-radius: 999px;
        overflow: hidden;
      }
      .progress-fill {
        position: absolute;
        inset: 0 auto 0 0;
        height: 100%;
        border-radius: inherit;
        transition:
          width 0.4s ease,
          background 0.3s ease;
      }
      .progress-label {
        font-size: 0.875rem;
        font-weight: 600;
        color: var(--foreground, #1a1a1a);
        min-width: 3rem;
        text-align: right;
      }
    </style>
  </template>
}
