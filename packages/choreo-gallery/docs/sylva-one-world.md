# One world: how Sylva makes 2D and 3D animation read as a single thing

Written after the `/_sylva` build. The route's claim is small to state and
hard to earn: **live DOM cards and a shader-built moss world, moving under
one camera, reading as one object.** Every technique below exists because
somewhere along the way the two halves visibly disagreed — a corner that
lagged, a seam that parked, a truck that pushed the frame the wrong way —
and each disagreement taught a rule. This document is the rules, with the
curve mathematics that carries most of the weight.

The short version, if you keep only one paragraph: *the score authors
intent and stays a pure function of the clock; a spline gives the path its
shape; a cascaded spring gives the lens its mass; and every pair of things
that must agree — a hole and its card, a pin and its dot, a 2D entrance
and a 3D frame — is driven by ONE writer from ONE set of numbers in ONE
frame.* Smoothness is never asked of two systems at once. It is computed
once and worn twice.

---

## 0. The world itself, for readers who don't know threeui

The 3D half is not ours, and understanding this document does not require
knowing where it came from — but it does require knowing *what it is*.
"Living Green" is a shader landing page by Meng To, published in
[threeui](https://threeui.com/browse), his library of three.js interface
work. Sylva vendors it whole (`app/lib/sylva/scene.ts`, on its own pinned
three r149), and the scene works like this:

- **The roots are swept, not modelled.** Each limb is a tube swept along a
  centreline traced off the original *artwork's alpha channel* — the
  composition is described in fractions of that artwork's box
  (`[0.25, 0.566, 0.34]` is the crest, `[0.5, 0.779, −0.28]` the valley),
  which is why Sylva's hotspots are authored in the same fractions: a
  point named that way lands on the wood by construction. There are two
  roots — the near one carrying everything interactive, and a far ridge
  washed into the haze behind it.
- **The moss is ~45,000 instanced blades** (the landing page runs 190k;
  this route shares its GPU with hole-punched DOM and takes a fraction) —
  one four-rung pinched quad, instanced with per-blade position, lean and
  tone, planted on whichever limb faces the light.
- **All lighting is written in the shaders.** There is no `THREE.Light`
  anywhere; `litSurface()` computes the look directly, plus aerial haze
  toward lit air. This matters practically: you cannot brighten this scene
  by adding a light — a cue that wants a visual answer must drive a system
  the shaders already read (see §6).
- **The wind and the touch are one mechanism.** A pointer raycast onto a
  plane through the crowns feeds `uMouse`/`uMouseR` uniforms; blades
  within the radius part and sway. Sylva's "run a hand through" trigger is
  a synthetic sweep of that same virtual fingertip with the radius flared
  — no new system, the scene's own nervous system played on purpose.
- **The spray is a spore particle pool** emitted along pointer movement;
  the "loose the spores" trigger seeds a burst of it in a disc.
- **The butterfly is a small state machine** — cruise, approach, land on a
  nominated perch, take off, round again — with wings modelled to their
  real outline and a spook radius around the cursor. It lives inside the
  near root's group, in its local units, so it inherits the branch's
  placement and parallax for free. (The landing page skips it on small
  viewports as a spare decoration; Sylva builds it always, because here it
  is a named resident with a card.)
- **The entrance is a reveal scan**: a wavefront expands across the roots
  with a wireframe cage riding its front edge, then burns off. The tile's
  poster is captured after this completes, for obvious reasons.
- **The camera is authored in pixels** — `fov = 2·atan((H/2)/DIST)` — so
  one world unit is one CSS pixel. This is the lucky alignment §1 depends
  on: the DOM mapping needs no unit conversion at all.

Everything Sylva adds — cards, holes, pins, leader lines, the camera rig,
the cues — treats that world as a stage found, not built: its systems are
driven, never edited.

## 1. One projection, two renderers

The foundation, inherited from the mockup spike (`app/lib/css3d.ts`): the
DOM does not *approximate* the WebGL camera, it *shares* it. Each frame the
host reads the three.js camera's projection and view-inverse matrices and
re-expresses them as CSS — `perspective()` for the focal length,
`cameraCss()` for the view, `objectCss()` for each card's model matrix.
One world unit is one CSS pixel by construction (the scene's own
`fov = 2·atan((H/2)/DIST)` authorship), so there is no unit conversion to
drift.

This is the precondition for everything else. Any scheme where the DOM
layer has its own idea of perspective — its own vanishing point, its own
focal length, "close enough" transforms — fails the moment the camera
moves, because parallax error is a *velocity* artifact: still frames look
fine, and the seams appear exactly when things are in motion, which is
always.

## 2. The hole is cut, not composited

A card is real DOM **under** the canvas, visible through a hole the scene
cuts at the card's exact pose: a rounded-rect `NoBlending` mesh that
writes its (zero) alpha straight into the framebuffer. Because the hole is
ordinary depth-tested geometry, occlusion is free and *honest* — moss
nearer the camera covers the card the same way it covers bark, to the
pixel, per fragment. No mask layer, no clip-path mirroring, no second
opinion about what is in front.

Three details that took debugging to learn:

- **The hole is the card's silhouette, corners included.** A rectangular
  hole behind a 14px-radius card leaks a dark notch at each corner — the
  one hard right angle in a scene with none, and the detail that gives the
  whole trick away. The shape geometry carries the same radius as the CSS.
- **The hole must never be a second animation.** See §5.
- **Paint order is depth, re-sorted per frame.** The browser has no idea
  two absolutely-positioned cards sit at different depths; without an
  explicit sort of `z-index` by camera distance, a far card can paint over
  a near one — precisely the "several at once" case the spike exists to
  prove. The sort runs in the same frame callback as everything else.

## 3. The camera: why the curve is the whole ballgame

### 3.1 A chain of tweens cannot be smooth

Every step vocabulary starts here: `fly to pose A over 2.4s, then to pose
B over 3.8s`. Each leg is a from→to lerp under an ease. The problem is at
the seams, and it is mathematical, not aesthetic:

- Any ease whose bezier has `y₁ = 0` **starts** at zero slope; any with
  `y₂ = 1` **ends** at zero slope. That is *every* ease that "settles" —
  easeInOut, easeOut, the lot. A tour assembled from them halts at every
  boundary. Fly, park, fly, park: a slideshow wearing a camera move.
- The first fix — a curve with matched non-zero boundary slopes (Sylva's
  interim `CARRY`, `[0.33, 0.13, 0.67, 0.87]`, entering and leaving at
  ~0.4 of mean speed) — removes the *stop* but not the *kink*. Matched
  slope in normalized time is not matched velocity in pose space: when one
  leg travels 152° of yaw and the next travels 20°, equal normalized
  slopes are a 7-to-1 real-velocity step at the join. The camera does not
  stop; it flinches.

The honest conclusion: **per-segment easing is the wrong altitude for
continuity.** Continuity is a property of the whole path, so the whole
path has to be one primitive.

### 3.2 The spline: one clock, one shape (`@through`)

`c.Camera3D @through` runs a single step through N waypoints, sampled
along a cardinal spline in pose space:

- **Hermite basis, tangents from neighbours.** Segment *i* interpolates
  p₁→p₂ with tangents `m₁ = k·(p₂−p₀)`, `m₂ = k·(p₃−p₁)`, where
  `k = (1−tension)/2`. Position *and velocity* are continuous at every
  waypoint by construction — the camera *crosses* each pose, it never
  arrives at one.
- **`@tension` is the operator's grip.** Tension 0 is classic Catmull-Rom:
  maximal tangents, lively, and it *sways* — between waypoints that change
  direction it overshoots, which read on screen as a springy, loose hand.
  Tension 1 collapses the tangents to zero: piecewise-linear, C0 again.
  The default 0.5 halves the tangents — a steady hand that still curves.
  This is a one-scalar dial over the C1/character trade, and it earned its
  place the day the raw Catmull-Rom looked drunk.
- **The ease goes over the WHOLE path, and it should be linear.** The
  spline is the shape; an ease on top of it is a second opinion. (A gentle
  global ease is legitimate for a lap that starts from true rest — but
  Sylva's laps hand velocity to each other, so linear it is.)
- **Yaw is interpolated numerically and unwrapped by the author.** A
  spline knows nothing about circles: fern at 172° to wren at −168° is a
  340° swing back around the *front* of the scene unless the author writes
  192°. The unwrap is ~six lines (`legs` in `sylva-stage.gts`): express
  each waypoint's yaw in the previous one's winding, keeping every turn
  under a half circle. This bug is what sank the first attempt at
  rear-facing cards, before it had a name.
- **Omissions carry forward.** A waypoint that states only `yaw` inherits
  everything else from the previous point — keyframe-hold semantics, so a
  path can be authored sparsely.
- **It stays a pure function of the clock.** `pose(t)` is arithmetic on
  waypoints. A scrub, a replay, a render walked frame by frame — all land
  on identical poses. This is the property no integrator can offer, and
  the reason the spline is the *score-side* half of the answer rather
  than the whole answer.

### 3.3 The cascade: derivatives the score cannot see

Even a C1 spline leaves discontinuities the eye reads: the lap's restart
seam, an interruption, a hand seizing and releasing the camera, an aim cue
that jumps to a new target. And C1 itself is not the bar — **cinematic
motion needs the second and third derivatives bounded**. A real rig gets
this from physics: a dolly has mass, a fluid head has damping. You cannot
jerk iron.

The digital equivalent, from the Drift demo's doctrine ("a score for the
scene change, a loop for the simulation"): the lens **chases** the score
instead of obeying it.

- **One critically-damped spring is C1, not C2.** Integrating
  `v̇ = ω²(goal − x) − 2ωv` carries velocity as state, so velocity crosses
  every seam — but the *acceleration* term reads the goal directly. A goal
  that jumps (a look cue naming a new card) or bends (any seam) lands
  straight in the second derivative. The frame no longer stops; it
  *flinches*. This distinction was invisible in theory and obvious on
  screen.
- **Two stages in series bound the jerk.** Feed the first spring's output
  to a second spring. Stage two only ever sees a target that is already
  curving (C2-smooth almost everywhere), so its own output has continuous
  acceleration and finite jerk — the fourty-line version of a dolly's
  inertia. Sylva runs the pose through ω = 20 → 13 (framing must not be
  late for a card; total lag well under the approach time) and the aim
  through ω = 7 → 4.5 (its goal is a step function — the worst case — and
  a re-aim should read as the shot's own slow pan).
- **A hand snaps the cascade.** Drag and wheel write pose *and* both
  stages *and* zero the velocities. A chaser between a finger and its
  camera is lag, and lag on direct manipulation reads as broken. The
  cascade is for the film; the hand is immediate.
- **The price is random access.** An integrator's state depends on
  history. Playback and a frame-ordered render agree exactly; a scrub does
  not. Sylva accepts this the way Drift does — and the spline underneath
  means the *scored* pose stays seekable even where the displayed one
  trails it by a rounded half-second.

The composition is the point: **spline for shape (seekable, authored),
cascade for mass (smooth against everything the author didn't foresee).**
Neither alone survived contact with the scene.

### 3.4 The aim is part of the pose (`@look`)

A five-number orbit pose has an implied centre, and an implied centre is a
2D assumption wearing 3D clothes. The moment a scene has more than one
subject the centre must move, *on the same clock as everything else*:

- As a **Perform side-channel** (the first build), the aim was invisible
  to the timeline — un-scrubbable, eased by a second clock, and the source
  of a subtle class of disagreement where the pose and the aim arrived on
  different curves.
- As **`@look` in the tweened pose**, the aim lerps and splines with
  yaw/pitch/dolly — one clock, one curve family, seek-safe, carried in
  force like any unnamed pose component.

Two geometric corollaries that only surface once the camera is free:

- **Orbit the target, not the origin.** The vendored landing page orbited
  the scene origin with a clamped world-X truck — enough for a hero shot,
  and physically unable to frame a card at the far end of the root from
  behind. `pose()` now orbits `look` directly.
- **The truck rides the view's axes.** A world-X truck pushes the frame
  *left* when the camera stands behind the scene. Framing nudges are
  meaningful only in the camera's own right/up basis; with that fixed, a
  spot's `x: 0.04` means "a touch right of frame" from every angle.

## 4. Presentation timing: nothing may park, nothing may cut

The cards are 2D animation (Motion springs on DOM); the camera is 3D. They
read as one gesture only because of *when* things fire:

- **Opens are clipped INTO the flight** (`@at` a named step + `@delay`),
  not placed between steps. An open at a seam blooms at the camera's
  slowest instant — arrive, stop, *then* grow, a beat of dead air per
  card. Clipped mid-approach, the card grows out of its dot while the
  frame still carries real speed, and the two motions superimpose into one.
- **Hand-offs are cross-fades, not cuts.** There is no per-card close.
  The next card's open *swaps*: the leaver's exit spring and the
  arrival's entrance run simultaneously, mid-flight — which is,
  incidentally, the spike's "several cards at once" case exercised at
  every seam. One targetless close, clipped into the going-home leg, puts
  away the lap's last card.
- **The narration is a 2D layer on the same beats.** The lower-third
  swaps on the presented card (with a hold across travel, so the series
  title doesn't flash between legs) and rises/unblurs on Motion's clock —
  the 2D typography answering the 3D camera without either knowing the
  other's implementation.

## 5. One writer per agreement

The deepest rule, and the one that fixed the ugliest bug. The card's
entrance was Motion's (a spring on the shell's transform) while the hole
was slaved to a `getComputedStyle` read of it from the host's loop. Two
rAF callbacks, no ordering guarantee: whenever the host's frame ran first,
the hole wore *last* frame's pose — a dark notch chasing the card's
leading corner at spring speed. Not a tuning problem. A **topology**
problem: two consumers, two clocks, one truth.

The fix generalizes: for every pair that must agree, appoint one writer
and hand both consumers the same numbers in the same frame.

- **Hole ↔ shell:** the host integrates the entrance spring itself
  (critically damped, ω = 12) and writes the shell's `transform` and the
  hole's pose from the same `{scale, dx, dy}`. Zero frames of
  disagreement, by construction.
- **Pin ↔ card:** one anchor matrix, composed once, worn by both.
- **Leader line ↔ both:** drawn in the scene from the same anchor point
  to the card's edge, growing with the same entrance scalar — and
  depth-tested, so a branch cuts the line exactly where it cuts the card.
- **2D plane ↔ 3D camera:** §1 — the matrices are literally shared.

Where one writer is impossible (the DOM compositor versus the GL
swap), the agreement is *structural* instead: both consumers are written
in the same rAF callback, before either paints.

## 6. Input closes the loop

Occlusion that only affects pixels is a picture; occlusion that affects
*clicks* is a world. The DOM knows nothing about what the canvas drew over
it, so a card behind a branch still receives pointer events. `swallow`
raycasts the press against the wood first: if the root is nearer along
that ray than the card, the press belongs to the moss. In the other
direction, the cards' triggers reach back *into* the scene — the sway
uniforms, the spray, the butterfly's state machine — so causality runs
both ways through the same seam the rendering does.

## 7. The checklist

For the next scene that mixes DOM and a 3D world:

1. Share the projection matrices; never approximate them.
2. Cut holes with depth-tested geometry in the card's own silhouette.
3. Author the camera as a spline over waypoints (`@through`), tension
   ~0.5, ease linear, yaw unwrapped; keep it a pure function of the clock.
4. Put the aim in the pose (`@look`); orbit the target; truck in view
   space.
5. Chase the score with a two-stage critically-damped cascade; snap it
   under a hand; accept the seek trade knowingly.
6. Clip presentation cues into flights; swap, never close-then-open.
7. One writer per agreement, same numbers, same frame.
8. Ask the geometry before the DOM answers a click.

None of these are Sylva-specific. They are what "as if it is one thing"
costs, itemized.
