---
validated: source-proven
---

# layout-kanban-drag-drop - Persistent drag-and-drop kanban board

> ⚠️ **Status — fitted blocks pre-date the CQ-mandatory rule.** The two `static fitted` templates in `example.gts` (WorkItem + WorkBoard) hand-roll width-based layout instead of the two-element `.cq → .fit` container-query pattern. The pattern's _core mechanics_ (KanbanPlane wiring, placements data model, pointer drag, WIP limits, hidden columns) are source-proven against `@cardstack/boxel-ui`; treat the fitted slots as placeholders and rewrite per [`boxel/references/container-query-fitted-layout.md`](../../../boxel/references/container-query-fitted-layout.md) before relying on them. (P2 in the skill-tree review.)

**What this gives you:** A board card with columns, fitted child cards, pointer drag, keyboard reordering, drag ghost, insertion gaps, hidden/collapsed columns, WIP limits, and persisted placements.

**When to use:**

- The user asks for a kanban board, status board, work tracker, deal board, editorial board, applicant pipeline, roadmap board, or any lane-based drag-and-drop UI.
- Cards need to keep identity and open normally, while the board owns only their lane/order placement.
- You need production-quality drag behavior without hand-rolling pointer math.

**The insight:** Use `KanbanPlane` from `@cardstack/boxel-ui/components`. Do not build drag/drop directly in the card. Persist a separate placement field (`itemId`, `columnKey`, `sortOrder`) and map that into `KanbanPlacement` indexes for the component. The component's drag engine owns pointer/keyboard interactions; the card only translates placements back to model fields in `@onChange`.

**Data shape:**

- `Column` FieldDef: `key`, `label`, `color`, `collapsed`, `sortOrder`, optional `wipLimit`.
- `Placement` FieldDef: `itemId`, `columnKey`, `sortOrder`.
- Board CardDef: `cards = linksToMany(...)`, `columns = containsMany(Column)`, `placements = containsMany(Placement)`.
- Child cards render through `<@fields.cards.[index] @format='fitted' />` so the host keeps card identity, navigation, permissions, and field chrome.

**Quality bar:**

- Prefer `KanbanPlane`, `KanbanPlacement`, `KanbanColumnConfig`, `autoPlaceKanban`, `cardsInColumn`, and `kanbanColumnCount` over custom DOM drag code.
- Store placements by stable card id, not by array index. Indexes are only the render-time bridge into `@fields.cards`.
- `@onChange` should write placements only; do not mutate or reorder the `linksToMany` card relationship as a side effect of drag.
- Include an empty state, column counts, hidden/collapsed-column behavior, and a visible control for hide-empty when relevant.
- Use theme tokens for board chrome. Treat column colors as data values or theme variables.
- Keep `<style>` tags at the root of each template block.
- If changing the reusable component, add/adjust pure engine tests and live component tests. If only consuming it in a card, validate isolated plus fitted child rendering.

**Gotchas:**

- `KanbanPlacement.index` is the current array index of the linked card; never persist that index.
- If a card id in `placements` is missing from `cards`, filter it out before passing to `KanbanPlane`.
- If a column key in `placements` is missing from `columns`, filter that placement out or map it to a fallback column intentionally.
- For first render, either create placement instances in JSON or use `autoPlaceKanban(cards.length, columns.length)` as a non-persisted visual fallback and persist on the first explicit drag.
- The older `DndKanbanBoard` / `DndColumn` component exists for legacy CRM/sprint-planner code. New work should use `KanbanPlane`.

**Source:**

- boxel monorepo: `packages/boxel-ui/addon/src/components/kanban/*` — reusable component implementation.
- boxel monorepo: `packages/software-factory/realm/kanban-board.gts` — board CardDef integration.
- boxel monorepo: `packages/software-factory/realm/issue-tracker.gts` — domain integration.
- Commit `2aee5d30ce` - `Add kanban board components to boxel-ui (#4562)`.
- Commit `99a3e98e2a` - `Add hidden-column restore flows to kanban (#4867)`.

**See also:** `containsmany-sorted-render` for index-based `@fields` delegation, `resource-for-state` for the older DndColumn resource pattern, and `theme-first-workflow` for token setup before building board chrome.
