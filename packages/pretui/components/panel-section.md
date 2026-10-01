## What it is

A titled group inside a panel, optionally collapsible, with a nesting depth that reads in a still frame.

## The contract

```
@title?       — section heading
@level?       — heading level for the title, 2–6. Default 3 — a panel section sits
                under the panel's own h2
@collapsible? — false makes the section a plain titled group with no disclosure
@open?, @defaultOpen? — controlled / uncontrolled. Default open
@summary?     — small count shown after the title, e.g. "3 effects"
@depth?       — 0 (default) is top-level; 1–3 mark a group nested INSIDE another
```

**`@depth` is the arg worth understanding.** A nested group drops the peer hairline, de-shouts its heading out of small-caps, and hangs its body off a vertical rule — so the nesting is legible **in a still frame** rather than only while collapsing. Indentation alone compounds and stops meaning anything by the third level.

**`@level` defaults to 3** because a panel section sits under the panel's own `h2`. It is separate from `@depth`: visual nesting and outline level are different questions, and a section can be visually nested without being a deeper heading.

**`@collapsible={{false}}` makes it a plain titled group** — no button, no disclosure, just a heading and content.

## Prior art

The inspector section in design tools and the accordion section in kits.

Where Pretui is better: separating depth from heading level, and making depth legible at rest. Most implementations convey nesting by indentation only, which is invisible in a screenshot and meaningless past two levels.

Where it is thinner: no drag-to-reorder, no per-section actions in the header, and depth capped at 3.

## Accessibility

- **The heading is a real heading at `@level`**, so a panel of sections has a navigable outline.
- **`@depth` and `@level` being separate is the accessibility point**: a section can be visually nested without lying about the document structure, and vice versa.
- **When collapsible, it is a full disclosure** — real button, `aria-expanded`, `aria-controls` — and when not, there is no control at all rather than a disabled one.
- **`@summary` is part of the heading's announced text**, so "Effects, 3" arrives together rather than as two fragments.
- **Default open is the right default** for a panel: content that starts hidden is content many readers never find.

## Theming

The section takes the kit's border, heading and surface tokens; depth changes which of them apply rather than introducing new ones.

That is what keeps a nested section recognisably the same component as a top-level one — it is quieter, not different.
