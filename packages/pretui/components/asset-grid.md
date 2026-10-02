## What it is

A virtualised thumbnail grid with selection: a shelf of assets that stays responsive at any library size, and a keyboard contract that works in two dimensions rather than one.

It is a `DataComponent<MediaAssetSpec>` — rows, loading, selection and the keyboard cursor all come from that foundation rather than being re-implemented here. What this component adds is the tile geometry, the thumbnail face, and the two-dimensional arrow-key movement a grid needs and a list does not.

Pair it with **MediaViewer** through `@onOpen`. For one asset rather than many, that is **AssetWell**; for a curated set with a hero, **Gallery**.

## The contract

```
every DataArgs<MediaAssetSpec> arg — @rows or @load, @loadKey, @key,
  @selectionMode, @selected, @defaultSelected, @onSelectionChange,
  @activeKey, @defaultActiveKey, @onActiveChange
@tileSize?   — minimum tile width in px; the grid fits as many as will go. Default 148
@showLabels? — name and size under each thumbnail. Default true
@label?      — accessible name for the shelf. Default 'Assets'
@onOpen?     — fires on Enter and on double-click with the resolved asset

<:tile> — replaces the tile face; receives the resolved asset
```

**Tiles are sized by a minimum, not by a column count.** `@tileSize` is the smallest a tile may be and the grid fits as many as will go, so the layout responds without the caller computing breakpoints.

**The column count is measured after every resize rather than assumed**, which is what keeps the arrow keys correct: in a grid, ↓ means "one row down", and one row down is only knowable if you know how many columns there currently are. Change `@tileSize` at runtime and the keyboard still moves the way the eye does.

**`@onOpen` is the seam to a viewer.** It fires on Enter and on double-click with the *resolved* asset, so the receiver gets the derived kind, label and aspect ratio rather than the raw spec.

**Supply `@rows` or `@load`, never both**, and give `@key` whenever rows can reorder — both are DataComponent's rules, and they apply unchanged here.

## Prior art

**TanStack virtual-core** (MIT) underneath for the virtualisation, over the kit's own **DataComponent** foundation.

Where Pretui is better: the grid **rides DataComponent rather than reimplementing it**, which is the whole design. Selection semantics, controlled/uncontrolled behaviour, the active-row cursor and async loading are identical to every other data surface in the kit, so a developer who has used **DataGrid** already knows this component's contract. Every asset-manager grid surveyed reimplements selection locally, and that is why selection behaves subtly differently in each one.

Where it is thinner: there is no drag-to-reorder and no drag-out, no marquee (rubber-band) selection, no grouping or section headers, and no column-count override for a caller who wants a fixed grid rather than a fitted one. Tiles are a fixed aspect; a mixed-orientation library reads as uniformly cropped, where **Gallery**'s rail keeps intrinsic ratios.

## Accessibility

- **The grid is a real `listbox`** with `aria-label` from `@label` and `aria-multiselectable` reflecting the selection mode. Options carry their own names and positions.
- **The tile face is inside an `aria-hidden` layer, and the option overlay carries the semantics.** That separation is what makes `<:tile>` safe: whatever you put in it — components, images, nested markup — cannot corrupt the option's accessible name, because none of it reaches the accessibility tree. This is the detail to understand before overriding the block.
- **The inner wrapper is `role='presentation'`**, so the grid's layout containers do not appear between the listbox and its options, which would otherwise break the required parent/child relationship.
- **Arrow keys move in two dimensions**, which a listbox alone does not imply — a one-dimensional arrow contract in a visually two-dimensional grid is the most common failure of this pattern.
- **Enter opens; double-click opens.** The pointer path has a keyboard equal, rather than open being a pointer-only gesture.
- **`@showLabels={{false}}` removes the visible name but not the accessible one**, since the option's name comes from the resolved asset rather than from the rendered label.

## Theming

`--pretui-assets-tile` (tile geometry) and `--pretui-assets-aspect` (the thumbnail ratio), `--pretui-on-neutral` for ink over a thumbnail, `--pretui-shadow-hairline` for tile edges.

The two `--pretui-assets-*` tokens are shared with **MediaInspector** in the same module, so a shelf and the panel describing its selection stay dimensionally consistent. A season that widens tiles changes the default density everywhere at once, while `@tileSize` remains the per-instance override — the token sets the product's rhythm, the arg serves the one screen that needs something else.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
