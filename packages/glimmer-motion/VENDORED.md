# Code from Motion

glimmer-motion runs Motion's own code wherever Motion's code is framework-free.

- **The engine.** `motion-dom` and `motion-utils` are peer dependencies, shared with the rest of the page.
- **Scroll and in-view.** `scroll()`, `scrollInfo()` and `inView()` come from `framer-motion/dom`, a
  regular dependency.
- **Gestures, features and Reorder utilities.** These come from framer-motion's build, which its exports
  map doesn't expose. `src/framer-motion-internals.ts` imports them by their `framer-motion/dist/es/…`
  paths, and `rollup.config.mjs` resolves those paths on disk and inlines the modules into
  `dist/framer-motion-internals.js`. That file carries framer-motion's MIT notice. The build fails if any
  output chunk imports React or a framer-motion path other than `framer-motion/dom`.

| inlined from `framer-motion/dist/es/` (and the modules they import)                    | used by                                           |
| -------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `gestures/drag/index`, `gestures/drag/VisualElementDragControls`, `gestures/pan/index` | `src/features.ts`, `src/gestures/drag-gesture.ts` |
| `gestures/drag/use-drag-controls` (`DragControls` only; the React hook is tree-shaken) | `src/gestures/drag-controls.ts`                   |
| `gestures/hover`, `gestures/press`, `gestures/focus`, `motion/features/viewport/index` | `src/features.ts`                                 |
| `motion/features/animation/index`, `motion/features/animation/exit`                    | `src/features.ts`                                 |
| `components/Reorder/utils/{check-reorder,detect-axis,auto-scroll}`                     | `src/reorder/group.gts`, `src/reorder/item.gts`   |

framer-motion ships no declarations for these modules. `src/framer-motion-internals.ts` declares the part
of their surface glimmer-motion uses, so re-check those declarations against upstream's source when
bumping framer-motion. A changed signature there compiles silently against the old declaration.

## Adapted, not inlined

| here                                   | upstream                                                                                                     |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `src/gestures/transform-page-point.ts` | `utils/transform-rotated-parent.ts`, `utils/transform-viewbox-point.ts` (React ref → element or `{current}`) |

Everything else in `src/` is the Glimmer re-implementation of React glue (`motion` component lifecycle,
AnimatePresence, LayoutGroup, MeasureLayout timing, Reorder.Group/Item). The test-app carries the ports of
Motion's Jest suites and Cypress fixtures that pin the fidelity.

## Deviations

Each deviation is a subclass of upstream's class in `src/gestures/drag-gesture.ts`, overriding only the
methods that differ.

| class                                                        | change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GlimmerDragGesture` (over `DragGesture`)                    | `unmount()` always calls `controls.cancel()`. Upstream keeps the pan session alive when a component unmounts mid-drag, because React 19 can unmount and remount during reorder reconciliation. Glimmer's keyed `{{#each}}` moves nodes instead, so an unmount really is the end of the gesture. Upstream's branch skips `cancel()`, and with it the release of `setDragLock`'s module-global lock, so an element removed mid-drag silently kills `onDragStart` / `onDragEnd` for every later drag on the page. |
| `TextLockingDragControls` (over `VisualElementDragControls`) | Holds a document-wide text-selection lock (`src/gestures/lock-select.ts`) while a pan session is open. CSS on the dragged node doesn't stop the browser selecting nearby text once the pointer leaves it.                                                                                                                                                                                                                                                                                                      |
