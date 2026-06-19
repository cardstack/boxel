# CS-11672 — Mini card chooser

Linear: https://linear.app/cardstack/issue/CS-11672/mini-card-chooser
First primitive in the Markdown Editing UI sequence. Composed into the combined chooser modal in ticket 5.

## Goal

A standalone `<MiniCardChooser>` host component sized for a side-by-side editor layout — smaller and more embeddable than the existing full-screen `card-chooser/modal.gts`. Reuses `<SearchPanel>` so the in-flight v2 `<SearchResults>` migration applies automatically when its PR lands.

## Decisions

- **Reuse `<SearchPanel>`** + its yielded `Bar` + `Content`. Do not touch result rendering — a separate PR migrates that to v2 `<SearchResults>`.
- **Inline component contract**: `@onSelect(url)` and `@onCancel`. No global singleton, no `Deferred`. Parent container owns mounting and dismissal.
- **Recents**: reuse the existing `RecentCardsService` and the recents section already inside `SearchContent`. The ticket's "per workspace" wording is misleading; per-workspace scoping is out of scope here.
- **Sizing**: `width: 100%; height: 100%` of the parent. No baked-in pixel dimensions.
- **No chrome**: no Cancel/Close button in the primitive. `@onCancel` is declared for parity with later compositions but not rendered.
- **Hide chips**: hide the realm-filter and type-filter chips (`SearchBar`'s `.search-sheet__search-bar-picker` and `.search-sheet__search-bar-separator`) via scoped CSS in MiniCardChooser. SearchBar itself stays untouched.
- **Independent mount**: integration test via `renderComponent` + a tiny context-provider driver (pattern from `card-context-search-results-test.gts`). Freestyle `usage.gts` entry registered next to `SearchSheetUsage` in `host-freestyle.gts`.

## Files

**Create**

- `packages/host/app/components/mini-card-chooser/index.gts`
- `packages/host/app/components/mini-card-chooser/usage.gts`
- `packages/host/tests/integration/components/mini-card-chooser-test.gts`

**Modify**

- `packages/host/app/templates/host-freestyle.gts` — add import + entry in `usageComponents`.

## Component shape

```ts
interface Signature {
  Element: HTMLDivElement;
  Args: {
    searchKey?: string;
    baseFilter?: Filter;
    initialSelectedRealms?: URL[];
    initialSelectedTypes?: ResolvedCodeRef[];
    lockSelectedRealms?: boolean;
    onSelect: (url: string) => void;
    onCancel?: () => void;
  };
}
```

Wraps `<SearchPanel>`, uses the yielded `Bar` for input (with `@onInput` updating a tracked local searchKey) and yielded `Content` with `@isCompact={{false}}`. `handleSelect` narrows to string and forwards to `@onSelect` (Mini variant never produces `NewCardArgs`).

## Verification

1. `pnpm tsc` + `pnpm lint` from `packages/host`.
2. `pnpm test --filter mini-card-chooser` (host integration suite).
3. `mise exec -- pnpm -C packages/host start` + `mise run dev` in two terminals; open `https://localhost:4200/`, navigate to host freestyle, find `MiniCardChooser`, exercise the usage example.
4. Sanity-check the full chooser flow elsewhere (operator-mode "Choose a Card") still works.

## Out of scope

v2 `<SearchResults>` migration, per-workspace recents, preview pane, format controls, combined modal composition, "Create New" affordance, multi-select.

## Cleanup

Delete this plan doc before merging the PR (`[feedback_plan_doc_not_in_merged_branch]`).
