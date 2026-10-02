## What it is

A chart with a text alternative built in: a plot, a generated one-sentence summary, and a `<details>` disclosure holding the actual numbers as a real table.

The data is never only pixels. That is the design, and it is what makes this usable as a data component rather than as a picture.

## The contract

```
every DataArgs<T> arg — @rows or @load, @loadKey, @key, and the rest
@mark?     — which mark to draw. Default 'line'
@x?, @y?   — the channels; @y is omitted for 'histogram', which counts
@series?   — splits the data into coloured series and drives the legend
@value?    — the auxiliary quantitative channel: heat-map magnitude, bubble radius,
             or the second endpoint for band, timeline, waterfall and dumbbell
@xLabel?, @yLabel?, @seriesLabel?, @valueLabel? — human labels for axis, summary and table
@xType?, @yType? — pin a scale type instead of letting Plot infer it
@height?   — drawing height in px, excluding legend and table. Default 300
@stacked?  — stack multi-series 'area' instead of overlaying. Default true
@points?   — a point at every datum on line/area. Default true under 120 points
@curve?    — default 'monotone-x'; 'linear' for none
@bins?, @zero?
@label?    — accessible name; prepended to the generated summary
@caption?  — printed under the chart, for the reader rather than the axis
@hideLegend?, @hideTable?, @tableLimit?
@symbols?  — encode series as point symbols as well as colour. Default true

<:header>, <:loading>, <:empty>, <:error> — replace the toolbar, spinner, empty state and alert
```

**`@symbols` defaults to true, and it is a correctness default rather than a stylistic one.** Series distinguished by colour alone fail for a colour-blind reader; adding a point symbol per series makes them distinguishable without it.

**`@hideTable` costs the chart its text alternative.** The contract says so: only reach for it when the same numbers are already in a table beside it, and say so in `@label`.

**A named unfinished edge:** multi-series `bar` **always** stacks and ignores `@stacked`. Placing bars side by side needs Plot's `dodgeX` transform, which is not in the vendored lean entry — adding it means re-bundling Plot, not writing a flag.

## Prior art

**Observable Plot**, vendored.

Where Pretui is better: the text alternative is not optional infrastructure a caller has to build. Every charting library ships a canvas or an SVG and leaves accessibility to the integrator, which in practice means it does not happen. Here the summary sentence and the data table are part of the component, and turning the table off is a documented cost rather than the default state.

Where it is thinner: the vendored lean entry constrains what marks are available — the `dodgeX` gap above is one visible consequence — and there is no interaction model beyond the legend: no brushing, no zoom, no crosshair.

## Accessibility

- **Three layers, and the first two are text.** A generated one-sentence summary names what the chart shows and its extent; a `<details>` disclosure holds the data as a `<table>` with proper `<th scope>`; the plot itself is the third.
- **The summary is written into the host element as a visible, testable line of words**, not only as an ARIA attribute — so it can be asserted on, and so it is there for everyone.
- **`@label` is prepended to the summary** rather than replacing it, so a caller adds context without losing the generated description.
- **Series are encoded by symbol as well as colour** by default. This is the single most common chart accessibility failure and the default fixes it.
- **The legend is interactive**, so series can be toggled by keyboard rather than only read.
- **`@tableLimit` truncates at 100 rows by default**, which is a real limitation: a chart over a thousand points has a text alternative describing the first hundred.

## Theming

`--pretui-chart-gap` and `--pretui-chart-key` (plot spacing and the legend key), `--pretui-shadow-hairline`, `--pretui-z-sticky` for the legend.

Series colours come from the season's chart palette rather than from Plot's defaults, which is what makes a chart look like part of the product — and, combined with `@symbols`, means a season can choose a palette on aesthetics without breaking series distinguishability.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
