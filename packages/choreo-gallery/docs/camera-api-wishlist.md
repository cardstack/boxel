# `<c.Camera>`: what I wish I had

> **Shipped.** `@fit` / `@margin` exist now: `fit` names a sprite (or
> `null` for the resting identity), `margin` is its share of the frame on
> whichever axis fits first (default 0.72), and `@zoom` alongside overrides
> the magnification while keeping the centring. The zoom and pan are
> computed at compile time from the changeset's rest-layout boxes divided
> back by `measureZoom` — the exact machinery this document asked for — so
> the mid-flight-click case is correct by construction. The Camera demo now
> uses it; `Camera#loupe()` is a scroll nudge and a state toggle. The rest
> of this file is kept as the design rationale.

Written after building the Camera demo (`test-app/app/components/examples/camera.gts`),
where every hard bug came from the same missing primitive: **there is no way to ask
the camera to fit and centre a sprite — only to zoom by a number you supply, and to
aim at a point that stays fixed where it already is.**

## What exists today

```gts
<c.Camera
  @zoom={{this.zoom}}
  @origin={{if this.aimId (c.id this.aimId)}}
  @x={{this.panX}}
  @y={{this.panY}}
  @spring={{carry}}
  @steady={{array (c.role "no") (c.role "verdict")}}
/>
```

- `@zoom` is a bare number. The caller computes it.
- `@origin` aims at a sprite, but per `run.ts`, the applied transform is
  `translate(x + (1−z)·P)·scale(z)` — algebraically, the aim point P maps to
  screen position `x + P`, **independent of z**. In plain terms: `@origin` holds
  the point fixed where it currently is; it does not recentre it. That's the
  right behaviour for a pinch-anchored zoom, and the wrong one for "loupe into
  this tile and centre it," which is the far more common case for a
  gallery/lightbox dive.
- `@x` / `@y` exist as an escape hatch to supply the missing pan yourself.

## What I had to hand-build because of that gap

All in `Camera#loupe()`:

1. **The zoom number.** Measure the target's rest box and the region's box,
   pick a fill ratio, divide. ~15 lines (`§FILL` in the component).
2. **The pan.** Re-derive the library's own `translate(x + (1−z)·P)·scale(z)`
   formula by hand to solve for the `x`/`y` that lands the aim point at the
   region's centre instead of in place. ~10 lines (`§PAN`).
3. **The actual bug.** Both of the above need the target's _rest_ geometry —
   its size and position as if the camera were at identity. But
   `getBoundingClientRect()` returns the _currently painted_ box, which is
   wrong the instant you're mid-zoom on a DIFFERENT tile and click straight
   through to a new one (no intervening rest frame). That shipped, and it
   looked like the newly-selected tile "flying away" on click. The fix was to
   switch to `offsetWidth`/`offsetHeight`/`offsetTop`/`offsetLeft` — layout
   properties, immune to `transform` — plus manually undoing `.cam-sheet`'s
   own `translateY(-50%)` centring, since offsets don't see transforms at all.

None of this is domain logic. It's re-deriving measurement plumbing the
library already has internally (`choreo/measure.ts`, `choreo/changeset.ts`
track rest-layout boxes for FLIP) — just not exposed for a camera step to
consume directly, so userland has to know the difference between screen-space
and layout-space measurement to get a zoom-and-centre right.

## The API I wish existed

```gts
<c.Camera
  @fit={{c.id this.aimId}}
  @margin={{0.65}}
  @spring={{carry}}
  @steady={{array (c.role "no") (c.role "verdict")}}
/>
```

- `@fit` names a sprite (or `null`/absent for identity/rest).
- `@margin` is the fraction of the region's _smaller-fitting_ dimension the
  sprite should fill once centred — one number instead of a manually-derived
  `min(byHeight, byWidth)` pair.
- The library computes zoom **and** pan internally, off the same rest-layout
  measurement machinery it already uses for FLIP — so it is correct by
  construction against exactly the "mid-transform when the click lands" case
  that bit us, because the library's own measurement pass already knows how
  to ask "where does this sprite live at rest," not "where is it painted
  right now."

`@origin`/`@x`/`@y` would stay exactly as they are — they're the right tool
for pinch-anchored or otherwise deliberately-off-centre zooms. `@fit` would
just be the other, more common shape: _dive on this thing, and centre it_,
which today costs ~30 hand-written lines and one landmine.

---

# `<c.Camera3D>`: what the Sylva tour had to hand-build

Written after the `/_sylva` spike, whose film is a loop of camera legs over
a 3D scene. Two gaps cost real code; both have the same shape as `@fit`
did — the host re-deriving something the score should own.

## 1. The pose has no aim — `@look`

`Camera3DState` is five numbers around an implied orbit centre. The mockup
never noticed because its centre is always the phone; the moment a scene
has more than one subject, the centre must MOVE, and there is no way to say
so. Sylva routes it around the score as a side-channel: `c.Perform`
"look" cues set a host goal, and the host eases the actual centre toward it
per frame. It works, but the aim is invisible to the timeline — a scrub
cannot reconstruct it, and its easing is a second clock the score does not
know about.

The wish: `@look` on `c.Camera3D` — a point (or, better, a sprite/anchor
the way `@fit` names one) that is part of the tweened pose. Six-plus
numbers instead of five, one clock, seek-safe.

## 2. A chain of tweens stops at every seam — `@through`

Each `c.Camera3D` is one from→to lerp under one ease. Any ease with zero
slope at an end (which is every ease that "settles") parks the camera at
the seam; a tour assembled from them is fly-park-fly-park. Sylva fought
this twice: first with a curve whose ends carry matched non-zero slope
(`CARRY` — works, but continuity in normalised time is not continuity in
velocity when adjacent legs travel different distances), then properly,
with Drift's own answer: the score writes a TARGET and a host spring
integrates the lens after it, velocity carried as state. "A score for the
scene change, a loop for the simulation" — the chaser is the simulation
half, and per that doctrine it does NOT belong in the score.

One stage is not enough, and the reason is worth recording: a single
critically-damped spring is C1 — velocity crosses every seam, but its
acceleration reacts to the goal directly, so a goal that jumps (a cue
naming a new card) or bends (a tween's seam) lands straight in the second
derivative and the frame flinches. Cinematic motion needs the second and
third derivatives bounded too — a dolly has mass, a fluid head has
damping. The cheap rig for that is a CASCADE: two critically-damped
stages in series, the second chasing the first's already-curving output.
Sylva's host runs the pose and the aim through that cascade
(`chase2` in `sylva-stage.gts`).

But it costs random access: an integrator's pose depends on history, so a
scrub only agrees with playback when frames are walked in order (a linear
render is fine; a playhead is not). If a tour must stay scrubbable, the
score-native answer is a PATH step: `@through` — one camera step over N
waypoints on one clock, spline-interpolated (Catmull-Rom over pose space,
yaw unwrapped), C1-continuous by construction. That is the missing
construct, and it is the same construct any object flown through several
poses in one breath would use — this is not camera-specific at all.

Until then the working split is: anchored cues (`@at`/`@delay` against a
named step) for anything that must fire mid-flight — that part needed no
new API and worked exactly as documented — plus the host-side chaser for
continuity, accepted as seek-unsafe the way Drift's camera already is.
