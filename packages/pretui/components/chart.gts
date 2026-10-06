// Pretui — Chart: one chart component over Observable Plot with a @mark vocabulary.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { htmlSafe } from '@ember/template';
import { DataShell, DataSource } from '../data-component';
import type { DataArgs } from '../data-component';
import { cssStyleFrom, cssDeclaration } from '../pretui-css';
import { areaY, axisX, axisY, barX, barY, binX, cell, dot, gridX, gridY, line, lineY, rectY, ruleY, waffleY } from '../plot/index.js';
import { BORDER, CARD, HUES, INK, MARK_NOUN, PLOT_STYLE, RAMP, asNumber, channelLabel, displayValue, plotInto, readChannel } from '../internal/structure-chart';
import type { ChartChannel, ChartDraw, ChartMark, ChartScaleType, PlotMark, PlotOptions, PlotSpec } from '../internal/structure-chart';

// ── Chart ────────────────────────────────────────────────────────────────

export interface ChartArgs<T> extends DataArgs<T> {
  /** Which mark to draw. See `ChartMark` for the full table. Default `line`. */
  mark?: ChartMark;
  /** The horizontal channel. Always horizontal, for every mark. */
  x?: ChartChannel<T>;
  /** The vertical channel. Omitted for `histogram`, which counts. */
  y?: ChartChannel<T>;
  /** Splits the data into coloured series and drives the legend. */
  series?: ChartChannel<T>;
  /** The auxiliary quantitative channel: heat-map magnitude, bubble radius,
   * or the second endpoint for band, timeline, waterfall and dumbbell. */
  value?: ChartChannel<T>;
  /** Human label for `@x` in the axis, summary and table. Defaults to the key. */
  xLabel?: string;
  /** Human label for `@y`. Defaults to the key. */
  yLabel?: string;
  /** Human label for `@series`. Defaults to the key. */
  seriesLabel?: string;
  /** Human label for `@value`. Defaults to the key. */
  valueLabel?: string;
  /** Pin the horizontal scale type instead of letting Plot infer it. */
  xType?: ChartScaleType;
  /** Pin the vertical scale type. */
  yType?: ChartScaleType;
  /** Drawing height in px, excluding legend and table. Default 300. */
  height?: number;
  /** Stack multi-series `area` instead of overlaying it. Default true, which
   * is Plot's own implicit `stackY`.
   *
   * NAMED UNFINISHED EDGE (Law 7): multi-series `bar` ALWAYS stacks and
   * ignores this. Placing bars side by side needs Plot's `dodgeX` transform,
   * which is not in the vendored lean entry — adding it means re-bundling
   * Plot, not writing a flag. */
  stacked?: boolean;
  /** Draw a point at every datum on `line`/`area`. Default true under 120 points. */
  points?: boolean;
  /** Curve name for `line`/`area`. Default `monotone-x`; `linear` for none. */
  curve?: string;
  /** Bin count hint for `histogram`. Default lets Plot choose. */
  bins?: number;
  /** Force the vertical scale through zero. Default true except `scatter`. */
  zero?: boolean;
  /** Accessible name for the chart. Prepended to the generated summary. */
  label?: string;
  /** A caption printed under the chart, for the reader rather than the axis. */
  caption?: string;
  /** Hide the series legend even when a `@series` channel is present. */
  hideLegend?: boolean;
  /** Hide the data-table disclosure. Costs the chart its text alternative —
   * only reach for this when the same numbers are already in a table beside
   * it, and say so in `@label`. */
  hideTable?: boolean;
  /** Rows rendered in the data table before it truncates. Default 100. */
  tableLimit?: number;
  /** Encode series as point symbols as well as colour. Default true. */
  symbols?: boolean;
}

export interface ChartSignature<T> {
  Args: ChartArgs<T>;
  Blocks: {
    /** Replaces the default toolbar row above the plot. */
    header: [];
    /** Replaces the default spinner + skeleton. */
    loading: [];
    /** Replaces the default EmptyState. */
    empty: [];
    /** Replaces the default Alert. */
    error: [];
  };
  Element: HTMLDivElement;
}

