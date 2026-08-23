# Deck B2a reviewer guide: exact branch content sync

B2a replaces mtime causality with an exact, three-way content protocol for a
Deck-enabled realm. It does not remove the existing Boxel CLI workflow: one CLI
installation negotiates once per realm, uses the legacy mtime implementation
when `/.deck/capabilities` is absent, and uses only the Deck protocol when the
realm advertises the complete `deck-r0` capability.

This branch is local and intentionally unpushed. Review it on top of B1a in
this order:

1. `Add Deck-aware content sync foundation`
2. `Add exact Deck branch pull and status`
3. `Add conditional Deck branch push`
4. `Add content-addressed Deck branch sync`
5. `Add content-addressed Deck realm watch`

## What the slice proves

```text
recorded exact base ───────┐
                          ├── three-way plan ── conflict ──▶ no writes
local SHA-256 tree ────────┤
                          └── reconcile ───────▶ immutable objects
remote branch observation ┘                              │
                                                        ▼
                                            conditional branch CAS
```

- `.boxel-sync.json` is a `boxel-deck-workspace-v2` record containing the
  realm RRI, branch identity, exact Repository/tree/lock hashes, observed ref
  generation, History/index-generation heads, and SHA-256 inventory. It
  contains no mtime compatibility data.
- authenticated `GET /.deck/branch?name=…` returns the exact branch inventory;
  `GET /.deck/tree-file?tree=…&path=…` returns immutable bytes and the client
  verifies their expected hash.
- pull materializes an exact branch base. Push will publish only local changes
  whose recorded remote base has not moved. Sync first reconciles disjoint
  remote work, then conditionally publishes the remaining local work.
- a same-path divergence is a conflict. Pull, sync, push, and watch send no
  remote mutation for it.
- watch observes local byte hashes and remote ref movement. Its poll phase is
  read-only; a debounced flush runs the same sync/CAS path as `realm sync`.
  `--branch` chooses the initial branch, while an existing workspace retains
  its recorded branch.
- generated `.claude/`, `.boxel-watch.lock`, `.boxel-sync.json`, `.deck/`,
  `.jj/`, `.git/`, and dependency directories are local metadata, never
  canonical branch content.

## Where to start

1. Start with
   `packages/boxel-cli/src/lib/deck-workspace-state.ts`. It defines the local
   evidence record and the byte-only three-way classifier shared by commands.
2. Read `packages/boxel-cli/src/lib/realm-sync-mode.ts` for fail-closed
   capability negotiation and exact branch/tree transport.
3. Follow pull, push, and sync through `deck-realm-pull.ts`,
   `deck-realm-push.ts`, and `deck-realm-sync.ts`.
4. Read `packages/realm-server/lib/deck-branch-content-update.ts` for the
   server-side immutable-object construction and single conditional ref move.
5. Finish at `packages/boxel-cli/src/commands/realm/watch/start.ts`: the legacy
   watcher is unchanged, while `DeckRealmWatcher` is a separate implementation
   selected per realm.

## Review invariants

1. A 404 capability probe means legacy. Authentication failures, server
   failures, malformed capabilities, or partial Deck capabilities fail closed.
2. The Deck path never asks for `_mtimes`, creates `.boxel-history`, accepts
   `--prefer-newest`, or treats `--force`/`--overwrite-local` as a consistency
   bypass.
3. The client hashes bytes and records an exact base; timestamp order is never
   an input to identity, freshness, or conflict resolution.
4. The server checks the expected Repository/tree/lock/ref generation before
   moving a branch. Concurrent stale writers cannot both win.
5. The ordinary realm filesystem remains a complete normative backend. The
   conditional-object adapter can use direct S3 in hosted deployments without
   changing this protocol.

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
  tests/commands/realm-pull-claude-skills.test.ts \
  tests/commands/realm-sync-claude-skills.test.ts \
  tests/commands/realm-watch-claude-skills.test.ts
pnpm lint
```

From `packages/realm-server`, run the focused Deck serving and conditional
content-update tests, then `pnpm lint`.

The watcher proof uses two PretUI-shaped local workspaces. It covers one local
save producing one conditional publication, disjoint teammate work being
pulled before local publication, same-file conflict producing zero writes, and
a ref-only movement advancing the exact local base.

## Deliberate boundary after B2a

An accepted B2a write creates immutable Deck objects and advances the canonical
branch ref, but it does not yet append a jj/deckd History Step or project the
new tree into a branch-qualified Realm Server index. B2b owns History; B3 owns
branch projections and indexes. This boundary is why B2a proves transport and
CAS safety without claiming that Browse/Run immediately reflects the write.
