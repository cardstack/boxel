# Planes and cameras, hand in hand

**Status:** design — nothing here is implemented beyond what "Standing
today" lists. Parent documents: [choreo-composition.md](choreo-composition.md)
(the plane concept and its review gates), [nested-choreo.md](nested-choreo.md)
(regions and far matching), [demo-recording.md](demo-recording.md) (what any
of this owes an external clock).

The thesis is Chris's sentence: **planes and camera presets go hand in
hand.** A plane is only worth naming because it can be directed — its own
subject, its own zoom, its own pulse — and the presets are only complete
when they can direct more than one world at once. This document designs
the pair: independent pan and zoom per plane, and sprites that move
BETWEEN planes without relayout.

## Standing today (verified in the reel)

- A plane is a nested `<Choreo>` region: own snapshot, changeset, score,
  run, and — the part that matters here — **own camera**. The reel's
  clock plane proves independent zoom live: its aim is pinned once to the
  clock face (a zero-length cue with an `@origin` and no pose), and
  relative `SlowZoom` pulses zoom the plane during scene transitions
  while the world's camera flies its own path.
- The preset vocabulary (`Frame`, `Aim`, `Pan`, `SlowZoom`) expands into
  the one seekable camera cue. `Pan`/`SlowZoom` are **relative** —
  resolved against the pose in force at cue start — which is precisely
  what makes multi-plane direction composable: a plane's pulses stack on
  its own state with no absolute coupling to any other plane's score.
- Far matching (`src/choreo/far.ts`) pairs one bare id across regions at
  a render-pass barrier: MEASURE → MATCH → RUN with no frame painted
  between phases. The receiver flies from the sender's PAGE box as a
  `kept` sprite with a counterpart; the sender is dropped, not orphaned.
- The compositor host folds semantic commands through `t`, and its clip
  boundary fold lands every presence flip in ONE render pass — the same
  one-pass property a cross-plane move needs.

## The plane convention (no core type — the C2 gate holds)

A plane is a **convention**, not an engine object:

```gts
<Choreo class="reel-plane reel-clock" data-plane="clock" @quiet={{true}} as |k|>
  {{! content }}
  <k.Sequence>{{! this plane's own direction }}</k.Sequence>
</Choreo>
```

- `data-plane` names it; CSS owns stacking (`z-index` per plane) and
  input policy (`pointer-events`).
- The plane's score directs the plane's camera with the same vocabulary
  as any other. `Frame` gives it a subject; `Aim` re-subjects without
  re-magnifying; `Pan`/`SlowZoom` move it from wherever it stands.
- Coordination across planes is the **composition clock**, nothing else:
  two scores that must agree on a beat agree on a time. (A shared marker
  vocabulary is a later convenience, not a mechanism — the clock is the
  mechanism.)

Only after a second composition uses the same convention does a
`PlaneRegistry` (or any core `Plane` type) get proposed — the
composition doc's gate, restated on purpose.

## The coordinate contract (the one new piece of arithmetic)

A plane's camera is pure arithmetic over frozen numbers: with
transform-origin pinned at 0 0, the applied transform is
`translate(x + (1−z)·P) scale(z)` for aim point P (§6.3). Because it is
arithmetic, it is **invertible without reading the DOM**:

```
toPage(localBox, cam)  = localBox × z + applied(cam)
toLocal(pageBox, cam)  = (pageBox − applied(cam)) / z
```

