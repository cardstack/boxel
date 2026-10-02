## What it is

One cell of a **DashboardGrid**: a tile with a drag handle, a placement, and an attachment to the grid's engine.

## The contract

```
@id (required) — stable id; must match the placement's id
@host?     — the grid that owns this cell. DashboardGrid supplies it
@label?    — accessible label for the handle; normally the tile's title
@live?     — true when the grid is CONTROLLED, the only case where a later change
             to the placement may be pushed back into a live engine
@x?, @y?, @w?, @h? — the placement: the seed at registration, and the push value when @live
@staticStyle? — CSS-grid placement, READ-ONLY MODE ONLY

<:title>   the tile's own heading line
<:actions> trailing controls in the tile's bar
<:default> the tile body
```

**Without `@host` the cell renders as an inert box** — no engine attachment, no drag affordances. That is what read-only mode uses, and it is what makes the cell safe to drop into a static preview without the grid's machinery coming along.

**`@id` must match the placement's id.** The grid keys everything on id rather than index, so a mismatch means a tile the engine cannot place rather than a tile in the wrong spot.

**`@live` is set by the grid, not by the caller**, and it exists so the cell knows whether a placement change is authoritative or historical.

**The placement is a seed at registration and a push value only when live** — which is the per-cell half of the grid's controlled/uncontrolled rule.

**`@staticStyle` is read-only mode only.** An editable cell must never bind `style`, because the live engine keeps its geometry there — binding it would fight the drag.

## Prior art

The grid-item component in dashboard engines.

Where Pretui is better: the inert mode. Most grid items are inseparable from their engine, so rendering a dashboard's layout without the ability to edit it means either shipping the engine anyway or rebuilding the layout by hand.

Where it is thinner: one handle, no per-edge resize grips, and no per-tile constraints (minimum size, aspect lock) beyond what the placement expresses.

## Accessibility

- **The handle is a real button with a name** from `@label`, which is where the grid's keyboard path lives.
- **A tile with no host has no handle**, so an inert dashboard has no controls that lead nowhere.
- **`@label` defaulting to the tile's title** is what keeps a grid of handles distinguishable without the caller doing anything.
- **The tile's content keeps its own tab order.** The handle is an addition, not a wrapper that swallows what is inside.

## Theming

Nothing of its own — the cell contributes position and a handle; the surface is whatever the caller renders inside it.

That separation is what lets a dashboard be assembled from the kit's ordinary cards rather than from a dashboard-specific tile.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
