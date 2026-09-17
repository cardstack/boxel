import {
  computeContentHash,
  computeContentHashFromRanges,
} from '../content-hash.ts';
import { isCardError } from '../error.ts';
import {
  CAPTURE_SERVING_PREFIX,
  PARTIAL_WRITE_SUFFIX,
  RealmPaths,
  isCaptureServingPath,
  isPartialWritePath,
  type LocalPath,
} from '../paths.ts';
import {
  createIdentity,
  includedResources,
  localIdOf,
  namesForeignRealm,
  stageAppendContainsMany,
  stageAppendLine,
  stageCreate,
  stageDelete,
  stagedIdentity,
  stageTransform,
  stageUpdate,
  type BatchEntry,
  type IndexedCardValues,
  type LidIndex,
  type SourceBytes,
  type StagedChange,
  type StagedContent,
  type StagedIdentity,
  type StagingContext,
  type StoredFile,
  type StoredMeta,
} from './executors.ts';
import { isSplicedSource, type SplicedSource } from '../spliced-content.ts';
import { emitOperationPerf } from './telemetry.ts';
import {
  OperationFailure,
  isOperationFailure,
  type OperationIdentityResult,
} from './types.ts';
import type { CodeRef } from '../code-ref.ts';
import type { RequestTimings } from '../request-timings.ts';
import type { Definition } from '../definitions.ts';
import type { LooseSingleCardDocument } from '../index.ts';
import type { RealmResourceIdentifier } from '../realm-identifiers.ts';

// ============================================================================
// The batch coordinator.
//
// A batch is all-or-nothing against every way an entry can be wrong — a
// malformed document, a missing target, a rejected field, bytes over the
// realm's size ceiling, a local id naming nothing or naming two cards: several
// changes to several cards either all land or none do, under one index job and
// one index event. Getting that is a matter of ordering. The coordinator takes
// the realm's write lock, reads every file the batch touches, runs every
// executor in memory, and only then commits. Nothing is written until every
// entry has produced its bytes, and every check the realm would apply per file
// as it writes is applied to the staged bytes first — so an entry that cannot
// be carried out is found while the realm is still untouched: no partial write
// to undo, no index job to cancel, no event a subscriber could have already
// acted on.
//
// What that does not cover is the commit itself failing partway. The realm
// writes a batch's files one at a time and has no rollback, so a file system
// that fails mid-commit — out of space, a path that will not open — leaves the
// files written before it on disk, and this method rejects with the realm in
// that state. Every multi-file write the realm serves behaves this way; a
// batch is not more exposed to it than the atomic endpoint is, and reaching
// past it needs transactional staging in the write primitive rather than
// anything the coordinator can do above it. The guarantee here is over the
// entries, which is what a caller composing a batch controls.
//
// The lock is taken once, here, and never re-entered. Everything below it
// works from the state read inside it, and the commit it hands the staged
// changes to is the realm's unlocked primitive.
// ============================================================================

// The realm's collaborators, narrowed to what committing a batch uses. Handed
// down as plain values and bound functions rather than as a `Realm`: no
// executor resolves an identifier, opens a file, or reaches the network, since
// card modules are author-written and the realm is a trusted context.
export interface BatchCore {
  realmURL: string;
  // Runs `fn` holding the realm's per-realm write lock. The lock spans the
  // reads the batch stages from and the commit itself, so two writers cannot
  // both compute a merge over the same pre-state and have the second silently
  // lose the first's changes.
  withWriteLock<T>(fn: () => Promise<T>): Promise<T>;
  // A stored file's bytes and modification time. Called only inside the lock.
  readSourceFile(
    localPath: LocalPath,
  ): Promise<{ content: string; lastModified: number } | undefined>;
  // A stored file as a size and a bounded reader, for an entry that edits a
  // file too large to read. Called only inside the lock.
  openSourceBytes(localPath: LocalPath): Promise<SourceBytes | undefined>;
  // Whether anything is stored at this path. Distinct from reading it: the
  // destinations a create mints are checked for being free, and their bytes
  // are of no interest.
  fileExists(localPath: LocalPath): Promise<boolean>;
  // Refuses content the realm will not store at this path — the size ceiling a
  // card or a file is held to. Throws the realm's own error, whose status the
  // coordinator carries through to the caller. Described content is held to
  // the same ceiling by its byte length, which it reports without being read.
  assertWriteSize(localPath: LocalPath, content: StagedContent): void;
  // Waits for indexing already in flight. A card's serialization resolves the
  // definitions its type is built from, and a module written moments earlier
  // may still be indexing, so a batch drains before it stages rather than
  // failing to resolve a type the realm already holds. A batch that opts out
  // of waiting for its own indexing skips this too — see
  // `CommitBatchOptions.waitForIndex`, which owns that trade.
  drainIndexing(): Promise<void>;
  // Whether the realm's ignore rules exclude this URL. An ignored file is
  // never visited by indexing, so it never gets an index row.
  isIgnored(url: URL): Promise<boolean>;
  // The index's view of a card in this realm: the computed values its
  // `pristine_doc` holds and the linked-card values denormalized into its
  // `search_doc`. Undefined where the index holds no clean row for the URL —
  // the card is not indexed yet, or its row is an error row, which are the
  // same answer to the question asked here: the index cannot speak for this
  // card.
  //
  // This is the one read a batch makes of the index, and it is not a network
  // capability: the engine is the realm's own, handed down narrowed to the
  // single row a program's reads are layered from. Called only inside the
  // lock, after the drain, so what it reports is the realm as the batch is
  // about to change it.
  indexedCardValues(url: URL): Promise<IndexedCardValues | undefined>;

