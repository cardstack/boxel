## What it is

The action cluster that appears on a row, card or cell — edit, duplicate, delete — folded into an overflow when there are too many.

## The contract

```
@actions?  — the cluster's actions. Omit to supply the <:actions> block instead
@label (required) — the toolbar's accessible name, and it must say WHICH thing
           the actions act on
@maxVisible? — total control budget; anything past it folds into an overflow Menu
@reveal?   — 'hover' (default) | 'always'
@space?    — 'overlay' (default) floats the cluster inside the host's own bounds;
             'reserve' gives it a real grid column so it can never cover content
@placement? — corner the cluster occupies in overlay mode. Default 'top-end'
@size?     — size scale for the cluster's buttons. Default 's'
@onSelect? — fires for every action, inline or overflow, after its own handler

<:default> the host: the row, card or cell the actions belong to
<:actions> custom cluster contents, replacing @actions
```

**`@label` must name the thing, not the cluster.** "Actions for Q3 roadmap", not "Actions" — fifty rows of identically-named toolbars is a list a reader cannot navigate. The contract states this because it is the arg most likely to be filled in lazily.

**Coarse pointers get `always` for free.** Hover is not an input on a touchscreen, and a hover-only affordance is simply missing there — so the component does not wait to be told.

**Both modes are layout-stable.** That is the actual requirement: `overlay` satisfies it for free because it is out of flow, and `reserve` satisfies it by giving the cluster a real column. The choice between them is whether covering content is acceptable, not whether the row will jump.

**Overlay is the default because a permanently empty gutter fails the still-frame test** — at rest it is dead space that earns nothing. Choose `reserve` for dense text rows, where an overlay would sit on the words; keep `overlay` for tiles, media and any host with its own padding.

**Roving tabindex applies only to the `@actions` path.** The component cannot know what is inside `<:actions>`, so a block-supplied cluster keeps its members as ordinary tab stops — and once you open that block, the host content must move into an explicit `<:default>`.

## Prior art

The row-hover action cluster in every table and list implementation.

Where Pretui is better: the naming requirement stated in the type, the touch behaviour handled rather than left to a media query at the call site, and the honest note about what the block gives up.

Where it is thinner: no keyboard-only reveal distinct from focus, no per-action disabled state beyond what the action carries, and no drag affordance.

## Accessibility

- **A named toolbar per row is the whole design.** The name is what makes fifty clusters navigable rather than fifty identical ones.
- **Roving tabindex on the `@actions` path** keeps a long list from becoming hundreds of tab stops — and its absence in the block path is documented rather than silently different.
- **Hover-revealed controls are focus-revealed too**, or they would be unreachable by keyboard.
- **Touch gets `always`**, because a hover affordance on a touchscreen does not exist.
- **`reserve` can never cover content**, which is the mode to choose when the row's own text matters more than density.

## Theming

The cluster takes the kit's control tokens at `@size`, defaulting to the small scale; overlay and reserve differ in layout rather than in treatment.

Keeping both modes on one token set means a product can switch a table from overlay to reserve for density reasons without the buttons changing appearance.
