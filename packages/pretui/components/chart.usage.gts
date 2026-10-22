// Pretui — Chart usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import {
  PLACES,
  SUPPLIERS,
  TEAS,
  seedFrom,
  take,
} from '../examples';
import { FreestyleUsage } from './freestyle-usage';
import { Chart } from './chart';
import type { ChartMark } from '../internal/structure-chart';

// ── Chart ────────────────────────────────────────────────────────────────
const CHART_SEED = seedFrom('pretui-chart-demo');

/** Three suppliers, twelve months, one chest count each. */
export interface ChestsPoint {
  month: Date;
  supplier: string;
  chests: number;
}

const DEMO_SUPPLIERS = take(CHART_SEED, 0, 3, SUPPLIERS);

function chestsFor(supplier: string, month: number): number {
  let ripple = seedFrom(supplier + '#' + month) % 70;
  return 90 + ripple + Math.round(month * 5.5);
}

const TIME_SERIES: ChestsPoint[] = (() => {
  let points: ChestsPoint[] = [];
  for (let supplier of DEMO_SUPPLIERS) {
    for (let month = 0; month < 12; month++) {
      points.push({
        month: new Date(Date.UTC(2026, month, 1)),
        supplier,
        chests: chestsFor(supplier, month),
      });
    }
  }
  return points;
})();

/** Six teas, one landed quantity each — the categorical set. */
export interface GradeRow {
  grade: string;
  chests: number;
  origin: string;
}

const DEMO_TEAS = take(CHART_SEED, 1, 6, TEAS);

const CATEGORICAL: GradeRow[] = DEMO_TEAS.map((grade, i) => ({
  grade,
  chests: 40 + (seedFrom('grade#' + grade) % 260),
  origin: PLACES[(seedFrom(grade) + i) % PLACES.length] as string,
}));

/** Forty lots: price against cup score — the scatter set. */
export interface LotPoint {
  price: number;
  score: number;
  supplier: string;
}

const SCATTER: LotPoint[] = (() => {
  let points: LotPoint[] = [];
  for (let i = 0; i < 40; i++) {
    let supplier = DEMO_SUPPLIERS[i % DEMO_SUPPLIERS.length] as string;
    let noise = seedFrom('lot#' + i) % 100;
    let price = 12 + (noise % 48);
    points.push({
      price,
      score: 68 + ((noise * 7) % 24) + Math.round(price / 12),
      supplier,
    });
  }
  return points;
})();

/** Two hundred cupping scores — the histogram set. */
export interface ScoreRow {
  score: number;
}

const SCORES: ScoreRow[] = (() => {
  let rows: ScoreRow[] = [];
  for (let i = 0; i < 200; i++) {
    // Three seeds summed: a crude central-limit trick that gives a hump
    // rather than a flat band, with no randomness at all.
    let a = seedFrom('score-a#' + i) % 12;
    let b = seedFrom('score-b#' + i) % 12;
    let c = seedFrom('score-c#' + i) % 12;
    rows.push({ score: 62 + a + b + c });
  }
  return rows;
})();

/** Five warehouses across seven weekdays — the heat-map set. */
export interface DeskRow {
  place: string;
  day: string;
  lots: number;
}

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const DEMO_PLACES = take(CHART_SEED, 2, 5, PLACES);

const HEATMAP: DeskRow[] = (() => {
  let rows: DeskRow[] = [];
  for (let place of DEMO_PLACES) {
    for (let day of DAY_NAMES) {
      rows.push({
        place,
        day,
        lots: seedFrom(place + '/' + day) % 48,
      });
    }
  }
  return rows;
})();

/** A path through two quantitative measures — connected scatter. */
export interface PathPoint {
  period: string;
  efficiency: number;
  satisfaction: number;
}

const CONNECTED: PathPoint[] = Array.from({ length: 10 }, (_, i) => ({
  period: 'Q' + (i + 1),
  efficiency: 54 + i * 4 + (seedFrom('connected-x#' + i) % 9),
  satisfaction: 62 + i * 2 + (seedFrom('connected-y#' + i) % 15),
}));

/** Two dimensions plus a third quantitative magnitude — bubble. */
export interface BubblePoint {
  price: number;
  score: number;
  volume: number;
  supplier: string;
}

