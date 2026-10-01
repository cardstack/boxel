## What it is

What an agent produced, as a small card: an eyebrow, a title, a few lines, and an overflow menu. Use it when a run yields an artefact worth surfacing — a file it wrote, a record it created, a summary it generated. If you are showing a *change* rather than a product, **DiffBlock**. If you are showing progress, **WorkItem**. If the result is a real Boxel card, **FittedCard** renders the card itself and is the better choice.

## The contract

```
@eyebrow?, @title (required), @lines?: string[], @onMenu?
```

**`@lines` is an array of strings, not a block.** That is the constraining decision: a ResultCard cannot contain arbitrary markup, so it cannot grow into a mini-dashboard inside a transcript. Three or four lines of plain text, and anything richer is a different component. In a territory whose failure mode is transcript rows competing with each other for attention, that is a discipline rather than a limitation.

**The overflow menu is a single `@onMenu` callback**, not a **Menu**. The `⋯` button calls you and you decide what opens. That keeps the card free of dropdown machinery and means a transcript of forty results is not forty **Menu** instances — but it also means the affordance is a button that *looks* like a menu trigger and has none of the semantics (see below).

`@eyebrow` uses the kit's mono uppercase voice, shared with **Panel**, **Toolbar** and **DataGrid** headers.

## Prior art

Nothing in a component library corresponds. The references are product surfaces: Claude Code's file-write summaries, ChatGPT's canvas cards, Slack's unfurl blocks, and Linear's inline entity previews.

The comparison worth drawing is against **Slack's Block Kit unfurls**, which is the most mature version of "a small card summarising an artefact inside a conversation". Block Kit lets an unfurl contain fields, images, buttons and accessories — and the result is that conversations fill with rich blocks that dominate the messages around them. Pretui's `@lines: string[]` is the deliberate opposite bet, and in a territory where the transcript is the primary reading surface it is the better one.

Where it is thin, and these are real: **no link or click target on the card itself** (a result you cannot open is a dead end — the menu is the only affordance), **no icon or thumbnail**, **no state** (a result that has since been deleted or superseded has no way to say so), and **no relationship to the WorkItem that produced it**.

## Accessibility

No pattern governs it; it is a small content card with one button.

Gaps, and the menu button is the clearest:

- **The `⋯` button is labelled `aria-label="More"` and nothing else.** It carries no `aria-haspopup`, no `aria-expanded`, and — because the menu is the caller's — nothing connects it to whatever it opens. "More" also does not say more *about what*: on a transcript with eight results, eight buttons all announce identically. `aria-label="More actions for {{@title}}"` would fix the second problem; `aria-haspopup="menu"` plus `aria-expanded` managed by the caller would fix the first. Note **Menu** in this kit has the same wiring gap, so composing them does not resolve it.
- **The card has no accessible name or grouping.** Eyebrow, title and lines are sibling elements, so a screen-reader user hears them as one run with no indication that they form a unit or where it ends. `role="group"` with `aria-labelledby` pointing at the title would give it a boundary — worth doing precisely because a transcript is a long series of these.
- **The title is not a heading**, so a transcript of results has no structure to navigate by. Same gap as **Panel**, **Toolbar**, **EmptyState** and **Stat** — the kit needs an authorable heading level.
- **The eyebrow is announced as loose text before the title**, so the title alone is often not self-describing.
- **No announcement when a result appears.** An agent producing output mid-run is a status message (**WCAG 4.1.3**); nothing here or in the territory announces it. This is the territory-wide gap that **ApprovalFooter** and **AgentQuestion** also have.
- **`@lines` are plain strings**, so a line containing a path or an id gets no `<code>` treatment and is announced as prose — **Token** exists for exactly that and cannot be used here.
- Target size: the `⋯` button should be checked against WCAG **2.5.8**'s 24×24 minimum; overflow affordances are conventionally small.

## Theming

`--card` (the surface), `--border` and `--pretui-shadow-card` (its edge), `--foreground` (title), `--muted-foreground` (eyebrow and lines), `--font-mono` + `--text-ui-xs` + `--track-eyebrow` (the eyebrow voice), `--hover` (the menu button's hover), `--text-ui-md`.

Because the surface is `--card` and it sits inside a transcript that is usually also on `--card`, a season must keep `--pretui-shadow-card` doing real work — the hairline is the only thing separating a result from the rows around it. A season that reduces it to nothing leaves the card indistinguishable from the transcript, which is exactly the distinction this component exists to draw.
