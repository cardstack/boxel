# Changelog

All notable changes to `glimmer-motion` are recorded here.

This file follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

`glimmer-motion` and `@cardstack/choreo` release in lockstep: every version
of one is a version of the other, and `@cardstack/choreo` peer-depends on the
exact `glimmer-motion` version it was released with.

Pre-1.0 caveat: the public API is intentionally unstable. Minor and patch
versions may change behavior until `1.0.0`.

## [Unreleased]

### Added

- **A development-mode warning for a `layout` or `layoutId` element nothing will snapshot.** Both
  animate only when a render detector measures them before the DOM changes, and only
  `<LayoutGroup>`, `<Presence>` (on a pass where its `@items` change), `<ReorderGroup>` and
  `<Choreo>` carry one. The first such element
  to mount with none of them above it logs a console warning with the element attached, so a keyed
  list that reorders, or a `layoutId` hand-off, that jumps instead of animating says why.
  Production builds skip it.
- **`RENDER_DETECTOR_ATTRIBUTE`** (`data-motion-render-detector`) marks an element a render
  detector stands above. `<LayoutGroup>` and `<ReorderGroup>` render it, and so does `<Choreo>`.
  A component that calls `snapshotOnRender()` from a render detector of its own renders it too, so
  the warning above knows the elements inside it are measured.

- **`<Presence @mode="snapshot">`** plays a leaver's exit on a static copy of it. The leaver's block
  is torn down in the render that removes it, so nothing re-renders from state that has moved on.
  A copy of its last frame, pinned out of flow at the seat that frame showed it in, plays the
  element's `exit` and is then removed. For leavers whose content comes from state the yielded item
  can't carry, such as a component's caller blocks.
- **Memories: `keepAsMemory`, `readAnimations`, `trackScrolls`, `MEMORY_ATTRIBUTE` and
  `MEMORY_HOOK_SUFFIX`.** One treatment for a leaver kept on screen while its exit plays, shared by
  snapshot copies and `@cardstack/choreo`'s orphan layer. A memory holds the frame its element last
  showed, and nothing in it acts. Its stylesheet animations hold, its scroll offsets are restored,
  its backdrop filters are off, and it is inert and `aria-hidden`. Its HTML elements lose their ids,
  `autofocus` and form-control names, and its `data-test-*` hooks are renamed with a `-memory`
  suffix.
- **`live()` and `liveAll()` in `glimmer-motion/test-support`**: queries that skip memories, for
  selectors other than test hooks.
- **`retime(root)`** restarts the motion already running at and under an element on its current
  transition. Motion reads a transition when an animation starts, so an edited `transition` with an
  unchanged target leaves a running spring or loop on its old timing; `retime` restarts the values
  still animating on each element whose timing changed, toward the targets they already have, and
  keeps every infinite loop's place in its turn. For tuning tools, which edit timing on motion that
  is already playing.

### Fixed

- **No `@glimmer/tracking` peer dependency.** Declaring it made pnpm and npm install the
  standalone `@glimmer/tracking` 1.x package, and Embroider then resolved glimmer-motion's `tracked` to
  that copy instead of ember-source's. Its tracked state never reached Ember's renderer, so a
  `<Presence>` leaver stayed in the DOM after its exit finished. ember-source provides the module.
- **Development-only warnings stay out of production bundles.** The development check read
  `typeof process` before `process.env.NODE_ENV`, and a bundler replaces only the second, so in a
  production build of an app with no `process` global the check stayed true and warnings such as the
  layout-loop guard's reached the console. It reads `process.env.NODE_ENV` alone, which a production
  build replaces with `'production'`; with nothing replacing it, it counts as development.
- **`LICENSE` carries Motion's MIT notice.** The files adapted or ported from
  Motion (listed in `VENDORED.md`) ship under Framer B.V.'s copyright as well
  as Cardstack's.
