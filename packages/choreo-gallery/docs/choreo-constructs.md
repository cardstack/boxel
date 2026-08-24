# Choreo constructs

|                |                                                                           |
| -------------- | ------------------------------------------------------------------------- |
| **Status**     | Proposed                                                                  |
| **Start date** | 2026-08-25                                                                |
| **Package**    | `glimmer-motion` (the Choreo layer)                                       |
| **Requires**   | breaking changes — accepted; pre-1.0, no-compat ethos                     |
| **Related**    | [choreography.md](choreography.md) · [nested-choreo.md](nested-choreo.md) |

## Contents

1. [Summary](#1-summary)
2. [Motivation](#2-motivation)
3. [The language, complete](#3-the-language-complete)
4. [Detailed design](#4-detailed-design)
5. [Design rationale](#5-design-rationale)
6. [Evidence — the audits](#6-evidence--the-audits)
7. [Implementation plan](#7-implementation-plan)
8. [Verification plan](#8-verification-plan)
9. [Resolved decisions](#9-resolved-decisions)
10. [Unresolved questions](#10-unresolved-questions)

## 1. Summary

This proposal grows Choreo from a region-scoped timeline into a
recordable choreography language: gates that park a run for input,
anchors that start a step against any other, the delivery panel for
by-word and by-character builds, motion paths, keyframe values, a
playback handle shaped like Motion's controls, and a set of scene
constructs — the crossing (route transitions as changesets), the lift
(a real elevated layer), the camera (the region's frame as a step),
tethers, scrolls, and the gesture as a first-class geometry source. A
native WAAPI/CSS driver compiles the same language for environments
that forbid JavaScript clocks.

One rule organises all of it: **if it should scrub, it must be on the
timeline.** Everything here exists to make whole scenes — including
route transitions — replayable from a cue list.

Naming is settled where a decision is recorded: ef4's step names stay
(`Tween`, `Spring`, `Hold`, `Wait`), the route transition is the
_crossing_, durations are seconds as in Motion. Everything else is
provisional; semantics are the contract. Five measuring sticks keep the
design honest, each with its audit in §6: Keynote's build inspector,
bento-boxel's interaction patterns, Pretui's realm law, the Boxel
System V16 concept deck, and the boxel-labs surfaces research.

## 2. Motivation

The measure is the Build Order demo. It already plays a Keynote build
inspector — `with`/`after` relations, delays, durations, by-word and
by-character delivery, a scrubbable playhead — but as a private, sampled
score in `test-app/app/lib/builds.ts`, outside Choreo. Closing that distance means
promoting those semantics into the region, so `schedule()` compiles into
Choreo cues and the demo becomes a thin inspector over a real timeline.

### 2.1 The Keynote map

| Keynote                                    | Choreo today                                     | Missing                 |
| ------------------------------------------ | ------------------------------------------------ | ----------------------- |
| Build In                                   | step `@of={{c.inserted …}}`                      | —                       |
| Build Out                                  | step `@of={{c.removed …}}`                       | —                       |
| Action: Move along a path                  | —                                                | `@path`                 |
| Action: emphasis (pulse, jiggle…)          | —                                                | keyframe values         |
| With / After Previous (+ delay)            | block order in `Sequence` / `Parallel`, `@delay` | —                       |
| With / After Build N                       | —                                                | `@name` / `@at` anchors |
| Duration                                   | `@duration` / `@spring`                          | —                       |
| On Click                                   | —                                                | `c.Gate`, `c.advance()` |
| Start automatically after N s              | `@delay` on the first step                       | `@delay` on a gate      |
| Delivery: by object                        | `@stagger` (seconds between matched sprites)     | —                       |
| Delivery: by word / character / paragraph  | demo-only (`builds.ts`)                          | `@by` (+ `@stagger`)    |
| Delivery order: forward / reverse / random | —                                                | `@order`                |
| Rehearse / scrub                           | demo-only (Playhead samples its own score)       | the timeline handle     |
| Magic Move (slide transition)              | route transition, hand-built on `animateView`    | `@route`, `c.Crossing`  |
| Builds play backwards on ←                 | free — a changeset reversed is the reverse run   | —                       |

Everything in the right-hand column is specified in §4 and §6.

## 3. The language, complete

The whole surface in one place — what ships today (marked ✓) and what
this proposal adds (marked +). §4 and §6 carry each addition's
semantics; this is the index.

### 3.1 Region

`<Choreo @id @debug @route>` — hosts the participants, the orphan layer
(leavers) and the elevated layer (`c.Raise`), watches its render passes,
yields `c`. Participants are `{{motion id= role=}}` elements. A pass
whose changeset is all-kept still runs its timeline (+). `@route` (+)
treats a route swap inside the region as one pass.

### 3.2 Queries — every geometry source a step can name

Usable anywhere a step wants sprites or a box: `@of`, `@from`, `@to`,
`@origin`, `@follow`.

| query                                                   | matches                                                          |
| ------------------------------------------------------- | ---------------------------------------------------------------- |
| `c.all` / `c.kept` / `c.inserted` / `c.removed` (role?) | ✓ by changeset type                                              |
| `c.role 'x'` / `c.id 'x'`                               | ✓ by identity                                                    |
| `c.still` / `c.moved`                                   | ✓ kept, split by bounds delta                                    |
| `c.received` / `c.counterpart`                          | ✓ the two halves of a counterpart match, far match included      |
| `c.beacon 'x'`                                          | ✓ a named box that is never a participant                        |
| `c.gesture`                                             | + the live drag: its pose as a box, its velocity into any spring |

### 3.3 Blocks

`c.Sequence` ✓ · `c.Parallel` ✓ · `c.Gate` + (`@delay` to self-open;
advanced by `c.advance()`; splits the run into segments; error inside
`Parallel`).

### 3.4 Steps

After the cuts and the naming pass: ten steps, keeping ef4's names —
`Tween`, `Spring`, `Hold`, `Wait` descend from boxel-motion's behaviors,
and they stay (decided; see the cuts below). Every animating step reads
_who · what · how long_, position in the block gives _when_, and every
duration in the language is **seconds**, as in Motion.

| step         | reads as                                                                                                                                                                                                |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `c.Tween`    | animate properties: `@of`, flat property args (numbers, keyframe arrays, functions), `@duration` + `@ease`; `@delay`; `@repeat` + `@repeatType`; delivery via `@by` `@order` `@stagger`                 |
| `c.Spring`   | the same, driven by `@spring` instead of `@duration` + `@ease`                                                                                                                                          |
| `c.Move`     | FLIP the measured delta: `@spring` or `@duration` + `@ease`, `@size`; `@from`/`@to` take a beacon or `c.gesture`; `@path` + `@rotate`; `@swap='during' \| 'settle' \| 'none'` for the counterpart skins |
| `c.Hold`     | set properties for a window and release: `@duration` or the block's span, `@fill`; with no properties it is a pure wait                                                                                 |
| `c.Raise`    | promote to the region's elevated layer for the block's span; `@shadow`                                                                                                                                  |
| `c.Camera`   | the region's frame: `@zoom` `@x` `@y` `@origin` `@follow`; `@steady={{query}}` names sprites that keep their size (damped by default)                                                                   |
| `c.Scroll`   | animate the sprite's scroll container to `@align`; occupies the sequence                                                                                                                                |
| `c.Tether`   | `@from` `@to` `@path` — geometry continuously derived from sprites or the gesture                                                                                                                       |
| `c.Gate`     | park the run until `c.advance()`; `@delay` opens it by itself                                                                                                                                           |
| `c.Crossing` | the canned route transition: `@spring` `@leave` `@arrive` `@overlap` `@swap` `@scroll`                                                                                                                  |

### 3.5 Timing

Block order ✓ and `@delay` ✓; `@name` / `@at` with `at()` / `after()`
anchors (+); every duration resolves through the engine's generator, so
"after a spring" is exact ✓.

### 3.6 The run

`c.run` (+) wears Motion's `AnimationPlaybackControls` shape: settable
`time` (seconds) and `speed`, `duration`, `play` / `pause` / `cancel` —
plus the two words Motion has no need for: `advance()` and tracked
`segment`. `c.advance` is the one template-level alias, because gates
are wired in templates. Two drivers: the frameloop ✓ and the native
WAAPI/CSS target (+), same language, same assertions.

## 4. Detailed design

### 4.1 Gates — `c.Gate`

Keynote's driver is not time, it is the click: a build order is chunked into
segments and the timeline parks between them.

```gts
<c.Sequence>
  <c.Tween @of={{c.inserted 'title'}} @opacity={{1}} @duration={{0.3}} />
  <c.Gate />
  <c.Move @of={{c.moved 'card'}} @spring={{soft}} />
  <c.Gate @delay={{0.8}} />
  <c.Tween @of={{c.inserted 'tag'}} @opacity={{1}} @duration={{0.4}} />
</c.Sequence>
```

- A `Gate` splits the timeline into **segments**. A run plays to the next
  gate and parks; `c.advance()` (yielded, imperative — wire it to click or
  keys) resumes. `c.segment` is tracked: which segment the cursor is in.
- `@delay` opens the gate by itself after that many seconds — Keynote's
  "start build automatically after".
- Advancing mid-segment **completes the segment instantly** (Keynote's
  click-through), it does not skip it: every property lands on its segment-end
  value, holds included.
- A gate directly inside `Parallel` is a compile error. A pause is a total
  order; only `Sequence` can hold one. (A `Parallel` _between_ gates is fine.)
- Going backwards is not a gate concern. State drives Choreo: reverting the
  state that produced the pass produces the reverse changeset, and the
  natural run back. The cursor only ever moves forward through one pass's
  timeline.

### 4.2 Anchors — `@name` and `@at`

Block order gives Keynote's "with/after **previous**". The rest of the
inspector — "with/after **build N**" — needs a reference, not a position.

```gts
<c.Sequence>
  <c.Tween @name='tail' @of={{c.id 'tail'}} @pathLength={{1}} @duration={{0.52}} />
  <c.Tween @name='head' @of={{c.id 'head'}} @pathLength={{1}} @duration={{0.52}} />
  <c.Tween @at={{at 'head'}} @of={{c.id 'orbit'}} @pathLength={{1}} @duration={{0.56}} />
  <c.Tween @at={{at 'head' 0.4}} @of={{c.id 'bead'}} @scale={{1}} @duration={{0.38}} />
  <c.Tween @at={{after 'tail' 0.2}} @of={{c.id 'rule'}} @pathLength={{1}} @duration={{0.52}} />
</c.Sequence>
```

- `@name` labels a step. Names are per-region, per-pass; naming two steps the
  same is a compile error.
- `@at={{at name progress?}}` starts the step at the named step's start plus
  `progress` (0–1) of its duration. `@at={{after name delay?}}` starts at its
  end plus `delay` seconds. `at 'head' 1` and `after 'head'` are the same moment.
- A step with `@at` is **lifted out of its block's flow**: it does not push
  the sequence forward, and its own end still counts toward the run's length
  (the Build Order rule — `runtimeOf` is `max`, not `last`).
- Progress against a spring resolves the way `Sequence` already follows a
  spring: the duration comes from the engine's generator.
- Forward references are a compile error; anchors point up the score, the
  way Keynote's build list does.

### 4.3 Delivery — `@by`, `@order`, `@stagger`

`@stagger` (today: time between matched sprites, document order — now in
seconds) is Keynote's "by object". The rest of the delivery panel:

```gts
<c.Tween
  @of={{c.inserted 'word'}}
  @by='character'
  @order='reverse'
  @stagger={{0.04}}
  @opacity={{1}}
  @duration={{0.76}}
/>
```

- `@by` — `'item'` (default; the sprite is the unit) | `'word'` |
  `'character'` | `'paragraph'`. The text values split a text sprite's
  delivery: each slot plays the step's full property change over a
  window of the step's span.
- `@stagger` — seconds between one slot's start and the next, for every
  `@by`. Each slot's window is what remains of `@duration` after the
  offsets — the Build Order demo's `windowOf`, with its 0.55-of-span
  window as the derived default when `@stagger` is omitted. `0` is
  everyone together; large is strict relay.
- `@order` — `'forward'` (default) | `'reverse'` | `'center'` |
  `'random'`. Reverse is how Keynote builds text out: last word first.
  Random takes a seed on the realm build.
- `@by` text values on a sprite with no text is a compile error;
  splitting happens at measure time and the spans are the region's to
  own and clean up.
- The whole step still occupies one slot in the timeline — anchors and
  gates see one step, not one per character.

### 4.4 Paths — `@path`

Keynote's Action column moves an object along a drawn curve. `c.Move` is
box-to-box FLIP; a path is a different statement about the journey, not the
endpoints.

```gts
<c.Move
  @of={{c.id 'comet'}}
  @path='M 0 0 C 40 -80, 160 -80, 200 0'
  @rotate='auto'
  @spring={{glide}}
/>
```

- `@path` is an SVG path string in the sprite's own coordinate space,
  relative to its **initial** position — Keynote's model: the path is drawn
  from where the object stands.
- On a `Move` with both a bounds delta and a `@path`, the path owns position
  and FLIP still owns size. Without a path, `Move` is unchanged.
- `@rotate='auto'` orients the sprite along the tangent; a number is a fixed
  additional rotation; absent means no rotation.
- Property functions compose: `@path={{this.arcVia}}` may build the string
  from the changeset — a path from here to a beacon's box is
  `(s, cs) => arcTo(cs.beacon('trash'))`.

### 4.5 Emphasis — keyframe values

Pulse, jiggle, blink, flip: effects that end where they began. No new step —
a property value may be a keyframe array, and a round trip is an array that
returns:

```gts
<c.Tween @of={{c.kept 'card'}} @scale={{array 1 1.06 1}} @duration={{0.42}} />
```

- `PropSource` widens to accept arrays (and functions returning them). The
  engine already speaks keyframes; this only lets a step say them.
- The preset vocabulary (the Build Order demo's `EFFECTS`, plus the
  round-trip set) ships as plain data — importable, inspectable, no
  registration — once the array form exists to express it.

### 4.6 The timeline handle

Gates, the inspector, and the Playhead demo all want the same object: the
run as a value.

```ts
interface ChoreoRun {
  advance(): void; // open the current gate
  cancel(): void;
  pause(): void;
  play(): void;
  time: number; // settable, seconds — scrub; crossing a gate parks there
  speed: number; // 1 = normal, 0.5 = half, as Motion's controls
  readonly duration: number;
  readonly segment: number;
}
```

Yielded as `c.run` (null between passes), wearing Motion's
`AnimationPlaybackControls` shape. Settable `time` is what the Playhead
demo proves is possible — a scrubbed frame is a still, nothing in
flight — and what it currently rebuilds by sampling a private score.
This handle is the substrate; `Gate` and the Build Order inspector are
its first two consumers.

### 4.7 The crossing — `@route` and `c.Crossing`

The gallery ⇄ demo transition is built on `animateView`, and
`test-app/app/routes/application.ts` is four hundred lines of what that
costs: a veil timed against the snapshot, rules about what may be named, a
poll for completion, every live animation paused so the compositor survives.
All of it follows from one fact — **a view transition animates bitmaps**.

Choreo's model fits the crossing better, because a crossing is a
changeset.
A route swap inside a region is one render pass: the old page's participants
are `removed`, the new page's are `inserted`, and an id present on both
sides pairs as a counterpart — the same machinery that already flies a card
between bays. And the shape a crossing actually wants — _leaves fade
first, then everything moves, then arrivals fade in near settle_ — is a
sentence Choreo already speaks and the builder API cannot say cleanly:

```gts
<Choreo @route={{true}} as |c|>
  {{outlet}}

  <c.Sequence>
    <c.Tween @of={{c.removed}} @opacity={{0}} @duration={{0.18}} />
    <c.Parallel>
      <c.Move @name='flight' @of={{c.received}} @spring={{glide}} />
      <c.Hold @of={{c.received}} @zIndex={{2}} />
    </c.Parallel>
    <c.Tween @at={{at 'flight' 0.7}} @of={{c.inserted}} @opacity={{array 0 1}} @duration={{0.22}} />
  </c.Sequence>
</Choreo>
```

Participants are just ids on both pages — `{{motion id='stage-playhead'
role='stage'}}` on the gallery card and on the demo page — and pairing is
the id, exactly as far matching works today. The canned form:

```gts
<Choreo @route={{true}} as |c|>
  {{outlet}}
  <c.Crossing @spring={{glide}} @leave={{0.18}} @arrive={{0.22}} @overlap={{0.7}} />
</Choreo>
```

| arg                               | meaning                                                                                                                                  | default       |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `@spring` / `@duration` + `@ease` | the flight                                                                                                                               | a soft spring |
| `@leave`                          | seconds to fade what only the old page had                                                                                               | 0.18          |
| `@arrive`                         | seconds to fade what only the new page has                                                                                               | 0.22          |
| `@overlap`                        | arrivals start at this fraction of the flight — "after settle or close to it" is `0.85`; eager is `0.5`                                  | 0.7           |
| `@swap`                           | the counterpart-skin policy: `'during'` (cross over the flight — glyphs cannot morph; two real elements can cross), `'settle'`, `'none'` | `'during'`    |
| `@scroll`                         | `'top'` \| `'restore'` \| `(() => number)` — applied after the swap, before final measure; the region stays router-agnostic (§9)         | `'top'`       |

What `@route` itself must add, beyond sugar:

1. **Scroll inside the pass.** The window is placed after the route renders
   and before final bounds are measured — scroll is part of the move, the
   one lesson from `application.ts` that carries over unchanged.
2. **Whole-subtree leavers.** The orphan layer holds a page's worth of
   removed participants, not a row's. The layer exists; the size is new.
3. **Route awareness.** Suppress on non-animated changes (query params), and
   respect the tempo control's zero the way the current code does: no run at
   all, not a zero-length run.

And what the thirteen subtleties of the `animateView` version become:

| in `application.ts` today                           | under `@route`                                                                                                     |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| the veil, timed against the snapshot                | gone — nothing is snapshotted                                                                                      |
| never name the grid / the root-snapshot rule        | gone — no textures                                                                                                 |
| never name a container of named things (the freeze) | gone — no names                                                                                                    |
| the `is-veiled` counterpart card                    | gone — the card IS the counterpart, orphaned and crossfaded                                                        |
| `quietTheRest()` pausing every demo                 | gone — live content keeps running; this is the same reason the gallery filter already uses layout animation        |
| polled completion (`whenEnded`)                     | gone — the timeline knows its own end; `animationsSettled()` already waits on it                                   |
| arrive/leave overlap arithmetic                     | `@overlap`, one number                                                                                             |
| `crop(false)` everywhere                            | gone — real boxes, no `object-fit`                                                                                 |
| entrance suppression (`isCrossing`)                 | stays, as a region concern: inserted sprites the timeline names don't also play their own `initial`                |
| proportion-matched pairs (the ghosting)             | eased — a crossfade of two real elements tolerates mismatch the bitmap stretch could not                           |
| tempo composition                                   | free — Choreo already scales with the tempo                                                                        |
| scroll inside the update                            | `@scroll`                                                                                                          |
| the SharedTabs freeze                               | avoided by construction — no capture to fight `layoutId`; the standing "one engine per element" rule still applies |

What `animateView` remains for: cross-document transitions (MPA), and any
move where snapshotting is the point — freezing a page that is too expensive
to keep live. Same-document navigation defaults to `@route`.

### 4.8 Constructs specified with their evidence

Six additions are specified inside the audit that produced them, and
indexed in §3: the hot start and `c.gesture` (§6.1), `c.Tether` (§6.1,
§6.4), `c.Scroll` (§6.1), `@space` (§6.1), `c.Raise` (§6.3), `c.Camera`
with `@steady` (§6.3, §6.4), and the `@swap` policy (§6.3).

## 5. Design rationale

### 5.1 As simple as it gets: five cuts

The first draft of this language was audited the way the constructs
were: hunt the redundancy. Five spellings carried no information; three
cuts survived, and two were reversed by decision.

**Reversed: `Tween` / `Spring` / `Wait` stay.** The audit proposed
merging `c.Tween` + `c.Spring` into one `c.To` (which interpolator a
step uses is the engine's taxonomy) and folding `c.Wait` into a
property-less `c.Hold`. Both merges were sound as compression — and
rejected on provenance: these names descend from ef4's boxel-motion
behaviors (`TweenBehavior`, `SpringBehavior`, `WaitBehavior`), the
second-generation design this whole model carries forward, and the
lineage is worth more than one step fewer. The equivalences remain
true and worth knowing (`Spring` is `Tween` with a generator for a
clock; `Hold` with no properties waits) — they are just not the API.

**Delivery loses `@overlap`.** Two spacing knobs — `@stagger` (seconds
between starts) and `@overlap` (window as a fraction of the span) —
describe the same schedule from opposite ends: given the step's span
and the slot count, either determines the other. `@stagger` survives,
for every `@by`, because time-between-starts is the one an author can
hear; the 0.55-window default becomes the derived value, not a second
argument.

**`@crossfade` folds into `@swap`.** Both governed the counterpart's
two skins. One argument, three values: `'during'` (cross mid-flight,
the default), `'settle'` (carry the old skin whole, swap on landing),
`'none'`.

**`counterScale` moves onto the step.** A per-sprite attribute on the
modifier was the seam rule broken in the other direction — camera
policy leaking onto participants. `c.Camera @steady={{c.role 'focus'}}`
names the sprites that keep their size, damped by default, and the
timeline stays the only authority.

What remains is irreducible, and each piece earns its place: the
queries are the changeset (the model itself), the blocks exist because
`Hold`, `Raise` and gates need a _span_ to scope to (a flat with/after
list — Keynote's own shape, and `builds.ts`'s — cannot say "for the
duration of these three steps"), the anchors are two helpers that read
as English, and each remaining step names a genuinely different
mechanism. Ten steps, two blocks, ten queries: an author who knows
_who · what · how long_ can read all of it.

### 5.2 One vocabulary — the naming pass

Three audiences read this language: authors of these templates, people
(and models) who already know motion.dev, and Ember developers raised
on the ecosystem's patterns. The same pass serves all three. Breaking
renames are accepted; the reference above is post-pass.

#### Internal rules

1. **A name has one type and one meaning everywhere.** `@from` / `@to`
   are geometry (a beacon, a sprite, the gesture) — so `c.Tween`'s old
   property-hash `@from` dies; a keyframe array (`@opacity={{array 0
1}}`) already says start-and-end in one value. `@path` is path data
   on both `Move` (a string to travel) and `Tether` (a function to
   draw); `@draw` dies.
2. **A step's name is reserved.** `c.Hold` the step means `@hold` the
   argument cannot — the camera's exempt sprites are `@steady`, the
   crossing's own word for "same on both sides". `@block` collided
   with timeline blocks; the scroll alignment is `@align`.
3. **Durations are one word and one unit.** `@duration`, in seconds
   (`@ms` dies). A gate that opens by itself is a `@delay` — the same
   word every step already uses for time-before-start.
4. **Playback lives on the run**, shaped like Motion's controls;
   `c.advance` is the sole template alias.

#### The motion.dev alignment

The binding already keeps Motion's names 1:1 (`initial`, `layout`,
`stiffness`, `visualDuration`…). The timeline now holds the same line
wherever a concept overlaps — a reader who knows Motion should never
relearn a name, and a divergence should mean a genuinely new concept:

| concept                     | motion.dev                                                     | Choreo                                                                                                                                                                       |
| --------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| duration / delay            | seconds                                                        | same — `@duration` / `@delay`, seconds (`@ms` dropped: one template was speaking two units)                                                                                  |
| spring spec                 | `stiffness` `damping` `mass` `bounce` `visualDuration`         | identical, same engine                                                                                                                                                       |
| easing                      | named / cubic-bezier array                                     | identical — `@ease`                                                                                                                                                          |
| keyframes                   | value arrays                                                   | identical, as property values                                                                                                                                                |
| repeat                      | `repeat` count + `repeatType: 'loop' \| 'reverse' \| 'mirror'` | identical pair — the invented `@repeat='loop'\|'mirror'` enum dies                                                                                                           |
| sequence labels             | `at: 'label'`                                                  | `@name` + `@at={{at 'label' 0.4}}` — same concept, typed helpers instead of the string micro-DSL (`"<"`, `"+0.5"`), which Glint cannot check                                 |
| stagger                     | `stagger(0.1, { from: 'first' \| 'last' \| 'center' })`        | `@stagger` seconds; `@order` adds `'center'` alongside `'forward'` / `'reverse'` / `'random'` — order and origin are the same idea for a line, and `random` is ours (seeded) |
| playback controls           | `time` (settable, s), `speed`, `duration`                      | identical, plus `advance()` / `segment` for gates                                                                                                                            |
| what Motion has no word for | —                                                              | changesets, roles, beacons, the gesture, gates, camera, tether, lift, crossing — new concepts, new words                                                                     |

#### The Ember lineage

Is a yielded step component idiomatic Ember? Yes — the
provider-and-contextual-components pattern is the ecosystem's own
(`ember-power-select`, `ember-leaflet`'s `<layers.tile>`,
`ember-google-maps`' `<map.marker>`: components that render nothing
visual and register with their parent).

And the deeper lineage is single-file: both prior systems are ef4's.
**ember-animated** is his first generation — JavaScript generator
functions over sprite lists, deciding at runtime. **boxel-motion** is
his second, and his own correction of the first: the changeset in, the
render pass as the unit, behaviors (`TweenBehavior`, `SpringBehavior`,
`StaticBehavior`, `WaitBehavior`) computing their frames ahead of time
and handing them to the platform to play. Every load-bearing idea in
Choreo — the changeset, sprites with before/after bounds, behaviors
with real durations — is that second design carried forward; the
mapping table in choreography.md is a genealogy, not a translation.

So the recording rule is not a departure from ef4 — it is his own
arrow extended. Gen 2 already traded runtime deciding for
ahead-of-time frames; what it never grew was the thing precomputation
makes possible: a timeline you can hold — seek, gate, record. Choreo
is gen 3: the same model given a language (Keynote's, in the
template), a run handle, and — in the native driver — a return to
gen 2's own move of handing sampled frames to the platform. What
changes generationally is only the authoring surface: markup instead
of orchestration functions, because a timeline declared as markup is
data — co-located, compile-checkable, serializable, seekable, and
legible to a model reading a skill. The escape hatch stays where gen-2
users expect it — any property may be a function of `(sprite,
changeset)`. And the names themselves are the lineage kept whole:
`Tween`, `Spring`, `Hold` and `Wait` are ef4's behavior names carried
into the third generation — a merge that would have retired them was
considered and declined.

### 5.3 The seam with the binding

The reason to draw this line sharply is the recording rule:

> **If it should scrub, it must be on the timeline.** A recorded run can
> only replay what its cue list names. Anything that schedules itself —
> an `animate=` firing off a tracked getter, a `<Presence>` exit, a
> `layout` spring — happens _beside_ the timeline, and a seek cannot
> place it. The Playhead demo is the proof by construction: it scrubs
> precisely because nothing in it self-schedules.

So: is `{{motion}}` still useful? Yes — but inside a region its job
narrows to what a timeline cannot own.

**The modifier keeps, everywhere:** identity (`id` / `role`), style
custody (`style=` through the modifier — rule 1 is unchanged), and the
input-driven states: `drag`, `whileHover` / `whileTap` / `whileFocus`,
pan handlers. A hover has no duration and a drag has no cue — they are
unscrubbable by nature, and they stay element-owned (this is the same
line the surfaces research drew). Their _consequences_ re-enter the
timeline: a release is `c.gesture`, a focus change fires an all-kept
pass.

**Inside a region, the modifier loses its animation authority.**
`initial` / `animate` / `exit` / `variants` on a participant are a
second scheduler competing with the timeline — the gallery's
entrance-suppression flag (`isCrossing()`) is what that conflict costs
today. Every one of them has a `c.` spelling: entrances are `c.Tween
@of={{c.inserted}}`, exits are steps over `c.removed`, `animate`-on-
state-change is a step in an all-kept pass, variants with
`staggerChildren` are delivery (`@by` / `@stagger`), and a
repeating keyframe loop is `@repeat` — which is the one construct this
section adds, because an ambient loop whose phase derives from the run
clock scrubs and records; a self-scheduled one cannot. In `@debug`, a
participant carrying `animate` or `exit` warns.

**`<Presence>` does not overlap — it partitions.** Inside a region it
is redundant by design: leavers are the region's own (kept alive
exactly as long as the timeline names them — which is also what
`popLayout` was reaching for, done with a real layer), and a
`<Presence>` wrapped around participants double-retains them — that
warns, scoped precisely: only when the wrapped items are participants
of the enclosing region. A `<Presence>` for non-participant micro UI
that merely lives inside a region's DOM is legitimate. Outside any region, `<Presence>` remains the
light tool for micro enter/exit — menus, toasts, tooltips, the
surfaces `Lift`'s world — where a timeline would be ceremony. `wait`
is a two-step `Sequence`, `sync` is a `Parallel`; if a scene grows
enough to want those words, it has grown into a region.

**`layout` / `layoutId` overlap `c.Move` — and the region wins.** They
are the same FLIP on the same projection engine; the difference is
authority. `layout=true` re-decides on every render, self-scheduled and
off the record; `c.Move` is a cue. On a participant, `layout` is the
two-engines-on-one-element hazard the SharedTabs freeze already
demonstrated — so participants do not carry `layout`; the timeline
moves them. `layoutId` / `<LayoutGroup>` remain fully in force outside
regions (emergent scenes like a filtered grid that nobody needs to
scrub) and _underneath_ everything — the projection tree is the engine
`c.Move` rides; the region replaces its scheduler, not its math.

## 6. Evidence — the audits

### 6.1 The bento-boxel test

`bento-boxel-choreo` is the phase-2 conversion target, and today it imports
`{{motion}}` only — every scene is still a service holding measured rects, a
portal overlay flying a clone, and `setTimeout`s that must silently agree
with the springs. Auditing its interaction patterns against this document:

**Already answered.** The shelf fly-down (release point → tray slot) is a
far match: the card leaves the canvas region and arrives in the shelf
region, one id, and `endDrag` is already shaped like a pass — commit, render,
measure, fly. The staged/dragging z-index arithmetic is `c.Hold`. The
version deck's fold-away — "has to outlive the state that raised it" — is
what leavers are for. The row ⇄ detail transmute's two skins crossing over
one flying box is the counterpart-skin policy — `@swap`, on `Move`
itself. The `restore()` pattern —
animate forward, `setTimeout`, then commit — inverts under Choreo: commit
first, and the flight is the changeset's.

**Four constructs it needs that nothing above provides:**

#### Hot start — a gesture seeds the sprite

The fly-down starts from wherever the finger let go, at whatever speed it
was moving — not from the sender's resting box. A participant that is being
dragged when a pass fires contributes its live transform as its `initial`,
and its pointer velocity to any spring that moves it:

```gts
<c.Move @of={{c.received 'card'}} @from={{c.gesture}} @spring={{toss}} />
```

`c.gesture` rewrites `initial` the way `c.beacon` does, from the drag
session instead of a box; velocity flows into the spring the way Motion's
own drag-to-`layout` handoff already works within one element. Without
this, every drop flight keeps its measuring service.

#### Tethers — geometry that follows sprites per frame

The ERD's wires are measured after layout and painted straight into the
SVG, blind while anything moves, with a re-measure "once more late, after
the springs have settled" — an 800ms constant standing in for a fact the
timeline knows. Property functions resolve once, at cue time; a tether is
the continuous version:

```gts
<c.Tether @from={{c.id 'orders'}} @to={{c.id 'customers'}} @path={{curve}} />
```

Every frame of the run (and at rest), `@path` receives both sprites'
current boxes and returns path data. This is the construct
Boxel UI will lean on hardest: wires between cards, comment anchors,
selection halos — anything drawn _between_ things that move.

#### `c.Scroll` — the scroll container as a step

"Jump to the cited post" is today a 30ms timeout, a `scrollIntoView`, and
an 1800ms timeout to drop the highlight. As a timeline:

```gts
<c.Sequence>
  <c.Scroll @of={{c.id postId}} @align='center' @duration={{0.42}} />
  <c.Hold @of={{c.id postId}} @outline='var(--cite)' @duration={{1.4}} />
</c.Sequence>
```

A `Scroll` step animates the sprite's scroll container so the sprite lands
at `@align`; it occupies the sequence like any step, so "scroll, then
mark" is finally an ordering statement instead of two timers.

#### Relative space — flying inside a moving frame

The detail transmute zooms the canvas with the same spring as the flight
"so the composite path stays straight" — a coincidence of constants doing
the work of a coordinate system. A step should be able to say which space
its bounds mean: `@space='parent'` resolves the sprite's motion against
its (possibly animating) container per frame, page space remaining the
default. This is the same requirement nested timeline sync has, met at
the step level.

**Still open, smaller:** event-only runs — the share badge and the hot
wire are a `c.Hold` with a lifetime, but their trigger is an event that
inserts, removes and moves nothing; the model needs to say plainly that a
pass whose changeset is all-kept still runs its timeline.

### 6.2 The Pretui test — the realm target

Pretui is the other kind of stress test. It is a Boxel realm, and realm law
forbids `setTimeout`, `setInterval`, `requestAnimationFrame`, `Date.now`
and `Math.random`; its motion charter states the consequence plainly —
_every effect is a CSS animation whose schedule is computed once per
render, and the only JavaScript is measurement inside a modifier_. Its
four core primitives (Presence, InView, SlidingHighlight, ScrollProgress)
and four pointer behaviors are deliberate transcriptions of rAF-engine
components into `@starting-style`, `transition-behavior: allow-discrete`,
scroll-driven timelines, and custom-property-fed retargeted transitions.

So porting Pretui to Choreo is not blocked on choreography — it uses less
of it than Choreo already has. It is blocked on the clock. The gaps are a
runtime target, not constructs:

#### Compile to the platform

`glimmer-motion`'s own source contains no `requestAnimationFrame`; every
frame is scheduled through motion-dom's batcher, and motion-dom already
exports the way out: `startWaapiAnimation`, `generateLinearEasing` (a
spring sampled into a CSS `linear()` easing), `calcGeneratorDuration`,
`supportsScrollTimeline`. And Choreo's `compile.ts` already reduces a
timeline to absolute cues — at, duration, ease, properties — which is
precisely WAAPI's input. The missing piece is the back half: a **native
compile target** that turns a pass's cues into WAAPI/CSS animations at
render time, springs pre-sampled through the generator, with JavaScript
touching the DOM only to measure. Under that target the timer law is
satisfied by construction: the browser owns every clock, and a busy main
thread cannot stall a step — the same argument Pretui's charter makes for
its own CSS.

What compiles: every Tween, Spring, Move, Hold, Wait, gate segment,
anchor, and delivery window — the entire declarative language. What a
pass can also pre-compute: counter-scale keyframes for a `Move`'s
children (both boxes are known, so the child's correction curve is a pure
function of the parent's — sampled once, not corrected per frame).

What never compiles, with its law-legal substitute:

| per-frame feature                      | realm substitute                                                                                                                                                        |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| drag momentum, pointer springs         | Pretui's own pattern — event listeners write custom properties, retargeted CSS transitions ease (critically damped, no overshoot); Choreo should adopt it, not fight it |
| live scale correction mid-interruption | pre-sampled counter-scale keyframes; accept the approximation                                                                                                           |
| `c.Tether` per-frame draw              | CSS anchor positioning, when it lands; until then tethers re-measure at cue boundaries                                                                                  |
| `@order='random'`                      | a seed argument — realms have `seedFrom`; randomness must be an input, never a clock                                                                                    |

#### Package for the realm

Realm dependency law is "vendored, single file" — Pretui carries
photoswipe, gridstack and floating-ui as one `index.js` each. Choreo needs
the same: a flat build of `glimmer-motion` with motion-dom folded in, the
native target on, and the frameloop-dependent features (drag sessions,
`useScroll`'s JS fallback) excluded or inert. Scroll binding requires the
native `ScrollTimeline` path — the capability check exists
(`can-use-native-timeline`); the realm build makes it a requirement
rather than a preference.

What that buys back from Pretui's vendored shelf: the lightbox flight
(photoswipe's open/close morph is a counterpart flight; its pinch stays
gesture-owned), the dashboard reflow (gridstack's reflow is `Move` over a
changeset; its drag stays a listener), and every hand-computed
per-character `animation-delay` schedule, which is the delivery panel
(`@by` / `@order` / `@stagger`) compiled by hand today.

### 6.3 The concept-model test — Boxel System V16

The original Keynote deck for the Boxel spatial system (98 slides; the
first half is the model, the second its application to Tally) is the
third measuring stick, and its animation data agrees with its thesis: of
74 slide transitions in the first half, 52 are Magic Move. The concept
model is a **chain of crossings** — the same objects tracked across
dozens of consecutive scenes — with almost no discrete builds. That is
Choreo's model, stated five years early.

Its taxonomy is the finding. Every motion pattern in the deck is scored
in three columns — **local motion** (the focused boxel transmutes),
**scene motion** (the tray carries, wells reflow, planes slide), and
**camera motion** — and Choreo today speaks only the first two. What the
deck confirms, and the two constructs it adds:

**Confirmed.** Wells — a visible landing slot that appears before the
flight, is stretched into, reflows, and fades — are an inserted
placeholder participant plus a timeline, not a new primitive (and the
deck's "drag into the well" is the hot start). "Settle into a badge" (a
dialog confirms and collapses to an XS chip inside the card it edited)
is a counterpart flight and the best small demo of one. The tray as "the
physical element which carries the focused boxel between scenes" is the
counterpart's carrier role under another name.

#### `c.Raise` — planes, made of the orphan layer

The deck's plane stack is not vocabulary; it is the answer to a DOM
fact. `z-index` cannot escape an ancestor's stacking context, and no
value of it survives an `overflow` clip — so any flight that crosses
containers clips against the first scroller it passes. That is why
bento-boxel hand-built its portal `.flight-layer`s, and it is why
`c.Hold @zIndex` alone cannot say "lift". Choreo already owns the
machinery that solves this: the orphan layer, a region-owned overlay
that removed elements are reparented into with their bounds locked —
one plane, currently reserved for the dead.

`c.Raise` points the same machinery at the living:

```gts
<c.Parallel>
  <c.Raise @of={{c.id 'card'}} @shadow={{true}} />
  <c.Move @of={{c.id 'card'}} @spring={{carry}} />
</c.Parallel>
```

For the span of its block, the sprite is promoted into the region's
elevated layer — reparented with measured continuity, above every
stacking context and clip in the region — and placed back where it
lands when the block ends. `@shadow` casts on the layer below (the
deck's "tray casts the shadow on the plane below"). The rest of the
deck's plane phenomena then decompose: the modal plane shrinking what
is beneath it is `c.Camera`; the window tint is a `Tween` on everyone
else; a plane sliding in is a participant like any other. The acid
test is the deck's inversion — A contains B, then B contains A — which
is only animatable at all if both can cross the boundary on a shared
layer and land in their new containment: `c.Raise`'s contract case.

#### `c.Camera` — the third column

The deck's camera rules: zoom out to reveal the edges for rearranging;
zoom in for in-place editing; a modal plane "causes the planes below to
shrink proportionally and reveal a bit of the edges" while "the focus
boxels stay the same size"; camera moves scale things proportionally but
never change what a thing is. That is a region-frame transform played as
a timeline step:

```gts
<c.Sequence>
  <c.Camera @zoom={{0.85}} @spring={{glide}} />
  <c.Move @of={{c.moved 'card'}} @spring={{soft}} />
  <c.Camera @zoom={{1}} @origin={{c.id 'focus'}} />
</c.Sequence>
```

`@zoom` / `@x` / `@y` animate the region's own frame; `@origin` aims it
at a sprite. Sprites named by `@steady` keep their size — the deck's
"focus boxels stay the same size" — damped by default. This is the construct `@space` was
circling: `@space='parent'` resolves a flight _inside_ a moving frame,
`c.Camera` is what _drives_ the frame, and the Zoom demo proves them
together. The deck's second half adds the coupling to watch: past a zoom
threshold a boxel _transmutes_ to a smaller form — camera state feeding
the next changeset. The region exposes it as a tracked `c.camera`
(`{ zoom, x, y }`), updated when a camera step lands or cancels —
deliberately not per frame, so deriving app state from it cannot
violate the recording rule (§9).

#### `@swap='settle'` — the transmute's crossfade policy

Lift-and-place states it exactly: "the focused boxel retains its 2D
rendering throughout, just scaling the bitmap through the lift and place
journey. After placing into new flow, it should re-render and reflow."
The counterpart crossfade needs a policy argument: `@swap='during'`
(both skins cross mid-flight — the detail transmute) or
`@swap='settle'` (the old rendering is carried whole and the swap
happens at landing — the lift). One word for a decision every flight
makes implicitly today.

#### The hierarchy, as a lint

The deck's Motion Hierarchy rule is quantitative: **primary** — one, at
most two, focused boxels transmute; **secondary** — the tray carries;
**tertiary** — everything else fades or slides, because "abrupt
disappearance of any boxel element during scene transition leads to
uncanny valley where the world doesn't feel spatially and physically
real." Choreo can enforce the floor of that: in `@debug`, a removed
participant that no step names — one that will simply vanish — is a
warning with the sprite's id in it. The ceiling (too many primaries) is
taste, but a debug count of sprites moved by `Move` steps per pass makes
the review conversation possible.

### 6.4 The surfaces test — boxel-labs

The surfaces research (`boxel-labs`: `boxel-surface` / `boxel-grid` /
`boxel-canvas`, mirrored into Pretui's `surfaces/` bundle; the staging
realm copy is auth-gated) prototyped drag and drop twice, and drew its
architectural line the same way both times: **the host owns the drag
state machine, a component renders the visual.** The grid's `DragGhost`
says it outright — grab-offset and axis-locking are "consumer-specific";
the canvas vendors xyflow's drag whole. Choreo should respect that line,
not absorb it: nothing below extracts a drag state machine. What the
research does hand over is what happens at the seams.

**Extract: `c.gesture` is a query, not a `Move` argument.** The hot
start was specified as `@from={{c.gesture}}`. The research shows the
same value composing everywhere a box query goes:

- `c.Move @from={{c.gesture}}` — the release flight (the ghost's
  landing, bento's fly-down).
- `c.Tether @to={{c.gesture}}` — the canvas's connect-drag: a wire
  drawn from a handle to the pointer until release pairs it to a real
  sprite. Edge reconnection is the same tether re-aimed.
- `c.Camera @follow={{c.gesture}}` — auto-pan: the viewport tracking a
  drag near its edge (xyflow's `autoPanOnNodeDrag` / `autoPanSpeed`,
  today a JS loop). `@follow` also takes a sprite query — a camera that
  keeps the flying participant in frame.

One query, three consumers; the gesture becomes a first-class source of
geometry the way a beacon already is.

**Extract: the damped counter-scale.** `relative-scale.ts` is finished
research into exactly `c.Camera`'s `@steady` problem: secondary UI in a
zooming world should scale _with_ the host but not 1:1 — asymmetrically
damped (`pow(z, 0.30)` zoomed out so it stays readable, `pow(z, 0.70)`
zoomed in so it doesn't feel stuck), clamped to `[0.85, 1.8]`. These
curves are `@steady`'s damped default; full size-holding remains a
per-query choice. The deck said "focus boxels stay the same size"; the
research measured what the eye actually tolerates.

**Extract: escalation is a crossing.** `boxel-surface`'s `<Lift>` is a
semantic anchored surface — kind, placement (`attached` / `shadow` /
`plane`), backdrop, elevation tier, and an escalation ladder (preview →
plane). Today each rung enters through its own CSS keyframe
(`bx-lift-in`, `bx-lift-plane-in`) and escalation is an unmount and a
fresh mount — no continuity between rungs. That is a counterpart flight
by construction: same content, two placements, one identity. The
surfaces `Lift` should eventually _ride_ Choreo's step rather than the
other way round. The naming collision this exposed — `boxel-surface`
ships `Lift` the component while this step promotes a sprite to the
region's layer — is settled (§9): the step is `c.Raise`, and the
component keeps `Lift`. Product and mechanism of the same idea, one
word each.

**Not extracted, deliberately.** The prospective-drop state — wells
lighting up, the drop indicator line, "what would happen if released
here" — is host domain logic (the grid's `DropIndicator`, bento's
`previewOp`). Choreo animates those affordances as ordinary
participants; it does not compute them. Snap grids quantize a
destination before the timeline sees it. And the focus ladder is the
_trigger_ vocabulary — a focus-path change is what fires a pass — not a
motion construct; the deck's "shifting focus" table is application
choreography written against it.

## 7. Implementation plan

| piece                           | state                                                                                                                     | depends on |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------- |
| keyframe values in `PropSource` | smallest; unlocks emphasis + presets                                                                                      | —          |
| `@name` / `@at` anchors         | compile-time only (`compile.ts` already places cues absolutely)                                                           | —          |
| `@by` / `@order` / `@stagger`   | the demo's `windowOf`/`slotOf`, moved into the region                                                                     | —          |
| the timeline handle             | pause/seek over the cue list; the Playhead demo is the proof                                                              | —          |
| `c.Gate`                        | segments over the handle                                                                                                  | the handle |
| `@path`                         | the one engine-adjacent piece                                                                                             | —          |
| `@route` + `c.Crossing`         | region + orphan-layer work, then sugar                                                                                    | anchors    |
| the seconds rename              | one breaking change: `@ms` → `@duration`, ms-`@stagger` → seconds, language + gallery + contract suite converted together | —          |

The Build Order demo is the acceptance test throughout: each promotion
deletes a piece of `builds.ts`, and the demo is done being a simulation when
`OPENING` is a `<c.Sequence>`.

## 8. Verification plan

The house method already exists: upstream behaviour is pinned by a ported
suite, Choreo's own rules live in a contract suite on small fixtures
(`tests/integration/choreo/`), the gallery is the taste test, and a soak
hammers the real thing. The constructs extend each in kind. Two standing
rules first:

**One suite, two drivers.** The native compile target is not a second
implementation to test separately — it is the same language with a
different back end. The entire Choreo contract suite runs twice, once on
the frameloop driver and once on the native one, same fixtures, same
pixel assertions (`setupMotion(hooks, { driver: 'native' })`). Anything
the native driver cannot pass, it must refuse loudly at compile time —
a silent visual delta between drivers is the one unacceptable bug.

**Every interruption test ends the same way.** `orphanCount() === 0` and
`strandedTransforms()` empty, after every new kind of interruption the
constructs introduce: advancing a gate mid-flight, seeking backwards,
cancelling a parked run, crossing a route mid-morph.

### 8.1 Demos

Three upgrades and five new pages — each demo is the acceptance test for
exactly the construct it wears:

| demo                                        | construct proven                   | done when                                                                                                                         |
| ------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Build Order** (upgrade)                   | anchors, delivery, keyframe values | `OPENING` is a `<c.Sequence>`; `schedule()`, `windowOf`, `slotOf` deleted from `builds.ts`                                        |
| **Playhead** (upgrade)                      | the timeline handle                | the scrubber sets `c.run.time`; the private sampled score deleted                                                                 |
| **The gallery ⇄ demo transition** (upgrade) | `@route`, `c.Crossing`             | the `animateView` orchestration in `application.ts` deleted; light mode needs no veil rule                                        |
| **Deck** (new)                              | gates                              | a three-build slide advanced by click/key — the mini-Keynote; includes a self-opening `@delay` gate and a click-through mid-build |
| **Wires** (new)                             | `c.Tether`                         | an ERD whose boxes reflow on toggle while every wire stays attached mid-spring                                                    |
| **Shelve** (new)                            | `c.gesture` hot start              | a card dragged and released anywhere flies to its slot from the release point, at the release velocity                            |
| **Zoom** (new)                              | `@space='parent'`                  | a row opens to a detail while its canvas zooms; the composite path is visibly straight at slow tempo                              |
| **Cite** (new)                              | `c.Scroll`                         | "jump to the cited entry": scroll, then a held highlight, as one sequence — no timers in the component                            |

`@path` and emphasis need no page of their own: Deck's builds use a path
move and a pulse, which is also how Keynote would.

### 8.2 Contract cases — the sharp ones

The cases below are the ones that catch real bugs, not coverage filler.
Each is a small fixture in `tests/integration/choreo/`.

**Gates.** Advance mid-segment lands every property on its exact
segment-end value (pin the numbers). A leaver named after a gate survives
the park — and is released on `cancel()`. A gate directly inside
`Parallel` fails at compile with a named error. `animationsSettled()`
treats a parked run as settled — otherwise every gated test hangs; this
is a semantic decision and the test is its record.

**Anchors.** `at 'x' 0.4` against a spring resolves through the
generator: pin against `calcGeneratorDuration`. A lifted step does not
push the sequence, but the run's duration is the `max` including it.
Duplicate `@name` and a forward reference each fail at compile, named.

**Delivery.** The split reassembles: `innerText` before equals after,
and the assistive mirror stays whole. The window math is pinned by
porting `windowOf`'s literal numbers from `builds.ts` as expectations.
`@order='random'` with the same seed is byte-identical across two runs;
without a seed it is a compile error on the realm build.

**Paths.** Closure: a `@path` move's final frame equals the FLIP final
bounds exactly — the path bends the journey, never the destination.
`@rotate='auto'` matches the tangent at both endpoints. Reduced motion
collapses a path move the way it collapses a `Move`.

**Keyframe values.** A round-trip array ends byte-equal to its start;
interrupted mid-pulse, it settles to base, not to the peak.

**The handle.** A set `time` is a still: no animation is running while
paused, at any `time`, including mid-spring. Setting `time` across a
gate parks at the gate. `pause()` then `play()` resumes from the same
`time` (pin it). After `cancel()`, the two invariants.

**`@route` / Crossing.** Flight continuity: the received sprite's first
frame equals the old page's measured box. The anti-snapshot assertion: a
looping animation inside a moving participant advances its
`currentTime` during the morph — the frame that proves live content
never froze. Scroll is applied before the final measure (final bounds
reflect it). Tempo zero produces no run at all — assert zero cues, not a
zero-length run.

**Hot start.** `initial` equals the release rect, not the resting rect.
Velocity continuity: the first flight frame's velocity matches the
pointer's within tolerance — `shape()` sampled across two frames.

**Tether.** At three sampled mid-flight frames, wire endpoints sit
inside the moving boxes within ε. A tether to a removed sprite detaches
without error. At rest, a container resize re-aims it.

**`c.Scroll`.** The container ends with the sprite at `@align`; the next
step starts only after (it occupies the sequence). A user wheel during
the step cancels it and the run survives — interruption invariants hold.

**`@space`.** The bento assertion, made literal: sample the flight's
page-space midpoint while the parent scales; start, midpoint and end are
collinear within ε.

**All-kept passes.** A pass that inserts, removes and moves nothing
still runs its timeline: a `c.Hold @duration` fires on an event-only change
and releases on schedule — measured against the run clock, not wall
time.

**The native driver.** Beyond the shared suite: a frameloop spy proves
zero engine ticks during steady playback; the sampled `linear()` spring
matches the JS spring within ε at five offsets; a child's `shape()`
stays identity while its parent flies (the pre-sampled counter-scale);
and the realm bundle passes a static scan — no `setTimeout`,
`requestAnimationFrame`, `Date.now`, or `Math.random` in the artifact.

### 8.3 Test-support additions

The suite needs four helpers to say any of the above:
`advanceGate()` (advance and settle one segment), `seekTo(seconds)`
(set a run's `time` from a test), `velocityOf(el)` (two-frame sample), and the
`driver` option on `setupMotion`. The soak extends with a storm mode:
random advance/seek/route-cross against the live gallery, invariants
checked after every blow — the same discipline `interruption-test.gts`
applies today, aimed at the new surface.

## 9. Resolved decisions

1. **The step is `c.Raise`.** `boxel-surface` keeps `Lift` the
   component; this proposal's promote-to-the-region's-layer step takes
   the free name. One word each for product and mechanism.
2. **The seconds migration is one breaking change.** `@ms` →
   `@duration` and ms-valued `@stagger` → seconds land in a single
   change that converts the language, the gallery, and the contract
   suite together — no aliases, no deprecation window, per the pre-1.0
   no-compat ethos.
3. **`@route` stays router-agnostic.** A route swap is recognised
   purely as a render pass inside the region; there is no
   router-service hook. Scroll intent is the host's to supply
   (`@scroll` takes `'top'`, `'restore'`, or a thunk), and suppressing
   non-animated changes (query params) is the host's job — a pass the
   host renders identically simply produces no changeset.
4. **Camera state is a tracked value.** `c.camera` (`{ zoom, x, y }`)
   updates when a camera step lands or cancels — not per frame — so
   zoom-threshold transmutes can derive from it without creating a
   per-frame state feedback loop or violating the recording rule.
5. **The Presence warning is scoped.** Warn only when the wrapped
   items are participants of the enclosing region; a `<Presence>` for
   non-participant micro UI inside a region's DOM is legitimate.

## 10. Unresolved questions

1. **Tethers under the realm driver** (§6.2). Restated: a tether
   redraws a wire every frame, which needs JavaScript on every frame —
   exactly what realm law forbids. CSS anchor positioning is the
   platform feature that would let the browser keep the wire glued
   without any script, but its support is still settling. Until then a
   realm tether can only re-draw at step boundaries — wires jump to
   their new endpoints rather than track the flight. The open call is
   the adoption criterion: which browser support level flips realm
   tethers from jump-at-boundaries to anchor-positioned.
