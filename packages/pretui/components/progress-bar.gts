// Pretui — ProgressBar: quantitative progress along a track.
import Component from '@glimmer/component';
import { htmlSafe } from '@ember/template';
import { hueStyle } from '../internal/ink';

export interface ProgressBarSignature {
  Args: {
    value: number;
    max?: number;
    label?: string;
    count?: string;
    valueText?: string;
    hue?: string;
    steps?: boolean;
  };
  Element: HTMLDivElement;
}

// Quantitative completion. Stepped mode for small discrete totals ("3 / 6").
//
// The root element is the `progressbar`, so `aria-label` and `aria-labelledby`
// passed as attributes name it directly; `@label` names it otherwise, and a bar
// with neither is named "Progress". The visible header sits inside the widget
// and is hidden from assistive tech, which hears the name and value from the
// ARIA attributes instead.
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
  // A `progressbar` must have an accessible name, so an unnamed bar falls back
  // to a generic one, as boxel-ui's ProgressBar does. A caller's `aria-label`
  // replaces it (`...attributes` comes after it on the root), and a caller's
  // `aria-labelledby` takes precedence over any `aria-label` in the
  // accessible-name computation.
  get accessibleLabel() {
    return this.args.label || 'Progress';
  }
  get showHeader() {
    return this.args.label || this.args.count !== undefined;
  }
  // A caller's words for the value win. In stepped mode the visible count is
  // next, since it is already the human reading and carries the total
  // ("3 / 6"). A continuous bar's count can omit the total ("300 files"), so
  // there assistive tech keeps deriving a percentage from the value range.
  get valueText() {
    return this.args.valueText ?? (this.stepped ? this.args.count : undefined);
  }
  get style() {
    return hueStyle('--pretui-progress-hue', this.args.hue);
  }
  <template>
    <div
      class='pretui-progresswrap'
      role='progressbar'
      aria-label={{this.accessibleLabel}}
      aria-valuemin='0'
      aria-valuenow={{@value}}
      aria-valuemax={{this.max}}
      aria-valuetext={{this.valueText}}
      style={{this.style}}
      data-test-pretui-progress
      ...attributes
    >
      {{#if this.showHeader}}
        <div class='pretui-progress-head' aria-hidden='true'>
          <span>{{@label}}</span>
          <span class='pretui-progress-count'>{{this.countText}}</span>
        </div>
      {{/if}}
      {{#if this.stepped}}
        <div class='pretui-progress-steps'>
          {{#each this.stepList as |s|}}
            <span class='pretui-progress-step' data-on={{if s.on 'true'}}></span>
          {{/each}}
        </div>
      {{else}}
        <div class='pretui-progress'>
          <div class='pretui-progress-fill' style={{this.fillStyle}}></div>
        </div>
      {{/if}}
    </div>
    <style scoped>
      @layer PretComponent {
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
          background-color: var(--pretui-progress-hue, var(--primary));
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
          background-color: var(--pretui-progress-hue, var(--primary));
        }
      }
    </style>
  </template>
}