const BUBBLES: BubblePoint[] = Array.from({ length: 24 }, (_, i) => ({
  price: 12 + (seedFrom('bubble-price#' + i) % 52),
  score: 68 + (seedFrom('bubble-score#' + i) % 28),
  volume: 4 + (seedFrom('bubble-volume#' + i) % 90),
  supplier: DEMO_SUPPLIERS[i % DEMO_SUPPLIERS.length] as string,
}));

/** Monthly low/high interval — range band. */
export interface BandPoint {
  month: Date;
  low: number;
  high: number;
}

const BAND: BandPoint[] = Array.from({ length: 12 }, (_, i) => {
  let low = 58 + i * 2 + (seedFrom('band-low#' + i) % 8);
  return {
    month: new Date(Date.UTC(2026, i, 1)),
    low,
    high: low + 9 + (seedFrom('band-high#' + i) % 10),
  };
});

/** Explicit start/end spans over named work — timeline. */
export interface TimelinePoint {
  task: string;
  start: Date;
  end: Date;
  stream: string;
}

const TIMELINE: TimelinePoint[] = [
  { task: 'Source', start: new Date(Date.UTC(2026, 0, 2)), end: new Date(Date.UTC(2026, 0, 7)), stream: 'Research' },
  { task: 'Model', start: new Date(Date.UTC(2026, 0, 6)), end: new Date(Date.UTC(2026, 0, 13)), stream: 'Research' },
  { task: 'Prototype', start: new Date(Date.UTC(2026, 0, 10)), end: new Date(Date.UTC(2026, 0, 19)), stream: 'Build' },
  { task: 'Review', start: new Date(Date.UTC(2026, 0, 18)), end: new Date(Date.UTC(2026, 0, 23)), stream: 'Build' },
  { task: 'Release', start: new Date(Date.UTC(2026, 0, 22)), end: new Date(Date.UTC(2026, 0, 27)), stream: 'Ship' },
];

/** Running total expressed as explicit before/after endpoints — waterfall. */
export interface WaterfallPoint {
  step: string;
  before: number;
  after: number;
  direction: string;
}

const WATERFALL: WaterfallPoint[] = [
  { step: 'Opening', before: 0, after: 420, direction: 'total' },
  { step: 'New', before: 420, after: 585, direction: 'gain' },
  { step: 'Retired', before: 585, after: 540, direction: 'loss' },
  { step: 'Recovered', before: 540, after: 612, direction: 'gain' },
  { step: 'Closing', before: 0, after: 612, direction: 'total' },
];

/** Before/after comparison joined per category — dumbbell. */
export interface DumbbellPoint {
  territory: string;
  before: number;
  after: number;
}

const DUMBBELL: DumbbellPoint[] = [
  { territory: 'Controls', before: 42, after: 68 },
  { territory: 'Reading', before: 57, after: 73 },
  { territory: 'Structure', before: 49, after: 81 },
  { territory: 'Motion', before: 35, after: 59 },
  { territory: 'Feedback', before: 61, after: 76 },
];

const MARK_OPTIONS: string[] = [
  'line',
  'area',
  'bar',
  'bar-h',
  'scatter',
  'histogram',
  'heatmap',
  'waffle',
  'connected',
  'bubble',
  'band',
  'timeline',
  'waterfall',
  'dumbbell',
];

//
// One knob set drives all fourteen marks, which is exactly the point of the
// consolidated `@mark` vocabulary: switching mark keeps the height, the
// legend, the table and the label the caller already tuned. The demo swaps
// the FIXTURE with the mark because "chests over time" and "score
// distribution" are different questions — the component's contract is
// unchanged.
export class ChartUsage extends Component {
  @tracked mark: ChartMark = 'line';
  @tracked height = 300;
  @tracked stacked = false;
  @tracked hideLegend = false;
  @tracked hideTable = false;
  @tracked symbols = true;

  setMark = (v: string) => {
    this.mark = v as ChartMark;
  };
  setHeight = (v: number | null) => {
    this.height = v ?? 300;
  };
  setStacked = (v: boolean) => {
    this.stacked = v;
  };
  setHideLegend = (v: boolean) => {
    this.hideLegend = v;
  };
  setHideTable = (v: boolean) => {
    this.hideTable = v;
  };
  setSymbols = (v: boolean) => {
    this.symbols = v;
  };

