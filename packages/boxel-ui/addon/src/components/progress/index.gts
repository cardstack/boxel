import Component from '@glimmer/component';
import { htmlSafe } from '@ember/template';

interface Signature {
  Args: {
    value: number;
    max: number;
    label?: string;
  };
  Element: HTMLDivElement;
}

export default class Progress extends Component<Signature> {
  get progressWidth(): ReturnType<typeof htmlSafe> {
    const value = this.args.value ?? 0;
    const max = this.args.max ?? 100;
    const percentage = Math.min(Math.max((value / max) * 100, 0), 100);
    return htmlSafe(`width: ${percentage}%`);
  }

  <template>
    <div class='boxel-progress' data-test-boxel-progress ...attributes>
      <div class='progress-bar'>
        <div class='progress-value' style={{this.progressWidth}}></div>
      </div>
      <div class='progress-label'>
        {{#if @label}}
          {{@label}}
        {{/if}}
      </div>
    </div>

    <style>
      @layer {
        .boxel-progress {
          --progress-background-color: var(
            --boxel-progress-background-color,
            var(--boxel-light-200)
          );
          --progress-border-radius: var(
            --boxel-progress-border-radius,
            var(--boxel-border-radius-sm)
          );
          --progress-value-color: var(
            --boxel-progress-value-color,
            var(--boxel-highlight)
          );
          --progress-font-color: var(
            --boxel-progress-font-color,
            var(--boxel-light)
          );
          --progress-font: var(--boxel-progress-font-weight, 600)
            var(--boxel-progress-text-font, var(--boxel-font-xs));

          height: 1.5em;
          width: 100%;
          background-color: var(--progress-background-color);
          border-radius: var(--progress-border-radius);
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
        .progress-value {
          height: 100%;
          background-color: var(--progress-value-color);
          border-radius: var(--progress-border-radius) 0 0
            var(--progress-border-radius);
        }
        .progress-label {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          font: var(--progress-font);
          color: var(--progress-font-color);
        }
      }
    </style>
  </template>
}
