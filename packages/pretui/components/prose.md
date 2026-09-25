## What it is

The typographic reading surface: a measure-limited container that styles the prose you put inside it. Use it to wrap authored body copy — a card's description, a markdown render, a README, an article body. It does not parse anything; it is CSS with a boundary. If the content is a single short paragraph inside a form, it does not need this. If it is a code sample, put a `<pre>` inside it. If it is a machine value inline, use **Token**, which is the louder cousin of what this styles `<code>` as.

## The contract

```
<:default>
Element: HTMLDivElement
```

No args. Two things happen inside it, and they are both worth stating because they are what you are actually buying.

**`max-width: 62ch`.** The measure — the number of characters per line — is the single largest determinant of whether body copy is comfortable to read, and 62ch sits inside the 45–75 range typography research consistently lands on. Because it is `ch`, it tracks the font actually in use rather than assuming a pixel width. A card that renders prose full-bleed across a 1600px pane is unreadable, and this is the one line that prevents it.

**`line-height: calc(var(--leading-body) / var(--text-body))`.** The leading is expressed as a _ratio derived from two absolute tokens_, so a season sets a body size and a leading in pixels — the way a type scale is actually designed — and the ratio falls out. Setting `line-height` as a bare number would decouple them and let a season's leading drift when it retunes the size.

Paragraph margins (`0 0 var(--space-4)`) and inline `<code>` styling reach the yielded content through `:deep()`, which is the narrow, legitimate use of the escape hatch: the component must style markup it did not render.

## Prior art

**`@tailwindcss/typography`** (`prose`) is the reference and is enormously larger — it styles headings, lists, blockquotes, tables, figures, `<hr>`, links, and ships size and colour modifiers. **shadcn** has no prose component; its docs use the Tailwind plugin. **Web Awesome**, **Radix** and **React Spectrum** all ship nothing here — Spectrum's `Content`/`Text` are layout slots, not typographic surfaces.

Pretui's version is **deliberately two rules**, and the honest framing is that this is a floor, not a competitor to `prose`. What it gets right that the minimal hand-rolled version does not: the measure is enforced (most in-house prose styles forget it), and the leading is derived from the type scale rather than guessed.

What is missing versus `prose`, and it is a lot: **no heading styles, no list styles, no blockquote, no link treatment, no table styling, no `<pre>` block**. Content with an `<h3>` or a `<ul>` inside a Prose gets browser defaults, which will not match the kit. For a markdown render — the obvious use case — that is a real gap, and the practical consequence is that most markdown in this kit still looks like a browser default document below the paragraph level.

The `<code>` treatment is the one element it does style, and it is coordinated: quieter than **Token** (a plain `--inset` fill, no hue) so inline code recedes into prose while a Token stands out. That distinction is deliberate and is the kit's Law 3 in two registers.

## Accessibility

No pattern governs it. The relevant criteria are WCAG **1.4.8 Visual Presentation** (AAA), **1.4.12 Text Spacing** (AA) and **1.4.10 Reflow** (AA).

What is right, and it is genuinely more than most kits:

- **`max-width: 62ch` directly serves WCAG 1.4.8**, which asks for no more than 80 characters per line. Comfortably inside it.
- **Leading derived from the type scale** rather than hardcoded means a season that increases body size gets proportional leading. WCAG **1.4.12** requires content to survive a user stylesheet setting line-height to 1.5× — since the leading here is a ratio on a `div` and paragraph margins are in `--space-4`, user overrides apply cleanly rather than fighting a fixed pixel `line-height`.
- **Reflow**: `max-width` with no `min-width` means the surface shrinks correctly at 320px.

Gaps:

- **Unstyled headings are a structural risk, not just a visual one.** Because `Prose` styles nothing above the paragraph, authors are tempted to fake headings with bold paragraphs — which produces content with no heading structure at all (**WCAG 1.3.1**, and a navigation failure for screen-reader users). Styling `<h2>`–`<h4>` would remove the temptation.
- **Links are unstyled**, so they inherit the browser's blue-and-underlined default, which will not match the season and may not meet **1.4.3** against a themed background. It also means link/non-link distinction is whatever the UA decides.
- **Lists are unstyled**, so nested lists inherit default indentation that will not match the kit's spacing scale.
- **No `text-wrap: pretty` or `balance`**, so headings and short paragraphs get orphans. Minor, and a one-line improvement.
- **The `<code>` fill is `--inset` with a hairline**, at `0.92em`. That is small text at low contrast against a low-contrast fill; check per season.
- Nothing is focusable; anything interactive inside is the caller's.

## Theming

`--leading-body` and `--text-body` (which together produce the line-height ratio), `--space-4` (paragraph spacing), and for inline code: `--font-mono`, `--inset`, `--border`, `--pretui-shadow-hairline`.

The `62ch` measure is fixed and is the one thing a season most often wants to change — a display-face season with a wide font may want 58ch, a condensed one 68ch. There is no token for it, so changing the measure means changing the component.

Because everything else inside is unstyled, **a season's control over prose is limited to the type scale tokens**; heading, list and link appearance inside a Prose are the browser's, whatever the season says.