interface LegendKey {
  name: string;
  style: ReturnType<typeof htmlSafe> | undefined;
  hidden: boolean;
  pressed: 'true' | 'false';
}

/**
 * A plot, its legend, its summary and its data — one component, one data
 * contract, fourteen marks.
 *
 * ```hbs
 * <Chart
 *   @rows={{this.shipments}}
 *   @mark='line'
 *   @x='month' @y='chests' @series='supplier'
 *   @label='Chests landed per supplier'
 * />
 * ```
 *
 * Rows arrive either eagerly (`@rows`) or through `@load` + `@loadKey`; the
 * load state machine, the stale-response guard, the polite result count and
 * the loading/empty/error chrome all come from `DataComponent`, unchanged.
 */
export class Chart<T> extends Component<ChartSignature<T>> {
  /** The shared load state machine. Delegation, not inheritance: this
   * component has its own signature, so it cannot extend `DataComponent`
   * without collapsing `T` — see the note on `DataSource`. */
  data = new DataSource<T>(() => this.args);

  /** Series the reader has switched off from the legend. */
  @tracked private mutedSeries: readonly string[] = [];

  get mark(): ChartMark {
    return this.args.mark ?? 'line';
  }

  get height(): number {
    return Math.max(80, Math.round(this.args.height ?? 300));
  }

  get hasSeries(): boolean {
    return this.args.series !== undefined;
  }

  /** Every series name, in first-appearance order — a stable palette
   * assignment that does not shuffle when a row is added. */
  get seriesNames(): string[] {
    if (!this.hasSeries) {
      return [];
    }
    let seen: string[] = [];
    this.data.visibleRows.forEach((row, i) => {
      let name = readChannel(row, this.args.series, i);
      let text = name === null || name === undefined ? '—' : String(name);
      if (!seen.includes(text)) {
        seen.push(text);
      }
    });
    return seen;
  }

  /** Every series muted: a reader-made empty state, distinct from "no data". */
  get allSeriesMuted(): boolean {
    return (
      this.hasSeries &&
      this.seriesNames.length > 0 &&
      this.rows.length === 0 &&
      this.data.visibleRows.length > 0
    );
  }

  /** Rows minus the series the reader has muted. */
  get rows(): T[] {
    let rows = this.data.visibleRows;
    if (!this.hasSeries || this.mutedSeries.length === 0) {
      return rows;
    }
    let muted = this.mutedSeries;
    return rows.filter((row, i) => {
      let name = readChannel(row, this.args.series, i);
      let text = name === null || name === undefined ? '—' : String(name);
      return !muted.includes(text);
    });
  }

  get legend(): LegendKey[] {
    return this.seriesNames.map((name, i) => {
      let hidden = this.mutedSeries.includes(name);
      return {
        name,
        style: cssStyleFrom([
          cssDeclaration('--pretui-chart-key', HUES[i % HUES.length]),
        ]),
        hidden,
        pressed: hidden ? ('false' as const) : ('true' as const),
      };
    });
  }

  toggleSeries = (name: string) => {
    let muted = this.mutedSeries;
    this.mutedSeries = muted.includes(name)
      ? muted.filter((n) => n !== name)
      : [...muted, name];
  };

  // ── Text alternative ───────────────────────────────────────────────────

  get xLabel(): string {
    return channelLabel(this.args.x, this.args.xLabel);
  }
  get yLabel(): string {
    return channelLabel(this.args.y, this.args.yLabel);
  }
  get seriesHeading(): string {
    return channelLabel(this.args.series, this.args.seriesLabel) || 'Series';
  }
  get valueHeading(): string {
    return channelLabel(this.args.value, this.args.valueLabel) || 'Value';
  }

