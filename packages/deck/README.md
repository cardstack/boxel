# Deck Core in Boxel

This package is Boxel's pinned copy of the browser-safe and Node protocol
primitives from [`cardstack/deck`](https://github.com/cardstack/deck). It does
not include Deck Hub, examples, the CLI, or Deck's server.

`src/` and `tests/` are copied byte-for-byte from the immutable commit in
[`DECK_SOURCE`](./DECK_SOURCE). Do not fix them in Boxel. Make the change and
its test in Deck, then update the vendor with:

```sh
node scripts/deck-sync.mjs pull /path/to/deck
```

The Boxel-owned `package.json` and `tsconfig.json` expose the vendored sources
to this workspace. The root `@cardstack/deck` entry is browser-safe;
`@cardstack/deck/node` is server-only.

## Boxel integration

Boxel installs a canonical, URL-free dependency lock with
`VirtualNetwork.setRRIImportMap()`. Import resolution receives the importing
module URL, converts it back to an RRI, and uses Deck's longest matching scope
to select an exact Version RRI. `VirtualNetwork.projectRRIImportMap()` derives
the browser import map from the current transport routes; projected URLs are
never written back into canonical state. Replacing the canonical lock
invalidates Loader module caches in one step.

Run the package checks with:

```sh
pnpm --filter @cardstack/deck test
pnpm --filter @cardstack/deck lint
```

The vendor lint recomputes the recorded tree hash, so accidental local edits
fail rather than silently forking Deck Core.
