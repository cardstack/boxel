# Shim glimmer-motion and choreo into realms, with boxel-cli types and host tests — plan

## Goal

A card in a realm can `import … from` glimmer-motion and `@cardstack/choreo`
(plus their public subpaths). It loads them through the host's externals shims,
gets the host's own module objects, and so shares one copy of the module-global
state (drag lock, layout scheduler, Choreo registry). `boxel parse` type-checks
that card. Host integration tests prove a card animates with each library.

## Merge order

- Builds on PR 6524 (CS-13389), which gives host `workspace:*` dependencies on
  both packages and has host build them from source through the
  `developing:choreo` export condition.
- PR title: `feat: …`, because it touches `packages/boxel-cli`.
- boxel-cli publishes on merge, and `workspace:*` publishes as the exact
  version in the repo. Merge only once `packages/glimmer-motion/package.json`
  and `packages/choreo/package.json` both carry a version that is a real
  published release (CS-13295). Before then, Boxel CLI Tests' packed-install
  step fails, because npm has no `glimmer-motion` at the repo's version.
  `@cardstack/choreo@0.0.0` is a name-reserving placeholder, so a CLI
  published against it would install but fail to resolve choreo's types.

## What exists today

- `externals.ts` shims about 70 specifiers. Sync shims are `shimModule(id, ns)`;
  async shims are `shimAsyncModule({ id, resolve: () => import(…) })`, as
  `@cardstack/bxl` uses. The boxel-ui entry points are four explicit sync shims
  plus an `addPackageMapping('@cardstack/boxel-ui/', …)`. The mapping exists so
  `CodeRef.moduleHref` resolves spec-card refs, not for module loading.
  `shimAsyncModule` also takes a `{ prefix, resolve }` descriptor.
- `boxel-cli/tests/card-runtime-packages.test.ts` reads every `shimModule` and
  `shimAsyncModule` id from `externals.ts`. It fails unless each id resolves
  from boxel-cli (TypeScript, `bundler` resolution, **no custom conditions**)
  to a `.d.ts`, or is covered by an allowlist. It also fails on any shim whose
  id isn't a string literal, which includes the `{ prefix }` form. So this
  already covers the new specifiers once they're listed explicitly.
- Package names: choreo is `@cardstack/choreo`. glimmer-motion's `package.json`
  name is plain **`glimmer-motion`**, and every import site uses that name
  (about 170, across choreo, choreo-test-app, glimmer-motion, choreo-gallery
  and host). On npm, `@cardstack/glimmer-motion@0.0.0` and
  `@cardstack/choreo@0.0.0` exist (placeholders from the Trusted Publisher
  setup). Unscoped `glimmer-motion` doesn't exist. See Decision 1.
- Public subpaths (from `package.json#exports`):
  - glimmer-motion: `.`, `/test-support`, `/layout-group`, `/motion-config`,
    `/presence`, `/reorder/group`, `/reorder/item`, plus a `./*` wildcard that
    exposes every `src/*.ts` module (internals such as `node`, `scheduler`).
  - choreo: `.`, `/test-support`, `/choreo`, `/steps`, eleven `/film/*`
    component entries, plus a `./*` wildcard, which is how `/film` resolves
    (`src/film.ts`).
  - Consumer usage today: `glimmer-motion` (105), `@cardstack/choreo` (66),
    `@cardstack/choreo/film` (18), both `/test-support` entry points, and a
    handful of internal deep imports from the test app (`/film/math`, `/run`,
    `/path`, `/compile`, `/changeset`).
- `choreo-gallery/tests/boxel-{import,minimal,runtime}.test.gts` run only
  through `scripts/test-boxel-runtime.mjs` (`pnpm test:boxel`). That script runs
  `boxel test` against the _generated_ `dist-realm/`, whose engine comes from
  the hashed realm bundle, not the shims. `boxel-runtime` asserts on the
  generated gallery site (45 tiles, theme toggle, keyframes detail route,
  towers theater). `boxel-minimal` is a no-op `assert.ok(true)`.
