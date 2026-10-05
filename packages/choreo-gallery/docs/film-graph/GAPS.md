# What our `f.*` cannot reach

A gap analysis against `~/Projects/hyperframes`, catalogued 2026-09-03.
The question Chris asked: can another user tap into that repertoire through
our language, and is the transition system production quality for a
variety of workflows?

The honest answer is that our SEAM is in good shape and almost exactly
the right shape to host theirs, and that everything around a seam — a
clip, a layer, an inset, a frame op — is not.

## What they have

Four separate surfaces, worth keeping apart because they have very
different qualities.

**Fourteen GPU shader transitions.** WebGL1 fragment shaders, one
`u_progress` uniform, two textures (`u_from`, `u_to`) captured from two
scenes: `domain-warp`, `ridged-burn`, `whip-pan`, `sdf-iris`,
`ripple-waves`, `gravitational-lens`, `cinematic-zoom`, `chromatic-split`,
`glitch`, `swirl-vortex`, `thermal-distortion`, `flash-through-white`,
`cross-warp-morph`, `light-leak`. Their whole parameter surface is
`time`, `duration`, `ease` and one composition-wide accent colour —
centres, directions and softness are hardcoded in the GLSL.

**About thirty CPU transitions**, which are DOCUMENTATION rather than
code: GSAP snippets an agent copies, animating opacity, transform,
filter and clip-path on two scene containers. Crossfade, blur crossfade,
focus pull, colour dip, pushes, squeezes, zooms, irises, blinds, light
leaks, film burn, shutter, clock wipe, glitch, VHS, grid dissolve, page
burn, 3D card flip. Five of them are machine-injectable.

**A per-clip GPU grading pipeline** (`data-color-grading`), which is the
serious one. Primary correction, colour wheels, curves, hue curves, four
secondaries, vignette and grain, blur, pixelate, bloom, a retro/glitch
family, a print family (halftone, dither, two-ink, mono screen), an art
family (ASCII, engraving, crosshatch, Kuwahara), fifteen palettes, LUTs,
and a master intensity. Eighteen presets, and nine parameters exposed as
animatable CSS custom properties so a paused timeline can tween them.
It applies to real `<img>` and `<video>` elements.

**Layering, with no PiP API at all.** Layers are timed DOM elements;
paint order is `z-index`; position, scale and fade are ordinary CSS and
GSAP on a wrapper. Nested compositions mount a whole sub-composition as
one layer.

## The five gaps, in the order they hurt

### 1. A seam cannot be a shader — CLOSED

This is the big one, and the good news is that our new two-halves seam
already has the plumbing.

Their shader contract is `(u_from, u_to, u_progress)`. Our glass holds
exactly that: `tFreeze` is the outgoing frame (captured by
`Picture.freeze(true)`), `tDiffuse` is the live incoming one, and the
film owns a progress that is a pure function of its clock. One of their
fragment shaders would drop into our post pass almost verbatim.

What blocks it is that `Picture.seam(mix, veil, color)` hardcodes ONE
compositing law — a mix and a veil. There is no channel for a NAME, and
none for a shader's own parameters.

An app can already bring a DOM seam (`<f.Join @presentation={{Curtain}}>`,
proved by `join-presentation-test.gts`). The GPU side has no equivalent:
our twelve are the only twelve.

**The shape of the fix**, and it is the pattern we already use for
adjustments. `PictureSpec` declares `adjustments`; it should also declare
`seams` — the named transitions this picture can run in its own glass.
Then `<f.Join @presentation="ridged-burn" />` resolves picture-side when
the picture offers that name, and DOM-side otherwise, and the film does
not need to know the difference. `Picture.seam` grows from two numbers to
a name, a progress and a parameter bag.

Their fourteen become fourteen entries in a picture's `seams`, and the
same door is open to anyone else's.

**Closed 2026-09-03.** `PictureSpec.seams` declares them; `Picture.seam`
takes a `SeamSpec` — a name, a progress and a parameter bag, or the film's
own mix and veil when there is no name; `<f.Join @presentation="…"
@secs>` reaches one. The reel at `/_seams` declares four and a score plays
them like a dip. Two bugs came out of building it: `@secs` never reached a
NAMED join, so a picture-declared seam compiled to a length of zero and
ended on the frame it began; and the reel's picture captured a freeze
without pinning it, so a DOM seam switched the plate a decode before the
still landed.

Still owed here: the `params` channel on `SeamSpec` is declared and unused.
That is where a centre, a direction and a softness belong, and until
something uses it we should not pretend it is a feature.

