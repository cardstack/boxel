# Deck B0 reviewer guide: canonical collaboration adapter

**Branch:** `codex/deck-r0-b0-collaboration-protocol`

**Base:** `codex/deck-r0-a6-pretui-syndication`

B0 does not introduce another Repository implementation. The vendored Deck R0
package already owns canonical Repository, branch-head, Checkpoint, Review, and
three-way merge objects. This slice adds the Boxel-owned, feature-gated realm
adapter that verifies those objects before Realm Server, Boxel CLI, or Host UI
may trust them.

## Where to start

1. `packages/realm-server/lib/deck-repository-protocol.ts` — the integrity
   boundary. Follow one branch through head → Checkpoint → Repository → exact
   lock, then one Review through its pinned base/target/source Checkpoints.
2. `packages/realm-server/lib/deck-collaboration-policy.ts` — the shared
   operator flag and exact realm-RRI allowlist used by Version serving,
   syndication, and the new adapter.
3. `packages/realm-server/tests/deck-repository-protocol-test.ts` — the
   PretUI-rooted round trip, merge preview, Version origin, and fail-closed
   missing-object proof.
4. `packages/realm-server/scripts/seed-pretui-known-date.ts` and
   `syndicate-pretui-version.ts` — the real fixture now records and consumes an
   immutable Version → Checkpoint origin instead of emitting a transitional
   `checkpointHash: null`.

## Key decisions

- The feature gate is conjunctive and server-owned. Disabled mode or a realm
  outside the exact RRI allowlist cannot open the adapter.
- RRIs are canonical identity. A Repository is accepted only when its roots
  and members contain the mutable realm RRI; URL topology is irrelevant.
- Reads are referentially complete. Missing or mismatched content-addressed
  objects raise `DeckProtocolIntegrityError`; callers never receive a partial
  branch or Review.
- A Review remains pinned to its immutable snapshots. Merge preview uses those
  exact Checkpoints while the current target branch may continue to move.
- `.deck/versions/<version>.json` records the exact source Checkpoint for a
  published Version inside the realm. The record is write-once and is accepted
  only when Version tree, index, Repository, and lock identities agree.
- B0 adds no collaboration UI and no remote mutation endpoint. Later B slices
  build commands and UX on this single verified state model.

## Verification

```sh
cd packages/realm-server
MATRIX_REGISTRATION_SHARED_SECRET=xxxx \
  TEST_FILES=deck-repository-protocol-test,deck-version-serving-test,deck-version-index-test \
  mise exec -- pnpm test
mise exec -- pnpm lint

cd ../pretui
mise exec -- pnpm lint
```

Expected focused test result: 18 passing tests.

The pinned Known Date replay additionally produces:

```text
Version      @cardstack/pretui@0.4.0/
tree         6a0355389fc297f052c16f42a9bb2820ca0974c8b659443b18bb448cb06b5f8c
index        cd2b56bda725f91e6543a399508f3e170381cda5a65183aad63e0628ef4ad2d4
Checkpoint   ad36bca9ebff6547b37266f9273f7ba796d363de8f390c09db84ecf9d5b5d22c
```

Running syndication with `--check` must reproduce
`packages/pretui/DECK_SOURCE.json` with that exact Checkpoint and unchanged
generated source hash.