  // The realm's unlocked commit: writes, additions to the end of a file, and
  // removals under one index job and one index event. Assumes the write lock
  // is held, which it is.
  commitUnlocked(
    batch: {
      writes?: Map<LocalPath, string | Uint8Array | SplicedSource>;
      appends?: Map<LocalPath, string | Uint8Array>;
      deletes?: LocalPath[];
    },
    options?: {
      clientRequestId?: string | null;
      waitForIndex?: boolean;
      initiatingUser?: string | null;
    },
  ): Promise<{
    writes: {
      path: string;
      lastModified: number;
      // When the realm first recorded this file. Read by the commit as it
      // writes, inside the lock, so a caller reporting it never has to ask
      // again afterwards — and a concurrent removal of the same path cannot
      // take the row away between the commit and the answer.
      created: number | null;
      contentHash: string;
    }[];
    generation: number | null;
  }>;
  serializeCard(
    doc: LooseSingleCardDocument,
    relativeTo: URL,
  ): Promise<LooseSingleCardDocument>;
  codeRefKey(codeRef: CodeRef, relativeTo: URL): string;
  resolveModuleId(
    moduleId: RealmResourceIdentifier,
    relativeTo: string,
  ): RealmResourceIdentifier;
  // A relationship's `links.self` as the realm stores it — relative to the
  // file that holds it when the link points inside this realm.
  storedLink(selfLink: string, relativeTo: URL): string;
  // The inverse: the card a stored `links.self` names.
  resolvedLink(selfLink: string, relativeTo: URL): string;
  lookupDefinition(
    codeRef: CodeRef,
    relativeTo: URL,
  ): Promise<Definition | undefined>;
}

export interface CommitBatchOptions {
  // The caller's own id for this batch. Echoed on the realm's index event so a
  // client can tell its own batch's event from anyone else's.
  clientRequestId?: string | null;
  // The invoking actor, as the identity `actor()` resolves to. It comes from
  // the authenticated realm user the request's permission check verified.
  actor?: string;
  // Whether to return only once the batch's index job has landed. Waiting is
  // the default: a caller that reports a version and a generation per entry
  // needs the generation, and a caller reading the cards back needs the rows.
  //
  // It decides a second thing, and a caller reaching for an early response is
  // choosing both: waiting also drains indexing already in flight *before*
  // staging. The two travel together because they are the same trade — a
  // caller that will not wait for its own indexing gains nothing by waiting
  // for someone else's, and paying that drain per write is what makes a run of
  // writes serialize behind each other.
  //
  // It is not a choice about definition freshness, which is the tempting
  // reading: a definition resolves off disk rather than out of the index, so
  // an entry still serializes against a module written moments earlier
  // whichever way this is set. See the drain in `commitBatch` for what the
  // wait actually buys, and the realm's own card-write gate for the case
  // stated at length.
  //
  // A write made from inside a render must skip both, and there it is a
  // requirement rather than a preference: the job it would wait on needs the
  // render slot that caller is holding, so waiting deadlocks.
  waitForIndex?: boolean;
  // Report the bytes each entry's primary file now holds, on the entry's
  // `meta.storedContent`. Off by default: a batch's results say what a card
  // is and what version it holds, and a caller wanting its document reads it
  // back, so carrying every entry's document would make a batch of many
  // entries answer with the realm's contents. It is here for a caller that
  // has no read to make — one whose write indexes deferred and answers from
  // what it wrote — which would otherwise have to go back to the file the
  // commit just closed.
  reportStoredContent?: boolean;
  // What a link to a side-loaded resource the batch will not write means. Such
  // a resource is one claiming another realm, which is not this batch's to
  // create, so the link resolves to nothing either way — the question is
  // whether that is the caller's mistake or its intent.
  //
  // `refuse` is the default and the answer a caller composing a batch wants:
  // it sent the resource, so silently writing a card with that edge empty
  // would describe a payload it did not send, and the remedy — name the card
  // by URL, or stop claiming a realm for it — is one only the caller can
  // apply. The card endpoints ask for `leave`, because a `POST` or `PATCH`
  // carrying such a payload has always stored the card with the edge empty
  // and answered success: serialization records a link it cannot resolve as
  // an explicit null.
  foreignSideLoadLink?: 'refuse' | 'leave';
  // Per-request wall-clock collector, threaded from a caller that reports
  // where its write's time went. The stages a commit owns are not observable
  // from outside it — waiting for the realm's write lock and draining
  // indexing already in flight both happen before the caller's own work
  // starts, and either can be the whole of a slow write — so they are stamped
  // here or not at all. Absent, and so a no-op, for every other caller.
  timings?: RequestTimings;
}

// One entry's answer, in the order the entries were sent. A write reports the
// card's identity and the version it now holds; a delete reports `null`, since
// there is no state left to describe.
export type BatchEntryResult = OperationIdentityResult | null;

