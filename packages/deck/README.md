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

Boxel installs canonical, URL-free dependency locks with
`VirtualNetwork.setRRIImportMap()`. A realm's `package.json` holds semver intent
and its `importmap.json` holds exact RRI selections. The Host discovers both
documents from card and module responses at runtime, then installs the lock as
a package-owned scope rather than process-global imports. Import resolution
receives the importing module URL, converts it back to an RRI, and uses Deck's
longest matching scope to select an exact Version RRI. This permits multiple
exact Versions to remain resident for independent importers.

`VirtualNetwork.projectRRIImportMap()` derives browser URLs from current
transport routes; projected URLs are never written back into canonical state.
Adding a newly discovered mapping preserves evaluated modules. Replacing a
mapping or canonical lock invalidates the Loader baseline in one step.

See [Deck packages and dynamic RRI
resolution](../../docs/deck-packages-and-runtime-resolution.md) for the cold
discovery sequence, exact source/module delivery, and the Relay acceptance
fixture.

Run the package checks with:

```sh
pnpm --filter @cardstack/deck test
pnpm --filter @cardstack/deck lint
```

The vendor lint recomputes the recorded tree hash, so accidental local edits
fail rather than silently forking Deck Core.