  get isTime(): boolean {
    return this.mark === 'line' || this.mark === 'area';
  }
  get isCategorical(): boolean {
    return this.mark === 'bar' || this.mark === 'bar-h' || this.mark === 'waffle';
  }
  get isScatter(): boolean {
    return this.mark === 'scatter';
  }
  get isHistogram(): boolean {
    return this.mark === 'histogram';
  }
  get isHeatmap(): boolean {
    return this.mark === 'heatmap';
  }
  get isConnected(): boolean {
    return this.mark === 'connected';
  }
  get isBubble(): boolean {
    return this.mark === 'bubble';
  }
  get isBand(): boolean {
    return this.mark === 'band';
  }
  get isTimeline(): boolean {
    return this.mark === 'timeline';
  }
  get isWaterfall(): boolean {
    return this.mark === 'waterfall';
  }
  get isDumbbell(): boolean {
    return this.mark === 'dumbbell';
  }

  get usage(): string {
    return [
      '<Chart',
      "  @mark='" + this.mark + "'",
      '  @rows={{this.timeSeries}}',
      "  @x='month' @y='chests' @series='supplier'",
      "  @label='Chests landed per supplier'",
      '  @height={{' + this.height + '}}',
      '/>',
    ].join('\n');
  }

  markOptions = MARK_OPTIONS;
  timeSeries = TIME_SERIES;
  categorical = CATEGORICAL;
  scatter = SCATTER;
  scores = SCORES;
  heatmap = HEATMAP;
  connected = CONNECTED;
  bubbles = BUBBLES;
  band = BAND;
  timeline = TIMELINE;
  waterfall = WATERFALL;
  dumbbell = DUMBBELL;

