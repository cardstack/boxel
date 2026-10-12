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

### Fixed

- **No `@glimmer/tracking` peer dependency.** Declaring it made pnpm and npm install the
  standalone `@glimmer/tracking` 1.x package, and Embroider then resolved glimmer-motion's `tracked` to
  that copy instead of ember-source's. Its tracked state never reached Ember's renderer, so a
  `<Presence>` leaver stayed in the DOM after its exit finished. ember-source provides the module.
- **`LICENSE` carries Motion's MIT notice.** The files adapted or ported from
  Motion (listed in `VENDORED.md`) ship under Framer B.V.'s copyright as well
  as Cardstack's.
