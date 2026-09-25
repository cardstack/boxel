## What it is

A signed number, coloured by its sign: green up, red down, grey flat. Use it beside a metric to show change — a **Stat**'s trend, a diff count, a variance column. It is the pill-less **Token**: same mono, tabular-figure voice, no background. If the number is not a change, use **Token** or plain text. If it is a proportion of a whole, **Meter** or **ProgressBar**. If the change needs an explanation, **Chip** with a label.

## The contract

```
@value: number | string   (required)
@format?: (n: number) => string
```

`@value` is coerced with `Number()`, so `'12'` and `12` behave identically — convenient when the value comes from JSON, and worth knowing because a non-numeric string becomes `NaN`, which is `flat` and renders as "NaN".

**The default format is `(n > 0 ? '+' : '') + n`.** The explicit `+` on positives is the decision: without it, "12" and "-12" are distinguished by a character that is easy to miss at 11.5px, and the sign is the whole message. Negatives keep their native minus.

`@format` replaces the whole string, so it is where percentages, currency and rounding go — `{{fn this.pct}}` producing `'+4.2%'`. Note the sign prefix is _not_ re-applied over a custom format, so a formatter must add its own `+`.

## Prior art

There is no component for this in Radix, Web Awesome, shadcn or React Spectrum — it is a formatting concern everyone solves at the call site with a ternary and two colour classes. The closest analogues are product conventions: a stock ticker's delta, Stripe Dashboard's trend figures, Linear's cycle-change indicators.

Where making it a component pays off:

- **The sign→colour mapping is decided once.** Green-up/red-down is a convention, not a law — it is inverted in several East Asian markets, and it means the opposite for a cost metric than for a revenue metric. Having one component means changing that convention is one edit, and having it _not_ be a component means the ternary is copy-pasted into forty call sites with three different green tokens.
- **`data-sign` is reflected**, so a season or a call site can restyle by sign without touching the logic.
- **Tabular figures by default**, so a column of deltas aligns on the decimal point. This is the detail hand-rolled deltas always miss.

Where it is thinner than it should be:

- **No arrow or glyph.** Colour and the `+`/`-` character are the entire signal (see below).
- **No neutral-zero handling beyond `flat`**: exactly `0` is grey, but `0.0001` is green. For a metric with noise you want a threshold, and there is no `@epsilon`.
- **No semantic inversion.** A component that knows "down is good here" — falling error rate, falling cost — would need `@invert`, and there is none. Currently you must pass a negated value and a custom format, which is a lie in the data.

## Accessibility

No pattern governs it. It is text.

Gaps, and the first is the real one:

- **Colour and a `+`/`-` character are the only signal, and the character is nearly invisible.** At `--text-ui-sm` (11.5px), a minus sign is a two-pixel dash and a plus is barely wider. For a user who cannot distinguish the green from the red, the direction of change is effectively unavailable. That is a **WCAG 1.4.1 Use of Colour** concern in practice even though a text character technically exists. An arrow glyph (▲ / ▼), or `aria-label`s like "up 12 percent", would close it — and note that **Rating**, **Alert** and **FieldError** in this kit all pair hue with a glyph for exactly this reason. Delta is the outlier.
- **`data-sign` reaches CSS but not assistive tech.** There is no `aria-label`, no visually-hidden "increase"/"decrease", nothing. The announced text is "+12" — better than nothing, and `+` is announced as "plus" by most readers, which does carry it. Verify with your target readers; this is the mitigating factor.
- **`NaN` renders as "NaN"** with `flat` styling. A malformed value produces visible garbage rather than an empty cell.
- **No relationship to what it measures.** A Delta beside a Stat is loose adjacent text; **Stat** composes it, which is the right way to use it.
- **`--success` and `--destructive` must both clear WCAG 1.4.3 at 11.5px weight 500** against `--card`. Green in particular is the token most often set too light for small text.
- Nothing is focusable, correctly.

## Theming

`--success` (up), `--destructive` (down), `--muted-foreground` (flat), `--font-mono`, `--text-ui-sm`. The 500 weight and tabular figures are fixed.

Three tokens and nothing else — which makes this the cheapest component in the kit to season, and also means a season that wants a different sign convention (or a colour-blind-safe blue/orange pair instead of green/red) can get it entirely by repointing `--success` and `--destructive` _for this component's context_, without touching the code. That is worth knowing: the sign→token mapping is fixed, but the token→colour mapping is not.
