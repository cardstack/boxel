# Deck backport A0–A6 reviewer guide

**Status:** complete local stack, verified 2026-08-23. No branch has been
pushed and no pull request has been opened. The stack starts from Boxel
`origin/main` commit `f7e3fda4f7ff322064f54a41fea52f3d36dedb9a`.

Deck Core comes from the current-only R0 source commit
`1ba3a0719f9696a15680b1ee1f8b3df6615076c5`. Its Boxel vendor record has tree
hash `3956c528dd6a124c010693bc569a526911ba8718f1bc9a7b43a30e7619eaae32`.

Review each pull request as one layer against the preceding branch:

```text
origin/main
  └─ A0  Deck R0 Core provenance
       └─ A1  canonical RRI scopes
            └─ A2  immutable exact-Version serving
                 └─ A3  thin use / install / remix services
                      └─ A4  cold runtime package discovery
                           └─ A5  immutable Version indexes
                                └─ A6  deterministic PretUI syndication
```

| PR  | Branch                                | Base | Local checkpoint |
| --- | ------------------------------------- | ---- | ---------------- |
| A0  | `codex/deck-r0-a0-core`               | main | `1c8079f4ef`     |
| A1  | `codex/deck-r0-a1-resolver`           | A0   | `2ed167e325`     |
| A2  | `codex/deck-r0-a2-version-serving`    | A1   | `133ab7e283`     |
| A3  | `codex/deck-r0-a3-thin-verbs`         | A2   | `15f4688dd3`     |
| A4  | `codex/deck-r0-a4-runtime-rri`        | A3   | `f45e81a04c`     |
| A5  | `codex/deck-r0-a5-version-index`      | A4   | `e0ba637380`     |
| A6  | `codex/deck-r0-a6-pretui-syndication` | A5   | `ef452443d9`     |

The A6 branch contains four implementation commits: the package projection,
the generator-owned package lint boundary, the Realm Server lint-tool pin, and
the fail-closed syndication gate. They are one review layer and may remain
separate for clarity.

## Cross-layer invariants

- Canonical identities are RRIs. URLs are transport projections and never
  appear in canonical import-map locks.
- `package.json` contains semver intent; `importmap.json` selects exact RRIs.
- The realm is canonical. The generated Boxel workspace package is a
  reproducible syndicated representation.
- All observable pilot behavior is disabled by default and requires both the
  operator kill switch and exact server-side RRI allowlist membership.
- Exact Versions and their indexes share the mutable realm's read
  authorization. Public content may use immutable shared caching; private
  content never enters a shared cache.
- A3 deliberately adds no fake UI. A service or endpoint is not presented as a
  collaboration workflow until branch, Checkpoint, Review, and merge state are
  real.
- No compatibility implementation remains in vendored Deck R0.

## A0 — vendor the current-only Deck Core

**Suggested title:** `feat(deck): vendor current-only Deck Core`

Start with:

1. `packages/deck/DECK_SOURCE` — source commit and deterministic tree hash.
2. `scripts/deck-sync.mjs` — the one-way pull/check boundary.
3. `packages/deck/package.json` — browser-safe Core and Node-only exports.

Do not line-review vendored Deck source as newly authored Boxel code. Verify the
source commit and vendor hash, then review Boxel-owned workspace wiring.

Gate:

```sh
mise exec -- pnpm --filter @cardstack/deck test
mise exec -- pnpm --filter @cardstack/deck lint
```

Expected Core result: 254 passing tests.

## A1 — resolve scoped canonical RRIs

**Suggested title:** `feat(deck): add RRI-native scoped resolution`

Start with `packages/runtime-common/virtual-network.ts`, then
`packages/host/tests/unit/rri-import-map-loader-test.ts`. Verify that resolution
receives the importer, two exact Versions can coexist, and projected transport
URLs never flow back into canonical state.

Focused Host gate:

```sh
cd packages/host
mise exec -- pnpm exec ember test --path dist \
  --filter 'canonical RRI import map'
```

## A2 — serve exact immutable Versions

**Suggested title:** `feat(deck): serve exact Versions from realm CAS`

Start with `packages/realm-server/handlers/serve-deck-version.ts`,
`packages/runtime-common/deck-version-url.ts`, and the focused Realm Server
test. Review authorization before bytes, public/private cache headers,
source-versus-executable representation, extensionless card projection, binary
integrity, and write rejection.

Gate:

```sh
cd packages/realm-server
MATRIX_REGISTRATION_SHARED_SECRET=xxxx \
  TEST_FILES=deck-version-serving-test mise exec -- pnpm test
```

## A3 — adopt packages without copying

**Suggested title:** `feat(deck): add thin package adoption verbs`

Start with `packages/runtime-common/decklist-adopt.ts` and the Host adoption
services. `use` selects, `install` changes one exact lock binding, and `remix`
records inheritance plus explicit overrides. The 51-file Realm fixture proves
that remix does not duplicate the dependency tree. There is intentionally no
button-only or fixture-backed collaboration UI in this layer.

