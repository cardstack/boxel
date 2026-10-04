// Pretui — structure/chart: the charting surface.
//
// `Chart` is the kit's one plotting component. It is a thin, opinionated
// Glimmer skin over the vendored Observable Plot bundle (`plot/index.js`,
// ISC), and `BarList` is the ranked-distribution row list that needs no
// plotting engine at all. Both consume the `DataComponent` foundation
// (`DataSource` + `DataShell`) rather than re-deciding what "loading",
// "empty", "error" and "a stale response arrived late" mean.
//
// ── Why one component with a `@mark` vocabulary ──────────────────────────
//
// Every dashboard kit in the survey ships LineChart / AreaChart / BarChart /
// ScatterChart / … as separate components with ~90% duplicated prop
// surfaces, so a caller who switches from bars to lines rewrites their call
// site and loses the axis, legend, table and empty-state config they had
// tuned. Here the mark is one searchable enum — from line and bar through
// band, timeline, waterfall and dumbbell — and everything else is shared. That is
// the consolidation win: one component with a `@mark`
// knob where the upstream ships many.
//
// ── The two Plot traps, both handled here ────────────────────────────────
//
//  1. `plot()` needs `document`. It is called ONLY inside `plotInto`, an
//     ember-modifier — never from a getter the indexer might evaluate. The
//     mark constructors (`lineY(...)` etc.) are DOM-free and so may be built
//     in a getter, which is what keeps the spec autotracked — but they are
//     not INFALLIBLE: Plot validates several options (an unknown `curve`,
//     for one) at mark-construction time, so the getter is wrapped and its
//     failure is carried to the modifier as data. Found by the render test;
//     no other gate sees it.
//  2. Plot's `style` option MUST be a string. The object form is applied
//     with `Object.assign(element.style, style)`, which silently drops
//     custom properties — so `--plot-background` would never land and the
//     chart could not be themed. See `PLOT_STYLE`.
//
// ── Better than the inspiration ──────────────────────────────────────────
//
// What upstream chart kits get wrong, and what is done differently here:
//
//  * **Pixels only.** Almost every React chart library renders an SVG and
//    stops; a screen reader gets nothing, and the numbers are unreachable.
//    Here every chart carries a real text alternative: a computed `role=img`
//    summary sentence, and a `<details>` disclosure holding the actual data
//    as a `<table>` with proper `<th scope>`. The data is never only pixels.
//  * **Colour as the only encoding.** Series are additionally encoded as
//    point SYMBOLS (circle/square/triangle/…) wherever a point mark is
//    drawn, so the chart survives greyscale and colour-vision deficiency.
//  * **A hard-coded palette, or worse a `dark:` fork.** Every colour here is
//    a Pretui token — `var(--chart-1…5)`, `var(--border)`,
//    `var(--muted-foreground)` — passed verbatim into SVG attributes
//    (Plot's `isColor()` accepts `var()`/`color-mix()`). Zero dark branches:
//    the season re-tints the chart with no code change.
//  * **A fixed width.** Charts here are measured with a `ResizeObserver` and
//    redrawn at the container's width, so one chart works in a dashboard
//    tile and in a full-bleed page. (An observer, not a timer — and it
//    disconnects on teardown.)
//  * **A silent blank box.** If Plot rejects the spec — at mark-construction
//    time or inside `plot()` — the failure is caught at both sites and
//    written into the host element as a visible, testable line of words,
//    instead of leaving an empty div or taking the whole card's render down.
//    A chart that fails says so.
//  * **A channel typo that produces an empty frame.** Plot reads `undefined`
//    for an unknown field name and draws nothing, with no error. The channel
//    args are therefore typed `keyof T` at the component boundary, so the
//    typo is a compile error instead.
//
// Deliberately NOT here: pie/donut/arc. Observable Plot ships no arc mark,
// so promising one would mean a second engine. Radial work is a gap, named
// rather than hidden (Law 7).
//
// Pretui — the Observable Plot binding, theme and mark vocabulary shared by Chart and BarList.
import { modifier } from 'ember-modifier';
import { plot } from '../plot/index.js';

