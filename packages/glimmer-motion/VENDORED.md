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
of their surface glimmer-motion uses. A changed signature upstream compiles silently against the old
declaration, which is why a bump PR diffs these modules' source (see [Bumping Motion](#bumping-motion)).

## One engine, pinned together

The workspace catalog in `pnpm-workspace.yaml` pins `framer-motion`, `motion`, `motion-dom` and
`motion-utils` to exact versions, and a bump moves all four.

- **One `motion-dom`.** It holds the engine's shared state: the frame loop, the drag lock, every
  `MotionValue`. A second copy on the page is a second engine that the first can't see. glimmer-motion
  takes `motion-dom` and `motion-utils` as peers, the inlined framer-motion code imports them, and the
  test app and gallery depend on them directly. The root `overrides` resolve `framer-motion`,
  `motion-dom` and `motion-utils` through the catalog, so no caret range pulls in a second copy.
- **The versions framer-motion was released against.** `motion-dom` and `motion-utils` sit at the lower
  bounds of the ranges the pinned framer-motion declares. glimmer-motion's peer ranges start at the same
  versions, because its dist carries that framer-motion code.
- **`motion` at framer-motion's version.** The test app and the gallery use `motion`, which depends on
  the `framer-motion` release of its own version.

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

## Bumping Motion

The Motion Bump workflow (`.github/workflows/motion-bump.yml`) checks npm daily. Once a newer framer-motion
release is older than pnpm's `minimumReleaseAge`, it runs `scripts/bump-motion.mjs`, which moves the four
pins and glimmer-motion's peer ranges. The workflow then opens a PR from `motion-bump/<version>` and
requests review from the reviewer it names (`REVIEWER`). The script runs locally too:
`node scripts/bump-motion.mjs` prints the release a bump would take, and
`node scripts/bump-motion.mjs --to <version> --write --report -` moves the pins and prints the PR body.
Run `pnpm install` after it.

Reviewing a bump PR:

1. **CI.** Red CI is the signal. The Choreo Tests and Choreo Test App Tests jobs run the ported fidelity
   suites, Lint runs `ember-tsc` over the choreo packages, and glimmer-motion's build fails if an inlined
   module imports React or a framer-motion path other than `framer-motion/dom`. A PR opened with the
   workflow's `GITHUB_TOKEN` starts no `pull_request` workflows, so the workflow dispatches `ci.yaml` and
   `ci-lint.yaml` on the branch itself. A push to the branch runs the rest.
2. **The PR body.** It lists every inlined or adapted module whose TypeScript changed between the two
   releases, entry modules first, with diffs, read from the `sourcesContent` of framer-motion's
   `dist/es/**/*.mjs.map`. For a changed entry module, compare its exports with the declarations in
   `src/framer-motion-internals.ts`, and its overridden methods with the subclasses in
   `src/gestures/drag-gesture.ts`. Neither fails to compile when upstream changes a signature. Port a change
   in an adapted source into `src/gestures/transform-page-point.ts` by hand.
3. **Fixes** are ordinary commits on the bump branch.
4. **Title.** The PR opens as `fix:`, for a catch-up. Retitle it `feat:` when upstream adds a capability
   glimmer-motion exposes. The prefix covers glimmer-motion and choreo, which release together.

To decline a release, close its PR and keep the branch: the workflow skips a release whose branch exists.