A plane that scrolls (a shelf's row, a list) adds its scroll offset to
the same arithmetic — `local = (page − applied)/z + scroll` — which is
the one place a DOM read (the scroll position) legitimately enters, read
once per conversion, never per frame.

These two functions ARE the compositor ⇄ plane-local ⇄ viewport
conversion the composition doc promised. They should ship as exported
pure functions (unit-testable with no browser), and they are the entire
foundation for everything below: cross-plane flights, cross-plane hit
testing, and eventually cross-plane drag.

## Sprites between planes, without relayout

"Without relayout" is a law with a precise meaning:

> The flight is transform-only over real elements. Layout changes happen
> **once per boundary** — the single render pass where the sprite leaves
> plane A and enters plane B — never per frame, and never mid-flight.

Far matching already has the right skeleton. The design fills three
gaps:

### 1. One boundary, one pass

The move is a **semantic command** on the compositor
(`send({ target: 'board', action: 'piece.move', payload: { to: 'b' } })`
or a timed cue). The command flips ONE piece of application state; both
regions re-render in the same pass; the far barrier pairs the removed
sprite in A with the inserted sprite in B before anything paints. The
two-phase clip fold already proves the one-pass discipline at clip
boundaries; a cross-plane move rides the same rule. Backward folds
re-derive the pre-move state exactly as cues do today.

Each plane then animates its OWN reflow — A's neighbours close the gap,
B's neighbours make room — as declared steps in each plane's score
(`c.Move @of={{c.moved 'piece'}}`). That reflow is the one layout event
of the boundary pass; the flight itself never touches layout again.

### 2. Zoom disagreement (the real bug waiting to happen)

The sender sits under plane A's camera at zoom `zA`; the receiver under
plane B's at `zB`. Far matching hands the receiver the sender's **page**
box — visually correct — but the receiver's flight transform is written
in B's LOCAL space, where an ancestor scale of `zB` multiplies every
local translate. A flight computed from raw page deltas lands wrong by
exactly `zB` the moment a plane is zoomed.

**Verdict (tested):** the flight path is ALREADY correct. Compile
descales both endpoints' page boxes by the receiver's own `measureZoom`,
and the camera translate cancels in the delta — so the pin is page-true
and the landing clean under a zoomed receiver with no far.ts change.
`plane-flight-test.gts` (two planes, receiver held at zoom 2, one id
crossing) stands as the guard, and the reel's dock beat proves it in the
film. The remaining watch item is narrower: `s.initial = sender.initial`
adopts the sender-space CONTEXT box wholesale, so a context consumer on
a received sprite (camera `@fit` of a receiver, a follower's read) would
see sender-space numbers — that conversion (`toLocal` at the match)
becomes evidence-backed the day such a consumer exists, with its own red
test first.

(A plane camera that MOVES mid-flight composes with the flight visually
— the flyer rides its plane's world. That is the correct default, named
"in-world flight" below.)

### 3. Layering, honestly

Camera transforms create stacking contexts, so a plane is a stacking
context: no z-index inside plane B can paint above plane C. Two flight
modes, one deferred:

- **In-world flight (default, v1):** the receiver flies inside its own
  plane, `c.Hold @zIndex` raising it above its plane-mates
  (`(s) => (s.counterpart ? raised : rest)`), riding the plane's camera.
  Correct whenever the receiving plane is at or above the sending plane
  in the stack — which is the common editorial case (content → overlay,
  world → HUD).
- **Escort flight (deferred):** for flights that must cross ABOVE
  unrelated planes or stay screen-true under a zooming receiver, a
  dedicated flight plane at the top of the stack (zoom 1, no layout)
  carries the sprite: sender's plane releases it to the escort at the
  boundary pass, the escort flies it in screen space, and a second
  handoff lands it in B. This is two far matches back-to-back and needs
  no new engine concept — but it is NOT needed for the vertical slice,
  so it waits for the composition that demands it.

### Under an external clock

Nothing new: far-match flights compile into region runs, so they are
**seekable**, not wall-clock — a direct `renderAt` into mid-flight
reconstructs it like any cue (this is the brand crossing's law, extended
across planes). The recorder-owns-the-page and worker-slice rules from
demo-recording.md apply unchanged. The one caveat carried over from the
brand crossing: recrossing a boundary backward pairs the reverse flight
— interactive scrub semantics; a monotonic capture never recrosses.

## Interactive planes (the shelf is the reference)

A plane is not only a surface to direct — it is a surface to USE. The
reference case is bento-boxel's shelf (`app/components/shelf.gts`
there): a tray that reveals in levels, yields a slot to a card in hand,
and materializes the card on release. Its concepts, abstracted, are the
interactive half of the plane contract — and every one of them is app
state plus existing machinery, not a new engine concept.

**Reveal levels.** A plane presents itself: hidden / peek / full. The
shelf's law is the one to keep: **one sheet, never one pane per level**
— the level is a class and a content swap on the same element, so two
panes can never cross-fade and a level change cannot strand one
mid-exit. The plane's own arrival and departure is ordinary Presence;
its levels are ordinary tracked state. Under the compositor, reveal is a
semantic action port (`shelf.reveal { level }`) — idempotent, foldable,
so a directed cut or a recorded session drives the same shelf a finger
does.

**The plane as a drop target.** While a sprite is in hand (pointer
capture, moving in compositor space), the receiving plane declares its
intent with a **ghost slot**: hit-test the pointer through the
coordinate contract (`toLocal`, scroll included) to a slot index, splice
a ghost cell there, and let the plane's own layout yield — the shelf
gives the ghost a sprung width, so the row physically makes room. The
ghost is a preview WITHOUT commitment: pure receiving-plane state,
trivially reversible by removing the cell, and expressible as a
parameter port (`shelf.hoverIndex`) so a recorded drag replays through
the same fold as a live one.

**Materialization at the boundary.** The shelf's rule generalizes: the
in-hand representation persists until release; the receiving
representation is born AT the boundary pass and receives the flight —
"the fly-down finishes the materialization." In plane terms this is the
cross-plane move (§ above) with one addition: the two halves of the pair
are DIFFERENT RENDERINGS of one identity (board card ⇄ shelf tile), so
the flight is a counterpart crossfade riding the Move, exactly the
brand-crossing shape. Commit happens as one semantic command on release
— the single boundary pass — and the ghost cell it lands in is already
holding the layout open, which is what makes the landing relayout-free.

**The duality is the point.** Every interactive concept above has a
directed twin through the compositor's ports: reveal is an action, the
hover index is a parameter, the drop is a command. A shelf built this
way is simultaneously a UI a person uses, a scene a director can cue,
and a replay a recorder can seek — the composition doc's
interactive-first table, made concrete.

The shelf is also the natural **second composition** the packaging
checkpoint asks for: a different plane family (workspace / shelf /
in-hand escort) with different policies (yield, levels, drop) — if the
plane convention and the coordinate contract hold there too, THAT is
the evidence that promotes them.

## Direction across planes (the hand-in-hand table)

What the reel already stages, as the pattern to generalize:

| Plane  | Subject (aim in force) | Direction                                   |
| ------ | ---------------------- | ------------------------------------------- |
| world  | scene aims, per shot   | `Frame` per scene, `SlowZoom` on the hold   |
| titles | —                      | plain tweens (no camera on purpose)         |
| brand  | —                      | one crossing flight, `Move @size={{false}}` |
| clock  | the clock face, pinned | relative `SlowZoom` pulses per transition   |

The rule of taste that falls out: **absolute shots (`Frame`) belong to
the plane that owns the subject; overlay planes speak relative
(`Pan`/`SlowZoom`) about their own pinned aim.** Overlays never name
world geometry, so nothing couples except the clock.

## Build order (each step red-first, the usual gates)

1. **Coordinate helpers** — `toPage`/`toLocal` as exported pure
   functions over `CameraState` + aim; unit tests with no DOM.
2. **Far-match zoom conversion** — the receiver-local conversion at the
   match, proven by the zoomed-receiver flight test, live and under a
   direct seek. (Core change in `far.ts`; small, evidence-backed.)
3. **Cross-plane move as a compositor command** — one semantic cue moves
   a sprite between two reel planes; both reflows declared in the plane
   scores; capture parity at checkpoints. This is the vertical-slice
   proof and the second real user of the plane convention.
4. **Ghost slot + hit test** — pointer → `toLocal` → slot index → a
   sprung ghost cell in the receiving plane; proven interactively AND
   through the parameter port with a replayed drag.
5. **Materializing drop** — the release command: one boundary pass,
   different renderings paired as counterparts, the flight landing in
   the held-open slot. The shelf case, in the second composition.
6. **Escort flight** — only when a composition needs to cross above
   unrelated planes; two far matches, a top plane, no new engine types.
   (An in-hand sprite during a drag is the escort's natural first
   customer — the ghost/drop steps will tell us if it can wait.)

Out of scope, restated: no core `Plane` type, no plane registry, no
cross-plane drag engine (drag = pointer capture + these same coordinate
conversions, later), no Three.js planes.
