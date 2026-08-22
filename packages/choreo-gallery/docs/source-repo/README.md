# glimmer-motion

**[Motion](https://motion.dev) for Glimmer.** The same `motion-dom` engine Motion runs on — untouched — with the
React glue re-done as a modifier and a handful of components. Layout animations, shared-element transitions
(`layoutId`), enter/exit presence, variants, drag, reorder: the API you know from React, in `.gts`.

```gts
import { motion, Presence, LayoutGroup } from 'glimmer-motion';

<template>
  <LayoutGroup>
    <Presence @items={{this.cards}} @key={{this.keyOf}} @mode="popLayout" as |card h|>
      <div
        {{motion
          presence=h
          layoutId=card.id
          initial=(hash opacity=0 y=20)
          animate=(hash opacity=1 y=0)
          exit=(hash opacity=0 scale=0.9)
          transition=(hash type="spring" stiffness=300 damping=30)
          drag="x"
          dragSnapToOrigin=true
        }}
      >{{card.title}}</div>
    </Presence>
  </LayoutGroup>
</template>
```

> Naming: Motion (motion.dev) is the library formerly called framer-motion; its React package is still
> published as `framer-motion`, which is why upstream paths below read `packages/framer-motion/…`.

## Why this exists

Motion is two things: an animation engine (`motion-dom` — values, springs, keyframes, the projection
tree that does layout animation and scale correction, the pan/drag session) and a thin layer of React that
feeds it props at the right moments. The engine is framework-free and published on its own. Only the glue
is React.

So this package does not re-implement animation. It binds the engine to Glimmer's rendering lifecycle and
reproduces, exactly, the *ordering* React's glue gives the engine: visual elements constructed parents-first
during render, mounted children-first in effects, layout snapshots taken before the DOM changes and
measurements after, presence notifications after the commit, an exiting element frozen at its last props.
Getting those right is the whole job — and the engine's behaviour then matches Motion to the pixel,
which we check by running Motion's own test suites against it.

## Fidelity

`test-app` carries ports of Motion's test suites, translated line by line — the Jest unit suites
(animate prop, variants, AnimatePresence, LayoutGroup, keyframes/delay, style prop, unmount) and the Cypress
fixtures (all of `layout-*`, all of `drag-*`, `drag-to-reorder`, `drag-tabs`) with the upstream fixtures
rebuilt as Glimmer components and upstream's literal expected pixel values kept.

**319 cases, 317 pass, 2 are upstream's own `it.skip`.** The few places where a literal was changed are
documented inline with the reason — each one is a Cypress runner artefact (an implicit `scrollIntoView`, a
`50vw` measured against the runner window, a "this should actually be 400" comment upstream left in).

```
pnpm install && pnpm test        # builds the addon, runs the suite in Chrome against the built package
```

## Install

```
pnpm add glimmer-motion motion-dom motion-utils
```

Peer dependencies: `motion-dom` / `motion-utils` (the engine, pinned together), `ember-modifier`,
`@glimmer/component`, `@glimmer/tracking`, `ember-source >= 5.4`. It's a v2 addon; Embroider or Vite apps
consume it directly, TypeScript types and Glint signatures included.

## API

Everything is a named export from `glimmer-motion`; deep imports (`glimmer-motion/presence`, …) are the same
modules.

### `{{motion}}` — `motion.div`, `motion.circle`, … as a modifier

Put it on any element. Named arguments are Motion's props, same names, same types
(`MotionNodeOptions` from `motion-dom`):

| group | props |
|---|---|
| animation | `initial` `animate` `exit` `variants` `transition` `custom` `inherit` `onAnimationStart` `onAnimationComplete` `onUpdate` |
| layout | `layout` (`true` / `"position"` / `"size"`) `layoutId` `layoutDependency` `layoutScroll` `layoutRoot` `layoutCrossfade` `layoutAnchor` `onLayoutMeasure` |
| drag | `drag` (`true` / `"x"` / `"y"`) `dragConstraints` (object, element, or `{current}` ref) `dragElastic` `dragMomentum` `dragSnapToOrigin` `dragDirectionLock` `dragPropagation` `dragTransition` `dragControls` `dragListener` `onDragStart` `onDrag` `onDragEnd` `onDirectionLock` `onMeasureDragConstraints` `whileDrag` |
| pan | `onPanStart` `onPan` `onPanEnd` `onPanSessionStart` |
| style | `style` — static values go on the element as React's style attribute would; `MotionValue`s are bound |
| glimmer-specific | `presence` — the handle a `<Presence>` block yields (React's PresenceContext); `transformPagePoint` — per element, since there is no `<MotionConfig>` |

```gts
<div {{motion animate=(hash x=this.x) style=(hash y=this.yValue) layout=true}} />
<circle cx="50" cy="50" r="20" {{motion drag=true dragConstraints=this.container}} />
```

Variants propagate down the element tree exactly as in React: a parent's `initial`/`animate` labels are the
context for its descendants, `staggerChildren` / `delayChildren` / `when` orchestrate them.

### `<Presence>` — AnimatePresence

Renders a keyed list and keeps leaving items in the DOM until their `exit` animation finishes. It yields
the item and a presence handle; pass the handle to the item's `{{motion}}` (descendants inherit it).

```gts
<Presence
  @items={{this.items}}        {{! the present set }}
  @key={{this.keyOf}}          {{! item → string key }}
  @mode="sync"                 {{! "sync" | "wait" | "popLayout" }}
  @initial={{false}}           {{! skip the initial animation on first render }}
  @custom={{this.direction}}   {{! passed to variant functions of leaving items }}
  @onExitComplete={{this.done}}
  as |item h|
>
  <div {{motion presence=h initial=… animate=… exit=…}}>{{item.label}}</div>
</Presence>
```

`h.isPresent` is tracked, so templates can read it (Motion's `useIsPresent`). For nested presence under a
leaving parent use `@propagate={{true}} @parent={{outerHandle}}` (Motion's `propagate`). `popLayout` takes
`@anchorX` / `@anchorY`.

### `<LayoutGroup>`

Namespaces `layoutId`s and — the important part — hosts the render detector: any render pass inside it
snapshots every projection node before the DOM changes, which is what React's `getSnapshotBeforeUpdate`
does for every re-rendered motion component. Wrap the subtree whose layout changes you want animated.

```gts
<LayoutGroup @id="tabs" @inherit={{true}}>…</LayoutGroup>
```

Outside a `LayoutGroup`, wrap the state change that moves things: `layoutChange(() => { this.items = next })`,
or call `snapshotAll()` / `requestSettle()` yourself. `instantLayoutTransition(fn)` is Motion's
`useInstantLayoutTransition`.

### `<ReorderGroup>` / `<ReorderItem>` — Reorder.Group / Reorder.Item

```gts
<ReorderGroup @values={{this.items}} @onReorder={{this.setItems}} @axis="y" as |group|>
  {{#each this.items as |item|}}
    <ReorderItem @group={{group}} @value={{item}}>{{item}}</ReorderItem>
  {{/each}}
</ReorderGroup>
```

Renders `ul`/`li` (use `...attributes`). Axis is detected from the item layout unless given (`"x"`, `"y"`,
`"xy"` for wrapped lists); items are draggable, snap to origin, animate layout, and the group auto-scrolls a
scrollable ancestor near its edges. `ReorderItem` forwards `@style @initial @animate @exit @whileDrag
@transition @dragTransition @dragListener @dragControls @presence @onDrag @onDragEnd @layout`.

### Drag helpers

- `createDragControls()` — Motion's `useDragControls`: `controls.start(pointerEvent, { snapToCursor: true })`
  from any element, pass `dragControls=controls` to the draggable.
- `correctParentTransform(elementOrRef)` / `transformViewBoxPoint(svgOrRef)` — `transformPagePoint`
  functions for a rotated/scaled parent and for an `<svg viewBox>` whose units differ from its pixels.

### Motion values

Use `motion-dom` directly — `motionValue()`, `transformValue()`, `animateMotionValue()`, springs — and hand
values in through `style`; that's what `useMotionValue` / `useTransform` do in React.

## How it maps to React

| React | here |
|---|---|
| `<motion.div …>` | `<div {{motion …}}>` — any tag, including SVG |
| `ref` | the element itself, or a `{current}` object filled by a modifier |
| `useMotionValue`, `useTransform` | `motionValue`, `transformValue` from `motion-dom` |
| `<AnimatePresence>` with keyed children | `<Presence @items @key>` yielding a handle |
| `useIsPresent()` | `h.isPresent` |
| `<LayoutGroup>` | `<LayoutGroup>` (also the render detector) |
| re-render of a motion component → snapshot | any render pass inside a `LayoutGroup` / `ReorderGroup` |
| `<MotionConfig transition transformPagePoint>` | pass them to the elements |
| `useDragControls()` | `createDragControls()` |
| `Reorder.Group` / `Reorder.Item` | `<ReorderGroup>` / `<ReorderItem>` |

## Architecture

```
motion-dom (engine, unchanged)
   ▲
   │ 30 public exports
node.ts        MotionNode — one element's lifecycle, no host framework: construct in document order,
               mount post-order after the pass, update, freeze props while exiting, tear down
layout.ts      the snapshot → mount → measure → settle pipeline (React's getSnapshotBeforeUpdate /
               componentDidUpdate timing), shared by every projection node
features.ts    the animation / exit / layout / drag / pan feature registrations
scheduler.ts   postRender(fn): the single host hook — "after this render pass has committed"
gestures/      Motion's pan + drag engine, vendored verbatim (see VENDORED.md)
reorder/       Reorder's checkReorder / detectAxis / auto-scroll, vendored verbatim
   ▲
   │ Ember host adapter
motion.ts      {{motion}} — the ember-modifier shell; installs the runloop as postRender
presence.gts, layout-group.gts, reorder/{group,item}.gts — the Glimmer components
```

Only the last line knows about Ember. Re-hosting on another Glimmer runtime means re-doing the modifier
shell, the `postRender` adapter and the four components — the engine glue is untouched.

Three Glimmer-specific mechanisms carry the React ordering rules:

- **Two-phase mount.** Glimmer installs modifiers children-first; React constructs visual elements
  parents-first during render and mounts them children-first in effects. First runs queue, then the queue
  constructs in document order and mounts post-order after the pass — sibling order is what the engine's
  stagger index is built from.
- **Render detector.** Boxel-motion's trick: a getter that consumes `@glimmer/validator`'s `VOLATILE_TAG`
  re-evaluates on every render pass, so a `LayoutGroup` can snapshot all projection nodes before the DOM
  changes, the way React re-rendering every motion component would.
- **Presence by handle.** There is no context; `<Presence>` yields a handle whose `isPresent` is derived
  state, and an element that is not present keeps the props it last had while present — `AnimatePresence`
  renders a leaving child from its last element.

## Not ported (yet)

`MotionConfig` (pass `transition` / `transformPagePoint` per element), `whileHover` / `whileTap` /
`whileFocus` / `whileInView` gestures, `useScroll` / `useInView`, `m` / `LazyMotion`, `Reorder`'s `as`
prop (the group is a `ul`, items are `li`), server rendering. Everything else in the Motion prop
surface is wired through to the engine.

## Development

```
pnpm install
pnpm build                     # packages/glimmer-motion → dist/ + declarations/
pnpm test                      # build, then test-app: vite build --mode test && ember test
pnpm lint:types                # glint, both packages
pnpm --filter test-app start   # the test-app in a browser (/tests)
```

`packages/glimmer-motion/VENDORED.md` lists every file copied verbatim from Motion and the upstream
commit; re-diff them when bumping `motion-dom`. Cypress-port conventions live in
`test-app/tests/helpers/layout-fixture.ts` (a 1000×660 fixture viewport, `should()` retries, `trigger()`
pointer events with Cypress' element-relative coordinates, `cyClick()`).

## Credits

The engine, the algorithms and the test suites are [Motion](https://motion.dev) ([motiondivision/motion](https://github.com/motiondivision/motion))
(MIT, Motion Division). The render-detector idea is from
[boxel-motion](https://github.com/cardstack/boxel). This package is the Glimmer binding.