- PR 6524 already adds
  `host/tests/integration/components/glimmer-motion-and-choreo-test.gts`. It
  tests the libraries from host code, not from a card.

## Design

### 1. Shims (`packages/host/app/lib/externals.ts`)

Each subpath is listed explicitly. That way the boxel-cli test can read every
specifier, and Vite can see every `import()` target statically. A `{ prefix }`
shim would need a dynamic `import(\`…/${rest}\`)` and would hide the subpaths
from the boxel-cli test.

- **glimmer-motion: sync** for `.`, `/layout-group`, `/motion-config`,
  `/presence`, `/reorder/group` and `/reorder/item`: namespace imports plus
  `shimModule`. **`/test-support` is async.** Card tests are its only
  consumers, and the `ember/no-test-support-import` lint rule bans a static
  test-support import in app code. An `import()` still resolves to the host's
  own module, so state stays shared.
- **choreo: async.** `shimAsyncModule({ id, resolve: () => import(id) })` for
  `.`, `/film` and `/test-support`. Per the measurement in the ticket comment,
  sync would add about 79 KB gzipped to every page load, and async adds about
  0.1 KB.
- **choreo also shims its explicit component entries:** `/choreo`, `/steps`
  and the eleven `/film/*` entries, all async (Decision 3).
- **The `./*` wildcard internals aren't shimmed**, for either package. Shimming
  them would freeze module internals as card-facing API.
- **motion-dom isn't shimmed.** Cards use glimmer-motion's curated re-exports
  (`motionValue`, `MotionValue`, `animate`, `transformValue`, `styleEffect`,
  `frame`).
- A short comment block says why glimmer-motion is sync and choreo is async,
  and that choreo should switch to sync once host UI imports it. No host UI
  imports glimmer-motion yet, so its sync shims are what put it in the initial
  bundle (an esbuild estimate puts the six entries at about 60 KB gzipped).

### 1a. choreo's film sources under host's type-check

The `/film` shim brings choreo's film modules into host's `ember-tsc` run
(host compiles them from source through `developing:choreo`). Host's settings
are stricter than choreo's library tsconfig in two ways that surfaced:

- `noUnusedLocals`: `film.gts` carried three dead private members (`retire`,
  which `joins.gts`'s exported `retire` supersedes, plus `beginSound` and
  `beginMute`). They're deleted.
- Host types an `{{on}}` callback as `(event: Event) => void`. The film
  player's scrub args are typed that way, and film's handlers narrow to
  `PointerEvent` inside, which is host's own convention.

### 2. boxel-cli

- Add glimmer-motion and `@cardstack/choreo` to `dependencies` as
  `workspace:*`. pnpm rewrites that to the exact version on publish.
- Check that `boxel parse` on a card importing both resolves cleanly. The
  libraries' declarations import `motion-dom`, `motion-utils` and
  `framer-motion` types. If parse reports unresolved types through them, also
  add `motion-dom` and `motion-utils` to `dependencies`. They're peers of both
  libraries, and `linkResolvedDeps` only links what boxel-cli declares.
- `card-runtime-packages.test.ts` needs no new logic. The new ids are string
  literals and resolve through `exports.types` → `declarations/`. Extend its
  "finds the shims it is meant to be checking" sanity test with one
  glimmer-motion and one choreo specifier.
- **CI ordering:** `declarations/` exists only after the packages are built.
  The test deliberately resolves without the `developing:choreo` condition,
  because the published CLI resolves without it too. So the `boxel-cli-test`
  job (and `boxel-cli-build`, if the parse type bundle needs it) gets a step to
  build glimmer-motion, then choreo. The `boxel-cli` path filter adds
  `packages/glimmer-motion/**` and `packages/choreo/**`, because their
  `exports` now feed the boxel-cli suite.

### 3. Host integration tests

