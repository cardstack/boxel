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
  // A negative or non-finite `@max` reads as an empty range, so `aria-valuemax`
  // never drops below `aria-valuemin` and the stepped track is always a finite
  // row.
  get max() {
    let max = this.args.max ?? 100;
    return Number.isFinite(max) ? Math.max(0, max) : 0;
  }
  // `@value` clamped into [0, max], with an unset or non-finite value read as
  // 0, so `aria-valuenow` always sits between `aria-valuemin` and
  // `aria-valuemax`. It is also what a sighted user sees: a continuous bar's
  // fill paints the exact value, and a stepped bar lights a partly reached step
  // whole, so with a whole-number `@max` the value there rounds up to the
  // number of lit steps (2.5 of 6 lights and announces 3), as Meter does with a
  // fractional level. Stepped mode is for small discrete totals, so a
  // fractional `@max` isn't meant to be used there: it draws `Math.ceil(max)`
  // steps against the raw max, and the outer `Math.min` (a no-op for a
  // whole-number `@max`) keeps the value within `aria-valuemax` rather than
  // matching the lit steps.
  get valueNow() {
    let value = Number.isFinite(this.args.value) ? this.args.value : 0;
    let clamped = Math.max(0, Math.min(value, this.max));
    return this.stepped ? Math.min(Math.ceil(clamped), this.max) : clamped;
  }
  // A zero `@max` has no fraction to show, so any value against it reads as an
  // empty bar at 0%, with no division by zero.
  get pct() {
    return this.max > 0 ? (this.valueNow / this.max) * 100 : 0;
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
      out.push({ on: i < this.valueNow });
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
      aria-valuenow={{this.valueNow}}
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
