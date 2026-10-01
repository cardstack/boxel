## What it is

**A select whose popup is a checkable tree.** The value is the set of checked nodes. When closed, the field shows them as chips. Use it for regions, categories, permissions, or any set of things that lives in a hierarchy.

Reach for a neighbour when the job is different:

- **Cascader** picks one path.
- **Tree** browses without a value.
- **MultiSelect** picks from a flat list.

## The contract

```
@nodes (TreeNode[] — the same shape as Tree)
@value?, @defaultValue?, @onChange? (ids)
@multiple? (default true), @cascade? (default true)
@defaultExpanded?, @maxChips? (default 3)
@label?, @placeholder?, @disabled?
Element: HTMLDivElement
```

**The cascade policy is stated, not implied.** With `@cascade` (the default):

- Checking a branch checks everything under it, and unchecking it clears them.
- A branch reads as checked when all its enabled descendants are, and as mixed when only some are.
- Checking the last unchecked child checks the branch too.

The value is every checked id in tree order, branches included. It is normalised on the way in, so the checked state and the chips agree whichever ids the caller lists: a listed branch checks its descendants, and a branch whose leaves are all listed is checked. `@cascade={{false}}` checks nodes one at a time with no inheritance.

**Chips summarise.** A fully checked branch shows as one chip, not one per child. Beyond `@maxChips` the rest collapse into "+N", and the trigger's accessible name still lists them all.

**Single mode.** `@multiple={{false}}` has no checkboxes. Choosing a node selects it, closes the popup and returns focus.

**Opening reveals the value.** Branches above checked nodes open when the popup opens, so the checked set is visible.

## Prior art

**Ant `TreeSelect`** takes `treeData`, `value`, `onChange`, `multiple`, `treeCheckable`, `showCheckedStrategy` (`SHOW_ALL | SHOW_PARENT | SHOW_CHILD`), `treeCheckStrictly`, `showSearch` and `maxTagCount`. **Mantine `TreeSelect`** is newer, with a similar model.

Where Pretui is better: **one documented policy with a readable default.** Ant's `showCheckedStrategy` and `treeCheckStrictly` combine into six behaviours that agents mix up. Here the value always holds every checked id, and the chips always summarise. **The popup is a real APG tree** with `aria-checked="mixed"`.

Where it is thinner: **no search**, **no lazy loading**, and **no strategy switch** for which ids the value holds. Filter the value yourself if you only want leaves.

## Accessibility

APG **Tree View**, multi-select with checkboxes.

- **The trigger** is a `<button>` with `aria-haspopup="tree"`, `aria-expanded`, and `aria-controls` while open. It is named "{label}: {checked labels}". The tests assert the popup relationship and the full name, including chips collapsed into "+N".
- **The popup is `role="tree"`**, with `aria-multiselectable` in multiple mode. Each row is a `treeitem` with `aria-level`, `aria-posinset` and `aria-setsize`, as Tree's flat rows are, and `aria-expanded` on branches only. The tests assert them.
- **Checked state.** Multiple mode uses `aria-checked` (`true | false | mixed`), and single mode uses `aria-selected`. The tests assert mixed and checked states.
- **Keyboard.** ArrowUp and ArrowDown move through visible rows. ArrowRight expands a branch, then steps into it. ArrowLeft collapses, then steps out to the parent. Home and End jump. Space or Enter checks or selects. Escape closes and returns focus. The tests press each of these keys.
- **Focus.** Roving `tabindex` over the visible rows. Focus lands on the first checked node, or the first node, when the popup opens.

## Theming

`--input-background`, `--input`, `--ring`, `--radius-control`, `--pretui-control-h`, `--foreground`, `--muted-foreground`, `--primary` / `--primary-foreground` (checkboxes and the selected row), `--radius-chip`, `--pretui-chip-mix`, `--popover`, `--popover-foreground`, `--pretui-shadow-raised`, `--radius-surface`, `--hover`, `--pretui-z-dropdown`, `--pretui-dur-snap` / `--pretui-ease-snap` (the twisty), `--font-sans`, `--text-ui-md`, `--space-2` and `--space-3`.

Indent is 1rem per level, up to five levels. The tree's 18rem maximum height is fixed.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.

## React ecosystem

| Agent types                               | Give them                                    |
| ----------------------------------------- | -------------------------------------------- |
| Ant `<TreeSelect treeData treeCheckable>` | `<TreeSelect @nodes>` (multiple by default)  |
| Ant `treeCheckStrictly`                   | `@cascade={{false}}`                         |
| Ant `showCheckedStrategy={SHOW_PARENT}`   | the chips already summarise; value holds all |
| Ant `maxTagCount`                         | `@maxChips`                                  |
| Ant single `<TreeSelect>`                 | `@multiple={{false}}`                        |
