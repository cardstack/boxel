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
- **`LICENSE` carries Motion's MIT notice.** The files adapted or ported from
  Motion (listed in `VENDORED.md`) ship under Framer B.V.'s copyright as well
  as Cardstack's.