export async function commitBatch(
  core: BatchCore,
  entries: BatchEntry[],
  opts: CommitBatchOptions = {},
): Promise<BatchEntryResult[]> {
  let paths = new RealmPaths(new URL(core.realmURL));
  if (entries.length === 0) {
    // Nothing to serialize the realm's writers behind, and nothing to
    // announce. Taking the lock and broadcasting an empty index event would
    // tell every subscriber that something changed.
    return [];
  }
  // Stamped from outside the lock so the wait for it is its own stage: a
  // batch queued behind the realm's other writers spends its time here, and
  // from the handler that is indistinguishable from slow indexing.
  let lockRequestedAt = Date.now();
  let timings = opts.timings;
  let timed = <T>(stage: string, fn: () => Promise<T>): Promise<T> =>
    timings ? timings.time(stage, fn) : fn();
  return await core.withWriteLock(async () => {
    timings?.add('lock', Date.now() - lockRequestedAt);
    // Drained inside the lock, before anything is staged. Staging serializes
    // each card against its type's definition, and a module written moments
    // earlier may still be indexing; without this a batch that follows a
    // module upload fails to resolve a type the realm already has on disk.
    //
    // A batch that does not wait for its own indexing does not wait for
    // anyone else's either — the same trade the realm's own commit makes at
    // the same gate, and for the same reason: draining would make each such
    // write queue behind whatever indexing is still in flight, so a caller
    // writing a run of files, like a realm push or an editor saving
    // repeatedly, would pay the previous write's indexing on every one of
    // them.
    //
    // Skipping it does not cost an entry its definitions. Serialization's one
    // cross-file dependency resolves a definition off disk rather than out of
    // the index, and a module written in the same commit has its cached
    // definition dropped as the bytes land — so no indexing-dependent step
    // stands between a module write and a serialization that follows it. What
    // the drain guards is narrower than the whole of definition freshness; the
    // realm states the case at its own card-write gate, which is the place to
    // read before widening or removing either copy.
    //
    // So this is not reserved for entries that serialize nothing. A caller
    // whose response does not read indexed state can take it, and a
    // prerender-originated write *must*: the job it would wait on needs the
    // render slot that caller is holding, so waiting deadlocks.
    //
    // All of that is about the opt-out. The drain is skipped on its own terms
    // as well, for a batch that stages nothing: a removal names a file and
    // reads the bytes already there, resolving no definition, so a batch of
    // removals would wait for indexing it has no use for. That matters
    // because this wait happens with the realm's write lock held — a removal
    // issued while a bulk import drains would park here holding it, with
    // every other writer queued behind.
    if (opts.waitForIndex !== false && entries.some(stagesContent)) {
      await timed('drain', () => core.drainIndexing());
    }
    let staged: StagedChange[] = [];
    // The version each entry's merge was computed over, captured as it stages
    // rather than read back at the end: `stored` moves underneath the batch
    // as entries compose, so by the commit it no longer holds what the first
    // entry to touch a file merged over.
    let baseHashes: (string | undefined)[] = [];
    // Stamped from a `finally`: an entry that cannot be carried out throws
    // from the staging work, and a write that failed is exactly the one whose
    // time someone is trying to account for.
    let stageStart = Date.now();
    try {
      // Every `lid` in the batch resolves to a URL before any executor runs. A
      // created card's file is named after its `lid`, so its URL is path math
      // over the type it adopts — no read and no write — which is what lets an
      // entry link to a card a later entry mints.
      let { lids, foreignLids } = indexLids(entries, paths);
      let { stored, storedMeta } = await readPreState(core, entries, paths);
      // What an append stages for a file it never read whole. Kept beside
      // `stored` rather than in it: the two describe the same file in different
      // terms, and an executor that needs one cannot work from the other.
      let splices = new Map<LocalPath, SplicedSource>();
      for (let [index, entry] of entries.entries()) {
        let change = await stageEntry(entry, index, {
          realmURL: core.realmURL,
          paths,
          lids,
          foreignLids,
          foreignSideLoadLink: opts.foreignSideLoadLink,
          stored,
          storedMeta,
          splices,
          openSourceBytes: core.openSourceBytes,
          fileExists: core.fileExists,
          indexedCardValues: core.indexedCardValues,
          actor: opts.actor ?? '',
          serializeCard: core.serializeCard,
          codeRefKey: core.codeRefKey,
          resolveModuleId: core.resolveModuleId,
          storedLink: core.storedLink,
          resolvedLink: core.resolvedLink,
          lookupDefinition: core.lookupDefinition,
        });
        baseHashes.push(
          change.primaryPath
            ? (stored.get(change.primaryPath)?.contentHash ??
                storedMeta.get(change.primaryPath)?.contentHash)
            : undefined,
        );
        compose(stored, storedMeta, splices, entry, change);
        staged.push(change);
      }
      assertWritesAllowed(staged);
      assertLinkedCardsSurvive(staged, paths);
      assertWritesFit(core, staged);
      await assertRemovalsAllowed(core, paths, staged);
      await assertDestinationsFree(core, staged);
    } finally {
      timings?.add('stage', Date.now() - stageStart);
    }
    // Everything above either produced bytes for every entry or threw, and a
    // throw leaves the realm as it was.
    return await timed('write', () =>
      commitStaged(core, entries, staged, baseHashes, opts),
    );
  });
}

// Fold what an entry staged into the state the next entry stages against. A
// batch is a sequence, so two entries may name one card and the second is
// meant to build on the first: it merges over the bytes the first staged, not
// over the bytes the batch started from, and the commit writes the file once.
// Composing is what makes that safe — the alternative, letting both merge
// over the pre-batch state, is how the second silently discards the first.
//
// A removal takes its path back out, so an entry that follows one aimed at
// the same card finds nothing there and refuses the way it would outside a
// batch.
//
// A create's bytes are deliberately not folded in. The card it mints is
// reached by the `lid` other entries link to, not by an href they target, and
// letting a later entry address it by URL would tie the batch's meaning to
// path math the caller has to reproduce to predict it.
function compose(
  stored: Map<LocalPath, StoredFile>,
  storedMeta: Map<LocalPath, StoredMeta>,
  splices: Map<LocalPath, SplicedSource>,
  entry: BatchEntry,
  change: StagedChange,
): void {
  for (let path of change.deletes) {
    stored.delete(path);
    storedMeta.delete(path);
    splices.delete(path);
  }
  if (entry.op === 'create') {
    return;
  }
  for (let write of change.writes) {
    if (isSplicedSource(write.content)) {
      // Described rather than read, so there is nothing to fingerprint and
      // nothing to merge over — an append that follows splices into this
      // description, and an executor that needs the bytes whole refuses.
      splices.set(write.path, write.content);
      continue;
    }
    splices.delete(write.path);
    // Recorded as a version whatever the content is, so a later entry naming
    // this file reads the version this entry staged rather than the one the
    // batch started from — which is what a `baseVersion` on it is compared
    // against.
    storedMeta.set(write.path, {
      contentHash: computeContentHash(write.content),
    });
    if (typeof write.content !== 'string') {
      // Bytes rather than text: the content a file was replaced with, which
      // nothing merges over. What a later entry needs from it is the version
      // above; the bytes themselves are the caller's and are not read back.
      stored.delete(write.path);
      continue;
    }
    stored.set(write.path, {
      content: write.content,
      // The file has not been written yet, so its modification time is still
      // the one on disk; the commit reports the real one.
      lastModified: stored.get(write.path)?.lastModified ?? 0,
      contentHash: computeContentHash(write.content),
    });
  }
  // An append is deliberately not folded in. What it stages is an addition
  // rather than a content, so there is nothing to merge over and no version to
  // report until it lands — and the file it appends to is still on disk and
  // still holds whatever it held, which is what a later entry asking whether
  // the target is there finds.
}

