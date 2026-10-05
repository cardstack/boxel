# Build glimmer-motion and choreo from source in the monorepo, through an export condition — plan

## Goal

Inside the monorepo, host (and the Choreo test app and gallery) compile
glimmer-motion's and choreo's `src/` straight into their own builds and
type-check against that source, the way host consumes boxel-ui. Nothing has to
be built first, and there is no stale `dist/` or `declarations/`. npm consumers
keep resolving to the rollup output.

**Done when:** host builds and type-checks against both packages' source
with neither package built, and the packed tarballs still resolve to
`dist/` / `declarations/` without the condition.

## What exists today

- Both packages' `package.json#exports` map every entry to
  `declarations/*.d.ts` (types) and `dist/*.js` (default). The `./*` pattern
  exposes every module, and consumers use about 15 of those subpaths
  (`glimmer-motion/motion`, `/presence`, `/reorder/item`,
  `/gestures/drag-controls`, …).
- `src/` mixes `.ts` and `.gts` (glimmer-motion has 5 `.gts`
  modules; choreo has 14, 12 of them under `film/`), and relative imports are
  extensionless.
- `choreo`, `choreo-test-app` and `choreo-gallery` type-check from source
  today through tsconfig `paths` pointing at `../glimmer-motion/src` and
  `../choreo/src` (from CS-13382). Their **Vite** builds still need
  `dist/`, so CI's "Build Glimmer Motion, Choreo and Choreo Player" step
  runs before the gallery and test-app suites.
- Host doesn't depend on either package yet (CS-13290 is in Backlog).
- `src/framer-motion-internals.ts` imports 13 modules from
  `framer-motion/dist/es/…`, past framer-motion's exports map. glimmer-motion's
  rollup config resolves those paths and inlines the modules. Those 13 entries
  reach 22 framer-motion modules, which import `motion-dom`,
  `motion-utils`, and in one place (`utils/use-constant.mjs`, `useRef`)
  `react`. Rollup tree-shakes that last one away. A Vite consumer compiling
  the source gets no tree-shaking at resolve time, so it hits all three.

## Design

### 1. The condition: `developing:choreo`

Each package's exports put the condition **first** in every entry, so
both Vite and TypeScript pick it before `types` / `default`:

```jsonc
".": {
  "developing:choreo": "./src/index.ts",
  "types": "./declarations/index.d.ts",
  "default": "./dist/index.js"
},
"./test-support": {
  "developing:choreo": "./src/test-support/index.ts",
  …
},
"./*": {
  "developing:choreo": "./src/*.ts",
  …
}
```

A pattern maps one extension, so each `.gts` module gets an exact
entry ahead of `./*` (`./presence`, `./layout-group`, `./motion-config`,
`./reorder/group`, `./reorder/item` in glimmer-motion; `./choreo`, `./steps`
and the `film/*.gts` modules in choreo). An exact key wins over a pattern
in both Node's and TypeScript's resolution, so the order of keys doesn't
matter. The `.gts` entries also carry their `types`/`default` targets, so
the built route is unchanged.

The condition has one name, used by both packages, because their consumers
are the same set.

### 2. Host

- **Dependencies:** `glimmer-motion` and `@cardstack/choreo` as `workspace:*`,
  and `motion-dom` / `motion-utils` from `catalog:`. This is the
  dependency half of CS-13290 (see decision 1).
- **TypeScript:** `customConditions: ["developing:choreo"]` in
  `packages/host/tsconfig.json`. Host stays on `moduleResolution: nodenext`;
  TS 5.9 honours `customConditions` there (checked), so switching host to
  `bundler` would be a host-wide change with nothing to gain.
  Imported source files join host's program and are checked under host's
  stricter flags (`noUnusedLocals`, `noImplicitReturns`, …). If that
  surfaces errors, fix them in the packages; don't loosen host.
- **Vite:** `resolve.conditions: ['developing:choreo', ...defaultClientConditions]`.
  Vite replaces its defaults when `conditions` is set, so the defaults
  are spread back in.
- **framer-motion internals:** a small Vite plugin, `glimmerMotionSource()`,
  kept in glimmer-motion (`packages/glimmer-motion/scripts/source-resolution.mjs`)
  beside the rollup config it mirrors, so that knowledge sits with the package
  that needs it. It does three things:
  1. resolves `framer-motion/dist/es/…` imported from glimmer-motion's source
     to the file in framer-motion's install, past the exports map;
  2. resolves `react` imported **from a framer-motion module** to a stub
     exporting `useRef`, which throws if called. Only `useDragControls`
     reaches it, and glimmer-motion doesn't use `useDragControls`;
  3. blanks the `"use client"` directive at the top of framer-motion's React
     hook modules, which bundlers otherwise warn about on every build.

  Host and the test app import the plugin by relative path. The
  test app already does the same with `../choreo-gallery/scripts/iframe-plugin.mjs`.
  rollup.config.mjs reuses the same specifier-to-path mapping, so the two
  routes can't drift.