  /** Column headings for the data table, in the order the cells are built. */
  get tableColumns(): string[] {
    let columns: string[] = [];
    if (this.hasSeries) {
      columns.push(this.seriesHeading);
    }
    columns.push(this.xLabel || 'X');
    if (this.args.y !== undefined) {
      columns.push(this.yLabel || 'Y');
    }
    if (this.args.value !== undefined) {
      columns.push(this.valueHeading);
    }
    return columns;
  }

  get tableLimit(): number {
    return Math.max(1, Math.round(this.args.tableLimit ?? 100));
  }

  /**
   * The chart's numbers as text. This — not the SVG — is what a screen
   * reader, a text browser, a copy-paste and a greyscale printout get. The
   * first cell of every row is a `<th scope='row'>` so the table reads as
   * labelled data rather than a grid of loose numbers.
   */
  get tableRows(): { head: string; cells: string[] }[] {
    let out: { head: string; cells: string[] }[] = [];
    let rows = this.rows;
    let limit = Math.min(rows.length, this.tableLimit);
    for (let i = 0; i < limit; i++) {
      let row = rows[i] as T;
      let cells: string[] = [];
      if (this.hasSeries) {
        cells.push(displayValue(readChannel(row, this.args.series, i)));
      }
      cells.push(displayValue(readChannel(row, this.args.x, i)));
      if (this.args.y !== undefined) {
        cells.push(displayValue(readChannel(row, this.args.y, i)));
      }
      if (this.args.value !== undefined) {
        cells.push(displayValue(readChannel(row, this.args.value, i)));
      }
      out.push({ head: cells[0] as string, cells: cells.slice(1) });
    }
    return out;
  }

  get truncated(): number {
    return Math.max(0, this.rows.length - this.tableLimit);
  }

  /** The one-sentence spoken form of the chart, used as its `role=img` name. */
  get summary(): string {
    let parts: string[] = [];
    if (this.args.label) {
      parts.push(this.args.label + '.');
    }
    parts.push(MARK_NOUN[this.mark] + '.');
    let count = this.rows.length;
    parts.push(count + (count === 1 ? ' data point' : ' data points') + '.');
    let names = this.seriesNames.filter((n) => !this.mutedSeries.includes(n));
    if (names.length > 0) {
      parts.push(
        (names.length === 1 ? 'Series: ' : names.length + ' series: ') +
          names.join(', ') +
          '.',
      );
    }
    let vertical = this.extentOf(this.args.y ?? this.args.value);
    if (vertical) {
      parts.push(
        (this.yLabel || 'Vertical axis') +
          ' from ' +
          vertical.lo +
          ' to ' +
          vertical.hi +
          '.',
      );
    }
    let horizontal = this.extentOf(this.args.x);
    if (horizontal) {
      parts.push(
        (this.xLabel || 'Horizontal axis') +
          ' from ' +
          horizontal.lo +
          ' to ' +
          horizontal.hi +
          '.',
      );
    }
    return parts.join(' ');
  }

