---
name: motion-layout
description: >-
  Layout animation (FLIP) and shared-element transitions: layout=true for an
  element whose box changes, layoutId to morph one element into another (tabs
  indicator, thumbnail-to-lightbox), LayoutGroup for grids and filtered lists.
  Use when things move because the layout changed, in glimmer-motion / Choreo
  code in this repo (packages/glimmer-motion, packages/choreo, the Choreo
  gallery, host UI that animates with them).
---

# Layout moved: `layout`, `layoutId`, `<LayoutGroup>`

Three tools, one engine (the projection tree — measures before, measures
after, animates the difference by transform with scale correction).

**`layout=true`** — one element, same place in the tree, box changed
(a grid item whose column changed, a panel that grew). Also `"position"` /
`"size"` to animate only that facet.

**`layoutId`** — two elements, one identity. Give both the same `layoutId`;
the engine treats them as one thing that moved. Only one is on screen at a
time. This is the tabs indicator, thumbnail → lightbox, row → detail.

```gts
<button {{motion layoutId='shot-4'}}>…</button>   {{! the thumbnail }}
<figure {{motion layoutId='shot-4'}}>…</figure>   {{! the open one }}
```

**`<LayoutGroup @id='tabs'>`** — namespaces `layoutId`s and hosts the render
detector: any render pass inside it snapshots every projection node before
the DOM changes. A filtered/reordered grid wants `<LayoutGroup>` around it
with `layout=true` on each card (see
`packages/choreo-gallery/realm/shell/gallery-grid.gts` — cards fly to new seats
while their content keeps running).

## Rules

- **`layout=true` needs a render detector above it.** The box an animation
  starts from is measured at the start of a render pass, before Glimmer
  patches the DOM, and only `<LayoutGroup>`, `<Presence>`, `<ReorderGroup>`
  and `<Choreo>` do that measuring (`layoutChange(fn)` does it by hand).
  A keyed `{{#each}}` of `layout=true` rows with none of them above it moves
  its DOM nodes unmeasured, and the rows jump. A `layoutId` hand-off needs
  one too: the outgoing element's box is only known if something measured it
  before it left. `<Presence>` measures only on a pass where its `@items`
  change: a row inside one that grows for any other reason still needs a
  `<LayoutGroup>`. In development the first such element logs a console
  warning with the element attached. The group goes around the `{{#each}}`,
  never inside each row: Glimmer moves a keyed row's DOM before it re-renders
  anything inside the row, so a group inside the row measures too late.
  ```gts
  <LayoutGroup>
    <ul>
      {{#each this.sorted key='id' as |row|}}
        <li {{motion layout=true}}>{{row.name}}</li>
      {{/each}}
    </ul>
  </LayoutGroup>
  ```
- **Key moving rows by a stable id, never by position.** A key built from an
  index changes when the rows before it shift (a removal, a sort), and
  Glimmer replaces a row whose key changed with a new element, which has no
  old box to animate from.
- **Radius and shadow must go through the modifier.** Layout animation
  scales the element, corners included. The engine corrects `borderRadius`
  and `boxShadow` per frame — but only values it holds:
  `{{motion layout=true style=(styles borderRadius='14px')}}`. A
  stylesheet radius comes out oval mid-flight.
- **Text under a non-uniform scale smears.** Give the child its own
  `layout=true` — it is measured in its own right and projection undoes the
  parent's scale.
- Works with `<Presence>`: an exiting lead hands over to the entering
  follower (`shared-tabs.gts`). `layoutCrossfade`, lead/follow promotion,
  portals all ported.
- Useful extras: `layoutDependency`, `layoutScroll` (scrollable ancestors),
  `layoutRoot`, `instantLayoutTransition()`, `layoutChange()`.

## When NOT

- The two "elements" aren't the same thing — one is a _place_ (a trash can,
  a compose button) that must not deform → `{{beacon}}` + Choreo `c.Move
@to` (`choreo-scene`).
- The move must be _sequenced_ against fades of other elements, or needs
  z-index for exactly the span of the move → `choreo-scene`.
- Whole-page navigation morph → `motion-page-transition` (but NOT if the
  content is live — layout animation keeps it running; snapshots freeze it).

Canonical demos, in `packages/choreo-gallery/realm/stages/`: `lightbox.gts`,
`tabs.gts`, `layout.gts` (Curves — radius/shadow correction);
and `packages/choreo-gallery/realm/shell/gallery-grid.gts` (the filter grid).
