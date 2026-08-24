# More Choreo constructs

The next set of constructs, as a language reference: the tags and
parameters, what each commits to, and what already exists. Names are
provisional; semantics are the contract. Two references keep it honest —
Keynote's build inspector, and bento-boxel's interaction patterns (audited
at the end). The parent documents are [choreography.md](choreography.md)
(the model) and [nested-choreo.md](nested-choreo.md) (regions).

The measure is the Build Order demo. It already plays a Keynote build
inspector — `with`/`after` relations, delays, durations, by-word and
by-character delivery, a scrubbable playhead — but as a private, sampled
score in `test-app/app/lib/builds.ts`, outside Choreo. Closing that distance means
promoting those semantics into the region, so `schedule()` compiles into
Choreo cues and the demo becomes a thin inspector over a real timeline.

## The map

| Keynote                                    | Choreo today                                     | Missing                 |
| ------------------------------------------ | ------------------------------------------------ | ----------------------- |
| Build In                                   | step `@of={{c.inserted …}}`                      | —                       |
| Build Out                                  | step `@of={{c.removed …}}`                       | —                       |
| Action: Move along a path                  | —                                                | `@path`                 |
| Action: emphasis (pulse, jiggle…)          | —                                                | keyframe values         |
| With / After Previous (+ delay)            | block order in `Sequence` / `Parallel`, `@delay` | —                       |
| With / After Build N                       | —                                                | `@name` / `@at` anchors |
| Duration                                   | `@ms` / `@spring`                                | —                       |
| On Click                                   | —                                                | `c.Gate`, `c.advance()` |
| Start automatically after N s              | `@delay` on the first step                       | `@auto` on a gate       |
| Delivery: by object                        | `@stagger` (ms between matched sprites)          | —                       |
| Delivery: by word / character / paragraph  | demo-only (`builds.ts`)                          | `@by`, `@overlap`       |
| Delivery order: forward / reverse / random | —                                                | `@order`                |
| Rehearse / scrub                           | demo-only (Playhead samples its own score)       | the timeline handle     |
| Magic Move (slide transition)              | route transition, hand-built on `animateView`    | `@route`, `c.Crossing`  |
| Builds play backwards on ←                 | free — a changeset reversed is the reverse run   | —                       |

Everything in the right-hand column is specified below.

## Gates — `c.Gate`

Keynote's driver is not time, it is the click: a build order is chunked into
segments and the timeline parks between them.

```gts
<c.Sequence>
  <c.Tween @of={{c.inserted 'title'}} @opacity={{1}} @ms={{300}} />
  <c.Gate />
  <c.Move @of={{c.moved 'card'}} @spring={{soft}} />
  <c.Gate @auto={{800}} />
  <c.Tween @of={{c.inserted 'tag'}} @opacity={{1}} @ms={{400}} />
</c.Sequence>
```

- A `Gate` splits the timeline into **segments**. A run plays to the next
  gate and parks; `c.advance()` (yielded, imperative — wire it to click or
  keys) resumes. `c.segment` is tracked: which segment the cursor is in.
- `@auto={{ms}}` opens the gate itself after the delay — Keynote's "start
  build automatically after".
- Advancing mid-segment **completes the segment instantly** (Keynote's
  click-through), it does not skip it: every property lands on its segment-end
  value, holds included.
- A gate directly inside `Parallel` is a compile error. A pause is a total
  order; only `Sequence` can hold one. (A `Parallel` _between_ gates is fine.)
- Going backwards is not a gate concern. State drives Choreo: reverting the
  state that produced the pass produces the reverse changeset, and the
  natural run back. The cursor only ever moves forward through one pass's
  timeline.

## Anchors — `@name` and `@at`

Block order gives Keynote's "with/after **previous**". The rest of the
inspector — "with/after **build N**" — needs a reference, not a position.

