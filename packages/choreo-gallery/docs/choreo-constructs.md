# Choreo constructs

|                |                                                                           |
| -------------- | ------------------------------------------------------------------------- |
| **Status**     | Implemented — `choreo/constructs`; demo coverage follows (§7)             |
| **Start date** | 2026-08-25                                                                |
| **Package**    | `glimmer-motion` (the Choreo layer)                                       |
| **Drivers**    | frameloop ✅ · native WAAPI/CSS realm target ☐ (§6.2)                     |
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

Choreo is a recordable choreography language over a region-scoped
changeset: gates that park a run for input, anchors that start a step
against any other, the delivery panel for by-word and by-character
builds, motion paths, keyframe values, a playback handle shaped like
Motion's controls, and a set of scene constructs — the crossing (route
transitions as changesets), the raise (a real elevated layer), the
camera (the region's frame as a step), tethers, scrolls, and the
gesture as a first-class geometry source. A native WAAPI/CSS driver
will compile the same language for environments that forbid JavaScript
clocks (§6.2).

One rule organises all of it: **if it should scrub, it must be on the
timeline.** Everything here exists to make whole scenes — including
route transitions — replayable from a cue list.

The names are settled: ef4's step names carry forward (`Tween`,
`Spring`, `Hold`, `Wait`), the route transition is the _crossing_,
and every duration in the language is seconds, as in Motion. Five
measuring sticks keep the design honest, each with its audit in §6:
Keynote's build inspector, bento-boxel's interaction patterns,
Pretui's realm law, the Boxel System V16 concept deck, and the
boxel-labs surfaces research.

## 2. Motivation

The measure is the Build Order demo. It plays a Keynote build
inspector — `with`/`after` relations, delays, durations, by-word and
by-character delivery, a scrubbable playhead — and the language now
carries every one of those semantics natively. The demo pass (§7)
finishes the thought: the inspector becomes a thin surface over a real
timeline, and its private sampled score in `test-app/app/lib/builds.ts`
is deleted.

### 2.1 The Keynote map

| Keynote                                    | Choreo                                            |
| ------------------------------------------ | ------------------------------------------------- |
| Build In                                   | a step `@of={{c.inserted …}}`                     |
| Build Out                                  | a step `@of={{c.removed …}}`                      |
| Action: move along a path                  | `@path` (+ `@rotate`)                             |
| Action: emphasis (pulse, jiggle…)          | keyframe values                                   |
| With / After Previous (+ delay)            | block order in `Sequence` / `Parallel`, `@delay`  |
| With / After Build N                       | `@name` / `@at` anchors                           |
| Duration                                   | `@duration` / `@spring`                           |
| On Click                                   | `c.Gate`, `c.advance()`                           |
| Start automatically after N s              | `@delay` on a gate                                |
| Delivery: by object                        | `@stagger`                                        |
| Delivery: by word / character / paragraph  | `@by` (+ `@stagger`)                              |
| Delivery order: forward / reverse / random | `@order`                                          |
| Rehearse / scrub                           | the run handle — `c.run.time`                     |
| Magic Move (slide transition)              | `@route` + `c.Crossing`                           |
| Builds play backwards on ←                 | free — a changeset reversed is the reverse run    |

## 3. The language, complete

The whole surface in one place. §4 and §6 carry each construct's
semantics; this is the index.

### 3.1 Region

`<Choreo @id @debug @route @scroll>` — hosts the participants, the
orphan layer (leavers) and the elevated layer (`c.Raise`), watches its
render passes, yields `c`. Participants are `{{motion id= role=}}`
elements. A pass whose changeset is all-kept still runs its timeline.
`@route` treats a route swap inside the region as one pass; `@scroll`
(`'top'` or a thunk returning a scroll position) is applied inside
that pass, before final bounds are measured.

### 3.2 Queries — every geometry source a step can name

Usable anywhere a step wants sprites or a box: `@of`, `@from`, `@to`,
`@origin`, `@steady`.

| query                                                   | matches                                                        |
| ------------------------------------------------------- | -------------------------------------------------------------- |
| `c.all` / `c.kept` / `c.inserted` / `c.removed` (role?) | by changeset type                                              |
| `c.role 'x'` / `c.id 'x'`                               | by identity                                                    |
| `c.still` / `c.moved`                                   | kept, split by bounds delta                                    |
| `c.received` / `c.counterpart`                          | the two halves of a counterpart match, far match included      |
| `c.beacon 'x'`                                          | a named box that is never a participant                        |
| `c.gesture`                                             | the live drag: its box seeds a `Move`'s `@from`, its velocity flows into any spring that moves it |

