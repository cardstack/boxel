# test-realm-cards

Fixture realm contents used by automated tests. The cards, instances, and
realm config in `contents/` are served as the `/test/` realm
(`https://localhost:4202/test/` in dev and CI via
`mise-tasks/services/test-realms`, and `https://localhost:4205/test` in the
matrix Playwright suite via its isolated realm server).

Both servers serve a throwaway _copy_ of `contents/` rather than the
directory itself, so a running realm server never writes into the source
tree. Edits made through a running realm land in the copy and are discarded.

The `.gts` files here are type-checked by the host package's `lint:types`
(host's `tsconfig.json` includes this package, mirroring how
`experiments-realm` is covered). The realm config files (`package.json`,
`tsconfig.json`) live outside `contents/` so they aren't indexed as part of
the realm.