```gts
<c.Sequence>
  <c.Tween @name='tail' @of={{c.id 'tail'}} @pathLength={{1}} @ms={{520}} />
  <c.Tween @name='head' @of={{c.id 'head'}} @pathLength={{1}} @ms={{520}} />
  <c.Tween @at={{at 'head'}} @of={{c.id 'orbit'}} @pathLength={{1}} @ms={{560}} />
  <c.Tween @at={{at 'head' 0.4}} @of={{c.id 'bead'}} @scale={{1}} @ms={{380}} />
  <c.Tween @at={{after 'tail' 200}} @of={{c.id 'rule'}} @pathLength={{1}} @ms={{520}} />
</c.Sequence>
```

- `@name` labels a step. Names are per-region, per-pass; naming two steps the
  same is a compile error.
- `@at={{at name progress?}}` starts the step at the named step's start plus
  `progress` (0–1) of its duration. `@at={{after name delay?}}` starts at its
  end plus `delay` ms. `at 'head' 1` and `after 'head'` are the same moment.
- A step with `@at` is **lifted out of its block's flow**: it does not push
  the sequence forward, and its own end still counts toward the run's length
  (the Build Order rule — `runtimeOf` is `max`, not `last`).
- Progress against a spring resolves the way `Sequence` already follows a
  spring: the duration comes from the engine's generator.
- Forward references are a compile error; anchors point up the score, the
  way Keynote's build list does.

## Delivery — `@by`, `@order`, `@overlap`

`@stagger` (exists today: ms between matched sprites, document order) is
Keynote's "by object". The rest of the delivery panel:

```gts
<c.Tween
  @of={{c.inserted 'word'}}
  @by='character'
  @order='reverse'
  @overlap={{0.55}}
  @opacity={{1}}
  @ms={{760}}
/>
```

- `@by` — `'item'` (default; the sprite is the unit, `@stagger` spaces them)
  | `'word'` | `'character'` | `'paragraph'`. The text values split a text
  sprite's delivery: each slot plays the step's full property change over a
  window of the step's span.
- `@overlap` — each slot's window is `overlap × @ms`, starts distributed
  evenly across the remainder (the demo's `windowOf`, with its 0.55 as the
  default). `@overlap={{1}}` is everyone together; near 0 is strict relay.
- `@order` — `'forward'` (default) | `'reverse'` | `'random'`. Reverse is how
  Keynote builds text out: last word first. Random reseeds per run.
- `@by` text values on a sprite with no text is a compile error; splitting
  happens at measure time and the spans are the region's to own and clean up.
- The whole step still occupies one slot in the timeline — anchors and gates
  see one step, not one per character.

## Paths — `@path`

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

## Emphasis — keyframe values

Pulse, jiggle, blink, flip: effects that end where they began. No new step —
a property value may be a keyframe array, and a round trip is an array that
returns:

```gts
<c.Tween @of={{c.kept 'card'}} @scale={{array 1 1.06 1}} @ms={{420}} />
```

- `PropSource` widens to accept arrays (and functions returning them). The
  engine already speaks keyframes; this only lets a step say them.
- The preset vocabulary (the Build Order demo's `EFFECTS`, plus the
  round-trip set) ships as plain data — importable, inspectable, no
  registration — once the array form exists to express it.

## The timeline handle

Gates, the inspector, and the Playhead demo all want the same object: the
run as a value.

```ts
interface ChoreoRun {
  advance(): void; // open the current gate
  cancel(): void;
  pause(): void;
  play(): void;
  seek(ms: number): void; // scrub; crossing a gate parks there
  readonly duration: number;
  readonly segment: number;
  readonly t: number;
}
```

Yielded as `c.run` (null between passes). `seek` is what the Playhead demo
proves is possible — a scrubbed frame is a still, nothing in flight — and
what it currently rebuilds by sampling a private score. This handle is the
substrate; `Gate` and the Build Order inspector are its first two consumers.

