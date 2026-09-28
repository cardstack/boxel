## What it is

Quantitative completion: how much of a known task is done. Two renders from one component — a continuous bar for percentages, and a **stepped** row of segments for small discrete totals ("3 / 6"). Reach for it when there is a real numerator and denominator. If the number is a _measurement_ within a range rather than progress toward completion — disk used, score, capacity — use **Meter**, which is a different pattern and deliberately looks different. If the duration is unknown, use **Spinner** or **LoadingState**.

## The contract

```
@value: number   (required)
@max? (100), @label?, @count?, @steps?
```

**The stepped/continuous choice is inferred, not configured.** `@steps` forces it, but the default is `@count !== undefined && @max <= 12` — pass a count and a small max and you get discrete segments, because six segments read faster than a bar at 50%. Twelve is the cutoff where segments stop being countable at a glance.

`@count` is a _display override_, not the value: pass `'3 / 6'` and the header shows that instead of `50%`. The header only renders when `@label` or `@count` is present, so a bare bar has no chrome.

`min-width: 4px` on a non-zero fill is the detail that stops 1% from rendering as nothing — a bar that shows no progress when progress exists is worse than no bar.

## Prior art

**Web Awesome `wa-progress-bar`** has `value`, `indeterminate` and `label`, hardcodes `aria-valuemin="0"`/`aria-valuemax="100"`, and — less correctly — sends `aria-valuenow="0"` when indeterminate. **React Aria `useProgressBar`** sets `aria-valuenow` and `aria-valuetext` to `undefined` when indeterminate, which is the right handling: an indeterminate progress bar has no value, and asserting zero is a lie. **Radix `Progress`** composes `Root`/`Indicator` with `value`, `max` and `getValueLabel`, and models `null` as indeterminate.

Pretui's differentiator is the **stepped mode**, which none of the three ships. For "3 of 6 approvals" a segmented row communicates the denominator visually, and a percentage bar does not. Inferring it from the data rather than exposing another mode arg is the good version of that idea.

Where it is behind: **there is no indeterminate state at all.** That is the single most-used progress variant in the field and it is absent — for an unknown-duration operation you must switch to **Spinner** or **LoadingState**, which is a different visual language mid-operation.

## Accessibility

Governing role: `progressbar` with `aria-valuemin`, `aria-valuemax`, `aria-valuenow`, and `aria-valuetext` when the raw number is not human-meaningful.

Gaps, and they are the kind that pass review by looking present:

- **`aria-valuemin` is missing.** Only `aria-valuenow` and `aria-valuemax` are set. The default is 0 in most implementations so this usually works, but it is one attribute and the role's contract asks for it.
- **No accessible name.** `@label` renders as visible text in the header and is **not** wired to the `progressbar` element — no `aria-label`, no `aria-labelledby`. A screen-reader user hears "progress bar, 60" with no idea what is progressing. This is the most consequential gap, and the label already exists to fix it.
- **No `aria-valuetext`.** For the stepped mode especially, "3" is announced where "3 of 6 approvals" is meant. `@count` already holds that string.
- **The visible header is not part of the widget.** Label and count sit in a sibling `<div>` outside the `progressbar` element, so they are announced as loose adjacent text rather than as the control's name and value.
- **No announcement on change.** A progress bar that advances silently is correct for a fast operation and unhelpful for a slow one; there is no live region and no hook for one.
- **Stepped mode conveys state by fill colour alone.** `data-on` changes `background` from `--inset` to `--primary` with no shape, border or glyph difference — a WCAG **1.4.1 Use of Colour** risk if a season's `--primary` and `--inset` are close in luminance.
- The 4px bar height is below any comfortable pointer target, but nothing here is interactive, so 2.5.8 does not apply.

## Theming

`--primary` (fill and lit segments), `--inset` (track and unlit segments), `--muted-foreground` (label), `--foreground` (count), `--font-mono` + `--text-ui-xs` (the count's tabular-figure voice), `--text-ui-sm`, `--pretui-dur-morph` / `--pretui-ease-morph` (the fill transition, shared with the kit's other value animations).

The 4px height, 2px radius and 3px step gap are fixed. A season must keep `--primary` and `--inset` clearly separable in luminance, not just in hue — that separation is the entire signal in stepped mode, and it is the one most likely to be lost in a dark season where `--inset` drifts toward mid-grey.

## React ecosystem

shadcn `Progress`. Ant `Progress`. Aria `ProgressBar`. Indeterminate
is **Spinner**, not a bar with no value. Accept `value` / `max` /
`isIndeterminate` (→ Spinner or a recipe).
