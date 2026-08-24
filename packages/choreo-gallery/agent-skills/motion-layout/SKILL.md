---
name: motion-layout
description: >-
  Layout animation (FLIP) and shared-element transitions: layout=true for an
  element whose box changes, layoutId to morph one element into another
  (tabs indicator, thumbnail-to-lightbox), LayoutGroup for grids and
  filtered lists. Use when things move because the layout changed.
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
with `layout=true` on each card (see `gallery.gts` — cards fly to new seats
while their content keeps running).

## Rules

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

- The two "elements" aren't the same thing — one is a *place* (a trash can,
  a compose button) that must not deform → `{{beacon}}` + Choreo `c.Move
  @to` (`choreo-scene`).
- The move must be *sequenced* against fades of other elements, or needs
  z-index for exactly the span of the move → `choreo-scene`.
- Whole-page navigation morph → `motion-page-transition` (but NOT if the
  content is live — layout animation keeps it running; snapshots freeze it).

Canonical demos: `lightbox.gts`, `shared-tabs.gts`, `layout-toggle.gts`
(Curves — radius/shadow correction), `gallery.gts` (the filter grid).