### 3.3 Blocks

`c.Sequence` · `c.Parallel` · `c.Gate` (`@delay` to self-open;
advanced by `c.advance()`; splits the run into segments; a compile
error inside `Parallel`).

### 3.4 Steps

Ten steps, keeping ef4's names — `Tween`, `Spring`, `Hold`, `Wait`
descend from boxel-motion's behaviors (§5.1). Every animating step
reads _who · what · how long_, position in the block gives _when_, and
every duration in the language is **seconds**, as in Motion.

| step         | reads as                                                                                                                                                                                                |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `c.Tween`    | animate properties: `@of`, flat property args (numbers, keyframe arrays, functions), `@duration` + `@ease`; `@delay`; `@repeat` + `@repeatType`; delivery via `@by` `@order` `@stagger`                 |
| `c.Spring`   | the same, driven by `@spring` instead of `@duration` + `@ease`                                                                                                                                          |
| `c.Move`     | FLIP the measured delta: `@spring` or `@duration` + `@ease`, `@size`; `@from`/`@to` take a beacon or `c.gesture`; `@path` + `@rotate`; `@space`; `@swap='during' \| 'settle' \| 'none'` for the counterpart skins |
| `c.Hold`     | set properties for a window and release: `@duration` or the block's span, `@fill`; with no properties it is a pure wait                                                                                  |
| `c.Raise`    | promote to the region's elevated layer for the block's span (or `@duration`); `@shadow`                                                                                                                 |
| `c.Camera`   | the region's frame: `@zoom` `@x` `@y`, `@origin` aiming at a sprite; `@steady={{query}}` names sprites that keep their size (damped by default)                                                          |
| `c.Scroll`   | animate the sprite's scroll container to `@align`; occupies the sequence                                                                                                                                |
| `c.Tether`   | `@from` `@to` `@path` — geometry continuously derived from sprites, redrawn every frame and every still                                                                                                  |
| `c.Gate`     | park the run until `c.advance()`; `@delay` opens it by itself                                                                                                                                           |
| `c.Crossing` | the canned route transition: `@spring` (or `@duration` + `@ease`), `@leave`, `@arrive`, `@overlap`, `@swap`                                                                                              |

### 3.5 Timing

Block order and `@delay`; `@name` / `@at` with `at()` / `after()`
anchors; every duration resolves through the engine's generator, so
"after a spring" is exact.

### 3.6 The run

`c.run` wears Motion's `AnimationPlaybackControls` shape: settable
`time` (seconds) and `speed`, `duration`, `play` / `pause` / `cancel` —
plus the words Motion has no need for: `advance()`, tracked `segment`,
and `parked`. `c.advance` is the one template-level alias, because
gates are wired in templates. One language, two drivers: the frameloop
plays it today; the native WAAPI/CSS target (§6.2) will play the same
compiled cues.

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
  keys) resumes. `c.run.segment` is tracked: which segment the cursor is in.
- `@delay` opens the gate by itself after that many seconds — Keynote's
  "start build automatically after".
- Advancing mid-segment **completes the segment instantly** (Keynote's
  click-through), it does not skip it: every property lands on its segment-end
  value, holds included.
- A gate directly inside `Parallel` is a compile error. A pause is a total
  order; only `Sequence` can hold one. (A `Parallel` _between_ gates is fine.)
- A parked run is settled: nothing is in flight while it waits, and
  `animationsSettled()` resolves through a park.
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

`@stagger` (seconds between matched sprites, in the order the query
returned them) is Keynote's "by object". The rest of the delivery panel:

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
  offsets; when `@stagger` is omitted, the window defaults to 0.55 of
  the span and the spacing is derived from it. `0` is everyone
  together; large is strict relay.
- `@order` — `'forward'` (default) | `'reverse'` | `'center'` |
  `'random'`. Reverse is how Keynote builds text out: last word first.
  Random takes a seed on the realm build (§6.2).
