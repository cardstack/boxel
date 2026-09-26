# Host motion

How operator mode animates navigation: which mechanism moves what, who
decides when motion runs, and how to measure it. Code references are to
`packages/host/app` unless noted.

## Two mechanisms

**Live geometry (Choreo).** `glimmer-motion`'s `<Choreo>` regions measure
live DOM before and after a render and tween the difference. They own motion
that happens inside one scene, where the same elements stay on screen:

- stack reflow (cards and whole stacks taking new widths),
- the header handoff between a card and the top bar,
- the search sheet resizing between closed, prompt and results,
- the Choreo dock (a search pick when no bitmap crossing can run).

Regions: `components/operator-mode/stack-motion.gts` (stacks and headers),
`components/search-sheet/motion.gts`, and
`components/operator-mode/workspace-scene.gts` (the clip-path dashboard
portal, used when a tile crossing cannot run).

**Bitmap crossings (view transitions).** A crossing captures the departing
face and the landing face as browser bitmaps and morphs one frame between
them, crossfading the faces, while the live DOM is already at its final
layout. It owns motion _between_ scenes, where one object becomes another:

| Crossing                         | from → to                              | Caller                                                                     |
| -------------------------------- | -------------------------------------- | -------------------------------------------------------------------------- |
| Open a card                      | preview in the parent → new stack item | `interact-submode.gts` `viewCard`                                          |
| Close a card                     | stack item → its preview in the parent | `interact-submode.gts` `close`                                             |
| Open into a new stack, and close | preview → right stack item, and back   | same, with `reflowStacks` / `morph` neighbours                             |
| Expand / restore                 | the card → itself at its new width     | `stack-item.gts` `toggleExpanded`                                          |
| Search pick                      | search result tile → new stack item    | `submode-layout.gts` `handleCardSelectFromSearch`                          |
| Dashboard tile ↔ workspace       | tile wallpaper ↔ realm background      | `operator-mode-state-service.ts` `openWorkspace` / `returnToWorkspaceTile` |

Nothing is ever scaled live: text keeps its real layout; only raster faces
scale, cropped with `object-fit: cover` so they never stretch.

## One policy owner: `HostMotionService`

`services/host-motion.ts` decides what may move. Rules, in priority order:

1. **Direct manipulation wins.** A pointer drag past 4 px (or native
   drag/drop) finishes whatever is playing and disables motion until release.
2. **One scene at a time.** `begin('stack' | 'header' | 'sheet', primaryId?)`
   arms one Choreo scene; starting a different scene finishes the current one.
   With a `primaryId`, only that card reflows; without one (a whole stack
   closing) every kept card does.
3. **A crossing owns the scene.** While a crossing plays, Choreo scenes are
   refused and the stack region is held instant, except when the crossing was
   started with `reflowStacks` (a card flying into a new stack), which leaves
   the existing stacks live so they reflow beneath it.
4. **Nothing is armed at rest.** Regions receive `@armed`; an unarmed region
   with nothing in flight skips its before/after measurement entirely.

### `cross()` and `canCross()`

Every crossing goes through one entry:

```ts
await this.hostMotion.cross({
  from: tileElement,                       // departing face
  to: () => document.querySelector(...),   // landing face, looked up after update
  update: () => this.openTheCard(),        // the navigation itself
  duration: motionDurations.boundary,      // seconds
  ease: boundaryEase,
  handoff: 'crossfade' | 'late',           // optional, default crossfade
  parent,                                  // optional stack parent trading depth
  scenes,                                  // optional surrounding layers
  reflowStacks,                            // optional, see rule 3
});
```

`cross()` gates (tests, reduced motion, unsupported browser, drag, zero
duration: run `update` directly), takes and releases the bitmap budget, holds
the `host-motion:crossing` test waiter, waits for `afterRender` before the new
capture, and tags whatever `to()` returns as the landing face. If `to()`
returns nothing (the tile scrolled away), the departing face just fades.

`canCross(from, duration)` exposes the gate for callers that need a different
fallback: a search pick checks it first and docks with Choreo when no bitmap
can play.

Below `cross()`, `lib/bitmap-crossing.ts` `crossfadeCardBitmap(crossing)` is
the pure mechanism (options documented on `BitmapCrossing`). Call it directly
only in tests.

### Anatomy of a crossing

Layers, back to front:

- **scenes** — whole surrounding surfaces: `out` fades over the first 45%,
  `in` over the last 45% (dashboard ↔ stacks), `morph` crosses a persistent
  element's faces while its frame moves (neighbouring stacks taking freed
  width).
