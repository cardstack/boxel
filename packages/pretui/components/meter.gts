// Pretui — Meter: a discrete bar meter that always ships a label (Law 4).
import Component from '@glimmer/component';
import { htmlSafe } from '@ember/template';
import { hueStyle } from '../internal/ink';

export interface MeterSignature {
  Args: {
    level: number;
    segments?: number;
    label: string; // Law 4: segments always ship a text label
    hue?: string;
    /** bar heights in px, written as rem (÷ 16) so they follow the root font size */
    heights?: number[];
  };
  Element: HTMLSpanElement;
}

export class Meter extends Component<MeterSignature> {
  get bars(): { on: boolean; style: ReturnType<typeof htmlSafe> }[] {
    let segments = this.segmentsCount;
    let heights = this.args.heights ?? [6, 10, 14];
    let out = [];
    for (let i = 0; i < segments; i++) {
      let h = heights[i] ?? heights[heights.length - 1];
      out.push({ on: i < this.levelNow, style: htmlSafe(`height: ${h / 16}rem`) });
    }
    return out;
  }
  // `@segments` as a whole number of bars, 3 when omitted. A fraction rounds
  // up, the way it draws (2.5 draws three bars), and a negative or non-finite
  // count reads as no bars, so `aria-valuemax` is always the number of bars
  // drawn and never drops below `aria-valuemin`.
  get segmentsCount() {
    let segments = this.args.segments ?? 3;
    return Number.isFinite(segments) ? Math.max(0, Math.ceil(segments)) : 0;
  }
  // `@level` as a whole number of bars in [0, segments], so `aria-valuenow`
  // always sits between `aria-valuemin` and `aria-valuemax`, and what is
  // announced is the number of bars a sighted user sees lit. A fraction rounds
  // up, the way a partly reached step lights in the stepped ProgressBar, so 1.5
  // lights and announces 2. An unset or non-finite level reads as 0.
  get levelNow() {
    let level = Number.isFinite(this.args.level) ? Math.ceil(this.args.level) : 0;
    return Math.max(0, Math.min(level, this.segmentsCount));
  }
  get style() {
    return hueStyle('--pretui-meter-hue', this.args.hue);
  }
  /**
   * A FALLBACK ROLE LIST, which `role` has always accepted: the first token
   * the engine understands wins.
   *
   * Firefox does not implement `role='meter'` at all, so a bare `role='meter'`
   * announces there as an unnamed group and the level is simply lost. React
   * Aria ships exactly this pair for the same reason. Meter-aware engines
   * still get `meter`; Firefox falls back to `progressbar`, which reads the
   * same `aria-valuenow`/`valuemin`/`valuemax` already present.
   *
   * Held in a getter rather than written inline because ember-template-lint's
   * `no-invalid-role` validates the whole attribute as a single role name and
   * rejects the (valid) two-token form.
   */
  meterRole = 'meter progressbar';
  <template>
    <span
      class='pretui-meter'
      style={{this.style}}
      role={{this.meterRole}}
      aria-valuenow={{this.levelNow}}
      aria-valuemin='0'
      aria-valuemax={{this.segmentsCount}}
      aria-label={{@label}}
      data-test-pretui-meter
      ...attributes
    >
      <span class='pretui-meter-bars'>
        {{#each this.bars as |bar|}}
          <span class='pretui-meter-bar' data-on={{if bar.on 'true'}} style={{bar.style}}></span>
        {{/each}}
      </span>
      {{#if @label}}<span class='pretui-meter-label'>{{@label}}</span>{{/if}}
    </span>
    <style scoped>
      @layer PretComponent {
        .pretui-meter {
          display: inline-flex;
          align-items: flex-end;
          gap: var(--boxel-sp-xs);
        }
        .pretui-meter-bars {
          display: inline-flex;
          align-items: flex-end;
          gap: var(--boxel-sp-6xs);
          height: 0.875rem;
        }
        .pretui-meter-bar {
          width: 0.25rem;
          border-radius: var(--boxel-border-radius-2xs);
          background-color: var(--border-strong);
        }
        .pretui-meter-bar[data-on] {
          background-color: var(--pretui-meter-hue, var(--primary));
        }
        .pretui-meter-label {
          font-size: var(--boxel-font-size-xs);
          font-weight: 500;
          color: var(--muted-foreground);
          line-height: 1;
        }
      }
    </style>
  </template>
}
