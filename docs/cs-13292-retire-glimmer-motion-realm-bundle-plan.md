# Retire glimmer-motion's hashed realm-bundle flow

## Goal

Cards import `glimmer-motion` and `@cardstack/choreo` through the host's module
shims, so nothing in the monorepo should build or push a hand-made realm bundle
of them. Remove that delivery path and the local config file it reads.

## What goes

- `packages/glimmer-motion/scripts/build-realm-bundle.mjs`, which esbuilds
  glimmer-motion, choreo and `Film` into a content-hashed
  `builds/choreo-<hash>.ts` plus a `choreo.ts` re-export and writes both to a
  realm with `boxel file write`.
- Its `realm`, `realm:local` and `realm:stage` scripts in
  `packages/glimmer-motion/package.json`, and the `esbuild` devDependency that
  only this script used.
- `dist-realm/` in `packages/glimmer-motion/.gitignore` (the script's staging
  directory).
- The `.choreo-realm-sync.json` convention: the `--mirror` option of
  `packages/choreo-gallery/scripts/build-boxel-realm.mjs`, which is that
  file's other reader. The gallery README already publishes `dist-realm/` with
  the boxel CLI's own configuration. The root `.gitignore` keeps ignoring the
  file, because checkouts that used the flow still hold one with a
  machine-specific workspace path and realm URL.
- `packages/choreo-gallery/docs/realm-publishing.md`, the guide for the deleted
  script, plus the links and README section that point at it.

The root `package.json` has no `realm*` scripts, so nothing changes there.

## What stays

- The gallery generator (`build-boxel-realm.mjs`) still bundles a
  content-hashed `builds/gallery-runtime-<hash>.ts` for the generated gallery
  realm, with glimmer-motion and choreo inlined. Rewriting the gallery as
  authored realm content that imports the shimmed packages replaces that
  generator. That work has its own ticket, so this change leaves the generator's
  build and its CI test alone.

## Existing realms

The ticket asks whether a deployed realm still imports a
`builds/choreo-<hash>.ts` bundle. The answer comes from a read-only query of the
staging and production indexes for modules whose source or dependencies mention
`builds/choreo-`. The findings go on the Linear issue, so the gallery-realm work
can replace them.

## Testing

- No runtime code changes. `pnpm lint` in `packages/glimmer-motion` and
  `packages/choreo-gallery`.
- `git grep` confirms nothing references the deleted script, its package
  scripts, or `.choreo-realm-sync.json`.
- `pnpm install` keeps the lockfile in sync after dropping `esbuild`.
- No test-stack work: nothing here touches realm-server, host or Matrix.