// ── Plot interop types ───────────────────────────────────────────────────
//
// The vendored bundle ships no type declarations and hand-writing Plot's
// full option surface is not this component's job, so the seam is typed at
// exactly one place: a spec is a bag of options, a mark is opaque.
/* eslint-disable @typescript-eslint/no-explicit-any -- the vendored Plot
   bundle has no type declarations; these three aliases are the entire
   untyped seam and nothing else in the file uses `any`. */
export type PlotSpec = Record<string, unknown>;
export type PlotMark = any;
export type PlotOptions = Record<string, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

// ── Theming ──────────────────────────────────────────────────────────────

/**
 * Plot emits its own stylesheet INSIDE the svg as `:where(.className){…}`.
 * The `:where()` wrapper zeroes its specificity so anything of ours outranks
 * it — but scoped CSS never can, because the svg is created at runtime and
 * never receives the scope attribute. The override therefore has to travel
 * inline, which is what Plot's `style` option is for, and it must be a
 * STRING (see the header note).
 */
export const PLOT_STYLE = [
  '--plot-background:transparent',
  'background:transparent',
  'color:var(--muted-foreground)',
  'font-family:var(--font-sans)',
  // A token, not a literal: `font-size:11px` pinned every tick and axis label
  // in the plot to 11 CSS px, so the one part of the chart that is pure text
  // was the one part that ignored the reader's type scale and the season's.
  'font-size:var(--text-ui-xs,11px)',
  'overflow:visible',
].join(';');

/**
 * The categorical ramp. Ordinal scales receive these verbatim.
 *
 * Seven, not five: the theme contract compiles a seven-slot palette
 * (`--chart-1…7`), so stopping at five made a six-series chart silently
 * reuse colour 1 for series 6 while two perfectly good season colours went
 * unused — and it hid the top of the palette axis from anyone judging the
 * season by its charts.
 */
export const HUES = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--chart-6, var(--boxel-teal))',
  'var(--chart-7, var(--boxel-red))',
];

/**
 * The sequential ramp, for `heatmap`. It cannot be an interpolated two-stop
 * scale: d3 would have to PARSE the endpoint colours to interpolate them,
 * and `var(--chart-1)` is unparseable outside the document. A `quantize`
 * scale maps into a discrete range instead, so these five strings reach the
 * SVG untouched — which is the only way a heatmap can be theme-obedient.
 */
export const RAMP = [15, 33, 51, 70, 92].map(
  (pct) =>
    'color-mix(in oklch, var(--chart-2) ' +
    pct +
    '%, var(--card))',
);

export const BORDER = 'var(--border)';
export const INK = 'var(--muted-foreground)';
export const CARD = 'var(--card)';

// ── The Glimmer ↔ Plot binding ───────────────────────────────────────────

/** Everything the modifier needs to draw, recomputed as one tracked unit. */
export interface ChartDraw {
  /** the Plot options, minus `width` (which is measured, not declared);
   * `undefined` when building the spec itself threw */
  spec: PlotSpec | undefined;
  /** drawing height in px */
  height: number;
  /** why there is nothing to draw, `undefined` when there is */
  error: string | undefined;
}

/**
 * Owns exactly one child of the host element: the node `plot()` returns.
 *
 *  * builds it on install and whenever `draw` changes identity
 *    (ember-modifier runs the destructor first, so the old node is gone
 *    before the new one lands);
 *  * re-builds it at the container's width via a `ResizeObserver` — the
 *    guard `w === lastWidth` is what stops a resize→redraw→resize loop, and
 *    is the reason an observer is safe here where a frame loop would not be;
 *  * drops it on teardown, leaving the host element empty and the observer
 *    disconnected.
 *
 * A throw from `plot()` is caught and rendered, because it is invisible to
 * every other gate: `boxel parse`, `boxel lint` and
 * `boxel realm indexing-errors` all pass while the chart silently draws
 * nothing.
 */
