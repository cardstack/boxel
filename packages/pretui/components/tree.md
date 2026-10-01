## What it is

A hierarchical list you expand, collapse and navigate — a file explorer, a taxonomy, a nested outline. Reach for it when the nesting is the point and a node's position in the hierarchy carries meaning. If the levels are just visual grouping, **Accordion** or **FormSection** is lighter. If the hierarchy is a path you are *in* rather than one you are browsing, **Breadcrumb**. If the data is tabular with a nesting column, that is a treegrid and this is not it.

## The contract

```
@nodes: TreeNode[]   (recursive; children presence makes a node a branch)
@label? ('Tree'), @indent?, @density? ('compact' 22px | 'comfortable' 26px)
@expanded? / @defaultExpanded? / @onExpandedChange?(ids)
@selected? / @defaultSelected? / @onSelect?(node)
@typeahead? (default true)
<:label as |node, row|>   <:empty>
```

Two hybrid controlled/uncontrolled pairs — expansion and selection are independent, so you can control one and let the component own the other.

**The DOM is one flat `<ul role="tree">` with `aria-level`/`aria-posinset`/`aria-setsize` per item**, rather than a nested `<ul role="group">` per branch. Both forms are conformant; the flat one is what makes a single `{{#each}}` over a computed `rows` getter possible, and `aria-level` carries the depth the nesting would have carried. The practical payoff is that keyboard navigation is index arithmetic over a flat array rather than a tree walk.

**Disabled nodes still take keyboard focus.** `aria-disabled` marks them unselectable, but they remain reachable — otherwise a disabled branch would make everything under it unreachable.

**Type-ahead is single-character cycling, and that is a realm constraint made visible.** A multi-character type-ahead buffer needs a debounce timer, and realm components own no timers. So pressing `d` repeatedly cycles through nodes starting with `d` rather than accumulating "doc". Worth knowing before you file it as a bug.

Deliberately dropped: multi-select (`aria-multiselectable`), and drag-to-reorder.

## Prior art

**Most kits ship a tree as nested `<div>`s with `onClick`** — no roles, no `aria-expanded`, no keyboard, and every node a tab stop. The shape here comes from **VS Code's explorer** and **MUI `SimpleTreeView`**; the semantics come from the APG directly.

**Web Awesome `wa-tree`** is the closest conformant peer: `selection` (`single | multiple | leaf | leaf-multiple`), `role="tree"` with `tabindex=0`, APG-conformant Arrow/Home/End/Enter/Space handling, a `role="group"` children container, `aria-expanded` **removed for leaves**, and a `lazy` flag firing `wa-lazy-load`. **React Aria** is the outlier: its `useTree` is a thin wrapper over `useGridList` that overwrites the role to **`treegrid`** — a single-column treegrid, not `role="tree"`.

Where Pretui matches Web Awesome and beats the field: it implements the pattern in full — roles, `aria-level`/`posinset`/`setsize`, roving tabindex, Up/Down/Left/Right/Home/End, and type-ahead. That is the whole claim of this territory's header comment, and it holds.

Where it is behind Web Awesome: **no lazy loading** (a big tree renders entirely), **no multi-select**, and **single-character type-ahead** rather than a buffered one.

## Accessibility

Governing pattern: APG **Tree View**. This is one of the two or three best-implemented components in the kit.

Present and correct: `role="tree"` with `aria-label`; `role="treeitem"` per row; `aria-level`, `aria-posinset`, `aria-setsize` (required when the full node set is not in the DOM, and correct to include always in a flat structure); `aria-expanded` on branches; `aria-selected` explicitly `'true'`/`'false'`; `aria-disabled` on disabled nodes; a roving tabindex so the tree is **one tab stop**; and the icon marked `aria-hidden` / `role="presentation"`.

The keyboard contract matches the pattern: Right opens a closed node without moving focus, else moves to the first child; Left closes an open node, else moves to the parent; Up/Down move without opening or closing; Home/End jump to the first and last visible rows; Enter/Space select.

Remaining gaps, small but real:

- **`aria-expanded` must be absent on leaves, not `false`** — a leaf with `aria-expanded="false"` is announced as a collapsed parent. The component sets it only on rows with children, so a leaf carries no `aria-expanded` at all.
- **`@label` defaults to the literal `'Tree'`.** Two trees on a page are both announced "Tree". The source calls this "required in spirit, defaulted so nothing is required in practice" — a reasonable Law 7 stance, and one that still produces bad output when ignored. Always pass it.
- **Single-character type-ahead** (above) diverges from APG's "next item whose label *begins with* the typed string". For trees with many similarly-prefixed nodes, cycling is materially worse than buffering.
- **`*` to expand all siblings at the current level** is an optional APG key and is not implemented.
- **No `aria-activedescendant` alternative** — roving tabindex only, which APG blesses equally.
- **Selection changes are not announced** beyond `aria-selected` being re-read on focus.
- Target size: a 22px compact row is below WCAG **2.5.8**'s 24×24 minimum for pointer users.

## Theming

`--pretui-tree-indent` (per-level indent, settable as a token or via `@indent`), the density presets (22/26px, fixed), plus `--foreground`, `--muted-foreground`, `--hover`, `--pretui-selected`, `--border`, `--text-ui-md`, and **StatusChip**/**Token** tokens if a node carries a badge or meta.

`aria-disabled` is styled directly (`.pretui-tree-item[aria-disabled='true']`), which is a nice detail — the visual disabled state and the announced one cannot drift, because they are the same attribute.

A season must keep `--pretui-selected` distinct from `--hover`: a tree shows both simultaneously (the selected row, and whichever row the pointer is over), and if they collapse the user loses track of the selection while browsing.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.

## React ecosystem

Browse-only tree. A tree *as a select value* is **TreeSelect**. A
single *path* is **Cascader**. Accept `expanded` / `onExpandedChange`
and `selected` / `onSelectionChange` names from Aria / Ant / Mantine.
