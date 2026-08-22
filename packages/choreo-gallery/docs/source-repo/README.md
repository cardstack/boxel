# glimmer-motion

**[Motion](https://motion.dev) for Glimmer.** The `motion-dom` engine that powers Motion's React library —
untouched — bound to Glimmer rendering as a modifier and a handful of components. Layout animations,
shared-element transitions, enter/exit presence, variants, drag, reorder: the API you know from React, in
`.gts`, verified against Motion's own test suites.

```gts
import { motion, Presence, LayoutGroup } from 'glimmer-motion';

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
          initial=(hash opacity=0 y=20)
          animate=(hash opacity=1 y=0)
          exit=(hash opacity=0 scale=0.9)
          transition=(hash type='spring' stiffness=300 damping=30)
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

- [Features](#features)
- [Why the engine is untouched](#why-the-engine-is-untouched)
- [How it was made](#how-it-was-made)
- [Fidelity](#fidelity)
- [Install](#install) · [API](#api) · [React → Glimmer](#react--glimmer)
- [Architecture](#architecture)
- [Not ported](#not-ported-yet)
- [Development](#development) · [Roadmap](#roadmap) · [Credits](#credits)

## Features

Everything below is Motion's implementation, driven through Glimmer, and covered by a port of the upstream
test that pins it.

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
  the tree, `inherit: true` transitions, nested configs
- `useScroll()` (scroll position/progress motion values; container, target, offsets) and `useInView()`
  (tracked `isInView`) over Motion's `scroll()` / `inView()`, which are exported too

**Reorder** (Motion's Reorder.Group / Reorder.Item)

- `<ReorderGroup>` / `<ReorderItem>` on `ul` / `li` with `...attributes`
- axis `"x"` / `"y"` / `"xy"` (wrapped lists), detected from the layout when not given
- auto-scroll of a scrollable ancestor near its edges; works inside `<Presence>` (the tabs demo)

**Glimmer**

- `.gts`, Glint signatures for every component and the modifier
- a v2 addon: Embroider and Vite apps consume it directly; ESM, tree-shakeable per module
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

glimmer-motion started as the motion layer of a port: a React app built on Motion (the "bentobox"
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

`test-app` carries the ports: the Jest suites (animate prop, variants, AnimatePresence, LayoutGroup,
keyframes/delay, style prop, unmount) and the Cypress fixtures (all `layout-*`, all `drag-*`,
`drag-to-reorder`, `drag-tabs`).

**319 cases, 317 pass, 2 are upstream's own `it.skip`.** Where a literal was changed the reason is inline;
each is a Cypress-runner artefact (an implicit `scrollIntoView`, `50vw` measured against the runner window,
a "this should actually be 400" comment upstream left in). Environment deltas are documented the same way:
DOM-read start values need a second frame in a real browser where jsdom collapsed the frameloop, and an
Ember `render()` settles on a timer where RTL's is synchronous.

```
pnpm install && pnpm test     # builds the addon, runs the suite (a development-mode build, as boxel does) in Chrome
```

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
| glimmer-specific | `presence` — the handle a `<Presence>` block yields; `transformPagePoint` — per element (no `<MotionConfig>`)                                                                                                                                             |

```gts
<div {{motion animate=(hash x=this.x) style=(hash y=this.yValue) layout=true}} />
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
| `<MotionConfig transition transformPagePoint>` | pass them to the elements                                                    |
| `useDragControls()`                            | `createDragControls()`                                                       |
| `Reorder.Group` / `Reorder.Item`               | `<ReorderGroup>` / `<ReorderItem>`                                           |

## Architecture

```
motion-dom (engine, unchanged)
   ▲  30 public exports
node.ts        MotionNode — one element's lifecycle, no host framework: construct in document order,
               mount post-order after the pass, update, freeze props while exiting, tear down
layout.ts      snapshot → mount → measure → settle (React's getSnapshotBeforeUpdate / componentDidUpdate timing)
features.ts    animation / exit / layout / drag / pan feature registrations
scheduler.ts   postRender(fn): the single host hook — "after this render pass has committed"
gestures/      Motion's pan + drag session, vendored verbatim (VENDORED.md)
reorder/       Reorder's checkReorder / detectAxis / auto-scroll, vendored verbatim
   ▲  Ember host adapter
motion.ts      {{motion}} — the ember-modifier shell; installs the runloop as postRender
presence.gts, layout-group.gts, reorder/{group,item}.gts — the Glimmer components
```

Only the last two lines know about Ember. Re-hosting means re-doing the modifier shell, the `postRender`
adapter and the four components; the engine glue is untouched.

## Not ported (yet)

`m` / `LazyMotion` (a React bundle-splitting device; the addon is tree-shaken per module already),
Reorder's `as` prop (the group is a `ul`, items are `li`), server rendering.

## Development

```
pnpm install
pnpm build                     # packages/glimmer-motion → dist/ + declarations/
pnpm test                      # build, then test-app: vite build --mode=development --out-dir dist-tests && ember test --path dist-tests
pnpm lint:types                # glint, both packages
pnpm --filter test-app start   # the test-app in a browser (/tests)
```

`packages/glimmer-motion/VENDORED.md` lists every file copied verbatim from Motion and the upstream commit
(`motion@bbabb00`); re-diff them when bumping `motion-dom`. The Cypress-port harness lives in
`test-app/tests/helpers/layout-fixture.ts`: a 1000×660 fixture viewport, `should()` retries, `trigger()`
pointer events with Cypress' element-relative coordinates, `cyClick()`, and per-test reset of the document
projection node.

## Roadmap

- **boxel-motion** — a re-host inside [cardstack/boxel](https://github.com/cardstack/boxel) for its
  constraints (SES-sandboxed card code, cross-realm orchestration, the `surface-*` height service, fitted vs
  embedded intrinsic sizing). It replaces the modifier shell, the scheduler adapter and the components and
  keeps everything above the adapter line.
- publish to npm (consumers today use `file:` against a checkout).

## Credits

The engine, the algorithms and the test suites are [Motion](https://motion.dev)
([motiondivision/motion](https://github.com/motiondivision/motion), MIT). The render-detector idea is from
[boxel-motion](https://github.com/cardstack/boxel). This package is the Glimmer binding, by Cardstack.
