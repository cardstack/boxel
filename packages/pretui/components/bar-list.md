## What it is

A ranked list of labelled bars: the "top N by value" list that sits beside a chart rather than in it.

It is a `DataComponent<BarListItem>`, so rows, loading, empty and error states come from that foundation.

## The contract

```
every DataArgs<BarListItem> arg — @rows or @load, @loadKey, @key, and the rest
@ranked? — sort descending by value before rendering. Default true
@limit?  — cap the number of rows rendered; the remainder is summarised
@max?    — scale the bars against this instead of the largest value
@format? — formats the printed value. Defaults to a locale integer
@label?  — accessible name for the list
@hue?    — row hue; every bar shares it, and a per-row hue wins

<:loading>, <:empty>, <:error>
```

**`@max` is what keeps two BarLists comparable side by side.** Scaling each list against its own largest value makes two lists look the same shape regardless of magnitude — which is exactly wrong when they are meant to be compared. Pass the same `@max` to both.

**`@limit` summarises the remainder** rather than silently dropping it, so "top 5" does not misrepresent a long tail as nothing.

**`@ranked` defaults to true**, because an unranked bar list is a bar chart with no axis.

## Prior art

The "top N" list in every analytics dashboard, and Tremor's BarList as the closest named equivalent.

Where Pretui is better: `@max` as an explicit comparability lever, the remainder being summarised rather than dropped, and riding **DataComponent** so loading and empty states behave like every other data surface in the kit.

Where it is thinner: no drill-down or row selection, no negative values, no stacked or grouped bars — one value per row — and no inline sparkline.

## Accessibility

- **The rows are an ordered list with an accessible name** from `@label`, which is what conveys rank: a reader is told this is first, second, third.
- **The bars are `aria-hidden`.** The value is printed as text on every row, so the bar is redundant to anyone not looking at it — and announcing a bar conveys nothing.
- **The printed value is the data.** `@format` shapes what is announced as well as what is shown.
- **Rank is conveyed by list order rather than by bar length alone**, which means the ordering survives without sight.
- **`@hue` is decoration.** Nothing in this component depends on distinguishing one bar's colour from another's.

## Theming

`--pretui-barlist-fill` and `--pretui-barlist-hue` (the bars), `--pretui-barlist-row-height` and `--pretui-barlist-gap` (density), plus `--pretui-chart-key` shared with **Chart**'s legend.

Sharing the chart key token matters when a BarList sits beside a Chart showing the same series: the two should agree on what a given series looks like, and pulling from one token is how that stays true through a season change.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
