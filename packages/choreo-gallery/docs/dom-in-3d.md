# DOM in 3D: what the mapping is, and what it would take to go further

**Status:** two cases ship — `/mockup` (a phone) and `/long-take` (a
laptop), both on `c.Camera3D`. Cases 3 and up are design; nothing in them
is implemented.

## What exists

`test-app/app/lib/css3d.ts` is **85 lines**: three pure functions over a
4×4 matrix.

```ts
perspective(projectionMatrix, viewportHeight)  // → the CSS `perspective` in px
cameraCss(matrixWorldInverse, focal, w, h)     // → the camera's transform
objectCss(matrixWorld, scale?)                 // → one plane's transform
```

Point them at a three.js camera and one `Object3D`, and a Glimmer subtree
stands exactly where that object is. Both shipped demos pin the subtree to
the display mesh of a GLB; the screen is live DOM, still clickable, still
animating, with the WebGL glass composited over it.

Two shipped demos and the file has not grown. That is the point of the
next section.

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

Four consequences worth knowing before designing anything below:

- **Anything that must appear over the DOM has to be drawn in the canvas.**
  Reflections, glare, depth-of-field: all of it is WebGL over the hole.
- **`alphaTest` is not available to shrink the hole.** The material's whole
  point is a uniform low alpha, so an alpha test discards every fragment
  and the mesh disappears.
- **One world unit must be one CSS pixel.** `perspective` and the camera's
  `translateZ` are written in px. A scene authored at "2.6 units for a
  whole phone" projects nothing like the WebGL one; it looks nearly right
  at small angles, which is the trap.
- **The hole is depth-tested like any other geometry**, and this is worth
  more than it sounds. Where something in the model stands nearer the
  camera than the display — the laptop's own base and keyboard — the
  display's fragments fail the test, the aluminium stays opaque, and the
  DOM behind it is hidden. Model geometry occludes live DOM for free.
  See case 4, where that turns out to be most of an answer.

## Case 1 — 3D device mockup _(shipped: `/mockup`)_

One plane pinned to one mesh, one camera. Cost: the 85 lines, plus
`c.Camera3D` (288) to make the shot seekable.

## Case 2 — a camera inside the screen _(shipped: `/long-take`)_

The same one plane and one mesh — and inside the plane, a second
`<Choreo>` region running its own 2D camera over a large drawing. The
outer camera flies the laptop around the room; the inner one is the shot
_on_ the screen: `c.Frame` to fit a station, `c.Aim` to recentre with the
zoom held, `c.Pan` for exact pixels, `c.SlowZoom` so a hold still breathes.

**What it adds to the mapping: nothing.** The interesting part is that two
cameras at two scales compose without a mechanism for composing them:

- **One clock, so they cannot drift.** Both regions read a single shot
  list (`shots.ts`), and a shot's length is `move + hold` in both. Two
  scores with their own timings would need those numbers kept equal by
  hand, and the first edit that forgot would be two cameras a second
  apart with nothing in either score to point at. One take counter
  restarts both, so a loop cannot come back out of step either.
- **Occlusion, for free.** The drawing disappears behind the bottom of the
  laptop because of the depth-tested hole above — no proxy mesh, no
  ordering pass, no code. The wrong stacking order is the classic tell
  that a mockup is a texture pretending to be a screen.
- **A still to stand in for the engine.** The 2D mode is a 53 KB WebP of
  the WebGL laptop at rest, not a laptop drawn in CSS. A readback of a
  canvas with the hole punched in it _is_ a laptop with a transparent
  screen, so an `<img>` of it laid where the canvas goes composites the
  live drawing through it identically — the plane measures 696px flat and
  697px in 3D. What the toggle changes is what is animating, and the
  megabyte and a half of engine is only paid when the camera is asked to
  move. The catch: the picture and the frozen `perspective` / `matrix3d`
  strings are one measurement at one reference size, so they are replaced
  together (the capture endpoint returns the matrices with the file) and
  the flat composite is scaled as a single unit.
- **No hairlines inside a magnified layer.** A CSS 3D-transformed subtree
  is rasterised _once_ at its layout resolution and then sampled through
  the matrix. The inner camera pushes past 3×, so it magnifies a texture
  rather than redrawing it, and a 1px stroke lands on a fractional number
  of device pixels and crawls as the camera moves. Every rule on the
  drawing is 2px at half opacity: the same ink, resampled cleanly. MSAA
  and its relatives do not apply — they anti-alias the canvas, not the DOM
  layer behind it.

**The trap in this case is `c.Frame @padding`.** It is a _fill fraction_,
compiling straight into `zoom = padding × min(frame.w / box.w,
frame.h / box.h)`. So `@padding={{0}}` is not a tight crop with no margin;
it is a camera zoomed to nothing. The region collapses to a point, every
later measurement is taken through its own zero scale, and there is no way
back — a blank screen behind a perfectly healthy run.

