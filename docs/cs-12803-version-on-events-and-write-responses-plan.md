# CS-12803 — `version` on index events and write responses, `baseMatched` on envelope results

## Goal

Expose a card's content fingerprint — the `content_hash` the realm already records in
`realm_file_meta` for every file its write path stores — on the three surfaces an
optimistic client reads, and give a caller the wire spelling to name the base it wrote
on top of.

Three additive server-side changes:

1. **On the index event.** `IncrementalIndexEventContent` gains
   `versions?: Record<string, string>` — URL → post-write content hash, for the files
   the request wrote directly. A dependent card re-indexed because something it
   depends on changed is in `invalidations` and not in `versions`.
2. **On the card+json write responses.** `meta.version` on `POST` 201 and `PATCH` 200,
   taken from the commit's own result.
3. **On the envelope.** An entry may carry `data.meta.baseVersion`; the result reports
   `meta.baseMatched` whenever one was supplied.

Nothing is removed and no existing key moves.

## What already exists on main, and what is genuinely missing

Worth stating plainly, because two thirds of item 3 is already built and re-doing it
would be the wrong change:

- **The coordinator already computes `baseMatched`.** `EntryCommon.baseVersion` in
  `card-operations/executors.ts` is accepted by every arm of `BatchEntry`, and
  `coordinator.ts` compares it against the pre-write hash it read inside the write
  lock, reporting `meta.baseMatched` on the entry's result.
- **The envelope already puts `baseMatched` on the wire.** `writeResult` in
  `card-operations/envelope.ts` emits it when the coordinator reported one, and emits
  `version` unconditionally.
- **What is missing is the way in.** Nothing parses a base version off the wire, so
  `baseMatched` is unreachable through the `_operations` endpoint today: the only
  callers that can set `baseVersion` are in-process ones. Item 3 is one parse plus one
  pass-through, not a new mechanism.

Genuinely new: the event member, the two response `meta` keys, and the two strips that
keep the new key out of stored bytes.

## Decisions

### How `versions` keys a URL

The same way the event's `invalidations` names one. `realm-index-updater.ts` maps the
index's own row keys to event names with `href.replace(/\.json$/, '')` — applied
unconditionally, card or not — so a commit's write results get the same treatment:
`this.paths.fileURL(path).href` with a trailing `.json` stripped. Matching by
construction rather than by a second rule is the point; a key the event spells
differently from the URL beside it in `invalidations` is a key no client can join on.

### Why the whole member is dropped past a size budget rather than truncated

`invalidatedTypes` already sets this precedent in `realm.ts`, with the reason: the
member bounds its own contribution and nothing else, and a realm whose pass is
pathological drops the member instead of adding to the bulk. `versions` is bounded by
the *batch's* own file count rather than by the invalidation fan-out, so it is small
for every ordinary write — but a bulk import writing thousands of files should not be
what makes an event undeliverable, and this member is additive, so an absent one costs
a client exactly what it cost before the member existed: it re-reads.

Truncating would be worse than dropping. A client cannot tell a truncated map from a
complete one, so a missing key would read as "this card is not one the request wrote"
— which is the opposite of true.

### `versions` carries every file the commit wrote, without intersecting `invalidations`

`clientAuthored` is filtered against `invalidations` and warns on a drop, because a
dropped authorship name turns a card its writer said to leave alone into one every
client re-reads — it loses an edit. A version has no such failure mode: an extra key
names a file that is not in this event's invalidation set, and a client looking up a
card it holds simply does not find it there. So `versions` is exactly "the files this
request wrote", which is what the member claims to be, rather than that set narrowed
by something it does not depend on.

This also keeps the member honest in the one case where intersecting would silently
empty it: a write whose bytes were already what the caller staged invalidates nothing,
and the file's version is still the version the file holds.

### The card+json `GET` is left alone

Not an omission — the two reasons are in the ticket and both hold against the code:

- Adding a key to the served representation moves none of the `ETag`'s inputs
  (`indexed_at`, the realm-info hash, the screenshot fingerprint), so
  `CARD_JSON_ETAG_VARIANT` would have to be bumped or a client holding a cached body
  gets 304'd back to a document that predates the key. Bumping it makes every client
  in the fleet refetch. That is a cost to pay when a reader exists.
- A version read there cannot be bound to the document it ships with. The document
  comes from the index; the hash comes from `realm_file_meta`. `persistFileMeta` runs
  before `performIndex`, and a `skip-index-wait` write defers indexing entirely, so a
  reader other than the writer can assemble the pre-write document and then read the
  post-write hash.

### The write responses need no `ETag` variant change

The `POST`/`PATCH` response already takes its own `write-echo` validator variant, and
the write path never populates the card-document cache — `getOrPopulate` is reached
from the card+json `GET` handler alone. So a write echo is never stored under a
validator a later conditional request could be answered from, and adding a key to it
cannot 304 anybody into a stale body. Nothing about the `GET` representation moves, so
`CARD_JSON_ETAG_VARIANT` stands.

### Where `version` gets stripped, and why two places rather than one

