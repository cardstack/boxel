---
name: motion-drag
description: >-
  Drag, pan, and reorder: draggable elements with constraints/elastic/
  momentum, drag controls, swipe-to-dismiss, bottom sheets, and
  ReorderGroup/ReorderItem lists and grids. Use for any pointer-driven
  movement of elements — including touch-action rules for mobile.
---

# Drag and reorder

## Drag (`{{motion drag=…}}`)

Motion's pan/drag session, vendored verbatim:

```gts
<div {{motion drag=true dragConstraints=this.container dragElastic=0.2}} />
```

- `drag`: `true` / `"x"` / `"y"`; `dragDirectionLock`, `dragPropagation`,
  `dragListener`.
- `dragConstraints`: an object (`{ top, left, right, bottom }`), an element,
  or a `{current}` ref; re-measured on resize. `dragElastic`,
  `dragMomentum`, `dragTransition`, `dragSnapToOrigin`.
- `createDragControls()` + `dragControls=` for starting a drag from another
  element (`snapToCursor`). `whileDrag` for the pressed style; `onDragStart`
  / `onDrag` / `onDragEnd` / `onDirectionLock`.
- Pan without displacement: `onPanStart` / `onPan` / `onPanEnd`.
- Rotated/scaled parents: `transformPagePoint` with
  `correctParentTransform()`; SVG viewBox: `transformViewBoxPoint()`.
- Interactive children (inputs, selects, contenteditable) don't start a
  drag; drag composes with `layout` / `layoutId` and works mid-scroll.

## Reorder

```gts
<ReorderGroup @values={{this.items}} @onReorder={{this.set}} @axis='y' as |...|>
  <ReorderItem @value={{item}} …>
```

`ul`/`li` with `...attributes`; axis `"x"` / `"y"` / `"xy"` (wrapped lists),
detected from layout when omitted; auto-scrolls a scrollable ancestor near
its edges; works inside `<Presence>`.

## Mobile rules (learned the hard way here)

- Any surface that owns a horizontal/vertical gesture needs
  `touch-action: none` in CSS (`.follow-stage`, the scrubbers), or the
  scroller steals the gesture on iOS.
- Buttons/controls get `touch-action: manipulation` to kill double-tap zoom.
- Hover-revealed controls don't exist on touch — provide a
  `@media (hover: none)` always-visible fallback (the inbox delete button).
- A released drag that should return home reads best as an elastic spring
  (`type: 'spring'`, `visualDuration`, some `bounce`) — see
  `follow-pointer.gts`'s `release`.

## When NOT

Reordering triggered by _state_ (not a pointer) is a layout animation →
`motion-layout`. A drag that ends in a multi-element scene (drop → everyone
reflows in sequence) → hand the drop to `choreo-scene`.

Canonical demos: `drag-well.gts`, `sheet.gts`, `reorder-list.gts`,
`reorder-grid.gts`, `subdivision.gts`, `follow-pointer.gts`.