### 2. An adjustment cannot attach to a clip — HALF CLOSED

`f.picture.Look`, `f.picture.Weather` and the rest are the PICTURE's
vocabulary, declared by the picture and yielded under its name. That was
the right call and it works.

But a clip is not the picture. `<f.Video>` compiles to a flat media
descriptor with `src`, `in`, `out`, `rate`, `volume` and `fit` — it has
no children, so nothing can be attached to it, and there is nowhere to
hang a grade. Their whole grading surface applies per element; ours
applies to one actor.

Two things are needed, and they are separable. The GRAPH change is that
an actor other than the picture may declare adjustments and a clip may
carry children (`<f.Video><f.clip.Look @lut="ekta" /></f.Video>`). The
RUNTIME change is a GPU path for DOM media, because CSS filters will
reach blur, brightness and saturation and nothing else — no curves, no
secondaries, no LUT.

**The graph half is closed (2026-09-04).** `f.clip.Look` is the clip
actor's own adjustment set, declared by the film because the film draws
the clip layer, and collected by the CLIP rather than by the beat — a
look under an inset never reaches the row. Several stack the way an
adjustment layer should, the nearer one winning the keys it names. The
`Clip` composes them into a CSS filter in the same order the picture's
own shader composes its grade (saturate, contrast, brightness, then sepia
and hue, blur last), because filter order is not commutative and the two
should agree about what a number means. It rides the media, so an inset's
caption and card are not graded with the footage.

**The runtime half is open**, and it is the more interesting one. CSS
gives blur, brightness, contrast, saturation, sepia, greyscale and hue —
the operations a browser can do to an element without a texture. Curves,
secondaries and a LUT need the pixels, which means the clip through a
texture: either the picture's own glass (only for a picture that has
one) or a compositor of ours. That is Chris's filter-stack move, and it
is what would let a `<div>` take the same LUT as a three.js scene.

### 3. PIP is a fixed card, not a layer — CLOSED

Ours is `fit="inset"`, and the inset is hardcoded in the stylesheet at
`right: 5.5%; top: 12%; width: min(30vw, 340px)` inside a paper card with
a rule and a drop shadow. It is a good editorial object and it is not a
picture-in-picture.

Theirs is not a PiP either — it is CSS and GSAP on a wrapper, with the
documented warning that a late-mounted PiP clip lands a frame off.

So this is a gap where the right move is to be BETTER than the reference,
not to match it: an `f.Inset` that takes a position, a size, an opacity
and a z-order, sits on the film's clock through Attach (which already
gives it a window, a rate and a seek), and can carry its own `f.Join` so
it fades in and out on its own terms rather than appearing and vanishing.

**Closed 2026-09-03, in part.** `f.Inset @x @y @w @radius @fade` places a
layer in percent of the frame with its own fade, as a third clip fit
(`pip`) beside `cover` and the editorial `inset`. What is NOT closed is
the plural: a beat still carries one clip, so two insets on one shot
compile to one row and the second wins. That is gap 1 of the architecture
note — an insert TRACK rather than an insert slot — and it is the next
thing this construct needs.

### 4. A clip has no crop and no retime curve

We have `in`, `out`, `rate` and `volume`, which matches their
`data-media-start`, `data-duration`, `data-playback-rate` (0.1–5) and
`data-volume`. Two things are missing on both sides, and they are cheap
for us: a crop (they use `clip-path`; we have nothing) and a retime CURVE
rather than a constant rate, which is what a speed ramp needs.

### 5. A seam only ever joins two shots

Our seams live between spine items. A clip cannot be transitioned in or
out, two clips cannot be joined, and an inset cannot dissolve to the
picture. Theirs join two arbitrary scenes, which is more general.

This one is architectural rather than a missing argument: it asks whether
`Join` belongs to the spine or to any pair of items on a lane.

## What this means for a demo reel

Chris asked for a reel showing a variety of fades, PIP with fades, frame
tweaking and GPU effects, to prove the system is production quality.

It was built, at `/_seams`, once gaps 1 and 3 were closed — and it earned
its keep by finding four bugs that no test had: the two above, a wipe that
could sweep BACKWARDS at some sun angles, and an exact film that had no
seams at all when rendered frame by frame.

What it shows: nine seams in three different implementations (an overlay
in this document, a mix in the picture's glass, and a shader the picture
declared), a grade per shot, and a picture-in-picture on its own fade.

