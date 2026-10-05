## What it is

Explicit thumb navigation over a known set: a hero stage showing the active asset, and a rail of thumbnails under it that keeps each cell's own aspect ratio.

It is for a set you have — a product's photos, a card's attachments — not for an infinite library. That is **AssetGrid**. For one slot, **AssetWell**. For a fullscreen zoomed view, wire `@onOpen` to **Lightbox**.

## The contract

```
@assets (required)  — the set, in display order
@activeIndex?, @defaultActiveIndex?, @onActiveChange? — what the hero shows
@selectionMode?     — 'none' (default) | 'single' | 'multi'; ranges need 'multi'
@selected?, @defaultSelected?, @onSelectionChange?    — selection, as indices
@onOpen?            — fires on Enter and on double-click: the path into a viewer
@label?             — accessible name for the rail. Default 'Gallery'
@showHero?          — show the hero stage. Default true
@ratio?             — hero ratio; defaults to the active asset's own, then 4 / 3
@thumbHeight?       — rail cell height in px. Default 64
@cellFit?           — 'intrinsic' (default) | 'cover' | 'contain'
@cellRatio?         — locked cell ratio for cover/contain. Default '4 / 3'
@showCounter?       — the "3 of 8" counter and step buttons. Default true

<:hero>    replaces the hero; receives the active asset
<:overlay> rendered over the hero — captions, actions, a buy button
<:empty>   replaces the built-in empty state
```

**Active and selected are different things.** The active index is what the hero shows; selection is a separate, optional axis with its own controlled and uncontrolled args. A gallery can navigate without selecting anything, which is the default.

**`'intrinsic'` cell fit is the default, and it is the interesting one.** Every cell shares a height and keeps its own ratio, so a panorama still reads as a panorama in the rail instead of being cropped into a square. `'cover'` and `'contain'` lock every cell to `@cellRatio` and crop or letterbox, for when uniformity matters more than truth.

**Gallery does not embed a lightbox engine.** `@onOpen` is the seam; **Lightbox** owns PhotoSwipe, and running two engines over one set is how focus restoration breaks.

**There is no autoplay and there are no timers.** A gallery advances because someone advanced it.

## Prior art

**boxel-catalog's `multi-image-source-editor` and `image-carousel`** are the sources, and this component is largely a list of their defects fixed:

- The source's dots were `<div role='button'>` with a click handler, no `tabindex` and no keydown — **unreachable by keyboard** — and `role='presentation'` on the containers stripped the strip from the accessibility tree entirely. Here the rail is a real listbox with one tab stop, arrows, Home/End, Space, Enter, Shift-range and Ctrl/Cmd+A.
- Its `aria-label` was the literal string `'Show this image'` on **every** thumb, which is the same as no label at all once there are two of them. Here each option's name is computed from the asset's name, kind and position, so "3 of 8" is audible.
- Its arrows lacked `type='button'` and so **submitted any enclosing form**, and `all: unset` wiped the focus ring. The buttons here are the kit's **Button**.
- It ran a 1s opacity transition with no reduced-motion guard, and distinguished the active dot by two near-identical greys. Selection here carries a check glyph, a ring and `aria-selected`; motion is behind the reduced-motion switch.

Where it is thinner: no zoom or pan on the hero, no thumbnail reordering, no lazy window over the rail — every cell renders, which is fine for a set and wrong for a library — and no grouping. The hero is a single stage, so a side-by-side compare needs **Comparison**.

## Accessibility

- **The rail is a real `listbox` with named, positioned options.** One tab stop, arrows to move, Home/End, Space to select, Enter to open, Shift for a range, Ctrl/Cmd+A for all.
- **Each option's name is computed, not shared.** Name, kind and position go into it, which is the fix for the source's identical labels — the single most consequential accessibility defect in the original.
- **Selection is carried by `aria-selected` plus a check glyph and a ring**, never by a colour difference alone, and certainly not by two near-identical greys.
- **Range selection is direction-blind**: dragging a range upward selects the same range as dragging it downward. That is a correctness property with an accessibility consequence — a keyboard range and a pointer range produce identical results.
- **The step buttons are real buttons with `type='button'`**, so a gallery inside a form does not submit it when someone steps to the next photo.
- **Motion is behind the reduced-motion switch.**
- **The hero has no name of its own**; it shows the active asset, whose alt text comes from the asset. A gallery of undescribed images is still a gallery of undescribed images.

## Theming

`--pretui-gallery-hero-aspect` (the reserved hero ratio), `--pretui-gallery-cell-aspect` (written per cell, which is how intrinsic fit works), `--pretui-gallery-thumb` and `--pretui-gallery-thumb-narrow` (rail cell sizing at two widths), `--pretui-on-neutral` for ink over a thumbnail, `--pretui-shadow-hairline`.

Both ratio tokens are written through the kit's CSS guard, so an asset with nonsense dimensions drops its declaration and the cell falls back to the stylesheet rather than carrying a broken value.

The two thumb tokens are the season's density lever for the rail; `@thumbHeight` is the per-instance override. A season that shrinks thumbnails shrinks them everywhere a gallery appears, which is the intent — a rail that matched its neighbours on one screen and not another would read as a different component.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