## A4 — discover package locks at runtime

**Suggested title:** `feat(deck): discover package locks at runtime`

Start with:

1. `packages/runtime-common/dynamic-rri-resolution.ts`;
2. Host card/network/Loader integration;
3. `packages/runtime-common/realm-index-query-engine.ts`;
4. `packages/realm-server/scripts/seed-relay-fixture.ts`; and
5. `docs/deck-packages-and-runtime-resolution.md`.

Review package-owned scopes, authenticated server capability discovery,
additive versus destructive invalidation, cold card deserialization, cold
module evaluation, and concurrent exact Versions.

The current local A4 continuation also adds the first Astra QueryView contract.
Read `packages/runtime-common/astra-query-view.ts`, then
`packages/realm-server/lib/deck-astra-query.ts`, the query route in
`serve-deck-version.ts`, and
`scripts/bootstrap-pretui-collaboration-realm.ts`. One request may query up to
eight branch, Checkpoint, immutable index-generation, or semver/Version views
and optionally compare two by logical RRI and canonical document hash. Results
carry selector, mutability, tree, index, Repository, lock, History, and Version
provenance rather than returning anonymous search rows.

The Host-side addition is deliberately below the UI layer: the prerender route
installs the package-owned RRI mapping before it derives `adoptsFrom` from a
cold card response. The browser proof uses the normal Workspace Chooser,
standard `Workspace` index card, pinned cards, Library, and existing Interact
chrome. No A4 change replaces or restyles the Boxel icon, submode selector, New
menu, stack layout, profile, or assistant.

Focused gates:

```sh
cd packages/host
mise exec -- pnpm exec ember test --path dist \
  --filter 'dynamic RRI resolution'
mise exec -- pnpm exec ember test --path dist \
  --filter 'canonical RRI import map'

cd ../realm-server
MATRIX_REGISTRATION_SHARED_SECRET=xxxx \
  TEST_FILES=deck-version-serving-test mise exec -- pnpm test

# Real protocol + Realm-content replay (deckd must be listening on 8787)
REALM_DIR="$(mktemp -d /tmp/boxel-pretui-live.XXXXXX)"
mise exec -- pnpm fixture:pretui-live -- "$REALM_DIR"
```

## A5 — index immutable Versions

**Suggested title:** `feat(deck): index immutable package Versions`

Start with `packages/realm-server/lib/deck-version-index.ts`, then the range and
exact index routes in the serving handler. The snapshot is keyed by the CAS
tree hash, stored once inside the realm, and contains exact-RRI cards. Mutable
range queries are private `no-store`; the chosen exact index is immutable.

Replay the pinned real PretUI slice with
`packages/realm-server/scripts/seed-pretui-known-date.ts`. The expected tree is
`6a0355389fc297f052c16f42a9bb2820ca0974c8b659443b18bb448cb06b5f8c`
and the expected index is
`cd2b56bda725f91e6543a399508f3e170381cda5a65183aad63e0628ef4ad2d4`.

Gate:

```sh
cd packages/realm-server
MATRIX_REGISTRATION_SHARED_SECRET=xxxx \
  TEST_FILES=deck-version-serving-test,deck-version-index-test \
  mise exec -- pnpm test
```

Expected result: 15 passing tests.

## A6 — syndicate one exact Version into Boxel

**Suggested title:** `feat(deck): syndicate PretUI into Boxel workspace`

Start with `packages/realm-server/scripts/syndicate-pretui-version.ts` and
`packages/pretui/DECK_SOURCE.json`. The generator owns every output byte,
normalizes source to the Boxel formatting/lint boundary, records source
Version/tree/index/lock identities, and rejects unknown or drifting files.

Then review the ordinary Host import in
`packages/host/app/lib/pretui-known-date.ts` and its focused consumer test. The
monorepo subtree is derived; authors must return to a PretUI realm for changes.

Gates:

```sh
cd packages/realm-server
BOXEL_DECK_COLLABORATION_ENABLED=true \
  BOXEL_DECK_COLLABORATION_REALM_RRIS=@cardstack/pretui/ \
  mise exec -- pnpm syndicate:pretui -- \
  "$REALM_DIR" 0.4.0 ../../packages/pretui --check
mise exec -- pnpm lint

cd ../pretui
mise exec -- pnpm lint

cd ../host
mise exec -- pnpm lint
mise exec -- pnpm build
mise exec -- pnpm exec ember test --path dist \
  --filter 'generated PretUI Known Date consumer'
```

## What does not land in the A stack

Repository/branch refs, every-save History, Checkpoints, Reviews, merge,
content-addressed Boxel CLI sync, S3 Files infrastructure, and polished Host UX
remain B-series work. Their PretUI-first sequence is recorded in
`deck-pretui-collaboration-backport.md`.
