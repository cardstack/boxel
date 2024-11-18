import { eq } from '@cardstack/boxel-ui/helpers';
import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';

import { cssVar } from '../../helpers.ts';

export type BoxelProgressBarPosition = 'start' | 'center' | 'end';

interface Signature {
  Args: {
    label?: string;
    max: number;
    position?: BoxelProgressBarPosition;
    value: number;
    variant?: 'horizontal' | 'circular';
  };
  Element: HTMLDivElement;
}

export default class ProgressBar extends Component<Signature> {
  get progressPercentage(): string {
    const max = this.args.max ?? 100;
    const value = this.args.value ?? 0;
    return Math.round(Math.min(Math.max((value / max) * 100, 0), 100)) + '%';
  }

  get progressWidth(): ReturnType<typeof htmlSafe> {
    return htmlSafe(`width: ${this.progressPercentage};`);
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
      {{#if (eq @variant 'circular')}}
        <div
          class='progress-bar-circular'
          style={{cssVar progressPercentage=this.progressPercentage}}
        >
          <div class='progress-bar-circular-inner'>
            <span class='progress-percentage'>{{this.progressPercentage}}</span>
          </div>
        </div>
      {{else}}
        <div class='progress-bar-horizontal'>
          <div class='progress-bar-container'>
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
      {{/if}}
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
          --progress-bar-size: 80px;
        }
        .progress-bar-horizontal {
          height: 1.5em;
          width: 100%;
          background-color: var(--progress-bar-background-color);
          border-radius: var(--progress-bar-border-radius);
          position: relative;
          overflow: hidden;
          border: 1px solid var(--boxel-200);
        }
        .progress-bar-container {
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
        .progress-bar-circular {
          width: var(--progress-bar-size);
          height: var(--progress-bar-size);
          border-radius: 50%;
          position: relative;
          background: conic-gradient(
            var(--progress-bar-fill-color) 0 var(--progressPercentage),
            var(--progress-bar-background-color) var(--progressPercentage)
              80.15%
          );
        }
        .progress-bar-circular-inner {
          position: absolute;
          inset: 10px;
          background: var(--boxel-light);
          border-radius: 50%;
          display: grid;
          place-items: center;
        }

        .progress-percentage {
          font-size: var(--boxel-font-sm);
          font-weight: 600;
          color: var(--boxel-dark);
        }
      }
    </style>
  </template>
}
