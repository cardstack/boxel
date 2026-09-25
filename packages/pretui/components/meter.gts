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
    heights?: number[];
  };
  Element: HTMLSpanElement;
}

export class Meter extends Component<MeterSignature> {
  get bars(): { on: boolean; style: ReturnType<typeof htmlSafe> }[] {
    let segments = this.args.segments ?? 3;
    let heights = this.args.heights ?? [6, 10, 14];
    let out = [];
    for (let i = 0; i < segments; i++) {
      let h = heights[i] ?? heights[heights.length - 1];
      out.push({ on: i < this.args.level, style: htmlSafe(`height: ${h}px`) });
    }
    return out;
  }
  get segmentsCount() {
    return this.args.segments ?? 3;
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
      aria-valuenow={{@level}}
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
      .pretui-meter {
        display: inline-flex;
        align-items: flex-end;
        gap: 8px;
      }
      .pretui-meter-bars {
        display: inline-flex;
        align-items: flex-end;
        gap: 2px;
        height: 14px;
      }
      .pretui-meter-bar {
        width: 4px;
        border-radius: 2px;
        background: var(--line-strong, var(--boxel-400));
      }
      .pretui-meter-bar[data-on] {
        background: var(--pretui-meter-hue, var(--primary));
      }
      .pretui-meter-label {
        font-size: var(--text-ui-md, 12.5px);
        font-weight: 500;
        color: var(--muted-foreground);
        line-height: 1;
      }
    </style>
  </template>
}
