# Deck collaboration in a realm

`docs/deck-packages-and-runtime-resolution.md` covers how a realm becomes a
package and how its lock resolves. This document covers the other half: how a
realm's mutable source is versioned, shared and recovered without a commit, a
clone or an mtime.

All Deck collaboration state lives inside the realm, under `.deck/`, beside the
authored files. Nothing is stored in a parallel bucket or database.

## The gate

Collaboration is off unless the operator turns it on for exact realms:

```sh
BOXEL_DECK_COLLABORATION_ENABLED=true
BOXEL_DECK_COLLABORATION_REALM_RRIS=@cardstack/pretui/,@acme/relay/
```

`packages/realm-server/lib/deck-collaboration-policy.ts` reads both. The gate
is conjunctive: a realm outside the allowlist cannot reach Version serving,
the protocol adapter, content sync or History, whatever the flag says.

## Verified collaboration objects

The vendored Deck core owns the canonical objects: Repository, branch head,
Checkpoint, Review, and three-way merge. Boxel does not reimplement them.
`packages/realm-server/lib/deck-repository-protocol.ts` decides when Boxel may
trust them:

- An RRI is identity. A Repository is accepted only when its roots and members
  contain the realm's RRI; URL topology is irrelevant.
- Reads are referentially complete. A missing or mismatched content-addressed
  object raises `DeckProtocolIntegrityError`; a caller never receives a partial
  branch or Review.
- A Review stays pinned to its immutable base, target and source Checkpoints,
  so a merge preview is reproducible while the target branch keeps moving.
- `.deck/versions/<scope>/<name>/<version>.json` records, write-once, the
  exact Checkpoint a published Version came from. It is accepted only when the Version's tree,
  index, Repository and lock all agree.

## Packages a realm hosts