## Case 3 — visionOS-style cards floating in 3D

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
ordinary region, and `c.Camera3D` already moves the shot. Case 2 is the
evidence for the second half of that claim: a region inside a plane needed
nothing from the library it would not have needed on flat ground.

**The open question** is input. Pointer events land on whichever DOM
element is topmost in paint order, which after sorting is the nearest
card — correct by construction. But a card _behind_ geometry is still
clickable, because the DOM knows nothing about the depth buffer. See
case 4.

## Case 4 — a pop-up card inside a 3D scene ("Accept?", "Add a comment")

A card anchored to a point in a model, facing the viewer.

**What it adds over case 3:**

- **Billboarding.** The card should face the camera regardless of the
  anchor's orientation: decompose the anchor's world matrix, keep the
  translation, substitute the camera's rotation. This is what
  `CSS3DSprite` does. ~15 lines.

**Estimate: ~150 lines.**

**Occlusion is the hard part, and the laptop answered more of it than
expected.** `CSS3DRenderer` does not answer any of it. The DOM is
composited under the canvas, so a card is either wholly in front of the
WebGL or wholly behind it; there is no per-pixel depth test _between the
two layers_. But there is a depth test _within_ the canvas, and the hole
is subject to it. Three options:

1. **Hole-punch the card's own footprint** — a proxy mesh at the card's
   pose with `NoBlending`. Geometry in front of it correctly hides the
   card, because the proxy's fragments lose the depth test exactly where
   they should. This is what the laptop does, except the laptop pays
   nothing for it: the display mesh is already in the GLB, and the base
   and keyboard that occlude it are already in front. A free-floating card
   costs one mesh, and the card becomes fully opaque.
2. **Accept that cards float over everything.** Correct for HUD-like
   annotations; wrong for anything that should feel _placed_ in the scene.
3. **Render the card into a texture** — which is exactly the trade the
   whole approach exists to avoid, since it loses the live DOM.

Option 1 is no longer speculative; case 2 is it, running in the gallery.
What remains unproven is the free-floating variant, where the proxy is
authored rather than inherited from the model — and the input problem from
case 3, which the depth buffer does not touch either way: an occluded card
still receives pointer events. That wants a raycast against the scene at
pointer-down before the DOM sees it, and it is the natural next spike.

## Case 5 — WebGPU / three effects over a 2D or CSS3D plane

Grade, bloom, distortion or a shader pass applied _on top of_ live DOM.

**What it adds to the mapping: nothing.** This is the same compositing
trick pointed the other way — the DOM shows through the hole, and anything
drawn over it is ordinary WebGL. Both shipped demos already do a small
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

## Case 6 — the shot on somebody else's clock

Scroll-driven product pages, a scrub bar, a frame-by-frame render.

**What it adds: nothing at all**, and that is the case worth stating
explicitly. `c.Camera3D` is a step, not a loop — the pose is a pure
function of the run's time, the host merely applies what
it is handed. So a 3D shot seeks like any other score: `run.time`, a gate,
or `choreo-player` clocking it from outside
([docs/demo-recording.md](docs/demo-recording.md)). Nothing in the 85
lines runs a rAF of its own, and nothing accumulates, so frame _t_ is a
function of _t_ on a worker page too.

The work this case actually needs is a scroll driver, which is Choreo's
problem rather than 3D's.

## Summary

| case                          | adds                                                   | estimate           |
| ----------------------------- | ------------------------------------------------------ | ------------------ |
| 1. device mockup              | —                                                      | **85** _(shipped)_ |
| 2. a camera inside the screen | nothing to the mapping; one shared shot list           | **+0** _(shipped)_ |
| 3. floating cards             | N planes, depth ordering                               | ~130               |
| 4. anchored pop-ups           | + billboarding (+ a proxy mesh, + a raycast for input) | ~150               |
| 5. effects over DOM           | nothing to the mapping                                 | ~0                 |
| 6. scroll / player driven     | nothing — a step is already seekable                   | ~0                 |

Against 454 lines for `CSS3DRenderer` and considerably more for a
custom-element 3D framework — because the host already owns the DOM, the
change tracking and the clock.

What stays hard is smaller than it was. **Occlusion of the DOM by scene
geometry is solved** and costs nothing when the model contains its own
occluder (case 2). Still open: **pointer input through the depth buffer**
(cases 3–4) and **post-processing over the hole** (case 5). Both are
consequences of the DOM and the canvas being separate compositing layers,
and neither is fixed by a bigger renderer.

One cost is not about renderers at all and applies the moment a DOM plane
is magnified: **a transformed subtree is a texture**, rasterised once at
layout resolution. Author it the way you would author artwork for a zoom —
no hairlines — because nothing downstream will redraw it for you.
