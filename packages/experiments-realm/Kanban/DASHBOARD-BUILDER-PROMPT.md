# Dashboard Builder — Starting Prompt

Copy this into a new session for the assistant that will build the dashboard layout builder.

---

## Prompt

```
I'm building a CSS Grid dashboard builder in Boxel. Read these files first:

1. Read DASHBOARD-BUILDER-CONTEXT.md — this is the full architecture handoff
2. Read .claude/commands/boxel-development.md — the Boxel development skill
3. Read SURFACE-ARCHITECTURE.md — how the Surface engine works
4. Read Surface/card-format.gts — format configurations
5. Read infinite-canvas.gts — the existing canvas card (the starting point)

The dashboard builder extends the infinite canvas with a second mode: CSS Grid layout.

**What already works (don't rebuild):**
- Free-form 2D canvas with drag, resize, snap guides, multi-select
- Card rendering in fitted/embedded/isolated formats
- Frame persistence (position, size, format, layer order)
- Pan/zoom with momentum
- Split panel with sidebar

**What to build:**
1. A mode toggle: Canvas ↔ Grid (top-level switch on the card)
2. Grid mode rendering — a real CSS Grid container that places cards into cells
3. GridPlacementField — stores grid-column, grid-row, colSpan, rowSpan per card
4. DashboardGridSettings — columns, rows, gap, padding, row height config
5. Grid interaction — drag cards between cells, resize spans by dragging cell edges
6. Canvas → Grid conversion — a function that analyzes free-form positions and quantizes them into grid placements
7. A grid settings panel in the sidebar (column/row count, gap, sizing)

**Key design decisions:**
- Grid mode does NOT use the Plane/FrameManager — it's a separate rendering path
- Both modes share the same card data (sampleCards via linksToMany)
- Both modes store their own position data (canvas coords vs grid placement)
- Switching modes preserves both — you can go back and forth
- The fitted format is the primary format for dashboard tiles
- The grid container should be scrollable (not infinite canvas)

**Start with:**
1. Create the new FieldDefs (GridPlacementField, DashboardGridSettings)
2. Create the DashboardCard definition with both modes
3. Build the grid rendering (CSS Grid with cards in cells)
4. Add the canvas → grid conversion function
5. Wire up the mode toggle and sidebar settings

The dashboard builder will live on a separate realm. For now, build it alongside the infinite canvas in the same realm (helpful-slug) so we can import the Surface components directly.
```
