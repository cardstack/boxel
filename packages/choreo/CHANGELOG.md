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

- **`animationsSettled()` waits for a text delivery to give its text back.** A `@by='character'`
  or `@by='word'` delivery lands on its own platform animations, which can finish after the run's
  clock has ended. The region now reports `delivery in flight` until the sprite's original text is
  restored, so a settled page no longer has stand-in spans in it. Pausing a run whose clock is
  past a delivery's cue lands that delivery instead of freezing its spans in place.
- **An ambient loop keeps its place when its run is replaced.** A `@repeat={{Infinity}}` Tween's
  loop restarted from the top of its cycle whenever its region compiled a new run — an edited
  `@duration`, or any arrival in the region. The new run now carries the same loop on the same
  sprite on from where it was, at its new timing.
- **No `@glimmer/tracking` peer dependency.** Declaring it made pnpm and npm install the
  standalone `@glimmer/tracking` 1.x package, whose `tracked` doesn't reach Ember's renderer.
  ember-source provides the module.
- **The README's first example passes `@duration`** (in seconds), not the removed `@ms`.