export const plotInto = modifier((element: HTMLElement, [draw]: [ChartDraw]) => {
  let node: Element | undefined;
  let lastWidth = -1;

  let render = (rawWidth: number) => {
    let width = Math.round(rawWidth);
    // Guard the MARGINS, not just zero. Plot derives the inner plotting
    // area as width - marginLeft - marginRight; a container narrower than
    // those margins yields a negative inner width, which reaches the DOM as
    // `<rect width="-35">` and sprays console errors for every mark drawn.
    // A consumer's layout mistake should degrade, not scream.
    if (width < 1 || width === lastWidth) {
      return;
    }
    lastWidth = width;
    let failed = (message: string): Element => {
      let node = element.ownerDocument.createElement('p');
      node.className = 'pretui-chart-throw';
      node.setAttribute('data-test-pretui-chart-error', '');
      node.textContent = 'This chart could not be drawn: ' + message;
      return node;
    };
    let next: Element;
    let spec = draw.spec;
    if (draw.error !== undefined || spec === undefined) {
      next = failed(draw.error ?? 'the chart specification was rejected');
    } else {
      try {
        // Plot derives the inner plotting area as width - marginLeft -
        // marginRight. A container narrower than those margins yields a
        // NEGATIVE inner width, which reaches the DOM as
        // `<rect width="-35">` and throws once per mark drawn. Squeeze the
        // margins together instead: a cramped chart still reads, and a
        // consumer's layout mistake degrades rather than screaming.
        let marginLeft = (spec.marginLeft as number) ?? 48;
        let marginRight = (spec.marginRight as number) ?? 18;
        let floorWidth = marginLeft + marginRight + 8;
        let fitted = spec;
        if (width < floorWidth) {
          let room = Math.max(0, width - 8);
          let share = room / (marginLeft + marginRight);
          fitted = {
            ...spec,
            marginLeft: Math.floor(marginLeft * share),
            marginRight: Math.floor(marginRight * share),
          };
        }
        next = plot({ ...fitted, width, height: draw.height }) as Element;
      } catch (thrown) {
        next = failed(
          thrown instanceof Error ? thrown.message : String(thrown ?? 'unknown'),
        );
      }
    }
    node?.remove();
    node = next;
    element.replaceChildren(next);
  };

  // Rebuilding the plot swaps the element's children, which can change the
  // observed element's own size inside the observation cycle — the browser
  // reports that as "ResizeObserver loop completed with undelivered
  // notifications". Deferring one frame moves the rebuild outside the cycle.
  let frame = 0;
  let observer = new ResizeObserver((entries) => {
    let entry = entries[entries.length - 1];
    if (!entry) {
      return;
    }
    let width = entry.contentRect.width;
    if (frame) {
      cancelAnimationFrame(frame);
    }
    // One-shot paint-cycle deferral, not a loop: only rAF escapes the
    // ResizeObserver delivery step; a runloop/microtask hop would re-trip it.
    // eslint-disable-next-line @cardstack/boxel/no-raf-for-state -- paint callback
    frame = requestAnimationFrame(() => {
      frame = 0;
      render(width);
    });
  });
  observer.observe(element);
  // First paint: the observer fires asynchronously, and a chart that only
  // appears after a resize is a chart that never appears in a screenshot.
  render(element.clientWidth || 640);

  return () => {
    observer.disconnect();
    if (frame) {
      cancelAnimationFrame(frame);
    }
    node?.remove();
    element.replaceChildren();
  };
});

// ── The vocabulary ───────────────────────────────────────────────────────

