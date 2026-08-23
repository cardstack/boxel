# Deck B3a reviewer guide: immutable Realm views

B3a gives every completed branch head an immutable index generation and an
RRI-bearing `RealmViewContext`. A query no longer means “whatever this realm's
shared index currently contains”; it means one exact Repository/tree/lock/
History view selected by the branch ref.

This branch is local and intentionally unpushed. Review it on top of B2b.

## What the slice proves

```text
accepted CAS tree + Repository + lock + History Step
                         │
                         ▼
             build immutable index generation
                         │
                         ▼
             one conditional branch-ref advance
                         │
                         ├── source tree hash
                         ├── History head
                         └── index-generation hash

branch query ──read exact ref──▶ validate RealmViewContext ──▶ cards
```

The ref is the visibility point. Index files may be prepared early and remain
as harmless immutable orphans after a failed writer, but a query cannot see
one until the branch head names it.

## Protocol objects

`boxel-realm-view-context-v1` contains:

- canonical realm RRI;
- branch name;
- Repository hash;
- member tree hash;
- exact import-map lock hash;
- History head.

`boxel-deck-index-generation-v1` contains that view plus its deterministic card
projection. Its canonical object hash is the `indexGenerationHash` stored in
the branch head. Files live inside the realm at:

```text
.deck/indexes/generations/<hash-prefix>/<hash>.json
```

Reading recomputes the object hash and then verifies every view field against
the selected branch. Missing is `pending`; mismatched is protocol corruption.
Neither case silently falls back to the live realm index.

## Current-only client view

B3a replaces the B2a observation/sidecar shapes rather than supporting two
Deck dialects:

- `boxel-deck-branch-observation-v2` requires `historyHead` and
  `indexGenerationHash`;
- `.boxel-sync.json` is `boxel-deck-workspace-v2` and records both as its exact
  local base;
- v1 Deck records fail closed. A realm with no Deck capability still uses the
  separate legacy mtime workflow.

This distinction matters for agents: matching source bytes are not sufficient
evidence that a workspace represents the same indexed/History view.

## Where to start

1. `packages/realm-server/lib/deck-branch-index.ts` defines and validates the
   view and immutable generation.
2. `packages/realm-server/lib/deck-branch-content-update.ts` builds the index
   after the accepted History seal and installs both with one ref advance.
3. `packages/realm-server/handlers/serve-deck-version.ts` exposes authenticated
   `GET /.deck/branch-index?branch=…&q=…` and the v2 branch observation.
4. `packages/boxel-cli/src/lib/deck-workspace-state.ts` makes History/index
   heads required local evidence.
5. `packages/realm-server/tests/deck-branch-index-test.ts` creates two hidden
   views for the same realm RRI and proves they answer differently.

The card projection shares the deterministic JSON-card extraction used by
immutable Version indexes. It reads bytes from the exact CAS tree, never the
mutable working directory.

## Query tour

After an accepted B2b/B3a write:

```sh
curl -H "Authorization: Bearer $TOKEN" \
  '<realm-url>/.deck/branch?name=main'

curl -H "Authorization: Bearer $TOKEN" \
  '<realm-url>/.deck/branch-index?branch=main&q=known%20date'
```

The second response is private/no-store because `main` is mutable, but it
contains an immutable `indexGenerationHash`, exact `view`, and cards whose RRIs
remain in the mutable realm namespace. Exact Version indexes retain their
existing immutable public/private cache policy.

## Review invariants

1. Index input is the accepted CAS tree, not live bytes or mtimes.
2. The index manifest is complete and hash-verified before the ref can name it.
3. The query re-reads the selected branch and requires a field-for-field view
   match; a generation from another branch cannot be substituted.
4. A pending pre-B3a branch returns 409 instead of fake or stale results.
5. The v2 CLI workspace records the exact History/index heads returned by the
   server. Older Deck records are rejected, not guessed forward.
6. The feature flag and realm RRI allowlist still gate every endpoint and
   writer path.

## Focused verification

From `packages/boxel-cli`:

```sh
pnpm exec vitest run \
  tests/lib/deck-workspace-state.test.ts \
  tests/lib/realm-sync-mode.test.ts \
  tests/lib/deck-realm-pull.test.ts \
  tests/lib/deck-realm-push.test.ts \
  tests/lib/deck-realm-sync.test.ts \
  tests/lib/deck-realm-status.test.ts \
  tests/lib/deck-realm-watch.test.ts \
  tests/lib/deck-realm-history.test.ts
pnpm lint
```

From `packages/realm-server`, run `deck-branch-index-test`,
`deck-branch-content-update-test`, and `deck-version-serving-test`, then
`pnpm lint`.

The tests prove two exact hidden views for one RRI, pending-index refusal,
authenticated query, index/History/ref co-installation, current-only v2 client
evidence, stale-writer safety, and forward restore producing a new generation.

## Deliberate boundary after B3a

B3a establishes the identity and immutable storage model; it does not claim
that Boxel's existing SQL index, Loader, caches, jobs, events, activity,
prerender, or test selection are view-qualified. B3b threads this same
`RealmViewContext` through those systems and proves a hidden branch cannot
invalidate or leak into `main`. Named branch creation and UI remain B4, after
that isolation proof is complete.
