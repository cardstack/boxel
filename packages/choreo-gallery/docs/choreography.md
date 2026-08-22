# Choreography

Region-scoped, changeset-driven animation for glimmer-motion: the part of
Cardstack's legacy `@cardstack/boxel-motion` that Motion's per-element model
does not cover, rebuilt on the motion-dom engine. This document is
self-contained — it records what the legacy package was, what it was reaching
for, what we keep, what we drop, and the API this repo commits to.

- [Goal](#goal)
- [Archaeology: boxel-motion](#archaeology-boxel-motion)
- [What bento-boxel needed it for](#what-bento-boxel-needed-it-for)
- [Keep · adapt · drop](#keep--adapt--drop)
- [API](#api)
- [Semantics](#semantics)
- [Demoable capability](#demoable-capability)
- [Tests](#tests)
- [Phases](#phases)

## Goal

Motion is per-element: every `{{motion}}` declares its own
`initial`/`animate`/`exit`, and what the _screen_ does is emergent. That is the
right model for most UI. It has no answer for the transitions where several
elements have to be read together and moved **as one scene**:

- "fade the closing content out, _then_ move every card, _then_ fade the new
  content in — and push the cards that are not moving behind the one that is
  for exactly that long"
- "the page squeezes toward the tile it came from, the view switches, the tile's
  seat is measured, the clone flies home"
- "this panel's `left` starts at _that_ container's measured width"

Every one of those is hand-built in bento-boxel today with `setTimeout`s that
must silently agree with a spring, `getBoundingClientRect` calls in a service,
and z-index flags cleared in `afterRender`. The goal is a first-class way to
say them, in the template, that rides the same engine as everything else:

1. **A changeset.** A region observes a render pass and hands the animation the
   elements that were inserted, removed, and kept — with their measured bounds
   before and after.
2. **A timeline.** Sequence and parallel blocks of steps, each step naming
   _which_ participants it moves and _how_, with real durations so "after"
   means after — including after a spring.
3. **Z-index as a window, not a flag.** A property held for the span of a block
   and released when the block ends. This is the whole stacking-order story.
4. **Leavers stay for as long as the timeline needs them**, without wrapping
   everything in `<Presence>`.
5. **Bounds are values an author can read**, relative to the region, the
   parent, or the page, so one participant's motion can be computed from
   another's measurement.

## Archaeology: boxel-motion

`packages/boxel-motion` lived in the cardstack/boxel monorepo until commit
`394503e3b7` ("Drop the unused boxel-motion package"); the tree is recoverable
from `394503e3b7^`. About 4,000 lines of addon and a 12-route demo app. It was
an unfinished research project — but every idea in it was extracted from a real
Boxel transition, which is why it is the reference, not a curiosity.

### The model

```
<AnimationContext @use={{this.transition}}>      ← region; a div; hosts the orphans
  <div {{sprite id="card-1" role="card"}}>        ← participant: id for identity, role for grouping
```

- **`AnimationsService`** — one service. A context's render detector (a getter
  consuming `VOLATILE_TAG`, re-evaluated on every render pass _before_ the DOM
  is patched) snapshots every sprite's bounds and computed style, schedules
  `maybeTransition` in `afterRender`, which snapshots again, diffs, and runs a
  `restartableTask` (a new render interrupts and restarts).
- **`AnimationParticipantManager`** — matches removed elements to participants
  by element and inserted ones by `id`; an inserted sprite whose id matches a
  removed one becomes one _kept_ sprite with a **`counterpart`** (the old
  element) — the seed of a cross-fade / clone feature that was never finished.
  Maintained a **`DOMRefNode`** shadow tree so a removed-but-still-animating
  node could be pruned and grafted onto its nearest live ancestor.
- **`Changeset`** — `insertedSprites`, `removedSprites`, `keptSprites`, plus
  `spritesFor({ id?, role?, type? })` / `spriteFor(...)`.
- **`Sprite`** — `id`, `role`, `type: Inserted | Removed | Kept` (an
  `Intermediate` enum member was declared and never used), `element`,
  `initialBounds` / `finalBounds` as **`ContextAwareBounds`** (`element`,
  `parent`, `context` rects; `relativeToContext`, `relativeToParent`,
  `relativeToPosition`), `boundsDelta`, `initialComputedStyle` /
  `finalComputedStyle`, and `initial` / `final` value maps (`x`, `y`, `width`,
  `height`, `top`… as `px` strings, plus every computed style) that steps read
  when no explicit `from`/`to` was given. `lockStyles()` pinned a removed
  sprite at its last bounds with `position: absolute`.
- **Orphans** — a removed sprite's element was re-appended into the context's
  orphan container and locked in place so it could keep animating after
  Glimmer had taken it out of the tree. Cleared at the start of every run.
- **Behaviors** — the _how_ of a step:
  - `SpringBehavior` (stiffness/damping/mass, overshoot clamping, rest
    thresholds; generated frames at 60 fps and carried velocity)
  - `TweenBehavior` (duration + easing: linear, cosine ease-in/out)
  - `StaticBehavior` (hold a value for a duration; **`fill: false` by default**
    → released when its window ends; `fill: true` → stays)
  - `WaitBehavior` (occupy a sprite's timeline with no property at all)
- **`AnimationDefinition`** — the _what_: a timeline tree
  `{ type: 'sequence' | 'parallel', animations: [...] }` whose leaves are
  `{ sprites: Set<Sprite>, properties: { opacity: { from, to } | value },
timing: { behavior, duration?, delay? } }`. Properties without `from`/`to`
  read the sprite's measured `initial`/`final`.
- **`OrchestrationMatrix`** — compiled the tree into one row of frames per
  sprite, column = 1/60 s; sequences append columns, parallels overlay them;
  a step that should not fill had its final frame's property dropped from the
  forward-fill. Transform parts (`translateX`, `scale`…) were re-composed into
  a `transform` string. Played through WAAPI with `easing: linear`.
- **Debugging** — `@debugging` put a dashed border on the context and a dotted
  one on sprites; the transition runner `console.table`d every sprite with
  its type and bounds; the participant manager printed the DOMRef tree with
  ➕/❌ per node.

### The demos (what they proved)

| Route                                                                                    | Transition                   | Idea                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `motion-study`                                                                           | card grid ⇄ expanded card    | **the flagship**: sequence of parallels; fade closing content → move cards + hold z-index layers (closing content 2, cards 1, _non-moving_ cards 0) + **wait** on removed cards → fade new content in. `nonAnimatingCardSprites` filtered by `boundsDelta === 0`. |
| `split-view`                                                                             | sidebar open/close           | one sprite's `left` computed **from another sprite's measured width**; `StaticBehavior({fill:true})` to pin content width                                                                                                                                         |
| `list`                                                                                   | names move between two lists | per-sprite sequence: translate, _then_ resize; `x`/`y` shorthand                                                                                                                                                                                                  |
| `simple-orchestration`                                                                   | one box                      | nested sequence/parallel; spring after tweens                                                                                                                                                                                                                     |
| `routes`                                                                                 | route swap                   | inserted slides in from its final width, removed slides out by its initial width                                                                                                                                                                                  |
| `interruption`                                                                           | ball between targets         | spring interruption carries velocity                                                                                                                                                                                                                              |
| `prune-and-graft` / `removed-sprite-interruption` / `nested-contexts` / `nested-sprites` | —                            | the DOMRef tree: a removed parent animating for 9 s while its child is kept and moved; `counterpart` faded out statically                                                                                                                                         |
| `in-out`                                                                                 | toggle                       | enter / leave pairs                                                                                                                                                                                                                                               |

Carried in the flagship's source:

```ts
// TODO convert to SpringBehavior when its duration can be referenced by other animations
```

They could not sequence _after_ a spring. That is why the flagship uses a
tween where it wanted a spring.

## What bento-boxel needed it for

The port (`/Users/chris/Projects/bento-boxel`) builds these by hand today:

| Site                                 | Shape                                                                                                                                                                                                                  | Legacy twin               |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `workspace.launchDocFlight`          | clone flies tile → page while the page stage squeezes and releases, opacity offset by 12 % / 18 % of `MORPH_MS` — written as raw `style.transition` strings because the stage and the clone could not share a timeline | `motion-study`            |
| `workspace.closeDoc` → `finishClose` | squeeze → wait `MORPH_MS*0.55` → switch view → `afterRender` → **measure the seat** → fly home                                                                                                                         | `routes` + `motion-study` |
| `detail-flight`                      | box magic-moves while two skins cross-fade; canvas zooms "with the same spring"                                                                                                                                        | `split-view`              |
| `build-flight`                       | card → schema node, `bd-hero2-arrive` class held 900 ms                                                                                                                                                                | counterpart               |
| `flight-overlay`                     | release point → shelf slot                                                                                                                                                                                             | `in-out`                  |
| `document-view.restore`              | version comes forward → wait `RESTORE_MS` → becomes the doc → stack re-forms                                                                                                                                           | `simple-orchestration`    |
| `document-view.fold`                 | `folding=true` + `setTimeout(DECK_MS)` purely to keep a leaver alive                                                                                                                                                   | `WaitBehavior`            |

Stacking: `lib/layers.ts` is a good named scale (`ghost … flight`) and stays.
Every _transient_ use of it is a flag plus a timer: `justDropped` cleared in
`afterRender` (with a comment explaining that the z "lingers until the next
render"), `bd-hero2-arrive` 900 ms, `bd-line-hot` 900 ms, `citedId` 1800 ms,
`revealPulse` 1400 ms, `shared` 1600 ms. Measurement: 43
`getBoundingClientRect` calls, 24 of them in the workspace service.

Not choreography: the Build hero recentring, the inheritance-chain magic move,
the shelf sheet — those are `layout=true` + `<Presence>` and stay that way.

## Keep · adapt · drop

**Keep (reference syntax).** Sprite identity (`id`, `role`), the three sprite
types, `spritesFor` selection, `initial`/`final`/`boundsDelta` bounds in
context/parent/page spaces, values defaulting to measured bounds, the
sequence/parallel timeline tree, spring / tween / static (windowed or filled)
/ wait behaviors, orphaning of removed participants, the render detector, the
no-animation-on-first-render rule, restart-on-interrupt, and the debugging
surface.

**Adapt.**

- `@use={{fn}}` → the timeline is declared **in the template** as a block tree
  yielded by the region. The _structure_ of `AnimationDefinition` survives
  exactly; only its host changes.
- Behaviors → motion-dom transitions. A `Spring` step is the engine's spring
  (velocity carried on interruption by `MotionValue`s, not re-measured from a
  paused WAAPI animation); `Tween` is the engine's tween with its easings.
- Frame matrix → a cue list. Steps compile to start offsets and durations; the
  engine runs each value. **Spring durations are computed ahead of time with
  `calcGeneratorDuration`**, so a sequence can follow a spring — the reference
  gets the feature the reference lacked.
- `counterpart` → when an inserted participant's `id` matches a removed one in
  the same pass, the removed element is kept as the kept sprite's
  `counterpart` (orphaned, locked at its old bounds) so a step can cross-fade
  it. This is the legacy intent, finished.

**Drop.**

- The `DOMRefNode` shadow tree and prune-and-graft. Replaced by one rule:
  only the _topmost_ removed participants are orphaned; removed participants
  inside them stay in their subtree and remain addressable.
- Computed-style snapshots of every property on every render. Bounds only;
  non-geometric `from` values come from the engine's current value.
- WAAPI-linear-easing playback, `style-value-types`, ember-concurrency.

## API

### Participants

```hbs
<div {{motion id=card.id role='card' animate=this.box}}>
```

`id` and `role` are two new `{{motion}}` args. A motion element with either
registers with the nearest `<Choreo>` above it. Everything else about the
element — `animate`, `layout`, `drag`, `presence` — is unchanged; a
participant is a normal motion element.

### Region

```hbs
<Choreo @id='cards' @debug={{false}} class='stage' as |c|>
  … participants anywhere below …
  <c.Sequence>
    <c.Parallel>
      <c.Hold @of={{c.role 'card'}} @zIndex={{1}} />
      <c.Hold @of={{c.removed 'card-content'}} @zIndex={{2}} />
      <c.Tween @of={{c.removed 'card-content'}} @opacity={{0}} @ms={{300}} />
    </c.Parallel>
    <c.Parallel>
      <c.Move @of={{c.kept 'card'}} @spring={{SOFT}} />
      <c.Hold @of={{c.still 'card'}} @zIndex={{0}} />
      <c.Wait @of={{c.removed 'card'}} @ms={{300}} />
    </c.Parallel>
    <c.Tween
      @of={{c.inserted 'card-content'}}
      @opacity={{1}}
      @from={{hash opacity=0}}
      @ms={{300}}
    />
  </c.Sequence>
</Choreo>
```

`<Choreo>` renders a `div` (`...attributes`), hosts the render detector and
the orphan layer, and yields `c`:

| yield                                           | legacy                                           | meaning                                                                                                                 |
| ----------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `c.Sequence` / `c.Parallel`                     | `type: 'sequence' \| 'parallel'`                 | timeline blocks; nest freely                                                                                            |
| `c.Tween`                                       | `TweenBehavior`                                  | `@ms`, `@ease`, `@delay`, `@from=(hash …)`, properties as flat args                                                     |
| `c.Spring`                                      | `SpringBehavior`                                 | `@spring=(hash stiffness damping mass bounce visualDuration)`, `@delay`, `@from`, properties                            |
| `c.Move`                                        | `translateX {} translateY {} width {} height {}` | FLIP every kept sprite from its initial bounds to its final; `@spring` or `@ms`/`@ease`; `@size={{false}}` to move only |
| `c.Hold`                                        | `StaticBehavior`                                 | set properties for a window: `@ms`, or the enclosing block's span; `@fill={{true}}` keeps them after the run            |
| `c.Wait`                                        | `WaitBehavior`                                   | `@ms`; keeps the sprites alive and occupies the sequence                                                                |
| `c.all` / `c.kept` / `c.inserted` / `c.removed` | `spritesFor({type})`                             | optional role argument: `(c.kept 'card')`                                                                               |
| `c.role 'card'` / `c.id 'card-1'`               | `spritesFor({role})` / `spriteFor({id})`         |                                                                                                                         |
| `c.still 'card'` / `c.moved 'card'`             | the `boundsDelta` filter from motion-study       | kept sprites whose bounds did / did not change                                                                          |

Any property value may be a **function** `(sprite, changeset) => value`; it is
resolved at run time against the changeset. That is how split-view's
"`left` from the container's width" is written:

```ts
contentLeft = (_s: Sprite, cs: Changeset) =>
  cs.sprite({ id: 'sidebar-container' })!.initial!.context.width;
```

```hbs
<c.Spring @of={{c.id 'sidebar-content'}} @left={{this.contentLeft}} />
```

### Sprite

```ts
interface Sprite {
  id: string | null;
  role: string | null;
  type: 'inserted' | 'removed' | 'kept';
  element: HTMLElement;
  initial?: Bounds; // measured before the render pass (kept, removed)
  final?: Bounds; // measured after it (kept, inserted)
  delta?: { x; y; width; height }; // final − initial, parent-relative
  counterpart?: Sprite; // the removed element an inserted id replaced
}
interface Bounds {
  context: Rect; // relative to the <Choreo> box
  parent: Rect; // relative to the element's offset parent
  page: Rect; // viewport
}
```

`Changeset` carries `inserted`, `removed`, `kept` arrays and `sprites(query)` /
`sprite(query)` with the same `{ id?, role?, type? }` criteria as the legacy
`spritesFor`.

## Semantics

**Trigger.** Each render pass that touches the region: the render detector
snapshots every connected participant (element rect, offset-parent rect) and
the region's own rect _before_ the DOM is patched; in `afterRender` the region
measures again and builds the changeset. A run starts only when the changeset
is _dirty_: something was inserted, something was removed or began leaving a
`<Presence>`, or a kept sprite's bounds changed. The region's own first render
never animates (legacy `isInitialRenderCompleted`).

**Removed participants.** A registered element that is no longer connected
after the pass is _removed_. The topmost such elements are moved into the
region's orphan layer, locked where they were on the page (`position: absolute` against the region's current box, explicit width/height), and keep their
`VisualElement` mounted; `{{motion}}`'s destructor defers the unmount to the
region. A removed sprite lives until the last cue that names it ends (a
`Wait` counts), then its element is dropped and the node unmounted. A removed
participant no step names is released when the run starts. A participant whose
`<Presence>` is leaving is also _removed_, stays where it is (Presence holds
it), and its exit is reported complete to the Presence when its row ends.

**Durations.** `Tween`/`Wait`/`Hold @ms` are explicit. `Spring`/`Move` with a
spring are computed per property with the engine's own generator
(`calcGeneratorDuration`, capped at `maxGeneratorDuration`), max across
properties. A `Hold` without `@ms` spans its enclosing `Parallel`, or the rest
of its enclosing `Sequence`. A `Sequence` is the sum of its children; a
`Parallel` is the max.

**Holds.** At its start a hold records each property's prior engine value,
sets the new one instantly; at its end it restores the prior value, or removes
the value (and the inline style) when there was none. Z-index windows, pointer
lock, visibility and `willChange` are all this.

**Interruption.** A new dirty pass cancels the running timeline: pending cue
timers are cancelled, active holds released, orphans that the new run does not
name are dropped, and value animations are restarted by the engine (springs
carry velocity). Matches the legacy `restartableTask`.

**Coordinate spaces.** `Move` animates in parent space (transform from
`-delta` to 0, size from initial to final) — the element is already in its
final place, so this is FLIP; the width/height it borrows are handed back to the stylesheet when the move ends. Orphans are locked in page space against the region's current box.

**Debug.** `@debug={{true}}` outlines the region and its participants and
`console.table`s each run's changeset (type, id, role, initial, final) and cue
list (sprite, step, start, duration) — the legacy `logChangeset` plus the
timeline the legacy could only print as a matrix.

## Demoable capability

A new **Choreography** group in the test-app gallery:

1. **Motion study** — the legacy flagship, verbatim in intent: a grid of cards;
   tap one and it expands to the stage while the others make room; closing
   content fades _first_, the cards move _then_ (with the non-moving ones held
   behind and the removed card held for the fade), the new content fades in
   _last_. With a spring on the move — the thing the legacy could not do.
2. **Split view** — a panel whose content's `left` is computed from the
   container's measured width; the content's width pinned by a filled hold.
3. **Lists** — names crossing between two lists with a move-then-resize
   sequence per sprite, orphaned leavers sliding out.

Each is a catalogue entry with its template excerpt shown beside it, like the
existing demos.

## Tests

`test-app/tests/integration/choreo/`:

- **changeset** — inserted / removed / kept classification; `role` and `id`
  queries; `still` / `moved`; no run on the region's first render; no run on a
  clean pass
- **orphan** — a removed participant stays in the DOM, locked at its last
  bounds, for exactly its row; is dropped at the end; a nested removed
  participant is not orphaned separately; a removed participant nobody names
  goes at once
- **move** — FLIP from initial to final, with a spring whose duration is
  pre-computed; `still` sprites do not move
- **hold** — sets at start, releases at end, restores a prior value, keeps
  with `@fill`; spans a parallel / the rest of a sequence when `@ms` is
  omitted
- **sequence** — offsets accumulate, including after a spring; parallels
  overlay; `Wait` extends a removed sprite's life
- **values** — a function property resolves against another sprite's bounds;
  `@from` applies before the delay
- **presence** — a leaving `<Presence>` child is a removed sprite and its exit
  completes when its row ends
- **interruption** — a second dirty pass cancels timers, releases holds, and
  does not strand orphans
- **counterpart** — an inserted id matching a removed one carries the old
  element as `counterpart`

## Phases

1. **Framework** (this change): `id`/`role` on `{{motion}}`; `<Choreo>` with
   snapshot, changeset, orphans, bounds; the seven step components and the
   selectors; compilation and execution on motion-dom; Presence completion;
   debug output; tests; the three gallery demos; README section.
2. **bento-boxel**: convert `closeDoc`/`launchDocFlight` (the proving case —
   it needs every feature), then `detail-flight`, `document-view.restore` /
   `fold`, and retire the six timed z-index flags behind `Hold`s.
3. **Later**: `counterpart` cross-fade helper step; a `c.scrub` for
   scroll-driven timelines; per-sprite `onStart`/`onComplete` hooks.
