## What it is

A headline number with a label and an optional signed change: the KPI tile. Use it at the top of a dashboard or panel where one figure is the point. If you need several, put several in a row — there is no group component, deliberately. If the number is a proportion, **ProgressBar** or **Meter** carries more meaning. If it is a category, **Chip**. If you want the rolling digits without the label/delta framing, use **Odometer** directly.

## The contract

```
@label, @value
@delta?, @roll? (default true), @minDigits?, @placeholder? ('—')
@locale?, @style?, @currency?, @minimumFractionDigits?, @maximumFractionDigits?, @useGrouping?, @options?
@announce?, @duration?, @ease?, @stagger?
```

The `Intl.NumberFormat` surface is passed through wholesale, so currency, percent and grouping are the platform's, not a bespoke formatter.

Three decisions worth understanding.

**The headline rolls by default, and the roll is timer-free.** `@roll` delegates to **Odometer**, whose digit animation is one CSS animation keyed off each digit's from→to pair. Realm components own no timers — the prerenderer blocks them — so the alternative would have been no animation at all. `@roll={{false}}` falls back to plain text.

**Both branches format through the same `formatNumber`.** The rolling path and the static path cannot print a value differently, because the formatting is reused rather than reimplemented. That sounds obvious and is the thing that goes wrong in every dashboard with two render paths.

**Odometer's cell-height arg is deliberately not re-exposed here.** Stat derives it as `calc(var(--pretui-stat-line) * 1em)` from its own headline line-height, so a digit cell and the text line box are exactly the same height. Letting a caller set them apart is the one knob that can shift the label's baseline, so it is not exposed. `@minDigits` reserves width up front (via `--pretui-stat-min-digits`) so the row never reflows as digits are added.

## Prior art

**Nobody ships a Stat component.** Radix, Web Awesome, shadcn and React Spectrum all leave it to composition; shadcn's dashboard blocks assemble one from `Card` + `CardHeader` + text. The recognisable references are product patterns — Stripe Dashboard, Linear's insights, Vercel Analytics — plus **motion-primitives' `AnimatedNumber`** and **cult-ui's `animated-number`** for the rolling digits specifically.

Where Pretui's version earns its place:

- **The rolling digits are CSS, not a JS tween.** Every animated-number implementation in the reference set drives a `requestAnimationFrame` loop or a spring; this one is an animation keyed off the digit pair, which means it works under prerender, cannot leak, and costs nothing when off-screen.
- **The layout cannot jump.** `@minDigits` plus the derived cell height means a value going from 999 to 1,000 does not shift the label or the delta. Hand-rolled KPI tiles reflow constantly.
- **`Intl` passthrough rather than a bespoke format API.** Spectrum does this too; most dashboard components invent `prefix`/`suffix`/`decimals` props that cannot express a locale.

Where it is thin: no sparkline slot, no icon, no comparison-period label ("vs. last month" is on you), no size axis, and no grouping component. Composing `Delta` is built in; composing anything else is not.

## Accessibility

No APG pattern; this is text, governed by WCAG **1.3.1**, **4.1.3** and **2.3.3**.

What is right: `@announce` is passed through to Odometer, so the rolling value can be announced deliberately rather than by accident — and it is opt-in, which is correct, because a live-updating number in a live region narrates endlessly.

Gaps:

- **The label and value have no programmatic association.** They are two sibling `<span>`s. A screen-reader user hears "Revenue" then "1,284,000" then possibly "+12%" as three unrelated fragments. Wrapping in a `<dl>`/`<dt>`/`<dd>` — the markup **KeyValue** already uses — or pointing `aria-labelledby` from the value at the label would fix it, and this is the clearest change to make.
- **The label is a `<span>`, not a heading**, so a dashboard of stats has no structure to navigate by.
- **The rolling digits are a per-digit DOM structure.** Unless Odometer supplies a flat text mirror, a screen reader may encounter the digit cells individually — "one, comma, two, eight, four". Verify what `@roll={{true}}` announces before shipping it in a dashboard; `@roll={{false}}` is the safe path and produces identical text.
- **The `@delta`'s direction is colour plus a `+`/`-` character at 11.5px** — see **Delta**'s own note. In a Stat this matters more, because the delta is often the actionable part of the tile and it is the smallest, lowest-contrast element in it.
- **Continuously updating numbers and WCAG 2.2.2.** A Stat wired to live data animates on every change; there is no pause control and no `prefers-reduced-motion` branch documented at this level (Odometer owns that — check it).
- **`@placeholder` defaults to `'—'`**, which several screen readers announce as "em dash" or skip entirely. A visually-hidden "no data" would be kinder.

## Theming

`--pretui-stat-line` (the headline line-height ratio, and the thing the digit cell height is derived from — the one token that moves both together), `--pretui-stat-min-digits` (set from `@minDigits`), plus the kit's type scale for the headline and `--muted-foreground` for the label. The delta's colours are **Delta**'s (`--success`, `--destructive`, `--muted-foreground`), and the rolling digits' motion tokens are **Odometer**'s (`@duration`, `@ease`, `@stagger` are args, not tokens).

`--pretui-stat-line` is the important one: a season that restyles the headline's line-height through it gets the digit cells moving in lockstep and the baseline staying put. A season that instead overrides `line-height` directly on `.pretui-stat-value` will desynchronise the two and the label will shift when the value rolls.
