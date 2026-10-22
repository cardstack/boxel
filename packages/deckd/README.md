# deckd

The Deck History daemon: every-save History for a Deck realm, over
[jj-lib](https://crates.io/crates/jj-lib). Realm Server calls it to seal each
accepted branch write as one History Step, to list Steps, and to read the exact
files of any Step for a restore. See `docs/deck-collaboration.md`.

This is a backport of `packages/deckd` from the Deck repository
(<https://github.com/cardstack/deck>), carrying only History. Fixes should land
in Deck first.

```bash
cargo run --locked
export DECKD_URL=http://127.0.0.1:8787   # what Realm Server reads
```

## Layout after `/ensure`

```text
<realm>/
  …live content…
  .deck/history/repo/      # durable jj store, inside the realm
  .jj/
    repo                   # file: "../.deck/history/repo"
    working_copy/
```

jj's Git backend is initialized internally, never colocated, so a realm never
gains a `.git` directory. `.deck`, `.jj`, `.git` and dependency directories are
machinery: they are never sealed.

## HTTP

| Route                         | Purpose                                                      |
| ----------------------------- | ------------------------------------------------------------ |
| `POST /ensure { dir, watch }` | attach History; `watch` selects FS capture or explicit seals |
| `POST /seal`                  | seal the working tree as one Step, optionally attributed     |
| `POST /note`, `POST /flush`   | debounced capture for the watched mode                       |
| `POST /list`                  | Steps, newest first                                          |
| `POST /file-at`               | one file's bytes at a Step                                   |
| `POST /file-list-at`          | every file path at a Step                                    |
| `POST /restore-plan`          | the writes and deletes that would replay a Step              |
| `GET /health`                 | liveness                                                     |

Realm Server uses `watch: false`. Its branch writer materializes an accepted
tree and then seals it explicitly, so a large write is never sealed halfway.
Standalone use can pass `watch: true` to capture file changes with one
debounced worker per directory.

Seals take a per-directory write lock; `list`, `file-at` and `file-list-at`
take a read lock and never wait on a seal.

## Tests

```bash
cargo test --locked
# With deckd running: ensure, seal, list, file-list-at, attribution and
# watcher-created Steps.
./scripts/smoke.sh
```
