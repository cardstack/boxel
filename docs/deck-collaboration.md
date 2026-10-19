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
- `.deck/versions/<version>.json` records, write-once, the exact Checkpoint a
  published Version came from. It is accepted only when the Version's tree,
  index, Repository and lock all agree.

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
    └── prepared/             writer-owned, recoverable ref updates
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
