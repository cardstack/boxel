import GlimmerComponent from '@glimmer/component';
import { htmlSafe } from '@ember/template';

interface ReadingProgressArgs {
  Args: {
    readProgress: number;
    label?: string;
  };
}

export default class ReadingProgress extends GlimmerComponent<ReadingProgressArgs> {
  get displayLabel() {
    return this.args.label ?? 'Reading file...';
  }

  get progressStyle() {
    return htmlSafe(`width: ${this.args.readProgress}%`);
  }

  <template>
    <div class='reading-progress'>
      <div class='progress-bar'>
        <div
          class='progress-fill'
          style={{this.progressStyle}}
        ></div>
      </div>
      <div class='progress-text'>{{this.displayLabel}} {{@readProgress}}%</div>
    </div>

    <style scoped>
      .reading-progress {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100%;
        gap: calc(var(--spacing, 0.25rem) * 3);
        padding: calc(var(--spacing, 0.25rem) * 8);
        background: color-mix(in srgb, var(--primary, #3b82f6) 5%, transparent);
      }

      .progress-bar {
        width: 100%;
        max-width: 16rem;
        height: 0.5rem;
        background: var(--muted, #f1f5f9);
        border-radius: 9999px;
        overflow: hidden;
      }

      .progress-fill {
        height: 100%;
        background: var(--primary, #3b82f6);
        transition: width 0.3s ease;
        border-radius: 9999px;
      }

      .progress-text {
        font-size: 0.875rem;
        color: var(--foreground, #1a1a1a);
        font-weight: 500;
      }
    </style>
  </template>
}