- **parent** — when a card opens over (or returns to) its stack parent, the
  parent's tray, body and header move as matched layers of their own. On
  **open** the parent's header enters its buried strip as a new layer,
  sliding down one header-height from under the top bar. On **return** the
  header, title and realm icon are matched separately and the title scales
  back from its buried size.
- **card bitmap** — the departing and landing faces in one morphing frame.
  `handoff: 'late'` keeps the departing face until 82% of the move (expand,
  so a face growing into a wider layout is never squeezed).
- **shadows** — `lib/bitmap-shadow.ts` paints contact and pool shadows as
  their own layers; the card's own `box-shadow` is suppressed during the
  flight and restored at its resting value with transitions held off through
  the landing paint.
- **stationary chrome** — the top bar and assistant, then edge controls
  (search dock, neighbour-stack buttons, chat button), captured so the flying
  card never covers them.

A deferred card body (`StackItem.deferContent`) mounts one paint after
landing; until then the index's prerendered isolated HTML stands in
(`lib/prerendered-placeholder.ts`, skipped above 100 KB).

### Origins and return addresses

`lib/card-open-origin.ts` resolves where a crossing starts and where it
returns:

- The preview that holds the click is the origin. A click beside a tile (an
  open-in-new-stack strip) resolves to the nearest preview. Otherwise a
  unique visible preview of the card is used.
- The chosen preview is remembered per parent as the return address, because
  a buried parent hides every preview and a card shown twice (a fitted tile
  and an embedded row) would be ambiguous on the way back. The address is
  released when the card closes.
- A card opened into its own stack keeps `StackItem.returnTo` (in memory,
  never persisted). Closing it, when that card is still on top and the tile is
  visible, crosses back into the tile while the other stacks `morph` into the
  freed width.
- A dashboard tile's rounding belongs to its card container; the tile image
  adopts those corners for the crossing so they tween to and from the square
  realm background (`lib/workspace-open-origin.ts` `adoptTileCorners`).

## Timing

`lib/motion-timing.ts` `motionDurations` (seconds): card 0.28, exit 0.18,
sheet 0.24, search crossing 0.32, open 0.36, return 0.26, workspace 0.4.
Opening uses a critically damped spring baked into native easing
(`boundaryEase`); returns use the same response.

All motion takes no time in tests (`isTesting()`), and crossings and deferred
bodies hold test waiters, so `settled()` covers them. Reduced motion applies
destinations immediately.

## Performance rules

These are measured, not stylistic:

- **Never mutate a stylesheet during motion.** With hundreds of `<style>`
  elements on the page, any stylesheet insert, rewrite or removal restyles
  the whole document (30–60 ms). View-transition CSS is one static rule set
  installed at load; a crossing toggles classes and inline names only.
  Removing a direct child of `<body>` has the same cost, so shadow layers
  live in one persistent `display: contents` host.
- **Read before write.** A crossing reads every participant's styles before
  assigning any name, class or group.
- **Idle regions don't measure.** An unarmed Choreo region skips its
  before/after rect reads, which otherwise force layout on every render.
- **Release focus before removing it.** A leaving card that holds focus is
  blurred before capture; removing a focused element forces a synchronous
  style recalc mid-update.
- **Replace, don't retime, browser view-transition animations.** Chrome
  samples a retimed CSSAnimation inconsistently (some frames use the effect
  easing, others the CSS timing), which made layers lurch. The motion-dom
  patch copies their keyframes into WAAPI animations with our timing.

What remains is structural: the first motion frame lands 50–80 ms after a
click (old capture, update render, new capture), and a new-stack crossing
spends about 10 ms more measuring the stacks it reflows.

## Measuring

- `?motionSpeed=0.15` slows every host motion for review (0.1–2).
- `?motionTrace` records User Timing marks (`boxel-motion:*`): capture,
  update, playback-ready, finished, content-mount, begun/refused scenes, and
  `return-skipped:<reason>` when a close cannot cross.
- `?motionInspect=1` records each click's crossing into
  `<script id="host-motion-inspection">`: frame gaps, long animation frames,
  phase marks, every frame of every view-transition layer (geometry, face
  opacity, animation clock), and a `jank` summary flagging reversals,
  spikes, face-opacity jumps and long frames per layer.

Measure in a visible, foreground tab: hidden tabs throttle
`requestAnimationFrame` and skip view transitions.

## Dependencies

`glimmer-motion` (Choreo) is vendored as `vendor/glimmer-motion-0.0.0.tgz`;
it and `motion-dom` carry pnpm patches described in
`vendor/glimmer-motion.md`. Both should move upstream.
