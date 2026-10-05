# CS-13288: glimmer-motion test harness — plan

## Goal

Give `packages/glimmer-motion` its own vite + QUnit test harness (the
`packages/boxel-ui/tests` pattern, no separate test-app package), move the
Motion fidelity suite out of `packages/choreo-test-app` into it, and run it in
CI behind a `change-check` filter for `packages/glimmer-motion/**`.

## What moves, and what doesn't

Surveying the imports of every candidate file splits them three ways.

### Moves to `packages/glimmer-motion/tests` (37 + 2 files)

The 37 files under `tests/integration/motion/**` that import only
`glimmer-motion`, `motion-dom` / `motion-utils`, `motion`, Ember, and the
shared helpers: everything in `drag/`, `gestures/`, `layout/`, plus
animate-presence(-reentry), animate-prop, delay, helpers,
layout-group, layout-loop-guard, motion-config, participant-host,
presence-late-child, presence-roundtrip, scroll, speed, style-prop,
transition-keyframes, unmount-motion-value, variant.

Two more that the ticket doesn't name but that test only glimmer-motion
(recommend including):

- `tests/unit/engine-exports-test.ts`: checks glimmer-motion's curated
  motion-dom re-exports against the engine's own functions (imports
  `glimmer-motion`, `motion`, `motion-dom` only).
- `tests/unit/motion-reset-test.ts`: its first two tests cover glimmer-motion's
  `registerMotionReset` / `resetMotion` registry and move. Its third test
  ("resetMotion clears Choreo's beacon registry") imports
  `@cardstack/choreo/beacons`, so it stays in test-app for CS-13289 to take to
  choreo's harness. glimmer-motion can't depend on choreo.

### Stays in test-app: demo-bound (8 files under `motion/`)

These render gallery demo components or the gallery catalog, so they're
demo-bound in the project's sense and move to the host with their demos
(CS-13298):

| Test                                    | Demo dependency                                                                     |
| --------------------------------------- | ----------------------------------------------------------------------------------- |
| `gallery-demos-alive`, `gallery-filter` | `Gallery`, `catalog`, `@cardstack/choreo/test-support` (already listed in CS-13298) |
| `poplayout-subtree`                     | mounts every `catalog` demo                                                         |
| `sheet`, `sheet-standalone`             | `examples/sheet`                                                                    |
| `lone-stack`                            | `examples/lightbox`                                                                 |
| `presence-modes`                        | `examples/presence-modes`                                                           |
| `subdivision`                           | `examples/subdivision`                                                              |

`fixture-viewport` stays too: it pins how test-app's `setupFixtureViewport`
mutes the app stylesheet, and glimmer-motion's harness has no app
stylesheet, so its copy of the fixture drops the muting.

The ones CS-13298 didn't already list are recorded in a comment on it.

### Conflict with the ticket: `compositor-test` and `drift-test`

The ticket says to move both, but neither tests glimmer-motion:

- `tests/integration/compositor-test.ts` tests `test-app/lib/compositor.ts`,
  the composition host. It is application-side code that drives runs through
  `choreo-player` and imports nothing from glimmer-motion.
- `tests/unit/drift-test.ts` tests `test-app/lib/drift.ts` (the Drift demo's
  hand-written car physics, "deliberately not Choreo") and reads `TUNING`
  from `examples/drift.gts`.

Moving the tests means moving the code they test into glimmer-motion, which
would make glimmer-motion carry demo physics and depend on choreo-player.
**Decision:** both stay in test-app as demo-bound, recorded on CS-13298 so
they go to the host with the Drift demo and the composition host.

## Harness design

Modelled on boxel-ui:

- `tests/index.html`, `tests/test-helper.ts`: a strict-resolver `EmberApp`
  (`ember-strict-application-resolver`), `setApplication`, `qunit-dom`,
  `setupEmberOnerrorValidation`, `qunitStart`. The test-app's app config,
  router and initializers aren't needed: no moved test uses routing or app
  services.
