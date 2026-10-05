## What it is

Quantitative completion: how much of a known task is done. Two renders from one component — a continuous bar for percentages, and a **stepped** row of segments for small discrete totals ("3 / 6"). Reach for it when there is a real numerator and denominator. If the number is a _measurement_ within a range rather than progress toward completion — disk used, score, capacity — use **Meter**, which is a different pattern and deliberately looks different. If the duration is unknown, use **Spinner** or **LoadingState**.

## The contract

```
@value: number   (required)
@max? (100), @label?, @count?, @valueText?, @hue?, @steps?
...attributes → the progressbar element (aria-label, aria-labelledby, …)
```

**The stepped/continuous choice is inferred, not configured.** `@steps` forces it, but the default is `@count !== undefined && @max <= 12` — pass a count and a small max and you get discrete segments, because six segments read faster than a bar at 50%. Twelve is the cutoff where segments stop being countable at a glance.

`@count` is a _display override_, not the value: pass `'3 / 6'` and the header shows that instead of `50%`. The header only renders when `@label` or `@count` is present, so a bare bar has no chrome.

**The root element is the `progressbar`.** Attributes passed to the component land on the widget itself, so a bar with no visible header is named with `aria-label='Time left before the SLA breaches'`, or pointed at a heading with `aria-labelledby`. `@label` both shows the header text and names the bar; a caller's `aria-label` wins over it. A bar named by none of these is called "Progress", as boxel-ui's ProgressBar is, so it never renders as a nameless `progressbar`.

`@valueText` is the announced reading of the value when the number alone would mislead (a run that ended early fills every segment, but "6 of 6" is not what happened). It changes what assistive tech hears, not what the header shows. In stepped mode it defaults to `@count`; a continuous bar announces a percentage unless `@valueText` is given, since its count ("300 files") need not carry the total.

`@hue` paints the fill (and the lit segments) in any CSS colour, typically a state hue: `@hue='var(--warning)'`. It is the same one-colour arg as Meter's and Chip's `@hue`, and like theirs it writes a per-component custom property, `--pretui-progress-hue`, on the root, so the same knob can also be set on any ancestor, or in a caller's `style`. A caller's `style` attribute replaces the component's own, so a bar that takes a `style` carries the knob in it rather than in `@hue`.

`min-width: 4px` on a non-zero fill is the detail that stops 1% from rendering as nothing — a bar that shows no progress when progress exists is worse than no bar.

## Prior art

**Web Awesome `wa-progress-bar`** has `value`, `indeterminate` and `label`, hardcodes `aria-valuemin="0"`/`aria-valuemax="100"`, and — less correctly — sends `aria-valuenow="0"` when indeterminate. **React Aria `useProgressBar`** sets `aria-valuenow` and `aria-valuetext` to `undefined` when indeterminate, which is the right handling: an indeterminate progress bar has no value, and asserting zero is a lie. **Radix `Progress`** composes `Root`/`Indicator` with `value`, `max` and `getValueLabel`, and models `null` as indeterminate.

Pretui's differentiator is the **stepped mode**, which none of the three ships. For "3 of 6 approvals" a segmented row communicates the denominator visually, and a percentage bar does not. Inferring it from the data rather than exposing another mode arg is the good version of that idea.

Where it is behind: **there is no indeterminate state at all.** That is the single most-used progress variant in the field and it is absent — for an unknown-duration operation you must switch to **Spinner** or **LoadingState**, which is a different visual language mid-operation.

## Accessibility

Governing role: `progressbar` with `aria-valuemin`, `aria-valuemax`, `aria-valuenow`, and `aria-valuetext` when the raw number is not human-meaningful.

What it does:

- **The root element carries `role="progressbar"`** with `aria-valuemin="0"`, `aria-valuenow` and `aria-valuemax`, so `...attributes` reach the widget: `aria-label` and `aria-labelledby` name it directly.
- **`aria-valuenow` is `@value` clamped to `[0, @max]`**, the same clamp the fill, the lit steps and the visible percentage use, so `@value={{180}}` against a max of 100 is announced as 100, and what assistive tech hears matches the bar a sighted user sees. An unset or non-finite `@value` reads as 0, and a negative or non-finite `@max` as 0, so `aria-valuenow` never reads `NaN` and `aria-valuemax` never drops below `aria-valuemin`. A `@max` of 0 is an empty range: any value against it is announced as 0, and the continuous bar is empty at 0%. A stepped bar with a `@max` of 0 has no segments, so its track renders nothing and only the header (when there is one) shows.
- **`@label` is the accessible name** as well as the visible header text. A caller's `aria-label` replaces it, and a caller's `aria-labelledby` takes precedence over both. A bar with none of these falls back to the name "Progress", so it passes the role's required-name rule, but a screen-reader user still hears "Progress, 60%" with no idea what is progressing — name it.
- **`aria-valuetext`** is `@valueText` when given. In stepped mode it falls back to `@count`, so the bar announces "3 / 6" where "3" alone would be meaningless. A continuous bar does not fall back to its count, which can drop the total ("300 files"), so with no `@valueText` assistive tech derives a percentage from the value range.
- **The visible header is inside the widget and `aria-hidden`.** The name and value already say what the label and count show, so they are not announced a second time as loose text.

Gaps, and they are the kind that pass review by looking present:

- **No announcement on change.** A progress bar that advances silently is correct for a fast operation and unhelpful for a slow one; there is no live region and no hook for one.
- **The fill fails WCAG 1.4.11 Non-text Contrast (3:1) against its track in the shipped light seasons.** The fill (`--pretui-progress-hue`, default `--primary`) sits on `--inset` with no border, and stepped mode tells lit from unlit segments by that colour alone. Measured against light `--inset`: the default `--primary` is 1.20:1 in SS26 (3.37:1 in AW26, 4.84:1 in SS27); `--warning` is 2.14, 1.58 and 2.01:1; AW26's `--pretui-attention` is 1.45:1 and its `--destructive` 2.90:1; SS26's `--success` and `--pretui-info` are 2.55 and 2.70:1. Every dark-mode pair passes, at 5.20:1 or higher.
- The 4px bar height is below any comfortable pointer target, but nothing here is interactive, so 2.5.8 does not apply.

## Theming

`--pretui-progress-hue` (the fill and lit segments; defaults to `--primary`, set by `@hue` or on any ancestor), `--inset` (track and unlit segments), `--muted-foreground` (label), `--foreground` (count), `--font-mono` + `--text-ui-xs` (the count's tabular-figure voice), `--text-ui-sm`, `--pretui-dur-morph` / `--pretui-ease-morph` (the fill transition, shared with the kit's other value animations).

The 4px height, 2px radius and 3px step gap are fixed. A season must keep `--primary` (and a caller any `--pretui-progress-hue` it sets) and `--inset` clearly separable in luminance, not just in hue — that separation is the entire signal in stepped mode. The shipped light seasons do not yet meet 3:1 there (see Accessibility); their dark modes do.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.

## React ecosystem

shadcn `Progress`. Ant `Progress`. Aria `ProgressBar`. Indeterminate
is **Spinner**, not a bar with no value. Accept `value` / `max` /
`isIndeterminate` (→ Spinner or a recipe).
