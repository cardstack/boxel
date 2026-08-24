# Choreography

Region-scoped, changeset-driven animation: the part of the problem Motion's
per-element model does not cover, built on the motion-dom engine. This is the
reference for what `<Choreo>` is and what it commits to.

- [Goal](#goal)
- [API](#api)
- [Semantics](#semantics)
- [Tests](#tests)

Nested regions and beacons: [nested-choreo.md](nested-choreo.md).

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

Each of those is otherwise hand-built: `setTimeout`s that must silently agree
with a spring, `getBoundingClientRect` calls in a service, and z-index flags
cleared in `afterRender`. The goal is a first-class way to say them, in the
template, riding the same engine as everything else:

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
the orphan layer, and yields `c`. A `{{motion}}` joins the nearest region;
an inner `<Choreo>` is a separate scene. How they nest, and how a beacon
shares one measurement across that boundary:
[nested-choreo.md](nested-choreo.md).

| yield                                           | legacy                                           | meaning                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `c.Sequence` / `c.Parallel`                     | `type: 'sequence' \| 'parallel'`                 | timeline blocks; nest freely                                                                                                                                                                                                                                                                                  |
| `c.Tween`                                       | `TweenBehavior`                                  | `@ms`, `@ease`, `@delay`, `@from=(hash …)`, properties as flat args                                                                                                                                                                                                                                           |
| `c.Spring`                                      | `SpringBehavior`                                 | `@spring=(hash stiffness damping mass bounce visualDuration)`, `@delay`, `@from`, properties                                                                                                                                                                                                                  |
| `c.Move`                                        | `translateX {} translateY {} width {} height {}` | FLIP every kept sprite from its initial bounds to its final; `@spring` or `@ms`/`@ease`; `@size={{false}}` to move only                                                                                                                                                                                       |
| `c.Hold`                                        | `StaticBehavior`                                 | set properties for a window: `@ms`, or the enclosing block's span; `@fill={{true}}` keeps them after the run                                                                                                                                                                                                  |
| `c.Wait`                                        | `WaitBehavior`                                   | `@ms`; keeps the sprites alive and occupies the sequence                                                                                                                                                                                                                                                      |
| `c.all` / `c.kept` / `c.inserted` / `c.removed` | `spritesFor({type})`                             | optional role argument: `(c.kept 'card')`                                                                                                                                                                                                                                                                     |
| `c.role 'card'` / `c.id 'card-1'`               | `spritesFor({role})` / `spriteFor({id})`         |                                                                                                                                                                                                                                                                                                               |
| `c.still 'card'` / `c.moved 'card'`             | the `boundsDelta` filter from motion-study       | kept sprites whose bounds did / did not change                                                                                                                                                                                                                                                                |
| `c.received 'card'` / `c.counterpart 'card'`    | —                                                | the two halves of a counterpart match: kept-because-it-claimed-a-leaver, and the claimed leaver — so a flight step fires only on flight passes, never on an ordinary resize. `received` also matches a far match; `counterpart` is same-region only, since a far match's leaver is released to its own region |

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