## The crossing — `@route` and `c.Crossing`

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
    <c.Tween @of={{c.removed}} @opacity={{0}} @ms={{180}} />
    <c.Parallel>
      <c.Move @name='flight' @of={{c.received}} @spring={{glide}} />
      <c.Hold @of={{c.received}} @zIndex={{2}} />
    </c.Parallel>
    <c.Tween @at={{at 'flight' 0.7}} @of={{c.inserted}} @opacity={{1}} @from={{hidden}} @ms={{220}} />
  </c.Sequence>
</Choreo>
```

Participants are just ids on both pages — `{{motion id='stage-playhead'
role='stage'}}` on the gallery card and on the demo page — and pairing is
the id, exactly as far matching works today. The canned form:

```gts
<Choreo @route={{true}} as |c|>
  {{outlet}}
  <c.Crossing @spring={{glide}} @leave={{180}} @arrive={{220}} @overlap={{0.7}} />
</Choreo>
```

| arg                         | meaning                                                                                                     | default       |
| --------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------- |
| `@spring` / `@ms` + `@ease` | the flight                                                                                                  | a soft spring |
| `@leave`                    | ms to fade what only the old page had                                                                       | 180           |
| `@arrive`                   | ms to fade what only the new page has                                                                       | 220           |
| `@overlap`                  | arrivals start at this fraction of the flight — "after settle or close to it" is `0.85`; eager is `0.5`     | 0.7           |
| `@crossfade`                | counterpart pairs crossfade old into new over the flight (glyphs cannot morph; two real elements can cross) | on            |
| `@scroll`                   | `'top'` \| `'restore'` \| `(transition) => y` — applied after the swap, before final measure                | `'top'`       |

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

## Build order

| piece                           | state                                                           | depends on |
| ------------------------------- | --------------------------------------------------------------- | ---------- |
| keyframe values in `PropSource` | smallest; unlocks emphasis + presets                            | —          |
| `@name` / `@at` anchors         | compile-time only (`compile.ts` already places cues absolutely) | —          |
| `@by` / `@order` / `@overlap`   | the demo's `windowOf`/`slotOf`, moved into the region           | —          |
| the timeline handle             | pause/seek over the cue list; the Playhead demo is the proof    | —          |
| `c.Gate`                        | segments over the handle                                        | the handle |
| `@path`                         | the one engine-adjacent piece                                   | —          |
| `@route` + `c.Crossing`         | region + orphan-layer work, then sugar                          | anchors    |

The Build Order demo is the acceptance test throughout: each promotion
deletes a piece of `builds.ts`, and the demo is done being a simulation when
`OPENING` is a `<c.Sequence>`.

## The bento-boxel test

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
one flying box is the counterpart crossfade (`@crossfade` should therefore
be a `Move` argument, not only `Crossing` sugar). The `restore()` pattern —
animate forward, `setTimeout`, then commit — inverts under Choreo: commit
first, and the flight is the changeset's.

**Four constructs it needs that nothing above provides:**

### Hot start — a gesture seeds the sprite

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

### Tethers — geometry that follows sprites per frame

The ERD's wires are measured after layout and painted straight into the
SVG, blind while anything moves, with a re-measure "once more late, after
the springs have settled" — an 800ms constant standing in for a fact the
timeline knows. Property functions resolve once, at cue time; a tether is
the continuous version:

```gts
<c.Tether @from={{c.id 'orders'}} @to={{c.id 'customers'}} @draw={{curve}} />
```

Every frame of the run (and at rest), `@draw` receives both sprites'
current boxes and returns path data / properties. This is the construct
Boxel UI will lean on hardest: wires between cards, comment anchors,
selection halos — anything drawn _between_ things that move.

### `c.Scroll` — the scroll container as a step

"Jump to the cited post" is today a 30ms timeout, a `scrollIntoView`, and
an 1800ms timeout to drop the highlight. As a timeline:

```gts
<c.Sequence>
  <c.Scroll @of={{c.id postId}} @block='center' @ms={{420}} />
  <c.Hold @of={{c.id postId}} @outline='var(--cite)' @ms={{1400}} />