// Run one executor, and label whatever it refuses with the entry's position.
// A batch is rejected as a whole, so a caller reading one error needs to know
// which of the entries it sent produced it.
async function stageEntry(
  entry: BatchEntry,
  index: number,
  ctx: StagingContext,
): Promise<StagedChange> {
  try {
    assertVersionable(entry, index);
    switch (entry.op) {
      case 'create':
        return await stageCreate(entry, ctx);
      case 'update':
        return await stageUpdate(entry, ctx);
      case 'delete':
        return stageDelete(entry, ctx);
      case 'transform':
        return await stageTransform(entry, ctx);
      case 'appendContainsMany':
        return await stageAppendContainsMany(entry, ctx);
      case 'appendLine':
        return await stageAppendLine(entry, ctx);
      default:
        throw new OperationFailure({
          status: 400,
          code: 'invalid-params',
          title: 'Unknown entry',
          detail: `entry ${index} names no staged operation`,
        });
    }
  } catch (err: unknown) {
    throw atEntry(err, index);
  }
}

// A `baseVersion` names the state a write is computed on top of, and the
// result reports whether the target was still at it. Only the two entries that
// compute over the stored document have both — an update merges over it and a
// transform plans a program against it. A create has no prior state to name, a
// delete's result carries no state to report a match on, and an append never
// reads the state it edits, so it has nothing to compare one against.
function assertVersionable(entry: BatchEntry, index: number): void {
  if (
    entry.baseVersion === undefined ||
    entry.op === 'update' ||
    entry.op === 'transform'
  ) {
    return;
  }
  throw new OperationFailure({
    status: 400,
    code: 'invalid-params',
    title: 'Invalid base version',
    detail: `entry ${index} is a ${entry.op}, which has no base version`,
  });
}

function atEntry(err: unknown, index: number): OperationFailure {
  if (isOperationFailure(err)) {
    return new OperationFailure({
      ...err.error,
      meta: { ...err.error.meta, entry: index },
    });
  }
  return new OperationFailure({
    status: 500,
    code: 'internal-error',
    title: 'Cannot stage batch',
    detail: `entry ${index} could not be staged: ${
      err instanceof Error ? err.message : String(err)
    }`,
    meta: { entry: index },
  });
}

// ---------------------------------------------------------------------------
// Resolving local ids
// ---------------------------------------------------------------------------

// Every card the batch mints, keyed by `lid`. A `lid` names one card, so two
// entries claiming the same one is a payload the realm cannot carry out: it
// says two different cards are the same card.
//
// The local ids that go unclaimed because they name another realm are
// collected alongside, so a link to one is refused as what it is rather than
// as a link to a card nobody sent.
function indexLids(
  entries: BatchEntry[],
  paths: RealmPaths,
): { lids: LidIndex; foreignLids: ReadonlySet<string> } {
  let lids = new Map<string, StagedIdentity>();
  let foreignLids = new Set<string>();
  let claim = (lid: string, identity: StagedIdentity, position: string) => {
    if (lids.has(lid)) {
      throw new OperationFailure({
        status: 400,
        code: 'invalid-params',
        title: 'Duplicate local id',
        detail:
          `local id "${lid}" is claimed more than once (at ${position}); ` +
          `a local id names one card`,
      });
    }
    lids.set(lid, identity);
  };
  for (let [index, entry] of entries.entries()) {
    // None of them mints a card or side-loads one, so none claims an identity
    // anything else in the batch could link to.
    if (
      entry.op === 'delete' ||
      entry.op === 'transform' ||
      entry.op === 'appendContainsMany' ||
      entry.op === 'appendLine'
    ) {
      continue;
    }
    // Labelled with the entry's position like every other refusal: a caller
    // reading one needs to know which of the entries it sent produced it,
    // whether it was found here or inside an executor.
    try {
      let primary = entry.document?.data;
      // Both the local id and the side-loads are read through the same
      // accessors the executors use, so the pre-pass claims exactly the
      // identities staging will ask for and refuses a malformed payload in
      // the same terms.
      if (entry.op === 'create') {
        let primaryLid = localIdOf(entry);
        if (primaryLid !== undefined) {
          claim(
            primaryLid,
            createIdentity(entry, primary, paths, new Map()),
            `entry ${index}`,
          );
        }
      }
      for (let [offset, resource] of includedResources(
        entry.document,
      ).entries()) {
        // A side-loaded resource with no `lid` is not staged and nothing can
        // link to it; one naming another realm is not this batch's to write.
        // Neither takes an identity here, so neither can be linked to either.
        if (typeof resource.lid !== 'string') {
          continue;
        }
        if (namesForeignRealm(resource, paths.url)) {
          foreignLids.add(resource.lid);
          continue;
        }
        claim(
          resource.lid,
          stagedIdentity(
            resource.meta?.adoptsFrom,
            resource.lid,
            entry.op === 'create' ? entry.directory : undefined,
            paths,
          ),
          `entry ${index}, included[${offset}]`,
        );
      }
    } catch (err: unknown) {
      throw atEntry(err, index);
    }
  }
  return { lids, foreignLids };
}

