# glimmer-motion

The npm package of [Choreo](https://github.com/cardstack/choreo) — Cardstack.

**Motion, Choreo-graphed.** The [Motion](https://motion.dev) engine for Ember — and a timeline for
the scene. `{{motion}}`, `<Presence>`, `<LayoutGroup>`, Reorder, drag, and `<Choreo>`. Verified by
ports of Motion's own test suites.

```gts
import { motion, Presence, LayoutGroup, to, spring } from 'glimmer-motion';

<template>
  <LayoutGroup>
    <Presence @items={{this.cards}} @key={{this.keyOf}} as |card h|>
      <div
        {{motion
          presence=h
          layoutId=card.id
          initial=(to opacity=0)
          animate=(to opacity=1)
          exit=(to opacity=0)
          transition=(spring stiffness=300 damping=30)
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

New here? The [guide](https://github.com/cardstack/choreo/blob/main/docs/guide.md) teaches this
from a Glimmer card rather than from a React translation table.

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
  `<MotionConfig>` tree defaults, `scrollProgress()` / `InView` over Motion's `scroll()` / `inView()`
- **Reorder** — `<ReorderGroup>` / `<ReorderItem>`, axis `x` / `y` / `xy` (detected), auto-scroll
- **Choreography** — `<Choreo>`: a changeset and a timeline over a whole render pass, which Motion's
  per-element model does not have. Sequence/parallel blocks of `Tween` / `Spring` / `Move` (FLIP) /
  `Hold` / `Wait`; removed participants stay on screen for as long as the timeline names them;
  `{{beacon}}` points; and far matching, so one identity can cross between two regions
- **Glimmer** — `.gts`, Glint signatures, named exports, plain-function template helpers
  (`to` / `spring` / `tween` / `styles` / `start`), and `prefers-reduced-motion` honoured by default
- **Testing** — `glimmer-motion/test-support`: `animationsSettled()`, `bounds()`, `shape()`,
  `setupMotion(hooks)`. No `sleep()` in a motion test
- **Re-hostable** — host hooks are ~40 lines plus the components; everything above that line is
  framework-free

## API

| export                                                                                                         | what                                                                                                             |
| -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `motion`                                                                                                       | the modifier: Motion's props as named arguments, plus `presence` and `transformPagePoint`                        |
| `Presence`                                                                                                     | `@items @key @mode @initial @custom @onExitComplete @propagate @parent @anchorX @anchorY`, yields `item, handle` |
| `LayoutGroup`                                                                                                  | `@id @inherit`; hosts the render detector that snapshots layout before the DOM changes                           |
| `ReorderGroup`, `ReorderItem`                                                                                  | `@values @onReorder @axis` yielding `group`; `@group @value` + forwarded motion args                             |
| `layoutChange(fn)`, `snapshotAll()`, `requestSettle()`, `afterSettle(fn)`, `instantLayoutTransition(fn)`       | layout pipeline                                                                                                  |
| `createDragControls()`, `DragControls`                                                                         | `useDragControls`                                                                                                |
| `correctParentTransform(elOrRef)`, `transformViewBoxPoint(svgOrRef)`                                           | `transformPagePoint` helpers                                                                                     |
| `MotionNode`, `postRender`, `setPostRender`, `flushPendingMounts`                                              | for re-hosting on another Glimmer runtime                                                                        |
| `setParticipantHost`, `closestParticipantHost`, `defineParticipantArg`, `ParticipantHost`, `MotionParticipant` | the participant-host extension point (below)                                                                     |

Deep imports (`glimmer-motion/motion`, `glimmer-motion/presence`, `glimmer-motion/reorder/group`, …) are the
same modules.

### Participant hosts

`glimmer-motion/participant` lets a component that coordinates many motion elements (a choreography, a
shared-element transition) take part in their lifecycles without the elements knowing about it. `<Choreo>`
is built on it. The interface is public API under semver: a change to it is a breaking change for every
host package.

A host is an object that implements `ParticipantHost`, installed on an element it renders:

```gts
import { modifier } from 'ember-modifier';
import {
  type MotionParticipant,
  type ParticipantHost,
  setParticipantHost,
} from 'glimmer-motion/participant';

class Stage implements ParticipantHost {
  register(participant: MotionParticipant) {
    // on mount; return what to run on its teardown
    return () => {};
  }
  claim(participant: MotionParticipant) {
    // on teardown: true keeps its VisualElement mounted until participant.release()
    return false;
  }
}

const hosted = modifier((el: Element, [host]: [ParticipantHost]) => {
  setParticipantHost(el, host);
  return () => setParticipantHost(el, undefined);
});

const stage = new Stage();

<template>
  <div data-motion-host {{hosted stage}}>
    <div {{motion id='card'}}></div>
  </div>
</template>
```

- **Who joins.** A `{{motion}}` element with an `id` or a `role` joins the nearest `data-motion-host`
  ancestor when it mounts. `id` is identity across renders, and `role` is a group the host can select by.
  Elements with neither never join.
- **Discovery.** The `data-motion-host` attribute belongs in the host's markup, not in its modifier.
  Modifiers install children-first, so a marked element whose host has not installed yet resolves to no host,
  never to an outer one.
- **Lifecycle.** `register` runs on mount. On teardown the node calls the function `register` returned, then
  asks `claim`. A host that claims a leaving element owns its unmount: it calls `participant.release()` when it
  is done, and `participant.exitComplete()` to let an enclosing `<Presence>` finish the exit.
- **What a host sees.** `MotionParticipant` exposes `element`, `visualElement`, `id`, `role`, `isPresent`,
  `layoutKey`, `ownAnimation` and `presenceManaged`. `visualElement` is motion-dom's `VisualElement`, so a host
  package and glimmer-motion must resolve the same motion-dom.
- **Host args.** A host can add named args to `{{motion}}`. It declares each one by augmenting
  `ParticipantArgs` and registers it with `defineParticipantArg(name, apply)`. The modifier keeps the arg away
  from the engine and calls `apply(element, value)` on every pass, with `undefined` when the arg is absent.
  `defineParticipantArg` returns a remover. `<Choreo>` declares `pack` this way:

  ```ts
  declare module 'glimmer-motion/participant' {
    interface ParticipantArgs {
      pack?: 'box' | 'content';
    }
  }
  defineParticipantArg('pack', (el, pack) => {
    /* … */
  });
  ```

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

`scroll()`, `scrollInfo()` and `inView()` are Motion's own, re-exported from `framer-motion/dom`, the
React-free entry point of Motion's React package. `framer-motion` is a regular dependency; its React peers
are optional and that entry never imports them.

The pan/drag session, the gesture and animation features and the Reorder utilities are Motion's own
modules too, inlined at build time from framer-motion's build. `VENDORED.md` lists them and the two places
glimmer-motion's drag deliberately differs.

The full story — why the engine is untouched, how the binding was built by porting Motion's test suites and
what that surfaced — is in the
[repository README](https://github.com/cardstack/choreo#readme).

## Not ported (yet)

`m` / `LazyMotion`, Reorder's `as`, server rendering.

## License

MIT. The engine, algorithms and tests are [Motion](https://motion.dev) (MIT, Motion Division).
