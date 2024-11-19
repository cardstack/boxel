import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';

import { cssVar } from '../../helpers.ts';

interface Signature {
  Args: {
    label?: string;
    max: number;
    value: number;
  };
  Element: HTMLDivElement;
}

export default class ProgressRadial extends Component<Signature> {
  get progressPercentage(): string {
    const max = this.args.max ?? 100;
    const value = this.args.value ?? 0;
    return Math.round(Math.min(Math.max((value / max) * 100, 0), 100)) + '%';
  }

  get progressWidth(): ReturnType<typeof htmlSafe> {
    return htmlSafe(`width: ${this.progressPercentage};`);
  }

  <template>
    <div
      class='boxel-progress-radial'
      data-test-boxel-progress-radial
      aria-label={{@label}}
      ...attributes
    >
      <div
        class='progress-radial-circle-outer'
        style={{cssVar progressPercentage=this.progressPercentage}}
      >
        <div class='progress-radial-circle-inner'>
          <span class='progress-percentage'>{{this.progressPercentage}}</span>
        </div>
      </div>
    </div>

    <style scoped>
      @layer {
        .boxel-progress-radial {
          --progress-radial-size: 80px;
          --progress-radial-fill-color: var(--boxel-highlight);
          --progress-radial-background-color: var(--boxel-light-200);
          --progress-radial-font-weight: 600;
        }
        .progress-radial-circle-outer {
          width: var(--progress-radial-size);
          height: var(--progress-radial-size);
          border-radius: 50%;
          position: relative;
          background: conic-gradient(
            var(--progress-radial-fill-color) 0 var(--progressPercentage),
            var(--progress-radial-background-color) var(--progressPercentage)
              80.15%
          );
        }
        .progress-radial-circle-inner {
          position: absolute;
          inset: 10px;
          background: var(--boxel-light);
          border-radius: 50%;
          display: grid;
          place-items: center;
        }

        .progress-percentage {
          font-size: var(--boxel-font-sm);
          font-weight: var(--progress-radial-font-weight);
          color: var(--boxel-dark);
        }
      }
    </style>
  </template>
}
