# CS-14267: Mount the Pret UI realm in `boxel test`'s local mode

## Goal

A realm test that renders a Pret UI component passes under `boxel test` in local mode, with no realm-server running.

## Background

Local mode (`runTestsLocally` in `packages/boxel-cli/src/lib/test-engine.ts`) serves the `workspace`, `base` and `skills` mounts from its test-page server, and rewrites the host config's realm URLs to point at them. `resolvedPretuiRealmURL` keeps the host build's default (`https://localhost:4201/pretui/`), so an `@cardstack/pretui/…` import fails to load wherever nothing listens there.

The host's network service registers each prefix realm at its `resolved*RealmURL` property before falling back to `prefixRealmURLs`, so rewriting the property is enough to move the prefix.

## Steps

1. `test-engine.ts`
   - `resolveBundledRealms` also returns `pretuiDir`: `bundled-realms/pretui` in a built CLI, `packages/pretui` in the monorepo.
   - `runTestsLocally` mounts it at `/pretui/`.
   - `buildQunitTestPageHtml` rewrites `resolvedPretuiRealmURL` to `${browserOrigin}/pretui/`.
2. `scripts/build-realms.ts` copies `packages/pretui` into `bundled-realms/pretui`, required. It leaves out what the deployed realm leaves out: the patterns in `packages/pretui/.boxelignore` (`*.test.gts`, `scripts/`), plus `node_modules` and dot-files. That is about 15 MB of source.
3. The local-mode fixture card (`tests/fixtures/local-mode/sample.gts`) also renders a Pret UI `Kbd`. Its test asserts that the Kbd rendered, and that the host resolves `@cardstack/pretui/` to the test page's own origin. A developer machine may have a realm-server answering at the build default, which would let the render pass without the mount. One browser run covers all three mounts.

## Not in this change

- Moving the Choreo gallery CI job's CLI pin (`.github/workflows/ci.yaml`) to a release that has this. The release publishes when this merges, and CS-13808 is the change that needs it.

## Testing

- `pnpm test tests/local-mode.test.ts` in `packages/boxel-cli`, against a host dist. No realm-server is needed.
- `pnpm build:realms` and check that `bundled-realms/pretui` holds no tests or scripts.
- `pnpm lint` in `packages/boxel-cli`.
