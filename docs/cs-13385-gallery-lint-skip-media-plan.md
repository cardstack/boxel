# CS-13385 — Lint the Choreo gallery without copying the test app's media

## Goal

The gallery's `lint:types` script runs `sync-gallery.mjs` before
`ember-tsc --noEmit`, and the gallery's `build` runs it before `scope-css.mjs`
and rollup. The sync copied `packages/choreo-test-app/public` (~27 MB of media)
into `packages/choreo-gallery/public` on every run, so both CI Lint's "Lint
Choreo Gallery" step and its build-coverage step paid for the copy.

## Assumptions

- Nothing reads the media in `packages/choreo-gallery/public`:
  - `build-boxel-realm.mjs` copies media into `dist-realm/` straight from
    `packages/choreo-test-app/public`, and takes only `icon.svg` from the
    gallery's own `public/`.
  - The rollup build has no public-assets step.
  - The package is private, so its `files` list is never packed.
  - No other package or workflow refers to the gallery's `public/`.
- `public/*` is gitignored apart from `icon.svg`, so dropping the copy changes
  no tracked file.

## Steps

1. Remove the `public/` copy from `scripts/sync-gallery.mjs`.
2. Update the gallery README to say the sync copies no media.

## Target files

- `packages/choreo-gallery/scripts/sync-gallery.mjs`
- `packages/choreo-gallery/README.md`

## Testing notes

- From a fresh worktree (only `public/icon.svg` present), `pnpm run lint` and
  `pnpm run build` in `packages/choreo-gallery` pass and leave `public/`
  holding only `icon.svg`.