- `tests/helpers/`: `index.ts` (ember-qunit setup wrappers), `motion.ts`,
  `layout-fixture.ts`, `capture-el.ts`, moved as-is. They're test-only, so
  they belong to the harness, not the published `test-support` entry. Test
  imports of `test-app/tests/helpers` become relative.
- `vite.config.mjs` + `testem.cjs` like boxel-ui's, plus test-app's
  `process.env.NODE_ENV` define from `--mode`, so Motion's dev-only warnings
  and invariants are live in the test build.
- **Resolving `glimmer-motion/*`:** tests keep importing the public specifiers
  (`glimmer-motion/motion`, `glimmer-motion/test-support`…). A vite
  `resolve.alias` and a tsconfig `paths` entry point them at `src/`, so the
  suite runs against source with no rollup build first. `package.json#exports`
  stays as it is; switching it to source is CS-13389's job.
- **Babel:** `babel.config.json` is the rollup publish config (`targetFormat:
hbs`, colocation). Following boxel-ui, add a vite-side `babel.config.mjs`
  for the harness and point rollup at the existing config, renamed to
  `babel.publish.config.json`.
- **One validator:** glimmer-motion's devDependencies include the npm
  `@glimmer/tracking` and `@glimmer/validator` (for their types). Vite would
  bundle those real packages instead of ember-source's renamed modules, so
  tracked state and LayoutGroup's `VOLATILE_TAG` render detector would never
  invalidate ember-source's templates and no layout animation would start.
  `vite.config.mjs` aliases both to ember-source's copies.
- **`@ember/test-helpers`:** the devDependency moves from `^4.0.5` to the
  catalog's 5.x, as boxel-ui uses. 4.x reads a global `EmberENV` that only a
  classic app defines.
- **TypeScript / lint:** the tsconfig that emits `declarations/` must not pick
  up `tests/`. Add `tests/**` to the type-checked set through a separate
  `tsconfig.declarations.json` for the build (as `packages/choreo` already
  does) and keep `lint:types` covering `src` + `tests`. eslint and prettier
  already run package-wide.
- **Scripts:** `start:test` = `vite dev --open /tests/`, `test` = `vite build
--mode=development --out-dir dist-tests && testem --file testem.cjs ci
--port 0`, replacing the "v2 addons don't have tests" stub.
- **devDependencies:** `@embroider/vite`, `@embroider/core`,
  `@embroider/macros`, `vite`, `ember-qunit`, `qunit`, `qunit-dom`,
  `@types/qunit`, `ember-strict-application-resolver`, `ember-template-imports`,
  `testem`, `motion` (catalog versions where the catalog has them). `dist-tests`
  goes in `.gitignore` and the eslint/prettier ignores.

## CI

- New `change-check` filter `glimmer-motion`: `*shared` +
  `packages/glimmer-motion/**`.
- New job `glimmer-motion-test` ("Glimmer Motion Tests"), modelled on
  `boxel-ui-test`: init, then `pnpm test` in `packages/glimmer-motion`. No
  build step, since the harness compiles from source.
- `choreo-test-app-test` stays (it still runs the choreo and demo-bound
  tests); its header comment drops glimmer-motion.

## Steps

1. Harness scaffolding (config, scripts, deps, babel/tsconfig split); confirm
   `pnpm build` still produces the same `dist/` + `declarations/`.
2. `git mv` the 37 integration files, helpers and engine-exports-test; split
   motion-reset-test. Rewrite helper imports.
3. Run `pnpm test` in glimmer-motion until green; run test-app's suite to
   confirm what's left still passes (it still uses the helpers, so they stay
   there too, copied — they're deleted with test-app in CS-13302).
4. `pnpm lint` in glimmer-motion and choreo-test-app.
5. CI job + filter.
6. Update CS-13298 (and CS-13289 for the beacon reset test) with the tests
   left behind.

## Testing notes

- Local: `pnpm test` from `packages/glimmer-motion` (headless Chrome via
  testem); `pnpm start:test` for the browser runner.
- The slow-motion layout timing test (`speed-test`) is known-flaky in CI
  (CS-13453); a failure there isn't a regression from this move.
- Done when the moved tests pass from `packages/glimmer-motion` in CI and are
  gone from test-app.