// ---------------------------------------------------------------------------
// Reading the pre-state
// ---------------------------------------------------------------------------

// Everything the batch knows about its targets before any executor runs, read
// once inside the write lock: the merge base for each update, the existence
// check for each delete, the anchoring card a named create reads through
// `instance(…)`, and the version of each file an entry replaces wholesale.
// Loading it up front is what makes the executors pure — they resolve nothing
// and read nothing — and it is what makes the bytes a `baseVersion` is compared
// against the same bytes the merge is computed over, read inside the critical
// section the write happens in.
//
// What an entry needs from its target is not the same for every entry, so the
// form of the read is the entry's to name (`targetRead`). A card is read whole,
// because a patch merges over it. A file whose content is being replaced is not
// read at all: there is no merge base, and the bytes could be a hundred
// megabytes of log. What the batch keeps for one of those is its version,
// assembled from bounded reads, which is all a `baseVersion` comparison needs.
async function readPreState(
  core: BatchCore,
  entries: BatchEntry[],
  paths: RealmPaths,
): Promise<{
  stored: Map<LocalPath, StoredFile>;
  storedMeta: Map<LocalPath, StoredMeta>;
}> {
  let text = new Set<LocalPath>();
  let meta = new Set<LocalPath>();
  for (let entry of entries) {
    let read = targetRead(entry, paths);
    if (read) {
      (read.form === 'text' ? text : meta).add(read.path);
    }
  }
  let stored = new Map<LocalPath, StoredFile>();
  let storedMeta = new Map<LocalPath, StoredMeta>();
  await Promise.all([
    ...[...text].map(async (localPath) => {
      let file = await core.readSourceFile(localPath);
      if (!file) {
        return;
      }
      stored.set(localPath, {
        content: file.content,
        lastModified: file.lastModified,
        // Fingerprinted from the bytes just read, not from the file's
        // recorded row. The row is written when the realm writes a file, and
        // a file changed out from under the realm is re-indexed without it
        // being rewritten — so the row can name a version the bytes no longer
        // hold. A `baseVersion` exists to catch exactly that, and comparing
        // it to the row would report a match for the state it is meant to
        // detect. This is the fingerprint of what the merge is computed over.
        contentHash: computeContentHash(file.content),
      });
    }),
    ...[...meta]
      // A path already being read whole has its version from those bytes, so
      // asking for it a second way would read the same file twice to produce
      // the same string.
      .filter((localPath) => !text.has(localPath))
      .map(async (localPath) => {
        let bytes = await core.openSourceBytes(localPath);
        if (!bytes) {
          return;
        }
        storedMeta.set(localPath, {
          // The same value hashing the whole file would produce, assembled
          // from ranges instead — `computeContentHashFromRanges` asks for at
          // most `CONTENT_HASH_WHOLE_LIMIT_BYTES` however large the file is,
          // so knowing a file's version never costs the file.
          contentHash: await computeContentHashFromRanges(
            bytes.size,
            async (start, length) =>
              await collect(bytes.read(start, start + length), length),
          ),
        });
      }),
  ]);
  return { stored, storedMeta };
}

// One range of a stored file, as bytes. Bounded by whatever the caller asked
// for, which for a fingerprint is bounded by the fingerprint's own shape.
//
// A short read is a failure rather than fewer bytes. The value assembled from
// these ranges is what a caller's `baseVersion` is compared against, and a
// fingerprint built from a file that moved under the read describes neither
// version of it — so it would report a file the caller is still current with
// as having moved on, with nothing said.
async function collect(
  chunks: AsyncIterable<Uint8Array>,
  length: number,
): Promise<Uint8Array> {
  let read: Uint8Array[] = [];
  let total = 0;
  for await (let chunk of chunks) {
    read.push(chunk);
    total += chunk.length;
  }
  if (total !== length) {
    throw new Error(
      `read ${total} of ${length} bytes while fingerprinting: the file ` +
        `changed while it was being read`,
    );
  }
  let bytes = new Uint8Array(total);
  let at = 0;
  for (let chunk of read) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return bytes;
}

// The stored file an entry's target names, and how much of it the entry needs.
// Undefined when the entry reads nothing, or when its href is not a URL this
// realm contains — an unusable href is left for the executor to refuse, which
// has the target's own terms to refuse it in.
//
// The path is the entry's to decide as much as the form is. A card's stored
// bytes live at its URL plus `.json`, while a file's URL *is* its path, and
// what tells the two apart is the payload the entry carries: a patch to merge
// is a card's, content to replace is a file's. So neither the coordinator nor
// the caller has to classify the target by reading its URL — which is the one
// thing a URL cannot settle, since a realm holds files whose extensions it
// knows nothing about.
function targetRead(
  entry: BatchEntry,
  paths: RealmPaths,
):
  | {
      path: LocalPath;
      form: 'text' | 'meta';
    }
  | undefined {
  // An append's target is deliberately not read: the whole point of either
  // entry is to change a file without holding it, so reading it here would
  // spend the cost it exists to avoid. `appendContainsMany` opens its target
  // itself, in bounded pieces; `appendLine` never opens it at all.
  if (
    !entry.href ||
    entry.op === 'appendContainsMany' ||
    entry.op === 'appendLine'
  ) {
    return undefined;
  }
  let url: URL;
  try {
    url = new URL(entry.href);
  } catch {
    return undefined;
  }
  let localPath: LocalPath;
  try {
    localPath = paths.local(url);
  } catch {
    return undefined;
  }
  if (entry.op !== 'update' || entry.content === undefined) {
    return { path: cardSourcePath(localPath), form: 'text' };
  }
  if (entry.rawSource) {
    // A verbatim replacement never asks what is already at the path: it
    // replaces a card's stored source, a module and a data file the same way,
    // and it writes a path that holds nothing at all. So the distinction the
    // whole-file read below exists to draw is one it does not need drawn, and
    // reading a card's `.json` to draw it would mean holding a file this
    // entry never looks at — on the route an editor saves through, for every
    // save. What is left is reporting whether the caller's base still holds,
    // which only a caller that named one is owed, and which the bounded form
    // answers without the file.
    return entry.baseVersion === undefined
      ? undefined
      : { path: localPath, form: 'meta' };
  }
  // A `.json` at a file's own path is either a card's stored source or a data
  // file the realm merely holds, and only the bytes tell them apart — so this
  // is the one file target whose content the batch reads, and it reads it to
  // answer that. Everything else is a file, and its version is all the batch
  // needs.
  return {
    path: localPath,
    form: localPath.endsWith('.json') ? 'text' : 'meta',
  };
}