- `@by` text values on a sprite with no text is a compile error;
  splitting happens at measure time and the spans are the region's to
  own and clean up — the split preserves Glimmer's own text nodes, so
  tracked updates survive it.
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
  from where the object stands. The path is similarity-mapped onto the
  measured delta, so its start is the sprite's start and its end is the
  landing: the path bends the journey, never the destination.
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

- Any property accepts an array (or a function returning one). A spring
  takes exactly two keyframes — start and target — because a spring is
  physics toward a value, not a schedule through several.
- The engine already speaks keyframes; the step just says them. A preset
  emphasis vocabulary (pulse, jiggle, blink, the round-trip set) is plain
  data — importable, inspectable, no registration.

### 4.6 The run — `c.run`

Gates, the inspector, and the Playhead demo all want the same object: the
run as a value.

```ts
interface ChoreoRun {
  advance(): void; // open the current gate; mid-segment, complete it and park
  cancel(): void;
  pause(): void;
  play(): void;
  time: number; // settable, seconds — scrub; crossing a gate parks there
  speed: number; // 1 = normal, 0.5 = half, as Motion's controls
  readonly duration: number; // seconds at 1×, gates included
  readonly segment: number; // which gate-bounded segment the clock is in
  readonly parked: boolean; // standing at a gate — a still, and settled
  finished: Promise<void>;
}
```

Yielded as `c.run` (null between passes), wearing Motion's
`AnimationPlaybackControls` shape. A scrubbed frame is a **still**:
while the run is paused, every value is computed and placed — nothing
is in flight at any `time`, including mid-spring. `Gate` and the Build
Order inspector are this handle's first two consumers.

### 4.7 The crossing — `@route` and `c.Crossing`

A route transition is a changeset. A route swap inside a region is one
render pass: the old page's participants are `removed`, the new page's
are `inserted`, and an id present on both sides pairs as a counterpart —
the same machinery that already flies a card between bays. Nothing is
snapshotted, so live content keeps running through the move, real boxes
crossfade instead of stretched bitmaps, the timeline knows its own end,
and the tempo control composes for free. And the shape a crossing
actually wants — _leaves fade first, then everything moves, then
arrivals fade in near settle_ — is a sentence the timeline speaks
directly:

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
<Choreo @route={{true}} @scroll='top' as |c|>
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

Scroll belongs to the region, not the step: `<Choreo @scroll>` takes
`'top'` or a thunk returning a position (scroll restoration is the
host's thunk, from wherever it keeps its history).

What `@route` adds, beyond sugar:

1. **Scroll inside the pass.** The window is placed after the route
   renders and before final bounds are measured — scroll is part of the
   move, so the flight lands where the page will actually stand.
2. **Whole-subtree leavers.** The orphan layer holds a page's worth of
   removed participants, not a row's.
3. **Route awareness.** The tempo control's zero means no run at all —
   zero cues, not a zero-length run. Suppressing non-animated changes
   (query params) is the host's job: a pass rendered identically simply
   produces no changeset (§9).

`animateView` remains the right tool where snapshotting is the point:
cross-document transitions (MPA), and freezing a page too expensive to
keep live. Same-document navigation defaults to `@route`.

### 4.8 Constructs specified with their evidence

Six constructs are specified inside the audit that produced them, and
indexed in §3: the hot start and `c.gesture` (§6.1), `c.Tether` (§6.1,
§6.4), `c.Scroll` (§6.1), `@space` (§6.1), `c.Raise` (§6.3), `c.Camera`
with `@steady` and `@fit` (§6.3, §6.4), and the `@swap` policy (§6.3).

## 5. Design rationale

### 5.1 As simple as it gets

The surface was audited the way the constructs were: hunt the
redundancy. Every knob that remains carries information no other knob
carries.

**One spacing knob.** Given a step's span and its slot count, the time
between starts determines each slot's window — so delivery has exactly
one spacing argument, `@stagger`, because time-between-starts is the
one an author can hear. The 0.55-of-span window is derived, never
asked for.

**One skin policy.** Everything about the counterpart's two renderings
is a single argument with three values: `@swap='during'` (cross
mid-flight, the default), `'settle'` (carry the old skin whole, swap
on landing), `'none'`.

**Camera policy lives on the camera.** Which sprites hold their size
against a zoom is the timeline's decision, so it is an argument on the
step — `c.Camera @steady={{c.role 'focus'}}` — never an attribute on a
participant. The seam (§5.3) stays clean in both directions: the
timeline is the only authority.

**ef4's names are kept whole.** `Tween`, `Spring`, `Hold` and `Wait`
descend from boxel-motion's behaviors (`TweenBehavior`,
`SpringBehavior`, `WaitBehavior`) — the second-generation design this
whole model carries forward. A tighter surface was possible — one
interpolating step for tween and spring, the wait folded into a
property-less hold — and was declined: the equivalences are true and
worth knowing (`Spring` is `Tween` with a generator for a clock;
`Hold` with no properties waits), but the lineage is worth more than
one step fewer.

