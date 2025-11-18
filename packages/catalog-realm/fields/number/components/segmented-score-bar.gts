import { htmlSafe } from '@ember/template';
import { concat } from '@ember/helper';
import Component from '@glimmer/component';

interface Signature {
  Args: {
    value: number;
    min: number;
    max: number;
    height?: string;
  };
}

export default class SegmentedScoreBarComponent extends Component<Signature> {
  get percentage() {
    const { value, min = 0, max = 100 } = this.args;
    const range = max - min;
    const position = value - min;
    return Math.min(100, Math.max(0, (position / range) * 100));
  }

  get barHeight() {
    return this.args.height ?? '0.5rem';
  }

  get fillStyle() {
    return htmlSafe(`width: ${this.percentage}%;`);
  }

  <template>
    <div
      class='segmented-score-bar'
      style={{htmlSafe (concat 'height: ' this.barHeight)}}
    >
      <div class='score-segments'>
        <div class='segment segment-poor'></div>
        <div class='segment segment-fair'></div>
        <div class='segment segment-good'></div>
        <div class='segment segment-excellent'></div>
      </div>
      <div class='score-fill' style={{this.fillStyle}}></div>
    </div>

    <style scoped>
      .segmented-score-bar {
        position: relative;
        width: 100%;
        border-radius: 999px;
        overflow: visible;
      }
      .score-segments {
        display: flex;
        width: 100%;
        height: 100%;
        gap: 0.25rem;
      }
      .segment {
        flex: 1;
        height: 100%;
        border-radius: 999px;
      }
      .segment-poor {
        background: var(--destructive, #ef4444);
      }
      .segment-fair {
        background: var(--warning, #f59e0b);
      }
      .segment-good {
        background: var(--accent, #eab308);
      }
      .segment-excellent {
        background: var(--success, #22c55e);
      }
      .score-fill {
        position: absolute;
        top: 0;
        left: 0;
        height: 100%;
        border-radius: 999px;
        background: linear-gradient(
          to right,
          rgba(255, 255, 255, 0.3) 0%,
          rgba(255, 255, 255, 0.1) 50%,
          rgba(255, 255, 255, 0) 100%
        );
        transition: width 0.4s ease;
        pointer-events: none;
      }
    </style>
  </template>
}