- **One motion-dom copy:** framer-motion's bare `motion-dom` / `motion-utils`
  imports have to resolve to the same pre-bundled module as host's. Check this
  in the browser (one `motion-dom` entry in the module graph) rather than
  assuming it. Checked: on the dev server, glimmer-motion and choreo load from
  `src/`, the framer-motion internals load from the framer-motion install, and
  `motion-dom` / `motion-utils` load once each, as optimized deps. The plugin
  doesn't need registering with the dependency optimizer separately.

### 3. Other workspace consumers

- **choreo** (imports glimmer-motion): replace its tsconfig `paths` with
  `customConditions`. `tsconfig.declarations.json` already clears `paths`
  so emitted declarations import `glimmer-motion`. It needs
  `customConditions: []` instead, for the same reason.
- **choreo-test-app, choreo-gallery:** replace tsconfig `paths` for
  glimmer-motion and choreo with `customConditions`. Add the condition and the
  framer-motion plugin to the test app's Vite config. The gallery's realm
  build doesn't go through Vite, so it keeps whatever it needs until CS-13302
  retires it. choreo-player isn't covered by this ticket, so its `paths`
  entries stay.
- **CI:** the test-app job builds only choreo-player now. glimmer-motion's own
  test harness also compiles its source through the condition: the package
  imports itself by name, and its `exports` resolve that to `src/`. A separate
  job, Glimmer Motion and Choreo Tests (built output), runs both suites with
  `CHOREO_LIBS=dist`. That drops the condition from each suite's Vite config,
  so they run against the packages' rollup output. Only that build inlines and
  tree-shakes framer-motion's internals, and nothing at publish time runs it
  in a browser. The Choreo Tests job
  keeps its build of all three, because the gallery's realm bundle reads
  `dist/`, and it adds the packed-exports check for both packages. Host's
  tests compile glimmer-motion's and choreo's source, so `ci-host.yaml`'s
  `paths` include both packages. `ci.yaml`'s `boxel` filter doesn't, because
  it gates the staging deploy and host's production bundle carries neither.
- **boxel-cli:** doesn't depend on either package yet. CS-13291 adds them, and
  that's where its type resolution for realm cards gets decided. Not touched
  here.

### 4. The published tarball

`files` omits `src/`, so the condition's targets don't exist in the tarball.
A consumer that doesn't set `developing:choreo` never looks at them. The check:
`pnpm pack` both packages, unpack, and resolve every export key with and
without the condition. Without it, every target must exist. With it, every
target must be in `src/` and missing, which is expected. The condition stays
in the published `package.json` (decision 2).

## Tests

- **Host integration test**
  (`packages/host/tests/integration/components/glimmer-motion-and-choreo-test.gts`):
  a `{{motion}}` element animates to its target, and a `<Choreo>` leaver moves
  to the orphan layer for its exit, then unmounts. With neither package built, it
  proves the Vite route, and glint over `tests/` proves the TS route.
- **Lint:** `pnpm lint` in host, choreo, choreo-test-app and choreo-gallery
  passes after `git clean -fdx packages/{glimmer-motion,choreo}` (no `dist/`
  or `declarations/`).
- **Test app:** `pnpm test` in `choreo-test-app` passes without either
  package built.
- **Exports:** `scripts/check-exports.mjs` in glimmer-motion, run in each
  package. `lint:exports` (`--source`, part of `lint`) checks that every `src/`
  module resolves to itself under the condition, so a new `.gts` module
  without an exact entry fails lint. `check:packed-exports` (`--packed`, in
  the Choreo Tests CI job) packs the package and checks that every module
  resolves to files in the tarball without the condition.

## Target files

- `packages/glimmer-motion/package.json`, `packages/choreo/package.json`:
  exports
- `packages/glimmer-motion/scripts/source-resolution.mjs` (new),
  `packages/glimmer-motion/scripts/check-exports.mjs` (new),
  `packages/glimmer-motion/rollup.config.mjs`
- `packages/host/package.json`, `tsconfig.json`, `vite.config.mjs`
- `packages/choreo/tsconfig.json`, `tsconfig.declarations.json`
- `packages/choreo-test-app/tsconfig.json`, `vite.config.mjs`
- `packages/choreo-gallery/tsconfig.json`
- `.github/workflows/ci.yaml`
- `packages/host/tests/integration/components/…-test.gts` (new)
- `pnpm-lock.yaml`

## Decisions

1. **Host dependencies land here.** "Host builds against the source" needs
   host to depend on and import both packages, which overlaps CS-13290. Host
   gets them as devDependencies, imported only by the integration test, so
   nothing reaches host's production bundle. CS-13290 keeps the bundle-size
   measurement, and its wording ("glint resolves their `declarations/`")
   changes to say source.
2. **The condition stays in the published `package.json`.** It's inert for
   npm consumers, and there's one exports map to maintain. The alternative,
   stripping it with `publishConfig.exports` as boxel-ui does, writes the map
   out twice, and the two copies can drift.
3. **Condition name:** `developing:choreo`, as the ticket suggests. It covers
   glimmer-motion too, which is fine, because both packages release in
   lockstep.
