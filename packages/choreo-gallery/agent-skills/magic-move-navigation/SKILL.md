---
name: magic-move-navigation
description: >-
  The Magic Move route transition (gallery card ⇄ demo page): shared-element
  navigation as a <Choreo @route @quiet> crossing — participants, the
  timeline, the scroll intent, and which of the old animateView subtleties
  died with it. Use when touching the route transition, adding a new paired
  element, or porting the pattern to another app.
---

# Magic Move navigation

The gallery ⇄ demo transition is a **Choreo crossing**: the application
template wraps `{{outlet}}` in `<Choreo @route={{true}} @quiet={{true}}
@scroll={{scrollIntent}}>` and the whole move is its timeline
(`test-app/app/templates/application.gts`). The old 435-line
`animateView` orchestration is deleted; `animateView` remains only for
MPA/cross-document transitions where snapshotting is the point.

## The cast (Keynote's grammar, spoken by the region)

- **MOVES** — an id on both pages: `id='stage-playhead' role='stage'` on
  the card's stage AND on the demo page's `.stage-wrap`. The pass pairs
  them as counterpart/received, the receiver flies FLIP from the old
  box, the old skin rides the flight above it. Type pairs the same way
  (`title-`/`lede-`/`group-<id>`).
- **LEAVES** — removed participants nobody claims (`role='card'`, the
  hero's `role='scene'`): the crossing dissolves them. Naming a
  container of named things is LEGAL — claimed skins are lifted out
  (a seat div holds their place in the fading card).
- **ARRIVES** — inserted participants: fade in near the settle;
  `role='late'` (code sample, pager) arrives on its own later tween.
- **STEADY** — the topbar and footer sit OUTSIDE the region and simply
  never re-render. The api pills share one id (`id='apis'`) on every
  demo page: demo-to-demo they pair and identical content crossfades
  invisibly; from the gallery they just arrive. The old "conditionally
  steady" special case is an ordinary pair now.

## The knobs that carry the move

- `@quiet` — pauses every animation running at liftoff, resumes on
  landing (the old `quietTheRest`, as a region arg). Animations that
  START during the crossing aren't caught; the gallery gates its card
  entrances with `isCrossing()` (`app/lib/tempo.ts`) for exactly that.
- `@scroll={{scrollIntent}}` — the window is placed INSIDE the pass,
  after the swap renders and before final bounds are measured. The app's
  thunk (`app/lib/crossing.ts`): opening/demo-to-demo → top; closing →
  the saved gallery position; standalone-load closing → centre the
  counterpart card so the flight lands on-screen.
- `onstage` — the crossing only animates what a viewport can see;
  leavers judged in the old scene's window, arrivals in the new one's.
- The yield rule — a sibling step naming a sprite owns it (the hero's
  rising exit); the canned dissolve yields it.
- Color-true crossfade — backgrounded pairs never dip toward the ground:
  the receiver holds a solid tween between the two effective colors, the
  old skin dissolves above, the stylesheet's alpha returns on landing.
- `@size='crop'` (the crossing's default) — one UNIFORM scale plus a
  travelling `clipPath` window, iOS's rule. Never write layout size in a
  grid: `@size={{true}}` stretches the card's whole row mid-flight, and
  `@size='scale'` (transform-only, per-axis) still squashes a mismatched
  aspect. Crop does neither. Overridable on `c.Crossing` as `@size`.
- `data-choreo-substance` — the shape match is computed between the
  SUBSTANCE boxes, not the padded frames. `.cam-sheet` inside the camera
  stage, `.pres-stage` inside the presentation: mark the thing the eye
  actually follows, on either end, and the other is derived.
- `pack="content"` — same idea for type, without an extra node. Crossing
  matches the shrink-wrap (the ink) even when the layout box is a
  full-bleed strip. Default is `'box'` (the layout border box) because
  plates and cards ARE their frame. Do not auto-pack every participant.
- Tempo composes: every duration derives from `BASE * factor()`;
  `factor() === 0` renders no steps at all — no run, and the scroll
  still lands (the region applies it regardless of cues).

## App-side wiring (`app/lib/crossing.ts`, ~150 lines)

`routeWillChange → beginCrossing`: records the gallery scroll, arms the
timeline (`crossingActive()` gates the steps in the template — so a
gallery FILTER pass compiles nothing and `<Presence>` keeps its own
animation), sets the entrance-suppression flag, and watches the region's
run (`wireRegion` hands the context over). The watcher latches
`run.finished`, hands over to a replacement run on interruption, and
stands the timeline down when the run that survives settles.

**The return trip is three acts, and the order is the whole point.**
Booting thirty live demos inside the pass is the heaviest render in the
app, and paying it under the flight is exactly the jank the crossing
exists to avoid. So: (1) the flight travels ALONE — every unmatched tile
holds its hidden pose, claimed away from the canned arrive by a
`returningHome`-gated `<c.Hold>` (the yield rule again), and the card the
flight lands on is exempt via `counterpartId()`, its shell hidden by CSS
(`.card.is-veiled`) rather than by opacity, because an opacity-0 card
would hide the live stage inside it; (2) that counterpart's stage boards
MID-FLIGHT (`stageLive`) — it is the other half of the dissolve, and a
dissolve needs something real underneath, or the skin fades to blank and
the demo pops in; (3) at `crossingSettled()` the tiles spring in and the
other demos mount, once, latched permanently.

## Load-bearing library behavior (each was a shipped bug here)

1. **Orphans are not dirt.** A region's orphans re-enter every changeset
   as `removed` (addressable on purpose); with them aloft, a recompiled
   score is degraded (pairing lived in the swap pass). Nothing-new
   passes KEEP the run — a busy page was cancelling its crossing into a
   leave-only rump every render. An edited timeline still replays: told
   apart by a fingerprint of the tree, not the cues.
2. **A keep is invisible.** `releaseForMeasure` jumps moved values to
   rest and `MotionValue.jump()` STOPS the driving animation; the keep
   path calls `run.reassert()` to stand the picture back up and seek
   re-entered animations onto the run's clock.
3. **The cheapest keep never measures — but it checks the LAYOUT.** A
   pass that cannot change the run is declined before the release
   (`fastKeep`): same tree fingerprint, same participants, same layout.
   Standing the world up and back down once a frame IS the jitter, so
   this matters. The layout half is not optional: the tree fingerprint
   says the SCORE is unchanged and a flight prints the same score every
   frame, so without it a real reflow reads as noise and the run flies
   to a destination that has moved. Layout is fingerprinted with
   `offsetLeft/Top/Width/Height` — offsets ignore transforms, which is
   exactly the distinction wanted.
4. **Orphans fly flat.** A `backdrop-filter` inside an orphan cannot
   cache and samples the NEW scene; the layer kills them outright
   (`[data-choreo-orphans] * { backdrop-filter: none !important }`) and
   sets `will-change`, so a lifted skin is one texture being moved.
5. **Coarse ticks land.** A throttled tab can jump a track's whole
   window; never-started tracks land finals while playing too —
   otherwise an arrival's seeded opacity 0 stands forever.
6. **Assert COMPUTED style and geometry.** Accelerated flights paint
   through WAAPI; the style attribute never hears of it. The acceptance
   suite (`tests/acceptance/crossing-test.ts`) measures boxes.

## Still true from the old system

- **Both ends must hold proportions** — the pair crossfades in one
  flying box; content sized in container units (`cqw`/`cqh`) keeps one
  fraction at both scales.
- **Suppress landing entrances** — cards mounting mid-crossing check
  `isCrossing()` and mount already-at-rest.
- **The gallery-wide settle never comes** — several demos never go
  idle; tests wait on `crossingActive()`, not `animationsSettled()`.

## Died with animateView

The veil and its light-mode exception, `is-veiled`, the root snapshot
and its never-name-the-grid rule, the nesting freeze (never name a
container of named things), coextensive-pair blits, `whenEnded`'s poll,
`--gm-morph` and every `::view-transition` rule. The Shared Layout
(`tabs`) return-trip freeze was a View Transitions capture fighting the
demo's own layoutId FLIP — verify it stays gone when touching either.

## Adding a paired element (checklist)

Same conceptual element on both pages? → same `{{motion id}}` on both,
any role; check both ends hold proportions; if it lives inside a named
leaver that's fine (it will be lifted out); test at slow tempo, in light
mode, and the return trip.

Related: `choreo-scene` (the timeline language), `choreo-regions`
(nested regions and far matching), `motion-page-transition` (animateView,
for MPA).