  <template>
    <FreestyleUsage
      @name='Chart'
      @description="The kit's one plotting surface, over a vendored Observable Plot bundle. Fourteen marks share a single prop surface, including six composite views added from the Plot grammar: connected scatter, bubble, range band, timeline, waterfall and dumbbell. Every colour is a Pretui token; every chart carries a spoken summary plus the numbers as a table; and load, empty and error states come from the DataComponent foundation."
      @source={{this.usage}}
      @viewportMode='wide'
    >
      <:example>
        <div class='chart-stage'>
          {{#if this.isTime}}
            <Chart
              @mark={{this.mark}}
              @rows={{this.timeSeries}}
              @x='month'
              @y='chests'
              @series='supplier'
              @xLabel='Month'
              @yLabel='Chests'
              @seriesLabel='Supplier'
              @label='Chests landed per supplier, 2026'
              @caption='Twelve months of landings across three suppliers. Click a legend key to mute that series — the summary and the data table follow.'
              @height={{this.height}}
              @stacked={{this.stacked}}
              @symbols={{this.symbols}}
              @hideLegend={{this.hideLegend}}
              @hideTable={{this.hideTable}}
            />
          {{else if this.isCategorical}}
            <Chart
              @mark={{this.mark}}
              @rows={{this.categorical}}
              @x='grade'
              @y='chests'
              @xLabel='Grade'
              @yLabel='Chests'
              @label='Chests landed by grade'
              @caption='A categorical magnitude. bar-h keeps the same @x and @y meanings — the horizontal channel is always @x — which is why it is a separate mark rather than an orientation flag.'
              @height={{this.height}}
              @symbols={{this.symbols}}
              @hideLegend={{this.hideLegend}}
              @hideTable={{this.hideTable}}
            />
          {{else if this.isScatter}}
            <Chart
              @mark='scatter'
              @rows={{this.scatter}}
              @x='price'
              @y='score'
              @series='supplier'
              @xLabel='Price per chest'
              @yLabel='Cup score'
              @seriesLabel='Supplier'
              @label='Price against cup score, forty lots'
              @caption='Series are encoded as point SYMBOLS as well as colour, so the plot survives greyscale and colour-vision deficiency. Turn @symbols off to see the difference.'
              @height={{this.height}}
              @symbols={{this.symbols}}
              @hideLegend={{this.hideLegend}}
              @hideTable={{this.hideTable}}
            />
          {{else if this.isHistogram}}
            <Chart
              @mark='histogram'
              @rows={{this.scores}}
              @x='score'
              @xLabel='Cup score'
              @yLabel='Lots'
              @label='Distribution of cupping scores'
              @caption='binX does the counting; @bins is a hint, not a mandate. Two hundred rows, and the data table truncates at @tableLimit rather than rendering all of them.'
              @height={{this.height}}
              @hideLegend={{this.hideLegend}}
              @hideTable={{this.hideTable}}
            />
          {{else if this.isConnected}}
            <Chart
              @mark='connected'
              @rows={{this.connected}}
              @x='efficiency'
              @y='satisfaction'
              @xLabel='Efficiency'
              @yLabel='Satisfaction'
              @label='Efficiency and satisfaction path'
              @caption='The line preserves sequence through a two-dimensional space; dots keep each observation individually readable.'
              @height={{this.height}}
              @hideTable={{this.hideTable}}
            />
          {{else if this.isBubble}}
            <Chart
              @mark='bubble'
              @rows={{this.bubbles}}
              @x='price'
              @y='score'
              @value='volume'
              @series='supplier'
              @xLabel='Price per chest'
              @yLabel='Cup score'
              @valueLabel='Volume'
              @seriesLabel='Supplier'
              @label='Price, score and volume by supplier'
              @caption='Position carries two measures, radius carries a third, and series remains redundant through symbol as well as colour.'
              @height={{this.height}}
              @symbols={{this.symbols}}
              @hideLegend={{this.hideLegend}}
              @hideTable={{this.hideTable}}
            />
          {{else if this.isBand}}
            <Chart
              @mark='band'
              @rows={{this.band}}
              @x='month'
              @y='low'
              @value='high'
              @xLabel='Month'
              @yLabel='Low estimate'
              @valueLabel='High estimate'
              @label='Monthly forecast interval'
              @caption='An area between explicit low and high channels, with both boundaries drawn so the interval survives monochrome output.'
              @height={{this.height}}
              @hideTable={{this.hideTable}}
            />
          {{else if this.isTimeline}}
            <Chart
              @mark='timeline'
              @rows={{this.timeline}}
              @x='start'
              @value='end'
              @y='task'
              @series='stream'
              @xLabel='Start'
              @valueLabel='End'
              @yLabel='Task'
              @seriesLabel='Stream'
              @label='Programme timeline'
              @caption='Each bar has explicit start and end dates; overlaps remain visible instead of being flattened into duration alone.'
              @height={{this.height}}
              @hideLegend={{this.hideLegend}}
              @hideTable={{this.hideTable}}
            />
          {{else if this.isWaterfall}}
            <Chart
              @mark='waterfall'
              @rows={{this.waterfall}}
              @x='step'
              @y='before'
              @value='after'
              @series='direction'
              @xLabel='Step'
              @yLabel='Before'
              @valueLabel='After'
              @seriesLabel='Direction'
              @label='Catalog demand bridge'
              @caption='Floating bars connect each running-total endpoint; direction is named in the legend and retained in the data table.'
              @height={{this.height}}
              @hideLegend={{this.hideLegend}}
              @hideTable={{this.hideTable}}
            />
          {{else if this.isDumbbell}}
            <Chart
              @mark='dumbbell'
              @rows={{this.dumbbell}}
              @x='before'
              @value='after'
              @y='territory'
              @xLabel='Before'
              @valueLabel='After'
              @yLabel='Territory'
              @label='Coverage before and after'
              @caption='Two endpoints share a category row and a joining rule, making both level and change easy to compare.'
              @height={{this.height}}
              @hideTable={{this.hideTable}}
            />
          {{else}}
            <Chart
              @mark='heatmap'
              @rows={{this.heatmap}}
              @x='day'
              @y='place'
              @value='lots'
              @xLabel='Weekday'
              @yLabel='Warehouse'
              @valueLabel='Lots handled'
              @label='Lots handled by warehouse and weekday'
              @caption='The sequential ramp is a quantize scale, not an interpolated one: d3 would have to parse the endpoint colours to interpolate them, and a var() token cannot be parsed outside the document. Five discrete color-mix steps keep the heat map theme-obedient.'
              @height={{this.height}}
              @hideLegend={{this.hideLegend}}
              @hideTable={{this.hideTable}}
            />
          {{/if}}
        </div>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='mark'
          @description='Which mark to draw: line, area, bar, bar-h, scatter, histogram, heatmap, waffle, connected, bubble, band, timeline, waterfall or dumbbell. Observable Plot ships no arc mark, so there is deliberately no pie or donut.'
          @options={{this.markOptions}}
          @value={{this.mark}}
          @onInput={{this.setMark}}
          @defaultValue='line'
        />
        <Args.Object
          @name='rows'
          @description='Eager rows. Supply either this or @load, never both. The row type is generic, and @x / @y / @series / @value are checked against its keys.'
          @value={{this.timeSeries}}
        />
        <Args.Object
          @name='load'
          @description='Async loader, awaited by the component. Re-runs whenever @loadKey changes. The stale-response guard, the retry and the error panel come from DataComponent.'
        />
        <Args.String
          @name='x'
          @description='The horizontal channel — a key of the row type, or a function of the row. Always horizontal, for every mark including bar-h.'
        />
        <Args.String
          @name='y'
          @description='The vertical channel. Omitted for histogram, which counts.'
        />
        <Args.String
          @name='series'
          @description='Splits the data into coloured series and drives the legend. Legend keys are toggle buttons: muting a series updates the plot, the spoken summary and the data table together.'
        />
        <Args.String
          @name='value'
          @description='The auxiliary quantitative channel: heat-map magnitude, bubble radius, or the second endpoint for band, timeline, waterfall and dumbbell.'
        />
        <Args.String
          @name='xLabel'
          @description='Human label for @x in the summary and table. Defaults to the key name.'
        />
        <Args.String
          @name='yLabel'
          @description='Human label for @y. Defaults to the key name.'
        />
        <Args.String
          @name='xType'
          @description='Pin the horizontal scale type (linear, log, sqrt, utc, time, band, point) instead of letting Plot infer it from the data.'
        />
        <Args.Number
          @name='height'
          @description='Drawing height in px, excluding legend, caption and table. Width is measured from the container with a ResizeObserver, so one chart works in a tile and full-bleed.'
          @defaultValue={{300}}
          @min={{160}}
          @max={{520}}
          @step={{20}}
          @value={{this.height}}
          @onInput={{this.setHeight}}
        />
        <Args.Bool
          @name='stacked'
          @description='Stack series instead of overlaying them. Only bar and area stack.'
          @defaultValue={{false}}
          @value={{this.stacked}}
          @onInput={{this.setStacked}}
        />
        <Args.Bool
          @name='symbols'
          @description='Encode series as point symbols as well as colour, so state is never colour alone. Default true.'
          @defaultValue={{true}}
          @value={{this.symbols}}
          @onInput={{this.setSymbols}}
        />
        <Args.Bool
          @name='hideLegend'
          @description='Hide the series legend even when a @series channel is present.'
          @defaultValue={{false}}
          @value={{this.hideLegend}}
          @onInput={{this.setHideLegend}}
        />
        <Args.Bool
          @name='hideTable'
          @description='Hide the data-table disclosure. This costs the chart its text alternative — reach for it only when the same numbers are already tabulated beside the chart.'
          @defaultValue={{false}}
          @value={{this.hideTable}}
          @onInput={{this.setHideTable}}
        />
        <Args.Number
          @name='tableLimit'
          @description='Rows rendered in the data table before it truncates and reports the remainder.'
          @defaultValue={{100}}
        />
        <Args.String
          @name='label'
          @description='Accessible name for the chart. It opens the generated summary sentence that the role=img element carries.'
        />
        <Args.String
          @name='caption'
          @description='A caption printed under the chart, for the reader rather than the axis.'
        />
        <Args.Yield
          @name='header'
          @description='Replaces the default title row above the plot — put filters or a range picker here.'
          @hideControls={{true}}
        />
        <Args.Yield
          @name='loading'
          @description='Replaces the default spinner and skeleton.'
          @hideControls={{true}}
        />
        <Args.Yield
          @name='empty'
          @description='Replaces the default EmptyState.'
          @hideControls={{true}}
        />
        <Args.Yield
          @name='error'
          @description='Replaces the default Alert, retry button and broken-reference line.'
          @hideControls={{true}}
        />
      </:api>
      <:cssVars as |Css|>
        <Css.Basic
          @name='pretui-chart-gap'
          @type='dimension'
          @description='Vertical rhythm between the title, plot, legend, caption and table.'
          @defaultValue='var(--space-4)'
        />
      </:cssVars>
    </FreestyleUsage>

    <style scoped>
      .chart-stage {
        padding: var(--space-4, 11px);
        border-radius: var(--radius-surface, 10px);
        background: var(--card);
        box-shadow: var(
          --pretui-shadow-hairline,
          0 0 0 1px var(--border)
        );
      }
    </style>
  </template>
}

export const DEMOS_CHART: Record<string, unknown> = {
  Chart: ChartUsage,
};
