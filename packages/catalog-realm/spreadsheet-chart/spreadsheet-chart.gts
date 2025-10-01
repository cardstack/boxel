import {
  CardDef,
  field,
  contains,
  linksTo,
  Component,
} from 'https://cardstack.com/base/card-api'; // ¹ Core
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import BooleanField from 'https://cardstack.com/base/boolean';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import {
  eq,
  or,
  pick,
  add,
  divide,
  subtract,
} from '@cardstack/boxel-ui/helpers';
import { concat, get, fn } from '@ember/helper';
import { Spreadsheet } from '../spreadsheet/spreadsheet'; // ² Link to source spreadsheet
import { Button } from '@cardstack/boxel-ui/components';
import {
  StackedVerticalBarRenderer,
  SingleVerticalBarRenderer,
  HorizontalBarRenderer as HBarRenderer,
  DonutRenderer,
  LineRenderer,
} from './chart-renderers'; // ⁷ Renderers

export class SpreadsheetChartIsolated extends Component<
  typeof SpreadsheetChart
> {
  // ⁷ Derived inputs
  get csvText(): string {
    try {
      return this.args.model?.source?.csvData ?? '';
    } catch {
      return '';
    }
  }

  get delimiterChar(): string {
    try {
      const d = this.args.model?.source?.delimiter;
      if (d === '\\t') return '\t';
      return d || ',';
    } catch {
      return ',';
    }
  }

  // ⁸ CSV parsing (quote aware, supports configurable delimiter)
  parseCSVLine(line: string): string[] {
    const delim = this.delimiterChar;
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      const next = line[i + 1];

      if (ch === '"' && !inQuotes) {
        inQuotes = true;
      } else if (ch === '"' && inQuotes && next === '"') {
        current += '"';
        i++;
      } else if (ch === '"' && inQuotes) {
        inQuotes = false;
      } else if (ch === delim && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    result.push(current);
    return result;
  }

  // ⁹ Rows + headers
  get rows(): string[][] {
    try {
      const text = this.csvText?.trim();
      if (!text) return [];
      const lines = text.split('\n');
      if (lines.length <= 1) return [];
      return lines.slice(1).map((l) => this.parseCSVLine(l));
    } catch {
      return [];
    }
  }

  get headers(): string[] {
    try {
      const text = this.csvText?.trim();
      if (!text) return [];
      const [head = ''] = text.split('\n');
      return this.parseCSVLine(head);
    } catch {
      return [];
    }
  }

  // ¹⁰ Auto-detection for categorical + optional binary columns
  // Helpers to evaluate columns
  private uniqueValues(colIndex: number): string[] {
    const set = new Set<string>();
    for (const r of this.rows) {
      const v = (r[colIndex] ?? '').trim();
      if (v !== '') set.add(v);
    }
    return Array.from(set);
  }

  private normalizeBooleanLabel(v: string): string | undefined {
    const t = (v || '').trim().toLowerCase();
    if (t === 'true' || t === 'yes' || t === 'y' || t === '1') return 'True';
    if (t === 'false' || t === 'no' || t === 'n' || t === '0') return 'False';
    return undefined;
  }

  get auto() {
    const headers = this.headers;

    // Respect user overrides from Edit mode
    const prefCategory = this.args.model?.categoryHeader;
    const prefBinary = this.args.model?.binaryHeader;

    const findIndex = (name?: string | null) => {
      if (!name) return -1;
      const i = headers.indexOf(name);
      return i >= 0 ? i : -1;
    };

    // Category: prefer user pick, else auto-detect
    let categoryIndex = findIndex(prefCategory);
    let categoryLabel = categoryIndex >= 0 ? headers[categoryIndex] : undefined;

    if (categoryIndex < 0) {
      // Auto-pick category column: 2–30 unique values
      const candidates: Array<{
        idx: number;
        uniques: string[];
        score: number;
      }> = [];
      const preferredNames = ['category', 'type', 'segment', 'group', 'name'];
      for (let i = 0; i < headers.length; i++) {
        const uniques = this.uniqueValues(i);
        if (uniques.length >= 2 && uniques.length <= 30) {
          const h = (headers[i] || '').toLowerCase();
          let score = 0;
          const prefIndex = preferredNames.indexOf(h);
          if (prefIndex >= 0) score += 100 - prefIndex * 10;
          score += Math.max(0, 30 - Math.abs(12 - uniques.length)); // mid-range bonus
          candidates.push({ idx: i, uniques, score });
        }
      }
      candidates.sort((a, b) => b.score - a.score);
      categoryIndex = candidates.length ? candidates[0].idx : -1;
      categoryLabel = categoryIndex >= 0 ? headers[categoryIndex] : undefined;
    }

    // Binary: prefer user pick (validated), else auto-detect
    let binaryIndex = findIndex(prefBinary);
    let binaryKinds: [string, string] | undefined = undefined;

    if (binaryIndex >= 0) {
      const u = this.uniqueValues(binaryIndex);
      if (u.length === 2) {
        const a = this.normalizeBooleanLabel(u[0]) || u[0];
        const b = this.normalizeBooleanLabel(u[1]) || u[1];
        binaryKinds = [a, b];
      } else {
        binaryIndex = -1; // invalid override → ignore
      }
    }

    if (binaryIndex < 0 && categoryIndex >= 0) {
      const binaryCandidates: Array<{
        idx: number;
        uniques: string[];
        score: number;
      }> = [];
      const binaryPreferred = [
        'isstub',
        'isactive',
        'enabled',
        'active',
        'status',
        'has*',
        'is*',
      ];
      for (let i = 0; i < headers.length; i++) {
        if (i === categoryIndex) continue;
        const uniques = this.uniqueValues(i);
        if (uniques.length === 2) {
          const h = (headers[i] || '').toLowerCase();
          let score = 1;
          const p = binaryPreferred.findIndex((p) =>
            p.endsWith('*') ? h.startsWith(p.slice(0, -1)) : h === p,
          );
          if (p >= 0) score += 100 - p * 10;

          const norm = Array.from(
            new Set(uniques.map((u) => this.normalizeBooleanLabel(u) || u)),
          );
          if (norm[0] !== undefined && norm[1] !== undefined) score += 10;

          binaryCandidates.push({ idx: i, uniques, score });
        }
      }
      binaryCandidates.sort((a, b) => b.score - a.score);
      if (binaryCandidates.length) {
        binaryIndex = binaryCandidates[0].idx;
        const raw = binaryCandidates[0].uniques;
        const a = this.normalizeBooleanLabel(raw[0]) || raw[0];
        const b = this.normalizeBooleanLabel(raw[1]) || raw[1];
        binaryKinds = [a, b];
      }
    }

    return { categoryIndex, categoryLabel, binaryIndex, binaryKinds };
  }

  // ¹¹ Aggregation: counts by category, optionally split by binary
  get series() {
    const { categoryIndex, binaryIndex, binaryKinds } = this.auto;
    if (categoryIndex < 0)
      return {
        items: [],
        max: 0,
        hasBinary: false,
        kinds: undefined as undefined | [string, string],
      };

    const byCategory: Record<string, { a: number; b: number; total: number }> =
      {};
    // Map the two binary labels to A/B in stable order
    let aLabel: string | undefined = undefined;
    let bLabel: string | undefined = undefined;

    for (const r of this.rows) {
      const cat =
        (r[categoryIndex] || 'Uncategorized').trim() || 'Uncategorized';
      const entry = (byCategory[cat] ||= { a: 0, b: 0, total: 0 });

      if (binaryIndex >= 0) {
        const raw = (r[binaryIndex] ?? '').trim();
        // Stabilize label mapping based on first-seen order
        if (aLabel === undefined) aLabel = raw || 'A';
        if (raw !== aLabel && bLabel === undefined) bLabel = raw || 'B';

        if (raw === aLabel) entry.a += 1;
        else entry.b += 1;
      } else {
        entry.a += 1; // single-series
      }
      entry.total += 1;
    }

    let items = Object.entries(byCategory).map(([category, v]) => ({
      category,
      a: v.a,
      b: v.b,
      total: v.total,
    }));
    items.sort((x, y) => y.total - x.total);
    {
      const nTop = Number(this.args.model?.topN) || 20;
      items = items.slice(0, Math.max(1, Math.min(50, nTop)));
    }

    const max = items.reduce((m, it) => Math.max(m, it.total), 0);
    const hasBinary = binaryIndex >= 0;
    const kinds: [string, string] | undefined = hasBinary
      ? binaryKinds ?? ([aLabel ?? 'A', bLabel ?? 'B'] as [string, string])
      : undefined;

    return { items, max, hasBinary, kinds };
  }

  // Enhanced SVG bar calculation with proper axis alignment
  get svgBars() {
    const margin = { top: 40, right: 30, bottom: 120, left: 60 };
    const innerW = 960 - margin.left - margin.right;
    const innerH = 400 - margin.top - margin.bottom;

    const { items, max, hasBinary } = this.series as any;
    const percent = !!this.args.model?.percentMode;
    if (!items.length || max <= 0) {
      return {
        bars: [],
        labels: [],
        dims: { margin, innerW, innerH },
        hasBinary,
      };
    }

    const n = items.length;
    const gap = Math.max(4, Math.min(12, Math.floor(innerW / (n * 10))));
    const barW = Math.max(8, Math.floor((innerW - gap * (n - 1)) / n));
    const scaleY = (value: number) => (value / max) * innerH;

    // Enhanced color palette
    const colorA = '#3b82f6'; // Modern blue
    const colorB = '#8b5cf6'; // Modern purple

    const bars = items.map((it: any, i: number) => {
      const x = margin.left + i * (barW + gap);
      const baseY = margin.top + innerH; // Bottom of chart area (X-axis position)

      if (hasBinary) {
        const base = percent ? Math.max(1, it.total) : 1;
        const hA = percent ? innerH * (it.a / base) : scaleY(it.a);
        const hB = percent ? innerH * (it.b / base) : scaleY(it.b);

        // Stack from bottom up
        const yA = baseY - hA; // Bottom segment starts at X-axis
        const yB = yA - hB; // Top segment stacks on bottom

        return {
          x,
          barW,
          aSeg: {
            x,
            y: yA,
            h: Math.max(1, hA),
            fill: colorA,
          },
          bSeg: {
            x,
            y: yB,
            h: Math.max(1, hB),
            fill: colorB,
          },
          label: it.category,
          total: it.total,
          valueA: it.a,
          valueB: it.b,
        };
      } else {
        const h = Math.max(1, scaleY(it.total));
        const y = baseY - h; // Single bar starts at X-axis and grows upward

        return {
          x,
          barW,
          singleSeg: {
            x,
            y,
            h,
            fill: colorA,
          },
          label: it.category,
          total: it.total,
          valueA: it.total,
        };
      }
    });

    const labels = bars.map((b: any) => ({
      x: b.x + b.barW / 2,
      y: margin.top + innerH + 20,
      text: b.label.length > 12 ? b.label.substring(0, 10) + '...' : b.label,
      fullText: b.label,
    }));

    return { bars, labels, dims: { margin, innerW, innerH }, hasBinary };
  }

  // New: determine effective chart type based on user choice and data
  get effectiveChartType(): string {
    try {
      const req = (this.args.model?.chartType || 'auto').trim();
      const hasBinary = (this.series as any).hasBinary;
      if (req === 'horizontalBar') return 'horizontalBar';
      if (req === 'stackedBar') return hasBinary ? 'stackedBar' : 'bar';
      if (req === 'bar') return 'bar';
      if (req === 'pie') return 'pie';
      if (req === 'donut') return 'donut';
      if (req === 'line') return 'line';
      // auto
      return hasBinary ? 'stackedBar' : 'bar';
    } catch {
      return 'bar';
    }
  }

  // Enhanced horizontal bars with better styling
  get hSvg() {
    const margin = { top: 40, right: 60, bottom: 50, left: 200 };
    const innerW = 960 - margin.left - margin.right;
    const innerH = 400 - margin.top - margin.bottom;

    const { items, max } = this.series as any;
    if (!items.length || max <= 0) {
      return { bars: [], labels: [], dims: { margin, innerW, innerH } };
    }

    const n = items.length;
    const gap = Math.max(4, Math.min(12, Math.floor(innerH / (n * 6))));
    const barH = Math.max(12, Math.floor((innerH - gap * (n - 1)) / n));
    const scaleX = (value: number) => (value / max) * innerW;

    const color = '#3b82f6';
    const shadowColor = '#1d4ed8';

    const bars = items.map((it: any, i: number) => {
      const y = margin.top + i * (barH + gap);
      const w = Math.max(8, scaleX(it.total));
      const x = margin.left;
      const labelX = Math.min(x + w + 12, margin.left + innerW - 10);
      const labelY = y + Math.floor(barH / 2) + 4;

      return {
        x,
        y,
        barH,
        w,
        fill: color,
        shadow: shadowColor,
        label: it.category,
        total: it.total,
        labelX,
        labelY,
      };
    });

    const labels = items.map((it: any, i: number) => {
      const text =
        it.category.length > 24
          ? it.category.substring(0, 22) + '...'
          : it.category;
      return {
        x: margin.left - 12,
        y: margin.top + i * (barH + gap) + Math.floor(barH / 2) + 4,
        text,
        fullText: it.category,
      };
    });

    return { bars, labels, dims: { margin, innerW, innerH } };
  }

  // Enhanced donut/pie with better visual design
  get donutData() {
    // Attempt to use yHeader if valid
    const headers = this.headers;
    const yName = this.args.model?.yHeader || '';
    const yi = headers.indexOf(yName);
    const { categoryIndex } = this.auto;

    let pairs: Array<{ category: string; value: number }>;

    if (categoryIndex >= 0 && yi >= 0) {
      // Sum numeric values by category from raw rows
      const sumMap = new Map<string, number>();
      for (const r of this.rows) {
        const cat =
          (r[categoryIndex] || 'Uncategorized').trim() || 'Uncategorized';
        const v = parseFloat((r[yi] ?? '').trim());
        if (!Number.isFinite(v)) continue;
        sumMap.set(cat, (sumMap.get(cat) ?? 0) + v);
      }
      pairs = Array.from(sumMap.entries()).map(([category, value]) => ({
        category,
        value,
      }));
      // Top N by value
      const nTop = Number(this.args.model?.topN) || 20;
      pairs.sort((a, b) => b.value - a.value);
      pairs = pairs.slice(0, Math.max(1, Math.min(50, nTop)));
    } else {
      // Fallback to counts from series
      const { items } = this.series as any; // [{category,total}]
      pairs = items.map((it: any) => ({
        category: it.category,
        value: it.total,
      }));
    }

    const total = pairs.reduce((s, it) => s + it.value, 0);
    if (!pairs.length || total <= 0) {
      // Provide reasonable defaults
      const isPie = this.effectiveChartType === 'pie';
      return {
        slices: [],
        cx: 480,
        cy: 200,
        r: isPie ? 100 : 120,
        stroke: isPie ? 200 : 40,
      };
    }

    // Enhanced geometry
    const isPie = this.effectiveChartType === 'pie';
    const cx = 480,
      cy = 200;
    const r = isPie ? 100 : 120;
    const stroke = isPie ? 200 : 40;
    const C = 2 * Math.PI * r;

    // Enhanced modern color palette
    const colors = [
      '#3b82f6', // Blue
      '#8b5cf6', // Purple
      '#10b981', // Emerald
      '#f59e0b', // Amber
      '#ef4444', // Red
      '#ec4899', // Pink
      '#06b6d4', // Cyan
      '#84cc16', // Lime
      '#f97316', // Orange
      '#6366f1', // Indigo
      '#14b8a6', // Teal
      '#f43f5e', // Rose
    ];

    let acc = 0;
    const slices = pairs.map((it, i) => {
      const pct = it.value / total;
      const dash = pct * C;
      const gap = C - dash;
      const offset = -acc * C;
      acc += pct;

      return {
        label: it.category,
        value: it.value,
        percentage: Math.round(pct * 100),
        color: colors[i % colors.length],
        dash,
        gap,
        offset,
      };
    });

    return { slices, cx, cy, r, stroke, total };
  }

  // New: line precomputation (X vs numeric Y)
  get lineSvg() {
    const headers = this.headers;
    const xName = this.args.model?.xHeader || headers[0];
    const yName = this.args.model?.yHeader || headers[1];
    const xi = headers.indexOf(xName ?? '');
    const yi = headers.indexOf(yName ?? '');
    if (xi < 0 || yi < 0)
      return {
        pointsString: '',
        points: [],
        labels: [],
        dims: {
          margin: { top: 30, right: 20, bottom: 120, left: 48 },
          innerW: 912 - 48,
          innerH: 330 - 30,
        },
      };

    // Aggregate by X (sum Y)
    const map = new Map<string, number>();
    for (const r of this.rows) {
      const k = (r[xi] ?? '').trim();
      const y = parseFloat((r[yi] ?? '').trim());
      if (!k || !Number.isFinite(y)) continue;
      map.set(k, (map.get(k) ?? 0) + y);
    }
    let data = Array.from(map.entries()).map(([x, y]) => ({ x, y }));
    if (!data.length)
      return {
        pointsString: '',
        points: [],
        labels: [],
        dims: {
          margin: { top: 30, right: 20, bottom: 120, left: 48 },
          innerW: 912 - 48,
          innerH: 330 - 30,
        },
      };

    // Sort X (try numeric/date, else alpha)
    const tryNum = data.every((d) => !isNaN(Number(d.x)));
    if (tryNum) {
      data.sort((a, b) => Number(a.x) - Number(b.x));
    } else {
      // try Date
      const toT = (s: string) => Date.parse(s);
      const isDates = data.every((d) => !isNaN(toT(d.x)));
      if (isDates) {
        data.sort((a, b) => Date.parse(a.x) - Date.parse(b.x));
      } else {
        data.sort((a, b) => a.x.localeCompare(b.x));
      }
    }

    const margin = { top: 30, right: 20, bottom: 120, left: 48 };
    const innerW = 960 - margin.left - margin.right;
    const innerH = 360 - margin.top - margin.bottom;
    const maxY = data.reduce((m, d) => Math.max(m, d.y), 0);

    // scales
    const n = data.length;
    const step = n > 1 ? innerW / (n - 1) : 0;
    const xAt = (i: number) => margin.left + i * step;
    const yAt = (v: number) => margin.top + (innerH - (v / maxY) * innerH);

    const points = data.map((d, i) => ({ x: xAt(i), y: yAt(d.y) }));
    const pointsString = points.map((p) => `${p.x},${p.y}`).join(' ');

    const labels = data.map((d, i) => ({
      x: xAt(i),
      y: margin.top + innerH + 16,
      text: d.x,
    }));

    return { pointsString, points, labels, dims: { margin, innerW, innerH } };
  }

  get showChart(): boolean {
    return this.series.items.length > 0 && this.series.max > 0;
  }

  openSource = () => {
    try {
      const src = this.args.model?.source;
      if (!src) return;
      if (this.args.viewCard) {
        // Open source in the side panel (rightmost stack)
        this.args.viewCard(src, 'isolated', { openCardInRightMostStack: true });
      }
    } catch (e) {
      console.error('Open source failed', e);
    }
  };

  <template>
    <div class='chart-container'>
      <header class='chart-header'>
        <div class='head-left'>
          <h1 class='chart-title'>
            <svg
              class='title-icon'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <path d='M3 3v18h18' />
              <path d='M18.7 8l-5.1 5.2-2.8-2.7L7 14.3' />
            </svg>
            {{@model.title}}
          </h1>
        </div>
        <div class='chart-controls'>
          {{#if @model.source}}
            <Button
              class='open-source-btn'
              {{on 'click' this.openSource}}
              title='Open source spreadsheet in side panel'
            >
              <svg
                class='btn-icon'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <path
                  d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'
                />
                <polyline points='14,2 14,8 20,8' />
                <line x1='16' y1='13' x2='8' y2='13' />
                <line x1='16' y1='17' x2='8' y2='17' />
                <polyline points='10,9 9,9 8,9' />
              </svg>
              View Source
            </Button>
          {{/if}}
        </div>
      </header>

      {{#if this.showChart}}
        <div class='chart-wrapper'>
          <div class='svg-wrapper'>
            <svg
              viewBox='0 0 960 400'
              class='chart-svg'
              role='img'
              aria-label='Data visualization chart'
            >
              <!-- Enhanced grid lines for bar charts only -->
              {{#unless
                (or
                  (eq this.effectiveChartType 'pie')
                  (eq this.effectiveChartType 'donut')
                )
              }}
                <defs>
                  <pattern
                    id='grid'
                    width='40'
                    height='40'
                    patternUnits='userSpaceOnUse'
                  >
                    <path
                      d='M 40 0 L 0 0 0 40'
                      fill='none'
                      stroke='#f3f4f6'
                      stroke-width='0.5'
                    />
                  </pattern>
                </defs>
                <rect
                  width='100%'
                  height='100%'
                  fill='url(#grid)'
                  opacity='0.5'
                />
              {{/unless}}

              <!-- Axes - different for each chart type -->
              {{#if (eq this.effectiveChartType 'horizontalBar')}}
                <!-- Horizontal bar axes -->
                <line
                  x1='200'
                  y1='40'
                  x2='200'
                  y2='350'
                  stroke='#374151'
                  stroke-width='2'
                />
                <line
                  x1='200'
                  y1='350'
                  x2='900'
                  y2='350'
                  stroke='#374151'
                  stroke-width='2'
                />
              {{else if
                (or
                  (eq this.effectiveChartType 'line')
                  (eq this.effectiveChartType 'bar')
                  (eq this.effectiveChartType 'stackedBar')
                )
              }}
                <!-- Vertical chart axes -->
                <line
                  x1='60'
                  y1='40'
                  x2='60'
                  y2='280'
                  stroke='#374151'
                  stroke-width='2'
                />
                <line
                  x1='60'
                  y1='280'
                  x2='930'
                  y2='280'
                  stroke='#374151'
                  stroke-width='2'
                />
              {{/if}}
              <!-- Pie and donut charts have no axes -->

              {{#if (eq this.effectiveChartType 'horizontalBar')}}
                <!-- Horizontal bars -->
                {{#let this.hSvg as |H|}}
                  <HBarRenderer @bars={{H.bars}} @labels={{H.labels}} />
                {{/let}}
              {{else if
                (or
                  (eq this.effectiveChartType 'pie')
                  (eq this.effectiveChartType 'donut')
                )
              }}
                <!-- Donut/Pie with enhanced styling -->
                {{#let this.donutData as |D|}}
                  <DonutRenderer
                    @slices={{D.slices}}
                    @cx={{D.cx}}
                    @cy={{D.cy}}
                    @r={{D.r}}
                    @stroke={{D.stroke}}
                  />
                {{/let}}
              {{else if (eq this.effectiveChartType 'line')}}
                <!-- Line with enhanced styling -->
                {{#let this.lineSvg as |L|}}
                  <LineRenderer
                    @pointsString={{L.pointsString}}
                    @points={{L.points}}
                    @labels={{L.labels}}
                  />
                {{/let}}
              {{else}}
                <!-- Enhanced vertical bars -->
                {{#if this.svgBars.hasBinary}}
                  <StackedVerticalBarRenderer @bars={{this.svgBars.bars}} />
                {{else}}
                  <SingleVerticalBarRenderer @bars={{this.svgBars.bars}} />
                {{/if}}
                {{#each this.svgBars.labels as |lbl|}}
                  <text
                    x={{lbl.x}}
                    y={{lbl.y}}
                    text-anchor='end'
                    transform={{concat 'rotate(-45 ' lbl.x ' ' lbl.y ')'}}
                    class='x-axis-label'
                  >{{lbl.text}}</text>
                {{/each}}
              {{/if}}

              <!-- Enhanced legend with better positioning -->
              <g class='chart-legend' transform='translate(60, 15)'>
                {{#if this.series.hasBinary}}
                  <g class='legend-item' transform='translate(0, 0)'>
                    <rect width='12' height='12' fill='#3b82f6' rx='3' />
                    <text x='18' y='9' class='legend-text'>{{get
                        this.series.kinds
                        0
                      }}</text>
                  </g>
                  <g class='legend-item' transform='translate(120, 0)'>
                    <rect width='12' height='12' fill='#8b5cf6' rx='3' />
                    <text x='18' y='9' class='legend-text'>{{get
                        this.series.kinds
                        1
                      }}</text>
                  </g>
                {{else}}
                  <g class='legend-item' transform='translate(0, 0)'>
                    <rect width='12' height='12' fill='#3b82f6' rx='3' />
                    <text x='18' y='9' class='legend-text'>Count</text>
                  </g>
                {{/if}}
              </g>

              <!-- Value labels on bars showing totals -->
              {{#each this.svgBars.bars as |bar|}}
                {{#if bar.singleSeg}}
                  <!-- Single bar total -->
                  <text
                    x={{add bar.x (divide bar.barW 2)}}
                    y={{subtract bar.singleSeg.y 8}}
                    text-anchor='middle'
                    class='bar-value-label'
                  >
                    {{bar.total}}
                  </text>
                {{else}}
                  <!-- Stacked bar total -->
                  <text
                    x={{add bar.x (divide bar.barW 2)}}
                    y={{subtract bar.bSeg.y 8}}
                    text-anchor='middle'
                    class='bar-value-label'
                  >
                    {{bar.total}}
                  </text>
                {{/if}}
              {{/each}}
            </svg>
          </div>
        </div>
      {{else}}
        <div class='empty-state'>
          <svg
            class='empty-icon'
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            stroke-width='1.5'
          >
            <path d='M9 17H7A5 5 0 0 1 7 7h2' />
            <path d='M15 7h2a5 5 0 1 1 0 10h-2' />
            <line x1='8' y1='12' x2='16' y2='12' />
          </svg>
          <div class='empty-content'>
            {{#if (eq this.csvText '')}}
              <h3>No Data Available</h3>
              <p>No data found in the linked spreadsheet. Please ensure your
                spreadsheet contains data.</p>
            {{else}}
              <h3>Unable to Generate Chart</h3>
              <p>Cannot auto-detect suitable columns. Please ensure you have:</p>
              <ul>
                <li>One categorical column with 2-30 distinct values</li>
                <li>Optionally, a binary column with exactly 2 distinct values
                  for stacked charts</li>
              </ul>
            {{/if}}
          </div>
        </div>
      {{/if}}

      <footer class='chart-footer'>
        {{#if @model.source}}
          <div class='source-attribution'>
            <svg
              class='source-icon'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='1.5'
            >
              <path
                d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'
              />
              <polyline points='14,2 14,8 20,8' />
            </svg>
            <span>Data source: <strong>{{@model.source.title}}</strong></span>
          </div>
        {{/if}}
        <div class='chart-type-indicator'>
          <span class='chart-type-label'>{{this.effectiveChartType}}</span>
        </div>
      </footer>
    </div>
    <style scoped>
      /* Enhanced Container Styling */
      .chart-container {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        padding: 1.5rem;
        height: 100%;
        box-sizing: border-box;
        background: linear-gradient(135deg, #f8fafc 0%, #ffffff 100%);
        font-family:
          'Inter',
          -apple-system,
          BlinkMacSystemFont,
          sans-serif;
      }

      /* Enhanced Header */
      .chart-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 1rem;
        padding-bottom: 1rem;
        border-bottom: 2px solid #e5e7eb;
      }

      .head-left {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        flex: 1;
      }

      .chart-title {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        margin: 0;
        font-size: 1.5rem;
        font-weight: 700;
        color: #111827;
        line-height: 1.2;
      }

      .title-icon {
        width: 1.75rem;
        height: 1.75rem;
        color: #3b82f6;
        flex-shrink: 0;
      }

      .subtitle {
        font-size: 0.9375rem;
        color: #6b7280;
        font-weight: 500;
        margin-left: 2.5rem;
      }

      .chart-controls {
        display: flex;
        gap: 0.75rem;
        align-items: flex-start;
      }

      /* Enhanced Button Styling */
      .open-source-btn {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.625rem 1rem;
        font-size: 0.875rem;
        font-weight: 600;
        background: linear-gradient(135deg, #10b981 0%, #059669 100%);
        color: white;
        border: none;
        border-radius: 0.5rem;
        cursor: pointer;
        transition: all 0.2s ease;
        box-shadow: 0 2px 4px rgba(16, 185, 129, 0.2);
      }

      .open-source-btn:hover {
        background: linear-gradient(135deg, #059669 0%, #047857 100%);
        transform: translateY(-1px);
        box-shadow: 0 4px 8px rgba(16, 185, 129, 0.3);
      }

      .btn-icon {
        width: 1rem;
        height: 1rem;
        flex-shrink: 0;
      }

      /* Chart Wrapper */
      .chart-wrapper {
        flex: 1;
      }

      /* Enhanced SVG Wrapper */
      .svg-wrapper {
        flex: 1;
        min-height: 300px;
        background: white;
        border: 1px solid #e5e7eb;
        border-radius: 0.75rem;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);
        overflow: hidden;
        position: relative;
      }

      .chart-svg {
        width: 100%;
        height: 100%;
        display: block;
        min-height: 300px;
      }

      /* Enhanced Typography */
      .x-axis-label {
        font-size: 11px;
        fill: #374151;
        font-weight: 500;
      }

      .legend-text {
        font-size: 12px;
        fill: #374151;
        font-weight: 600;
      }

      .chart-legend .legend-item {
        cursor: default;
      }

      /* Bar value labels */
      .bar-value-label {
        font-size: 11px;
        fill: #374151;
        font-weight: 600;
      }

      /* Enhanced Empty State */
      .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 1rem;
        padding: 3rem 2rem;
        border: 2px dashed #d1d5db;
        background: #f9fafb;
        border-radius: 0.75rem;
        text-align: center;
        min-height: 200px;
      }

      .empty-icon {
        width: 3rem;
        height: 3rem;
        color: #9ca3af;
      }

      .empty-content h3 {
        margin: 0 0 0.5rem 0;
        font-size: 1.125rem;
        font-weight: 600;
        color: #374151;
      }

      .empty-content p {
        margin: 0 0 0.75rem 0;
        font-size: 0.875rem;
        color: #6b7280;
        line-height: 1.5;
      }

      .empty-content ul {
        text-align: left;
        font-size: 0.8125rem;
        color: #6b7280;
        margin: 0;
        padding-left: 1.25rem;
      }

      .empty-content li {
        margin-bottom: 0.25rem;
      }

      /* Enhanced Footer */
      .chart-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        margin-top: auto;
        padding-top: 1rem;
        border-top: 1px solid #e5e7eb;
        font-size: 0.8125rem;
      }

      .source-attribution {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        color: #6b7280;
      }

      .source-icon {
        width: 1rem;
        height: 1rem;
        color: #9ca3af;
      }

      .chart-type-indicator {
        display: flex;
        align-items: center;
        gap: 0.25rem;
      }

      .chart-type-label {
        padding: 0.25rem 0.5rem;
        background: #f3f4f6;
        color: #374151;
        border-radius: 0.25rem;
        font-size: 0.75rem;
        font-weight: 500;
        text-transform: capitalize;
      }

      /* Responsive Design */
      @media (max-width: 768px) {
        .chart-container {
          padding: 1rem;
          gap: 0.75rem;
        }

        .chart-header {
          flex-direction: column;
          align-items: stretch;
          gap: 0.75rem;
        }

        .chart-title {
          font-size: 1.25rem;
        }

        .subtitle {
          margin-left: 2.25rem;
          font-size: 0.875rem;
        }

        .chart-insights {
          flex-direction: column;
          gap: 0.5rem;
        }

        .insight-card {
          padding: 0.5rem 0.75rem;
        }

        .chart-footer {
          flex-direction: column;
          align-items: stretch;
          gap: 0.5rem;
          text-align: center;
        }
      }
    </style>
  </template>
}

class SpreadsheetChartEdit extends Component<typeof SpreadsheetChart> {
  // Local CSV header parsing for the source (quote-aware, delimiter-aware)
  get delimiterChar(): string {
    try {
      const d = this.args.model?.source?.delimiter;
      return d === '\\t' ? '\t' : d || ',';
    } catch {
      return ',';
    }
  }
  parseCSVLine(line: string): string[] {
    const delim = this.delimiterChar;
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      const next = line[i + 1];
      if (ch === '"' && !inQuotes) inQuotes = true;
      else if (ch === '"' && inQuotes && next === '"') {
        current += '"';
        i++;
      } else if (ch === '"' && inQuotes) inQuotes = false;
      else if (ch === delim && !inQuotes) {
        result.push(current);
        current = '';
      } else current += ch;
    }
    result.push(current);
    return result;
  }
  get headers(): string[] {
    try {
      const text = this.args.model?.source?.csvData ?? '';
      if (!text.trim()) return [];
      const [head = ''] = text.split('\n');
      return this.parseCSVLine(head);
    } catch {
      return [];
    }
  }

  // Tracked text for number input (decoupled from model while typing)
  @tracked topNField: string = '';

  constructor(owner: unknown, args: any) {
    // @ts-ignore
    super(owner, args);
    const v = Number(this.args.model?.topN);
    this.topNField = Number.isFinite(v) && v > 0 ? String(v) : '';
  }

  // Handlers
  updateCategory = (e: Event) => {
    const val = (e.target as HTMLSelectElement)?.value ?? '';
    if (this.args.model) this.args.model.categoryHeader = val || (null as any);
  };
  updateBinary = (e: Event) => {
    const val = (e.target as HTMLSelectElement)?.value ?? '';
    if (this.args.model) this.args.model.binaryHeader = val || (null as any);
  };
  updateChartType = (e: Event) => {
    const val = (e.target as HTMLSelectElement)?.value ?? 'auto';
    if (this.args.model) this.args.model.chartType = (val || 'auto') as any;
  };
  updateTopN = (e: Event) => {
    const val = (e.target as HTMLInputElement)?.value ?? '';
    this.topNField = val;

    if (!this.args.model) return;

    // Allow clearing while typing without fighting the user
    if (val === '') {
      return;
    }

    const n = Number(val);
    if (Number.isFinite(n)) {
      const clamped = Math.max(1, Math.min(50, Math.floor(n)));
      this.args.model.topN = clamped as any;
    }
  };

  // Commit on blur: coerce/clamp or clear
  commitTopN = () => {
    if (!this.args.model) return;

    const n = Number(this.topNField);
    if (!Number.isFinite(n) || this.topNField === '') {
      this.args.model.topN = null as any;
      this.topNField = '';
      return;
    }
    const clamped = Math.max(1, Math.min(50, Math.floor(n)));
    this.args.model.topN = clamped as any;
    this.topNField = String(clamped);
  };
  togglePercent = (e: Event) => {
    const checked = (e.target as HTMLInputElement)?.checked ?? false;
    if (this.args.model) this.args.model.percentMode = checked as any;
  };

  <template>
    <div class='edit-panel'>
      <div class='row'>
        <label>Source Spreadsheet</label>
        <@fields.source />
      </div>

      <div class='row'>
        <label>Card Info</label>
        <@fields.cardInfo @format='edit' />
      </div>

      <div class='row'>
        <label>Chart type</label>
        <select {{on 'change' this.updateChartType}}>
          <option value='auto' selected={{eq @model.chartType 'auto'}}>Auto
            (stacked if 2-value split exists)</option>
          <option
            value='stackedBar'
            selected={{eq @model.chartType 'stackedBar'}}
          >Stacked Bar</option>
          <option value='bar' selected={{eq @model.chartType 'bar'}}>Vertical
            Bar</option>
          <option
            value='horizontalBar'
            selected={{eq @model.chartType 'horizontalBar'}}
          >Horizontal Bar</option>
          <option
            value='pie'
            selected={{eq @model.chartType 'pie'}}
          >Pie</option>
          <option
            value='donut'
            selected={{eq @model.chartType 'donut'}}
          >Donut</option>
          <option
            value='line'
            selected={{eq @model.chartType 'line'}}
          >Line</option>
        </select>
      </div>

      <div class='row'>
        <label>Category column</label>
        <select {{on 'change' this.updateCategory}}>
          <option value=''></option>
          {{#each this.headers as |h|}}
            <option
              selected={{eq h @model.categoryHeader}}
              value={{h}}
            >{{h}}</option>
          {{/each}}
        </select>
      </div>

      <div class='row'>
        <label>Binary split (optional)</label>
        <select {{on 'change' this.updateBinary}}>
          <option value=''></option>
          {{#each this.headers as |h|}}
            <option
              selected={{eq h @model.binaryHeader}}
              value={{h}}
            >{{h}}</option>
          {{/each}}
        </select>
      </div>

      <!-- Line chart controls -->
      <div class='row'>
        <label>X axis (for line)</label>
        <select {{on 'change' (pick 'target.value' (fn (mut @model.xHeader)))}}>
          <option value=''></option>
          {{#each this.headers as |h|}}
            <option selected={{eq h @model.xHeader}} value={{h}}>{{h}}</option>
          {{/each}}
        </select>
      </div>

      <div class='row'>
        <label>Value (numeric Y, for line or pie/donut sums)</label>
        <select {{on 'change' (pick 'target.value' (fn (mut @model.yHeader)))}}>
          <option value=''></option>
          {{#each this.headers as |h|}}
            <option selected={{eq h @model.yHeader}} value={{h}}>{{h}}</option>
          {{/each}}
        </select>
      </div>

      <div class='row'>
        <label>Top N categories</label>
        <input
          type='number'
          min='1'
          max='50'
          value={{this.topNField}}
          {{on 'input' this.updateTopN}}
          {{on 'blur' this.commitTopN}}
        />
      </div>

      <div class='row checkbox'>
        <label>
          <input
            type='checkbox'
            checked={{@model.percentMode}}
            {{on 'change' this.togglePercent}}
          />
          Show stacked percentages (when binary is present)
        </label>
      </div>

      <p class='hint'>
        Tip: Leave fields empty to auto-detect columns. Binary expects a column
        with exactly 2 distinct values.
      </p>
    </div>
    <style scoped>
      .edit-panel {
        display: grid;
        gap: 0.75rem;
        padding: 0.75rem;
      }
      .row {
        display: grid;
        gap: 0.25rem;
      }
      .row.checkbox {
        align-items: center;
      }
      label {
        font-size: 0.8125rem;
        color: #374151;
        font-weight: 600;
      }
      select,
      input[type='number'] {
        padding: 0.375rem 0.5rem;
        border: 1px solid #e5e7eb;
        border-radius: 0.375rem;
        font-size: 0.8125rem;
        background: white;
      }
      .hint {
        font-size: 0.75rem;
        color: #6b7280;
        margin-top: 0.25rem;
      }
    </style>
  </template>
}

export class SpreadsheetChart extends CardDef {
  // ³ Definition
  static displayName = 'Spreadsheet Chart';
  // static icon = SomeChartIcon;

  @field name = contains(StringField); // ⁴ Optional name
  @field source = linksTo(Spreadsheet); // ⁵ Link to Spreadsheet card

  // User preferences (Edit mode)
  @field categoryHeader = contains(StringField);
  @field binaryHeader = contains(StringField);
  @field topN = contains(NumberField);
  @field percentMode = contains(BooleanField);
  @field chartType = contains(StringField); // 'auto' | 'stackedBar' | 'bar' | 'horizontalBar' | 'pie' | 'donut' | 'line'
  @field xHeader = contains(StringField); // For line chart X
  @field yHeader = contains(StringField); // For line chart Y (numeric)

  @field title = contains(StringField, {
    // ⁶ Title
    computeVia: function (this: SpreadsheetChart) {
      // Prefer explicit name; else use spreadsheet title
      try {
        // @ts-ignore
        const srcTitle = (this as any).source?.title;
        // @ts-ignore
        const srcName = (this as any).source?.name;
        return (
          this.name ??
          srcTitle ??
          (srcName ? `${srcName} Chart` : 'Spreadsheet Chart')
        );
      } catch {
        return this.name ?? 'Spreadsheet Chart';
      }
    },
  });

  // =============== Isolated (SVG stacked bar chart) ===============
  static isolated = SpreadsheetChartIsolated;

  // =============== Edit (user controls) ===============
  static edit = SpreadsheetChartEdit;

  // =============== Embedded (compact summary) ===============
  static embedded = class Embedded extends Component<typeof SpreadsheetChart> {
    get summary(): string {
      try {
        const text = this.args.model?.source?.csvData ?? '';
        if (!text.trim()) return 'No data';
        const lines = text.split('\n');
        const rows = Math.max(0, lines.length - 1);
        return `${rows} rows • Auto: categorical chart`;
      } catch {
        return 'No data';
      }
    }

    <template>
      <div class='chart-embedded'>
        <div class='title'>{{if
            @model.title
            @model.title
            'Spreadsheet Chart'
          }}</div>
        <div class='meta'>{{this.summary}}</div>
      </div>
      <style scoped>
        .chart-embedded {
          padding: 0.75rem;
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 0.5rem;
        }
        .title {
          font-size: 0.9375rem;
          font-weight: 600;
          color: #111827;
        }
        .meta {
          font-size: 0.8125rem;
          color: #6b7280;
        }
      </style>
    </template>
  };

  // =============== Fitted (responsive tiles) ===============
  static fitted = class Fitted extends Component<typeof SpreadsheetChart> {
    get mini(): string {
      try {
        const text = this.args.model?.source?.csvData ?? '';
        if (!text.trim()) return 'No data';
        const lines = text.split('\n');
        const rows = Math.max(0, lines.length - 1);
        return `${rows} rows`;
      } catch {
        return 'No data';
      }
    }

    <template>
      <div class='fitted-container'>
        <div class='badge-format'>
          <div class='badge-icon'>📊</div>
          <div class='badge-text'>{{this.mini}}</div>
        </div>

        <div class='strip-format'>
          <div class='strip-icon'>📊</div>
          <div class='strip-text'>
            <div class='t1'>{{if
                @model.title
                @model.title
                'Spreadsheet Chart'
              }}</div>
            <div class='t2'>{{this.mini}} • categorical chart</div>
          </div>
        </div>

        <div class='tile-format'>
          <div class='t-head'>
            <div class='tile-icon'>📊</div>
            <div class='t1'>{{if
                @model.title
                @model.title
                'Spreadsheet Chart'
              }}</div>
          </div>
          <div class='t2'>{{this.mini}} • categorical chart</div>
        </div>

        <div class='card-format'>
          <div class='c-head'>
            <div class='tile-icon'>📊</div>
            <div class='t1'>{{if
                @model.title
                @model.title
                'Spreadsheet Chart'
              }}</div>
          </div>
          <div class='t2'>{{this.mini}} • categorical chart</div>
        </div>
      </div>
      <style scoped>
        .fitted-container {
          width: 100%;
          height: 100%;
          container-type: size;
        }
        .badge-format,
        .strip-format,
        .tile-format,
        .card-format {
          display: none;
          width: 100%;
          height: 100%;
          padding: clamp(0.1875rem, 2%, 0.625rem);
          box-sizing: border-box;
        }
        @container (max-width: 150px) and (max-height: 169px) {
          .badge-format {
            display: flex;
            gap: 0.25rem;
            align-items: center;
          }
        }
        @container (min-width: 151px) and (max-height: 169px) {
          .strip-format {
            display: flex;
            gap: 0.5rem;
            align-items: center;
          }
        }
        @container (max-width: 399px) and (min-height: 170px) {
          .tile-format {
            display: flex;
            flex-direction: column;
            gap: 0.25rem;
          }
        }
        @container (min-width: 400px) and (min-height: 170px) {
          .card-format {
            display: flex;
            flex-direction: column;
            gap: 0.5rem;
          }
        }

        .badge-icon {
          font-size: 1rem;
        }
        .badge-text {
          font-size: 0.75rem;
          font-weight: 600;
        }
        .strip-icon {
          font-size: 1.125rem;
        }
        .strip-text .t1 {
          font-size: 0.875rem;
          font-weight: 600;
        }
        .strip-text .t2 {
          font-size: 0.75rem;
          color: #6b7280;
        }
        .tile-icon {
          font-size: 1.25rem;
        }
        .t-head {
          display: flex;
          gap: 0.5rem;
          align-items: center;
        }
        .t1 {
          font-weight: 600;
          color: #111827;
          font-size: 0.875rem;
        }
        .t2 {
          font-size: 0.75rem;
          color: #6b7280;
        }
      </style>
    </template>
  };
}