What remains is irreducible, and each piece earns its place: the
queries are the changeset (the model itself), the blocks exist because
`Hold`, `Raise` and gates need a _span_ to scope to (a flat with/after
list — Keynote's own shape — cannot say "for the duration of these
three steps"), the anchors are two helpers that read as English, and
each step names a genuinely different mechanism. Ten steps, two
blocks, ten queries: an author who knows _who · what · how long_ can
read all of it.

### 5.2 One vocabulary — the naming rules

Three audiences read this language: authors of these templates, people
(and models) who already know motion.dev, and Ember developers raised
on the ecosystem's patterns. Four rules serve all three:

1. **A name has one type and one meaning everywhere.** `@from` / `@to`
   are geometry (a beacon, a sprite, the gesture) on every step that
   takes them; a property's start and end belong in its value, as a
   keyframe array (`@opacity={{array 0 1}}`). `@path` is path data on
   both `Move` (a string to travel) and `Tether` (a function to draw).
2. **A step's name is reserved.** `c.Hold` the step means no argument
   is called `@hold` — the camera's exempt sprites are `@steady`, the
   crossing's own word for "same on both sides"; the scroll alignment
   is `@align`; timeline blocks own the word "block".
3. **Durations are one word and one unit.** `@duration`, in seconds. A
   gate that opens by itself is a `@delay` — the same word every step
   uses for time-before-start.
4. **Playback lives on the run**, shaped like Motion's controls;
   `c.advance` is the sole template alias.

#### The motion.dev alignment

The binding keeps Motion's names 1:1 (`initial`, `layout`,
`stiffness`, `visualDuration`…), and the timeline holds the same line
wherever a concept overlaps — a reader who knows Motion never relearns
a name, and a divergence always means a genuinely new concept:

| concept                     | motion.dev                                                     | Choreo                                                                                                                                                 |
| --------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| duration / delay            | seconds                                                        | same — `@duration` / `@delay`, seconds                                                                                                                 |
| spring spec                 | `stiffness` `damping` `mass` `bounce` `visualDuration`         | identical, same engine                                                                                                                                 |
| easing                      | named / cubic-bezier array                                     | identical — `@ease`                                                                                                                                    |
| keyframes                   | value arrays                                                   | identical, as property values                                                                                                                          |
| repeat                      | `repeat` count + `repeatType: 'loop' \| 'reverse' \| 'mirror'` | identical pair                                                                                                                                         |
| sequence labels             | `at: 'label'`                                                  | `@name` + `@at={{at 'label' 0.4}}` — same concept, typed helpers instead of the string micro-DSL (`"<"`, `"+0.5"`), which Glint cannot check           |
| stagger                     | `stagger(0.1, { from: 'first' \| 'last' \| 'center' })`        | `@stagger` seconds; `@order` adds `'center'` alongside `'forward'` / `'reverse'` — order and origin are the same idea for a line — and seeded `'random'` |
| playback controls           | `time` (settable, s), `speed`, `duration`                      | identical, plus `advance()` / `segment` / `parked` for gates                                                                                           |
| what Motion has no word for | —                                                              | changesets, roles, beacons, the gesture, gates, camera, tether, raise, crossing — new concepts, new words                                              |

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
into the third generation.

### 5.3 The seam with the binding

The reason to draw this line sharply is the recording rule:

> **If it should scrub, it must be on the timeline.** A recorded run can
> only replay what its cue list names. Anything that schedules itself —
> an `animate=` firing off a tracked getter, a `<Presence>` exit, a
> `layout` spring — happens _beside_ the timeline, and a seek cannot
> place it. The Playhead demo is the proof by construction: it scrubs
> precisely because nothing in it self-schedules.

So: where does `{{motion}}` sit? Inside a region its job narrows to
what a timeline cannot own.

