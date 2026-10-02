## What it is

The layers panel: a nested, reorderable tree of layers with visibility and lock toggles per row.

## The contract

```
@layers?, @defaultLayers? — the tree, FRONT-TO-BACK (the top row is the front-most
                            layer, as in every design tool)
@onLayersChange? — fires with the NEXT WHOLE TREE after any structural change
@expanded?, @defaultExpanded?, @onExpandedChange? — expansion, as ids
@selectionMode?  — 'single' (default) | 'multi' | 'none'
@label?          — accessible name for the grid. Default 'Layers'
@indent?         — px of indent per nesting level. Default 14
@density?        — 'compact' | 'comfortable' (default)
@reorderable?    — offer the grab handle and the whole move contract. Default true
@showVisibility?, @showLock? — offer the toggles. Default true
@disabled?       — dimmed; nothing moves and nothing toggles, but rows stay
                   focusable and readable, because a disabled panel is still information

<:name>     — replaces the name cell's contents; receives the row
<:trailing> — extra trailing content inside the name cell
<:empty>    — replaces the default empty state
```

**One change channel, carrying the whole next tree.** A move, a visibility flip and a lock flip all report the same way, so a host stores the result rather than reassembling it from deltas.

**Every operation takes a `LayerNode.id`, never an index.** The panels this replaced keyed on array position, so any reorder or async refresh mid-interaction targeted the wrong row.

**Inherited state is modelled.** A child of a hidden group *is* hidden, and its own toggle says so — "hidden by Cover art" — instead of reporting a flag that has no effect. No panel in the corpus did this.

**Keep focusable controls out of `<:trailing>`.** The row is a grid, and a stray tab stop breaks the composite.

## Prior art

The layers panel in design tools.

Where Pretui is better, and the first is structural: **it is a treegrid, not a tree.** A `role='treeitem'` is one tab stop, so a tree with per-row buttons either buries them or breaks the pattern. The APG's answer is `treegrid` — rows of cells, arrows between cells, and every per-row control reachable without leaving the composite.

Then: ids rather than indices, inherited state modelled rather than ignored, and drop state that is not colour-only.

Where it is thinner: no multi-select drag, no cross-panel drag, no layer thumbnails, and no blend-mode or opacity controls — `<:trailing>` is where those would be displayed, not edited.

## Accessibility

- **`role='treegrid'` with `aria-level` per row.** Depth is announced rather than inferred from indentation, and each row's controls are cells you arrow to.
- **This is the choice that makes the panel usable at all.** A layers tree where the visibility toggle is unreachable by keyboard is a panel a keyboard user can read and not operate.
- **Drop state is not colour-only**: the grabbed row carries a raised shadow, `aria-pressed` on its handle, and a live-region sentence.
- **Inherited state is announced with its cause** — "hidden by Cover art" — so a toggle that appears to do nothing explains itself.
- **`@disabled` keeps rows focusable and readable.** A disabled panel is still information, and removing it from the tab order removes the information too.
- **Front-to-back ordering matches every design tool**, so "the top row is in front" needs no explaining.

## Theming

`--pretui-lm-indent` (per-level indent, from `@indent`), with `@density` switching row height between two presets; everything else comes from the kit's control, surface and elevation tokens.

Indent as a token means a deeply nested tree can be tightened for space without touching the component — and because depth is also carried by `aria-level`, tightening it never costs a reader the structure.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
