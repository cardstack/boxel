# Bulk Delete + Selection Summary (Workspace)

This doc describes the new bulk action entry point and two actions (Deselect All and Delete N items) for the Workspace card grid, matching the provided mocks. The SelectionSummary component has been created and integrated at the Boxel UI level; the plan below reflects the implemented API.

## Goals

- Provide a selection summary pill when there are one or more selected cards.
- Provide a “Select All” CTA when zero cards are selected.
- Implement a new overflow menu (three dots) on the summary pill with:
  - Deselect All
  - Delete N items (with confirmation)
- Keep selection model consistent with existing card overlay selectors.

## Out of scope (for this change)

- Copy/Move actions from the menu.
- Server-side batch API changes; we will call existing delete primitives in a loop if no batch exists.
- Cross-directory/global selection. We act only on the current directory/grid scope.
- Telemetry/events; no instrumentation in this change.

## UX summary (from mocks)

- Zero selected:
  - Show a pill with a large unfilled circle and label “Select All”. Clicking it selects all cards in the current directory.
- N selected (N > 0):
  - Show a pill with teal filled circle, label “N Selected”, and a three-dots overflow button.
  - Clicking teal circle toggles Deselect All.
  - Overflow menu options:
    - Deselect All
    - Delete N items
- Delete N items:
  - Opens a confirmation dialog: “Delete N items? This can’t be undone.”
  - Primary: Delete, Destructive. Secondary: Cancel.
  - On success: remove deleted cards from grid, clear selection, show toast.
  - On failure: show error toast, selection remains; successfully deleted items still removed if partial delete.

## Architecture

We introduced a small set of UI components. For deletion, we will reuse `OperatorModeStateService.deleteCard(cardId)` and call it in a loop for the selected IDs (no separate bulk actions service).

A challenge for this feature is that heretofore, cards know nothing of selected state of their child cards. It is considered to be data that belongs to operator mode.

Perhaps the UI should really belong in interact submode?

### Components

#### Selection Summary Pill

- Location: `packages/boxel-ui/addon/src/components/selection-summary/index.gts`
- Purpose: Surface selection count and entry point to bulk actions.
- Styling: colocated `<style scoped>` inside the same `.gts` file (matches boxel-ui patterns like add-button and dropdown).
- Composition: uses `Boxel::Dropdown` internally and renders a `Boxel::Menu` inside. Consumers pass `@menuItems` so actions live with the consumer but are displayed by `SelectionSummary`.

Args (implemented API):

- `selectedCount: number` (number of selected items in current scope)
- `totalCount: number` (cards in current grid scope)
- `onSelectAll(): void` (selects all in current scope)
- `onDeselectAll(): void`
- `menuItems: (MenuItem | MenuDivider)[]` (menu entries rendered inside the dropdown)

Yields:

- None currently required for the menu; a `menu` block type exists in the TS signature but the component renders the provided `@menuItems` itself.

Behavior:

- Renders two modes (zero vs. N selected) as per mocks.
- Shows a selection circle button; clicking it toggles between Select All and Deselect All depending on current state.
- Shows a three-dots dropdown trigger; the dropdown renders a `Boxel::Menu` with `@menuItems`.

#### Confirm Delete Dialog (reuse if available)

- Prefer reusing an existing confirmation/modal component in Boxel UI.
- Fallback: create a simple modal at `packages/host/app/components/workspace/confirm-delete.gts` with `count` and callbacks.

### Deletion orchestration

- Use `OperatorModeStateService.deleteCard(cardId)` for each selected ID.
- Perform deletes sequentially (or small concurrency later if needed) and aggregate results to provide user feedback.

Example host-side menu items (consumer owned):

```ts
this.bulkMenuItems = [
  { text: 'Deselect All', action: () => this.deselectAll() },
  { type: 'divider' },
  {
    text: `Delete ${this.selectedIds.length} items`,
    dangerous: true,
    action: () => this.confirmAndDeleteSelected(),
  },
];
```

### Integration point

- Grid owner in Base (`packages/base/components/cards-grid-layout.gts`) will:
  - Own the selected IDs array (already present via overlay widgets) and derive `selectedCount` from it.
  - Compute `totalCount` for visible cards in the current scope.
  - Render the `SelectionSummary` in the grid’s top toolbar area via the boxel-ui addon.
  - Wire up `onSelectAll` and `onDeselectAll` using existing selection controller/service. Deletion remains a consumer concern (host app) and is triggered via `@menuItems` actions.

Example integration (implemented API):

```hbs
<Boxel::SelectionSummary
  @selectedCount={{this.selectedIds.length}}
  @totalCount={{this.totalCount}}
  @onSelectAll={{this.selectAll}}
  @onDeselectAll={{this.deselectAll}}
  @menuItems={{this.bulkMenuItems}}
/>
```

## Contracts

- Inputs/Outputs
  - Inputs to summary: `selectedCount`, `totalCount`, `menuItems`, and callbacks `onSelectAll`, `onDeselectAll`.
  - Outputs from summary: user intents (select all, deselect all) via callbacks; delete is initiated via host-provided `menuItems` actions.
- Error modes
  - Network or authorization failures while deleting: show error toast; return the set of failed IDs; selection remains for failed IDs.
  - Stale selection (items already missing): treat as success/no-op.
- Success criteria
  - After deleting, the grid reflects removal without full page reload; selection resets to 0 if all selected were removed.

