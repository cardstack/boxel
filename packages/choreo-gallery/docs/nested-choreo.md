# Nested Choreo

How `<Choreo>` regions compose, and how a beacon shares a measurement
across that boundary without flattening the tree. Both are implemented;
this is the design they follow.

The parent document is [choreography.md](choreography.md).

- [A region is a scene](#a-region-is-a-scene)
- [Discovery](#discovery)
- [Isolation](#isolation)
- [What nesting does not do](#what-nesting-does-not-do)
- [When to nest](#when-to-nest)
- [Beacons](#beacons)
- [Scope](#scope)
- [Status](#status)

## A region is a scene

`<Choreo>` is not a provider you wrap the app in. It is a scene: it
snapshots its participants, builds a changeset, and plays the timeline
declared inside it. `MotionConfig` belongs at the root. A Choreo belongs
around the workspace, the modal, the panel, or the list that is one
machine.

Nesting is how two machines sit in the same tree without becoming one
changeset. A beacon is how one of them reads a box the other does not
own.

## Discovery

A `{{motion}}` with `id` or `role` walks to the nearest `[data-choreo]`
ancestor (`closestChoreo` in `choreo/registry.ts`). That host is the
only region that registers it.

When a region compiles its timeline, `collect()` walks the markup in
document order and **skips** any child `[data-choreo]`. The inner
region's steps are not part of the outer timeline.

So nearest-wins for participants, and the inner timeline stays in the
inner region. Two `<Choreo>`s stacked in the template are two scenes.

```gts
<Choreo as |shell|>
  <aside {{motion id='nav' role='chrome'}}>…</aside>
  <main>
    <Choreo as |panel|>
      <article {{motion id='doc' role='card'}}>…</article>
      <panel.Move @of={{panel.kept 'card'}} />
    </Choreo>
  </main>
  <shell.Move @of={{shell.kept 'chrome'}} />
</Choreo>
```

The card is only in the panel changeset. The chrome is only in the
shell. Each region has its own snapshot, orphan layer, and run.

This is the intended answer to “a card controls its own contents while a
layout above moves it”. The inner region measures its own
pass even if the outer one is translating the box it lives in.

## Isolation

Each region owns:

- its participant set (whoever called `closestChoreo` and landed here)
- its before/after snapshot and the changeset built from it
- its orphan layer (`[data-choreo-orphans]`)
- the timeline `collect()` read from _its_ markup

Queries do not leak. `shell.kept 'card'` does not see the panel's
cards. An inserted id in the panel does not counterpart-match a removed
id in the shell.

The outer region does not wait for the inner run. If both fire on the
same render, they play side by side. There is no shared clock.

## What nesting does not do

- **No shared timeline across the boundary.** Far matching (below in
  spirit, `src/choreo/far.ts` in fact) pairs an inserted id in one region
  with a removed id in another so the receiver flies from the sender's
  box — but each region still compiles and plays its own timeline.
- **No shared clock.** The shell's `Sequence` does not wait for the
  panel's `Move`.
- **Queries do not leak.** `id` / `role` are local to the region that
  registered the element.
- **It is not a reason to wrap `body`.** One root Choreo would make
  every `id`/`role` in the app one changeset. That is the opposite of
  nesting. Site-wide route motion stays on `viewTransition` /
  `animateView`.

A workspace Choreo around sidebar + main + drawer is fine if those
three are one machine. That is still not `body`.

## When to nest

| Situation                                                     | One Choreo               | Nested                |
| ------------------------------------------------------------- | ------------------------ | --------------------- |
| Sidebar, main, and a drawer that share one sequence           | yes                      | —                     |
| A list inside a panel that has its own enter/leave            | the panel                | the list              |
| A modal with its own orphans, over a page that is also moving | the page                 | the modal             |
| Chrome and the current route                                  | chrome, if it is a scene | the route's own scene |
| “I need the trash can's box from the list”                    | no — that is a beacon    | no — that is a beacon |

Put `id` / `role` only on the nodes that scene should see.

## Beacons

A beacon is a **named box that does not animate**. Other sprites use
its bounds as a fake start or a fake end.

Ember Animated's primitive is that idea plus two methods:
`startAtSprite(beacons.trash)` and `endAtSprite(beacons.trash)`.
`<AnimatedBeacon>` measures its child when a transition starts, stores
a sprite on the motion service, and the generator reads
`context.beacons`. The beacon itself never moves.

`layoutId` is the opposite. It pairs **two real elements** that share
an id and morphs them. Putting `layoutId="trash"` on a leaving row
_and_ the bin makes the bin a shared element; it will stretch. A
beacon must not do that.

Far-matching (`sentSprite` / `receivedSprite`, counterpart across
regions) is also a different problem: two live participants, one
identity, two regions. A beacon has no identity in the changeset. It
is not inserted, kept, or removed. It is a point other sprites may
borrow.

A beacon is not a reason to flatten two Choreos, and it is not a
reason to wrap `body`. Nesting keeps the scenes apart; the beacon
leaks **one measurement** on purpose.

### What to add

**1. A registration primitive.** A modifier is enough:
`{{beacon "trash"}}` on the button. A yield-only component is not
required.

**2. Measure on every pass. Never animate the beacon.** On the same
snapshot the region already takes, record `{ name, page, context }`.
Re-measure every time — the trash can move (scroll, a header hiding).
Do not put the beacon in `inserted` / `kept` / `removed`. A dirty
changeset is still about participants; a beacon moving by itself does
not start a run.

**3. Rewrite another sprite's start or end**, then run `Move` as
today.

- enter: `initial = beacon.bounds`, then Move (FLIP from the beacon
  to the element's real seat)
- leave: `final = beacon.bounds`, then Move, then orphan until the
  row ends

Width/height on that same Move (`@size` defaults to true) is the
scale. `compile.ts` already reads `sprite.initial.page` and
`sprite.final.page`; rewriting those bounds is the whole
implementation of the rewrite.

**4. A way to say it in the template.** `Move` has no `@from` today
(`Tween` / `Spring` use `@from` for a property hash). On `Move` only:

```gts
<button type='button' {{beacon 'compose'}}>Compose</button>
<button type='button' {{beacon 'trash'}}>Trash</button>

<Choreo as |c|>
  {{#each this.rows key='id' as |row|}}
    <div {{motion id=row.id role='row'}}>{{row.title}}</div>
  {{/each}}
  <c.Move @of={{c.inserted 'row'}} @from={{c.beacon 'compose'}} />
  <c.Move @of={{c.removed 'row'}} @to={{c.beacon 'trash'}} />
</Choreo>
```

`c.beacon` is a query, like `c.id` / `c.role`. A string name is
enough; the handle exists so the yield API stays one shape.

Property functions are the escape hatch, not the thing to teach:

```ts
(s, cs) => cs.beacon('trash')!.page.x;
```

`changeset.beacon(name)` returns the measured bounds (or `null` if
nothing registered that name this pass). It does not return a sprite.

### What not to add

- A new animation engine, view transitions, or generators.
- Teaching `startAtSprite`.
- `sentSprites` / `receivedSprites` — that is Lists / `layoutId` /
  far-matching.
- Projection lies: do not overwrite a `VisualElement` snapshot so the
  engine thinks the leaving node used to live on the trash. That
  fights `layoutId` and breaks interruption.

## Scope

The only design choice that matters is **who can see the name**.

**Choreo-local.** The modifier registers with the nearest
`[data-choreo]`. Simple. Not enough for an inbox: the trash lives in
the chrome, the list lives in the outlet, they are different regions
on purpose.

**App-global.** A document-level registry, keyed by name. Any region's
run can read any live beacon. Names are unique per document; if two
modifiers claim the same name, the first registration this pass wins
(Ember Animated's `hasBeacon` then skip). Destroy unregisters.
Re-measure on every pass, not only on the consuming region's detector
— a header that hides can move the trash without the list rendering.

For compose → row, row → trash, and interrupt/undo, the useful version
is global. Undo already falls out of Choreo: a leaver that comes back
is `kept` again; the beacon is only a point.

Lifetime rules for the global map:

- a beacon exists while its element is connected
- a run that starts reads the map as it is after that pass's measure
- a missing name on `@from` / `@to` is a no-op for that sprite (Move
  already returns null when initial or final is missing)
- beacons do not participate in orphaning

A Choreo-local `{{beacon}}` plus `changeset.beacon` plus `@from` /
`@to` is about a day and low risk. The global registry is another
day: lifetime, name clashes, and “which run may read this.” Putting
the same idea on `{{motion layout}}` / `layoutId` without Choreo is
the high-risk path and is out of scope.

## Status

| Piece                                              | State                                           |
| -------------------------------------------------- | ----------------------------------------------- |
| Nearest-ancestor host (`closestChoreo`)            | done                                            |
| `collect()` skips nested `[data-choreo]`           | done                                            |
| Isolated snapshot / changeset / orphans / timeline | done                                            |
| Far-matching across regions                        | done — `src/choreo/far.ts`, the Far match demo  |
| `{{beacon}}`, `c.beacon`, `changeset.beacon`       | done — `src/beacon.ts`, `src/choreo/beacons.ts` |
| `Move` `@from` / `@to` rewriting initial / final   | done — `compile.ts` `resolveMove`               |
| App-global beacon registry                         | done — the version the Beacons demo needs       |