**The modifier keeps, everywhere:** identity (`id` / `role`), style
custody (`style=` through the modifier — rule 1 is unchanged), and the
input-driven states: `drag`, `whileHover` / `whileTap` / `whileFocus`,
pan handlers. A hover has no duration and a drag has no cue — they are
unscrubbable by nature, and they stay element-owned (this is the same
line the surfaces research drew). Their _consequences_ re-enter the
timeline: a release is `c.gesture`, a focus change fires an all-kept
pass.

**Inside a region, the timeline is the only scheduler.** `initial` /
`animate` / `exit` / `variants` on a participant would be a second
scheduler competing with the run, so every one of them has a `c.`
spelling: entrances are `c.Tween @of={{c.inserted}}`, exits are steps
over `c.removed`, animate-on-state-change is a step in an all-kept
pass, variants with `staggerChildren` are delivery (`@by` /
`@stagger`), and an ambient loop is `@repeat` — whose phase rides the
run clock, so it scrubs and records. In `@debug`, a participant
carrying its own animation authority warns.

**`<Presence>` does not overlap — it partitions.** Inside a region it
is redundant by design: leavers are the region's own, kept alive
exactly as long as the timeline names them — a real layer doing what
`popLayout` reaches for — and a `<Presence>` wrapped around
participants double-retains them (that warns, scoped precisely: only
when the wrapped items are participants of the enclosing region). A
`<Presence>` for non-participant micro UI that merely lives inside a
region's DOM is legitimate. Outside any region, `<Presence>` remains
the light tool for micro enter/exit — menus, toasts, tooltips, the
surfaces `Lift`'s world — where a timeline would be ceremony. `wait`
is a two-step `Sequence`, `sync` is a `Parallel`; if a scene grows
enough to want those words, it has grown into a region.

**`layout` / `layoutId` overlap `c.Move` — and the region wins.** They
are the same FLIP on the same projection engine; the difference is
authority. `layout=true` re-decides on every render, self-scheduled and
off the record; `c.Move` is a cue. On a participant, `layout` is the
two-engines-on-one-element hazard — so participants do not carry
`layout`; the timeline moves them. `layoutId` / `<LayoutGroup>` remain
fully in force outside regions (emergent scenes like a filtered grid
that nobody needs to scrub) and _underneath_ everything — the
projection tree is the engine `c.Move` rides; the region replaces its
scheduler, not its math.

## 6. Evidence — the audits

### 6.1 The bento-boxel test

`bento-boxel-choreo` is the phase-2 conversion target, and today it imports
`{{motion}}` only — every scene is still a service holding measured rects, a
portal overlay flying a clone, and `setTimeout`s that must silently agree
with the springs. Auditing its interaction patterns against this language:

**Already answered.** The shelf fly-down (release point → tray slot) is a
far match: the card leaves the canvas region and arrives in the shelf
region, one id, and `endDrag` is already shaped like a pass — commit, render,
measure, fly. The staged/dragging z-index arithmetic is `c.Hold`. The
version deck's fold-away — "has to outlive the state that raised it" — is
what leavers are for. The row ⇄ detail transmute's two skins crossing over
one flying box is the counterpart-skin policy — `@swap`, on `Move`
itself. The `restore()` pattern — animate forward, `setTimeout`, then
commit — inverts under Choreo: commit first, and the flight is the
changeset's.

**Four constructs this audit produced:**

#### Hot start — a gesture seeds the sprite

The fly-down starts from wherever the finger let go, at whatever speed it
was moving — not from the sender's resting box. A participant that is being
dragged when a pass fires contributes its live pose as its `initial`,
and its pointer velocity to any spring that moves it:

```gts
<c.Move @of={{c.received 'card'}} @from={{c.gesture}} @spring={{toss}} />
```

`c.gesture` rewrites `initial` the way `c.beacon` does, from the drag
session instead of a box; velocity flows into the spring the way Motion's
own drag-to-`layout` handoff works within one element. Without this,
every drop flight keeps its measuring service.

#### Tethers — geometry that follows sprites per frame

The ERD's wires are measured after layout and painted straight into the
SVG, blind while anything moves, with a re-measure "once more late, after
the springs have settled" — an 800ms constant standing in for a fact the
timeline knows. Property functions resolve once, at cue time; a tether is
the continuous version:

```gts
<c.Tether @from={{c.id 'orders'}} @to={{c.id 'customers'}} @path={{curve}} />
```

