## What it is

A machine value set like jewelry: a small mono pill for an id, a hash, a path, a rule name, a key. Law 3 of the kit — machine values are not prose and should not be typeset as prose, but they are also not errors and should not be typeset as code blocks. Use it inline in a sentence, in a table cell, in a definition list. If the value is a human-facing category, use **Chip**. If it is a signed number, **Delta**. If it is a whole code sample, that is `<pre>` inside **Prose**, not this.

## The contract

```
@value?, @hue?
<:default>   — used when @value is absent
Element: HTMLElement (a <code>)
```

**It renders `<code>`**, which is the correct element and is what makes it a Token rather than a styled span.

Two details worth knowing, both about how it behaves in context:

**`margin-inline: 0.35ch`.** A mono pill dropped into proportional prose sits too tight against its neighbours because the pill's padding is inside the box. A third of a character on each side restores the word rhythm — and because it is `ch`, it scales with the surrounding type.

**`:where(td, dd) > .pretui-token { margin-inline: 0 }`.** As a direct child of a table cell or a definition-list value, the margins go away so the pill aligns flush with the cell edge. The `:where()` keeps specificity at zero so a call site can override without a fight. This is a small thing that makes tables of ids look right without anyone thinking about it.

The hue defaults to `--pretui-primary-ink` falling back to `--primary`, and derives fill, ink and hairline from it by `color-mix` — 8% fill, 26% ink mix, 30% hairline. Note these are **much quieter ratios than Chip's** (20/34/45): a Token is meant to recede into prose, a Chip to stand out in a list.

`font-variant-numeric: tabular-nums` keeps a column of ids from jittering.

## Prior art

Nobody ships this as a component. **shadcn**, **Radix**, **Web Awesome** and **React Spectrum** all leave inline code to a `<code>` element and a stylesheet rule. The closest analogues are editorial rather than compositional: GitHub's inline-code treatment, Stripe's docs, and Notion's inline-code style.

So the comparison is against "a global `code { }` rule", and the improvements are specific:

- **It is a component, so a season can retune every machine value in the product at once** rather than hunting for a global rule that some card overrode.
- **`@hue` makes it tintable per instance**, which is what lets **FieldError**'s rule-id provenance, an error trace and a normal id look related but distinguishable.
- **The context-aware margins** (above) — a global `code` rule cannot know it is in a table cell without the same `:where()` trick, and almost none do it.
- **The size is derived**: `calc(var(--text-body) - 3.5px)`, so mono at the same optical size as the surrounding proportional text rather than the visually-larger result you get from matching point sizes. That is the detail that makes it read as jewelry rather than as a foreign object.

Where it is thinner: no copy affordance (compose **CopyButton** beside it), no truncation for long values (`white-space: nowrap` means a long path overflows), and no block variant.

## Accessibility

No pattern governs it. `<code>` is a semantic element with no interaction contract.

Notes and gaps:

- **`<code>` semantics are announced inconsistently.** Some screen readers say "code" before the content, some enter a verbatim/character-by-character mode, and most say nothing. That is a property of `<code>`, not of this component, and it is generally the right trade — the element is the honest markup for a machine value.
- **Long or opaque values are hostile to speech.** A UUID or a hash announced character by character is unusable, and announced as a word is meaningless. If a Token holds something a screen-reader user might need to transcribe, pair it with a **CopyButton** — that is the accessible affordance, not the text.
- **`white-space: nowrap`** means a long value overflows its container rather than wrapping, which can push a card horizontally and fail **WCAG 1.4.10 Reflow** at 320px. This is the most likely practical problem: paths and URLs are exactly what people put in Tokens.
- **Contrast.** Ink is `color-mix(--foreground 26%, hue)` on an **8%** hue fill — so the fill is nearly `--card` and the ink is nearly the hue. That is a better-behaved combination than **Chip**'s, but the text is `--text-body - 3.5px` (≈11.5px) and a pale `@hue` will produce pale ink on white. Check any custom hue at that size.
- **The hue carries no meaning** and there is no non-colour channel, so do not use `@hue` to encode state — use two components, or add text.
- Nothing is focusable, correctly.

## Theming

`--pretui-token-hue` (per instance, defaulting to `--pretui-primary-ink` → `--primary`), `--card` (mix base), `--foreground` (mixed into ink), `--border` (mixed into the hairline), `--font-mono`, `--text-body` (the size is derived from it), `--pretui-shadow-hairline` semantics via `box-shadow`.

The 8% / 26% / 30% mix ratios, the 4px radius, 5px padding and `0.35ch` margins are fixed — unlike **Chip**, whose mixes are tokenised. A season wanting quieter or louder tokens must change `--pretui-primary-ink`, which is the only lever.

Note that `--pretui-primary-ink` is meant to be a _readable-on-light-surfaces_ variant of `--primary`; a season that leaves it undefined falls back to `--primary` neat, and a saturated brand colour at 26% ink mix on an 8% fill is usually too light. Defining `--pretui-primary-ink` is effectively required for this component.