A realm is always a package: its root `package.json` names the realm RRI,
which is the Repository's identity and what the allowlist names. A realm can
host more packages the way a Deck depot does, with a `.deck/repository.json`
manifest (Deck core's `deck-repository-manifest-v2`):

```json
{
  "schema": "deck-repository-manifest-v2",
  "roots": ["@acme/kit/"],
  "members": { "@acme/kit/": ".", "@acme/button/": "button" }
}
```

`packages/realm-server/lib/deck-realm-packages.ts` reads it. The realm's own
package must be the root member at `.`, and each other member's
`<path>/package.json` must name it. All members advance together on one
branch: an accepted write stores the realm tree for the realm's package and
the subtree at each member's path for that member. Each package keeps its own
Versions in `.deck/store/<scope>/<name>/`.

A hosted package's Versions are served beside its mutable root, so
`@acme/button@2.0.0/index.js` is at `<realm>/button@2.0.0/index.js`. The server
takes the identity from the manifest, never from the URL's segments, and names
it in `X-Boxel-Version-RRI`. `<package root>/.deck/capabilities` answers with
the realm's RRI, the `packageRRI` at that root, and `packages`: every hosted
package's mutable root URL. The Host registers that directory, so a lock that
names a hosted package resolves without guessing its URL.

## Storage

```text
realm root (or its S3 prefix)
├── authored package files
└── .deck/
    ├── store/                immutable content-addressed objects and Versions
    ├── refs/heads/           conditional mutable branch heads
    ├── reviews/              immutable Reviews plus conditional refs
    ├── versions/             Version → Checkpoint origin records
    ├── history/              every-save History (see below)
    ├── prepared/             writer-owned, recoverable ref updates
    └── _writer-locks/        the realm-local branch writer lock
```

The ordinary realm filesystem is the complete, normative backend. Desktop,
self-hosted Boxel and small teams need nothing else.
`packages/realm-server/lib/deck-conditional-object-store.ts` gives that backend
and an optional S3 backend one conditional-object contract:

- `RealmFileConditionalObjectStore` uses a realm-local lock plus atomic
  replacement.
- `S3ConditionalObjectStore` uses `If-None-Match: *` to create once and
  `If-Match` to advance only the object version the writer read. A hosted realm
  can mount the same prefix through S3 Files for ordinary reads and indexing;
  both paths address the same realm-relative keys, so S3 is never a second
  canonical tree.
- No key may escape the realm root or prefix, and two writers holding one stale
  ETag cannot both win.

`packages/realm-server/lib/deck-prepared-branch-update.ts` adds recoverable
branch publication on top: a prepared update is immutable and names one writer;
replaying it after the write landed but its acknowledgement was lost reports
`recovered: true` instead of advancing the branch twice, and a ref that moved
elsewhere stays a conflict.

The S3 suite runs against an in-memory S3 double. To run it against a real
bucket, set `BOXEL_DECK_S3_TEST_BUCKET` and `BOXEL_DECK_S3_TEST_REGION`.

## Content sync

A Deck realm replaces mtime causality with an exact, three-way content
protocol. Boxel CLI negotiates once per realm:

- `GET /.deck/capabilities` answering 404 means a legacy realm, and the CLI
  keeps its existing mtime workflow unchanged.
- A complete Deck capability (`protocol: deck-r0`, `sync: content-addressed`)
  selects the Deck protocol and nothing else.
- Authentication failures, server errors, and malformed or partial
  capabilities fail closed. A probe that merely failed never downgrades a Deck
  realm to mtime rules.

The realm serves two read endpoints and one write:

- `GET /.deck/branch?name=main` returns the exact branch observation:
  Repository, tree and lock hashes, the ref generation, and the SHA-256 of
  every file.
- `GET /.deck/tree-file?tree=…&path=…` returns immutable bytes from a tree;
  the client verifies them against the hash it expected.
- `POST /.deck/branch?name=main` carries the base the client observed plus
  byte operations. `packages/realm-server/lib/deck-branch-content-update.ts`
  checks the Repository, tree, lock and ref generation, stores the new
  immutable objects, and moves the branch with one conditional ref write. A
  stale writer gets 409; two stale writers cannot both win.

In the workspace, `.boxel-sync.json` becomes a `boxel-deck-workspace-v1`
record: the realm RRI, the branch, the exact base hashes and generation it
last observed, and the SHA-256 of every local file. It holds no mtimes.
`packages/boxel-cli/src/lib/deck-workspace-state.ts` classifies each path
against that base:

```text
recorded exact base ───────┐
                           ├── three-way plan ── conflict ──▶ no writes
local SHA-256 tree ────────┤
                           └── reconcile ───────▶ immutable objects
remote branch observation ─┘                              │
                                                          ▼
                                              conditional branch CAS
```

- `realm pull` materializes an exact branch base.
- `realm push` publishes local changes only when the recorded base has not
  moved.
- `realm sync` first takes disjoint remote work, then publishes the rest.
- `realm watch` polls local hashes and the remote ref read-only, and its
  debounced flush runs the same path as `realm sync`.
- A same-path divergence is a conflict: no command sends a remote mutation for
  it, and `--force`, `--overwrite-local` and `--prefer-newest` are not
  consistency bypasses on a Deck realm.
- `.boxel-sync.json`, `.boxel-watch.lock`, `.claude/`, `.deck/`, `.jj/`,
  `.git/` and dependency directories are local machinery, never branch
  content.

## Every-save History

An accepted write is recoverable without anyone committing. `deckd`
(`packages/deckd`, a Rust daemon over jj-lib, backported from Deck) keeps
History inside the realm at `.deck/history/repo/`, with `.jj/repo` as a thin
pointer to it. Neither is branch content. `@cardstack/deck-history` is its
TypeScript client; Realm Server finds the daemon through `DECKD_URL`.

```text
exact expected branch head
          │
          ▼
realm-local branch writer lock
          │
          ├── seal the state being left (first write only)
          ├── materialize the accepted immutable tree into the realm
          ├── seal one History Step
          └── advance Repository + History head + pending index in one ref CAS
```

`packages/realm-server/lib/deck-branch-content-update.ts` owns that
transition. Realm Server attaches deckd with `watch: false` and seals
explicitly, so a large write is never sealed halfway, and a failure after
materialization rolls the live tree back. A stale or losing writer changes
neither the live source nor the ref.

`packages/realm-server/lib/deck-branch-history.ts` serves
`GET /.deck/history?branch=main`: the Steps reachable from the History head the
ref records, newest first. A Step the daemon holds but the ref never reached is
not branch History. `POST /.deck/history` restores forward only: it replays the
exact bytes of a reachable Step through the same expected-head writer, which
records a new `restore: …` Step. Nothing is rewound.

`realm push`, `realm sync` and `realm watch` all reach the same branch update,
so each accepted batch becomes one `save: …` Step. `boxel realm history`
negotiates per realm: a Deck workspace or realm URL reads server History and
restores by full or uniquely identifying Step prefix, refusing unless the
workspace is clean and still at the exact remote head, then refreshing it by
exact pull. A legacy workspace keeps its local `.boxel-history` behavior.

```sh
boxel realm pull <realm-url> ./pretui-main --branch main
boxel realm watch ./pretui-main
boxel realm history ./pretui-main --limit 20
boxel realm history ./pretui-main --restore <step> --yes
boxel realm history <realm-url> --branch main --limit 20
```

## Cutting a Version

A package's Version is its tree at the branch head, named with the semver its
own `package.json` declares there. The realm cuts it:

```http
POST <package root>/.deck/versions?branch=main
Content-Type: application/json

{ "schema": "boxel-deck-version-cut-v1",
  "version": "1.2.0",
  "expectedRepositoryHash": "…" }
```

`version` defaults to the head's `package.json` version and must equal it.
`expectedRepositoryHash`, when given, must still be the head. The call takes
the realm ACL's write. `packages/realm-server/lib/deck-version-cut.ts` then:

1. reads the package's tree from the head's Repository, which the branch
   writer already stored, so no bytes are copied;
2. publishes it to `.deck/store/<scope>/<name>/` through Deck core, which
   refuses a number it already holds;
3. builds the Version's index, stores a Checkpoint pinning the head's
   Repository and History head, and writes the origin record once.

It answers `201` with the origin record and a `Location` of the Version's
root, `409` when the Version exists or the head moved, and `400` when the
version disagrees with `package.json` or the package is not on the branch.

```sh
boxel realm version ./kit                        # the realm's own package
boxel realm version ./kit --package @acme/button
boxel realm version <realm-url> --semver 1.2.0 --json
```

From a workspace, the command requires a clean workspace still at the exact
head it last observed and sends that head as `expectedRepositoryHash`, so the
Version is exactly what the author has. A release is a commit-free act: bump
`version` in `package.json`, save, then cut.

## Current limits

- History, sync and restore support the `main` branch only. Named branches need
  branch-qualified index projections first.
- An accepted write moves the live source and History, but the branch head
  records its index generation as pending. Branch-qualified index projections,
  which Browse, Run and catalog results would read per branch, are later work.
- The conditional-object and prepared-update adapters are complete and tested,
  but the branch writer still moves refs through Deck core's realm-file CAS
  directly.
- A hosted package's mutable modules are ordinary realm files, served with the
  realm's `X-Boxel-Realm-Url`. The Host therefore resolves their bare imports
  through the realm root's `importmap.json`, which is Deck core's one lock per
  Repository. A member's own `importmap.json` is used for its exact Versions.
- The Host learns a realm's package directory when it discovers that realm. A
  lock in another realm that names a hosted package before anything from its
  realm has loaded still falls back to `/<scope>/<name>/` on the importing
  realm's origin.
- Cutting a Version names no dist-tags and records no release notes; Deck
  core's `releaseVersion` (a new number for an existing Version's tree) and
  dist-tags are not exposed by the realm yet.
- A cut publishes before it records its origin. If the origin write fails, the
  Version exists without one and a retry answers `409`.