  private extentOf(
    channel: ChartChannel<T> | undefined,
  ): { lo: string; hi: string } | undefined {
    if (channel === undefined) {
      return undefined;
    }
    let rows = this.rows;
    let lowRaw: unknown;
    let highRaw: unknown;
    let low = Number.POSITIVE_INFINITY;
    let high = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < rows.length; i++) {
      let raw = readChannel(rows[i] as T, channel, i);
      let n = asNumber(raw);
      if (n === undefined) {
        continue;
      }
      if (n < low) {
        low = n;
        lowRaw = raw;
      }
      if (n > high) {
        high = n;
        highRaw = raw;
      }
    }
    if (lowRaw === undefined || highRaw === undefined) {
      return undefined;
    }
    return { lo: displayValue(lowRaw), hi: displayValue(highRaw) };
  }

  // ── The Plot spec ──────────────────────────────────────────────────────

  private get colorScale(): PlotOptions | undefined {
    if (this.mark === 'heatmap') {
      return { type: 'quantize', n: RAMP.length, range: RAMP };
    }
    if (!this.hasSeries) {
      return undefined;
    }
    return {
      type: 'ordinal',
      domain: this.seriesNames,
      range: HUES,
      unknown: HUES[0],
    };
  }

  private get drawPoints(): boolean {
    return this.args.points ?? this.rows.length <= 120;
  }

  /** Left margin grows where category labels live on the vertical axis. */
  private get marginLeft(): number {
    if (
      this.mark === 'bar-h' ||
      this.mark === 'heatmap' ||
      this.mark === 'timeline' ||
      this.mark === 'dumbbell'
    ) {
      return 96;
    }
    return 48;
  }

  private get marks(): PlotMark[] {
    let rows = this.rows;
    let x = this.args.x;
    let y = this.args.y;
    // the marks read the same string key the colour domain is built from, so
    // a numeric, boolean or missing series value still matches its legend hue
    let channel = this.args.series;
    let series = this.hasSeries
      ? (row: unknown, i: number): string => {
          let name = readChannel(row as T, channel, i);
          return name === null || name === undefined ? '—' : String(name);
        }
      : undefined;
    let stroke = this.hasSeries ? series : HUES[0];
    let fill = this.hasSeries ? series : HUES[0];
    let curve = this.args.curve ?? 'monotone-x';
    let symbol = this.args.symbols !== false && this.hasSeries ? series : undefined;
    let grid = { stroke: BORDER, strokeOpacity: 1, strokeDasharray: '2,5' };
    let axes: PlotMark[] = [
      // Explicit axis marks suppress Plot's implicit ones, which is how tick
      // text and rules get token colours instead of black.
      axisX({ color: INK, tickSize: 0, tickPadding: 10 }),
      axisY({ color: INK, tickSize: 0, tickPadding: 8 }),
    ];

    if (this.mark === 'line') {
      return [
        gridY(grid),
        ruleY([0], { stroke: BORDER, strokeOpacity: 1 }),
        ...axes,
        lineY(rows, { x, y, stroke, strokeWidth: 2, curve }),
        this.drawPoints
          ? dot(rows, {
              x,
              y,
              fill: stroke,
              symbol,
              stroke: CARD,
              strokeWidth: 1.5,
              r: 3,
            })
          : undefined,
      ].filter(Boolean);
    }

    if (this.mark === 'area') {
      // `areaY({x, y, fill})` applies Plot's implicit `stackY`. Naming the
      // baseline explicitly (`y1: 0, y2: y`) is what BYPASSES that transform
      // — which is the whole mechanism behind `@stacked={{false}}`.
      let stacked = this.args.stacked ?? true;
      let band: PlotOptions = stacked
        ? { x, y, fill, curve }
        : { x, y1: 0, y2: y, fill, curve };
      band['fillOpacity'] = this.hasSeries ? (stacked ? 0.75 : 0.4) : 0.22;
      return [
        gridY(grid),
        ...axes,
        areaY(rows, band),
        lineY(rows, { x, y, stroke, strokeWidth: 2, curve }),
        ruleY([0], { stroke: BORDER, strokeOpacity: 1 }),
      ];
    }

    if (this.mark === 'bar') {
      return [
        gridY(grid),
        ...axes,
        barY(rows, { x, y, fill, insetLeft: 0.5, insetRight: 0.5 }),
        ruleY([0], { stroke: BORDER, strokeOpacity: 1 }),
      ];
    }

    if (this.mark === 'bar-h') {
      return [
        gridX(grid),
        ...axes,
        barX(rows, { x, y, fill, insetTop: 0.5, insetBottom: 0.5 }),
      ];
    }

    if (this.mark === 'scatter') {
      return [
        gridY(grid),
        gridX(grid),
        ...axes,
        dot(rows, {
          x,
          y,
          fill,
          symbol,
          stroke: CARD,
          strokeWidth: 1,
          r: 4,
          fillOpacity: 0.85,
        }),
      ];
    }

    if (this.mark === 'histogram') {
      let binOptions: PlotOptions = { x, fill };
      if (this.args.bins !== undefined) {
        binOptions['thresholds'] = Math.max(2, Math.round(this.args.bins));
      }
      return [
        gridY(grid),
        ...axes,
        rectY(rows, binX({ y: 'count' }, binOptions)),
        ruleY([0], { stroke: BORDER, strokeOpacity: 1 }),
      ];
    }

    if (this.mark === 'heatmap') {
      return [
        ...axes,
        cell(rows, {
          x,
          y,
          fill: this.args.value ?? fill,
          inset: 0.5,
          stroke: CARD,
          strokeWidth: 1,
        }),
      ];
    }

    if (this.mark === 'connected') {
      return [
        gridY(grid),
        gridX(grid),
        ...axes,
        line(rows, {
          x,
          y,
          z: series,
          stroke,
          strokeWidth: 2,
          curve: this.args.curve ?? 'catmull-rom',
        }),
        dot(rows, {
          x,
          y,
          fill: stroke,
          symbol,
          stroke: CARD,
          strokeWidth: 1.5,
          r: 3.5,
        }),
      ];
    }

    if (this.mark === 'bubble') {
      return [
        gridY(grid),
        gridX(grid),
        ...axes,
        dot(rows, {
          x,
          y,
          r: this.args.value,
          fill,
          symbol,
          stroke: CARD,
          strokeWidth: 1,
          fillOpacity: 0.78,
        }),
      ];
    }

    if (this.mark === 'band') {
      return [
        gridY(grid),
        ...axes,
        areaY(rows, {
          x,
          y1: y,
          y2: this.args.value,
          fill,
          fillOpacity: this.hasSeries ? 0.3 : 0.18,
          curve,
        }),
        lineY(rows, { x, y, stroke, strokeWidth: 1.5, curve }),
        lineY(rows, {
          x,
          y: this.args.value,
          stroke,
          strokeWidth: 1.5,
          curve,
        }),
      ];
    }

    if (this.mark === 'timeline') {
      return [
        gridX(grid),
        ...axes,
        barX(rows, {
          x1: x,
          x2: this.args.value,
          y,
          fill,
          insetTop: 2,
          insetBottom: 2,
          rx: 3,
        }),
      ];
    }

    if (this.mark === 'waterfall') {
      return [
        gridY(grid),
        ...axes,
        barY(rows, {
          x,
          y1: y,
          y2: this.args.value,
          fill,
          insetLeft: 1,
          insetRight: 1,
        }),
        ruleY([0], { stroke: BORDER, strokeOpacity: 1 }),
      ];
    }

    if (this.mark === 'dumbbell') {
      return [
        gridX(grid),
        ...axes,
        ruleY(rows, {
          y,
          x1: x,
          x2: this.args.value,
          stroke: BORDER,
          strokeWidth: 3,
        }),
        dot(rows, {
          x,
          y,
          fill: HUES[1],
          stroke: CARD,
          strokeWidth: 1.5,
          r: 4.5,
        }),
        dot(rows, {
          x: this.args.value,
          y,
          fill: HUES[0],
          stroke: CARD,
          strokeWidth: 1.5,
          r: 4.5,
        }),
      ];
    }

    // waffle
    return [
      ...axes,
      waffleY(rows, { x, y, fill, rx: '12%', stroke: CARD, strokeWidth: 0.5 }),
    ];
  }

  /**
   * The Plot options, minus `width`. Rebuilt whenever any tracked input
   * changes, which is what makes `plotInto` re-run — the modifier compares
   * this object by identity.
   *
   * TOTAL BY CONSTRUCTION, and that is not decoration. Mark constructors are
   * DOM-free (which is why they may live in a getter at all) but they are
   * NOT infallible: Plot validates several options — an unknown `curve` is
   * the cheapest example — at mark-construction time rather than inside
   * `plot()`. A getter that throws takes the whole card's render down and is
   * invisible to `boxel parse`, `boxel lint` and
   * `boxel realm indexing-errors` alike. So the failure is captured and
   * carried as data to the modifier, which renders it as words.
   */
  get draw(): ChartDraw {
    try {
      return { spec: this.buildSpec(), height: this.height, error: undefined };
    } catch (thrown) {
      return {
        spec: undefined,
        height: this.height,
        error:
          thrown instanceof Error ? thrown.message : String(thrown ?? 'unknown'),
      };
    }
  }

  private buildSpec(): PlotSpec {
    let horizontalIsQuantitative =
      this.mark === 'bar-h' ||
      this.mark === 'scatter' ||
      this.mark === 'histogram' ||
      this.mark === 'connected' ||
      this.mark === 'bubble' ||
      this.mark === 'timeline' ||
      this.mark === 'dumbbell';
    let zeroFree =
      this.mark === 'scatter' ||
      this.mark === 'connected' ||
      this.mark === 'bubble' ||
      this.mark === 'band';
    let zero = this.args.zero ?? !zeroFree;
    let xScale: PlotOptions = { label: null };
    let yScale: PlotOptions = { label: null };
    if (this.args.xType) {
      xScale['type'] = this.args.xType;
    }
    if (this.args.yType) {
      yScale['type'] = this.args.yType;
    }
    if (horizontalIsQuantitative) {
      xScale['nice'] = true;
    }
    if (
      this.mark !== 'heatmap' &&
      this.mark !== 'bar-h' &&
      this.mark !== 'timeline' &&
      this.mark !== 'dumbbell'
    ) {
      yScale['nice'] = true;
      yScale['zero'] = zero;
    }
    let spec: PlotSpec = {
      className: 'pretui-plot',
      style: PLOT_STYLE,
      marginTop: 12,
      marginRight: 18,
      marginBottom: 32,
      marginLeft: this.marginLeft,
      x: xScale,
      y: yScale,
      marks: this.marks,
    };
    let color = this.colorScale;
    if (color) {
      spec['color'] = color;
    }
    if (this.args.symbols !== false && this.hasSeries) {
      spec['symbol'] = { domain: this.seriesNames };
    }
    return spec;
  }

  <template>
    <figure
      class='pretui-chart'
      data-test-pretui-chart
      data-mark={{this.mark}}
      ...attributes
    >
      {{#if (has-block 'header')}}
        <div class='pretui-chart-head'>{{yield to='header'}}</div>
      {{else if @label}}
        <figcaption class='pretui-chart-title'>{{@label}}</figcaption>
      {{/if}}

      <DataShell
        @state={{this.data}}
        @hasLoading={{has-block 'loading'}}
        @hasEmpty={{has-block 'empty'}}
        @hasError={{has-block 'error'}}
        @emptyTitle='Nothing to plot'
        @emptyMessage='This chart has no data yet. Once rows arrive it draws itself.'
        @loadingLabel='Drawing'
        @skeletonRows={{2}}
      >
        <:default>
          {{! The svg is Plot's, not Glimmer's: the modifier owns this
              element's single child and nothing reaches inside it. The
              summary is the accessible name, so a reader who cannot see the
              picture still learns what it says. }}
          <div
            class='pretui-chart-plot'
            role='img'
            aria-label={{this.summary}}
            data-test-pretui-chart-plot
            {{plotInto this.draw}}
          ></div>

          {{#if this.allSeriesMuted}}
            {{! Muting every legend key is a state the reader created, so the
                frame says so and says how to undo it, rather than standing
                empty with an accessible name reading "…0 data points". }}
            <p class='pretui-chart-allmuted' role='status'>
              Every series is hidden. Choose one above to draw it.
            </p>
          {{/if}}

          {{#unless @hideLegend}}
            {{#if this.hasSeries}}
              <div class='pretui-chart-legend' data-test-pretui-chart-legend>
                {{#each this.legend key='name' as |entry|}}
                  <button
                    type='button'
                    class='pretui-chart-key'
                    style={{entry.style}}
                    aria-pressed={{entry.pressed}}
                    data-hidden={{if entry.hidden 'true'}}
                    data-test-pretui-chart-key={{entry.name}}
                    {{on 'click' (fn this.toggleSeries entry.name)}}
                  >
                    <span class='pretui-chart-swatch'></span>
                    <span>{{entry.name}}</span>
                  </button>
                {{/each}}
              </div>
            {{/if}}
          {{/unless}}

          {{#if @caption}}
            <figcaption class='pretui-chart-caption'>{{@caption}}</figcaption>
          {{/if}}

          {{#unless @hideTable}}
            <details class='pretui-chart-data'>
              <summary class='pretui-chart-summary'>
                Data table
                <span class='pretui-chart-count'>{{this.rows.length}}</span>
              </summary>
              <p class='pretui-chart-spoken'>{{this.summary}}</p>
              <div class='pretui-chart-scroll'>
                <table class='pretui-chart-table' data-test-pretui-chart-table>
                  <thead>
                    <tr>
                      {{#each this.tableColumns key='@index' as |column|}}
                        <th scope='col'>{{column}}</th>
                      {{/each}}
                    </tr>
                  </thead>
                  <tbody>
                    {{#each this.tableRows key='@index' as |entry|}}
                      <tr>
                        <th scope='row'>{{entry.head}}</th>
                        {{#each entry.cells key='@index' as |value|}}
                          <td>{{value}}</td>
                        {{/each}}
                      </tr>
                    {{/each}}
                  </tbody>
                </table>
              </div>
              {{#if this.truncated}}
                <p class='pretui-chart-note'>
                  {{this.truncated}}
                  more rows not shown.
                </p>
              {{/if}}
            </details>
          {{/unless}}
        </:default>
        <:loading>{{yield to='loading'}}</:loading>
        <:empty>{{yield to='empty'}}</:empty>
        <:error>{{yield to='error'}}</:error>
      </DataShell>
    </figure>

    <style scoped>
      @layer PretComponent {
        .pretui-chart {
          container-type: inline-size;
          margin: 0;
          display: grid;
          gap: var(--pretui-chart-gap, var(--space-4, 11px));
          min-width: 0;
          color: var(--foreground);
          font-family: var(--font-sans);
          font-size: var(--text-ui-md, 12.5px);
          font-variant-numeric: tabular-nums;
        }
        .pretui-chart-title {
          font-size: var(--text-ui-lg, 14px);
          font-weight: var(--weight-strong, 600);
          letter-spacing: var(--track-heading, -0.01em);
        }
        .pretui-chart-head {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
          gap: var(--space-3, 8px);
        }
        .pretui-chart-plot {
          display: block;
          inline-size: 100%;
          min-inline-size: 0;
        }
        /* The error line the modifier writes when plot() throws. Not scoped-
           reachable by class alone (the node is created at runtime and never
           receives the scope attribute), so it is styled through the host
           element's own descendant rule. */
        .pretui-chart-plot > p {
          margin: 0;
          padding: var(--space-4, 11px);
          border-radius: var(--radius-surface, 10px);
          color: var(--destructive-foreground);
          background: color-mix(in oklch, var(--destructive) 8%, var(--card));
          box-shadow: var(--pretui-shadow-hairline, 0 0 0 1px var(--border));
          font-size: var(--text-ui-sm, 11.5px);
        }
        .pretui-chart-legend {
          display: flex;
          flex-wrap: wrap;
          gap: var(--space-2, 6px) var(--space-4, 11px);
        }
        .pretui-chart-key {
          display: inline-flex;
          align-items: center;
          gap: 0.4rem;
          padding: 4px 6px;
          margin: -4px -6px;
          border: 0;
          border-radius: var(--radius-control, 7px);
          background: transparent;
          color: var(--muted-foreground);
          font: inherit;
          font-size: var(--text-ui-sm, 11.5px);
          cursor: pointer;
          /* Coarse pointers get a real hit target without changing the
             layout on a mouse. */
          min-block-size: 24px;
        }
        @media (any-pointer: coarse) {
          .pretui-chart-key {
            min-block-size: 44px;
            padding-inline: 10px;
          }
        }
        .pretui-chart-key:hover {
          background: color-mix(in oklch, var(--foreground) 5%, transparent);
        }
        .pretui-chart-key:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 1px;
        }
        .pretui-chart-key[data-hidden='true'] {
          color: color-mix(in oklch, var(--muted-foreground) 60%, transparent);
          text-decoration: line-through;
        }
        .pretui-chart-swatch {
          inline-size: 0.62rem;
          block-size: 0.62rem;
          border-radius: 999px;
          background: var(--pretui-chart-key, var(--chart-1));
        }
        .pretui-chart-key[data-hidden='true'] .pretui-chart-swatch {
          background: transparent;
          box-shadow: inset 0 0 0 1.5px var(--pretui-chart-key, var(--chart-1));
        }
        .pretui-chart-caption {
          color: var(--muted-foreground);
          font-size: var(--text-ui-sm, 11.5px);
          max-inline-size: 68ch;
        }
        .pretui-chart-allmuted {
          margin: 0;
          color: var(--muted-foreground);
          font-size: var(--text-ui-sm, 11.5px);
        }
        .pretui-chart-data {
          border-radius: var(--radius-surface, 10px);
          box-shadow: var(--pretui-shadow-hairline, 0 0 0 1px var(--border));
          background: var(--card);
          padding: var(--space-3, 8px) var(--space-4, 11px);
        }
        .pretui-chart-summary {
          display: flex;
          align-items: center;
          gap: var(--space-2, 6px);
          cursor: pointer;
          color: var(--muted-foreground);
          font-size: var(--text-ui-sm, 11.5px);
          letter-spacing: var(--track-eyebrow, 0.08em);
          text-transform: uppercase;
        }
        .pretui-chart-summary:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 2px;
        }
        .pretui-chart-count {
          font-family: var(--font-mono);
          text-transform: none;
          letter-spacing: 0;
          padding: 1px 6px;
          border-radius: 999px;
          background: color-mix(in oklch, var(--foreground) 7%, transparent);
        }
        .pretui-chart-spoken {
          margin: var(--space-3, 8px) 0 0;
          color: var(--muted-foreground);
          font-size: var(--text-ui-sm, 11.5px);
          max-inline-size: 74ch;
        }
        .pretui-chart-scroll {
          margin-block-start: var(--space-3, 8px);
          max-block-size: 320px;
          overflow: auto;
        }
        .pretui-chart-table {
          inline-size: 100%;
          border-collapse: collapse;
          font-size: var(--text-ui-sm, 11.5px);
          font-variant-numeric: tabular-nums;
        }
        .pretui-chart-table th,
        .pretui-chart-table td {
          text-align: start;
          padding: 5px 10px 5px 0;
          border-block-end: 1px solid
            color-mix(in oklch, var(--border) 70%, transparent);
          white-space: nowrap;
        }
        .pretui-chart-table thead th {
          position: sticky;
          inset-block-start: 0;
          background: var(--card);
          z-index: var(--pretui-z-sticky, 10);
          color: var(--muted-foreground);
          font-weight: var(--weight-strong, 600);
        }
        .pretui-chart-table tbody th {
          font-weight: var(--weight-strong, 600);
        }
        .pretui-chart-note {
          margin: var(--space-2, 6px) 0 0;
          color: var(--muted-foreground);
          font-size: var(--text-ui-xs, 11px);
        }
        /* Unnamed container query only — a named one silently deletes every
           rule that follows it in the transpiled stylesheet. */
        @container (max-width: 26rem) {
          .pretui-chart-legend {
            gap: var(--space-2, 6px);
          }
          .pretui-chart-scroll {
            max-block-size: 220px;
          }
        }
      }
    </style>
  </template>
}
