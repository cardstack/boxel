# Ours against theirs, seam by seam

Read against `~/Projects/hyperframes` on 2026-09-03: the fourteen GPU
shader transitions in `packages/shader-transitions/src/shaders/registry.ts`,
their shared preamble, and the standalone copies inlined in
`registry/blocks/`. Chris's question was whether ours are as good, and the
answer turned out to be yes on the things that matter and no on breadth —
but only after two real bugs of our own came out of the comparison.

## The one that decides most of it: compositing space

Not one of their fourteen converts to linear light. There is no `pow`, no
sRGB decode, anywhere in `shaders/` or `webgl.ts`; textures arrive as
sRGB-encoded bytes from DOM captures and every `mix()` runs on those bytes
directly. So all fourteen carry the mid-transition luminance sag, and the
two that suffer worst are exactly the two that most need linear light: a
flash to white and an additive overexposure.

Ours mix in light — the glass seams since the two-halves rewrite, and all
four of the reel's shaders. Measured on the same blend, the sag went from
5.15 of 255 to 3.01.

That is the single largest difference between the two sets, and it is
invisible in a still. It shows as a crossfade that dips in the middle.

## Endpoints: theirs do not always reach the ends

Their `sdf-iris` sets `radius = u_progress * 1.2` against a 16:9 corner
distance of 1.0199, so the iris has covered the frame by p ≈ 0.85 and the
last 15% of the transition is dead. In the standalone block copy, which
hardcodes `u_resolution` to 1200×1080, the corner is at 0.745 and it
finishes at p ≈ 0.62 — nearly 40% dead.

Their noise dissolves have the same class of problem from the other end:
`fbm` returns [0, 0.969] and is never normalised, so `domain-warp`'s
`smoothstep(p-.08, p+.08, n)` already shows the incoming frame at p = 0
wherever the noise is below 0.08, and still shows the outgoing one at
p = 1 wherever it is above 0.92. `cross-warp-morph` lands exactly on its
boundary with zero margin.

We had both bugs. Our sdf stopped at `p * 0.86` against the same 1.02
corner, and our ridged burn swept a 0–1 threshold across a field that only
spans [0.08, 0.55], so it finished at p = 0.71 and a third of the seam was
dead. Both now compute their range rather than assume it: the iris takes
the corner distance from `u_resolution`, and the burn remaps the threshold
onto the field's actual span.

## Pops at the start

Two of theirs are visibly wrong on the first frame of the transition.

`gravitational-lens` multiplies the outgoing frame by a `horizon` term
that, at p = 0, is zero at the frame centre — so the transition opens by
punching a black hole into the middle of the picture. `light-leak` runs
its ACES tonemapper unconditionally, and ACES is not the identity
(`aces(0.5) ≈ 0.616`), so the first frame of that transition brightens and
desaturates the whole image instantly.

Ours add nothing at p = 0 and tonemap nothing, so neither pop exists. This
is the same class of bug as our own freeze-frame-one-frame-late: the
transition's first frame must be indistinguishable from the frame before
it.

## Aspect

Only one of their fourteen corrects for it. `ripple-waves`,
`gravitational-lens`, `swirl-vortex`, `light-leak` and `cinematic-zoom`
all take `v_uv - .5` as a radius, so every "circle" is a stretched ellipse
and every "rotation" a shear at 16:9. Ours correct in both the iris and
the leak.

## Feather

Their iris uses `fw = .003` — a total band of 0.006 frame-heights, about
6.5 px at 1080p. That is anti-aliasing, not a feather. Ours is 0.035,
about 75 px, which is an edge you can see is soft. Theirs is the better
choice if you want a hard graphic iris; ours if you want a photographic
one. Worth having as a parameter rather than a constant, which neither of
us does yet.

## And our wipe was worse than any of theirs

The comparison earned its keep here. Our wipe is a DOM seam, not a shader,
and it was built as a box three frames wide carrying a masked still, with
the image inside counter-moving so the edge appeared to cross. The travel
was hardcoded up-left while the gradient's angle followed the sun. The two
therefore agreed only by luck:

| the sun's rake | the sweep actually achieved    |
| -------------- | ------------------------------ |
| −140°          | 0.92 of its intended travel    |
| −27°           | 0.00 — no sweep at all         |
| +35°           | −0.88 — the edge ran BACKWARDS |
| +144°          | 0.16                           |

A negative projection means the outgoing frame grew back over the incoming
one. That is what "wiping by leaking the previous frame" was.

Sizing the travel to the angle fixed the projection but not the geometry,
because which corner of the box the still starts at also depends on the
angle's quadrant. So the wipe is rebuilt: nothing moves. The element is
the frame, the still fills it, and one number sweeps the two gradient
stops from before the frame to past it. At p = 0 both stops are behind the
frame and it is wholly opaque; at p = 1 both are past it and it is wholly
gone. True at every angle, which the old one never was. Measured on the
towers wipe, the visible crossing went from 0.40 s to 0.57 s of a 1.15 s
seam.

## Where they are ahead

**Breadth.** Fourteen against our four. Nothing clever about that; it is
work we have not done.

**Their chromatic split is radial**, displacing by `(v_uv - .5) * shift`
so the separation is zero at the centre and grows to the corners. That
reads as a lens artefact. Ours is a uniform lateral shift, which reads as
a tape fault. Theirs is the better default.

**Their noise is real.** Five-octave value-noise FBM with a 36.87°
inter-octave rotation to kill axis alignment. Ours is a sin-based
pseudo-noise, which is cheap and looks it.

**Their iris has a three-ring onion glow** trailing inside the leading
edge, with an envelope that peaks at exactly p = 0.5 and is zero at both
ends. Ours has no edge treatment at all.

## What I would take from them

1. The radial form of the chromatic split.
2. Real FBM, with the inter-octave rotation.
3. The three-ring edge glow, and their trick of enveloping it with
   `p * (1 - p) * 4` so it cannot pop at either end.
4. Their honesty about parameters: `time`, `duration`, `ease` and nothing
   else is a defensible surface. Ours has `@presentation`, `@secs`,
   `@over` and `@to`, plus a `params` channel on `SeamSpec` that no seam
   uses yet. That channel is where a centre, a direction and a softness
   should go, and until something uses it we should not pretend it is a
   feature.

## What I would not take

Mixing in gamma. Unnormalised noise fields. Uncorrected aspect. A
tonemapper applied at p = 0. An edge colour ramp that puts the darkest
colour where the glow is brightest, which is what `domain-warp` does — its
`u_accent_bright` is multiplied by zero and is never seen at all, and the
standalone copy of the same shader quietly replaces the whole ramp with an
IQ cosine palette, so the two copies do not even agree with each other.
