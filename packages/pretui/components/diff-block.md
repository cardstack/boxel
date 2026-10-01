## What it is

A staged change rendered as a diff, with an immutable receipt line, collapsing when long. Use it wherever an agent shows what it altered — a file edit, a field patch, a config change — before or after **ApprovalFooter** gates it. If you are showing a *result* rather than a change, **ResultCard**. If it is a code sample rather than a diff, that is `<pre>` inside **Prose**.

## The contract

```
@lines: DiffLine[]   (required)
@receipt?, @maxLines? (default 8)
```

**`@maxLines` defaults to 8 and long diffs collapse by default** (`@tracked collapsed = true`). That is the right default for a transcript: an agent that edits three files should not fill the viewport with 400 lines the user has not asked to read. Expansion is per-block, so the user opens the one they care about.

**The receipt is immutable and separate from the diff.** It is the line that survives after the change is folded away — the thing a user scrolling a settled transcript sees in place of the full diff. That is the territory's fold law in miniature: settled work folds to receipts, and the receipt is the durable artefact, not the diff.

`DiffLine` carries the per-line kind (added, removed, context) that drives the row dress.

## Prior art

No component kit ships a diff view. The references are `diff2html`, GitHub's blob diff, VS Code's inline diff, and Monaco's diff editor — all of them tools rather than components, and all much larger.

The interesting comparison is what this deliberately does not do:

- **No syntax highlighting.** GitHub and Monaco both highlight; this renders plain mono text. That keeps the component free of a language grammar dependency and keeps a diff in a transcript reading as *a change*, not as code — which is the right emphasis when the user is deciding whether to approve it.
- **No side-by-side mode.** Unified only. In a transcript column that is the only mode that fits.
- **No line numbers**, so a diff here cannot be referenced by line — a real limitation when discussing a change with the agent.
- **No hunk headers or context expansion.** `@maxLines` truncates from the top of the block rather than showing collapsed context regions the way GitHub does.

Where it is better than dropping a `diff2html` render into a transcript: the receipt line, the collapse default, and the fact that it wears the kit's mono voice rather than a diff library's own theme.

## Accessibility

No pattern governs it, and diffs are genuinely hard to make accessible. The relevant criteria are WCAG **1.4.1 Use of Colour**, **1.3.1** and **2.1.1**.

Gaps, and the first is the classic diff failure:

- **Added and removed lines are almost certainly distinguished by fill colour and a `+`/`-` prefix character.** If the prefix is present and part of the text, **WCAG 1.4.1** is satisfied — verify it, because if the `+`/`-` is a CSS `::before` or a background tint alone, colour is the only channel and the diff is unreadable for a colour-blind user. This is the single most important thing to check on this component.
- **Diffs are hostile to linear reading.** A screen reader announcing forty lines of mono text with `+`/`-` prefixes conveys very little. The accessible affordance is a *summary* — "3 lines added, 1 removed in config.json" — and the **receipt** is very nearly that already. Making the receipt the primary announced content, with the diff as expandable detail, would be a genuine improvement and the structure is already there.
- **The collapse control's state is not described here.** Verify it is a real `<button>` with `aria-expanded` and a name that says what expands ("Show 40 more lines"), not a bare chevron.
- **The truncation is silent.** A collapsed diff shows 8 of 40 lines; nothing announces that 32 are hidden, so a screen-reader user may believe they have read the whole change before approving it. Given that this component feeds an approval decision, that is a **WCAG 3.3.4** concern, not just an annoyance.
- **No `<table>` or list semantics**, so line-to-line relationships are positional only.
- **Long lines**: verify they wrap rather than scroll horizontally, or a keyboard user cannot reach the end of one (**WCAG 2.1.1**, and **1.4.10 Reflow**).
- The receipt is text, which is right — it is the durable, readable form.

## Theming

Mono voice (`--font-mono`, `--text-ui-sm`), added and removed row tints derived from `--success` and `--destructive` mixed against `--card`, context rows in `--muted-foreground`, `--inset` for the block surface, `--border` for its edge, and the receipt in the quieter ink.

The added/removed tints are the tokens to check per season. They must be distinguishable from each other **and** legible as backgrounds behind mono text at 11.5px — a season that tunes `--success` and `--destructive` for **Delta**'s foreground ink will usually find them far too strong as fills here. Because the tints are `color-mix` derivations rather than fixed hexes, adjusting the mix ratio is the lever; adjusting the hue is not.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
