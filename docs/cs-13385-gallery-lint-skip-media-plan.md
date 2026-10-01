# CS-13385 — Lint the Choreo gallery without copying the test app's media

## Goal

The gallery's `lint:types` script runs `sync-gallery.mjs` before
`ember-tsc --noEmit`, so every gallery lint — the CI Lint "Lint Choreo
Gallery" step included — copies `packages/choreo-test-app/public` (~27 MB of
media) into `packages/choreo-gallery/public`. Type-checking reads only the
synced sources under `src/`, so the copy is wasted I/O.

## Assumptions

- The gallery lint step runs `pnpm run lint`, which does not depend on a
  prior build: `lint:types` syncs the sources itself.
- Nothing lint runs (`ember-tsc`, eslint, ember-template-lint, prettier)
  reads the gallery's `public/` media. `public/*` is gitignored apart from
  `icon.svg`.
- The CI Lint build-coverage step runs the gallery's full `build`, which keeps
  copying the media. It stays as is: `build` is the full build, and the copy
  there goes away with the generator.

## Steps

1. Add a `--skip-media` flag to `scripts/sync-gallery.mjs` that skips the
   `public/` copy.
2. Pass `--skip-media` from the `lint:types` script.
3. Document the flag in the gallery README's Rebuild section.

## Target files

- `packages/choreo-gallery/scripts/sync-gallery.mjs`
- `packages/choreo-gallery/package.json`
- `packages/choreo-gallery/README.md`

## Testing notes

- From a fresh worktree (only `public/icon.svg` present), `pnpm run lint` in
  `packages/choreo-gallery` passes and leaves `public/` holding only
  `icon.svg`.
- `node scripts/sync-gallery.mjs` with no flag still copies the media.
