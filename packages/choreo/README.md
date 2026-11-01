<div align="center">

<h1><img src="https://choreo.boxel.site/icon.svg" width="36" height="36" alt=""> @cardstack/choreo</h1>

**Motion, choreographed.**

`<Choreo>` watches a region's render pass, measures its **changeset** (what was inserted, removed
and kept, and where everything stood before and after) and plays a score you declare over it.
Magic Move crossings, gates you click through, wires drawn every frame, and values derived from
other elements' measurements are all interruptible mid-flight, by design.

**Live gallery:** [**choreo.boxel.site**](https://choreo.boxel.site/): every demo, with its source
and its guide.

</div>

```gts
import { Choreo } from '@cardstack/choreo';
import { motion } from 'glimmer-motion';

<template>
  <Choreo as |c|>
    {{#each @cards key='id' as |card|}}
      <div {{motion id=card.id role='card'}}>{{card.title}}</div>
    {{/each}}

    <c.Sequence>
      <c.Tween @of={{c.removed 'card'}} @opacity={{0}} @duration={{0.22}} />
      <c.Move @of={{c.moved 'card'}} />
      <c.Tween @of={{c.inserted 'card'}} @opacity={{1}} @duration={{0.26}} />
    </c.Sequence>
  </Choreo>
</template>
```

<p align="center">
  <a href="https://choreo.boxel.site/"><img src="https://choreo.boxel.site/asset/og.png" alt="The Choreo gallery" width="900"></a>
</p>

Choreo is built on [glimmer-motion](https://github.com/cardstack/boxel/tree/main/packages/glimmer-motion#readme),
which binds [Motion](https://motion.dev)'s framework-free engine to Glimmer. Its `{{motion}}`
elements are a region's participants, and Motion's engine plays every step. The third package,
[@cardstack/choreo-player](https://github.com/cardstack/boxel/tree/main/packages/choreo-player#readme),
is a dependency-free headless transport for clocking Choreo runs from outside: a video renderer, a
capture worker, a scrub UI.

**New here?** [The guide](https://choreo.boxel.site/docs/guide.md) teaches the binding and then
the region from a Glimmer card. The [documentation](https://choreo.boxel.site/docs/README.md)
goes on to the model, the full construct reference, the open step vocabulary, nested regions,
splices, cameras and `<Film>`.

- [Why choreography?](#why-choreography)
- [Install](#install) · [Entry points](#entry-points)
- [The design decisions](#the-design-decisions)
- [A tour of the vocabulary](#a-tour-of-the-vocabulary)
- [Where it earns its keep](#where-it-earns-its-keep)
- [Interruption, tested](#interruption-tested)
- [External clocks](#external-clocks) · [DOM in 3D](#dom-in-3d-ccamera3d) · [The film](#the-film-film)
- [API](#api) · [How it plugs into glimmer-motion](#how-it-plugs-into-glimmer-motion) · [Architecture](#architecture)

## Why choreography?

Element-level animation answers "how does this element move?", and for one element that is the
right question. But most of what a product ships is _scenes_: a card opens into a page, a row grows
into a detail panel, a slide builds in steps, a dropped card springs into its slot while its
neighbours make room. In a scene, elements don't have independent motion. They have
**relationships**: this one leaves _before_ that one flies; this badge rides _that_ card; this panel
grows out of _that_ row; everything freezes _while_ the hero crosses.

Per-element APIs make you rebuild those relationships by hand: measure rects imperatively, spawn
clone overlays, chain `setTimeout`s, hide the real element while a copy flies, and hope nobody
clicks mid-flight. Every one of those mechanisms turned up, and was replaced by a declared timeline,
when a real product workspace was ported onto this library: the clones, the `afterRender`
measurement hooks, the hand-matched timer pairs.

The changeset is what makes the declarative form possible. The region measures **everything, on
both sides of every pass**, so a timeline never needs a hand-measured rect. A step names _which
sprites_ (by id, by role, or by what happened to them: `inserted`, `removed`, `moved`, `received`)
and _what to do_, and the geometry is already there. Every value is a function of the run's clock
over measured endpoints, so a second click mid-flight simply re-measures and re-aims. Interruption
isn't an edge case to defend against. It is the normal case the whole model is built around.

## Install

```
pnpm add @cardstack/choreo glimmer-motion
```

Peers: `glimmer-motion` at exactly the same version (the two packages release together), and
`motion-dom` / `motion-utils` in the ranges glimmer-motion declares, so both packages share one
engine. Also `ember-modifier`, `@glimmer/component` and `ember-source >= 5.4`. It is a v2 addon
with TypeScript types and Glint signatures.

Cards in a [Boxel](https://github.com/cardstack/boxel) realm import `@cardstack/choreo` and
`glimmer-motion` by their package names. The Boxel host provides both, so a realm carries no copy
of either.

## Entry points

| import                           | what                                                                                                                                                                              |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@cardstack/choreo`              | `Choreo` and its yielded vocabulary, `beacon`, anchors (`at`, `after`), `createArming`, easings, the region registry, plane-space helpers, `StepComponent` and the timeline types |
| `@cardstack/choreo/film`         | the film construct: `Film`, its clips, joins, overlays, player and graph                                                                                                          |
| `@cardstack/choreo/test-support` | `setupChoreo(hooks)`, `advanceGate()`, `seekTo()`, `live()`, `liveAll()`, `orphanCount()`, `strandedTransforms()`                                                                 |

Deep imports (`@cardstack/choreo/compile`, `@cardstack/choreo/film/math`, …) are the same modules.

## The design decisions

Twelve decisions make Choreo feel the way it does. Tests enforce each one, and most were paid for
the hard way.

- **The scene is the unit.** A region owns a subtree; participants opt in with
  `{{motion id= role=}}`; each render pass is one changeset, one timeline, one run. Two regions are
  two scenes with separate clocks. Nesting is legal, because an inner region measures its own pass
  correctly even while an outer one is flying the box it lives in.
- **Leavers belong to the timeline.** A removed participant stays on screen, locked where it stood,
  for exactly as long as the score names it. The region parks it in an orphan layer and releases it
  when its row ends. Parked, it is a memory (glimmer-motion's `keepAsMemory`, the same treatment a
  `<Presence @mode="snapshot">` copy gets): inert, held at the frame it showed, with no ids or form
  names, and with its test hooks suffixed (`data-test-title-memory`). There's no `<Presence>` inside a scene, no clones, and no "keep this in state a bit longer"
  flags.
- **Identity pairs across renders.** An inserted id that replaces a removed one _claims_ it: one
  flight, two skins, crossfaded over the moving box. The same bare id in two different regions pairs
  across them (**far matching**), and the arrival flies from the departure's box as one continuous
  move. Pairing also makes "back" trail-correct for free: a closing page flies to wherever its
  identity truly renders next.
- **z-index is a window; elevation is a layer.** `c.Hold` sets any property for the span of its
  block and hands it back, which retires the whole "timed z-index flag" genre. `c.Raise` is for what
  z-index can't say: promotion to a real layer above every stacking context and overflow clip in the
  region, for the window, with the slot held by a placeholder.
- **A gate is a pause; back is a hold.** `c.Gate` parks the run until `advance()` (Keynote's click),
  `@delay` opens it by itself, and `advance()` mid-segment is the click-through: complete instantly,
  park at the gate. `run.retreat()` is Keynote's back rule as a verb. It lands parked at the previous
  gate with everything ahead re-closed, and **holds**: nothing plays, and no `@delay` gate opens by
  itself, until the user advances and the build replays forward.
- **Interruption is the doctrine.** A sprite mid-flight reads as _moved_ on every re-pass, and its
  `initial` is the painted box, so a replacement run starts from what is on screen, with velocities
  handed over. A replacement pass may not drop a flight either: anything the prior run was driving
  that the new score doesn't name gets a synthesized continuation to its rest. Without that rule,
  any unrelated re-render could snap a flying element home in one frame.
- **Unnamed means no animation.** A reflow the score doesn't name lands instantly, and apps rely on
  that. The continuity rule above is scoped to what was _flying_; layout stays layout.
- **A beacon is a place, not an identity.** `{{beacon 'trash'}}` publishes a box, and `@from` /
  `@to` borrow it as one end of a flight. The bin never joins a changeset and never deforms, and the
  pass measures it fresh each time, _after_ the layout it sits in has re-solved. There's nothing to
  predict about where the slot will be.
- **Derived values never read the page.** `c.Follow` computes one sprite's properties from another's
  _measurements_. Each source arrives as `{ from, to, now }`: resting boxes from the pass, plus a
  current position composed from the values the run is already driving. The follower's own box
  arrives as `rest`, which can't contain what the follower writes. A follower is pure by
  construction, so it can't feed its own output back or force a style recalculation mid-move. The
  obvious API (live boxes) shipped first and failed five ways;
  [the post-mortem](https://choreo.boxel.site/docs/postmortem-follow.md) is part of the documentation.
- **Some ink stands.** An open-ended `c.Tether` draws its wire every frame and every still,
  indefinitely: a standing run that reports settled while it ticks. Tether, raise and scroll cues
  compare by identity across re-renders, so a busy page can't tear a standing wire down and fade it
  back in sixty times a second.
- **The vocabulary is open.** Blocks answer to the anchor system (`@name` a block, then
  `@at={{at 'carry'}}` a step against it), and a composite step is a published seam. Subclass
  `StepComponent`, return a node tree, and your app speaks its own words (`<Carry>`, `<HotLine>`,
  `<CitePulse>`), with `generic: true` children that yield to anything more specific in the same score.
- **Time is a value.** `run.time` is settable in both directions, setting it across a gate parks
  there, and a still is a computed frame, not a paused accumulation. That is what makes a score
  scrubbable, a presentation reversible, and the whole thing renderable from an external clock.

## A tour of the vocabulary

One scene, ten statements. The fixture is the same shape throughout: participants declared with
`{{motion id= role=}}`, and a timeline beside them.

**1 · The changeset, sequenced.** Steps select what _happened_: `c.inserted` / `c.removed` /
`c.kept` / `c.moved` / `c.still` / `c.all` (optionally by role), `c.role`, `c.id`,
`c.counterpart` / `c.received` for the two halves of a pair, and `c.onstage(query)` to touch only
what a viewport can see.

```gts
<c.Sequence>
  <c.Tween @of={{c.removed 'row'}} @opacity={{0}} @duration={{0.16}} />
  <c.Move @of={{c.moved 'row'}} @spring={{spring stiffness=300 damping=24}} />
  <c.Tween @of={{c.inserted 'row'}} @opacity={{1}} @duration={{0.2}} />
</c.Sequence>
```

A sequence can follow a spring. Its length is computed with the engine's own generator, not guessed.

**2 · z-index as a window.**

```gts
<c.Parallel>
  <c.Hold @of={{c.moved 'card'}} @zIndex={{3}} />
  <c.Move @of={{c.moved 'card'}} @spring={{carry}} />
</c.Parallel>
```

The hold spans the block and then releases. `@fill={{true}}` keeps it, and `@duration` gives it its
own window. It works for any property, not just z.

**3 · The crossing: Keynote's Magic Move as one step.** For a view or route swap where the same
identities exist on both sides:

```gts
<Choreo @route={{true}} @quiet={{true}} @scroll={{scrollIntent}} as |c|>
  {{#if (crossingActive)}}
    <c.Crossing @duration={{0.9}} @ease={{EASE}} @leave={{0.42}} @arrive={{0.55}} @overlap={{0.18}} />
  {{/if}}
  {{outlet}}
</Choreo>
```

Leaves dissolve as the paired elements lift off, arrivals land near the settle, and only what a
viewport can see animates. The crossfade **carries color**: alpha becomes an actual solid
mid-flight, so the ground never leaks through the flying box, and is handed back to the stylesheet
on landing. Shape matching follows the **matching-snapshot rule**. Mark the real subject with
`data-choreo-substance`, or put `pack="content"` on type, so the shrink-wrap (the ink) is the subject
even when CSS stretched the frame. The entering subject is scaled uniformly _by width_ to fill the
exiting subject's width, tops pinned, and any vertical overflow is cropped at the bottom by a clip
window that travels with the box, so nothing ever stretches. `c.Crossing @size` defaults to
`'crop'`; `'scale'` and `true` are there when you mean them. A sibling step that names a role the
crossing would have touched takes that sprite away from it (the yield rule): a canned move with
per-element overrides, and no exclusion syntax.

**4 · Gates, forward and back.** A presentation is gates all the way down:

```gts
<c.Sequence>
  <c.Tween @of={{c.id 'kicker'}} @opacity={{array 0 1}} @duration={{0.4}} />
  <c.Gate @delay={{0.7}} />   {{! opens itself: a preamble beat }}
  <c.Tween @of={{c.id 'point-1'}} @y={{array 12 0}} @opacity={{array 0 1}} @duration={{0.3}} />
  <c.Gate />                  {{! waits for the click }}
</c.Sequence>
```

`c.run.advance()` opens the gate, or completes the segment and parks (the click-through).
`c.run.retreat()` steps one build back and _holds_: gates ahead close again, `@delay` gates don't open
by themselves, and the next advance replays the build. Any tween can deliver text by word or by
character (`@by`, `@order`, `@stagger`).

**5 · A value derived, not tweened.** The badge rides the card:

```ts
const pin = ({ rest, sources }: DeriveContext) => {
  const card = sources[0]!.now;
  return { x: card.x + card.width - (rest.x + rest.width) };
};
```

```gts
<c.Follow @of={{c.id 'badge'}} @to={{c.id 'card'}} @read={{pin}} @rest={{PIN_REST}} @duration={{1.6}} />
```

`@read` runs every frame and every scrubbed still, sees only the pass's measurements, and is right
on frames nobody planned, including the frame after a mid-flight retarget. It may write transform,
opacity and filter, but never layout.

**6 · Wires.** Geometry drawn continuously between two sprites:

```gts
<c.Tether @name='gauge' @from={{c.id 'mark'}} @to={{c.id 'note'}} @path={{CURVE}} />
```

`@path` receives both boxes in region space each frame and returns SVG path data, and the region
hosts the layer. No `@duration` means a standing wire, drawn for as long as the score stands and
redrawn through anything that moves either end.

**7 · A place, not an identity.**

```gts
<span class='trash' {{beacon 'trash'}}>…</span>
<c.Move @of={{c.removed 'row'}} @to={{c.beacon 'trash'}} @spring={{toss}} />
```

`@from` works the same way: out of the compose button, or from where a drag let go (`c.gesture`
borrows the live pointer). The bin never morphs, and the pass measures it after layout has settled,
so a destination that a re-solve just moved is simply _read_.

**8 · Elevation and scroll as steps.**

```gts
<c.Parallel>
  <c.Scroll @of={{c.id 'row-8'}} @align='center' @duration={{0.42}} />
  <c.Hold @of={{c.id 'row-8'}} @backgroundColor={{FLASH}} @duration={{0.9}} />
</c.Parallel>
```

The scroll animates the sprite's own scroll container and yields to the user's wheel. The flash's
_timing_ lives in the timeline, while its _fade_ stays in the stylesheet's transition. `c.Raise`
promotes a sprite to the region's elevated layer for its window, above every stacking context and
clip, and `c.Camera` drives the region's own frame (zoom to a sprite, hold others steady) on the
same clock as everything else.

**9 · Anchors and composite steps.** Name a block, aim at it, and say your app's own words once:

```gts
class Carry extends StepComponent<StepArgs & { spring?: SpringSpec }> {
  node(): TimelineNode {
    const { of, name, spring = carry } = this.args;
    return {
      at: this.args.at,
      children: [
        { generic: true, kind: 'move', of, spring },
        { generic: true, kind: 'hold', of, props: { zIndex: 3 } },
      ],
      kind: 'parallel',
      name,
    };
  }
}
```

```gts
<c.Parallel>
  <Carry @name='carry' @of={{c.moved 'card'}} />
  <c.Follow @at={{at 'carry'}} @of={{c.id 'badge'}} @to={{c.id 'card'}} … />
</c.Parallel>
```

`at('carry')` / `after('carry')` place steps against the named block, and the composite's `generic`
children yield their sprites to anything more specific. `c.Crossing` itself is written against
this same public seam, so the canned step has no privileges.

**10 · Regions and far matching.** Two `<Choreo>`s are two scenes. Give an element the same bare id
in both, and a pass that removes it from one while inserting it in the other pairs them at a render
barrier (measure, match, run, with no frame painted between), and the receiver flies from the
sender's box in page space. Scoping the id is how you turn it off
([nested-choreo.md](https://choreo.boxel.site/docs/nested-choreo.md)).

Arming, _when_ a timeline should exist, is a helper of its own, because the same ids exist on
ordinary passes too:

```ts
import { createArming } from '@cardstack/choreo';

const crossing = createArming();
crossing.begin(region); // watches the run, survives mid-flight replacement, stands down on settle
crossing.active(); // tracked: render the timeline only while true
```

## Where it earns its keep

Each row is a shipped pattern, from the gallery or from the product-workspace port that drove the
vocabulary:

| The scene                                                 | The score                                                                                                                 |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Card ⇄ page navigation (gallery ⇄ demo, tile ⇄ document)  | `<Choreo @route>` + `c.Crossing`: real elements, no snapshots, live content never freezes                                 |
| Master–detail: a row grows into a panel                   | `c.Move @from={{c.beacon row}}` `@size='scale'`: the real panel flies, and the solver's re-layout is simply measured      |
| Drag-to-shelve: release point → slot                      | counterpart pairing: the painted box at release _is_ the start                                                            |
| A card transmutes into its schema node                    | a beacon flight out of a closing sheet, still measurable mid-exit                                                         |
| Slide decks with builds                                   | `c.Gate` / `@delay` / `advance()` / `retreat()`: the Keynote rules                                                        |
| Annotations wired to their anchors                        | standing `c.Tether`s, redrawn through every reflow and every flight                                                       |
| "Jump to it and flash it"                                 | `c.Scroll` + `c.Hold`: one clock, instead of a scroll racing a classList write racing a timer                             |
| A badge riding a flying card; a shadow reading lift       | `c.Follow`: right on the frames a tween would have had to predict                                                         |
| Timed highlight and z states (`justDropped`, pulse flags) | `c.Hold` windows: the timer-and-flag genre, retired                                                                       |
| Scrubbing, replays, video export                          | `run.time` + gates + `@cardstack/choreo-player`                                                                           |
| A live UI inside a device, on camera                      | `c.Camera3D`: the DOM is a plane in the scene, and the shot seeks like any other score                                    |
| A leaderboard that reorders when a result lands           | `c.inserted` / `c.moved` / `c.removed` over ONE tracked write: no row is told where to go                                 |
| A simulation running beside a score                       | the loop owns the physics and the chase camera, and the region owns the scene change. Knowing which is which is the skill |

## Interruption, tested

The doctrine is that a second click mid-flight is _normal input_. These mechanics make it true:

- `initial` is the painted box on every re-pass.
- Velocities hand over to the replacement run.
- Orphans aloft keep their run through unrelated re-renders.
- Unnamed flying sprites get continuations.
- A fast keep declines pure-noise passes outright. It fingerprints the _composed_ offset chain, so a
  moved wrapper that is itself no participant still reads as the reflow it is.

The tests work the same way. They watch the primary element **per frame, in absolute coordinates**,
and normalize each step by the sample gap: a starved rAF observer merges engine frames, while a real
teleport happens inside one. They also bound the motion against the measured travel, because a
co-moving pin can stay perfect through a jump a person can't miss. An interruption soak hammers the
gallery's real demos with clicks at 0, 60 and 220 ms.

```ts
import {
  animationsSettled,
  bounds,
  velocityOf,
} from 'glimmer-motion/test-support';
import {
  advanceGate,
  live,
  orphanCount,
  seekTo,
  setupChoreo,
  strandedTransforms,
} from '@cardstack/choreo/test-support';
```

| export                        | what it is for                                                                                                                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `setupChoreo(hooks)`          | glimmer-motion's `setupMotion(hooks)`, plus the state a region leaves behind: beacons, the far-match barrier, gesture samples                                                                           |
| `orphanCount()`               | leavers currently parked in an orphan layer                                                                                                                                                             |
| `strandedTransforms()`        | elements wearing a transform nobody is animating                                                                                                                                                        |
| `live(sel)` / `liveAll(sel)`  | `querySelector` that skips memories, such as leavers parked in the orphan layer, for selectors other than test hooks (a memory's are suffixed): a person never clicks one, so a selector mustn't either |
| `advanceGate()` / `seekTo(s)` | drive a parked run; scrub to a second                                                                                                                                                                   |

`animationsSettled()` from glimmer-motion waits for `<Choreo>` runs as well as the engine's own
animations, because a region registers its in-flight runs as a busy probe. It is explicit rather
than a blocking test waiter on purpose. The interruption tests' whole method is to click again while
something is still in flight, and a waiter would silently turn each of those clicks into a wait for
completion.

## External clocks

[`@cardstack/choreo-player`](https://github.com/cardstack/boxel/tree/main/packages/choreo-player#readme)
is a dependency-free, headless transport for clocking public Choreo runs from outside: a
frame-by-frame video renderer, parallel capture workers, a custom scrub surface. Its run contract is
structural and five members small, so it has no runtime dependency on this package.

```ts
import { createChoreoPlayer } from '@cardstack/choreo-player';

const player = createChoreoPlayer({
  duration: 12,
  prepare: () => mountScore(), // the first external clock arms the demo
  runs: () => (scoreRun ? [scoreRun] : []), // read per operation, never leaked early
});

await player.renderAt(4.25); // pause, set speed and absolute time, settle
await player.play();
```

A Choreo still is a computed frame, so `renderAt(t)` is deterministic across workers on separate
pages: no wall clock, no accumulation, no frame counting.
[demo-recording.md](https://choreo.boxel.site/docs/demo-recording.md) is the field guide for keeping a
demo correct both interactively and under capture.

## DOM in 3D: `c.Camera3D`

A `<Choreo>` region can be a plane in a three.js scene: live DOM, still clickable and still
animating, with WebGL glass composited over it. The gallery's Mockup (a phone) and Long Take (a
laptop whose screen runs a second camera of its own) are built on it.

```gts
<Choreo @onCamera3D={{this.pose}} as |c|>
  <c.Sequence>
    <c.Camera3D @dolly={{0.6}} @yaw={{-18}} @pitch={{12}} @duration={{2.4}} @ease={{GLIDE}} />
    <c.Camera3D @by={{true}} @x={{0.08}} @duration={{2.1}} @ease='linear' />
  </c.Sequence>
</Choreo>
```

`c.Camera3D` carries an **orbit pose in the terms a shoot uses**. `dolly` is distance as a multiple
of the host's own framing, `pitch` and `yaw` are degrees, and `x` / `y` are truck and pedestal in
fractions of the framed height, because dolly alone pushes a tall subject's head out of the picture.
`@by` adds to the pose in force instead of replacing it.

**Choreo doesn't own a renderer.** The step is a pure function of the run's clock and hands the host
a five-number pose through `@onCamera3D`. The host applies the pose to three.js, to a CSS 3D stage,
or to anything else that can take one. So a 3D shot seeks like every other score (`run.time`,
gates, choreo-player), with no rAF and no accumulation of its own.
[dom-in-3d.md](https://choreo.boxel.site/docs/dom-in-3d.md) covers what the shipped cases cost and
what stays hard, and [planes-and-cameras.md](https://choreo.boxel.site/docs/planes-and-cameras.md)
the coordinate contract.

## The film: `<Film>`

Two films were cut by hand on the same engine before the construct was written, **Towers** and
**Sagrada Família**, and 69% of the second was the first. `<Film>` is that 69%, lifted: a headless
cutting room in which a 3D page takes the place of the video track, and everything else is a
component reading one clock. That covers the chased lens; the joins (wipe, dip, blend, iris, melt,
blur, luma, flash, defocus); the lower third and the plate; the timeline; the voice with its
measured reads; the transport; the front door; and the end card.

```gts
import { Film, IframePicture } from '@cardstack/choreo/film';

<Film @name='sagrada' @menuTitle='Sagrada Família' @seek='exact' @clock={{CLOCK}} @over='everything'>
  <:picture as |register|>
    <IframePicture @register={{register}} @src={{this.src}}
      @assets={{this.assets}} @standing={{T_TODAY}} @grades={{GRADES}} />
  </:picture>
  <:default as |f|>
    <f.Spine @join='dip'>
      <f.Chapter @n='01' @title='The site'>
        <f.Shot @name='apse' @ticks={{5}} @dolly={{1.4}} @yaw={{18}} …>
          <f.Type @kicker='THE SITE' @kanji='NAIXEMENT' />
          <f.Voice @read={{VO_SECS.apse}} />
        </f.Shot>
        <f.Join @presentation='wipe' />
        …
      </f.Chapter>
    </f.Spine>
  </:default>
  <:gate as |f|>…the front matter, f.begin…</:gate>
  <:end as |f|>…the back matter, f.restart…</:end>
</Film>
```

A film is a GRAPH: a spine of chapters and shots with everything else attached to a shot, compiled
to the shot list the engine runs. The picture is a port (`Picture`), so a film can hand in something
other than an iframe.

[film.md](https://choreo.boxel.site/docs/film.md) is the **as-built reference**: every argument and
block, the beat table, the clock and its one-tick cue offset, the two seek modes, the `Picture` port.
Its most important section for the rest of the library covers how `<Film>` composes with the other
constructs rather than replacing them. It is an ordinary consumer of `<Choreo>`: one
`c.Camera3D @through` for the entire picture, one `c.Perform` per beat anchored with `at('film')`,
the lower third on its own region, and in exact mode, two Choreo runs that the film drives by writing
`run.time` instead of playing them.

## API

### `<Choreo>`: the region

| argument        | what                                                                                                                                                                                                                                          |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@id`           | the region's name, for nesting and far matching                                                                                                                                                                                               |
| `@route`        | a route swap inside the region is one pass                                                                                                                                                                                                    |
| `@scroll`       | `'top'` or a thunk, applied inside the pass before the final bounds are measured                                                                                                                                                              |
| `@quiet`        | pause the rest of the page for the run's span                                                                                                                                                                                                 |
| `@idle`         | sit render passes out: no snapshot, no run, no cost; for many regions of which few can change at once                                                                                                                                         |
| `@inView`       | measure and animate only the participants in or near the nearest vertical scroller's view; `@inViewMargin` (default 1) is how many views beyond each edge count as near. A move farther than the margin is a jump and lands with no animation |
| `@maxFrameStep` | the most animation time (ms) one painted frame may advance: behind a long frame a run slows down instead of skipping                                                                                                                          |
| `@onCamera3D`   | receives the `c.Camera3D` pose each frame; `@camera3dFrom` is the pose the first run starts from                                                                                                                                              |
| `@onPerform`    | dispatches each `c.Perform` command as the clock comes to include it; `@onPerformReset` resets commanded state when the clock moves back before one                                                                                           |
| `@debug`        | outlines, and a `console.table` per run                                                                                                                                                                                                       |

It yields the context:

- **Steps:** `Sequence`, `Parallel`, `Gate`, `Wait`, `Tween`, `Spring`, `Move`, `Hold`, `Raise`,
  `Scroll`, `Follow`, `Tether`, `Crossing`, `Attach`, `Perform`, and the camera's `Camera`,
  `Camera3D`, `Aim`, `Frame`, `Pan` and `SlowZoom`.
- **Queries:** `inserted`, `removed`, `kept`, `moved`, `still`, `all`, `counterpart`, `received`,
  `role`, `id` and `onstage`, plus `c.beacon` and `c.gesture` for places.
- **The run:** `c.run` (null between passes), with `advance()`, `retreat()`, `play()`, `pause()`,
  `cancel()`, `time`, `speed`, `duration`, `parked`, `paused`, `standing`, `segment` and `finished`.
  `c.advance` opens the parked gate from a template, and `c.camera` is where the region's frame stands.

Timing is `@duration` / `@delay` in seconds, `@spring` for spring specs, and `@stagger` across a
query's sprites. `@name`, `@at={{at 'name'}}` and `after('name')` work on steps _and_ blocks. Any
property may be a function `(sprite, changeset) => value`. Sprites carry `initial` / `final` bounds in
`context`, `parent` and `page` space, a `delta`, and their `counterpart`. `c.Tween` also takes
normalized `@times` for keyframe arrays, so a loop can hold, scatter and regroup on an explicit rhythm
without remounting its elements.

The open vocabulary is `StepComponent`, `toMs` and node literals
([step-vocabulary.md](https://choreo.boxel.site/docs/step-vocabulary.md)), and the
[construct reference](https://choreo.boxel.site/docs/choreo-constructs.md) has every step's
arguments.

### `{{beacon}}`

`{{beacon 'name'}}` publishes an element's box as a place that steps can fly from or to, through
`c.beacon 'name'`, without the element joining any changeset.

### Participants

A participant is a glimmer-motion element: `{{motion id= role=}}`. `id` is identity across renders
and the key for pairing; `role` is a group a step can select. Choreo adds one argument to
`{{motion}}`: `pack='content'` makes the shrink-wrapped ink, not the stretched box, the shape a
crossing matches.

## How it plugs into glimmer-motion

A region is a glimmer-motion
[participant host](https://github.com/cardstack/boxel/tree/main/packages/glimmer-motion#participant-hosts).
`{{motion}}` elements with an `id` or `role` join the nearest region when they mount, and a region
can claim a leaving element to keep it on screen for as long as the timeline names it. The region's
in-flight runs count toward glimmer-motion's settle checks through a busy probe, and
`setupChoreo(hooks)` is glimmer-motion's `setupMotion(hooks)` with Choreo's document-wide state
(beacons, the far-match barrier, gesture samples) added to the resets it runs.

### Reduced motion

A region follows the `MotionConfig` it sits in, as each run begins. Under glimmer-motion's default,
`'user'`, a viewer whose system asks for reduced motion gets the score at its usual timing with
nothing travelling: positional values (transforms, size, position) land at their step's start
whether the engine, an ambient loop, a text delivery, a `@path` flight or the camera drives them,
and a `c.Scroll` lands its container at the offset rather than gliding there, while opacity and
colour still animate. `'always'` reduces motion regardless of the setting, and
`'never'` plays the score as written:

```gts
<MotionConfig @reducedMotion='never'>
  <Choreo as |c|>…</Choreo>
</MotionConfig>
```

## Architecture

```
glimmer-motion   {{motion}}, MotionNode, the layout pipeline, the participant-host extension point
   ▲
choreo.gts       <Choreo>: the region, a participant host; snapshots before the pass, measures after
changeset.ts     inserted / removed / kept / moved, with bounds in context, parent and page space
measure.ts       resting measurement: release, measure, reassert
compile.ts       the timeline tree → cue rows on one clock
run.ts           the run: time, speed, gates, retreat, continuity with the run it replaces
steps.gts        the step components, and StepComponent: the seam composite steps are written on
anchors.ts       at() / after(): steps against named blocks
deliver.ts       text by word or character, ordered and staggered
beacon.ts, beacons.ts   {{beacon}}: places, not identities
far.ts           the render barrier that pairs one bare id across regions
arming.ts        createArming: when a timeline should exist
space.ts, path.ts       plane space and camera paths; splices
film/            <Film>: the graph, the schedule, joins, overlays, the picture port and the player
test-support/    setupChoreo, advanceGate, seekTo, live, orphanCount, strandedTransforms
```

## License

MIT. © 2026 Cardstack Foundation.

## Credits

The engine and its algorithms are [Motion](https://motion.dev)'s
([motiondivision/motion](https://github.com/motiondivision/motion), MIT). The choreography model's
ambitions, and the render-detector idea underneath it, are from
[boxel-motion](https://github.com/cardstack/boxel).
