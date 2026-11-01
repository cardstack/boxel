# <img src="https://choreo.boxel.site/icon.svg" width="32" height="32" alt=""> glimmer-motion

The [Motion](https://motion.dev) engine for Ember. `{{motion}}`, `<Presence>`, `<LayoutGroup>`,
Reorder and drag, verified by ports of Motion's own test suites.

`<Choreo>`, a changeset and a timeline over a whole render pass, is a separate package built on this
one: [`@cardstack/choreo`](https://github.com/cardstack/boxel/tree/main/packages/choreo#readme).
Both are demonstrated, with their source, in the [Choreo gallery](https://choreo.boxel.site/).

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
pnpm add glimmer-motion
```

Peers: `motion-dom` / `motion-utils` (pinned together), `ember-modifier`, `@glimmer/component`,
`ember-source >= 5.4`. pnpm and npm install the peers in range. Adding `motion-dom` or `motion-utils` yourself
at a version outside glimmer-motion's ranges puts a second copy of the engine on the page. A v2 addon — Embroider and Vite apps consume it directly, with
TypeScript types and Glint signatures.

New here? The [guide](https://choreo.boxel.site/docs/guide.md) teaches this from a Glimmer card
rather than from a React translation table.

## Features

- **Animation** — `initial` / `animate` / `exit`, keyframes, springs/tweens/inertia, variants with
  propagation and stagger orchestration, motion values through `style`, SVG attributes, animation lifecycle events
- **Layout** — `layout` FLIP animation with scale correction, `layoutId` shared-element transitions and
  crossfade, `<LayoutGroup>`, nested/relative projection, portals, `layoutChange()` / `instantLayoutTransition()`
- **Presence** — `<Presence>` with `sync` / `wait` / `popLayout`, `@initial={{false}}`, `@custom`,
  nested `@propagate`, tracked `h.isPresent`; plus `snapshot`, this package's own mode (see below)
- **Drag** — Motion's pan/drag session: axis lock, direction lock, constraints (object / element / ref,
  re-measured on resize), elastic, momentum, snap to origin, `createDragControls()`, `whileDrag`,
  drag + layout, scroll-while-drag, `correctParentTransform()` / `transformViewBoxPoint()`
- **Gestures** — `whileHover` / `whileTap` / `whileFocus` / `whileInView` and their handlers,
  `<MotionConfig>` tree defaults, `scrollProgress()` / `InView` over Motion's `scroll()` / `inView()`
- **Reorder** — `<ReorderGroup>` / `<ReorderItem>`, axis `x` / `y` / `xy` (detected), auto-scroll
- **Glimmer** — `.gts`, Glint signatures, named exports, plain-function template helpers
  (`to` / `styles` / `spring` / `tween` / `inertia` / `stagger` / `ease` / `perValue`), and
  `prefers-reduced-motion` honoured by default
- **Testing** — `glimmer-motion/test-support` ([below](#testing)): settle on real activity instead
  of `sleep()`, and measure in test-root coordinates
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
| `retime(root)`                                                                                                 | restart running motion under an element on its current transition, keeping loop phase (for tuning tools)         |
| `createDragControls()`, `DragControls`                                                                         | `useDragControls`                                                                                                |
| `correctParentTransform(elOrRef)`, `transformViewBoxPoint(svgOrRef)`                                           | `transformPagePoint` helpers                                                                                     |
| `MotionNode`, `postRender`, `setPostRender`, `flushPendingMounts`                                              | for re-hosting on another Glimmer runtime                                                                        |
| `setParticipantHost`, `closestParticipantHost`, `defineParticipantArg`, `ParticipantHost`, `MotionParticipant` | the participant-host extension point (below)                                                                     |
| `registerBusyProbe`, `BusyProbe`                                                                               | count a host's own in-flight work as motion (below)                                                              |
| `motionValue`, `MotionValue`, `transformValue`, `styleEffect`, `frame`, `animate`                              | the engine's imperative surface (below)                                                                          |

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
  `defineParticipantArg` returns a remover. Put the augmentation in a module that the host package's public
  declarations import, or it won't reach that package's consumers. `<Choreo>` declares `pack` this way:

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

- **Busy probes.** A host whose work outlasts the engine's own animations (a timeline between steps, a
  barrier waiting on another region) registers a `BusyProbe` with `registerBusyProbe(probe)`. The probe
  answers `false` at rest or a short reason while busy, and `animationsSettled()` / `whatIsBusy()` from
  `glimmer-motion/test-support` consult it alongside the frame loop and the projection tree. It returns a
  remover: a probe over one host instance's state is removed in that instance's destructor, and a probe over
  module-global state may stay registered for the life of the page.

### The engine's imperative surface

A few of the engine's own functions are exported from `glimmer-motion` directly, for code that drives motion
values by hand rather than through `{{motion}}`. They are the engine's functions, not wrappers, so they run on
the same frame loop as every `{{motion}}` element.

| export                       | from                | what                                                                       |
| ---------------------------- | ------------------- | -------------------------------------------------------------------------- |
| `motionValue`, `MotionValue` | `motion-dom`        | create a motion value, and its type; pass one to `{{motion}}` in `style`   |
| `transformValue`             | `motion-dom`        | a motion value derived from others, recomputed when they change            |
| `styleEffect`                | `motion-dom`        | bind motion values to an element's style outside `{{motion}}`              |
| `frame`                      | `motion-dom`        | schedule `read` / `update` / `render` work on the engine's frame loop      |
| `animate`                    | `framer-motion/dom` | animate a motion value, an element or a selector; `motion`'s own `animate` |

```ts
import { animate, motionValue } from 'glimmer-motion';

const x = motionValue(0);
animate(x, 120, { type: 'spring', visualDuration: 0.4 });
```

This is the only route by which realm cards reach the engine: `motion-dom` itself is not shimmed into
realms. The list is deliberately small. The engine's internals (`animateVisualElement`, `visualElementStore`
and the like) stay unexported, and adding a name to it is an API change to glimmer-motion, reviewed like
one.

### React → Glimmer

| React                            | here                                                      |
| -------------------------------- | --------------------------------------------------------- |
| `<motion.div …>`                 | `<div {{motion …}}>` — any tag, including SVG             |
| `ref`                            | the element, or a `{current}` object filled by a modifier |
| `useMotionValue`, `useTransform` | `motionValue`, `transformValue`                           |
| `<AnimatePresence>`              | `<Presence @items @key>` yielding a handle                |
| `useIsPresent()`                 | `h.isPresent`                                             |
| re-render → layout snapshot      | a render pass inside `<LayoutGroup>`, or `layoutChange()` |
| `<MotionConfig>`                 | pass `transition` / `transformPagePoint` per element      |
| `useDragControls()`              | `createDragControls()`                                    |
| `Reorder.Group` / `.Item`        | `<ReorderGroup>` / `<ReorderItem>`                        |

### Three rules React does not need

React's model hides three things that Glimmer's doesn't, and each surfaced while porting a real app
onto this binding. They are the only places where the port isn't a mechanical translation.

**1. Motion owns a motion element's inline style, so pass CSS through the modifier, not a `style`
attribute.** In React the `style` prop belongs to Motion: it merges what you write with the
transforms it renders. In Glimmer a bound `style="…"` attribute is yours, and Glimmer rewrites the
whole declaration whenever the bound value changes, wiping out the transform Motion just wrote. The
symptom is quiet: a card that stays put while the drag logic runs perfectly around it.

```gts
{{! ✗ the next re-render erases the drag transform. accentStyle = '--accent: …' }}
<div class='card' style={{this.accentStyle}} {{motion drag=true}}>

{{!-- ✓ Motion applies these itself, custom properties included.
     The modifier takes an object: accentVars = { '--accent': … } --}}
<div class='card' {{motion style=this.accentVars drag=true}}>
```

**2. A leaving child stays live, so read exiting content from the yielded item.** React keeps the
_element tree_ it captured before the diff, so a leaving child can't re-render. A Glimmer block
re-runs from live tracked state for as long as the leaver is on screen. Anything the exit needs (the
symbol the panel was showing, the rect the modal flew from) has to ride on the item `<Presence>`
yields, not be read back out of state that has already moved on.

Where it can't, because the leaver renders blocks or state you don't own, use
`<Presence @mode="snapshot">`. The leaver's block is torn down in the render that removes it, and a
static copy of the element given the handle plays that element's `exit`. The copy shows the
element's last frame, lifted out of flow at its seat (`@anchorX` / `@anchorY` apply). It is inert and
`aria-hidden`, and carries no ids, form-control names or `data-test-*` hooks. It holds the CSS
animations, scroll offsets and canvas pixels the element showed. An item that comes back replaces its
copy at once, and with no `exit` or with animations skipped nothing is copied. A copy is a picture:
motion elements nested inside it don't play their own exits, custom elements inside it are
constructed again, and its iframes and media don't load.

**3. Declare what you want tweened, because a value in the stylesheet is invisible to the engine.**
A layout animation moves and resizes by transform, and the engine corrects `borderRadius` and
`boxShadow` against the scale in force, but only for values it holds. A radius that lives in CSS
isn't one, and a square tile growing into a wide hero comes out with oval corners. Hand the value to
Motion and every frame is corrected.

```gts
{{! ✗ the engine can't correct what it doesn't know about: .card { border-radius: 14px } }}
<article class='card' {{motion layout=true}}></article>

{{! ✓ corrected per frame, against whatever scale the layout animation is applying }}
<article class='card' {{motion layout=true style=(styles borderRadius='14px')}}></article>
```

## Testing

```ts
import { animationsSettled, bounds, setupMotion } from 'glimmer-motion/test-support';

module('the card', function (hooks) {
  setupRenderingTest(hooks);
  setupMotion(hooks);

  test('it lands', async function (assert) {
    await render(<template><Card /></template>);
    await animationsSettled();
    assert.strictEqual(bounds(find('.card')!).left, 120);
  });
});
```

| export                                            | what it is for                                                                                                                                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `setupMotion(hooks)`                              | resets what outlives an owner (the projection root, the layout-loop guard, motion speed, and every registered reset) around each test, and fails a test that ran a layout loop |
| `animationsSettled(opts?)`                        | resolves when every motion element, layout animation and registered busy probe has stopped, and names what was still moving when it times out                                  |
| `bounds(el)` / `shape(el)` / `boundsAndShape(el)` | rects relative to the test root; the cumulative 2×2 transform                                                                                                                  |
| `velocityOf(el)`                                  | async: how fast the element is moving right now, as `{ x, y }` in px/s, sampled across two frames                                                                              |
| `isMotionIdle()` / `whatIsBusy()`                 | the probe underneath, for a custom wait                                                                                                                                        |
| `registerMotionReset(fn)` / `resetMotion()`       | add a reset of your own, for a layer that keeps document-wide state; run them all                                                                                              |

`animationsSettled()` is explicit rather than a test waiter on purpose. A test that clicks again
while something is still in flight is testing interruption, and a waiter would silently turn that
click into a wait for completion.

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

### How it was made

The binding was built by porting Motion's own test suites, in order, and letting them drive it: the
animate prop, variants, AnimatePresence, LayoutGroup, keyframes and delay, the style prop and
unmount, then the `layout-*` and `drag-*` Cypress specs, then Reorder. Each fixture was rebuilt as a
Glimmer component with its literal expected pixel values kept, and nothing was declared done until
the upstream test was green in a real Chrome. Whatever failed was a place where the binding's
ordering differed from React's, and almost all of them were timing rules:

- Glimmer installs modifiers children-first, so a child can't find its parent's visual element when
  its modifier first runs. First runs queue, then construct in document order and mount post-order
  after the pass. Sibling order matters, because the engine builds its stagger index from it.
- There is no `getSnapshotBeforeUpdate`. A render detector, a getter that consumes a volatile tag
  and so re-evaluates on every render pass, lets `<LayoutGroup>` snapshot every projection node before
  the DOM changes, the way React re-rendering each motion component would.
- The engine's update microtask must not run between Glimmer's render and the mounts, or it clears
  the snapshots and layout animations become identity transitions. There is one settle per pass,
  after the mounts.
- An element created already-absent must still mount _present_ and then leave, or its exit is
  swallowed.
- AnimatePresence renders a leaving child from its last present element, but a live Glimmer block
  doesn't, so the modifier freezes an exiting element's props.
- `initial` values must be in the DOM before the projection first measures. React has them in the
  style attribute synchronously, so the binding renders them synchronously at mount.

Those ports are this package's test suite, `tests/` in this package. Where a literal changed, the
reason is inline.

## Not ported (yet)

`m` / `LazyMotion`, Reorder's `as`, server rendering.

## License

MIT. The engine, algorithms and tests are [Motion](https://motion.dev) (MIT, Motion Division).
