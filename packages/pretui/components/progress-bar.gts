// Pretui — ProgressBar: quantitative progress along a track.
import Component from '@glimmer/component';
import { htmlSafe } from '@ember/template';

export interface ProgressBarSignature {
  Args: {
    value: number;
    max?: number;
    label?: string;
    count?: string;
    steps?: boolean;
  };
  Element: HTMLDivElement;
}

// Quantitative completion. Stepped mode for small discrete totals ("3 / 6").
export class ProgressBar extends Component<ProgressBarSignature> {
  get max() {
    return this.args.max ?? 100;
  }
  get pct() {
    return Math.max(0, Math.min(100, (this.args.value / this.max) * 100));
  }
  get stepped() {
    return this.args.steps ?? (this.args.count !== undefined && this.max <= 12);
  }
  get countText() {
    return this.args.count ?? `${Math.round(this.pct)}%`;
  }
  get fillStyle() {
    return htmlSafe(`width: ${this.pct}%; min-width: ${this.pct > 0 ? 4 : 0}px`);
  }
  get stepList(): { on: boolean }[] {
    let out = [];
    for (let i = 0; i < this.max; i++) {
      out.push({ on: i < this.args.value });
    }
    return out;
  }
  get showHeader() {
    return this.args.label || this.args.count !== undefined;
  }
  <template>
    <div class='pretui-progresswrap' data-test-pretui-progress ...attributes>
      {{#if this.showHeader}}
        <div class='pretui-progress-head'>
          <span>{{@label}}</span>
          <span class='pretui-progress-count'>{{this.countText}}</span>
        </div>
      {{/if}}
      {{#if this.stepped}}
        <div role='progressbar' aria-valuenow={{@value}} aria-valuemax={{this.max}} class='pretui-progress-steps'>
          {{#each this.stepList as |s|}}
            <span class='pretui-progress-step' data-on={{if s.on 'true'}}></span>
          {{/each}}
        </div>
      {{else}}
        <div class='pretui-progress' role='progressbar' aria-valuenow={{@value}} aria-valuemax={{this.max}}>
          <div class='pretui-progress-fill' style={{this.fillStyle}}></div>
        </div>
      {{/if}}
    </div>
    <style scoped>
      .pretui-progresswrap {
        display: grid;
        gap: 5px;
      }
      .pretui-progress-head {
        display: flex;
        justify-content: space-between;
        align-items: last baseline;
        font-size: var(--text-ui-sm, 11.5px);
        color: var(--muted-foreground);
      }
      .pretui-progress-count {
        font-family: var(--font-mono);
        font-size: var(--text-ui-xs, 11px);
        font-variant-numeric: tabular-nums;
        color: var(--foreground);
      }
      .pretui-progress {
        height: 4px;
        border-radius: 2px;
        background: var(--inset, var(--boxel-100));
        overflow: hidden;
      }
      .pretui-progress-fill {
        height: 100%;
        border-radius: 2px;
        background: var(--primary);
        transition: width var(--pretui-dur-morph, 300ms) var(--pretui-ease-morph, ease);
      }
      .pretui-progress-steps {
        display: flex;
        gap: 3px;
      }
      .pretui-progress-step {
        flex: 1;
        height: 4px;
        border-radius: 2px;
        background: var(--inset, var(--boxel-100));
        transition: background var(--pretui-dur-morph, 300ms) var(--pretui-ease-morph, ease);
      }
      .pretui-progress-step[data-on] {
        background: var(--primary);
      }
    </style>
  </template>
}