What it still cannot show is frame tweaking of a CLIP, which needs gap 2.
The reel grades the picture, not the video inset over it.

## One more thing worth knowing

Their repo is asset-light — most demo media is remote, on a CDN. What is
local and useful to us: nineteen SFX MP3s, a handful of small MP4 clips
(the largest local source is 27 MB), sixty-six PBR texture masks, some
device wallpapers and icons, and exactly one alpha cutout
(`freeze-frame-dressing/demo-cutout.webp`) which is the obvious PiP
source. There are no image sequences and no committed `.cube` LUTs; their
LUT catalogue is three looks resolved from a CDN. We have seventeen
`.cube` files locally, which is more than they ship.

---

## A note from watching, not from reading

**Sylva's camera is smoother than the films', and the smoothing is not
shared.** (Chris, 2026-09-04: "in sylva we have very good smoothing of
camera motion. is that unified so that towers can use it?")

It is not. They are different filters in different places:

- **Sylva** runs a two-stage cascade, `chase2` in `sylva-stage.gts`:
  goal → stage one → stage two, each a critically-damped spring
  integrating velocity as state. One spring is C1 — velocity is
  continuous but ACCELERATION snaps the moment the goal moves, and the
  frame flinches. Feeding stage one's output to stage two bounds the jerk
  as well. About forty lines, and they live in a demo component.
- **The film** runs ONE spring (`Film.chase`), and its `mid`/`midV`
  naming is vestigial — stage one's output is assigned straight to `now`.
  In practice towers does get a second stage, but it belongs to the
  PICTURE: the page behind the iframe runs its own exponential chase on
  the pose it is handed. So the cascade exists, half of it is in another
  document, and the two halves are different filters.

Worth unifying, and the right home is the library rather than either
demo — this is a Choreo-level primitive, not a route's.

**One constraint that decides the shape.** An exact film has NO
integrator by design: `@seek='exact'` sets `now = goal` and the comment
says why — a spring's state is its history, which is exactly what
forfeits random access. So a shared chaser cannot simply be switched on
for every film. Either it stays opt-in for cut films, or it is written as
a closed-form settle (a function of time since the goal moved) rather
than an integrator, which would make it seekable and would let an exact
film have the hand as well. The second is the better answer and the
harder one.

### CLOSED — `c.Camera3D @settle`, 2026-09-04

The second answer, and it is not a chaser at all. The tick both filters
were hiding is a property of the PATH, not of the frame rate: a cardinal
spline crosses its waypoints with continuous velocity and a step in
curvature, so every pose change is an impulse of jerk. A filter that
runs on the path instead of on the frame does not need state.

`c.Camera3D @settle={{seconds}}` reports a Hann-weighted average of the
same spline, sampled fifteen times around the current progress
(`settleThrough`, `packages/choreo/src/path.ts`). It is
centred, so unlike a spring it has NO lag. It is an average of one pure
function of progress, so it is still a pure function of progress: play,
scrub and `renderAt` agree, and the exact film gets the hand it was told
it could not have.

The window tapers to nothing at a `cut` and at either end of the path —
by `tanh`, not by a `min`, because a hard taper has a corner in it and a
filter whose width has a corner puts a tick back into what it filters.
So cuts stay cuts, the landing is exact, and the pose handed to the next
cue is the waypoint rather than an average of one.

Measured on the two reference films' own paths at 60 fps, with a 1.5 s
guard around every splice so the cuts do not mask the shots:

| film    | peak jerk, no settle | at 0.5 s    | peak pan speed    |
| ------- | -------------------- | ----------- | ----------------- |
| sagrada | 2267 °/s³            | 281 (0.12×) | 71.18 → 70.84 °/s |
| towers  | 270 °/s³             | 36 (0.14×)  | 6.03 → 6.01 °/s   |

Eight times less jerk for half a percent of the move — which is the test
that matters, because a filter that flattened the pan would have taken
the shot away with the tick. Past about a second it gets WORSE again
(0.14× at 0.5 s, 0.15× at 1 s): the window starts to rival the two
seconds between waypoints. `<Film>` therefore defaults to a QUARTER OF
THE GAP between waypoints rather than to a constant — the same 0.5 s for
these two films, and a quarter of that for a score that cuts four times
as fast — capped at half a second, and `@settle={{0}}` gives the raw
spline.

What is still not unified is the film's own `Film.chase` spring and the
picture page's exponential chase behind it — the settle makes the path
smooth enough that the cascade may not be earning its keep, but that is
a separate measurement.