/**
 * The mark vocabulary. One searchable enum rather than fourteen components.
 *
 * | value       | Plot marks           | `@x`            | `@y`            |
 * |-------------|----------------------|-----------------|-----------------|
 * | `line`      | `lineY` (+ `dot`)    | ordinal or time | quantitative    |
 * | `area`      | `areaY` + `lineY`    | ordinal or time | quantitative    |
 * | `bar`       | `barY`               | categorical     | quantitative    |
 * | `bar-h`     | `barX`               | quantitative    | categorical     |
 * | `scatter`   | `dot`                | quantitative    | quantitative    |
 * | `histogram` | `rectY` + `binX`     | quantitative    | (counted)       |
 * | `heatmap`   | `cell`               | categorical     | categorical     |
 * | `waffle`    | `waffleY`            | categorical     | quantitative    |
 * | `connected` | `line` + `dot`        | quantitative    | quantitative    |
 * | `bubble`    | `dot` (`@value` → r)  | quantitative    | quantitative    |
 * | `band`      | `areaY`               | ordinal or time | low (`@value` high) |
 * | `timeline`  | `barX`                | start (`@value` end) | categorical |
 * | `waterfall` | `barY`                | categorical     | start (`@value` end) |
 * | `dumbbell`  | `ruleY` + `dot`       | start (`@value` end) | categorical |
 *
 * `@x` is ALWAYS the horizontal channel and `@y` ALWAYS the vertical one,
 * including for `bar-h` — which is why horizontal bars are a separate mark
 * rather than an `@orientation` flag that would silently swap the meaning of
 * two args.
 */
export type ChartMark =
  | 'line'
  | 'area'
  | 'bar'
  | 'bar-h'
  | 'scatter'
  | 'histogram'
  | 'heatmap'
  | 'waffle'
  | 'connected'
  | 'bubble'
  | 'band'
  | 'timeline'
  | 'waterfall'
  | 'dumbbell';

/** Scale types a caller may pin. Omit to let Plot infer from the data. */
export type ChartScaleType =
  | 'linear'
  | 'log'
  | 'sqrt'
  | 'utc'
  | 'time'
  | 'band'
  | 'point';

/**
 * A channel: either a key of the row type, or a function of the row. The key
 * form is checked against `T`, so a typo in a channel name is a compile
 * error rather than an empty chart.
 */
export type ChartChannel<T> =
  | Extract<keyof T, string>
  | ((row: T, index: number) => unknown);

export function readChannel<T>(
  row: T,
  channel: ChartChannel<T> | undefined,
  index: number,
): unknown {
  if (channel === undefined) {
    return undefined;
  }
  if (typeof channel === 'function') {
    return channel(row, index);
  }
  return (row as Record<string, unknown>)[channel];
}

/** A label for a channel: the caller's, or the key name when it is a key. */
export function channelLabel<T>(
  channel: ChartChannel<T> | undefined,
  given: string | undefined,
): string {
  if (given !== undefined) {
    return given;
  }
  return typeof channel === 'string' ? channel : '';
}

export const NUMBERS = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 2,
});
const DAYS = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

/** One cell of the text alternative, formatted for reading rather than maths. */
export function displayValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '—';
  }
  if (value instanceof Date) {
    return DAYS.format(value);
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? NUMBERS.format(value) : '—';
  }
  if (typeof value === 'boolean') {
    return value ? 'yes' : 'no';
  }
  return String(value);
}

/** Numeric coercion for the summary's extent, tolerant of dates and strings. */
export function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (value instanceof Date) {
    return value.getTime();
  }
  return undefined;
}

export const MARK_NOUN: Record<ChartMark, string> = {
  line: 'Line chart',
  area: 'Area chart',
  bar: 'Bar chart',
  'bar-h': 'Horizontal bar chart',
  scatter: 'Scatter plot',
  histogram: 'Histogram',
  heatmap: 'Heat map',
  waffle: 'Waffle chart',
  connected: 'Connected scatter plot',
  bubble: 'Bubble chart',
  band: 'Range band chart',
  timeline: 'Timeline chart',
  waterfall: 'Waterfall chart',
  dumbbell: 'Dumbbell chart',
};
