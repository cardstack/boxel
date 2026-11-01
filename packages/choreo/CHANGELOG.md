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

### Fixed

- **A run's tweens start on the frame the run first paints.** motion-dom dates a tween from a
  clock that holds one reading through a synchronous stretch of work, so a run compiled late in a
  long render could open its tweens that far in: the first painted frame of a move already showed
  part of its travel. The run's own clock already started fresh; its tweens now do too, with or
  without `@maxFrameStep`, and a run resumed from a pause carries them on from where they were held
  instead of restarting them. A run that replaces one still moving is the exception: its first
  frame advances like any other, clock and tweens alike, so the motion on screen doesn't stand
  still for a frame.
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