// Where a card's bytes are stored: its own path plus `.json`. A card's URL
// carries no extension, so the two are never the same path, which is what
// lets a file be addressed by the URL a card would be addressed by.
function cardSourcePath(localPath: LocalPath): LocalPath {
  return `${localPath}.json` as LocalPath;
}

// The stored-source path a card's id names, or undefined when the id is not a
// URL this realm contains. A link always names a card, so this is the card
// mapping rather than the per-entry one above.
function cardSourcePathOf(
  id: string,
  paths: RealmPaths,
): LocalPath | undefined {
  let url: URL;
  try {
    url = new URL(id);
  } catch {
    return undefined;
  }
  try {
    return cardSourcePath(paths.local(url));
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Committing
// ---------------------------------------------------------------------------

// A batch is the third way into a realm, after direct writes and `/_atomic`,
// so it holds its staged writes to the same reservations both of those refuse
// — read from `isCaptureServingPath` and `isPartialWritePath`, which state
// them once for all three. Removals are not covered, deliberately: they are
// the recovery path for anything already stored under either name, which is
// why the other two admit them as well.
function assertWritesAllowed(staged: StagedChange[]): void {
  for (let [index, change] of staged.entries()) {
    for (let write of [...change.writes, ...change.appends]) {
      let reserved = isCaptureServingPath(write.path)
        ? `"${CAPTURE_SERVING_PREFIX}" is reserved for serving captures`
        : isPartialWritePath(write.path)
          ? `"${PARTIAL_WRITE_SUFFIX}" names a file the realm is part-way ` +
            `through writing, which is no part of the realm`
          : undefined;
      if (reserved) {
        throw atEntry(
          new OperationFailure({
            status: 422,
            code: 'invalid-params',
            title: 'Reserved path',
            detail: `cannot write "${write.path}": ${reserved}`,
          }),
          index,
        );
      }
    }
  }
}

// A batch that both records an edge to a card and removes that card commits a
// link to nothing, whichever order the two entries are sent in.
//
// No executor can see this. One stages against the realm as it stands, where
// the card is still on disk — nothing is written until every entry has staged
// — and it cannot see a removal a later entry has not reached yet. The batch
// is the only thing that holds both halves, so this is where the two are put
// together.
//
// A card removed and re-minted under the same path in one batch is not this
// check's business: what the edge points at is there when the commit settles.
function assertLinkedCardsSurvive(
  staged: StagedChange[],
  paths: RealmPaths,
): void {
  let removed = new Set<LocalPath>();
  for (let change of staged) {
    for (let path of change.deletes) {
      removed.add(path);
    }
  }
  if (removed.size === 0) {
    return;
  }
  let written = new Set<LocalPath>();
  for (let change of staged) {
    for (let write of change.writes) {
      written.add(write.path);
    }
  }
  for (let [index, change] of staged.entries()) {
    for (let id of change.links ?? []) {
      let localPath = cardSourcePathOf(id, paths);
      if (localPath && removed.has(localPath) && !written.has(localPath)) {
        throw atEntry(
          new OperationFailure({
            id: change.id,
            status: 400,
            code: 'invalid-params',
            title: 'Conflicting entries',
            detail:
              `entry ${index} links to ${id}, which this batch removes; the ` +
              `edge would point at nothing once the batch commits`,
          }),
          index,
        );
      }
    }
  }
}

// A removal needs the realm to be willing to serve the card back. `DELETE`
// requires an index row, and an ignored path never gets one — it is never
// visited, so no amount of waiting produces it — which makes a card under an
// ignored path permanently un-deletable over HTTP. Reading its bytes off disk
// is not the same permission: a batch that removed one would be destroying a
// file no other caller can, and the realm would go on ignoring the absence.
async function assertRemovalsAllowed(
  core: BatchCore,
  paths: RealmPaths,
  staged: StagedChange[],
): Promise<void> {
  for (let [index, change] of staged.entries()) {
    for (let path of change.deletes) {
      if (await core.isIgnored(paths.fileURL(path))) {
        throw atEntry(
          new OperationFailure({
            status: 404,
            code: 'target-not-found',
            title: 'Not found',
            detail:
              `${paths.fileURL(path).href} is under a path the realm ` +
              `ignores, so it holds no card to remove`,
          }),
          index,
        );
      }
    }
  }
}

// The realm refuses bytes over its size ceiling, and it refuses them one file
// at a time as it writes. Reaching that inside the commit would leave the
// files written before it on disk and unindexed — the commit rejects before
// it enqueues anything — over a payload the caller could have been told about
// while the realm was still untouched. So the ceiling is applied to every
// staged write here, where a refusal still costs nothing.
function assertWritesFit(core: BatchCore, staged: StagedChange[]): void {
  for (let [index, change] of staged.entries()) {
    // An append is held to the ceiling by what it adds rather than by what the
    // file will hold: the limit is over the bytes a caller hands the realm,
    // and a file grown past it one line at a time is what an append-only file
    // is. Measuring the result instead would mean knowing the file's length,
    // which is a question about the file this entry exists in order not to
    // ask.
    for (let write of [...change.writes, ...change.appends]) {
      try {
        core.assertWriteSize(write.path, write.content);
      } catch (err: unknown) {
        // The realm answers an oversized payload with 413, and that status is
        // the whole remedy: it tells the caller to send less rather than to
        // send again. Carried across rather than flattened into the generic
        // staging failure, which would report the realm as broken and leave
        // retrying as the caller's obvious next move.
        throw atEntry(
          isCardError(err)
            ? new OperationFailure({
                status: err.status,
                code: 'payload-too-large',
                title: err.title ?? 'Payload Too Large',
                detail: err.message,
              })
            : err,
          index,
        );
      }
    }
  }
}

// A create mints a card; it does not replace one. A caller choosing its own
// local id can choose one a stored card already answers to, and committing
// over it would destroy that card with nothing said — so an occupied
// destination refuses the batch, which is the answer the atomic endpoint
// gives an `add` whose href is taken.
//
// Checked inside the lock, against the same critical section the commit runs
// in, so nothing can take the path between the check and the write.
//
// A path an earlier entry removes is not what this check is about, so it is
// left out of it: the stored card is on its way out, and what stops the batch
// is the two entries asking for opposite things rather than the card being
// there. Skipping it hands that pair to the conflicting-entries check, which
// names the entry it collides with instead of telling a caller that meant to
// remove and re-mint a card to patch the one it just removed.
async function assertDestinationsFree(
  core: BatchCore,
  staged: StagedChange[],
): Promise<void> {
  let removedBefore: Set<LocalPath>[] = [];
  let removed = new Set<LocalPath>();
  for (let change of staged) {
    removedBefore.push(new Set(removed));
    for (let path of change.deletes) {
      removed.add(path);
    }
  }
  let occupied = await Promise.all(
    staged.map(async (change, index) => {
      for (let path of change.mints) {
        if (removedBefore[index].has(path)) {
          continue;
        }
        if (await core.fileExists(path)) {
          return { index, path };
        }
      }
      return undefined;
    }),
  );
  let taken = occupied.find((entry) => entry !== undefined);
  if (taken) {
    throw new OperationFailure({
      status: 409,
      code: 'invalid-params',
      title: 'Resource already exists',
      detail:
        `a card is already stored at ${taken.path}; a create mints a card ` +
        `rather than replacing one`,
      meta: { entry: taken.index },
    });
  }
}

async function commitStaged(
  core: BatchCore,
  entries: BatchEntry[],
  staged: StagedChange[],
  baseHashes: (string | undefined)[],
  opts: CommitBatchOptions,
): Promise<BatchEntryResult[]> {
  // One entry per file, in batch order. Two entries may name one card, and
  // the second built on the first rather than racing it — it merged over the
  // bytes the first staged — so the file is written once holding the last of
  // them rather than twice, and a removal that follows drops the write
  // entirely instead of writing bytes the same commit then unlinks.
  let writes = new Map<LocalPath, string | Uint8Array | SplicedSource>();
  // Everything bound for the end of a file, joined in batch order so two
  // entries adding a line to one log both land, in the order they were sent,
  // and the file is reached once.
  let appends = new Map<LocalPath, string>();
  let deleted = new Set<LocalPath>();
  let writtenBy = new Map<LocalPath, number>();
  let appendedBy = new Map<LocalPath, number>();
  for (let [index, change] of staged.entries()) {
    for (let write of change.writes) {
      let appender = appendedBy.get(write.path);
      if (appender !== undefined) {
        // The commit writes before it appends, which is what makes "replace
        // this file, then add a line to it" land in that order. Asked the
        // other way round it cannot: the earlier entry's line would end up
        // after the later entry's content instead of being replaced by it,
        // and both entries would report success over a file neither of them
        // described. Refused rather than reordered, since reordering would
        // silently discard the append.
        throw new OperationFailure({
          status: 400,
          code: 'invalid-params',
          title: 'Conflicting entries',
          detail:
            `entry ${index} replaces the content of ${write.path}, which ` +
            `entry ${appender} appends to; a batch appends to a file after ` +
            `it writes one, not before`,
          meta: { entry: index, conflictsWith: appender },
        });
      }
      if (deleted.has(write.path)) {
        // The batch already removed this card, so writing it back is not a
        // later step in one story — it is two entries asking for opposite
        // things. Un-queueing the removal instead would report that entry as
        // a completed removal, which is indistinguishable from a real one.
        throw new OperationFailure({
          status: 400,
          code: 'invalid-params',
          title: 'Conflicting entries',
          detail:
            `entry ${index} writes ${write.path}, which an earlier entry ` +
            `removes; a batch cannot both remove a card and write it`,
          meta: { entry: index },
        });
      }
      let owner = writtenBy.get(write.path);
      if (owner !== undefined && change.replacesContent) {
        // Two entries changing one card compose because the later one merges
        // over what the earlier staged. A replacement of a file's content
        // merges over nothing — it never read the file — so letting it land
        // last would drop the earlier entry's content with nothing said,
        // while that entry still reported success and carried this entry's
        // version as its own. The same objection as the append-then-write
        // pair above, and the same answer.
        throw new OperationFailure({
          status: 400,
          code: 'invalid-params',
          title: 'Conflicting entries',
          detail:
            `entries ${owner} and ${index} both replace the content of ` +
            `${write.path}; a replacement composes over nothing, so only ` +
            `one of them could land`,
          meta: { entry: index, conflictsWith: owner },
        });
      }
      if (owner !== undefined && write.path !== change.primaryPath) {
        // Two entries changing one card compose because the later one merges
        // over what the earlier staged. A side-loaded resource is serialized
        // whole rather than merged, so it cannot compose over anything —
        // letting it land last would drop the earlier entry's change with
        // nothing said, while that entry still reported success.
        throw new OperationFailure({
          status: 400,
          code: 'invalid-params',
          title: 'Conflicting entries',
          detail:
            `entries ${owner} and ${index} both write ${write.path}, and ` +
            `entry ${index} carries it as a side-load, which replaces the ` +
            `card rather than merging over it`,
          meta: { entry: index, conflictsWith: owner },
        });
      }
      writes.set(write.path, write.content);
      writtenBy.set(write.path, index);
    }
    for (let append of change.appends) {
      if (deleted.has(append.path)) {
        // The same two-entries-asking-for-opposite-things the write leg
        // refuses. Nothing reaches this today — a removal always names a
        // card's `.json` and an append refuses every JSON content type — but
        // that is an invariant held in the executors rather than here, and
        // without this the commit would recreate the path, append to it,
        // announce it as added, and then unlink it.
        throw new OperationFailure({
          status: 400,
          code: 'invalid-params',
          title: 'Conflicting entries',
          detail:
            `entry ${index} appends to ${append.path}, which an earlier ` +
            `entry removes; a batch cannot both remove a file and add to it`,
          meta: { entry: index },
        });
      }
      appends.set(
        append.path,
        `${appends.get(append.path) ?? ''}${append.content}`,
      );
      appendedBy.set(append.path, index);
    }
    for (let path of change.deletes) {
      deleted.add(path);
      // Both legs drop, for the reason the removal wins over either: the file
      // is on its way out, so producing content for it and unlinking it in the
      // same commit is work with no observable result.
      writes.delete(path);
      appends.delete(path);
    }
  }
  let deletes = [...deleted];
  let committed = await core.commitUnlocked(
    { writes, appends, deletes },
    {
      clientRequestId: opts.clientRequestId ?? null,
      waitForIndex: opts.waitForIndex ?? true,
      // The batch's index job is tagged with the user whose request produced
      // it, the same as every other write path, so a reader draining its own
      // writes waits for this job rather than returning ahead of it.
      initiatingUser: opts.actor ?? null,
    },
  );
  // Emitted here rather than where the record was built: a staged entry is not
  // a write yet, and until the commit returns there is nothing to say a program
  // did. Every entry that carries a record is one the commit landed, so the
  // channel and the caller's `meta.diagnostics` describe the same population.
  for (let change of staged) {
    if (change.diagnostics) {
      emitOperationPerf({
        realmURL: core.realmURL,
        actor: opts.actor || null,
        ...change.diagnostics,
      });
    }
  }
  let byPath = new Map(committed.writes.map((write) => [write.path, write]));
  return staged.map((change, index) => {
    if (!change.primaryPath) {
      return null;
    }
    if (deleted.has(change.primaryPath)) {
      // A later entry removed the card this one wrote. There is no state left
      // to describe, which is what a removal reports, so this entry reports
      // it too rather than a version for a file the commit did not leave
      // behind.
      return null;
    }
    let written = byPath.get(change.primaryPath);
    if (!written) {
      // Every staged write is handed to the commit and every one comes back,
      // so a missing result means the two disagree about what was staged.
      // Reporting an empty version would hand the caller a token it could
      // send back as a `baseVersion` that matches nothing.
      throw new OperationFailure({
        id: change.id,
        status: 500,
        code: 'internal-error',
        title: 'Missing write result',
        detail: `the commit reported no result for ${change.primaryPath}`,
        meta: { entry: index },
      });
    }
    let { baseVersion } = entries[index];
    return {
      id: change.id,
      ...(change.lid ? { lid: change.lid } : {}),
      meta: {
        version: written.contentHash,
        generation: committed.generation,
        lastModified: written.lastModified,
        created: written.created,
        // Whether this entry left the file holding something other than what
        // it held when the entry staged. Read off the two hashes the commit
        // already produced — the version the entry's work was computed over,
        // and the version the file now carries — so it costs nothing and
        // cannot disagree with what was written. A patch that changes nothing
        // reports `false` here, which is how a caller tells "the realm agreed
        // to this" from "the realm did something".
        //
        // Per entry rather than per file: where two entries name one card the
        // second composes over what the first staged, so it reports whether
        // *it* changed the answer, not whether the commit did.
        changed: baseHashes[index] !== written.contentHash,
        ...(opts.reportStoredContent
          ? { storedContent: primaryContent(change) }
          : {}),
        ...(change.diagnostics ? { diagnostics: change.diagnostics } : {}),
        // Compared against the fingerprint the file carried before the commit,
        // read inside this same lock. A mismatch is not an error — the write
        // happened, and what a moved base means is the caller's to decide.
        ...(baseVersion === undefined
          ? {}
          : { baseMatched: baseHashes[index] === baseVersion }),
      },
    };
  });
}

// Whether an entry produces content the realm has to make sense of, which is
// what the pre-staging drain is for: serializing a card resolves the
// definitions its type is built from, and a module written moments earlier may
// still be indexing. A removal produces none — it names a file and reads the
// bytes already there — so a batch of removals resolves nothing and has
// nothing to wait for.
function stagesContent(entry: BatchEntry): boolean {
  return entry.op !== 'delete';
}

// The content an entry staged for the file its result reports. Taken from the
// staged change rather than read back afterwards: these are the bytes the
// commit wrote, whereas the file has been open to every other writer since the
// lock was released. Undefined where the entry described its file instead of
// materializing it — an append names an addition, not the file's next content
// — and where the content is raw bytes, which no caller reads a document from.
function primaryContent(change: StagedChange): string | undefined {
  let write = change.writes.find((write) => write.path === change.primaryPath);
  return typeof write?.content === 'string' ? write.content : undefined;
}