Every frame of the run (and every scrubbed still), `@path` receives both
sprites' current boxes and returns path data. This is the construct
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
mark" is finally an ordering statement instead of two timers. A user's
wheel during the step wins: the scroll cancels, the run survives.

#### Relative space — flying inside a moving frame

The detail transmute zooms the canvas with the same spring as the flight
"so the composite path stays straight" — a coincidence of constants doing
the work of a coordinate system. A step can say which space its bounds
mean: `@space='parent'` resolves the sprite's motion against its
(possibly animating) container, page space remaining the default. This
is the same requirement nested timeline sync has, met at the step level.

**And one rule stated plainly:** a pass whose changeset is all-kept
still runs its timeline. The share badge and the hot wire are a
`c.Hold` with a lifetime, triggered by an event that inserts, removes
and moves nothing — the timeline fires anyway, measured against the run
clock, not wall time.

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
of it than Choreo has. It is blocked on the clock. The gap is a runtime
target, not constructs:

#### Compile to the platform

`glimmer-motion`'s own source contains no `requestAnimationFrame`; every
frame is scheduled through motion-dom's batcher, and motion-dom already
exports the way out: `startWaapiAnimation`, `generateLinearEasing` (a
spring sampled into a CSS `linear()` easing), `calcGeneratorDuration`,
`supportsScrollTimeline`. Choreo's compiler already reduces a timeline
to absolute cues — at, duration, ease, properties — which is precisely
WAAPI's input. The missing piece is the back half: a **native compile
target** that turns a pass's cues into WAAPI/CSS animations at render
time, springs pre-sampled through the generator, with JavaScript
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
**camera motion** — and this language speaks all three. What the deck
confirms, and the two constructs it added:

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
one plane, otherwise reserved for the dead.

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
"focus boxels stay the same size" — damped by default (§6.4). This is
the construct `@space` was circling: `@space='parent'` resolves a
flight _inside_ a moving frame, `c.Camera` is what _drives_ the frame,
and the Zoom demo proves them together. The deck's second half adds the
coupling to watch: past a zoom threshold a boxel _transmutes_ to a
smaller form — camera state feeding the next changeset. The region
exposes it as a tracked `c.camera` (`{ zoom, x, y }`), updated when a
camera step lands or cancels — deliberately not per frame, so deriving
app state from it cannot violate the recording rule (§9).

Shipped, the construct grew two refinements the Camera demo forced. The
applied transform is `translate(x + (1−z)·P) scale(z)` with the origin
pinned at `0 0` — frozen numbers, no per-frame DOM reads — which makes
`@origin` a point that HOLDS its own screen position while the zoom
happens: right for a pinch, wrong for the far more common "dive on this
tile and centre it". `@fit` is that case as one argument: name a sprite
(or pass `null` for the resting identity) and the library computes the
zoom from `@margin` — the sprite's share of the frame on whichever axis
fits first — and the pan that solves `x + P = centre`, all from the
changeset's rest-layout boxes divided back by `measureZoom`. That is
the measurement space FLIP already uses, so a dive begun mid-flight on
a different tile is correct by construction
(`docs/camera-api-wishlist.md` is the case study). And a cue with no
origin of its own holds the aim point in force rather than recentring —
backing out of a dive backs straight out of its tile, instead of
sliding across the neighbouring one mid-flight.

#### `@swap='settle'` — the transmute's crossfade policy

Lift-and-place states it exactly: "the focused boxel retains its 2D
rendering throughout, just scaling the bitmap through the lift and place
journey. After placing into new flow, it should re-render and reflow."
The counterpart crossfade is a policy argument: `@swap='during'`
(both skins cross mid-flight — the detail transmute) or
`@swap='settle'` (the old rendering is carried whole and the swap
happens at landing — the lift). One word for a decision every flight
makes.

#### The hierarchy, as a lint

The deck's Motion Hierarchy rule is quantitative: **primary** — one, at
most two, focused boxels transmute; **secondary** — the tray carries;
**tertiary** — everything else fades or slides, because "abrupt
disappearance of any boxel element during scene transition leads to
uncanny valley where the world doesn't feel spatially and physically
real." Choreo enforces the floor of that: in `@debug`, a removed
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
the canvas vendors xyflow's drag whole. Choreo respects that line, not
absorbs it: nothing here extracts a drag state machine. What the
research hands over is what happens at the seams.

