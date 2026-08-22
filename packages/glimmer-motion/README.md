# glimmer-motion

**[Motion](https://motion.dev) for Glimmer.** Motion's `motion-dom` engine — untouched — bound to Glimmer
rendering: `{{motion}}`, `<Presence>` (AnimatePresence), `<LayoutGroup>`, `<ReorderGroup>` /
`<ReorderItem>`, drag. Verified by ports of Motion's own test suites (319 cases).

```gts
import { motion, Presence, LayoutGroup } from 'glimmer-motion';

<template>
  <LayoutGroup>
    <Presence @items={{this.cards}} @key={{this.keyOf}} as |card h|>
      <div
        {{motion
          presence=h
          layoutId=card.id
          initial=(hash opacity=0)
          animate=(hash opacity=1)
          exit=(hash opacity=0)
          drag='x'
          dragSnapToOrigin=true
        }}
      >
        {{card.title}}
      </div>
    </Presence>
  </LayoutGroup>
</template>
```

## Install

```
pnpm add glimmer-motion motion-dom motion-utils
```

Peers: `motion-dom` / `motion-utils` (pinned together), `ember-modifier`, `@glimmer/component`,
`@glimmer/tracking`, `ember-source >= 5.4`. A v2 addon — Embroider and Vite apps consume it directly, with
TypeScript types and Glint signatures.

## Features

- **Animation** — `initial` / `animate` / `exit`, keyframes, springs/tweens/inertia, variants with
  propagation and stagger orchestration, motion values through `style`, SVG attributes, animation lifecycle events
- **Layout** — `layout` FLIP animation with scale correction, `layoutId` shared-element transitions and
  crossfade, `<LayoutGroup>`, nested/relative projection, portals, `layoutChange()` / `instantLayoutTransition()`
- **Presence** — `<Presence>` with `sync` / `wait` / `popLayout`, `@initial={{false}}`, `@custom`,
  nested `@propagate`, tracked `h.isPresent`
- **Drag** — Motion's pan/drag session: axis lock, direction lock, constraints (object / element / ref,
  re-measured on resize), elastic, momentum, snap to origin, `createDragControls()`, `whileDrag`,
  drag + layout, scroll-while-drag, `correctParentTransform()` / `transformViewBoxPoint()`
- **Gestures** — `whileHover` / `whileTap` / `whileFocus` / `whileInView` and their handlers,
  `<MotionConfig>` tree defaults, `useScroll()` / `useInView()` helpers over Motion's `scroll()` / `inView()`
- **Reorder** — `<ReorderGroup>` / `<ReorderItem>`, axis `x` / `y` / `xy` (detected), auto-scroll
- **Glimmer** — `.gts`, Glint signatures, host hooks isolated so the engine glue can be re-hosted

## API

| export                                                                                                   | what                                                                                                             |
| -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `motion`                                                                                                 | the modifier: Motion's props as named arguments, plus `presence` and `transformPagePoint`                        |
| `Presence`                                                                                               | `@items @key @mode @initial @custom @onExitComplete @propagate @parent @anchorX @anchorY`, yields `item, handle` |
| `LayoutGroup`                                                                                            | `@id @inherit`; hosts the render detector that snapshots layout before the DOM changes                           |
| `ReorderGroup`, `ReorderItem`                                                                            | `@values @onReorder @axis` yielding `group`; `@group @value` + forwarded motion args                             |
| `layoutChange(fn)`, `snapshotAll()`, `requestSettle()`, `afterSettle(fn)`, `instantLayoutTransition(fn)` | layout pipeline                                                                                                  |
| `createDragControls()`, `DragControls`                                                                   | `useDragControls`                                                                                                |
| `correctParentTransform(elOrRef)`, `transformViewBoxPoint(svgOrRef)`                                     | `transformPagePoint` helpers                                                                                     |
| `MotionNode`, `postRender`, `setPostRender`, `flushPendingMounts`                                        | for re-hosting on another Glimmer runtime                                                                        |

Deep imports (`glimmer-motion/motion`, `glimmer-motion/presence`, `glimmer-motion/reorder/group`, …) are the
same modules.

### React → Glimmer

| React                            | here                                                      |
| -------------------------------- | --------------------------------------------------------- |
| `<motion.div …>`                 | `<div {{motion …}}>` — any tag, including SVG             |
| `ref`                            | the element, or a `{current}` object filled by a modifier |
| `useMotionValue`, `useTransform` | `motionValue`, `transformValue` from `motion-dom`         |
| `<AnimatePresence>`              | `<Presence @items @key>` yielding a handle                |
| `useIsPresent()`                 | `h.isPresent`                                             |
| re-render → layout snapshot      | a render pass inside `<LayoutGroup>`, or `layoutChange()` |
| `<MotionConfig>`                 | pass `transition` / `transformPagePoint` per element      |
| `useDragControls()`              | `createDragControls()`                                    |
| `Reorder.Group` / `.Item`        | `<ReorderGroup>` / `<ReorderItem>`                        |

## How it works

Motion's React library is an engine (`motion-dom`) plus glue. This package is only the glue, redone for
Glimmer, reproducing the ordering React gives the engine: construct parents-first, mount children-first
after the render pass, snapshot layout before the DOM changes and measure after, announce presence after
the commit, freeze a leaving element's props. `src/node.ts` (the per-element lifecycle), `src/layout.ts`
(the settle pipeline) and `src/scheduler.ts` (one `postRender` host hook) have no Ember imports;
`src/motion.ts` and the components are the Ember host adapter.

`VENDORED.md` lists the files copied verbatim from Motion (pan/drag session, Reorder utilities) with the
upstream commit.

The full story — why the engine is untouched, how the binding was built by porting Motion's test suites and
what that surfaced — is in the
[repository README](https://github.com/cardstack/glimmer-motion#readme).

## Not ported (yet)

`m` / `LazyMotion`, Reorder's `as`, server rendering.

## License

MIT. The engine, algorithms and tests are [Motion](https://motion.dev) (MIT, Motion Division).
