# deckd

Deck History daemon: **Deck History HTTP** over **jj-lib**, plus a
**watchexec-shaped FS pipeline** (`notify` → filter → per-depot debounce →
jj-lib seal). Design: [`docs/deck-daemon.md`](../../docs/deck-daemon.md).

Lives in the Boxel monorepo at `packages/deckd/`. The binary contains only
History and its explicit/watch capture modes.

The jj-lib path is derived from the boxel-labs `jj-historyd` implementation
(`HistoryService` + axum + `spawn_blocking`/`pollster`).

Dependency: crates.io `jj-lib = "0.43.0"` (same pin as historyd).

```bash
cargo run
```

## Source relationship

| Piece                                | Origin                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------- |
| Seal / list / file-at / restore-plan | Copied from `jj-historyd` `lib.rs`                                        |
| HTTP + `!Send` isolation             | Same pattern as historyd `main.rs`                                        |
| Init                                 | `init_internal_git` (historyd used colocated — Deck forbids depot `.git`) |
| Store layout                         | `.deck/history/repo` + thin `.jj/repo` file pointer                       |
| `/file-list-at`, seal `actor`        | Deck D1 additions historyd lacked                                         |

## Layout after `/ensure` and `/fork`

```text
<depot>/
  …live content…
  .deck/
    history/repo/          # one durable jj store for the Realm
    branches/
      ana%2Fbutton-tone/   # named branch working tree (URL-component name)
        .jj/
          repo             # points back to ../../../history/repo
          working_copy/
  .jj/
    repo                   # file: "../.deck/history/repo"
    working_copy/
```

In standalone Deck, `dir` is a depot. In the Boxel backport, `dir` is the
selected branch workspace projected as a Realm root. The default workspace is
the Realm root; every named branch is a real jj workspace directly beneath the
owning Realm's `.deck/branches/<encoded-name>/`. All of them point to the one
durable `.deck/history/repo`, so a fork preserves History ancestry without
copying a repository. Hosted Boxel places that Realm tree on S3 Files. deckd
never writes collaboration refs or Checkpoints through direct S3; Realm Server
owns those conditional operations.

## Write path (watchexec shape)

1. `POST /ensure { dir, watch }` attaches History and explicitly selects
   recursive FS capture (`true`) or writer-managed sealing (`false`).
2. Deck mode accepts only the canonical `.deck/history/` layout; it does not
   migrate earlier Deck experiments.
3. `POST /fork` creates a named jj workspace whose editable change has the
   requested exact Checkpoint as its parent. The operation materializes only
   branch source bytes; Repository, lock, and index objects stay shared by hash.
4. File changes under `dir` (non-machinery) → in-process note → **one** debounce
   worker per depot/branch workspace → seal.
5. HTTP `/note` / `/flush` / `/seal` are the explicit mutation surface.
6. `POST /list` is read-only and uses a **read** lock (does not share the seal
   write mutex).

When Hub uses `DECKD_URL`, Node watchers publish + HMR only — they do not
`noteMutation`/`flush` (see Deck `watchAndPublish` `sealOnWatch`).
Boxel Realm Server uses `watch: false`: its conditional branch writer
materializes an accepted tree and seals it as one indivisible History batch.

## Concurrency

| Op                            | Gate                                              |
| ----------------------------- | ------------------------------------------------- |
| fork                          | global fork gate + owning Realm **write** lock    |
| ensure / seal / restore       | shared-History-repository **write** lock          |
| list / file-at / file-list-at | shared-History-repository **read** lock per Realm |

Different Realms remain concurrent. Branches inside one Realm serialize jj
repository operations while retaining separate working copies and History
heads.

## Run

```bash
# from packages/deckd
cargo run
./scripts/smoke.sh

# from Deck root — starts deckd + Hub
./scripts/run-hub-with-deckd.sh
```

```bash
export DECKD_URL=http://127.0.0.1:8787
```
