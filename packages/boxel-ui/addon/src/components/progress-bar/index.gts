import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';

export type BoxelProgressBarPosition = 'start' | 'center' | 'end';

interface Signature {
  Args: {
    label?: string;
    max: number;
    position?: BoxelProgressBarPosition;
    value: number;
  };
  Element: HTMLDivElement;
}

export default class ProgressBar extends Component<Signature> {
  get progressWidth(): ReturnType<typeof htmlSafe> {
    const max = this.args.max ?? 100;
    const value = this.args.value ?? 0;
    const percentage = Math.min(Math.max((value / max) * 100, 0), 100);
    return htmlSafe(`width: ${percentage}%`);
  }

  get progressBarPosition() {
    const position = this.args.position;
    if (!position) {
      return '';
    }
    return position ?? 'end';
  }

  <template>
    <div
      class='boxel-progress-bar'
      data-test-boxel-progress-bar
      aria-label={{@label}}
      ...attributes
    >
      <div class='progress-bar'>
        <div class='progress-bar-value' style={{this.progressWidth}}>
          <div class='progress-bar-info {{this.progressBarPosition}}'>
            <div class='progress-bar-label'>
              {{#if @label}}
                {{@label}}
              {{/if}}
            </div>
          </div>

        </div>
      </div>

    </div>

    <style scoped>
      @layer {
        .boxel-progress-bar {
          --progress-bar-background-color: var(
            --boxel-progress-bar-background-color,
            var(--boxel-light-200)
          );
          --progress-bar-border-radius: var(
            --boxel-progress-bar-border-radius,
            var(--boxel-border-radius-sm)
          );
          --progress-bar-fill-color: var(
            --boxel-progress-bar-fill-color,
            var(--boxel-highlight)
          );
          --progress-bar-font-color: var(
            --boxel-progress-bar-font-color,
            var(--boxel-light)
          );
          height: 1.5em;
          width: 100%;
          background-color: var(--progress-bar-background-color);
          border-radius: var(--progress-bar-border-radius);
          position: relative;
          overflow: hidden;
          border: 1px solid var(--boxel-200);
        }
        .progress-bar {
          height: 100%;
          width: 100%;
          position: absolute;
          top: 0;
          left: 0;
        }
        .progress-bar-value {
          position: relative;
          height: 100%;
          background-color: var(--progress-bar-fill-color);
          border-radius: var(--progress-bar-border-radius) 0 0
            var(--progress-bar-border-radius);
        }
        .progress-bar-info,
        .progress-bar-info.end {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          display: flex;
          align-items: center;
          justify-content: end;
          gap: var(--boxel-sp-xxs);
          padding: var(--boxel-sp-5xs);
        }
        .progress-bar-info.start {
          justify-content: start;
        }
        .progress-bar-info.center {
          position: absolute;
          justify-content: center;
        }
        .progress-bar-label {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          color: var(--progress-bar-font-color);
        }
      }
    </style>
  </template>
}
