# CS-13320: Enforce ember-template-lint in the imported Choreo packages

## Goal

`lint:hbs` is part of `pnpm lint` in glimmer-motion, choreo-gallery and the
Choreo test app, and passes. ci-lint already runs `pnpm lint` in each of them,
so adding the scripts is what makes CI enforce template lint.

## Assumptions

- choreo-player has no templates and no ember-template-lint dependency, so it
  stays out of scope.
- Moving to the catalog's `ember-template-lint` (7.x, as boxel-ui and host use)
  happens in the same change, so the findings are fixed against the version CI
  will run.

## Findings (ember-template-lint 7.9.3, `recommended`)

- glimmer-motion: 14 (no-inline-styles 6, no-forbidden-elements 1,
  no-invalid-interactive 2, no-pointer-down-event-binding 1,
  require-presentational-children 4)
- choreo-gallery: 6 (no-forbidden-elements 4, link-rel-noopener 2)
- test app: 582, of which 390 are no-inline-styles in `tests/`

## Approach

Rules that don't fit this code, turned off in config with a reason:

- `no-forbidden-elements` configured to `['meta', 'html', 'script']` in all
  three packages, allowing `<style>` as boxel's own template-lint plugin does.
- `no-pointer-down-event-binding` off in all three: a drag, press or scrub
  gesture starts on pointer down, and binding it to pointer up breaks the
  gesture. boxel-ui turns it off for the same reason.
- `no-inline-styles` off in glimmer-motion: the addon ships no stylesheet, so
  the structural styles its own elements need (`display: contents`, overlay
  positioning) ride on the element.
- In the test app's `tests/**`: `no-inline-styles`, `style-concatenation` and
  `no-invalid-interactive` off. Test fixtures set exact geometry inline so the
  engine's measurements are deterministic, and bind gestures to plain elements
  to exercise the engine.
- In the test app, `no-nested-interactive` ignores `<details>`: only its
  `<summary>` is interactive, so buttons in the open panel are not nested.

Everything else is fixed in place, or disabled at the element with a reason
where the markup is deliberate:

- The film player's slider draws its fills and tip with classed `<span>`s
  instead of `<em>`/`<i>`/`<small>`/`<b>`.
- Concatenated `style=` bindings in the demo app become `htmlSafe` values.
- Template comments whose text holds a mustache use the `{{!-- --}}` form; the
  short form ends at the first `}}` and renders the rest as text.
- Docs text that shows a literal mustache uses `\{{`, not a string literal.
  The `no-unnecessary-curly-strings` autofix unwraps `{{"{{x}}"}}` into a live
  `{{x}}`, so those are hand-fixed.
- Unlabelled inputs get an `aria-label`; the camera dock's verdict controls
  become `<button>`s; the rack slider reports `aria-valuenow`; per-scene
  `<header>`s that aren't page banners become `<div>`s; the two guide
  `<aside>`s get labels.
- Deliberate cases disabled at the element: click-swallowing wrappers, the
  film stage's click-to-play glass, pointer-only double-click shortcuts,
  dialkit's forget control inside its preset chip, the rack's notch buttons
  inside the slider, and ids repeated across branches that never render
  together.

Then add `lint:hbs` / `lint:hbs:fix` (`ember-template-lint .`) to each
package's scripts.

## Target files

- `packages/{glimmer-motion,choreo-gallery,choreo-test-app}/package.json`
- `packages/{glimmer-motion,choreo-gallery}/.template-lintrc.cjs`,
  `packages/choreo-test-app/.template-lintrc.js`
- The `.gts` files carrying findings
- `pnpm-lock.yaml`

## Testing

- `pnpm lint` in each of the three packages.
- The glimmer-motion player and film changes are markup/CSS-selector changes.
  Run the test app's suite for the film/player tests that cover them.