`file-serializer.ts` keeps it out of the stored `.json`, beside `realmInfo`,
`realmURL`, `lastModified`, `resourceCreatedAt` and `screenshots`. That is the
persistence boundary and it is the one that matters for what lands on disk.

`stageUpdate` in `card-operations/executors.ts` drops it from an incoming patch as
well, and the second strip is not redundant: the deletes there run *before* the
`isEqual(primary, original)` comparison that decides whether a patch changed anything.
A `meta.version` surviving the merge would make every echoing client's no-op save look
like a change — rewriting the file, moving its modification time, queueing an index
pass, and reporting `changed: true` — and the serializer stripping it afterwards would
not undo any of that.

### The host needs no change

The ticket asks whether the host should drop `version` where it serializes for a
write, next to `generation`. It does not need to, and the reason is that the host does
not round-trip a served `meta` at all: `serializeCardResource` in
`packages/base/card-serialization.ts` builds `meta` from scratch — `adoptsFrom`, plus
`realmURL` read off the instance, plus the per-field `meta.fields` the field
serializers contribute — and copies nothing else out of what it was served. That is
already why `generation`, which *is* stamped on the card+json `GET`, never comes back
on a `PATCH` body. The strips above are for clients that do echo (an agent assembling
a patch document, the atomic-operations path), not for the host.

## Steps

1. `packages/runtime-common/resource-types.ts` — `version?: string` on
   `CardResourceMeta`, documented as the stored file's content fingerprint and
   distinguished from the `ETag` and from `generation`.
2. `packages/base/matrix-event.gts` — `versions?: Record<string, string>` on
   `IncrementalIndexEventContent`.
3. `packages/runtime-common/realm.ts`
   - `broadcastIncrementalInvalidationEvent` accepts `versions` and applies the size
     budget, mirroring `boundedInvalidatedTypes`.
   - `#commitBatchUnlockedInner` builds the map from its own write results and passes
     it to all three broadcast sites (awaited, deferred `onSettled`, and the
     nothing-changed-on-disk branch).
   - `#createCard` puts `result.meta.version` on the 201 document's `meta`, on both
     the indexed-readback and the echo paths.
   - `#patchCardInstance` / `#patchedCardResponse` / `serializedInstanceEcho` do the
     same for the 200, reading `version` after the possible re-commit on the
     unchanged-patch path.
4. `packages/runtime-common/file-serializer.ts` — strip `meta.version`.
5. `packages/runtime-common/card-operations/executors.ts` — `stageUpdate` drops
   `patch.meta.version`.
6. `packages/runtime-common/card-operations/envelope.ts` — parse
   `data.meta.baseVersion` in `parseInvocation` (refusing a non-string), carry it on
   `EnvelopeEntry`, and set `baseVersion` on the staged entry in `batchEntryFor`.
   `meta` is already in `ENVELOPE_MEMBERS`, so it is already kept out of the
   operation's params and already carried across an `input` stage.

## Testing notes

Realm-server tests, extending the suites that already own these surfaces:

- `tests/helpers/indexing.ts` — `expectIncrementalIndexEvent` learns `versions`. It
  ends in a whole-content `deepEqual`, so the member has to be handled there or every
  caller breaks; the helper knows the single URL the write named, so the default
  expectation is "a version for exactly that URL, and a non-empty one", with callers
  able to pin the hash.
- A `PATCH` and an envelope write each produce an event whose `versions[url]` equals
  the hash of the file's stored bytes and equals the `meta.version` the write response
  carried. Computing the expected hash from the bytes on disk rather than from the
  response is what makes this two independent readings of one fact.
- A write that also re-indexes a dependent: the dependent is in `invalidations` and
  absent from `versions`.
- An envelope entry with a stale `baseVersion` answers `baseMatched: false` **and
  still applies** — the base is informational, unlike `If-Match`. A fresh one answers
  `true`. An entry that sent none has no `baseMatched` key.
- A `GET` carries no `meta.version`.
- A `PATCH` that echoes back a served `meta.version` leaves the file's modification
  time alone and reports no change — the assertion that pins the `stageUpdate` strip,
  and the one that would fail loudly if only the serializer stripped it.
- The stored `.json` never carries `version`. `card-endpoints-test.ts` already
  deep-equals file contents after a `POST`, so this is covered by existing
  assertions once they stay green.

Existing write-response assertions that deep-equal a whole `meta` and therefore gain
`version` deliberately — to be listed exactly in the PR:
`packages/host/tests/integration/realm-test.gts` (the `PATCH` response comparisons)
and `packages/realm-server/tests/card-endpoints-test.ts`.

Per the repo's own rule, these are realm-server-only surfaces with no host consumer
suite, so the new cases are plain qunit files under `packages/realm-server/tests/`
rather than a `runSharedTest` map.

## What must not change

Existing event consumers ignore unknown keys. The card+json `GET` representation is
untouched, so no `ETag` variant bump. `If-Match` remains the only way to *refuse* a
write on a stale base. No `VirtualNetwork` access is added. `version` is the content
hash — never the `ETag`, never `generation`.
