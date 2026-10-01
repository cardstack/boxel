## What it is

The agent's written output as a document: a title, an eyebrow, a strip of machine facts, the cards it cited, and a full-report disclosure.

## The contract

```
@title (required) — the report's title
@eyebrow?    — small-caps line above the title, e.g. 'Research · 12 sources'
@meta?       — short facts rendered as a machine-value strip under the title
@cards?      — the cards this report cites
@onOpenCard? — fires when a card pill is activated
@expanded?, @defaultExpanded?, @onExpandedChange? — the disclosure
@expandLabel?, @collapseLabel? — wording. Defaults 'Full report' / 'Collapse'
```

**The cited cards are pills, not links in prose.** A report that cites twelve things should let you reach any of them without reading for the reference, and `@onOpenCard` is how the host routes that.

**`@meta` is a machine-value strip**, rendered in the **Token** treatment — counts, durations, model names — which keeps them scannable and distinct from the prose.

**The disclosure is the whole report**, so a transcript holds a summary until someone wants the rest.

## Prior art

The research-report surfaces in agent products.

Where Pretui is better: citations as first-class pills with an open callback, rather than as inline links the host cannot intercept. That is what lets a report's sources open in the right place in a workspace rather than navigating away.

Where it is thinner: no inline citation markers tying a sentence to a source, no export, and no section navigation within a long report.

## Accessibility

- **The disclosure is the kit's**, so collapsed content is inert and the relationship is wired from self-minted ids.
- **The title is a real heading**, so a report is findable in a transcript by heading navigation — which is the primary way a screen-reader user moves through a long session.
- **Card pills are buttons with their own names**, so the citations are reachable and distinguishable rather than being a row of identical chips.
- **`@meta` is text**, announced after the title, so the facts about the report are available without opening it.
- **`@eyebrow` is context, not a heading** — it sits above the title without competing with it in the outline.

## Theming

The report takes the kit's block spacing, heading and **Token** treatments; the card pills are **RecordPill**-shaped.

Nothing here is separately themeable, which is right for a component whose job is to look like a document inside an application that already has a type scale.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
