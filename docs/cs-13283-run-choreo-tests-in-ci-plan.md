# CS-13283: Run the imported Choreo test suite in monorepo CI

Linear: [CS-13283](https://linear.app/cardstack/issue/CS-13283) · Project: Choreo Productionization

## Goal

Run every test the source repo's `ci.yml` ran, from the packages' monorepo locations, so a later refactor that breaks something shows up as a regression against a green baseline.

## What the source repo ran

`pnpm build:boxel` (glimmer-motion, choreo-player, the gallery and its realm), `pnpm lint`, `pnpm docs:check`, the gallery's `test:realm` and `test:theater-sizing` (Playwright), then `pnpm test` (choreo-player's `node --test` suite and the test app's QUnit suite).

Lint is already covered by `ci-lint.yaml`. The rest maps to two jobs in `.github/workflows/ci.yaml`.

## Changes

- **`change-check`** gets a `choreo` output: the shared CI-boot paths plus the four Choreo packages. The packages depend only on each other and on npm packages; a change to a workspace patch reaches them through `pnpm-lock.yaml`, which the shared paths include.
- **`choreo-test` (Choreo Tests)**: guide coverage, then build glimmer-motion and choreo-player, choreo-player's unit tests, build the gallery and its realm, `test:realm`, `test:theater-sizing`. The test steps run `if: !cancelled()`, as in `ci-lint.yaml`, so one failing check doesn't hide the others.
- **`choreo-test-app-test` (Choreo Test App Tests)**: build glimmer-motion and choreo-player, then `pnpm test` in `choreo-test-app` (vite build into `dist-tests`, `ember test --path dist-tests` in headless Chrome). It is its own job because it is the long one (about 7.5 minutes locally), so it runs in parallel with the rest.
- Both jobs follow the `boxel-ui-test` pattern: run on a matching change, on `main`, and on `ci-bisect` branches.
- **`docs:check`** becomes a `choreo-gallery` script (`node tools/check-guide-coverage.mjs`). The source repo had it as a root script, which the import did not carry over.

## Decisions

- **Build order:** glimmer-motion and choreo-player build before the gallery and the test app, which resolve them through `package.json#exports` into `dist/` and `declarations/`.
- **Browser for theater sizing:** the script's default Playwright channel, `chrome`, launches the runner's preinstalled Google Chrome, the same browser the QUnit job uses. That skips the source repo's `playwright install --with-deps chromium` download.
- **No realm-server or Matrix:** none of these suites talk to the dev stack, so the jobs need only `./.github/actions/init`.

## Verification

Locally, from a fresh worktree of `main` after `pnpm install --frozen-lockfile`:

- guide coverage: 343 API entries and 88 guides pass, 46 demos complete;
- choreo-player unit tests: 10/10;
- gallery realm output tests: 9/9;
- theater sizing: both stylesheets pass;
- test app QUnit: 764 tests, 762 pass, 2 skipped (`skip(...)` in the source), 0 fail.

CI on the PR is the check that matters: both new jobs have to run and pass.
