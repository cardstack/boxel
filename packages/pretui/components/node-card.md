## What it is

The default node shell inside a **NodeCanvas**: a titled card carrying a machine value, a supporting line and a status, with handles drawn on the sides `@flow` selected. It is what a node looks like when you do not supply your own `@nodeBody`. Use it as-is for most graphs; replace it when a node needs real content. Outside a canvas it is not useful — for a record row use **EntityDisplay**, for a tile **FittedCard**.

## The contract

```
@node?, @id?, @data?: NodeCardData, @selected?, @dragging?
Element: HTMLDivElement
```

`NodeCardData` is `{ title?, kind?, meta?, status?, hue?, label?, … }` — **and any extra keys are yours to use in a custom body**, so the payload is a real data bag rather than a closed shape.

**The title falls back four deep**: `title` → `label` (the engine's own bare-label key) → `id` → `'Untitled'`. That chain matters because a graph assembled from an engine's default shape has only `label`, and a graph assembled from raw records may have only ids — a node with no visible name is a dot with an edge, and the fallback guarantees there is always something to read.

**The hue is derived**: `data.hue ?? statusHue(status ?? kind ?? title)`. Same 32-bit hash as **StatusChip** and **Avatar**, so a node's colour is stable across renders and across canvases with no registry — and an explicit `hue` overrides it. Law 2: one hue in, a complete treatment out.

`kind` renders as a **Token** (Law 3 — machine values as jewelry) and `status` as a derived-hue chip, so a node wears the same vocabulary as the rest of the kit rather than inventing a canvas-only look.

## Prior art

**React Flow's default node** is a bordered box with a label and nothing else — deliberately minimal, on the assumption that everyone writes their own. **xyflow's** node types (`default`, `input`, `output`, `group`) differ only in which handles they draw.

Pretui's shell is a considered default rather than a placeholder, and the differences are:

- **Depth is hairline plus shadow (Law 1); the stock node border is gone.** A graph of bordered rectangles reads as a wireframe; a graph of cards reads as objects.
- **Four content slots with a defined typographic hierarchy** — title, kind, meta, status — rather than one label. A node that can carry its type and its state without a custom component is a node most graphs will not need to replace.
- **Derived hue** (above), so a graph of thirty nodes is legible by colour without anyone assigning colours.
- **Handles follow `@flow`**, drawn by the shell to match the edge endpoints the canvas set. This is the fix for the React Flow foot-gun where a custom node draws handles on the right while the engine routes edges from the bottom.

Where it is thin: no ports beyond the single source/target pair (multi-port nodes need a custom `@nodeBody`), no expand/collapse, no inline editing, and no icon slot.

## Accessibility

No pattern of its own — the node's semantics come from **NodeCanvas**, which gives every visible node `tabindex="0"` and `aria-roledescription="node"`, and moves selection between them with Tab and the arrow keys.

What that means for this component:

- **The node's accessible name is its rendered content**, which is why the four-deep title fallback matters: a node that would otherwise be nameless still announces something.
- **`kind`, `meta` and `status` are announced as part of the node**, in DOM order, with no structure — "Ingest, pipeline-04, upstream feed, running" reads as one run. Grouping them, or marking `kind` and `meta` as descriptions, would give it shape.
- **`status` is a derived-hue chip and the hue means nothing** (it is a hash, exactly as in **StatusChip**), so the word carries the meaning and colour is not doing semantic work. That is the right arrangement and it satisfies **WCAG 1.4.1** by construction.
- **`@selected` and `@dragging` are visual states with no announced counterpart.** Selection in particular is the canvas's primary state, and a screen-reader user moving selection with Tab hears the node's name but nothing confirming it is now selected. `aria-selected` on the node would close it — though it belongs to the engine, not to this shell.
- **The handles are decorative to assistive tech and load-bearing to pointer users.** There is no keyboard path to create or reconnect an edge anywhere in this stack (see **NodeCanvas** gap 1), so the handles are pointer-only affordances.
- **The graph's text form is `@summary` on NodeCanvas**, not here. A NodeCard's real accessibility comes from being enumerated in that list, which is why giving nodes meaningful titles matters more than anything this component does.
- Focus visibility is restored by the canvas's injected skin sheet — the engine sets `outline: none` and Pretui puts it back.

## Theming

`--card` (node surface), `--border` and the kit's shadow tokens (the hairline-plus-shadow depth that replaces the stock border), `--foreground` and `--muted-foreground` (title and meta), plus **Token**'s tokens for `kind`, the derived-hue chip dress for `status`, and the `--chart-1` … `--chart-5` palette the hash indexes into.

As with **StatusChip**, the palette must work as a *set*: nodes sit side by side at small sizes with arbitrary hue assignment, so all five chart hues need to be mutually distinguishable and legible as an ink/fill pair. Handle and edge colours come from **NodeCanvas**'s `--xy-*` mapping, not from here.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
