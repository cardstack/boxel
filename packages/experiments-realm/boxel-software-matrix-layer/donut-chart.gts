import GlimmerComponent from '@glimmer/component';
import { htmlSafe } from '@ember/template';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';

export interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

const SIZE = 200;
const R = 80;
const STROKE = 30;
const C = 2 * Math.PI * R;

interface DonutChartSignature {
  Args: {
    centerLabel?: string;
    centerValue?: string;
    formatValue?: (n: number) => string;
    onSelect?: (label: string) => void;
    segments: DonutSegment[];
  };
  Element: HTMLElement;
}

export class DonutChart extends GlimmerComponent<DonutChartSignature> {
  size = SIZE;
  r = R;
  stroke = STROKE;
  mid = SIZE / 2;

  format = (n: number) =>
    this.args.formatValue ? this.args.formatValue(n) : String(n);

  get total() {
    return (this.args.segments ?? []).reduce(
      (sum, s) => sum + Math.max(s?.value ?? 0, 0),
      0,
    );
  }

  get arcs() {
    let total = this.total;
    if (!total) return [];
    let offset = 0;
    return (this.args.segments ?? [])
      .filter((s) => (s?.value ?? 0) > 0)
      .map((s) => {
        let len = (s.value / total) * C;
        let arc = {
          label: s.label,
          value: s.value,
          color: s.color,
          percent: Math.round((s.value / total) * 100),
          dasharray: `${len} ${C - len}`,
          dashoffset: -offset,
          swatchStyle: htmlSafe(`background: ${s.color}`),
        };
        offset += len;
        return arc;
      });
  }

  <template>
    <figure class='donut' ...attributes>
      {{#if this.arcs.length}}
        <svg
          viewBox='0 0 {{this.size}} {{this.size}}'
          role='img'
          aria-label={{if @centerLabel @centerLabel 'Donut chart'}}
        >
          {{#each this.arcs as |arc|}}
            <circle
              cx={{this.mid}}
              cy={{this.mid}}
              r={{this.r}}
              fill='none'
              stroke={{arc.color}}
              stroke-width={{this.stroke}}
              stroke-dasharray={{arc.dasharray}}
              stroke-dashoffset={{arc.dashoffset}}
              transform='rotate(-90 {{this.mid}} {{this.mid}})'
            />
          {{/each}}
          {{#if @centerValue}}
            <text class='center-value' x={{this.mid}} y={{this.mid}}>
              {{@centerValue}}
            </text>
          {{/if}}
          {{#if @centerLabel}}
            <text class='center-label' x={{this.mid}} y={{this.mid}} dy='20'>
              {{@centerLabel}}
            </text>
          {{/if}}
        </svg>
        <figcaption class='legend'>
          {{#each this.arcs as |arc|}}
            {{#if @onSelect}}
              <button
                type='button'
                class='legend-item legend-button'
                {{on 'click' (fn @onSelect arc.label)}}
              >
                <span class='swatch' style={{arc.swatchStyle}}></span>
                <span class='legend-label'>{{arc.label}}</span>
                <span class='legend-value'>{{this.format arc.value}}
                  ({{arc.percent}}%)</span>
                <span class='chev'>›</span>
              </button>
            {{else}}
              <span class='legend-item'>
                <span class='swatch' style={{arc.swatchStyle}}></span>
                <span class='legend-label'>{{arc.label}}</span>
                <span class='legend-value'>{{this.format arc.value}}
                  ({{arc.percent}}%)</span>
              </span>
            {{/if}}
          {{/each}}
        </figcaption>
      {{else}}
        <p class='empty'>No data</p>
      {{/if}}
    </figure>
    <style scoped>
      .donut {
        margin: 0;
        display: flex;
        align-items: center;
        gap: 1.25rem;
        flex-wrap: wrap;
      }
      svg {
        width: 10.5rem;
        height: 10.5rem;
        flex-shrink: 0;
      }
      .center-value {
        font-size: 2rem;
        font-weight: 700;
        text-anchor: middle;
        dominant-baseline: middle;
        fill: var(--foreground, #111111);
        font-variant-numeric: tabular-nums;
      }
      .center-label {
        font-size: 0.6875rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        text-anchor: middle;
        dominant-baseline: middle;
        fill: var(--muted-foreground, #6b7280);
      }
      .legend {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
        min-width: 0;
      }
      .legend-item {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.8125rem;
      }
      .swatch {
        width: 0.625rem;
        height: 0.625rem;
        border-radius: 0.1875rem;
        flex-shrink: 0;
      }
      .legend-label {
        min-width: 7rem;
      }
      .legend-value {
        color: var(--muted-foreground, #6b7280);
        font-variant-numeric: tabular-nums;
      }
      .legend-button {
        font: inherit;
        padding: 0.125rem 0.25rem;
        margin: -0.125rem -0.25rem;
        border: none;
        border-radius: 0.375rem;
        background: transparent;
        color: inherit;
        text-align: left;
        cursor: pointer;
      }
      .legend-button:hover {
        background: var(--muted, #f3f4f6);
      }
      .chev {
        color: var(--muted-foreground, #9ca3af);
        font-weight: 700;
      }
      .empty {
        margin: 0;
        font-size: 0.8125rem;
        color: var(--muted-foreground, #6b7280);
      }
    </style>
  </template>
}
