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
