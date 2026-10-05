## What it is

A kanban board: configurable columns, cards you drag between them, a hidden-columns tray, per-lane add affordances and WIP limits. Reach for it when items move through named states and the movement is the interaction. If the states are a fixed linear process, **StepList** or **Timeline** reads better. If you just want tiles, **Grid**. If the arrangement is spatial and freeform rather than columnar, **NodeCanvas**.

## The contract

```
@columns: KanbanColumnConfig[]      { key, label, color, wipLimit, collapsed, sortOrder }
@placements: KanbanPlacement[]      { columnId, index, sortOrder }
@boardLabel?, @cardSize?, @hideEmpty?
@onChange?, @onSelect?, @onOpen?, @onAddCard?, @onToggleCollapsed?
<:card as |placement|>  <:ghost as |dragIndex|>
```

**The consumer owns all state; every interaction arrives as a callback.** The board never mutates your data — it hands you the next `placements` array and you decide.

**It is deliberately not generic, and the reason is worth reading.** A `KanbanPlacement` is `{ columnId, index, sortOrder }` — a **position, not a record**. The card payload never passes through the board at all; the consumer looks it up by `placement.index`. And boxel-ui's pure placement engine both *clones* placements (`placements.map(p => ({...p}))`) and *manufactures* them (`autoPlaceKanban`), so a `T extends KanbanPlacement` yielded from `<:card>` would be a cast the engine is under no obligation to honour. Typing a lie is worse than typing a position. **Grid**, **Feed** and **Masonry** are generic because their items are the caller's own rows passed straight through; Board is the one collection in the kit that keeps a closed row type, and this is why.

`<:ghost>` renders the drag preview, receiving the dragged index.

## Prior art

A **thin runtime wrap of boxel-ui's `KanbanPlane`** — the newer of boxel-ui's two kanbans, chosen per the component matrix as "the pure-fn placement engine". The engine owns a drag manager over pure placement functions, which is the good architecture here: placement is a function of `(placements, from, to)` rather than mutation scattered through drag handlers, so it is testable and undoable.

Against the field: **dnd-kit** and **react-beautiful-dnd** are the reference drag libraries, and neither is a board — you assemble one. **Atlassian's Jira board** is the canonical product. **shadcn**, **Radix**, **Web Awesome** and **React Spectrum** all ship nothing in this space; Spectrum's `dragAndDropHooks` on `ListBox`/`Table` is the closest primitive.

So the honest framing is that this exists because boxel-ui had a board and the kit wanted one cheaply, not because it out-designs a category leader. What it does bring that a dnd-kit assembly does not: WIP limits, a hidden-columns tray and column collapse as first-class config, plus placement-as-data so board state serialises to a card field trivially.

**Column configuration UI is not part of this wrap** — `KanbanColumnConfigSidebar` is a separate boxel-ui component. And the wrapper adds light no-theme fallbacks through the `--boxel-kanban-*` channel, because the engine's own defaults lean on bare `var(--foreground)` and friends, which have no unthemed value.

## Accessibility

This is the component with the largest accessibility surface in the kit and the least of it under Pretui's control. **All behaviour is boxel-ui's KanbanPlane; this wrapper adds no ARIA.** What the engine does today:

- **Keyboard moves.** Space or Enter picks a card up, arrows move it between columns and positions, Space or Enter drops it and Escape cancels, which covers **WCAG 2.1.1 Keyboard**.
- **Announced drags.** A polite status region speaks each step: "Column 2. Position 3 of 5.", "Card dropped.", "Movement cancelled.".
- **Structure.** The plane is named by `@boardLabel`, each column carries its label, its body is `role="list"` and every card is a `listitem`.
- **Gap: no single-pointer alternative.** Moving a card by pointer needs a drag, so **WCAG 2.5.7 Dragging Movements** (AA, 2.2) is not met; a "move to column" control in your `<:card>` block is the usual answer.
- **Cards need accessible names**, and that is on your `<:card>` block, not the board.
- **`@hideEmpty` removes columns from the DOM**, which changes the board's structure without announcement.

Pretui-level note: `@boardLabel` is the only accessibility affordance this wrapper exposes. Pass it.

## Theming

Consumed: `--foreground`, `--text-ui-md`, `--track-ui`.

Remapped into the `--boxel-kanban-*` channel, each with an explicit light fallback so the board holds the Pretui light uniform even unthemed: `--boxel-kanban-fg` ← `--foreground`, `-card-bg` ← `--card`, `-card-fg` ← `--card-foreground`, `-col-bg` ← `--inset`, `-col-fg` ← `--foreground`, `-ring` and `-primary` ← `--primary`, `-primary-fg` ← `--primary-foreground`, `-destructive` ← `--destructive`, `-destructive-fg` ← `--destructive-foreground`, `-muted-fg` ← `--muted-foreground`, `-radius` ← `--radius`, `-border` ← `--border`, `-bg` → `transparent`.

**The plane fills its host, so the wrapping context must have a height** — `height: 100%; min-height: 0` on the wrapper means a Board in an auto-height container renders as nothing. That is the first thing to check when it comes up blank.

Column colours come from `KanbanColumnConfig.color` — caller data, not tokens — so a season cannot retune them and a caller can trivially produce column headers that fail contrast against `--inset`. Prefer deriving those colours from season tokens at the call site.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
