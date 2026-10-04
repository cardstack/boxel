## What it is

A highlighted source block with a header, a gutter, a copy control and a scroll ceiling.

**DiffBlock** is a diff. **Token** is inline. It highlights with its own small lexer, coloured from the theme.

## The contract

```
@code?       — the source text, rendered as text nodes — never as markup
@language?   — language name or alias; wins over an extension guessed from @filename.
               Anything unrecognised renders as plain text
@filename?   — shown in the header and used to guess the language
@caption?    — a line of prose under the header
@lineNumbers? — show the gutter
@startLine?  — the number the first line carries, for an excerpt from mid-file
@highlight?  — lines to mark, as '3, 7-9' or [3, 7, 8, 9]
@wrap?       — soft-wrap long lines instead of scrolling sideways
@maxLines?   — scroll ceiling, in lines
@noCopy?     — hide the copy button
@label?      — the region's accessible name; defaults to the filename or language
@binary?     — the content is not text; renders an explanation instead of mojibake
@maxHighlightBytes? — above this, highlighting switches itself off
```

**The source is rendered as text nodes, never as markup.** That is the whole safety story for a component whose entire job is displaying strings that came from somewhere else.

**The highlight mark is a left bar as well as a tint**, so a marked line survives greyscale — a tint alone is the usual implementation and the usual failure.

**Gutter numbers are `user-select: none`**, so dragging a selection across the code does not drag the line numbers along with it. Anyone who has pasted code out of a documentation site knows why this matters.

**`@maxLines` exists because the source this replaced had none**, and a five-hundred-line snippet rendered five hundred lines tall.

**`@maxHighlightBytes` degrades rather than hanging.** Above the threshold, highlighting switches itself off instead of building a span per token; the text still renders in full.

**`@binary` renders an explanation rather than a screen of mojibake.** The source modelled this flag and never consumed it.

## Prior art

**highlight.js** and **Shiki**, and the code block every documentation site ships.

Where Pretui is better: four failure modes handled that most implementations leave open — unbounded height, unbounded highlighting cost, binary content, and line numbers that come along with a copy-paste. The greyscale-safe highlight mark is the fifth.

Where it is thinner: no diff view — that is **DiffBlock** — no editable mode, no per-token linking, and no language auto-detection beyond the filename extension.

## Accessibility

- **The body is a `role='region'` with an accessible name** from `@label`, the filename or the language, and it is focusable — which is what makes a horizontally scrolling code block reachable by keyboard. A scroll container with no tab stop cannot be scrolled without a pointer.
- **The gutter is `aria-hidden`.** Line numbers announced before every line would make the code unlistenable.
- **The expand control carries `aria-expanded` and `aria-controls`**, pointing at the body, so the scroll ceiling can be lifted by keyboard and the state is announced.
- **Highlighted lines are marked by a bar, not only a tint**, so the emphasis is perceivable without colour.
- **`@binary` explains rather than dumping**, which is the difference between an empty-seeming block and a stated condition.
- **Copy is a real button** and can be hidden, but not replaced — there is no pointer-only copy affordance.

## Theming

`--pretui-code-size`, `--pretui-code-leading` and `--pretui-code-tab` (type metrics), `--pretui-code-gutter`, `--pretui-code-max` (the scroll ceiling), `--pretui-shadow-card`, `--pretui-ease-snap`, plus the syntax channel: `--pretui-code-keyword`, `--pretui-code-string`, `--pretui-code-number`, `--pretui-code-comment`, `--pretui-code-name`, `--pretui-code-digits`.

The syntax colours being tokens rather than a bundled stylesheet is what lets a season own its own code palette — and it is the reason a code block in a dark season is a dark code block rather than a light one embedded in the page.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
