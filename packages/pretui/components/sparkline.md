## What it is

**An inline micro-chart**, a series drawn at the size of a word next to the number it explains: orders this week with the last twelve weeks beside it, or a table cell's trend. It comes as a line, an area or bars.

Reach for a neighbour when you need more:

- **Chart** is the full plot, with axes and a legend.
- **BarList** ranks named rows.
- **Stat** is the number the spark sits beside.

## The contract

```
@values (number[]), @label (required)
@kind? ('line' | 'area' | 'bar'; default 'line'), @tone? (default 'primary')
@width? (96), @height? (24), @showLast?, @zeroBased?
Element: SVGSVGElement
```

**Plain SVG, no engine.** Line and area are one path through the points, and bars are one rect per value. Line and area scale from the series minimum to its maximum, or include zero with `@zeroBased`. Bars always include zero and stand on it, up for positive values and down for negative ones, because a bar's length has to encode its distance from zero. The stroke keeps its width when the chart is stretched (`vector-effect: non-scaling-stroke`). There is 1px of headroom so the line is never clipped, and `@showLast` marks the final point.

**Degenerate series behave.** One value draws a flat line, an empty series draws nothing, and non-numbers (`NaN`, `Infinity`) are dropped.

**No animation.** A spark shows a shape, not a process.

## Prior art

**Mantine `Sparkline`** takes `data`, `curveType`, `color`, `fillOpacity`, `withGradient` and `trendColors`, and is built on Recharts. **Tremor `SparkAreaChart` / `SparkLineChart` / `SparkBarChart`** also use Recharts. **react-sparklines** is a small SVG library.

Where Pretui is better: **it has a name.** The chart is `role="img"`, named by `@label` plus a spoken summary ("from 12 to 41, low 12, high 41"), with the numbers formatted to at most two decimals. Mantine and Tremor render an unnamed SVG that a screen reader skips or reads as "image". **No chart engine** is loaded for a 96px drawing.

Where it is thinner: **no curve smoothing**, **no gradient fill**, **no trend-coloured tone** (pick `@tone` yourself), and **no tooltip or hover value**. Use **Chart** when the reader needs to read individual points.

## Accessibility

No APG pattern. It is an image.

- **`role="img"`, named by `@label` and a summary** of the first, last, lowest and highest values. The tests assert the full name, and "no data" for an empty series.
- **The label is required**, because a spark without one tells a screen reader nothing. Say what the series is and over what period, for example "Orders, last 12 weeks".
- **The tone is not the meaning.** A red spark still needs its label, and usually the number next to it, to say whether falling is bad.

## Theming

`--pretui-sparkline-hue` (set from the tone: `--primary` by default, or `--pretui-info`, `--success`, `--warning`, `--destructive`, `--pretui-attention`, `--muted-foreground`), `--pretui-sparkline-stroke` (line width, default 1.5), `--pretui-sparkline-fill` (area opacity, default 0.16) and `--card` (the ring around the last-point dot).

Size is an arg, because a spark is sized to its context rather than to the season.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.

## React ecosystem

| Agent types                                     | Give them                                  |
| ----------------------------------------------- | ------------------------------------------ |
| Mantine `<Sparkline data curveType="linear">`   | `<Sparkline @values @label>`               |
| Mantine `fillOpacity`                           | `@kind='area'` + `--pretui-sparkline-fill` |
| Tremor `<SparkBarChart>`                        | `@kind='bar'`                              |
| react-sparklines `<Sparklines><SparklinesLine>` | `<Sparkline>`                              |
| a hover tooltip per point                       | **Chart**                                  |
