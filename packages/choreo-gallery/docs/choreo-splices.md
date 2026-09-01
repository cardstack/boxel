# Splices — cuts as a first-class citizen of the score

*Design note, 2026-09-01. Grown out of the Towers film (`/_towers`), which
is the first score that cuts like an editor instead of sweeping like a
drone. Status: the camera half is implemented (`cut:` on a `@through`
waypoint); the junction vocabulary below is the plan of record for the
rest.*

## The problem

A Choreo score is a continuous machine: one clock, splines with matched
tangents, integrators chasing goals. Film grammar is not continuous — its
strongest device is the cut, a deliberate C⁻¹ discontinuity. Forcing a cut
through continuous machinery produces exactly the artifacts Towers spent a
night removing:

- **The spline sweeps the seam.** One Catmull-Rom through every waypoint
  means the "cut" is really a fast glide across the jump, one segment
  long. The picture travels between shots that were meant to be spliced.
- **The integrator crosses the seam.** A chaser snapped to the new shot is
  then dragged backward toward the still-crossing goal and hauled in
  again. That round trip reads as a bounce.
- **Continuous media clip at the seam.** Audio hard-paused at a boundary
  pops; a voice line cut mid-word clicks; a video element swapped
  mid-frame flashes.
- **Workarounds cost time.** Authoring holds either side of a seam makes
  it stable but spends ticks standing still — a pause the edit never
  asked for.

The principle that resolves all four: **a cut is a point where nothing may
interpolate, integrate, or resample across the boundary — and everything
must arrive at it in a presentable state.** Discontinuity is not the bug.
Machinery that smooths over it is.

## Part 1 — the camera: `cut:` waypoints (implemented)

A `@through` waypoint may be marked `cut: true`. The one path becomes a
sequence of **shots**:

```
@through={{array
  {yaw: -46 …}  {yaw: -26 …}          — shot A
  {yaw: -18, cut: true …}  {yaw: -5 …} — shot B, spliced on
}}
```

**Semantics.**

- The waypoint list splits at every cut waypoint. Each shot is sampled as
  its own **clamped** spline: endpoint tangents are one-sided, so no
  shot's velocity is polluted by a pose on the far side of a seam.
- **Time is not redistributed.** Waypoints keep their uniform slots, so a
  cue anchored to "waypoint k's moment" still fires at exactly that
  moment — the film's beat clock is untouched.
- Each shot's window runs from its own first slot to the next seam, and
  the shot's waypoints spread uniformly across that window. The outgoing
  shot therefore **plays through the seam instant** — its motion
  stretches by one slot instead of parking — and the incoming shot begins
  at the seam instant exactly. No held frames, no lost motion, no glide:
  the sampled pose is a step function at the seam and C¹ everywhere else.
- A cut on the **first** waypoint drops the pose-in-force seed: the score
  opens already inside its first shot. (This is the general form of
  `@camera3dFrom`, which remains as the gentler tool for scores that open
  continuously.)

**What this deletes downstream.** The host no longer needs enforced holds
around seams, seam-wait logic in its chaser, or velocity seeding: the goal
jumps at the seam, the host snaps its own presentation in the same beat's
cue, and the two integrators (host chaser, scene chase) have nothing to
disagree about. Still shots stay still because they are authored still,
not because a builder parked them.

## Part 2 — the junction vocabulary (the plan)

A seam needs a *policy*, not just a location. The policy answers, per
medium, "what happens in the ~0–400 ms around the boundary." The set that
covers film grammar:

| join      | picture                                   | audio                        | text / DOM                    |
|-----------|-------------------------------------------|------------------------------|-------------------------------|
| `cut`     | step function, nothing else               | micro-fade out (~120 ms)     | leaver fades ~200 ms, no travel |
| `wipe`    | cut + a punctuation overlay (~340 ms)     | micro-fade out               | as `cut`                      |
| `whip`    | goal jumps; chaser races on a stiff spring (~350 ms) — a fast smooth tween, never a glide | micro-fade under the whip | old text exits during the whip |
| `blend`   | crossfade of the two frames               | equal-power crossfade        | old and new co-resident, cross-faded |

Rules that hold for every join:

1. **Audio never clips.** A boundary claims a ~120 ms fade-out on any
   still-playing continuous medium (voice, video audio) *before* the
   pause; ramps down are fast, ramps up are slow (the duck's law,
   generalized). This costs nothing perceptible and removes every pop.
2. **No inserted time.** A join executes *across* the boundary instant —
   overlays and fades run concurrently with the incoming shot's first
   frames. A join that delays the incoming shot is a pause wearing a
   costume, and is wrong.
3. **The incoming medium starts in a presentable state.** First frame of
   video seeked and decoded ahead of the seam; first line of text laid
   out before its reveal; the scene's build clock pre-set. Preparation is
   the join's responsibility, scheduled *before* the seam (prefetch at
   `seam − 1s`), never after.