</c.Sequence>
```

A `Scroll` step animates the sprite's scroll container so the sprite lands
at `@block`; it occupies the sequence like any step, so "scroll, then
mark" is finally an ordering statement instead of two timers.

### Relative space — flying inside a moving frame

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

## The Pretui test — the realm target

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

### Compile to the platform

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

### Package for the realm

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
(`@by` / `@overlap` / `@order`) compiled by hand today.

## Proving it — demos and contract cases

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

### Demos

Three upgrades and five new pages — each demo is the acceptance test for
exactly the construct it wears:

| demo                                        | construct proven                   | done when                                                                                                            |
| ------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Build Order** (upgrade)                   | anchors, delivery, keyframe values | `OPENING` is a `<c.Sequence>`; `schedule()`, `windowOf`, `slotOf` deleted from `builds.ts`                           |
| **Playhead** (upgrade)                      | the timeline handle                | the scrubber drives `c.run.seek()`; the private sampled score deleted                                                |
| **The gallery ⇄ demo transition** (upgrade) | `@route`, `c.Crossing`             | the `animateView` orchestration in `application.ts` deleted; light mode needs no veil rule                           |
| **Deck** (new)                              | gates                              | a three-build slide advanced by click/key — the mini-Keynote; includes an `@auto` gate and a click-through mid-build |
| **Wires** (new)                             | `c.Tether`                         | an ERD whose boxes reflow on toggle while every wire stays attached mid-spring                                       |
| **Shelve** (new)                            | `c.gesture` hot start              | a card dragged and released anywhere flies to its slot from the release point, at the release velocity               |
| **Zoom** (new)                              | `@space='parent'`                  | a row opens to a detail while its canvas zooms; the composite path is visibly straight at slow tempo                 |
| **Cite** (new)                              | `c.Scroll`                         | "jump to the cited entry": scroll, then a held highlight, as one sequence — no timers in the component               |

`@path` and emphasis need no page of their own: Deck's builds use a path
move and a pulse, which is also how Keynote would.

### Contract cases — the sharp ones

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

**The handle.** `seek(t)` is a still: no animation is running while
paused, at any `t`, including mid-spring. Seek across a gate parks at the
gate. `pause()` then `play()` resumes from the same `t` (pin it). After
`cancel()`, the two invariants.

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

**`c.Scroll`.** The container ends with the sprite at `@block`; the next
step starts only after (it occupies the sequence). A user wheel during
the step cancels it and the run survives — interruption invariants hold.

**`@space`.** The bento assertion, made literal: sample the flight's
page-space midpoint while the parent scales; start, midpoint and end are
collinear within ε.

**All-kept passes.** A pass that inserts, removes and moves nothing
still runs its timeline: a `c.Hold @ms` fires on an event-only change
and releases on schedule — measured against the run clock, not wall
time.

**The native driver.** Beyond the shared suite: a frameloop spy proves
zero engine ticks during steady playback; the sampled `linear()` spring
matches the JS spring within ε at five offsets; a child's `shape()`
stays identity while its parent flies (the pre-sampled counter-scale);
and the realm bundle passes a static scan — no `setTimeout`,
`requestAnimationFrame`, `Date.now`, or `Math.random` in the artifact.

### Test-support additions

The suite needs four helpers to say any of the above:
`advanceGate()` (advance and settle one segment), `seekTo(ms)` (drive a
run's handle from a test), `velocityOf(el)` (two-frame sample), and the
`driver` option on `setupMotion`. The soak extends with a storm mode:
random advance/seek/route-cross against the live gallery, invariants
checked after every blow — the same discipline `interruption-test.gts`
applies today, aimed at the new surface.
