## What it is

The fold: a disclosure whose indentation encodes **containment only, never importance**. Use it to nest agent work — a run containing actions containing steps — and to collapse settled work down to its receipt. This is the territory's structural primitive; **WorkItem** is what goes inside it.

## The contract

```
@receipt: string   (required)
@defaultOpen? (default false), @open?, @onOpenChange?(open: boolean)
<:default>
```

Hybrid controlled/uncontrolled, the kit-wide idiom.

**`@receipt` is required, and it is the collapsed representation.** A Fold is not "a chevron and some hidden content" — it is a receipt line that can be expanded into the work behind it. That inversion is the point: a settled transcript is a column of receipts, and the receipts are readable on their own. A disclosure with no summary would make a folded transcript a column of chevrons.

**Default closed.** Agent work accumulates; a transcript that expands everything by default is unusable after ten minutes.

**One step of nesting is 14px under a hairline rail** (`box-shadow: inset 1px 0 0 --border`, `padding-left: 14px`, `margin-left: 7px`). Nested Folds switch the rail to `--line-strong`, so depth is legible without the indent growing large enough to squeeze the content. That restraint is the fold law in CSS: 14px says "contained by", and nothing says "more important than".

## Prior art

**APG's Disclosure** is the governing pattern and is deliberately minimal: a button with `aria-expanded`, Enter/Space to toggle, and *no* arrow keys, no roving tabindex, no focus management — the whole keyboard contract is Tab and Enter/Space.

**Radix `Collapsible`** is `Root`/`Trigger`/`Content` with `open`/`onOpenChange`/`disabled` and a `--radix-collapsible-content-height` for animation. **Web Awesome `wa-details`** wraps a real `<details>`/`<summary>` with `open`, `summary`, `name` grouping, `appearance` and `icon-placement`. **Pretui's own Accordion** wraps boxel-ui's grid-rows disclosure engine.

So there are now **three disclosure mechanisms in this kit** — `Fold`, `Accordion`, and `FormSection` — and it is worth being clear about why, because it looks like duplication. `Accordion` is a group with a shared open policy; `FormSection` is a fieldset that knows about validation and can open itself; `Fold` is a single containment step with a required receipt and a rail. They are different components, but the *disclosure* part is written three times, and consolidating that onto one primitive would be a real improvement.

Where Fold is better than `<details>`: the receipt is a first-class arg rather than a `<summary>` you might forget, and the rail makes nesting legible. Where it is behind: `<details>` gives you the platform's semantics and Ctrl+F expansion for free.

## Accessibility

Governing pattern: APG **Disclosure**.

What is right: the trigger is a real `<button>` carrying **`aria-expanded`**, which is the pattern's one required property, and Enter/Space toggle it natively. No arrow keys and no roving tabindex — correctly, since the pattern has neither.

Gaps:

- **No `aria-controls`** pointing at the content region. Optional in APG, but it is the only thing that tells assistive tech *what* expands, and it is one attribute.
- **The receipt is the button's content, so it is the accessible name** — which is good, and means the announcement is "3 files changed, collapsed button". Verify no glyph is concatenated into it.
- **The nesting rail conveys containment visually and nothing conveys it programmatically.** A Fold inside a Fold is announced as a button followed by content followed by another button; the containment that 14px of indent makes obvious to a sighted user is invisible. Nested `role="group"`s with labels, or a real list structure, would carry it. For a territory whose central law is "indentation encodes containment", not expressing that containment in the accessibility tree is the notable gap.
- **The expansion is not announced beyond `aria-expanded` being re-read.** Content appearing below a button is discoverable by continuing to read, which is adequate.
- **Content is presumably removed from the DOM when closed** (a `{{#if}}`), so its controls are correctly unreachable — unlike **FormSection**, which keeps them registered on purpose. Know which you are using.
- **Deep nesting compounds tab stops**: every Fold is a tab stop, so a run with thirty folded steps is thirty tab stops before the next thing.

## Theming

`--border` (the first-level rail), `--line-strong` (nested rails), plus the receipt's ink (`--muted-foreground` or `--foreground` depending on state) and the kit's type scale.

The 14px indent, 7px offset and 1px rail are fixed — deliberately, since they *are* the fold law rather than decoration. A season should not increase the indent to make nesting more obvious; the two-tone rail is the intended mechanism, and the rails are the tokens to adjust.

Check `--line-strong` against `--border` per season: at two levels of nesting the rails are the only depth cue, and if the two tokens converge, a nested Fold looks identical to a sibling.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
