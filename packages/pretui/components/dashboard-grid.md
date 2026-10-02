## What it is

A draggable, resizable tile grid: the dashboard layout engine with a keyboard path.

**DashboardItem** is one cell. This is the grid that owns them.

## The contract

```
@items (required) — the tiles; array order is PRESENTATION-NEUTRAL
@layout?    — the arrangement, keyed by id
@idFor?     — how an item's stable id is derived. Defaults to item.id, then the index
@labelFor?  — per-tile label for the drag handle. Defaults to title, then label, then id
@columns?   — column count at full width. Default 12
@cellHeight? — row height in px. Default 72
@gap?       — gutter in px. Default 8
@float?     — let tiles stay where they are put instead of packing upwards. Default false
@animate?   — animate the tiles a drag displaces. Default true, and ALWAYS off under
              prefers-reduced-motion
@editable?  — false renders the same layout with no engine and no affordances
@label?     — accessible name for the grid region. Default 'Dashboard'
@breakpoints? — responsive column steps, narrowest first: below a plane width
              of w, use c columns. Default [{w:560,c:2},{w:900,c:6}], capped by @columns
@onLayoutChange? — fires after a USER-driven change only
```

**Position lives in `@layout`, never on the item.** Array order is presentation-neutral, which is what lets the same items be arranged two ways without duplicating them.

**Controlled versus uncontrolled turns on `@onLayoutChange`.** Supply it and later changes to `@layout` are pushed back into the live grid; omit it and the array seeds the grid once, after which the engine owns the arrangement — so **a drag is never snapped back to an authored cell nobody updated.** Same rule as **NodeCanvas** applies to its own node list.

**Ids with no placement are auto-positioned; placements with no item are ignored.** Two overlapping placements resolve the way the live engine resolves them — the later one keeps the cell and the earlier is pushed down.

**`@editable={{false}}` renders the same layout with no engine at all**, which is what makes a dashboard safe to embed in a static preview.

**A responsive re-flow never reaches `@onLayoutChange`.** The authored layout is the one that persists — narrowing the window rearranges the view without rewriting what was saved. Adding or removing an item does not fire it either: the caller did that and already knows.

## Prior art

The gridstack-style dashboard engines.

Where Pretui is better: the controlled/uncontrolled rule stated and enforced, rather than a grid that fights its own props; and the read-only mode dropping the engine entirely rather than disabling affordances on top of it.

Where it is thinner: one authored arrangement re-flowed by column count rather than per-breakpoint layouts, no tile resize handles on every edge, and no persistence — where the layout is stored is entirely the caller's.

## Accessibility

- **The grid is a named region**, defaulting to 'Dashboard'.
- **Every tile's handle is named** through `@labelFor`, so a grid of twelve does not present twelve identical drag handles.
- **`@animate` is always off under `prefers-reduced-motion`**, and lands on the end state rather than freezing mid-displacement.
- **Read-only mode removes the affordances rather than disabling them**, so a keyboard user is not tabbing through handles that refuse.
- **Drag has a keyboard equivalent through the item's handle** — which is the whole reason the handle is a button rather than a grip.
- **Every move announces the tile's new column and row**, which is what actually orients a screen-reader user — and in read-only mode, with no engine to fight, the cells are in visual order in the DOM.

## Theming

`@columns`, `@cellHeight` and `@gap` are caller values rather than tokens, because a dashboard's grid is a property of that dashboard rather than of the season.

The tiles take whatever surface they are given, which is what lets a dashboard be built from ordinary cards.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