**`c.gesture` is a query, not a `Move` argument.** The research shows
the same value composing everywhere a box goes. Today it seeds the
release flight — `c.Move @from={{c.gesture}}` (the ghost's landing,
bento's fly-down) — and the same query has two more consumers waiting:
`c.Tether @to={{c.gesture}}` (the canvas's connect-drag: a wire drawn
from a handle to the pointer until release pairs it to a real sprite)
and a camera that follows a drag near the viewport's edge (xyflow's
auto-pan, today a JS loop). Those two extractions ride the demo pass;
the query is already the region's.

**The damped counter-scale.** `relative-scale.ts` is finished research
into exactly `c.Camera`'s `@steady` problem: secondary UI in a zooming
world should scale _with_ the host but not 1:1 — asymmetrically damped
(`pow(z, 0.30)` zoomed out so it stays readable, `pow(z, 0.70)` zoomed
in so it doesn't feel stuck), clamped to `[0.85, 1.8]`. These curves
are `@steady`'s damped default. The deck said "focus boxels stay the
same size"; the research measured what the eye actually tolerates.

**Escalation is a crossing.** `boxel-surface`'s `<Lift>` is a
semantic anchored surface — kind, placement (`attached` / `shadow` /
`plane`), backdrop, elevation tier, and an escalation ladder (preview →
plane). Today each rung enters through its own CSS keyframe
(`bx-lift-in`, `bx-lift-plane-in`) and escalation is an unmount and a
fresh mount — no continuity between rungs. That is a counterpart flight
by construction: same content, two placements, one identity. The
surfaces `Lift` should eventually _ride_ Choreo's step rather than the
other way round. The naming is settled (§9): the step is `c.Raise`,
and the component keeps `Lift` — product and mechanism of the same
idea, one word each.

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

| piece                           | state                                                                                                                                  | depends on |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| keyframe values in `PropSource` | ✅ landed — springs take exactly two                                                                                                   | —          |
| `@name` / `@at` anchors         | ✅ landed, with the compile-time errors named                                                                                          | —          |
| `@by` / `@order` / `@stagger`   | ✅ landed — text splits restore byte-identical; slots ride WAAPI                                                                       | —          |
| the timeline handle             | ✅ landed — settable `time`/`speed`, computed stills, parked-is-settled                                                                | —          |
| `c.Gate`                        | ✅ landed — exclusive boundary, click-through, `@delay` self-open                                                                      | the handle |
| `@path`                         | ✅ landed — similarity-mapped, closure by construction; `@rotate`, `@swap` with it                                                     | —          |
| `c.gesture` / `@space`          | ✅ landed — hot starts with thrown velocity                                                                                            | —          |
| `c.Raise` / `c.Scroll`          | ✅ landed — the elevated layer with a slot-holding placeholder; wheel yields                                                           | —          |
| `c.Camera` / `c.Tether`         | ✅ landed — damped `@steady`, tracked `c.camera` at boundaries, post-render wires                                                      | —          |
| `@route` + `c.Crossing`         | ✅ landed at the library — scroll inside the pass, tempo-zero no-run, the canned sequence; the app-chrome migration is the demo pass's | anchors    |
| the seconds unit                | ✅ landed — the language, the gallery and the contract suite all speak seconds                                                         | —          |
| `@debug` lints / test helpers   | ✅ landed — unclaimed-leaver, own-animation, Presence-in-region; `advanceGate` / `seekTo` / `velocityOf`                               | —          |
| the native (realm) driver       | ☐ separate effort (§6.2) — the language compiles to cues either driver plays                                                           | —          |

The Build Order demo remains the acceptance test for the second pass:
each promotion deletes a piece of `builds.ts`, and the demo is done being
a simulation when `OPENING` is a `<c.Sequence>`.

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
   component; the promote-to-the-region's-layer step takes the free
   name. One word each for product and mechanism.
2. **Durations are seconds, one word.** `@duration` and `@delay` carry
   seconds everywhere, as Motion counts them; the language, the
   gallery, and the contract suite all speak the same unit.
3. **`@route` stays router-agnostic.** A route swap is recognised
   purely as a render pass inside the region; there is no
   router-service hook. Scroll intent is the host's to supply
   (`@scroll` takes `'top'` or a thunk — restoration is the host's
   thunk, from wherever it keeps its history), and suppressing
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
