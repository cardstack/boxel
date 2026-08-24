# The Keynote gap

What Choreo still needs before a presenter could write Keynote in it — as a
language reference: the tags and parameters, what each commits to, and what
already exists. Names are provisional; semantics are the contract. The parent
documents are [choreography.md](choreography.md) (the model) and
[nested-choreo.md](nested-choreo.md) (regions).

The measure is the Build Order demo. It already plays a Keynote build
inspector — `with`/`after` relations, delays, durations, by-word and
by-character delivery, a scrubbable playhead — but as a private, sampled
score in `test-app/app/lib/builds.ts`, outside Choreo. Closing the gap means
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
| Magic Move (slide transition)              | route transition, hand-built on `animateView`    | `@route`, `c.MagicMove` |
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

## Magic Move as a Choreo default — `@route` and `c.MagicMove`

The gallery ⇄ demo transition is built on `animateView`, and
`test-app/app/routes/application.ts` is four hundred lines of what that
costs: a veil timed against the snapshot, rules about what may be named, a
poll for completion, every live animation paused so the compositor survives.
All of it follows from one fact — **a view transition animates bitmaps**.

Choreo's model fits Magic Move better, because Magic Move is a changeset.
A route swap inside a region is one render pass: the old page's participants
are `removed`, the new page's are `inserted`, and an id present on both
sides pairs as a counterpart — the same machinery that already flies a card
between bays. And the shape a Magic Move actually wants — _leaves fade
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
  <c.MagicMove @spring={{glide}} @leave={{180}} @arrive={{220}} @overlap={{0.7}} />
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
| `@route` + `c.MagicMove`        | region + orphan-layer work, then sugar                          | anchors    |

The Build Order demo is the acceptance test throughout: each promotion
deletes a piece of `builds.ts`, and the demo is done being a simulation when
`OPENING` is a `<c.Sequence>`.
