# CS-13289: choreo test harness

## Goal

`packages/choreo` runs its own Choreo and film tests in a vite + QUnit harness
inside the package, the same way `packages/glimmer-motion` does, and CI runs
them whenever choreo or glimmer-motion changes.

## Scope

Moves into `packages/choreo/tests`:

- `integration/choreo/**`, except the tests that render gallery demos
- `integration/film/` `clip-look`, `join-presentation`, `render-at`
- `unit/` `compile`, `film-clips`, `film-seam`, `film-seam-shape`,
  `motion-reset`
- `public/test-picture.html` (the iframe page `render-at` loads)

Stays in test-app, because each renders a gallery demo component or film
score from test-app (they move to the host with the gallery):

- `integration/choreo/` `build-order-leaver`, `build-order-neighbor`,
  `build-order-transport`, `interruption`, `playhead-transport`,
  `presentation`, `wires`
- `integration/film/` `film-boot`, `graph`
- `unit/film-schedule` and `fixtures/film/*.json` (compared against the
  demo films' schedules)
- `unit/route-collision`, which checks the gallery app's routes against its
  `public/` entries

## Approach

- Harness files copied from glimmer-motion's: `vite.config.mjs`,
  `babel.config.mjs` (test build), `testem.cjs`, `tests/index.html`,
  `tests/test-helper.ts`. The publish build reads `babel.publish.config.json`.
- `vite.config.mjs` resolves `@cardstack/choreo/*` and `glimmer-motion/*` to
  their source, serves framer-motion's internals the way glimmer-motion's
  harness does, aliases `@glimmer/tracking` / `@glimmer/validator` to
  ember-source's copies, and serves `tests/public` at the root.
- `tests/helpers/` carries the two helpers the suite uses:
  `setupFixtureViewport` and `nextFrame` / `sleep`.
- `tsconfig.json` type-checks `tests/`; `tsconfig.declarations.json` stays on
  `src`.
- CI: a `choreo-addon` change-check filter (`packages/choreo/**`,
  `packages/glimmer-motion/**`) gates a new `Choreo Addon Tests` job running
  `pnpm test` in `packages/choreo`.

## Testing

- `pnpm test` in `packages/choreo`: 168 tests pass.
- `pnpm test` in `packages/choreo-test-app` (after building glimmer-motion,
  choreo and choreo-player): 185 tests pass.
- `pnpm lint` in both packages.
