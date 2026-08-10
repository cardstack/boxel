import GlimmerComponent from '@glimmer/component';

export interface ChartPoint {
  label: string;
  value: number;
}

const W = 600;
const H = 200;
const PAD = 28;

interface LineChartSignature {
  Args: {
    formatValue?: (n: number) => string;
    points: ChartPoint[];
  };
  Element: HTMLElement;
}

export class LineChart extends GlimmerComponent<LineChartSignature> {
  format = (n: number) =>
    this.args.formatValue ? this.args.formatValue(n) : String(n);

  get layout() {
    let pts = (this.args.points ?? []).filter(
      (p) => typeof p?.value === 'number',
    );
    if (!pts.length) return undefined;
    let values = pts.map((p) => p.value);
    let min = Math.min(...values, 0);
    let max = Math.max(...values);
    if (max === min) max = min + 1;
    let x = (i: number) => PAD + (i * (W - 2 * PAD)) / Math.max(pts.length - 1, 1);
    let y = (v: number) => H - PAD - ((v - min) * (H - 2 * PAD)) / (max - min);
    let coords = pts.map((p, i) => ({ x: x(i), y: y(p.value) }));
    let line = coords.map((c) => `${c.x},${c.y}`).join(' ');
    let area =
      `M ${coords[0].x},${H - PAD} L ` +
      coords.map((c) => `${c.x},${c.y}`).join(' L ') +
      ` L ${coords[coords.length - 1].x},${H - PAD} Z`;
    return {
      line,
      area,
      last: coords[coords.length - 1],
      midY: y((min + max) / 2),
      topY: y(max),
      baseY: H - PAD,
      minLabel: this.format(min),
      midLabel: this.format((min + max) / 2),
      maxLabel: this.format(max),
      firstLabel: pts[0].label,
      lastLabel: pts[pts.length - 1].label,
      lastValue: this.format(pts[pts.length - 1].value),
    };
  }

  <template>
    <div class='chart' ...attributes>
      {{#if this.layout}}
        {{#let this.layout as |l|}}
          <svg viewBox='0 0 600 200' preserveAspectRatio='xMidYMid meet'>
            <line class='grid' x1='28' y1={{l.baseY}} x2='572' y2={{l.baseY}} />
            <line class='grid' x1='28' y1={{l.midY}} x2='572' y2={{l.midY}} />
            <line class='grid' x1='28' y1={{l.topY}} x2='572' y2={{l.topY}} />
            <path class='area' d={{l.area}} />
            <polyline class='line' points={{l.line}} />
            <circle class='endpoint' cx={{l.last.x}} cy={{l.last.y}} r='4' />
            <text class='axis' x='28' y={{l.baseY}} dy='14'>{{l.minLabel}}</text>
            <text class='axis' x='28' y={{l.topY}} dy='-6'>{{l.maxLabel}}</text>
            <text
              class='axis anchor-end'
              x='572'
              y={{l.baseY}}
              dy='14'
            >{{l.lastLabel}}</text>
            <text
              class='axis anchor-end value'
              x={{l.last.x}}
              y={{l.last.y}}
              dy='-10'
            >{{l.lastValue}}</text>
          </svg>
        {{/let}}
      {{else}}
        <p class='empty'>No data</p>
      {{/if}}
    </div>
    <style scoped>
      .chart {
        width: 100%;
      }
      svg {
        display: block;
        width: 100%;
        height: auto;
      }
      .grid {
        stroke: var(--border, #e5e7eb);
        stroke-width: 1;
        stroke-dasharray: 2 4;
      }
      .area {
        fill: var(--primary, #111111);
        opacity: 0.07;
      }
      .line {
        fill: none;
        stroke: var(--primary, #111111);
        stroke-width: 2;
        stroke-linejoin: round;
        stroke-linecap: round;
      }
      .endpoint {
        fill: var(--primary, #111111);
        stroke: var(--card, #ffffff);
        stroke-width: 2;
      }
      .axis {
        font-size: 10px;
        fill: var(--muted-foreground, #6b7280);
        font-variant-numeric: tabular-nums;
      }
      .anchor-end {
        text-anchor: end;
      }
      .value {
        font-weight: 700;
        fill: var(--foreground, #111111);
        font-size: 11px;
      }
      .empty {
        margin: 0;
        padding: 1.5rem;
        text-align: center;
        border: 1px dashed var(--border, #e5e7eb);
        border-radius: 0.5rem;
        color: var(--muted-foreground, #6b7280);
        font-size: 0.8125rem;
      }
    </style>
  </template>
}
