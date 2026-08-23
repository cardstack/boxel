# Deck B2b reviewer guide: every-save History

B2b makes an accepted Deck realm write recoverable without asking the author
to commit. It backports Deck's jj-lib daemon and TypeScript client, attaches
the canonical branch writer to it, and adds branch-scoped History list and
forward-only restore to Realm Server and Boxel CLI.

This branch is local and intentionally unpushed. Review it on top of B2a.

## What the slice proves

```text
exact expected branch head
          │
          ▼
realm-local branch writer lock
          │
          ├── seal state being left (first adoption only)
          ├── materialize accepted immutable tree
          ├── seal one History Step
          └── advance Repository + History head + pending index in one ref CAS

selected branch History head ──▶ newest-first reachable Steps
                                         │
                                         └── restore exact Step
                                                  │
                                                  └── same conditional writer
                                                       creates a new Step
```

- `.deck/history/repo/` is the durable jj-backed History store inside the
  realm. `.jj/repo` is a thin pointer into it; neither tree is branch content.
- deckd is the only Deck History daemon. The current protocol uses
  `DECKD_URL`, requires `/file-list-at`, and accepts only the canonical
  `.deck/history/` layout. It carries no earlier Deck API or storage aliases.
- `/ensure` explicitly selects standalone watched mode or Realm Server's
  writer-managed mode. Realm Server disables daemon watching so a large
  materialization cannot be sealed halfway through its accepted batch.
- the ordinary realm filesystem is the complete normative backend. Hosted
  realms may place that same realm tree on S3 Files; Realm Server still owns
  conditional refs and invokes deckd rather than letting agents write
  collaboration state directly.
- `realm push`, `realm sync`, and `realm watch` all reach the same v2 branch
  update request. An accepted batch supplies a deterministic `save: …` message
  and produces one new Step. A stale or losing writer changes neither live
  source nor the branch ref.
- `realm history` negotiates per realm. Deck workspaces and Deck realm URLs
  use server History. Legacy local workspaces retain their separate
  `.boxel-history` behavior; compatibility does not leak into the Deck API.
- restore never rewinds or mutates a prior Step. It replays the selected tree
  through the same expected-head content update and advances History with a
  new `restore: …` Step. A local workspace must be clean and still observe the
  exact remote head before restore; afterward it is refreshed by exact pull.

## Reused Deck implementation

The History backend contract and deckd jj-lib implementation come from the
committed Deck `packages/history` and `packages/deckd` packages. The Boxel
backport deliberately adapts only the monorepo package name/tooling and removes
the old historyd/timeline compatibility names. It does not reimplement jj
history in Realm Server.

The load-bearing Boxel integration is small:

1. `packages/realm-server/lib/deck-branch-content-update.ts` owns the accepted
   tree → History Step → branch-ref transition.
2. `packages/realm-server/lib/deck-branch-history.ts` scopes reads to the
   selected ref's exact History head and converts restore into ordinary
   content operations.
3. `packages/realm-server/handlers/serve-deck-version.ts` mounts authenticated
   `GET/POST /.deck/history` beside the existing branch endpoint.
4. `packages/boxel-cli/src/lib/deck-realm-history.ts` checks remote/local
   evidence and performs exact refresh after restore.
5. `packages/boxel-cli/src/commands/realm/history.ts` routes Deck and legacy
   realms explicitly rather than blending their semantics.

## Operator and agent tour

Run deckd beside Realm Server:

```sh
cd packages/deckd
cargo run --locked

export DECKD_URL=http://127.0.0.1:8787
```

Materialize and edit an allowlisted Deck realm with the B2a commands. Every
accepted watch flush becomes server History:

```sh
boxel realm pull <realm-url> ./pretui-main --branch main
boxel realm watch ./pretui-main
boxel realm history ./pretui-main --limit 20
```

Restore by full or uniquely identifying Step prefix. This advances canonical
`main` and refreshes the clean local materialization:

```sh
boxel realm history ./pretui-main --restore <step> --yes
boxel realm history ./pretui-main --limit 5
```

An agent without a materialized workspace may inspect the same selected branch
directly:

```sh
boxel realm history <realm-url> --branch main --limit 20
```

## Review invariants

1. The server checks Repository, tree, lock, and ref generation before touching
   live source or History.
2. One realm-local writer owns materialization, History sealing, and ref
   advance. In-process failures after materialization roll the live tree back.
3. The ref records the exact History head. Listing stops at that head, so an
   unreferenced daemon Step is never presented as branch History.
4. Restore accepts only a Step reachable from that branch head and uses exact
   bytes enumerated by deckd.
5. Machinery (`.deck`, `.jj`, `.git`, `node_modules`, CLI state) is never
   sealed, restored, or packed as branch content.
6. B2b supports the implicit physical `main` only. B3 adds branch-qualified
   projections/indexes; B4 can then clone independent branch trees and History
   ancestry without pretending the current realm root already supports them.

## Focused verification

```sh
cd packages/deck-history
pnpm lint
pnpm test

cd ../deckd
cargo build --locked
cargo test --locked
# With deckd running, scripts/smoke.sh proves ensure, seal, list,
# file-list-at, attribution, and watcher-created Steps.
```

From `packages/boxel-cli`, run the focused Deck History, push, sync, and watch
tests, then `pnpm lint`. From `packages/realm-server`, run
`deck-branch-content-update-test` and `deck-version-serving-test`, then
`pnpm lint`.

The focused Realm test proves initial adoption, accepted save, stale and
concurrent writer rejection, History listing, and restore-as-a-new-Step. The
CLI test proves attributed listing, clean exact restore/refresh, and dirty-local
rejection before any remote mutation.

## Deliberate boundary after B2b

The main live source and History now advance truthfully, but B2b still marks
the branch's index generation as pending. B3 owns immutable branch-qualified
index projections and the cache/job/query context needed for Browse, Run, and
catalog results to reflect independent branch state. Named branch creation
therefore remains B4 rather than exposing a selector backed by fake views.
