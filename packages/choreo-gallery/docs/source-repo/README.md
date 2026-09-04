<div align="center">

# Choreo

**Motion, Choreo-graphed.**
The [Motion](https://motion.dev) engine for Ember — and a timeline for the scene. `<Choreo>` watches a render pass, measures its **changeset** — what was inserted, removed, kept, and where everything stood before and after — and plays a score you declare over it. Magic-Move crossings, gates you click through, wires drawn every frame, values derived from other elements' measurements — all interruptible mid-flight, by design.

**Live gallery:** [**cardstack.github.io/choreo**](https://cardstack.github.io/choreo/) &nbsp; · &nbsp; 38 stages, every one a test fixture

</div>

```gts
<Choreo as |c|>
  {{#each this.cards key='id' as |card|}}
    <div {{motion id=card.id role='card'}}>{{card.title}}</div>
  {{/each}}

  <c.Sequence>
    <c.Tween @of={{c.removed 'card'}} @opacity={{0}} @duration={{0.22}} />
    <c.Move @of={{c.moved 'card'}} @spring={{this.soft}} />
    <c.Tween @of={{c.inserted 'card'}} @opacity={{1}} @duration={{0.26}} />
  </c.Sequence>
</Choreo>
```

<div align="center">

**Declared like a template** &nbsp; · &nbsp; measured like layout &nbsp; · &nbsp; sequenced like a score &nbsp; · &nbsp; scrubbed like a video

**Interrupted like Keynote** &nbsp; · &nbsp; click again mid-flight and everything re-aims from where it is painted

</div>

<p align="center">
  <img src="docs/gallery.png" alt="The Choreo gallery in light mode: the Motion, Choreographed hero above a grid of live demos — Playhead, Lightbox, and more" width="900">
</p>

---

## What is Choreo?

Choreo is two layers in one repo, published as two packages.

**The choreography layer** is the reason the repo exists: a region-scoped model that Motion's per-element API has no equivalent for. A `<Choreo>` region treats each render pass as one event. It snapshots its participants before the DOM changes, measures them after, and hands the difference — the **changeset** — to a timeline declared right in the template. One score describes the whole scene: what leaves, what flies, what arrives, in what order, on which clock.

**The binding underneath** is **`glimmer-motion`**: `motion-dom` — Motion's framework-free engine, untouched — bound to Glimmer as a modifier and a handful of components. Layout animation, shared-element transitions, presence, variants, drag, reorder, scroll. It is a complete, usable port in its own right (held to Motion's own test suites, pixel for pixel), and it is what the choreography stands on. Both ship in the one `glimmer-motion` package.

A third piece, **`choreo-player`**, is a dependency-free headless transport for clocking Choreo runs from outside — a video renderer, a capture worker, a scrub UI ([packages/choreo-player](packages/choreo-player)).

> Naming: Motion (motion.dev) is the library formerly called framer-motion; its React package is still published as `framer-motion`, which is why upstream paths in this repo read `packages/framer-motion/…`. The repo is **Choreo**; the published package is still **`glimmer-motion`** — one npm name, unchanged, and every import in these docs is the real one.

**New here?** [docs/guide.md](docs/guide.md) teaches the binding from a Glimmer card rather than a React translation table. Then: [choreography.md](docs/choreography.md) (the model and its boxel-motion ancestry), [choreo-constructs.md](docs/choreo-constructs.md) (the full construct reference), [step-vocabulary.md](docs/step-vocabulary.md) (the open vocabulary: anchors, composite steps, derived values), [nested-choreo.md](docs/nested-choreo.md) (regions and far matching), [choreo-splices.md](docs/choreo-splices.md) (cuts as a first-class citizen of a score), [film.md](docs/film.md) (the `<Film>` construct, as built), [planes-and-cameras.md](docs/planes-and-cameras.md) and [dom-in-3d.md](docs/dom-in-3d.md) (a `<Choreo>` region as a plane in a three.js scene), [demo-recording.md](docs/demo-recording.md) (external clocks), [choreo-player.md](docs/choreo-player.md) (the headless transport), [realm-publishing.md](docs/realm-publishing.md), and [postmortem-follow.md](docs/postmortem-follow.md) — the engineering post-mortem that shaped the derived-value API, kept because the mistakes teach more than the result.

`docs/` is the documentation. The workshop behind it — design records, handoffs, measurements, the films' scripts and wall text — is in [notes/](notes), which is drafts by definition: some of it describes things proposed and never built, or built and since changed.

- [Why choreography?](#why-choreography)
- [Install](#install)
- [At a glance: the design decisions](#at-a-glance-the-design-decisions)
- [A tour of the vocabulary](#a-tour-of-the-vocabulary)
- [Where it earns its keep](#where-it-earns-its-keep)
- [Interruption, tested](#interruption-tested)
- [External clocks: choreo-player](#external-clocks-choreo-player)
- [DOM in 3D: c.Camera3D](#dom-in-3d-ccamera3d)
- [The binding underneath](#the-binding-underneath) · [Why the engine is untouched](#why-the-engine-is-untouched) · [How it was made](#how-it-was-made) · [Fidelity](#fidelity)
- [API](#api) · [React → Glimmer](#react--glimmer) · [Three rules React does not need](#three-rules-react-does-not-need)
- [Testing](#testing) · [Architecture](#architecture) · [Development](#development) · [Roadmap](#roadmap) · [Credits](#credits)

## Why choreography?

Element-level animation answers "how does this element move?" — and for one element it is the right question. But most of what a product ships is _scenes_: a card opens into a page, a row grows into a detail panel, a slide builds in steps, a dropped card springs into its slot while its neighbours make room. In a scene, elements don't have independent motion — they have **relationships**: this one leaves _before_ that one flies; this badge rides _that_ card; this panel grows out of _that_ row; everything freezes _while_ the hero crosses.

Per-element APIs make you reconstruct those relationships by hand: measure rects imperatively, spawn clone overlays, chain `setTimeout`s, hide the real element while a copy flies, and hope nobody clicks mid-flight. Every one of those hand-built mechanisms was found, catalogued, and replaced during the port of a real product workspace onto this library — the clones, the `afterRender` measurement hooks, the hand-matched timer pairs, all of it collapsed into declared timelines ([christse/bento-boxel#1](https://github.com/christse/bento-boxel/pull/1) is the receipts).

The changeset is what makes the declarative form possible. Because the region measures **everything, both sides of every pass**, the timeline never needs a hand-measured rect: a step names _which sprites_ (by id, role, or what happened to them — `inserted`, `removed`, `moved`, `claimed`) and _what to do_, and the geometry is already there. And because every value is a function of the run's clock over measured endpoints, a second click mid-flight simply re-measures and re-aims — interruption is not an edge case to be defended against, it is the normal case the whole model is built around.

## Install

```
pnpm add glimmer-motion motion-dom motion-utils
```

Peer dependencies: `motion-dom` / `motion-utils` (pinned together), `ember-modifier`, `@glimmer/component`, `@glimmer/tracking`, `ember-source >= 5.4`. It's a v2 addon: Embroider and Vite apps consume it directly, with TypeScript types and Glint signatures. The headless transport is separate: `pnpm add choreo-player`.

## At a glance: the design decisions

Twelve decisions that make Choreo feel the way it does. Each one is enforced by tests, and most were paid for the hard way.

- **The scene is the unit.** A region owns a subtree; participants opt in with `{{motion id= role=}}`; each render pass is one changeset, one timeline, one run. Two regions are two scenes with separate clocks — and nesting is legal, because an inner region measures its own pass correctly even while an outer one is flying the box it lives in.
- **Leavers belong to the timeline.** A removed participant stays on screen, locked where it stood, exactly as long as the score names it — the region parks it in an orphan layer and releases it when its row ends. No `<Presence>` inside a scene, no clones, no "keep this in state a bit longer" flags.
- **Identity pairs across renders.** An inserted id that replaces a removed one _claims_ it: one flight, two skins, crossfaded over the moving box. The same bare id in two different regions pairs across them — **far matching** — and the arrival flies from the departure's box as one continuous move. Pairing is also what makes "back" trail-correct for free: a closing page flies to wherever its identity truly renders next.
- **z-index is a window; elevation is a layer.** `c.Hold` sets any property for the span of its block and hands it back — the whole "timed z-index flag" genre, retired. `c.Raise` is for what z-index cannot say: promotion to a real layer above every stacking context and overflow clip in the region, for the window, with the slot held by a placeholder.
- **A gate is a pause; back is a hold.** `c.Gate` parks the run until `advance()` (Keynote's click), `@delay` opens it by itself, and `advance()` mid-segment is the click-through: complete instantly, park at the gate. `run.retreat()` is the Keynote back rule as a verb: land parked at the previous gate, everything ahead re-closed, and **hold** — nothing plays, no `@delay` gate self-opens, until the user advances and the build replays forward.
- **Interruption is the doctrine.** A sprite mid-flight reads as _moved_ on every re-pass — its `initial` is the painted box, by design — so a replacement run starts from what is on screen, with velocities handed over. And a replacement pass may not drop a flight: anything the prior run was driving that the new score doesn't name gets a synthesized continuation to its rest. (Without that rule, any unrelated re-render could snap a flying element home in one frame; the test that caught it watches every frame.)
- **Unnamed means no animation.** A reflow the score doesn't name lands instantly — apps rely on it. The continuity rule above is scoped to what was _flying_; layout stays layout.
- **A beacon is a place, not an identity.** `{{beacon 'trash'}}` publishes a box; `@from`/`@to` borrow it as one end of a flight. The bin never joins a changeset, never deforms, and the pass measures it fresh each time — including _after_ the layout it sits in has re-solved, which kills the "predict where the slot will be" computation entirely.
- **Derived values never read the page.** `c.Follow` computes one sprite's properties from another's _measurements_: each source arrives as `{ from, to, now }` — resting boxes from the pass, plus a current position composed from the values the run is already driving — and the follower's own box arrives as `rest`, which cannot contain what the follower writes. Pure by construction, so a follower cannot feed its own output back or force a style recalculation mid-move. The API looks this way because the obvious API (live boxes) shipped first and failed five ways; [the post-mortem](docs/postmortem-follow.md) is part of the documentation.
- **Some ink stands.** An open-ended `c.Tether` draws its wire every frame and every still, indefinitely — a standing run that reports settled while it ticks. Tether, raise, and scroll cues compare by identity across re-renders, so a busy page cannot tear a standing wire down and refade it sixty times a second.
- **The vocabulary is open.** Blocks answer to the anchor system (`@name` a block, `@at={{at 'carry'}}` a step against it), and a composite step is a published seam: subclass `StepComponent`, return a node tree, and your app speaks its own words — `<Carry>`, `<HotLine>`, `<CitePulse>` — with `generic: true` children that yield to anything more specific in the same score.
- **Time is a value.** `run.time` is settable in both directions; setting it across a gate parks there; a still is a computed frame, not a paused accumulation. That is what makes the Playhead demo scrubbable, the presentation reversible, and the whole thing renderable from an external clock.

## A tour of the vocabulary

One scene, ten statements. The fixture is the same shape throughout: participants declared with `{{motion id= role=}}`, a timeline beside them.

**1 · The changeset, sequenced.** Steps select what _happened_ — `c.inserted` / `c.removed` / `c.kept` / `c.moved` / `c.still` (optionally by role), `c.role`, `c.id`, `c.claimed` / `c.received` for the two halves of a pair, and `c.onstage(query)` to touch only what a viewport can see.

```gts
<c.Sequence>
  <c.Tween @of={{c.removed 'row'}} @opacity={{0}} @duration={{0.16}} />
  <c.Move @of={{c.moved 'row'}} @spring={{spring stiffness=300 damping=24}} />
  <c.Tween @of={{c.inserted 'row'}} @opacity={{1}} @duration={{0.2}} />
</c.Sequence>
```

A sequence can follow a spring — its length is computed with the engine's own generator, not guessed.

**2 · z-index as a window.**

```gts
<c.Parallel>
  <c.Hold @of={{c.moved 'card'}} @zIndex={{3}} />
  <c.Move @of={{c.moved 'card'}} @spring={{carry}} />
</c.Parallel>
```

The hold spans the block and releases; `@fill={{true}}` keeps it; `@duration` gives it its own window. Any property, not just z.

**3 · The crossing — Keynote's Magic Move as one step.** For a view or route swap where the same identities exist on both sides:

```gts
<Choreo @route={{true}} @quiet={{true}} @scroll={{scrollIntent}} as |c|>
  {{#if (crossingActive)}}
    <c.Crossing @duration={{0.9}} @ease={{EASE}} @leave={{0.42}} @arrive={{0.55}} @overlap={{0.18}} />
  {{/if}}
  {{outlet}}
</Choreo>
```

Leaves dissolve as the paired elements lift off; arrivals land near the settle; only what a viewport can see animates; the crossfade **carries color** (alpha is turned into an actual solid mid-flight so the ground never leaks through the flying box, and handed back to the stylesheet on landing). Shape matching follows the **matching-snapshot rule**: mark the real subject with `data-choreo-substance`, or `pack="content"` on type so the shrink-wrap (the ink) is the subject even when CSS stretched the frame. The entering subject is scaled uniformly _by width_ to fill the exiting subject's width, tops pinned, any vertical overflow cropped at the bottom by a clip window that travels with the box — nothing ever stretches. `c.Crossing @size` defaults to `'crop'`; `'scale'` and `true` are there when you mean them. A sibling step naming a role the crossing would have touched takes that sprite away from it (the yield rule) — a canned move with per-element overrides, no exclusion syntax.

**4 · Gates, forward and back.** A presentation is gates all the way down:

```gts
<c.Sequence>
  <c.Tween @of={{c.id 'kicker'}} @opacity={{array 0 1}} @duration={{0.4}} />
  <c.Gate @delay={{0.7}} />   {{! opens itself — a preamble beat }}
  <c.Tween @of={{c.id 'point-1'}} @y={{array 12 0}} @opacity={{array 0 1}} @duration={{0.3}} />
  <c.Gate />                  {{! waits for the click }}
</c.Sequence>
```

`ctx.run.advance()` opens the gate (or completes the segment and parks — the click-through). `ctx.run.retreat()` steps one build back and _holds_: gates ahead re-close, `@delay` gates do not self-open, and the next advance replays the build. Text can be delivered by word or character (`@by`, `@order`, stagger) as part of any tween.

**5 · A value derived, not tweened.** The badge rides the card; the shadow spreads by how far the card is from home:

```ts
const pin = ({ rest, sources }: DeriveContext) => {
  const card = sources[0]!.now;
  return { x: card.x + card.width - (rest.x + rest.width) };
};
```

```gts
<c.Follow @of={{c.id 'badge'}} @to={{c.id 'card'}} @read={{pin}} @rest={{PIN_REST}} @duration={{1.6}} />
```

`@read` runs every frame and every scrubbed still, sees only the pass's measurements, and is right on frames nobody planned — including the frame after a mid-flight retarget. It may write transform, opacity, and filter; never layout.

**6 · Wires.** Geometry drawn continuously between two sprites:

```gts
<c.Tether @name='gauge' @from={{c.id 'mark'}} @to={{c.id 'note'}} @path={{CURVE}} />
```

`@path` receives both boxes in region space each frame and returns SVG path data; the region hosts the layer. No `@duration` means a standing wire — drawn for as long as the score stands, redrawn through anything that moves either end (the Wires demo drags its notes through three drafts of copy).

**7 · A place, not an identity.**

```gts
<span class='trash' {{beacon 'trash'}}>…</span>
<c.Move @of={{c.removed 'row'}} @to={{c.beacon 'trash'}} @spring={{toss}} />
```

`@from` works the same way (out of the compose button; from where a drag let go — `c.gesture` borrows the live pointer). The bin never morphs; the pass measures it after layout has settled, so a destination that a re-solve just moved is simply _read_.

**8 · Elevation and scroll as steps.**

```gts
<c.Parallel>
  <c.Scroll @of={{c.id 'row-8'}} @align='center' @duration={{0.42}} />
  <c.Hold @of={{c.id 'row-8'}} @backgroundColor={{FLASH}} @duration={{0.9}} />
</c.Parallel>
```

The scroll animates the sprite's own scroll container and yields to the user's wheel; the flash's _timing_ lives in the timeline while its _fade_ stays in the stylesheet's transition. `c.Raise` promotes a sprite to the region's elevated layer for its window — above every stacking context and clip — and `c.Camera` drives the region's own frame (zoom to a sprite, hold others steady) on the same clock as everything else.

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

`at('carry')` / `after('carry')` place steps against the named block; the composite's `generic` children yield their sprites to anything more specific. `c.Crossing` itself is written against this same public seam — the canned step is not privileged.

**10 · Regions and far matching.** Two `<Choreo>`s are two scenes; give an element the same bare id in both and a pass that removes it from one while inserting it in the other pairs them at a render barrier — measure, match, run, with no frame painted between — and the receiver flies from the sender's box in page space. Scoping the id is precisely how you turn it off. ([docs/nested-choreo.md](docs/nested-choreo.md))

Arming — _when_ a timeline should exist — is a first-class helper, because the same ids exist on ordinary passes too:

```ts
import { createArming } from 'glimmer-motion';
const crossing = createArming();
crossing.begin(region); // watches the run, survives mid-flight replacement, stands down on settle
crossing.active(); // tracked — render the timeline only while true
```

## Where it earns its keep

These are not hypotheticals — each row is a shipped pattern, from the gallery or from the product-workspace port that drove the vocabulary:

| The scene                                                | The score                                                                                                             |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Card ⇄ page navigation (gallery ⇄ demo, tile ⇄ document) | `<Choreo @route>` + `c.Crossing` — real elements, no snapshots, live content never freezes                            |
| Master–detail: a row grows into a panel                  | `c.Move @from={{c.beacon row}}` `@size='scale'` — the real panel flies, the solver's re-layout is simply measured     |
| Drag-to-shelve: release point → slot                     | counterpart pairing — the painted box at release _is_ the start                                                       |
| A card transmutes into its schema node                   | beacon flight out of a closing sheet, still measurable mid-exit                                                       |
| Slide decks with builds                                  | `c.Gate` / `@delay` / `advance()` / `retreat()` — the Keynote rules                                                   |
| Annotations wired to their anchors                       | standing `c.Tether`s, redrawn through every reflow and every flight                                                   |
| "Jump to it and flash it"                                | `c.Scroll` + `c.Hold` — one clock instead of a scroll racing a classList write racing a timer                         |
| A badge riding a flying card; a shadow reading lift      | `c.Follow` — right on the frames a tween would have had to predict                                                    |
| Timed highlight/z states (`justDropped`, pulse flags)    | `c.Hold` windows — the timer-and-flag genre, retired                                                                  |
| Scrubbing, replays, video export                         | `run.time` + gates + `choreo-player`                                                                                  |
| A live UI inside a device, on camera                     | `c.Camera3D` — the DOM is a plane in the scene; the shot seeks like any other score                                   |
| A leaderboard that reorders when a result lands          | `c.inserted` / `c.moved` / `c.removed` over ONE tracked write — no row is told where to go                            |
| A simulation running beside a score                      | the loop owns the physics and the chase camera; the region owns the scene change. Knowing which is which is the skill |

## Interruption, tested

The doctrine is that a second click mid-flight is _normal input_. The mechanics that make it true: `initial` is the painted box on every re-pass; velocities hand over to the replacement run; orphans aloft keep their run through unrelated re-renders; unnamed flying sprites get continuations; a fast keep declines pure-noise passes outright (fingerprinting the _composed_ offset chain, so a moved wrapper that is itself no participant still reads as the reflow it is).

The test method matches: watch the primary element **per frame, in absolute coordinates**, normalize steps by the sample gap (a starved rAF observer merges engine frames; a real teleport pays inside one), and bound against measured travel — because a co-moving pin can stay perfect through a jump a person cannot miss. The suite's interruption soak hammers the real gallery components with clicks at 0 / 60 / 220 ms.

```ts
import {
  setupMotion,
  animationsSettled,
  bounds,
  shape,
  orphanCount,
  strandedTransforms,
  live,
  liveAll,
  advanceGate,
  seekTo,
  velocityOf,
} from 'glimmer-motion/test-support';
```

| export                            | what it is for                                                                                                                          |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `setupMotion(hooks)`              | resets what outlives an owner: beacon registry, far-match barrier, motion speed                                                         |
| `animationsSettled(opts?)`        | resolves when every motion element, layout animation and `<Choreo>` run has stopped — and names what was still moving when it times out |
| `bounds(el)` / `shape(el)`        | rects relative to the test root; the cumulative 2×2 transform                                                                           |
| `orphanCount()`                   | leavers currently parked in an orphan layer                                                                                             |
| `strandedTransforms()`            | elements wearing a transform nobody is animating                                                                                        |
| `live(sel)` / `liveAll(sel)`      | querySelector that declines mid-flight ghosts in the orphan layer — a person never clicks one, a selector must not either               |
| `advanceGate()` / `seekTo(s)`     | drive a parked run; scrub to a second                                                                                                   |
| `velocityOf(el, prop)`            | how fast a value is moving right now                                                                                                    |
| `isMotionIdle()` / `whatIsBusy()` | the probe underneath, for a custom wait                                                                                                 |

`animationsSettled()` is explicit rather than a blocking test-waiter on purpose: the interruption suite's whole method is to click again while something is still in flight, and a waiter would silently turn every one of those into a wait-for-completion.

## External clocks: choreo-player

`choreo-player` is a dependency-free, headless transport for clocking public Choreo runs from outside — a frame-by-frame video renderer, parallel capture workers, a custom scrub surface. It owns runs you hand it (never before an external clock has actually arrived — [docs/demo-recording.md](docs/demo-recording.md) is the field guide for keeping a demo correct both interactively and under capture), and its run contract is structural and five members small:

```ts
import { createChoreoPlayer } from 'choreo-player';

const player = createChoreoPlayer({
  duration: 12,
  prepare: () => mountScore(), // the first external clock arms the demo
  runs: () => (scoreRun ? [scoreRun] : []), // read per operation, never leaked early
});

await player.renderAt(4.25); // pause, set speed and absolute time, settle — frame t is a function of t
await player.play();
```

Because a Choreo still is a computed frame, `renderAt(t)` is deterministic across workers on separate pages — no wall clock, no accumulation, no frame counting.

## DOM in 3D: c.Camera3D

A `<Choreo>` region can be a plane in a three.js scene — live DOM, still clickable, still animating, with WebGL glass composited over it. Two stages ship on this: **Mockup** (a phone) and **Long Take** (a laptop whose screen is running a second camera of its own).

```gts
<Choreo @onCamera3D={{this.pose}} as |c|>
  <c.Sequence>
    <c.Camera3D @dolly={{0.6}} @yaw={{-18}} @pitch={{12}} @duration={{2.4}} @ease={{GLIDE}} />
    <c.Camera3D @by={{true}} @x={{0.08}} @duration={{2.1}} @ease='linear' />
  </c.Sequence>
</Choreo>
```

`c.Camera3D` carries an **orbit pose in the terms a shoot uses** — `dolly` (distance as a multiple of the host's own framing), `pitch` and `yaw` in degrees, `x` / `y` as truck and pedestal in fractions of the framed height, because dolly alone pushes a tall subject's head out of the picture. `@by` adds to the pose in force instead of replacing it: Pan's rule, in 3D.

**Choreo does not own a renderer and does not pretend to.** The step is a pure function of the run's clock and hands the host a five-number pose through `@onCamera3D`; the host applies them to three.js, a CSS 3D stage, or anything else that can take a pose. So a 3D shot seeks like every other score — `run.time`, gates, `choreo-player` — with no rAF and no accumulation of its own.

The mapping from three.js to CSS is **85 lines** (`test-app/app/lib/css3d.ts`): three pure functions over a 4×4 matrix, against 454 for three's own `CSS3DRenderer`, because Glimmer already owns the elements and the change tracking and Choreo already owns the clock. The screen is a hole punched in the canvas with `NoBlending` — and because that hole is depth-tested, the laptop's own keyboard occludes the live DOM behind it for free.

[docs/dom-in-3d.md](docs/dom-in-3d.md) is the write-up: what the two shipped cases cost, what floating cards, anchored pop-ups and effects over DOM would add, and the two things that stay hard regardless of line count.

## The film: `<Film>`

Two films were cut by hand on the same engine before the construct was written — **Towers** (`/towers`) and **Sagrada Família** (`/sagrada`) — and 69% of the second was the first. `<Film>` is that 69%, lifted: a headless cutting room in which a 3D page takes the place of the video track, and everything else is a component reading one clock — the chased lens, the joins (wipe, dip, blend, iris, melt, blur, luma, flash, defocus), the lower third and the plate on Choreo, the timeline, the voice with its measured reads, the transport, the front door and the end card.

```gts
import { Film, IframePicture } from 'glimmer-motion/film';

<Film @name='sagrada' @seek='exact' @clock={{CLOCK}} @over='everything'>
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

A film is a GRAPH: a spine of chapters and shots with everything else
attached to a shot, compiled to the shot list the engine runs. Its script
carries the reads measured by ffprobe, the geometry sampled off its
model, and an identity block. The one-task behaviours — walk up the street and only then put your head back, follow the part being built, no line on a thing still going up — are beat fields with their handles exposed. The picture is a port (`Picture`), so a third film can hand in something other than an iframe.

[docs/film.md](docs/film.md) is the **as-built reference**: every argument and block, the beat table, the clock and its one-tick cue offset, the two seek modes, the `Picture` port — and the section that matters most for the rest of the library, how `<Film>` composes with the other constructs rather than replacing them. It is an ordinary consumer of `<Choreo>`: one `c.Camera3D @through` for the entire picture, one `c.Perform` per beat anchored with `at('film')`, the lower third on its own region, and — in exact mode — two Choreo runs the film drives by writing `run.time` instead of playing them.

[docs/film-graph/](docs/film-graph/) is the design record for the graph — the memo, the constructs, the revisions log and the plan — and [notes/film-construct.md](notes/film-construct.md) is the record behind the construct itself: the two reference films, the duplication measured, the fork between a seekable film and a chased one, and what was built.

---

## The binding underneath

Everything below this line is **`glimmer-motion`** proper: Motion's own implementation driven through Glimmer, covered by ports of the upstream tests that pin it.

**Animation** — `initial` / `animate` / `exit` targets, keyframes, per-value transitions, `transitionEnd`; springs, tweens, inertia, `delay`, `repeat`, easings — the engine's full transition surface; **variants** with labels, functions, `custom`, propagation, `staggerChildren` / `delayChildren` / `when`; motion values (`motionValue`, `transformValue`, `animateMotionValue`) bound through `style`; static values and `MotionValue`s side by side, CSS variables, transform shorthands; SVG attribute animation and `pathLength`; `onAnimationStart` / `Complete` / `onUpdate`; unmount cleanup.

**Layout** — `layout` (`true` / `"position"` / `"size"`): FLIP with the projection tree's scale correction (border radius, box shadow, children don't distort); `layoutId` shared-element transitions, crossfade, lead/follow promotion, the lightbox pattern; `<LayoutGroup>` with `@id` and `@inherit`; `layoutDependency`, `layoutScroll`, `layoutRoot`, `layoutAnchor`, `layoutCrossfade`, `onLayoutMeasure`; nested and relative projection targets; portals, `instantLayoutTransition()`, `layoutChange()` / `snapshotAll()` / `requestSettle()`.

**Presence** — `<Presence>` = AnimatePresence: `sync` / `wait` / `popLayout`, `@initial={{false}}`, `@custom`, `@onExitComplete`, nested presence with `@propagate`; `h.isPresent` (tracked); exit-then-enter of the same key; a leaving item keeps its last props; interaction with `layout` / `layoutId`.

**Drag** (Motion's pan/drag session, vendored verbatim) — `drag` / axis locks / `dragPropagation` / `dragListener`; constraints as object, element or ref, `dragElastic`, `dragMomentum`, `dragTransition`, `dragSnapToOrigin`, re-measure on resize; `createDragControls()` with `snapToCursor`; `whileDrag` and the full handler set; pan handlers; drag inside `layout` / `layoutId`, nested draggables, drag under scroll; `transformPagePoint` with `correctParentTransform()` and `transformViewBoxPoint()`.

**Gestures** — `whileHover` / `whileTap` / `whileFocus` / `whileInView` with their handlers, keyboard tap activation, `globalTapTarget`, viewport options, gesture priority; `<MotionConfig @transition @reducedMotion @transformPagePoint @skipAnimations @nonce>` — and `@reducedMotion` defaults to **`"user"`** here, not React's `"never"`: honouring a platform setting is not a feature. `scrollProgress()` and `InView` over Motion's `scroll()` / `inView()`.

**Reorder** — `<ReorderGroup>` / `<ReorderItem>` on real `ul` / `li`; axis detection; auto-scroll near edges; works inside `<Presence>`.

**Glimmer** — `.gts` with Glint signatures throughout; plain-function template helpers (`to`, `spring`, `tween`, `inertia`, `stagger`, `ease`) so a template is not written in `(hash)`; a v2 addon, ESM, tree-shakeable; host hooks isolated in ~40 lines so the engine glue can be re-hosted.

## Why the engine is untouched

Motion's React library is two things. An animation engine — `motion-dom`: motion values, springs and keyframes, the _projection tree_ that does layout animation and scale correction, the pan/drag session — and a thin layer of React that feeds that engine props at the right moments. The engine is framework-free and published on its own. Only the glue is React.

So this package does not re-implement animation, and it does not fork Motion. It binds the engine to Glimmer's rendering lifecycle and reproduces, exactly, the _ordering_ React's glue gives the engine:

- visual elements are constructed **parents-first during render** and mounted **children-first in effects**;
- every element that re-renders **snapshots its layout before the DOM changes**, the root **measures after**;
- presence is announced **after the commit**, and a leaving element is rendered **from its last element** — its props frozen;
- the engine's own update runs in a microtask **after all of that**, never between a render and its mounts.

Getting those right is the whole job. When they are right, the engine's behaviour matches Motion to the pixel — which is not an aspiration but the thing we measure.

## How it was made

Choreo started as the motion layer of a port: a React app built on Motion (the "bentobox" reference, frozen as ground truth) moving to a modern Vite/Embroider Ember app. The first question was how much work Motion needed to run under Glimmer. The answer turned out to be "none, if you don't touch it."

**Strategy.** Cardstack had done this once before with [boxel-motion](https://github.com/cardstack/boxel), a Glimmer animation library with its own engine. Comparing the two made the call obvious: Motion's value is in the engine (the projection tree especially), and that engine is already framework-free. The binding would use `motion-dom` as-is and replicate only the React glue — and it would be held to the standard of Motion's own tests rather than our eyes.

**Method: port the test suite, in order, and let it drive the binding.** Each step ported one of Motion's Jest suites or Cypress fixture specs line by line — the fixture components rebuilt as Glimmer components, the literal expected pixel values kept — and whatever failed was a place where the binding's ordering differed from React's. In sequence: the animate prop, variants, AnimatePresence, LayoutGroup, keyframes and delay, the style prop and unmount, then the eighteen `layout-*` Cypress specs, then the nineteen `drag-*` specs, then Reorder. Nothing was declared done on a behaviour until the upstream test for it was green in a real Chrome.

**What that surfaced.** Almost everything a port like this gets wrong is a timing rule, and the tests found each one:

- Glimmer installs modifiers children-first, so a child can't find its parent's visual element when its modifier first runs. First runs queue; the queue constructs in document order and mounts post-order after the pass — and sibling order matters, because the engine's stagger index is built from it.
- There is no `getSnapshotBeforeUpdate`. boxel-motion's render detector — a getter consuming `@glimmer/validator`'s `VOLATILE_TAG` re-evaluates on every render pass — lets `<LayoutGroup>` snapshot every projection node before the DOM changes, the way React re-rendering each motion component would.
- The engine's update microtask must not run between Glimmer's render and the mounts, or it clears snapshots and layout animations become identity transitions. One settle per pass, after the mounts.
- An element created already-absent must still mount _present_ and then leave, or its exit is swallowed.
- AnimatePresence renders a leaving child from its last present element; a live Glimmer block doesn't. The modifier freezes an exiting element's props — React's behaviour, arrived at from a failing Cypress fixture.
- `initial` values must be in the DOM before the projection first measures; React has them in the style attribute synchronously, so the binding renders them synchronously at mount.
- A Cypress page is fresh per test; a test runner isn't. The document projection node caches scroll per `animationId` and leaked a stale offset across tests until the harness reset it the way a page visit does.

**And then the choreography earned its own list.** The same discipline — ship nothing a test didn't force — produced the region model's rules: the fast keep that declines noise passes without touching the world; page-space deltas so a region can move in the pass that moves its children; the release-measure-reassert cycle that makes every measurement a _resting_ measurement; screen-CTM mapping for every place a client rect becomes local pixels (orphan locks, raises, scroll targets, tether ink — each was found double-scaling under an external transform, each is now pinned by a fixture inside a scaled wrapper); and the derived-value API redesign that [postmortem-follow.md](docs/postmortem-follow.md) documents in full.

**Packaging.** With the suite green the binding was split along the line the imports already drew: `MotionNode` (one element's lifecycle, no host framework), the layout pipeline, the features and a `postRender` scheduler on one side; the `ember-modifier` shell, the scheduler's runloop adapter and the Glimmer components on the other. That second side is about forty lines plus the components — the surface another Glimmer host (a SES-sandboxed renderer, say) re-implements to reuse everything else.

## Fidelity

The suite has two halves, and they answer different questions.

**Is it Motion?** `test-app` carries the upstream ports: the Jest suites (animate prop, variants, AnimatePresence, LayoutGroup, keyframes/delay, style prop, unmount) and the Cypress fixtures (all `layout-*`, all `drag-*`, `drag-to-reorder`, `drag-tabs`) — the fixture components rebuilt as Glimmer components with the literal expected pixel values kept. Where a literal was changed the reason is inline; each is a Cypress-runner artefact. Environment deltas are documented the same way.

**Does the choreography model hold?** `<Choreo>` is not Motion's, so it has no upstream test to inherit. It has a contract suite that states its rules on small fixtures — nesting, beacon lifetime, undo, far matching, orphan ownership, anchors, composite steps, derived-value purity (a test literally vandalises the page mid-window and asserts the frame at _t_ does not change), gate retreat, continuity from both sides, and the external-scale rules — plus per-frame interruption tests and a soak that hammers the real gallery.

**589 cases — 587 pass, 2 are upstream's own `it.skip`.**

```
pnpm install && pnpm test     # builds the addon, runs the suite (a development-mode build, as boxel does) in Chrome
```

## API

Named exports from `glimmer-motion`; deep imports (`glimmer-motion/presence`, …) are the same modules.

### `{{motion}}` — `motion.div`, `motion.circle`, … as a modifier

Any element. Named arguments are Motion's props — same names, same types (`MotionNodeOptions` from `motion-dom`):

| group            | props                                                                                                                                                                                                                                                     |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| animation        | `initial` `animate` `exit` `variants` `transition` `custom` `inherit` `onAnimationStart` `onAnimationComplete` `onUpdate`                                                                                                                                 |
| layout           | `layout` `layoutId` `layoutDependency` `layoutScroll` `layoutRoot` `layoutCrossfade` `layoutAnchor` `onLayoutMeasure`                                                                                                                                     |
| drag             | `drag` `dragConstraints` `dragElastic` `dragMomentum` `dragSnapToOrigin` `dragDirectionLock` `dragPropagation` `dragTransition` `dragControls` `dragListener` `onDragStart` `onDrag` `onDragEnd` `onDirectionLock` `onMeasureDragConstraints` `whileDrag` |
| pan              | `onPanStart` `onPan` `onPanEnd` `onPanSessionStart`                                                                                                                                                                                                       |
| style            | `style` — static values land on the element as React's style attribute would; `MotionValue`s are bound                                                                                                                                                    |
| choreo           | `id` `role` — participation in the nearest `<Choreo>` region                                                                                                                                                                                              |
| glimmer-specific | `presence` — the handle a `<Presence>` block yields; `transformPagePoint` — per element, or inherited from `<MotionConfig>`                                                                                                                               |

### `<Choreo>` — the region

`@id` (nesting and far matching), `@route` (a route swap inside is one pass), `@scroll` (`'top'` or a thunk — applied inside the pass, before final bounds), `@quiet` (pause the rest of the page for the run's span), `@debug` (outlines + `console.table` per run). Yields the context: the step components (`Sequence` `Parallel` `Gate` `Tween` `Spring` `Move` `Hold` `Wait` `Raise` `Scroll` `Camera` `Tether` `Follow` `Crossing`), the queries, `c.beacon` / `c.gesture`, and `c.run` — `advance()` `retreat()` `time` `speed` `parked` `standing` `segment` `finished`.

Timing: `@duration` / `@delay` in seconds, `@spring` for spring specs, `@stagger` across a query's sprites; `@name` / `@at={{at 'name'}}` / `after('name')` on steps _and blocks_. Any property may be a function `(sprite, changeset) => value`; sprites carry `initial` / `final` bounds in `context`, `parent` and `page` space, a `delta`, and their `counterpart`. Open vocabulary: `StepComponent` + `toMs` + node literals ([docs/step-vocabulary.md](docs/step-vocabulary.md)).

### `<Presence>` / `<LayoutGroup>` / `<ReorderGroup>` + `<ReorderItem>` / `<MotionConfig>`

As in Motion — see [React → Glimmer](#react--glimmer). `<Presence>` keeps leaving items rendered until their exit finishes (`@mode`, `@initial`, `@custom`, `@onExitComplete`, `@propagate`); `<LayoutGroup>` namespaces `layoutId`s and hosts the render detector; outside one, wrap the state change in `layoutChange(() => …)`.

### Template helpers

Plain functions, no registration: `(to opacity=0 y=20)`, `(spring stiffness=300 damping=30)`, `(tween …)`, `(inertia …)`, `(stagger 0.05)`, `(ease 0.4 0 0.1 1)`. Typed, which is the difference: `(hash opacty=1)` is a perfectly good hash, and `(to opacty=1)` is a Glint error. `(hash …)` remains valid everywhere.

### Drag helpers and motion values

`createDragControls()`, `correctParentTransform(elOrRef)`, `transformViewBoxPoint(svgOrRef)`. For motion values use `motion-dom` directly — `motionValue()`, `transformValue()`, `animateMotionValue()` — and hand them in through `style`.

## React → Glimmer

| React                                          | here                                                                         |
| ---------------------------------------------- | ---------------------------------------------------------------------------- |
| `<motion.div …>`                               | `<div {{motion …}}>` — any tag, including SVG                                |
| `ref`                                          | the element itself, or a `{current}` object filled by a modifier             |
| `useMotionValue`, `useTransform`               | `motionValue`, `transformValue` from `motion-dom`                            |
| `<AnimatePresence>` with keyed children        | `<Presence @items @key>` yielding a handle                                   |
| `useIsPresent()`                               | `h.isPresent`                                                                |
| `<LayoutGroup>`                                | `<LayoutGroup>` (also the render detector)                                   |
| re-render of a motion component → snapshot     | any render pass inside a `LayoutGroup` / `ReorderGroup`, or `layoutChange()` |
| `<MotionConfig transition transformPagePoint>` | `<MotionConfig>` — same args, found by DOM proximity                         |
| `useDragControls()`                            | `createDragControls()`                                                       |
| `useScroll()` / `useInView()`                  | `scrollProgress()` / `new InView(…)` — no hooks, so no `use` prefix          |
| `Reorder.Group` / `Reorder.Item`               | `<ReorderGroup>` / `<ReorderItem>`                                           |
| —                                              | `<Choreo>`: region-scoped timelines over a render pass's changeset           |

## Three rules React does not need

React's model hides three things that Glimmer's does not, and each surfaced while porting a real app onto this binding. They are the only places where the port is not a mechanical translation.

**1. Motion owns a motion element's inline style — pass CSS through the modifier, not a `style` attribute.** In React the `style` prop belongs to Motion: it merges what you write with the transforms it renders. In Glimmer a bound `style="…"` attribute is yours, and Glimmer rewrites the whole declaration whenever the bound value changes — wiping out the transform Motion just wrote. The symptom is brutal and quiet: a card that stays put while the drag logic runs perfectly around it.

```gts
{{! ✗ the next re-render erases the drag transform }}
<div class="card" style={{this.accentStyle}} {{motion drag=true}}>

{{! ✓ Motion applies these itself, custom properties included }}
<div class="card" {{motion style=this.accentStyle drag=true}}>
```

**2. A leaving child stays live — read exiting content from the yielded item.** React keeps the _element tree_ it captured before the diff, so a leaving child cannot re-render. A Glimmer block re-runs from live tracked state for as long as the leaver is on screen. So anything the exit needs — the symbol the panel was showing, the rect the modal flew from — has to ride on the item `<Presence>` yields, not be read back out of state that has already moved on.

**3. Declare what you want tweened — a value in the stylesheet is invisible to the engine.** A layout animation moves and resizes by transform, and the engine corrects `borderRadius` and `boxShadow` against the scale in force — but only values it holds. A radius that lives in CSS is not one, and a square tile growing into a wide hero comes out with oval corners. Hand the value to Motion and every frame is corrected.

```gts
{{! ✗ the engine cannot correct what it does not know about }}
<article class='card' {{motion layout=true}}></article>   /* .card { border-radius: 14px } */

{{! ✓ corrected per frame, against whatever scale the layout animation is applying }}
<article class='card' {{motion layout=true style=(styles borderRadius='14px')}}></article>
```

## Testing

See [Interruption, tested](#interruption-tested) for the test-support surface. The suite is in halves: `tests/integration/choreo/contract-test.gts` states the choreography rules on fixtures small enough that a failure names the defect; sibling suites cover the crossing, gates and retreat, continuity, wires, raise/scroll, far matching, and derived values; `interruption-test.gts` is the soak. The binding's half is the upstream ports ([Fidelity](#fidelity)).

## Architecture

```
motion-dom (engine, unchanged)
   ▲  30 public exports
node.ts        MotionNode — one element's lifecycle, no host framework: construct in document order,
               mount post-order after the pass, update, freeze props while exiting, tear down
layout.ts      snapshot → mount → measure → settle (React's getSnapshotBeforeUpdate / componentDidUpdate timing)
features.ts    animation / exit / layout / drag / pan registrations, and the scale correctors
scheduler.ts   postRender(fn): the single host hook — "after this render pass has committed"
activity.ts    who is still moving, and why — what animationsSettled() waits on
helpers.ts     to / styles / from / spring / tween / inertia / perValue / stagger / ease
gestures/      Motion's pan + drag session, vendored verbatim (VENDORED.md)
reorder/       Reorder's checkReorder / detectAxis / auto-scroll, vendored verbatim
choreo/        the choreography layer: changeset, compile, run, anchors, beacons, arming,
               far-match barrier, measure — the region model in ~a dozen modules
test-support/  animationsSettled, bounds, live, orphanCount, … — a published entrypoint
   ▲  Ember host adapter
motion.ts      {{motion}} — the ember-modifier shell; installs the runloop as postRender
presence.gts, layout-group.gts, motion-config.gts, choreo.gts, reorder/{group,item}.gts
```

Only the last two lines know about Ember. Re-hosting means re-doing the modifier shell, the `postRender` adapter and the components; everything above the adapter line is untouched. `choreo-player` sits beside all of it, dependency-free, speaking only the run contract.

## Not ported (yet)

`m` / `LazyMotion` (a React bundle-splitting device; the addon is tree-shaken per module already), Reorder's `as` prop (the group is a `ul`, items are `li`), server rendering.

## Examples

`test-app` serves a gallery of **42 stages** at `/` — filter by **Animate**, **Layout**, **Drag**, **Scroll**, **Choreo**, **3D**, **Timeline**, or **Deep Dive**, and open any one for its annotated source. Most stages carry a speed control (**Full · ÷2 · ÷5 · ÷10**); a transition you cannot see is a transition you cannot judge, and the divisor scales the transition on its way to the engine rather than slowing a running animation, so what you watch at ÷10 is the same motion, born slower. The gallery ⇄ demo navigation is itself the crossing, eating its own cooking on every click.

Every demo is also a test fixture: the interruption soak hammers them, which is why they are the first place a regression shows up.

```
pnpm --filter test-app start
```

## Development

```
pnpm install
pnpm build                     # packages/glimmer-motion → dist/ + declarations/
pnpm test                      # build, then test-app: vite build --mode=development --out-dir dist-tests && ember test --path dist-tests
pnpm lint:types                # glint, both packages
pnpm --filter test-app start   # examples at / ; tests at /tests
pnpm realm:stage               # hashed realm bundle + stable choreo.ts entrypoint
```

`pnpm realm:stage` flattens the built addon plus the motion.dev engine into a
content-hashed `builds/choreo-<hash>.ts` plus a one-line `choreo.ts` re-export
for a [Boxel](https://github.com/cardstack/boxel) realm — only `@ember/*`,
`@glimmer/*` and `ember-modifier` stay external, resolved by the host. `pnpm
realm` mirrors both into the workspace in `.choreo-realm-sync.json` and
publishes them with `boxel file write`. Old hashes stay on the realm; rolling
back is changing the re-export. See
`packages/glimmer-motion/scripts/build-realm-bundle.mjs` and the
[realm publishing guide](docs/realm-publishing.md).

`packages/glimmer-motion/VENDORED.md` lists every file copied verbatim from Motion and the upstream commit (`motion@bbabb00`); re-diff them when bumping `motion-dom`. The Cypress-port harness lives in `test-app/tests/helpers/layout-fixture.ts`.

## Roadmap

- **`0.1.0` on npm.** Consumers today use `workspace:*` against a checkout. A version number is what turns "copy this style" into a dependency, and it is the gate for everything below.
- **`ember-try` against LTS** (5.12 / 6.4 / release). The peer range already says `>= 5.4`; nothing proves it.
- **`ember-a11y-testing` over the gallery.** `reducedMotion` already defaults to `"user"`, which was the substantive half; a smoke pass is the other half.
- **Docs for the newest constructs** — standing steps and `createArming` landed test-first; their prose is owed.
- **boxel-motion** — a re-host inside [cardstack/boxel](https://github.com/cardstack/boxel) for its constraints (SES-sandboxed card code, cross-realm orchestration, fitted vs embedded intrinsic sizing). It replaces the modifier shell, the scheduler adapter and the components and keeps everything above the adapter line. Three host transitions are the proving ground: a stack open/close (far match), a panel that is its own scene over a moving shell (nested `<Choreo>`), and compose/trash (`{{beacon}}`, not `layoutId`).

## License

MIT. © 2026 Cardstack Foundation. See [LICENSE](LICENSE).

## Credits

The engine, the algorithms and the test suites are [Motion](https://motion.dev) ([motiondivision/motion](https://github.com/motiondivision/motion), MIT). The render-detector idea and the choreography model's ambitions are from [boxel-motion](https://github.com/cardstack/boxel). This package is the Glimmer binding and the choreography layer, by Cardstack.
