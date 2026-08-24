# Choreo

**Motion, Choreo-graphed.** Choreography for Ember. `<Choreo>` watches a whole render pass and
hands you its **changeset** — what was inserted, removed and kept, and where each of them stood
before and after — then plays a timeline you declare over it. A scene that is sequenced, rather
than a set of elements each animating on its own.

```gts
import { Choreo, motion } from 'glimmer-motion';

<template>
  <Choreo as |c|>
    {{#each this.cards key='id' as |card|}}
      <div {{motion id=card.id role='card'}}>{{card.title}}</div>
    {{/each}}

    <c.Sequence>
      <c.Tween @of={{c.removed 'card'}} @opacity={{0}} @ms={{220}} />
      <c.Move @of={{c.moved 'card'}} @spring={{this.soft}} />
      <c.Tween @of={{c.inserted 'card'}} @opacity={{1}} @ms={{260}} />
    </c.Sequence>
  </Choreo>
</template>
```

Underneath it, **`glimmer-motion`** binds the [Motion](https://motion.dev) engine to Glimmer:
`motion-dom`, untouched, as a modifier and a handful of components — layout, shared-element
transitions, presence, variants, drag, reorder. That binding is a complete, usable port in its own
right, and it is what Choreo stands on. Both ship in the one package.

```gts
import { motion, Presence, LayoutGroup, to, spring } from 'glimmer-motion';

<template>
  <LayoutGroup>
    <Presence
      @items={{this.cards}}
      @key={{this.keyOf}}
      @mode='popLayout'
      as |card h|
    >
      <div
        {{motion
          presence=h
          layoutId=card.id
          initial=(to opacity=0 y=20)
          animate=(to opacity=1 y=0)
          exit=(to opacity=0 scale=0.9)
          transition=(spring stiffness=300 damping=30)
          drag='x'
          dragSnapToOrigin=true
        }}
      >{{card.title}}</div>
    </Presence>
  </LayoutGroup>
</template>
```

> Naming: Motion (motion.dev) is the library formerly called framer-motion; its React package is still
> published as `framer-motion`, which is why upstream paths in this repo read `packages/framer-motion/…`.

**New here?** [docs/guide.md](docs/guide.md) teaches this from a Glimmer card rather than from a React
translation table. The rest of this document is the reference: what Choreo adds, what the binding
covers, and where each piece of Motion went.

- [Features](#features)
- [Why the engine is untouched](#why-the-engine-is-untouched)
- [How it was made](#how-it-was-made)
- [Fidelity](#fidelity)
- [Install](#install) · [API](#api) · [React → Glimmer](#react--glimmer)
- [Three rules React does not need](#three-rules-react-does-not-need) · [Testing](#testing)
- [Architecture](#architecture)
- [Not ported](#not-ported-yet)
- [Development](#development) · [Roadmap](#roadmap) · [Credits](#credits)

## Features

**Choreography** — Choreo's own, and the reason this repo exists: a region-scoped model Motion's
per-element API has no equivalent for ([docs/choreography.md](docs/choreography.md);
[nested regions and beacons](docs/nested-choreo.md))

- `<Choreo>` watches its render passes and hands each one's **changeset** — inserted / removed / kept
  participants with their bounds before and after — to a timeline declared inside it
- `c.Sequence` / `c.Parallel` blocks of `c.Tween` / `c.Spring` / `c.Move` (FLIP) / `c.Hold` / `c.Wait`
  steps; a sequence can follow a spring (its length is computed with the engine's generator)
- **z-index as a window**: `c.Hold` sets a value for the span of its block and releases it
- removed participants stay on screen, locked where they were, for as long as the timeline names them —
  no `<Presence>` needed; an inserted id that replaces a removed one carries it as a `counterpart`
- any property may be a function of the sprite and the changeset: one element's motion from another's
  measurement

Everything below this point is the `glimmer-motion` binding: Motion's own implementation, driven
through Glimmer, and covered by a port of the upstream test that pins it.

**Animation**

- `initial` / `animate` / `exit` targets, keyframes arrays, per-value `transition`s, `transitionEnd`
- springs, tweens, inertia, `delay`, `repeat`, easing names and cubic-beziers — the engine's full transition surface
- **variants** with labels, variant functions with `custom`, propagation down the element tree,
  `staggerChildren` / `delayChildren` / `staggerDirection` / `when: "beforeChildren" | "afterChildren"`
- motion values: `motionValue`, `transformValue`, `animateMotionValue`, springs — bound through `style`
- `style` with static values and `MotionValue`s side by side; CSS variables; transform shorthands (`x`, `rotate`, `scale`…)
- SVG elements (`<circle>`, `<rect>`, `<path>` …): attribute animation, `pathLength`, CSS transforms
- `onAnimationStart` / `onAnimationComplete` / `onUpdate`, `AnimationControls` via `animate`
- unmount cleanup of animations and motion values

**Layout**

- `layout` (`true` / `"position"` / `"size"`) — FLIP layout animation with the projection tree's scale correction
  (border radius, box shadow, children don't distort)
- `layoutId` shared-element transitions between elements, crossfade, lead/follow promotion, the lightbox pattern
- `<LayoutGroup>` with `@id` namespacing and `@inherit`
- `layoutDependency`, `layoutScroll`, `layoutRoot`, `layoutAnchor`, `layoutCrossfade`, `onLayoutMeasure`
- nested and relative projection targets (a child following an animating parent)
- portals (`data-framer-portal-id`), `instantLayoutTransition()`, `layoutChange()` / `snapshotAll()` / `requestSettle()`

**Presence**

- `<Presence>` = AnimatePresence: `sync` / `wait` / `popLayout` modes, `@initial={{false}}`, `@custom`,
  `@onExitComplete`, nested presence with `@propagate`
- `h.isPresent` (tracked), exit-then-enter of the same key, a leaving item keeps its last props
- interaction with `layout` and `layoutId` (exiting lead hands over to the entering follower)

**Drag** (Motion's pan/drag session, vendored verbatim)

- `drag` on `true` / `"x"` / `"y"`, `dragDirectionLock`, `dragPropagation`, `dragListener`
- `dragConstraints` as an object, an element or a `{current}` ref; `dragElastic`, `dragMomentum`,
  `dragTransition`, `dragSnapToOrigin`, `onMeasureDragConstraints`; constraints re-measured on resize
- `createDragControls()` with `snapToCursor`; `whileDrag`; `onDragStart` / `onDrag` / `onDragEnd` / `onDirectionLock`
- pan handlers (`onPanStart` / `onPan` / `onPanEnd` / `onPanSessionStart`)
- drag inside `layout` / `layoutId` elements, nested draggables, drag while the page or a container scrolls,
  interactive children (inputs, selects, contenteditable) don't start a drag
- `transformPagePoint` with `correctParentTransform()` (rotated / scaled parents) and
  `transformViewBoxPoint()` (`<svg viewBox>`)

**Gestures** (Motion's hover / press / focus / viewport features)

- `whileHover`, `whileTap`, `whileFocus`, `whileInView` with their handlers (`onHoverStart`/`End`,
  `onTapStart`/`onTap`/`onTapCancel`, `onViewportEnter`/`Leave`), keyboard activation of tap, `globalTapTarget`,
  `propagate={{hash tap=false}}`, `viewport` options (`root`, `margin`, `amount`, `once`), gesture priority
  over `animate` and each other
- `<MotionConfig @transition @reducedMotion @transformPagePoint @skipAnimations @nonce>` — defaults for
  the tree, `inherit: true` transitions, nested configs. `@reducedMotion` defaults to **`"user"`** here,
  not React's `"never"`: `prefers-reduced-motion` is a platform setting, and honouring it is not a feature
- `scrollProgress()` (scroll position/progress motion values; container, target, offsets) and `InView`
  (tracked `isInView`) over Motion's `scroll()` / `inView()`, which are exported too.
  `useScroll` / `useInView` remain as deprecated aliases

**Reorder** (Motion's Reorder.Group / Reorder.Item)

- `<ReorderGroup>` / `<ReorderItem>` on `ul` / `li` with `...attributes`
- axis `"x"` / `"y"` / `"xy"` (wrapped lists), detected from the layout when not given
- auto-scroll of a scrollable ancestor near its edges; works inside `<Presence>` (the tabs demo)

**Glimmer**

- `.gts`, Glint signatures for every component and the modifier; named exports, no `Component` suffix
- plain-function template helpers — `to`, `spring`, `tween`, `inertia`, `stagger`, `ease` — so a template
  is not written in `(hash)`
- a v2 addon: Embroider and Vite apps consume it directly; ESM, tree-shakeable per module
- **`glimmer-motion/test-support`**: `animationsSettled()`, `bounds()`, `shape()`, `setupMotion(hooks)` —
  a suite that waits for motion instead of sleeping through it
- host hooks isolated in ~40 lines (`{{motion}}` shell + a `postRender` scheduler) so the engine glue can be re-hosted

## Why the engine is untouched

Motion's React library is two things. An animation engine — `motion-dom`: motion values, springs and
keyframes, the _projection tree_ that does layout animation and scale correction, the pan/drag session —
and a thin layer of React that feeds that engine props at the right moments. The engine is framework-free
and published on its own. Only the glue is React.

So this package does not re-implement animation, and it does not fork Motion. It binds the engine to
Glimmer's rendering lifecycle and reproduces, exactly, the _ordering_ React's glue gives the engine:

- visual elements are constructed **parents-first during render** and mounted **children-first in effects**;
- every element that re-renders **snapshots its layout before the DOM changes**, the root **measures after**;
- presence is announced **after the commit**, and a leaving element is rendered **from its last element** — its props frozen;
- the engine's own update runs in a microtask **after all of that**, never between a render and its mounts.

Getting those right is the whole job. When they are right, the engine's behaviour matches Motion to the
pixel — which is not an aspiration but the thing we measure.

## How it was made

Choreo started as the motion layer of a port: a React app built on Motion (the "bentobox"
reference, frozen as ground truth) moving to a modern Vite/Embroider Ember app. The first question was how
much work Motion needed to run under Glimmer. The answer turned out to be "none, if you don't touch it."

**Strategy.** Cardstack had done this once before with [boxel-motion](https://github.com/cardstack/boxel), a
Glimmer animation library with its own engine. Comparing the two made the call obvious: Motion's value is
in the engine (the projection tree especially), and that engine is already framework-free. The binding
would use `motion-dom` as-is and replicate only the React glue — and it would be held to the standard of
Motion's own tests rather than our eyes.

**Method: port the test suite, in order, and let it drive the binding.** Each step ported one of Motion's
Jest suites or Cypress fixture specs line by line — the fixture components rebuilt as Glimmer components,
the literal expected pixel values kept — and whatever failed was a place where the binding's ordering
differed from React's. In sequence: the animate prop, variants, AnimatePresence, LayoutGroup, keyframes
and delay, the style prop and unmount, then the eighteen `layout-*` Cypress specs, then the nineteen
`drag-*` specs, then Reorder. Nothing was declared done on a behaviour until the upstream test for it was
green in a real Chrome.

**What that surfaced.** Almost everything a port like this gets wrong is a timing rule, and the tests found
each one:

- Glimmer installs modifiers children-first, so a child can't find its parent's visual element when its
  modifier first runs. First runs queue; the queue constructs in document order and mounts post-order after
  the pass — and sibling order matters, because the engine's stagger index is built from it.
- There is no `getSnapshotBeforeUpdate`. boxel-motion's render detector — a getter consuming
  `@glimmer/validator`'s `VOLATILE_TAG` re-evaluates on every render pass — lets `<LayoutGroup>` snapshot
  every projection node before the DOM changes, the way React re-rendering each motion component would.
- The engine's update microtask must not run between Glimmer's render and the mounts, or it clears
  snapshots and layout animations become identity transitions. One settle per pass, after the mounts.
- An element created already-absent must still mount _present_ and then leave, or its exit is swallowed.
- AnimatePresence renders a leaving child from its last present element; a live Glimmer block doesn't. When
  a removed tab was also the selected one, its `animate` changed in the same pass as its exit and a stale
  flag from a blocked initial mount let that change restart opacity over the exit. The modifier now freezes
  an exiting element's props — React's behaviour, arrived at from a failing Cypress fixture.
- `initial` values must be in the DOM before the projection first measures (percentage transforms resolve
  against that box); React has them in the style attribute synchronously, so the binding renders them
  synchronously at mount.
- A Cypress page is fresh per test; a test runner isn't. The document projection node caches scroll per
  `animationId` and leaked a stale offset across tests until the harness reset it the way a page visit does.

**Packaging.** With the suite green the binding was split along the line the imports already drew:
`MotionNode` (one element's lifecycle, no host framework), the layout pipeline, the features and a
`postRender` scheduler on one side; the `ember-modifier` shell, the scheduler's runloop adapter and the four
Glimmer components on the other. That second side is about forty lines plus the components — the surface
another Glimmer host (a SES-sandboxed renderer, say) re-implements to reuse everything else. Then it was
lifted out of the app into this repo as a v2 addon with the suite as its test-app.

## Fidelity

The suite has two halves, and they answer different questions.

**Is it Motion?** `test-app` carries the upstream ports: the Jest suites (animate prop, variants,
AnimatePresence, LayoutGroup, keyframes/delay, style prop, unmount) and the Cypress fixtures (all
`layout-*`, all `drag-*`, `drag-to-reorder`, `drag-tabs`) — the fixture components rebuilt as Glimmer
components with the literal expected pixel values kept. Where a literal was changed the reason is inline;
each is a Cypress-runner artefact (an implicit `scrollIntoView`, `50vw` measured against the runner window,
a "this should actually be 400" comment upstream left in). Environment deltas are documented the same way:
DOM-read start values need a second frame in a real browser where jsdom collapsed the frameloop, and an
Ember `render()` settles on a timer where RTL's is synchronous.

**Does the choreography model hold?** `<Choreo>` is not Motion's, so it has no upstream test to inherit.
It has a contract suite that states its rules on small fixtures, and a soak that hammers the real gallery
(see [Testing](#testing)).

**465 cases, 463 pass, 2 are upstream's own `it.skip`.**

```
pnpm install && pnpm test     # builds the addon, runs the suite (a development-mode build, as boxel does) in Chrome
```

## The name

The repo is **Choreo** (`cardstack/choreo`). The published package is still
`glimmer-motion` — one npm name, unchanged, and every import in these docs is the
real one.

## Install

```
pnpm add glimmer-motion motion-dom motion-utils
```

Peer dependencies: `motion-dom` / `motion-utils` (pinned together), `ember-modifier`, `@glimmer/component`,
`@glimmer/tracking`, `ember-source >= 5.4`. It's a v2 addon: Embroider and Vite apps consume it directly,
with TypeScript types and Glint signatures.

## API

Named exports from `glimmer-motion`; deep imports (`glimmer-motion/presence`, …) are the same modules.

### `{{motion}}` — `motion.div`, `motion.circle`, … as a modifier

Any element. Named arguments are Motion's props — same names, same types (`MotionNodeOptions` from
`motion-dom`):

| group            | props                                                                                                                                                                                                                                                     |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| animation        | `initial` `animate` `exit` `variants` `transition` `custom` `inherit` `onAnimationStart` `onAnimationComplete` `onUpdate`                                                                                                                                 |
| layout           | `layout` `layoutId` `layoutDependency` `layoutScroll` `layoutRoot` `layoutCrossfade` `layoutAnchor` `onLayoutMeasure`                                                                                                                                     |
| drag             | `drag` `dragConstraints` `dragElastic` `dragMomentum` `dragSnapToOrigin` `dragDirectionLock` `dragPropagation` `dragTransition` `dragControls` `dragListener` `onDragStart` `onDrag` `onDragEnd` `onDirectionLock` `onMeasureDragConstraints` `whileDrag` |
| pan              | `onPanStart` `onPan` `onPanEnd` `onPanSessionStart`                                                                                                                                                                                                       |
| style            | `style` — static values land on the element as React's style attribute would; `MotionValue`s are bound                                                                                                                                                    |
| glimmer-specific | `presence` — the handle a `<Presence>` block yields; `transformPagePoint` — per element, or inherited from `<MotionConfig>`                                                                                                                               |

```gts
<div {{motion animate=(to x=this.x) style=(styles y=this.yValue) layout=true}} />
<circle cx="50" cy="50" r="20" {{motion drag=true dragConstraints=this.container}} />
```

### `<Presence>` — AnimatePresence

```gts
<Presence @items={{this.items}} @key={{this.keyOf}} @mode="sync" @initial={{false}} @custom={{this.dir}} @onExitComplete={{this.done}} as |item h|>
  <div {{motion presence=h initial=… animate=… exit=…}}>{{item.label}}</div>
</Presence>
```

Keeps leaving items rendered until their `exit` finishes. `@mode` is `"sync"` | `"wait"` | `"popLayout"`
(`@anchorX` / `@anchorY` for the latter). `h.isPresent` is tracked (`useIsPresent`). Nested presence under
a leaving parent: `@propagate={{true}} @parent={{outerHandle}}`.

### `<LayoutGroup>`

```gts
<LayoutGroup @id="tabs" @inherit={{true}}>…</LayoutGroup>
```

Namespaces `layoutId`s and hosts the render detector: any render pass inside it snapshots every projection
node before the DOM changes. Outside one, wrap the state change: `layoutChange(() => { this.items = next })`.
`instantLayoutTransition(fn)` is `useInstantLayoutTransition`.

### `<ReorderGroup>` / `<ReorderItem>`

```gts
<ReorderGroup @values={{this.items}} @onReorder={{this.setItems}} @axis="y" as |group|>
  {{#each this.items as |item|}}<ReorderItem @group={{group}} @value={{item}}>{{item}}</ReorderItem>{{/each}}
</ReorderGroup>
```

`ReorderItem` forwards `@style @initial @animate @exit @whileDrag @transition @dragTransition @dragListener
@dragControls @presence @onDrag @onDragEnd @layout`.

### `<Choreo>` — choreography

```gts
<Choreo as |c|>
  <div {{motion id=card.id role="card"}}>…</div>

  <c.Sequence>
    <c.Parallel>
      <c.Hold  @of={{c.role "card"}} @zIndex={{1}} />
      <c.Tween @of={{c.removed "card-content"}} @opacity={{0}} @ms={{220}} />
    </c.Parallel>
    <c.Parallel>
      <c.Move  @of={{c.moved "card"}} @spring={{soft}} />
      <c.Hold  @of={{c.still "card"}} @zIndex={{0}} />
    </c.Parallel>
    <c.Tween @of={{c.inserted "card-content"}} @opacity={{1}} @from={{hash opacity=0}} @ms={{260}} />
  </c.Sequence>
</Choreo>
```

A motion element with `id` or `role` is a participant of the nearest `<Choreo>`. Each render pass the
region measures its participants before and after the DOM changes and, when something was inserted,
removed, or moved, plays the timeline declared inside it. Queries: `c.all` `c.kept` `c.inserted`
`c.removed` `c.still` `c.moved` (optionally by role), `c.role` `c.id`. Steps: `Tween` (`@ms @ease`),
`Spring` (`@spring`), `Move` (FLIP from initial to final bounds), `Hold` (set for the block's span, or
`@ms`; `@fill` keeps), `Wait`; all take `@of`, `@delay`, and properties as flat args; `@from` as a hash.
A property may be a function `(sprite, changeset) => value`; sprites carry `initial` / `final` bounds in
`context`, `parent` and `page` space and a `delta`. `@debug` outlines and `console.table`s each run.
The design and the legacy it keeps: [docs/choreography.md](docs/choreography.md).
Nested regions and beacons: [docs/nested-choreo.md](docs/nested-choreo.md).

### Template helpers

Plain functions, used as helpers with no registration. Glimmer hands a plain function its positional
arguments and its named arguments as one trailing object — which is the shape `spring({ stiffness: 300 })`
already wanted.

```gts
import { motion, to, spring } from 'glimmer-motion';

<div
  {{motion
    initial=(to opacity=0 y=20)
    animate=(to opacity=1 y=0)
    exit=(to opacity=0 scale=0.9)
    transition=(spring stiffness=300 damping=30)
  }}
></div>
```

| helper               | returns                                                          |
| -------------------- | ---------------------------------------------------------------- |
| `(to …)`             | a target — the values to animate to                              |
| `(spring …)`         | `{ type: 'spring', … }`; also fits a `<Choreo>` step's `@spring` |
| `(tween …)`          | `{ type: 'tween', … }` — `duration` in seconds                   |
| `(inertia …)`        | `{ type: 'inertia', … }` — the throw after a drag                |
| `(stagger 0.05)`     | motion-dom's own `stagger`, for `delayChildren`                  |
| `(ease 0.4 0 0.1 1)` | a cubic bezier. Named easings are plain strings                  |

`(hash …)` remains valid everywhere. The helpers are typed, which is the difference: `(hash opacty=1)` is a
perfectly good hash, and `(to opacty=1)` is a Glint error.

`to` rather than `animate`, because it reads correctly in all four slots — `initial=(to …)`, `exit=(to …)`,
`whileHover=(to …)` — where `animate=(animate …)` does not, and it leaves the name free for Motion's
imperative function.

### Drag helpers

`createDragControls()` (`useDragControls`: `controls.start(event, { snapToCursor: true })`),
`correctParentTransform(elOrRef)`, `transformViewBoxPoint(svgOrRef)`.

### Motion values

Use `motion-dom` directly — `motionValue()`, `transformValue()`, `animateMotionValue()` — and hand values
in through `style`; that's what `useMotionValue` / `useTransform` do in React.

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

React's model hides three things that Glimmer's does not, and each surfaced while porting a real app
(the [bentobox](https://github.com/christse/bento-boxel) workspace) onto this binding. They are the
only places where the port is not a mechanical translation.

**1. Motion owns a motion element's inline style — pass CSS through the modifier, not a `style`
attribute.** In React the `style` prop belongs to Motion: it merges what you write with the
transforms it renders. In Glimmer a bound `style="…"` attribute is yours, and Glimmer rewrites the
whole declaration whenever the bound value changes — wiping out the transform Motion just wrote. The
symptom is brutal and quiet: a card that stays put while the drag logic runs perfectly around it.

```gts
{{! ✗ the next re-render erases the drag transform }}
<div class="card" style={{this.accentStyle}} {{motion drag=true}}>

{{! ✓ Motion applies these itself, custom properties included }}
<div class="card" {{motion style=this.accentStyle drag=true}}>
```

**2. A leaving child stays live — read exiting content from the yielded item.** React keeps the
_element tree_ it captured before the diff, so a leaving child cannot re-render and nothing can
mount inside it. A Glimmer block re-runs from live tracked state for as long as the leaver is on
screen. So anything the exit needs — the symbol the panel was showing, the rect the modal flew from
— has to ride on the item `<Presence>` yields, not be read back out of the state that has already
moved on.

The engine side of that second rule is handled here: a motion element that mounts inside a leaving
subtree can never block its exit, and a presence flip reaches every motion descendant (React
re-renders them all; Glimmer only re-runs the modifiers whose own args changed). Both are covered by
tests — without them a leaver can hang on screen forever.

**3. Declare what you want tweened — a value in the stylesheet is invisible to the engine.** A layout
animation moves and resizes by transform, so everything inside a growing element is scaled with it. The
engine corrects for that, on `borderRadius` and `boxShadow` — but it can only correct a value it holds. A
radius that lives in CSS is not one, and a square tile growing into a wide hero comes out with oval
corners. Hand the value to Motion and every frame is corrected against the scale in force.

```gts
{{! ✗ the engine cannot correct what it does not know about }}
<article class='card' {{motion layout=true}}></article>   /* .card { border-radius: 14px } */

{{! ✓ corrected per frame, against whatever scale the layout animation is applying }}
<article class='card' {{motion layout=true style=(styles borderRadius='14px')}}></article>
```

This is the same instinct as rule 1 from the other side: rule 1 says Motion owns the inline style, and
rule 3 says use that ownership. Anything you want animated, corrected or measured goes through the
modifier. `test-app/app/components/examples/sequence.gts` is the worked example.

## Testing

```ts
import {
  setupMotion,
  animationsSettled,
  bounds,
  shape,
  orphanCount,
  strandedTransforms,
} from 'glimmer-motion/test-support';
```

| export                            | what it is for                                                                           |
| --------------------------------- | ---------------------------------------------------------------------------------------- |
| `setupMotion(hooks)`              | resets what outlives an owner: beacon registry, far-match barrier, motion speed          |
| `animationsSettled(opts?)`        | resolves when every motion element, layout animation and `<Choreo>` timeline has stopped |
| `bounds(el)`                      | `getBoundingClientRect()` relative to `#ember-testing`, not the viewport                 |
| `shape(el)`                       | the cumulative 2×2 transform — did a parent's scale stretch this?                        |
| `orphanCount()`                   | leavers currently parked in a `<Choreo>` orphan layer                                    |
| `strandedTransforms()`            | elements wearing a transform nobody is animating                                         |
| `isMotionIdle()` / `whatIsBusy()` | the probe underneath, for a custom wait                                                  |

`animationsSettled()` is explicit rather than an `@ember/test-waiters` waiter hooked into `settled()`.
A blocking waiter is the tidier-looking option and the wrong one here: the interruption suite's whole
method is to click again while something is still in flight, and a waiter would silently turn every one of
those into a wait-for-completion. When it times out it names what was still moving, which is usually the
bug.

The suite this backs is in two halves. `tests/integration/choreo/contract-test.gts` states the rules —
nesting, beacon lifetime, undo, far matching, orphan ownership, measuring inside a transformed parent — on
fixtures small enough that a failure names the defect. `interruption-test.gts` is the soak: it hammers the
real gallery components with ten clicks at 0 / 60 / 220 ms and asserts the two invariants above.

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
choreo/        the choreography layer: changeset, compile, run, beacons, far-match barrier, measure
test-support/  animationsSettled, bounds, shape, setupMotion — a published entrypoint
   ▲  Ember host adapter
motion.ts      {{motion}} — the ember-modifier shell; installs the runloop as postRender
presence.gts, layout-group.gts, motion-config.gts, choreo.gts, reorder/{group,item}.gts
```

Only the last two lines know about Ember. Re-hosting means re-doing the modifier shell, the `postRender`
adapter and the components; everything above the adapter line is untouched.

## Not ported (yet)

`m` / `LazyMotion` (a React bundle-splitting device; the addon is tree-shaken per module already),
Reorder's `as` prop (the group is a `ul`, items are `li`), server rendering.

## Examples

`test-app` serves a gallery of 22 stages at `/` — filter by **Animate**, **Layout**, **Drag**,
**Scroll** or **Choreo**, and open any one for its annotated source. Most stages carry a speed control
(**Full · ÷2 · ÷5 · ÷10**); a transition you cannot see is a transition you cannot judge, and the
divisor scales the transition on its way to the engine rather than slowing a running animation, so what
you watch at ÷10 is the same motion, born slower.

Every demo in the gallery is also a test fixture: the interruption soak hammers them, which is why they
are the first place a regression shows up.

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
```

`packages/glimmer-motion/VENDORED.md` lists every file copied verbatim from Motion and the upstream commit
(`motion@bbabb00`); re-diff them when bumping `motion-dom`. The Cypress-port harness lives in
`test-app/tests/helpers/layout-fixture.ts`: a 1000×660 fixture viewport, `should()` retries, `trigger()`
pointer events with Cypress' element-relative coordinates, `cyClick()`, and per-test reset of the document
projection node.

## Roadmap

- **`0.1.0` on npm.** Consumers today use `workspace:*` against a checkout. A version number is what
  turns "copy this style" into a dependency, and it is the gate for everything below.
- **`ember-try` against LTS** (5.12 / 6.4 / release). The peer range already says `>= 5.4`; nothing proves it.
- **`ember-a11y-testing` over the gallery.** `reducedMotion` already defaults to `"user"`, which was the
  substantive half; a smoke pass is the other half.
- **boxel-motion** — a re-host inside [cardstack/boxel](https://github.com/cardstack/boxel) for its
  constraints (SES-sandboxed card code, cross-realm orchestration, the `surface-*` height service, fitted vs
  embedded intrinsic sizing). It replaces the modifier shell, the scheduler adapter and the components and
  keeps everything above the adapter line. Three host transitions are the proving ground: a stack
  open/close (far match), a panel that is its own scene over a moving shell (nested `<Choreo>`), and
  compose/trash (`{{beacon}}`, not `layoutId`).

## License

MIT. © 2026 Cardstack Foundation. See [LICENSE](LICENSE).

## Credits

The engine, the algorithms and the test suites are [Motion](https://motion.dev)
([motiondivision/motion](https://github.com/motiondivision/motion), MIT). The render-detector idea is from
[boxel-motion](https://github.com/cardstack/boxel). This package is the Glimmer binding, by Cardstack.
