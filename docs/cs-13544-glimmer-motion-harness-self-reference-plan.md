# glimmer-motion's test harness resolves its own imports from source

## Problem

glimmer-motion's test suite imports the package by its public specifiers
(`glimmer-motion/test-support`, `glimmer-motion/motion`, …). The harness's
vite config adds the `developing:choreo` export condition so those specifiers
resolve to `src/`. Embroider's `ember()` vite plugin answers a v2 addon's
self-references from the addon's own `package.json` and ignores
`resolve.conditions`, so whenever `packages/glimmer-motion/dist` exists the
source-mode run (`pnpm test` without `CHOREO_LIBS=dist`) imports `dist/`
instead. CI's source job has no build and is unaffected; a local source-mode
run after `pnpm build` tests stale built code.

## Goal

A source-mode run always tests `src/`, built or not. A `CHOREO_LIBS=dist` run
still tests `dist/`.

## Approach

Use `selfReferenceSource(packageDir)` from
`packages/glimmer-motion/scripts/source-resolution.mjs` in
`packages/glimmer-motion/vite.config.mjs`, only when `CHOREO_LIBS !== 'dist'`,
the same way `packages/choreo/vite.config.mjs` does. The plugin runs with
`enforce: 'pre'`, ahead of Embroider's resolver, and maps
`glimmer-motion[/…]` to the `developing:choreo` target in the package's
exports map.

## Target files

- `packages/glimmer-motion/vite.config.mjs`

## Testing

- With `dist/` built, resolve `glimmer-motion`, `glimmer-motion/motion` and
  `glimmer-motion/test-support` from
  `tests/unit/engine-exports-test.ts` through the harness's vite config:
  source mode gives `src/…`, `CHOREO_LIBS=dist` gives `dist/…`.
- `pnpm test` and `CHOREO_LIBS=dist pnpm test` in `packages/glimmer-motion`
  both pass.
- `pnpm lint` in `packages/glimmer-motion`.
