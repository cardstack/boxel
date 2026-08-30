# DOM in 3D: what the mapping is, and what it would take to go further

**Status:** the first case ships (`/mockup`, `c.Camera3D`). The rest is
design — nothing below is implemented.

## What exists

`test-app/app/lib/css3d.ts` is **85 lines**: three pure functions over a
4×4 matrix.

```ts
perspective(projectionMatrix, viewportHeight)  // → the CSS `perspective` in px
cameraCss(matrixWorldInverse, focal, w, h)     // → the camera's transform
objectCss(matrixWorld, scale?)                 // → one plane's transform
```

Point them at a three.js camera and one `Object3D`, and a Glimmer subtree
stands exactly where that object is. The phone demo pins the subtree to
the display mesh of a GLB; the screen is live DOM, still clickable, still
animating, with the WebGL glass composited over it.

### Why 85 lines and not 454

three's own `CSS3DRenderer.js` is 454 lines. The _math_ in it is about 40. The rest is a renderer:

- `CSS3DObject` / `CSS3DSprite` scene-graph wrappers, one DOM element each,
  with add/remove lifecycle
- `renderObject`, a per-frame recursive walk of the scene
- a style cache (`cache.objects`, `cache.camera`) so it does not touch the
  DOM when nothing changed
- z-order management: sorting DOM nodes so paint order matches depth
- `setSize`, viewport and view-offset handling
- sprite billboarding

Choreo and Glimmer already own every one of those concerns. Glimmer
renders the subtree and tracks what changed, so the cache is redundant.
Choreo owns the clock. And there is exactly **one** plane, so there is no
tree to walk and no depth to sort. What was missing was the transform, and
that is all we took.

`ember-lume` is larger again for the same reason and then some: custom
elements, its own scene graph and reactivity, a DOM↔3D sync layer, sizing
modes, a node tree, a renderer abstraction. All of it duplicates a
framework we already have.

**The rule this suggests:** take the arithmetic, leave the renderer. The
host framework owns elements, change tracking and time; a 3D integration
that re-implements those is paying for them twice.

## The compositing trick, stated once

The DOM sits _under_ the WebGL canvas. The canvas is made transparent
exactly where the screen is by giving the display mesh a material with
`blending: NoBlending` and a low `opacity`: NoBlending writes the
material's RGB **and its alpha** straight into the framebuffer, replacing
the opaque body fragments already drawn there. The canvas becomes a hole
the shape of the display.

Two consequences worth knowing before designing anything below:

- **Anything that must appear over the DOM has to be drawn in the canvas.**
  Reflections, glare, depth-of-field: all of it is WebGL over the hole.
- **`alphaTest` is not available to shrink the hole.** The material's whole
  point is a uniform low alpha, so an alpha test discards every fragment
  and the mesh disappears.
- **One world unit must be one CSS pixel.** `perspective` and the camera's
  `translateZ` are written in px. A scene authored at "2.6 units for a
  whole phone" projects nothing like the WebGL one; it looks nearly right
  at small angles, which is the trap.

## Case 1 — 3D device mockup _(shipped)_

One plane pinned to one mesh, one camera. Cost: the 85 lines, plus
`c.Camera3D` (288) to make the shot seekable.

## Case 2 — visionOS-style cards floating in 3D

Several DOM panels at arbitrary poses in a shared scene.

**What it adds over case 1:**

- _N_ planes instead of one: a list of `(element, Object3D)` pairs, each
  getting `objectCss(anchor.matrixWorld)` per frame. ~25 lines.
- **Depth ordering.** With one plane, paint order is irrelevant. With
  several, the DOM must be painted back-to-front or a far card draws over
  a near one. Sort the pairs by view-space z and reorder the nodes (or
  assign `z-index`) when the order actually changes — ~20 lines. This is
  the one piece of `CSS3DRenderer` genuinely worth borrowing.

**Estimate: ~130 lines.** No new Choreo primitives — each card is an
ordinary region, and `c.Camera3D` already moves the shot.

**The open question** is input. Pointer events land on whichever DOM
element is topmost in paint order, which after sorting is the nearest
card — correct by construction. But a card _behind_ geometry is still
clickable, because the DOM knows nothing about the depth buffer. See case 3.

## Case 3 — a pop-up card inside a 3D scene ("Accept?", "Add a comment")

A card anchored to a point in a model, facing the viewer.

**What it adds over case 2:**

- **Billboarding.** The card should face the camera regardless of the
  anchor's orientation: decompose the anchor's world matrix, keep the
  translation, substitute the camera's rotation. This is what
  `CSS3DSprite` does. ~15 lines.

**Estimate: ~150 lines.**

**The hard part is occlusion, and no amount of mapping solves it.**
`CSS3DRenderer` does not solve it either. The DOM is composited under the
canvas, so a card is either wholly in front of the WebGL or wholly behind
it; there is no per-pixel depth test between the two layers. Three
options, none free:

1. **Hole-punch the card's own footprint** the way the phone screen does —
   a proxy mesh at the card's pose with `NoBlending`. Depth-tested against
   the scene, so geometry in front of the card correctly hides it. Costs
   one mesh per card and makes the card fully opaque.
2. **Accept that cards float over everything.** Correct for HUD-like
   annotations; wrong for anything that should feel _placed_ in the scene.
3. **Render the card into a texture** — which is exactly the trade the
   whole approach exists to avoid, since it loses the live DOM.

Option 1 is the interesting one and is the natural next spike.

## Case 4 — WebGPU / three effects over a 2D or CSS3D plane

Grade, bloom, distortion or a shader pass applied _on top of_ live DOM.

**What it adds to the mapping: nothing.** This is the same compositing
trick pointed the other way — the DOM shows through the hole, and anything
drawn over it is ordinary WebGL. The phone demo already does a small
version: the glass, its clearcoat highlight and the environment reflection
are all drawn over a live screen.

**What it does need is a decision about the hole's alpha**, which is a
material concern rather than renderer code. Every point of tint the glass
writes is a point of haze over the UI; clear glass wants an alpha near
zero, and a heavier effect trades legibility for atmosphere. That is a
per-effect design call, not a library API.

**One real constraint:** a post-processing pass renders the scene to a
render target and composites it, and a render target has no idea about the
DOM behind the canvas. A full-screen bloom would bloom the _hole_ — that
is, nothing — rather than the UI. Effects that must appear to affect the
DOM have to be drawn as scene geometry over the hole, not as a post pass.
That is a genuine limit of the approach and worth knowing before promising
"any three.js effect over any DOM".

## Summary

| case                | adds                     | estimate           |
| ------------------- | ------------------------ | ------------------ |
| 1. device mockup    | —                        | **85** _(shipped)_ |
| 2. floating cards   | N planes, depth ordering | ~130               |
| 3. anchored pop-ups | + billboarding           | ~150               |
| 4. effects over DOM | nothing to the mapping   | ~0                 |

Against 454 lines for `CSS3DRenderer` and considerably more for a
custom-element 3D framework — because the host already owns the DOM, the
change tracking and the clock.

The two things that stay hard regardless of line count are **occlusion**
(case 3) and **post-processing over the hole** (case 4). Both are
consequences of the DOM and the canvas being separate compositing layers,
and neither is fixed by a bigger renderer.
