## What it is

A machine value set like jewelry: a small mono pill for an id, a hash, a path, a rule name, a key. Law 3 of the kit — machine values are not prose and should not be typeset as prose, but they are also not errors and should not be typeset as code blocks. Use it inline in a sentence, in a table cell, in a definition list. If the value is a human-facing category, use **Chip**. If it is a signed number, **Delta**. If it is a whole code sample, that is `<pre>` inside **Prose**, not this.

## The contract

```
@value?, @hue?, @size?, @wrap?
<:default>   — used when @value is absent
Element: HTMLElement (a <code>)
```

**It renders `<code>`**, which is the correct element and is what makes it a Token rather than a styled span.

**`@size`** takes the house scale `xs | s | m | l | xl` (and the `sm` / `md` / `lg` / `small` / `medium` / `large` aliases), the steps mapped onto the Boxel font-size ladder: `xs` is `--boxel-font-size-2xs`, `s` is `--boxel-font-size-xs`, `m` is `--boxel-font-size-sm`, `l` is `--boxel-font-size` and `xl` is `--boxel-font-size-md`. Like Button's, it sets the font-size only; the padding, radius and margins stay as they are. It lands as `data-size` on the element. Without `@size`, or with `@size='default'` (as on Button, the component's own default), the size is `--boxel-font-size-xs`; `--pretui-token-font-size` pins it to another exact value instead. `@size` wins over that property.

**`@hue` and a caller's `style` work together.** Glimmer lets a caller's `style` attribute replace a component's own, so `@hue` is also written as a single `--pretui-token-hue` property on top of whatever style the element ends up with, and written again if the caller's style changes later. The caller's own declarations are kept, and so is a property another modifier on the element sets, such as boxel-ui's `setCssVar`. If the caller's style sets `--pretui-token-hue` as well, `@hue` wins, and the hue the caller's style last set comes back when `@hue` is cleared, including when the caller rewrote its style to `@hue`'s own value. One rewrite is not told apart from another modifier's write: a caller style that sets the hue exactly as `@hue` wrote it and changes some other declaration (dropping a property another modifier set counts). Its hue is not taken as the caller's, so clearing `@hue` brings back the caller's earlier hue, or none. `@size` and `@wrap` are data attributes, so a caller's style cannot remove them.

**`@wrap`** lets a long value (a path, a rule, a phrase) wrap: `white-space: normal` with `overflow-wrap: break-word`, so it breaks inside an unbroken id only when the line would overflow. (`anywhere` would count every character as a break when sizing a content-sized box, and could shrink the pill to one character in a table cell or `dd`.)

Two details worth knowing, both about how it behaves in context:

**`margin-inline: 0.35ch`.** A mono pill dropped into proportional prose sits too tight against its neighbors because the pill's padding is inside the box. A third of a character on each side restores the word rhythm — and because it is `ch`, it scales with the surrounding type.

**`:where(td, dd) > .pretui-token { margin-inline: 0 }`.** As a direct child of a table cell or a definition-list value, the margins go away so the pill aligns flush with the cell edge. The `:where()` keeps specificity at zero so a call site can override without a fight. This is a small thing that makes tables of ids look right without anyone thinking about it.

The hue defaults to `--primary-ink`, and derives the fill and hairline from it by `color-mix` — 8% fill, 30% hairline. The text is `--foreground`, which the theme guarantees against `--card`; the hue is not mixed into it, so a custom `@hue` tints the pill but never the text. Note these are **much quieter ratios than Chip's** (20/45): a Token is meant to recede into prose, a Chip to stand out in a list.

`font-variant-numeric: tabular-nums` keeps a column of ids from jittering.

## Prior art

Nobody ships this as a component. **shadcn**, **Radix**, **Web Awesome** and **React Spectrum** all leave inline code to a `<code>` element and a stylesheet rule. The closest analogues are editorial rather than compositional: GitHub's inline-code treatment, Stripe's docs, and Notion's inline-code style.

So the comparison is against "a global `code { }` rule", and the improvements are specific:

- **It is a component, so a season can retune every machine value in the product at once** rather than hunting for a global rule that some card overrode.
- **`@hue` makes it tintable per instance**, which is what lets **FieldError**'s rule-id provenance, an error trace and a normal id look related but distinguishable.
- **The context-aware margins** (above) — a global `code` rule cannot know it is in a table cell without the same `:where()` trick, and almost none do it.
- **The default size is `--boxel-font-size-xs`**, a step below body text, so mono sits at the same optical size as the surrounding proportional text rather than the visually-larger result you get from matching point sizes. That is the detail that makes it read as jewelry rather than as a foreign object.

Where it is thinner: no copy affordance (compose **CopyButton** beside it), no truncation for long values (it stays on one line unless `@wrap` is set, so a long path overflows), and no block variant.

## Accessibility

No pattern governs it. `<code>` is a semantic element with no interaction contract.

Notes and gaps:

- **`<code>` semantics are announced inconsistently.** Some screen readers say "code" before the content, some enter a verbatim/character-by-character mode, and most say nothing. That is a property of `<code>`, not of this component, and it is generally the right trade — the element is the honest markup for a machine value.
- **Long or opaque values are hostile to speech.** A UUID or a hash announced character by character is unusable, and announced as a word is meaningless. If a Token holds something a screen-reader user might need to transcribe, pair it with a **CopyButton** — that is the accessible affordance, not the text.
- **`white-space: nowrap`** is the default, so a long value overflows its container rather than wrapping, which can push a card horizontally and fail **WCAG 1.4.10 Reflow** at 320px. This is the most likely practical problem: paths and URLs are exactly what people put in Tokens. Set `@wrap` wherever the value can be long.
- **Contrast.** The text is `--foreground` on an **8%** hue fill, so the fill is nearly `--card` and the text is the theme's own foreground, a pairing the theme already checks. A custom `@hue` changes only the fill and the hairline, so it cannot lower the text contrast. The text is `--boxel-font-size-xs` (12px), or smaller at `@size='xs'`.
- **The hue carries no meaning** and there is no non-color channel, so do not use `@hue` to encode state — use two components, or add text.
- Nothing is focusable, correctly.

## Theming

`--pretui-token-hue` (per instance, defaulting to `--primary-ink`), `--card` (mix base), `--foreground` (the text color), `--border` (mixed into the hairline), `--font-mono`, `--pretui-token-font-size` (an exact size; unset, it is `--boxel-font-size-xs`), `--boxel-font-size-2xs` to `--boxel-font-size-md` (the `@size` steps), `--boxel-border-radius-xs` (the radius), `--boxel-sp-3xs` (the side padding); the hairline is a `box-shadow`.

Both `--pretui-token-hue` and `--pretui-token-font-size` can be set on the Token, through a class or `style`, or on any ancestor.

The 8% / 30% mix ratios, the radius (`--boxel-border-radius-xs`), the padding (`--boxel-sp-3xs`) and the `0.35ch` margins are fixed — unlike **Chip**, whose mixes are tokenized. A theme wanting quieter or louder tokens must change `--primary-ink`, which is the only lever.

`--primary-ink` is the contract's _readable-on-light-surfaces_ variant of `--primary`, so the default fill and hairline stay legible against `--card`.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
