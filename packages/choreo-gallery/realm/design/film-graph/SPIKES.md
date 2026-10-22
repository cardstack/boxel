# The two spikes

> Written results, as `PLAN.md` asked for before Phase 1 is committed.
> Both done 2026-09-03 on `spike/lane`, cut from `film/graph` after
> Phase 0. Spike 1 is a test that passes; spike 2 is a reading of the
> fold with the required order pinned.

## Spike 1 — `f.Lane`: a parent's steps, played in a child region

**Question.** Can a parent contribute nodes to a child region's timeline
so that (a) the child's queries resolve in the child's changeset, (b) the
child's run can be driven from outside and reproduces frames on a
backward seek, (c) an unrelated re-render of the parent keeps the child's
run, and (d) an edit to the contributed node replays the child's pass?

**Mechanism.** Twenty lines, all additive:

- `ChoreoHost.contribute(provider): () => void` — a provider from outside
  the region's markup, appended to the tree the region collects on every
  pass (`collectTree` = `collect(root)` then the contributors' `node()`s,
  in both places the region collects: the pass and the fast-keep check).
- `choreoHostById(id)` / `choreoHostAt(el)` in the registry — a lane's way
  of naming the region it plays in (`[data-choreo="board"]`).

The test-only `Lane` renders a hidden marker in the parent, finds the
child's host by id in a modifier, and contributes itself; its `node()`
returns a plain tween on `{ id: 'box' }` — query data, region-independent
— with `@to` as its one handle.

**Result: yes to all four.** `tests/integration/choreo/lane-spike-test.gts`,
1 of 1 passing:

| claim                                       | evidence                                                                                                                                                          |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| the child compiles the contributed step     | the child's run is 1.00 s, the lane's tween; the child has no steps of its own                                                                                    |
| queries resolve in the child's changeset    | `{ id: 'box' }` finds the child's participant; the parent has none                                                                                                |
| driven, not played                          | `run.pause(); run.time = t` puts the box at 50 px, 100 px, 25 px for t = 0.5, 1, 0.25 (linear ease), and a detour to 0.8 and back to 0.25 lands on the same pixel |
| an unrelated parent re-render keeps the run | bumping the parent's own tracked state re-passes the child (the detector is volatile by design) but `nothingNew` holds and the run object is the same             |
| an edit replays                             | changing `@to` changes the tree print; the child replays and the new run drives to 200 px                                                                         |

**Two findings for Phase 1.**

1. **A region's first render compiles no tree** (`firstRender ? [] :
collectTree(root)`). A contribution made during the parent's first
   render takes effect on the next pass, which the demos already provoke
   with a take bump. Attach will need the same: either the driving parent
   forces one pass after its children mount, or the child's first pass is
   allowed to compile when it has contributors. The second is the honest
   fix and is small.
2. **The default tween ease is not linear**, which is why the spike's
   first run failed at t = 0.25 (12.9 px). Not a mechanism fault, but a
   reminder that "driven equals seeked" is a statement about the run's
   own curve, and the contract test should compare a round trip against
   itself, not against arithmetic.

**Not tested here, and Phase 1 must:** a lane whose steps are camera steps
(`Frame`, `Aim`, `Pan`, `SlowZoom`) — those resolve against the child's
frame and measured boxes, which the long take needs; and a contributor
removed while the child's run is aloft (the region should treat it as an
edit).

## Spike 2 — seams under attachments, in exact mode

**Question.** When a seek lands inside a seam, in what order must the
picture, the still, the seam overlay and every driven attachment be
re-derived, so that no attachment shows from the wrong side of the cut?

**Reading.** The fold in `film.gts` (`private fold()`), per exact tick, in
order:

1. **Air ahead.** If the next beat is led and `t` has crossed its air cue,
   apply its air once (`airedFor`).
2. **Beat change or jump.** If the beat in force changed or the seek
   jumped: on a jump, `settleAir(i)`, drop `freeze`. Decide the seam into
   this beat (`joinInto`), its length, and whether `t` is inside it. **On a
   jump into a seam, `refreeze(i − 1)`:** stand the picture at the previous
   beat's tail (its style, its clock, its pose, snapped), snapshot, keep
   the still. Then `applyBeat(beat, jumped, { frozen, seam, since })` —
   the incoming beat, whole — and on a jump `speakAt`.
3. **The seam overlay.** Its animations paused and stood at `t − seamAt`;
   past its length, cleared.
4. **The score's run** paused and written: `run.time = t`.
5. **The plate's run** (the type, keyed on the beat) paused and written:
   `plate.time = t − beatStart(i)`.
6. **End** if `t ≥ total`.

Clips are not in the fold at all: `clipState` is a tracked derivation of
`t` through `resolveClip`, and the `<Clip>` re-renders from it.

**The answer.** The order that must be pinned is **picture → still → seam
→ driven runs**, and it is already the order the fold has. Two facts make
attachments safe under it:

- **Attachment windows are pure in `t`.** Which attachments exist at `t`,
  and where each one's clock stands, is arithmetic (`resolveClip`), not
  history. A seek into a seam does not need to know it came from the
  other side: the outgoing beat's attachments have ended (their windows
  close at that beat's tail) and the incoming beat's have begun. The
  still is of the _picture only_ — the iframe's snapshot — so no
  attachment is ever "in" the still, which is exactly today's behaviour
  for the plate (keyed on the beat, re-keyed instantly by a seek) and
  the honest one: the type of the outgoing beat vanishes at the cut.
- **A driven run must be written after its region exists.** The plate is
  keyed on the beat, so `applyBeat` (step 2) re-keys it and a new region
  mounts; the fold writes its time in step 5, after the render, through
  the `@grab` handle it kept. Attach must keep the same discipline: the
  parent writes a child's clock in the frame after the child's region is
  up, never during the pass that creates it (the fold-trap: a tracked
  write during a region's own pass replays the pass).

**One ordering that does matter, and is new:** an attachment whose
region carries a _filter_ (a frame op on the picture) must be applied
**before** the snapshot in `refreeze`, or the still is ungraded. Today
the grade is part of the beat (`settleAir` runs before `snapshot`), so
it is inside step 2 by construction. When `Look` becomes an adjustment
attached to a chapter, the fold has to apply the adjustments in force at
the previous beat's tail before it snapshots — i.e. adjustments are
derived at `t⁻` (the tail) for the still and at `t` for the frame. That
is one line in `refreeze` and one rule in the Adjustment contract:
**adjustments are part of the picture state the fold asserts, not
attachments the run drives.**

**Verdict.** No spike code needed beyond the reading; nothing in the
fold's order has to move. Phase 1's Attach writes its children's clocks
where step 5 is, one frame after a re-key, and the Adjustment base class
lands with the rule above so that `refreeze` grades the still.
