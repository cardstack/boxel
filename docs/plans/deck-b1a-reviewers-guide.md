# Deck B1a reviewer guide: durable storage adapters

**Branch:** `codex/deck-r0-b1a-storage-adapters`

**Base:** `codex/deck-r0-b0-collaboration-protocol` at `1fd416e9c5`

B1a gives the B0 protocol one conditional-object contract across Boxel Desktop,
open-source/self-hosted Boxel, small teams, and optional hosted object storage.
The realm-files implementation is complete and normative; it is not a fallback
for deployments that lack AWS. B1a does not provision AWS resources.

## Storage topology

All Deck state remains inside its realm:

```text
realm root / S3 realm prefix
├── authored package files
└── .deck/
    ├── store/                 immutable CAS and package Versions
    ├── refs/heads/            conditional mutable branch heads
    ├── reviews/               immutable objects plus conditional refs
    ├── history/               branch-keyed History
    └── prepared/              writer-owned recoverable ref updates
```

Desktop, open-source Boxel, and small teams use
`RealmFileConditionalObjectStore`. Atomic replacement plus a realm-local lock
is sufficient even with a small number of concurrent users. A larger hosted
realm may expose the same prefix through S3 Files for ordinary POSIX reads,
indexing, and agent inspection, while Realm Server writes
contention-sensitive refs through
`S3ConditionalObjectStore` and S3 `If-Match`/`If-None-Match`. This keeps branch
metadata visible under the mounted realm while using the durable S3 object
version as the concurrency authority.

S3 is optional. When selected, S3 Files is not a second canonical tree, and
direct S3 refs do not
float in a parallel bucket hierarchy. Both address the same realm-relative
keys; they are two access paths selected for different consistency needs.

## Where to start

1. `packages/realm-server/lib/deck-conditional-object-store.ts` — safe
   realm-relative keys, atomic local replacement, S3 conditional writes, and
   uniform conflict errors.
2. `packages/realm-server/lib/deck-prepared-branch-update.ts` — immutable
   preparation records, writer ownership, conditional branch publication, and
   idempotent recovery when the write landed but its acknowledgement was lost.
3. `packages/realm-server/tests/deck-conditional-object-store-test.ts` — one
   state-machine suite applied to both adapters, plus the opt-in live AWS
   harness.

## Invariants

- No key may escape the realm root/prefix.
- `If-None-Match: *` creates once; `If-Match` advances only the object version
  the writer actually read.
- Two writers using one stale ETag cannot both win.
- A prepared update is immutable and names one writer. Another writer cannot
  publish it accidentally.
- Replaying a prepared update after the branch write landed returns
  `recovered: true`; it does not advance the branch twice.
- A ref that moved to different state remains a conflict. Recovery never
  overwrites it.
- Agents may inspect `.deck` through the realm filesystem, but hosted mutable
  ref writes go through Realm Server's conditional-object adapter.

## Verification

```sh
cd packages/realm-server
MATRIX_REGISTRATION_SHARED_SECRET=xxxx \
  TEST_FILES=deck-conditional-object-store-test,deck-repository-protocol-test \
  mise exec -- pnpm test
mise exec -- pnpm lint
```

The mandatory local run has nine passing assertions and one deliberately
skipped live AWS assertion. The skip does not reduce filesystem-backed Deck
capability. To validate an optional hosted S3 backend:

```sh
export BOXEL_DECK_S3_TEST_BUCKET=<staging-test-bucket>
export BOXEL_DECK_S3_TEST_REGION=<region>
```

The task role or local AWS profile must allow `s3:GetObject` and conditional
`s3:PutObject` under the test prefix. Optional B1b provisions and drills that
environment for Cardstack hosting, including KMS, bucket versioning,
mount/access point, IAM, alarms, and rollback.
