# Changelog

All notable changes to `@cardstack/choreo` are recorded here.

This file follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

`glimmer-motion` and `@cardstack/choreo` release in lockstep: every version
of one is a version of the other, and `@cardstack/choreo` peer-depends on the
exact `glimmer-motion` version it was released with.

Pre-1.0 caveat: the public API is intentionally unstable. Minor and patch
versions may change behavior until `1.0.0`.

## [Unreleased]

### Added

- **A region renders `data-motion-render-detector`.** A region snapshots every projecting element
  before a render pass patches the DOM, so `{{motion layout=true}}` inside it animates without a
  `<LayoutGroup>`. The marker (glimmer-motion's `RENDER_DETECTOR_ATTRIBUTE`) tells glimmer-motion's
  development-mode check for an ungrouped `layout` or `layoutId` element that the elements inside a
  region are measured.

### Changed

- **A parked leaver is kept as a memory** (see glimmer-motion's `keepAsMemory`). An element in a
  region's orphan layer is inert and `aria-hidden`, holds its stylesheet animations at the frame it
  showed, and keeps its scroll offsets. Its HTML elements lose their `id`, `autofocus` and
  form-control `name`, and its `data-test-*` hooks are renamed with a `-memory` suffix:
  `data-test-id` becomes `data-test-id-memory`, with its value. CSS or a test that finds a parked
  leaver by `#id` or by its test hook needs the suffixed hook instead. The memory treatment replaces
  the orphan stylesheet, which set `animation: none` on everything in the layer.
- **`live()` and `liveAll()` come from `glimmer-motion/test-support`**, and
  `@cardstack/choreo/test-support` re-exports them. They skip every memory, a parked leaver or a
  `<Presence @mode="snapshot">` copy, for selectors other than test hooks.

### Fixed

- **Measuring doesn't move the scroll.** A region measures with its runs' values at rest, and a
  translate that reached past the end of its scroller had added to the scroll height, so a reader at
  the end was clamped to the shorter height, and a scroll owner such as a stick-to-bottom transcript
  took the clamp for the reader scrolling up. While the regions measure, the render pass now holds
  the scroll height of the nearest block-flow scroller above each region with a hidden block after
  its content, and takes the block out once the runs stand again. A region with no scrolling element
  above it holds the document, with the block at the end of `<body>`. A `@route` region takes the
  block out before it places the window. `<body>` with an overflow of its own (such as
  `overflow-x: hidden`) while `<html>`'s is visible is no longer taken for a scroller, since its
  overflow goes to the viewport: the document is held, and `@inView` measures against the viewport
  there. A scroller that is a flex or grid container, or whose own size would change with the block
  in, is not held. While the block stands, a stylesheet rule that picks the scroller's children by
  their place among siblings (`:last-child`) doesn't match the real last child.
- **`animationsSettled()` waits for a text delivery to give its text back.** A `@by='character'`
  or `@by='word'` delivery lands on its own platform animations, which can finish after the run's
  clock has ended. The region now reports `delivery in flight` until the sprite's original text is
  restored, so a settled page no longer has stand-in spans in it. Pausing a run whose clock is
  past a delivery's cue lands that delivery instead of freezing its spans in place.
- **A region honours reduced motion on every path it drives.** Choreo already let motion-dom jump
  positional values for a viewer who asks for reduced motion, but its ambient loops, text
  deliveries, `@path` flights, camera and `c.Scroll` steps ran on platform animations or its own
  clock, which ignored the preference.
  Each run now follows the region's `MotionConfig` (`'user'` by default, so the system setting):
  with motion reduced, the score keeps its timing, positional values land at their step's start,
  and opacity and colour still animate. `<MotionConfig @reducedMotion='never'>` opts a region out.
- **An ambient loop keeps its place when its run is replaced.** A `@repeat={{Infinity}}` Tween's
  loop restarted from the top of its cycle whenever its region compiled a new run — an edited
  `@duration`, or any arrival in the region. The new run now carries the same loop on the same
  sprite on from where it was, at its new timing.
- **No `@glimmer/tracking` peer dependency.** Declaring it made pnpm and npm install the
  standalone `@glimmer/tracking` 1.x package, whose `tracked` doesn't reach Ember's renderer.
  ember-source provides the module.
- **The README's first example passes `@duration`** (in seconds), not the removed `@ms`.