New `packages/host/tests/integration/glimmer-motion-and-choreo-in-cards-test.gts`,
following `bxl-platform-module-test.gts`. Card modules are realm **source
strings** in `setupIntegrationTestRealm`, so the imports go through the
VirtualNetwork shims exactly as in a user realm.

1. **A card importing glimmer-motion renders and animates.** A card whose
   template uses `{{motion initial=(hash opacity=0) animate=(hash opacity=1)
transition=(hash duration=0.05)}}`. Render it, `animationsSettled()`, and
   assert the inline `opacity` is `1`.
2. **A card using `<Choreo>` runs a timeline.** A card that removes a
   choreographed element on a click. Assert it moves to
   `[data-choreo-orphans]` while its `c.Tween` exit plays, then unmounts. This
   goes through the async shim.
3. **A card importing a curated motion-dom re-export works.** A card that
   builds a `motionValue`, subscribes with `styleEffect` (or `.on('change')`),
   and sets the value. Assert the element's style follows.
4. **Shared module state.** For every one of the 24 shimmed ids, each export
   `loader.import(spec)` gives a card is the same object as the host's own
   `import(spec)` gives. Then check that state is
   observable across the boundary: a Choreo run started from a card is visible
   to host-side choreo (for example, `activeRuns`, or whatever choreo's
   test-support reset reads). The identity assertion alone would pass even if
   a bundler split the module, so the state assertion is the one that matters.

These run under the host test harness from PR 6524, which builds both
libraries from source.

### 4. The three choreo-gallery tests

- `boxel-minimal.test.gts` (no-op) and `boxel-import.test.gts` (the generated
  site module loads) are replaced by host tests 1–3. Delete them.
- `boxel-runtime.test.gts` asserts on the generated gallery site, which only
  exists after `build:realm` and still loads the engine from the hashed bundle,
  not the shims. It can't become a host test until the gallery is realm content
  (CS-13297 / CS-13298 / CS-13300). It's deleted with the other two, and its
  assertions are recorded on CS-13298 / CS-13300 (Decision 2).

## Target files

- `packages/host/app/lib/externals.ts`
- `packages/host/tests/integration/glimmer-motion-and-choreo-in-cards-test.gts` (new)
- `packages/choreo/src/film/film.gts`, `packages/choreo/src/film/player.gts`
- `packages/boxel-cli/package.json`, `pnpm-lock.yaml`
- `packages/boxel-cli/tests/card-runtime-packages.test.ts` (sanity assertion only)
- `.github/workflows/ci.yaml` (build both packages in the boxel-cli jobs; path filter)
- `packages/choreo-gallery/tests/boxel-*.test.gts`, `scripts/test-boxel-runtime.mjs`,
  `package.json#scripts.test:boxel` (deleted)

## Testing notes

- `pnpm test` in `packages/boxel-cli` (`card-runtime-packages.test.ts`), after
  building glimmer-motion and choreo.
- Host: `ember test --path dist --filter "glimmer-motion and choreo"` against a
  running stack. Coordinate start and stop with peer sessions.
- `pnpm lint` in host and boxel-cli.
- A manual `boxel parse` of a sample card that imports both, `motionValue`
  included, to confirm the types resolve end to end.

## Decisions

1. **glimmer-motion keeps its package name, `glimmer-motion`.** That's the shim
   id and the boxel-cli dependency name. The publish tickets (CS-13293 /
   CS-13295) and the npm Trusted Publisher rule currently say
   `@cardstack/glimmer-motion`, so they need to follow the unscoped name.
2. **All three gallery tests and the `test:boxel` runner are deleted.** The
   gallery-site assertions in `boxel-runtime` (tile count, theme toggle, detail
   route, theater) are recorded on CS-13298 / CS-13300, where the gallery
   becomes realm content.
3. **choreo shims every explicit export:** `.`, `/test-support`, `/film`,
   `/choreo`, `/steps`, and the eleven `/film/*` component entries. All are
   async. The `./*` wildcard internals stay unshimmed, for both packages.
