# Poster Board

A FigJam-style infinite-canvas board card: pan, wheel/pinch zoom at the
cursor with momentum, and a zoom toolbar. `rig.gts` is the pure-TS camera
engine; `poster-board.gts` is the `PosterBoard` card def that renders it.

## Running the tests

Tests live in `poster-board.test.gts` and run on the live-test harness at
`packages/host/tests/live-test.js`: the realm serves the test file, and the
harness fetches the realm's `_mtimes`, filters for `*.test.gts` modules, and
calls each module's exported `runTests` at runtime.

### 1. Start the servers

From the monorepo project root:

```bash
mise run dev-all
```

This brings up the whole dev stack — host dev server (port 4200) plus the
realm server stack (base, catalog, and experiments realms, matrix, smtp) —
in the right order.

### 2a. Run in the browser (interactive)

```
https://localhost:4200/tests/index.html?liveTest=true&realmURL=https%3A%2F%2Flocalhost%3A4201%2Fexperiments%2F&filter=poster-board
```

`filter=` matches QUnit module names — `poster-board` selects the
`Rendering | poster-board card` module. Drop it to run every live test in
the experiments realm.

### 2b. Run headless (CLI)

```bash
cd packages/host && pnpm build   # test page runs from ./dist
REALM_URL="https://localhost:4201/experiments/" \
  npx ember test --config-file testem-live.js --path ./dist --filter "poster-board"
```

Or run the full experiments-realm suite (also from `packages/host` — that's
the only package that defines the `test:live` script):
`cd packages/host && REALM_URL="https://localhost:4201/experiments/" pnpm test:live`.

### Caveats

- After adding or moving a `.test.gts` file, the realm has to re-index before
  the runner's `_mtimes` discovery sees it — restart `mise run dev-all` if a
  new test doesn't show up.
- These tests do not run in CI: the `ci-host.yaml` path filter doesn't
  include `packages/experiments-realm/**`, and the live-test job targets the
  skills realm (which has no test files) rather than experiments. Run the
  tests locally before merging and say so in the PR.