## States and edge cases

- Zero items in grid: hide the summary; no “Select All”.
- Partial delete failures: show a toast like “Deleted X of N items. Y failed.” with a retry CTA (optional).
- Concurrent mutations: if cards disappear due to external changes, selection and counts update reactively.
- Long-running deletes: show a progress state on the Delete button and disable interactions until resolved.

## Accessibility

- All actions operable via keyboard.
- Overflow menu focus trap and ARIA roles for menu and dialog.
- Use aria-live region for operation result toasts.

## Testing plan

- Unit
  - SelectionSummary renders both modes and calls `onSelectAll`/`onDeselectAll` appropriately.
  - Renders dropdown with provided `@menuItems` and invokes their actions.
  - A small helper (if added) or the integration point correctly loops `deleteCard` and aggregates results.
- Integration (Ember/QUnit)
  - Selecting none → “Select All” is visible; click selects all.
  - With N selected → menu opens; Deselect All clears selection.
  - Delete N: confirmation appears; confirm calls service; grid updates; selection clears; toast shown.
  - Host acceptance tests will live in `packages/host/tests/acceptance/workspace-delete-multiple-test.gts`.
  
## Implementation steps

- [x] Create Selection Summary component with dropdown menu (see `packages/boxel-ui/addon/src/components/selection-summary/index.gts`).
- [ ] Integrate the component into the Base cards grid layout toolbar (`packages/base/components/cards-grid-layout.gts`) (no confirmation step yet):
  - [ ] Add `<Boxel::SelectionSummary>` to the grid toolbar with placeholders:
    - `@selectedCount=0`, `@totalCount=this.totalCount || 0`, `@onSelectAll`/`@onDeselectAll` as no-ops, `@menuItems=[]`.
  - [ ] Tests: smoke render — grid renders and `data-test-selection-summary` (or `.boxel-selection-summary`) exists when there are items.
  - [ ] Wire real counts from the existing selection model:
    - Compute `selectedCount` from selected IDs/items; `totalCount` from visible grid items.
  - [ ] Tests: zero vs. one selected — assert “Select All” state when none selected; select one item and assert “1 Selected”.
  - [ ] Implement `@onSelectAll` and `@onDeselectAll` using existing selection APIs limited to current grid scope.
  - [ ] Tests: clicking Summary’s select-all selects all; clicking deselect-all clears selection.
  - [ ] Provide `bulkMenuItems` with stub actions:
    - “Deselect All” calls the same clear-selection handler.
    - “Delete N items” is a stub (to be wired to confirmation later).
  - [ ] Tests: open overflow menu → both items render; clicking “Deselect All” clears selection.
  - [ ] Add stable selectors and a11y labels for Summary and menu trigger.
  - [ ] Tests: use `data-test-*` selectors; assert menu trigger is a button with an accessible name.
- [ ] Wire selection events to the existing selection state; implement Delete N by looping over `operatorModeStateService.deleteCard`.
- [ ] Optionally create/reuse Confirm Delete dialog component.
- [ ] Add tests:
  - [x] Component integration tests for `SelectionSummary` (boxel-ui test app).
  - [ ] Host acceptance tests in `packages/host/tests/acceptance/workspace-delete-multiple-test.gts`.
  - [ ] Unit tests for any helper/service (if added).
- [ ] Polish: loading states, toasts, a11y roles/labels.

## File map

- `packages/boxel-ui/addon/src/components/selection-summary/index.gts` (created; colocated styles)
- `packages/boxel-ui/addon/src/components/selection-summary/usage.gts` (optional usage docs)
- `packages/base/components/cards-grid-layout.gts` (integration site for SelectionSummary)
- `packages/host/app/components/workspace/confirm-delete.gts` (only if needed)
- Tests: component unit tests under `packages/boxel-ui/tests/` and host acceptance tests under `packages/host/tests/acceptance/workspace-delete-multiple-test.gts`.

## Rough pseudocode

```ts
// selection-summary.gts (implemented API)
interface Signature {
  Args: {
    menuItems: (MenuItem | MenuDivider)[];
    onDeselectAll: () => void;
    onSelectAll: () => void;
    selectedCount: number;
    totalCount: number;
  };
}
```

```ts
// Using OperatorModeStateService inside the grid owner or a tiny helper
async function deleteMany(ids: string[], operatorState: OperatorModeStateService) {
  const deleted: string[] = [];
  const failed: string[] = [];
  for (const id of ids) {
    try {
      await operatorState.deleteCard(id);
      deleted.push(id);
    } catch (e) {
      failed.push(id);
    }
  }
  return { deleted, failed };
}
```

## Requirements coverage

- New component for selection summary with overflow menu: Done.
- Implement Deselect All menu item: Planned (provided via host `@menuItems`).
- Implement Delete N items with confirmation: Planned (host-driven via `@menuItems`).
- Based on existing selection overlay: integration oriented to reuse current selection state.

## Rollout

- Ship behind UI flag if necessary (config-driven), default on in dev.
- Verify with manual smoke in Workspace: none selected, select-all, deselect-all, delete-many.

## Risks

- Inconsistent selection state across components: mitigate by funneling through a single selection owner/service.
- Large-N deletes causing long UI blocks: mitigate with small concurrency and progress state; possibly paginate selection for very large sets in future.

## Next steps

- Implement files listed above and wire into `packages/base/components/cards-grid-layout.gts`.
- Add acceptance tests.
