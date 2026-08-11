// A reusable horizontal bar chart for hand-rolled dashboard panels — no
// charting library, just a semantic list with a filled track per row. Proven
// by two call sites in talent-resource-tracker.gts: the Dashboard funnel
// (replacing what used to be bespoke CSS-bar markup) and the Source
// Effectiveness panel. Pull any third dashboard bar chart through here too
// rather than hand-rolling another one.
import GlimmerComponent from '@glimmer/component';
import { htmlSafe } from '@ember/template';

import { stateColor, type Hue } from '../utils/index';

export interface BarChartDatum {
  label: string;
  value: number;
}

interface BarChartSignature {
  Args: {
    data: BarChartDatum[];
    // Bars scale relative to this. Defaults to the largest value in `data`
    // so a single-series chart always fills out its widest row.
    maxValue?: number;
    // Formats the trailing value label; falls back to the raw number. Given
    // the row's label too, since two rows can share the same value (e.g. two
    // sources both at 0% conversion) and a caller keying off value alone
    // would mismatch.
    formatValue?: (value: number, label: string) => string;
    // Named tone for the fill (reuses the app's stateColor palette). Falls
    // back to boxel's highlight token when omitted.
    hue?: Hue;
  };
  Element: HTMLUListElement;
}

export class BarChart extends GlimmerComponent<BarChartSignature> {
  get maxValue(): number {
    if (this.args.maxValue != null && this.args.maxValue > 0) {
      return this.args.maxValue;
    }
    let values = this.args.data.map((d) => d.value);
    return Math.max(1, ...values);
  }

  get ring(): string {
    return this.args.hue
      ? stateColor(this.args.hue).ring
      : 'var(--primary, var(--boxel-highlight))';
  }

  fillStyle = (value: number) => {
    let pct = Math.max(0, Math.min(100, (value / this.maxValue) * 100));
    // 4% keeps a non-zero bar visibly present rather than invisible.
    let width = value > 0 ? Math.max(4, Math.round(pct)) : 0;
    return htmlSafe(`width: ${width}%; background: ${this.ring};`);
  };

  formatted = (value: number, label: string): string => {
    return this.args.formatValue
      ? this.args.formatValue(value, label)
      : String(value);
  };

  <template>
    <ul class='bar-chart' ...attributes>
      {{#each @data as |row|}}
        <li class='bar-chart-row'>
          <span class='bar-chart-label'>{{row.label}}</span>
          <div
            class='bar-chart-track'
            role='img'
            aria-label='{{row.label}}: {{this.formatted row.value row.label}}'
          >
            <div class='bar-chart-fill' style={{this.fillStyle row.value}}></div>
          </div>
          <span
            class='bar-chart-value'
          >{{this.formatted row.value row.label}}</span>
        </li>
      {{/each}}
    </ul>
    <style scoped>
      .bar-chart {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-sm);
      }
      .bar-chart-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: var(--boxel-sp-5xs);
      }
      .bar-chart-label {
        display: flex;
        justify-content: space-between;
        gap: var(--boxel-sp-xs);
        font-size: var(--boxel-font-size-xs);
        font-weight: 700;
        color: var(--foreground, var(--boxel-dark));
      }
      .bar-chart-track {
        height: 0.5rem;
        border-radius: 999px;
        background: var(--muted, var(--boxel-100));
        overflow: hidden;
      }
      .bar-chart-fill {
        height: 100%;
        border-radius: 999px;
        transition: width 0.2s ease-out;
      }
      .bar-chart-value {
        font-size: 10.5px;
        color: var(--muted-foreground, var(--boxel-450));
        font-variant-numeric: tabular-nums;
      }
    </style>
  </template>
}

export default BarChart;