4. **One policy object, many media.** A junction is declared once at the
   boundary and each medium interprets its lane — the same way a beat is
   one object read by camera, type, and voice.

**`blend` and the WebGL problem (implemented).** A crossfade needs both
frames alive at once. For DOM and video that is two elements and an
opacity ramp. For a WebGL scene the answer turned out cleaner than the
snapshot-a-frame-late compromise this note first predicted: the bridge
renders one frame *on demand* and reads the canvas back in the same
task — `preserveDrawingBuffer` never matters, and the freeze is captured
the instant **before** the incoming pose is applied. The still fades over
the live shot (~460 ms), wearing the live frame's own primary grade and
sitting under the split-tone, so both sides of the dissolve pass through
one colourist's hands. A capture from a zero-sized surface degrades to a
clean cut, never a broken image. This is the *freeze-blend* — what most
editors actually cut under a short dissolve anyway.

**Library form (future).** The natural home is a step:

```
<c.Cut @at={{at "film" 62}} @join="wipe" @audio={{120}} />
```

— a zero-duration step that (a) marks the camera seam the way `cut:` on a
waypoint does today, (b) dispatches a `PerformCommand`-like junction event
the host maps to its media, and (c) carries the join policy so a scrub or
seek reconstructs the transition deterministically (a seek that lands
inside a join replays its tail, not its whole overlay). Towers implements
(b) and (c) at the host level today — `Beat.cut` + `Beat.join` — which is
the proving ground for promoting the step.

## Part 2½ — linked tracks, independent seams (L-cuts, J-cuts, barge-in)

A junction is one *event* but not one *moment*: in real editing, each
track crosses the boundary on its own clock. The picture cuts at the
seam; the outgoing audio may **finish over the incoming shot** (an
L-cut), or the incoming audio may **lead the picture** (a J-cut). The
tracks are *linked* — the same junction triggers them — but *independent*:
each has its own offset, tail, and fade around the shared instant.

So a junction's policy is per-track:

```
junction {
  picture: { at: 0,      join: 'cut' | 'wipe' | 'whip' | 'blend' }
  voice:   { at: 0,      tail: 'finish' | 'fade' | 'word', ms: 120 }
  music:   { at: 0,      duck: … }
  video:   { at: -300ms, … }        // a J-cut: pre-rolled before the seam
}
```

**Voice tails, in order of politeness:**

- `finish` — the outgoing line plays to its natural end across the seam
  and the duck lifts when it lands. Default whenever the incoming shot
  has no line of its own: silence is not a reason to interrupt a
  sentence.
- `fade` — barge-in: the line stops in ~120 ms. Default when the incoming
  shot speaks; two voices may not overlap.
- `word` — the game-dialogue refinement: wait up to ~350 ms for the next
  inter-word trough (an analyser watching the line's RMS, or word
  timestamps computed at record time), *then* fade in ~40 ms. Stops
  cleanly "at the next word" instead of mid-syllable. Planned; the
  architecture below is built to take it.

**The architectural requirement: one throat per line.** A single shared
audio element makes politeness impossible — however gently the old line
is being faded, the new line's `src` swap guillotines it. Every line gets
its own element; an interrupted line fades (or finishes) on *its own*,
concurrently with the new line starting clean. Tails are therefore free:
they cost one idle element for a few hundred milliseconds.

## Part 3 — what Towers does with it (implemented)

- Cut beats mark their head waypoint `cut: true`; a re-cut score (chapter
  skip) marks its very first waypoint, so a skip opens inside its shot
  with no glide from the prior pose.
- The path builder's enforced holds and the chaser's seam-wait are gone —
  the splice made both redundant, and the ticks they spent parked go back
  to the shots.
- `Beat.join`: `'wipe'` (default for cut beats — the raked paper flash),
  `'cut'` (clean splice), `'whip'` (no snap; the chaser races a stiff
  spring across the jump — the "quick tween" join).
- The voice never hard-pauses, and every line has its own element: a
  seam into a speaking beat barge-fades the old line (~120 ms) on its own
  throat while the new line starts clean; a seam into a silent beat is an
  L-cut — the sentence finishes over the new shot and the duck lifts when
  it lands. A beat that is *about* silence (`hush: true` — the muneage
  breath) is the exception that asks for quiet.
- The cue clock is aligned to the waypoint slots (the pose-in-force seed
  occupies the spline's first slot, so cue k fires at slot k+1) — under
  the old uniform skew this was invisible; a splice made it a 2 s
  drag-back and forced the correction.

## Open questions

- Should a shot be able to declare its own `@tension`/ease? (A whip pan
  authored as a shot wants tension near 1.)
- Freeze-blend snapshot: `preserveDrawingBuffer` is off in most scenes;
  the snapshot has to be taken *by the scene* at the seam (bridge API) or
  accepted as one frame late.
- Junction events for **video**: the seam should drive
  `HTMLVideoElement` seek + play precisely; needs the prefetch slot from
  rule 3 to hide decode latency.
