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
  type EntryPosition,
  type OperationIdentityResult,
} from './types.ts';
import type { CodeRef } from '../code-ref.ts';
import type { JsonValue } from '../json-validation.ts';
import type { RequestTimings, StageCursor } from '../request-timings.ts';
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
// one index event. Getting that is a matter of ordering. The coordinator locks
// every file the batch touches, reads them, runs every executor in memory, and
// only then commits. Nothing is written until every entry has produced its
// bytes, and every check the realm would apply per file as it writes is
// applied to the staged bytes first — so an entry that cannot be carried out
// is found while the realm is still untouched: no partial write to undo, no
// index job to cancel, no event a subscriber could have already acted on.
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
// The locks are taken once, here, and never re-entered. Everything below them
// works from the state read inside them, and the commit they hand the staged
// changes to is the realm's unlocked primitive.
//
// A batch is a tree rather than only a list — see `BatchGroup` — but only the
// staging phase reads it as one. The lock set, the pre-state read, the commit
// and the results are all in the batch's flat request order, and a flat list
// is the tree with no groups in it.
// ============================================================================

// The realm's collaborators, narrowed to what committing a batch uses. Handed
// down as plain values and bound functions rather than as a `Realm`: no
// executor resolves an identifier, opens a file, or reaches the network, since
// card modules are author-written and the realm is a trusted context.
export interface BatchCore {
  realmURL: string;
  // Runs `fn` holding a write lock on each of `localPaths`. The locks span the
  // reads the batch stages from and the commit itself, so two writers of one
  // file cannot both compute a merge over the same pre-state and have the
  // second silently lose the first's changes.
  //
  // Scoped to the files rather than to the realm: that exclusivity is what the
  // merge needs, and holding the realm would charge every other writer in it —
  // including the writers of cards this batch never reads — for a guarantee
  // only these files require.
  //
  // And scoped in time to the read-merge-write, which is what `releaseLocks`
  // is for: the commit announces the moment its bytes are durable, and the
  // batch lets the locks go there rather than across the index wait that
  // follows. Ordering is what the locks are for, and by then this batch's
  // place in the order is settled.
  withWriteLocks<T>(
    localPaths: readonly LocalPath[],
    fn: (releaseLocks: () => void) => Promise<T>,
  ): Promise<T>;
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
  // Waits for the indexing already in flight that can move what this batch
  // resolves. A card's serialization resolves the definitions its type is
  // built from, and a module written moments earlier may still be indexing,
  // so a batch drains before it stages rather than failing to resolve a type
  // the realm already holds, and the realm's settings are resolved partly out
  // of its config document's index row, so a pass touching that is waited for
  // too. A pass that touched neither is not: it rewrites index rows a staging
  // batch resolves nothing from, so waiting for one would be paying another
  // card's fan-out for nothing. A batch that opts out of waiting for its own
  // indexing skips this too — see `CommitBatchOptions.waitForIndex`, which
  // owns that trade.
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
  // This is one of the two reads a batch makes of the index — `realmConfig`
  // is the other — and it is not a network capability: the engine is the
  // realm's own, handed down narrowed to the single row a program's reads are
  // layered from. Called inside the lock, so
  // no other writer of these files can move the row underneath the batch —
  // but the row is the index as it stands, not as some other card's pending
  // fan-out will leave it. A program reads indexed values eventually
  // consistently, and a row that is absent or not yet caught up is reported
  // as such rather than waited for.
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
      clientAuthored?: string[];
      waitForIndex?: boolean;
      initiatingUser?: string | null;
      // Where the commit stamps the stages it owns. The durable write, the
      // index enqueue, the wait for the worker and the invalidation that
      // follows it all happen inside this call, and each can be the whole of
      // a slow write — so the commit marks them on the caller's timeline
      // rather than leaving the caller one bucket it cannot read.
      stageCursor?: StageCursor;
      // Called once the commit's bytes are durable and before it indexes
      // them, so a caller holding write locks over those files can end its
      // critical section at the boundary the locks are actually for.
      onDurable?: () => void;
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
  // The realm's own settings, as `realmConfig()` answers with them. A realm
  // that declares none answers with an empty map, which is what tells a
  // program naming a setting that this realm has none.
  realmConfig(): Promise<Record<string, JsonValue>>;
}

export interface CommitBatchOptions {
  // The caller's own id for this batch. Echoed on the realm's index event so a
  // client can tell its own batch's event from anyone else's.
  clientRequestId?: string | null;
  // Whether the index event should say which of this write's cards carried
  // content the caller supplied.
  //
  // The question only has an interesting answer when one request writes
  // several cards whose state came from different places, which is what a
  // batch does. A front door that writes one card has nothing to distinguish:
  // its request id already names that card's write, and a client reading the
  // event has always taken the id to be about the card it sent. So the
  // envelope answers and the card and source routes stay silent, which is what
  // keeps their events exactly as they were.
  reportAuthorship?: boolean;
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
  // whichever way this is set. Nor is the drain it governs realm-wide: it
  // waits only for passes that touched a module or the realm's config
  // document. See the drain in
  // `commitBatch` for what the wait actually buys, and the realm's own
  // card-write gate for the case stated at length.
  //
  // A write made from inside a render must skip both, and there it is a
  // requirement rather than a preference: the job it would wait on needs the
  // render slot that caller is holding, so waiting deadlocks.
  waitForIndex?: boolean;
  // A caller's own precondition, run inside the write lock and before
  // anything is staged. It exists because a precondition evaluated before
  // `commitBatch` is not binding: the lock is acquired here, so a request
  // whose check passed can then queue behind another writer's whole write and
  // proceed against state that moved. Throwing from here refuses the batch
  // with nothing staged, nothing enqueued and no event broadcast, and the
  // thrown failure's status is what the caller answers with.
  //
  // The realm keeps the *content* of the check — an `If-Match` compares a
  // card's `ETag`, which is built from index and realm-info state the
  // coordinator has no business assembling. This owns only when it runs.
  precondition?: () => Promise<void>;
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

// One entry's answer, in the flat order the entries were sent — a group's
// members answer where they sit in that order, so a caller that composed a
// tree reassembles the shape it sent. A write reports the card's identity and
// the version it now holds; a delete reports `null`, since there is no state
// left to describe.
export type BatchEntryResult = OperationIdentityResult | null;

// A run of entries, evaluated one way or the other.
//
// `serial` is the top level's own rule applied further down: members evaluate
// in order, and where two of them change one file the later composes over what
// the earlier staged. `parallel` says the members are independent — they
// evaluate concurrently, each against the state the group started from, and
// two of them changing one file is refused rather than ordered. The two nest
// to any depth, so "create a card and link it, while an unrelated log is
// appended to" is one shape.
//
// Grouping schedules staging and nothing else. Every entry still evaluates
// against pre-batch state, every `lid` in the tree is resolved once before any
// of it runs, and the whole tree commits under one lock through one
// `commitUnlocked` with one index job and one event — so a failure anywhere
// abandons everything, the members of a parallel group that had already staged
// included.
export interface BatchGroup {
  op: 'parallel' | 'serial';
  members: BatchNode[];
}

// An entry, or a run of them. A flat `BatchEntry[]` is a `BatchNode[]` holding
// no groups, which is the serial batch every caller but the envelope composes.
export type BatchNode = BatchEntry | BatchGroup;

function isGroup(node: BatchNode): node is BatchGroup {
  return node.op === 'parallel' || node.op === 'serial';
}

export async function commitBatch(
  core: BatchCore,
  batch: BatchNode[],
  opts: CommitBatchOptions = {},
): Promise<BatchEntryResult[]> {
  let paths = new RealmPaths(new URL(core.realmURL));
  // The tree resolved into the flat request order everything but staging works
  // from, once, before anything runs.
  let { tree, entries } = schedule(batch);
  if (entries.length === 0) {
    // Nothing to serialize the realm's writers behind, and nothing to
    // announce. Taking the lock and broadcasting an empty index event would
    // tell every subscriber that something changed.
    return [];
  }
  // Resolved before the lock is taken, because it is what says which files to
  // lock. It is path math over what the entries name — every `lid` in the
  // batch mapped to the URL its card will land at — and it reads nothing, so
  // nothing it produces can be stale by the time the lock is held.
  //
  // The caller's own numbering is resolved first because the lid index
  // reports against it: a batch that refuses part of what a caller composed
  // names the entry the caller sent, not the one this function is holding.
  let positions = positionsOf(entries);
  let { lids, foreignLids } = indexLids(entries, positions, paths);
  // Stamped from outside the lock so the wait for it is its own stage: a batch
  // queued behind another writer of the files it needs spends its time here,
  // and from the handler that is indistinguishable from slow indexing.
  let lockRequestedAt = Date.now();
  let timings = opts.timings;
  let timed = <T>(stage: string, fn: () => Promise<T>): Promise<T> =>
    timings ? timings.time(stage, fn) : fn();
  // The realm's settings, read at most once for the whole batch and only if
  // something in it asks — a thunk rather than a value, for two reasons that
  // pull in opposite directions.
  //
  // Not eagerly, because a cold read is a parse of the realm's config document
  // — several queries and a file read — and the batches that name no setting
  // are most of them. Deferring it means they pay nothing.
  //
  // And not before the lock, which is the other way to avoid charging them:
  // everything a batch stages against is read after the pre-staging drain, so
  // a settings map read before it would be from a different moment than the
  // files beside it. A `realm.json` write still indexing when this batch
  // arrives is exactly the case — the drain waits for it, and a snapshot taken
  // earlier would stage `realmConfig()` values the realm has already replaced.
  // Nothing runs this until staging, which is inside the lock and past the
  // drain, so the settings and the stored bytes describe one pre-state.
  //
  // Once because a batch commits to one realm. What it does not do is move as
  // the batch stages: `stored` composes so a later entry sees an earlier one's
  // bytes, while a batch that rewrites `realm.json` does not change its own
  // settings. Nothing would be gained by making it — the settings a realm
  // serves come from its indexed config card, so they lag a write to it until
  // the index swap drops the cache. A request issued straight after this batch
  // reads the old values too, and a batch that refreshed mid-flight would be
  // the only reader in the system that did not.
  let settings: Promise<Record<string, JsonValue>> | undefined;
  let realmConfig = () => (settings ??= core.realmConfig());
  return await core.withWriteLocks(
    lockPaths(entries, paths, lids),
    async (releaseLocks) => {
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
      // The set it waits on is narrower too: only passes that touched an
      // executable module or the realm's config document — the two things a
      // batch resolves out of the index rather than off disk. An instance-only
      // fan-out moves neither, so no batch has a reason to wait for one, which
      // is what keeps a hub card's fan-out from gating every other writer in
      // the realm.
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
      // because this wait happens with the batch's file locks held — a removal
      // issued while a bulk import drains would park here holding them, with
      // every other writer of those files queued behind. What is left to park
      // for is another writer's module or config landing, and those are
      // realm-wide by nature: neither a definition nor a realm setting is any
      // one file's to hold.
      if (opts.waitForIndex !== false && entries.some(stagesContent)) {
        await timed('drain', () => core.drainIndexing());
      }
      // After the drain, so the state a precondition reads is the realm as this
      // batch is about to change it, and before staging, so a refusal costs
      // nothing but the locks it already holds.
      await opts.precondition?.();
      // Filled by position rather than appended to: a parallel group's members
      // finish in whatever order their work takes, and everything downstream
      // reads these in the order the caller sent them.
      let staged: StagedChange[] = new Array(entries.length);
      // The version each entry's merge was computed over, captured as it stages
      // rather than read back at the end: `stored` moves underneath the batch
      // as entries compose, so by the commit it no longer holds what the first
      // entry to touch a file merged over.
      let baseHashes: (string | undefined)[] = new Array(entries.length);
      // Stamped from a `finally`: an entry that cannot be carried out throws
      // from the staging work, and a write that failed is exactly the one whose
      // time someone is trying to account for.
      let stageStart = Date.now();
      try {
        let { stored, storedMeta } = await readPreState(core, entries, paths);
        let state: StagingState = {
          stored,
          storedMeta,
          // What an append stages for a file it never read whole. Kept beside
          // `stored` rather than in it: the two describe the same file in
          // different terms, and an executor that needs one cannot work from
          // the other.
          splices: new Map<LocalPath, SplicedSource>(),
        };
        // The top level is a serial group, which is what makes a flat list
        // behave as it always has.
        await stageRun(tree, 'serial', () => state, {
          entries,
          positions,
          staged,
          baseHashes,
          budget: stagingBudget(STAGING_WIDTH),
          stage: (entry, position, against) =>
            stageEntry(entry, position, {
              realmURL: core.realmURL,
              paths,
              lids,
              foreignLids,
              foreignSideLoadLink: opts.foreignSideLoadLink,
              stored: against.stored,
              storedMeta: against.storedMeta,
              splices: against.splices,
              openSourceBytes: core.openSourceBytes,
              fileExists: core.fileExists,
              indexedCardValues: core.indexedCardValues,
              actor: opts.actor ?? '',
              realmConfig,
              serializeCard: core.serializeCard,
              codeRefKey: core.codeRefKey,
              resolveModuleId: core.resolveModuleId,
              storedLink: core.storedLink,
              resolvedLink: core.resolvedLink,
              lookupDefinition: core.lookupDefinition,
            }),
        });
        assertWritesAllowed(staged, positions);
        assertLinkedCardsSurvive(staged, paths, positions);
        assertWritesFit(core, staged, positions);
        await assertRemovalsAllowed(core, paths, staged, positions);
        await settleDestinations(core, paths, staged, positions);
      } finally {
        timings?.add('stage', Date.now() - stageStart);
      }
      // Everything above either produced bytes for every entry or threw, and a
      // throw leaves the realm as it was.
      //
      // The commit stamps its own stages as it passes them, so what is left
      // for `commit` is the work around them: assembling one file list out of
      // what the entries staged, and reporting what landed. A core that stamps
      // nothing — a caller standing in for the realm — leaves the whole commit
      // here.
      let cursor = timings?.cursor();
      try {
        return await commitStaged(
          core,
          entries,
          staged,
          baseHashes,
          positions,
          opts,
          cursor,
          releaseLocks,
        );
      } finally {
        cursor?.mark('commit');
      }
    },
  );
}

// The position each entry is reported under, in batch order.
//
// An entry that names its own is reported under that one everywhere a position
// appears — the key on a refusal, the key beside it naming the entry it
// collides with, and the prose — so the three cannot disagree with each other.
// An entry that names none is reported under its position in this batch, which
// is what a caller that sent exactly this list means by it.
function positionsOf(entries: readonly BatchEntry[]): EntryPosition[] {
  return entries.map((entry, index) => entry.label ?? index);
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
  state: StagingState,
  entry: BatchEntry,
  change: StagedChange,
): void {
  let { stored, storedMeta, splices } = state;
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

// ---------------------------------------------------------------------------
// Scheduling the staging phase
// ---------------------------------------------------------------------------

// What an entry stages against: the realm as the batch found it, kept in step
// with what the entries before it in its own serial run have staged.
interface StagingState {
  stored: Map<LocalPath, StoredFile>;
  storedMeta: Map<LocalPath, StoredMeta>;
  splices: Map<LocalPath, SplicedSource>;
}

// A copy for one member of a parallel group.
//
// The members of a parallel group are entries that do not compose, so none of
// them may read what another staged. This is what makes that hold, and it is
// load-bearing today rather than insurance against a future executor: a named
// create reads its anchor card — the `href` its template reaches through
// `instance(…)` — out of this state, and that is a file the entry never
// writes, so `claimsOf` does not claim it and the conflict rule does not
// refuse the pair. `parallel(update X, a create anchored on X)` is therefore
// admitted, and what the create reads is decided here: the card as the group
// found it.
//
// Deleting this does not redden the suite, which is a fact about an `await`
// rather than about the invariant — `resourceFromTemplate` reaches the anchor
// read before it yields, so the sibling's `compose` never gets a turn. Move
// one `await` earlier and the two answers diverge with nothing to say so.
//
// The maps hold one key per file the batch names, and `compose` replaces
// their values rather than editing them, so the copy is shallow.
// The state a run works against, obtained on first use.
//
// A branch's copy is deferred to the moment one of its entries reaches the
// front of the staging budget, rather than made when the branch is created.
// Created up front, a batch of N one-entry branches over N files would hold N
// copies of an N-key map before a single entry had run — quadratic in a width
// the caller chooses, while only as many entries as the budget allows are ever
// doing anything. Deferred, a branch that has not started costs nothing and a
// branch that has finished is collectable.
//
// Deferring is safe because of when the state around a group moves: a parallel
// group's members do not compose into it — a direct entry member defers its
// compose to the fold-back, and a group member composes into its own copy — so
// nothing mutates it while a member is live. A serial run mutates it between
// members, and awaits each one, so again not while a member is live. The copy
// therefore holds what it would have held had it been taken when the branch
// began.
type ObtainState = () => StagingState;

function branchState(parent: ObtainState): ObtainState {
  let forked: StagingState | undefined;
  return () => (forked ??= fork(parent()));
}

function fork(state: StagingState): StagingState {
  return {
    stored: new Map(state.stored),
    storedMeta: new Map(state.storedMeta),
    splices: new Map(state.splices),
  };
}

// One entry with its place in the batch's flat request order.
interface ScheduledEntry {
  kind: 'entry';
  entry: BatchEntry;
  at: number;
}

// One group, with the half-open range of flat positions its subtree covers.
// The range is contiguous because the order is the depth-first request order,
// which is what lets a parallel group fold its members' changes back into the
// state around it in request order without collecting them as it goes.
interface ScheduledGroup {
  kind: 'group';
  mode: 'parallel' | 'serial';
  members: Scheduled[];
  from: number;
  to: number;
}

type Scheduled = ScheduledEntry | ScheduledGroup;

// The tree with every entry's flat position attached, and those entries in
// that order.
//
// Resolved before anything runs rather than as entries complete: in a parallel
// group they complete in whatever order their work takes, and that is the one
// order a batch must not be described by. Everything outside staging — the
// pre-state read, the lock set, the commit's one-write-per-file fold, the
// results — reads the flat order this produces.
function schedule(nodes: readonly BatchNode[]): {
  tree: Scheduled[];
  entries: BatchEntry[];
} {
  let entries: BatchEntry[] = [];
  let walk = (nodes: readonly BatchNode[]): Scheduled[] =>
    nodes.map((node) => {
      if (!isGroup(node)) {
        entries.push(node);
        return { kind: 'entry', entry: node, at: entries.length - 1 };
      }
      let from = entries.length;
      let members = walk(node.members);
      return {
        kind: 'group',
        mode: node.op,
        members,
        from,
        to: entries.length,
      };
    });
  return { tree: walk(nodes), entries };
}

// Every file a subtree stages a change to, and which of its entries claimed
// each one first. What a parallel group checks its members against.
type Claims = Map<LocalPath, number>;

// What staging one run needs: where each entry's answer goes, and how to run
// one against a given state.
interface StagingRun {
  entries: readonly BatchEntry[];
  positions: readonly EntryPosition[];
  staged: StagedChange[];
  baseHashes: (string | undefined)[];
  // Shared by every run in the tree, which is what makes the bound a
  // property of the request rather than of one group.
  budget: StagingBudget;
  stage(
    entry: BatchEntry,
    position: EntryPosition,
    against: StagingState,
  ): Promise<StagedChange>;
}

// How many members of one parallel group stage at a time.
//
// A group's width is the caller's to choose and staging is not free: an entry
// may open a stored file, read an indexed row, resolve a definition and
// serialize a card. Unbounded, a single authorized request would decide how
// much of the realm's connection pool it holds and how many copies of the
// batch's staging state are live at once — both proportional to a number the
// caller picked.
//
// Bounded rather than capped, because width is a shape a real batch has: a
// line appended to fifty logs, a hundred cards found by a query. Refusing
// those would be refusing what grouping is for, while running them eight at a
// time costs only wall-clock. Eight is read off the connection pool it has to
// share: the adapter allows 40 per process and search alone is observed to
// want 20+ at peak, so a batch that took tens of them would queue the
// indexer's own commits behind itself — and a waiter inside the pool is
// indistinguishable from slow SQL in the logs.
//
// A ceiling for ops to raise where the pool is bigger, in the shape the
// realm's other bounds use. `process` is read defensively: this module is
// isomorphic and the coordinator's own callers are server-side, but the
// bundle is not.
const DEFAULT_STAGING_WIDTH = 8;

// Every item's outcome, with at most `width` of them in flight at a time.
//
// `Promise.allSettled` over a mapped array is the shape this replaces, and the
// two differ only in how many run at once: results still sit at their item's
// index, and a rejection is still carried rather than thrown, so the earliest
// refusal in request order is the one the caller is told about however the
// work interleaved.
export async function settledWithin<T, R>(
  width: number,
  items: readonly T[],
  run: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  let outcomes: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  let worker = async () => {
    while (next < items.length) {
      let at = next++;
      try {
        outcomes[at] = { status: 'fulfilled', value: await run(items[at]) };
      } catch (reason: unknown) {
        outcomes[at] = { status: 'rejected', reason };
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(width, items.length) }, worker),
  );
  return outcomes;
}

export const STAGING_WIDTH = ((): number => {
  let raw =
    typeof process !== 'undefined'
      ? process.env?.CARD_OPERATIONS_STAGING_WIDTH
      : undefined;
  let parsed = raw != null && raw !== '' ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed >= 1
    ? Math.floor(parsed)
    : DEFAULT_STAGING_WIDTH;
})();

// A batch-wide allowance for the work staging does, handed to every run in
// the tree rather than created per group.
//
// Per group it would not be a bound at all: `stageRun` recurses, so a tree of
// groups eight wide and three deep would hold eight allowances of eight and
// stage five hundred entries at once — the number rising with a depth the
// caller chooses, while the constant stays reassuringly at eight.
//
// The allowance is held only around one entry's own staging, never by a group
// while its members run. That is what makes it deadlock-free: nothing holding
// one ever waits for another to be released. It is taken in serial runs too,
// so the bound is over the request rather than over any one group — several
// serial branches proceeding at once are as many entries in flight as a
// parallel group of the same width.
interface StagingBudget {
  spend<T>(work: () => Promise<T>): Promise<T>;
}

function stagingBudget(limit: number): StagingBudget {
  let free = limit;
  let waiting: (() => void)[] = [];
  return {
    async spend<T>(work: () => Promise<T>): Promise<T> {
      if (free > 0) {
        free--;
      } else {
        await new Promise<void>((resolve) => waiting.push(resolve));
      }
      try {
        return await work();
      } finally {
        // Handed straight to the next waiter rather than returned to the
        // pool and re-taken, so a waiter cannot be passed over by a later
        // arrival that finds `free` briefly above zero.
        let next = waiting.shift();
        if (next) {
          next();
        } else {
          free++;
        }
      }
    },
  };
}

async function stageRun(
  nodes: readonly Scheduled[],
  mode: 'parallel' | 'serial',
  obtain: ObtainState,
  run: StagingRun,
): Promise<Claims> {
  return mode === 'serial'
    ? await stageInOrder(nodes, obtain, run)
    : await stageConcurrently(nodes, obtain, run);
}

// Members one after another, each composing into the state the next one
// stages against — the batch's original rule, and the one a flat list gets.
async function stageInOrder(
  nodes: readonly Scheduled[],
  obtain: ObtainState,
  run: StagingRun,
): Promise<Claims> {
  let claims: Claims = new Map();
  for (let node of nodes) {
    let claimed =
      node.kind === 'entry'
        ? await stageOne(node, obtain, run)
        : await stageRun(node.members, node.mode, obtain, run);
    for (let [path, at] of claimed) {
      if (!claims.has(path)) {
        claims.set(path, at);
      }
    }
  }
  return claims;
}

// Members at the same time, against the state the group started from.
//
// Safe because nothing here is shared: each member has its own view of the
// stored state, an executor resolves and reads nothing beyond what it is
// handed, and a BXL program's own request context is scoped to one synchronous
// evaluation — `withRequestContext` refuses a callback that defers, so an
// evaluation cannot be suspended with another's context underneath it.
async function stageConcurrently(
  nodes: readonly Scheduled[],
  obtain: ObtainState,
  run: StagingRun,
): Promise<Claims> {
  let outcomes = await Promise.allSettled(
    nodes.map(async (node) =>
      // A member that is a single entry needs no copy of the state. The only
      // thing it would put in one is its own staged change, through the compose
      // at the end of `stageOne` — and the fold-back below applies that to the
      // state around the group anyway. Skipping both leaves it reading the
      // state the group started from, which is what a copy would have given it.
      //
      // A member that is a group does need one: its own run composes as it
      // goes, so that a serial step inside it builds on the step before, and
      // those intermediate states are no business of the branch beside it.
      node.kind === 'entry'
        ? await stageOne(node, obtain, run, { compose: false })
        : await stageRun(node.members, node.mode, branchState(obtain), run),
    ),
  );
  // Settled rather than raced, and the earliest refusal in request order is
  // the one reported. Raced, a group with two entries the caller got wrong
  // would name a different one run to run — decided by which member's work
  // finished first, which is not something the caller can see or reproduce.
  let refused = outcomes.find((outcome) => outcome.status === 'rejected');
  if (refused) {
    throw refused.reason;
  }
  let claims: Claims = new Map();
  for (let outcome of outcomes) {
    let claimed = (outcome as PromiseFulfilledResult<Claims>).value;
    for (let [path, at] of claimed) {
      let owner = claims.get(path);
      if (owner !== undefined) {
        throw conflictingTargets(run.positions, owner, at, path);
      }
      claims.set(path, at);
    }
  }
  // Folded into the state around the group once every member has staged, in
  // request order, so an entry after the group composes over what the group
  // staged and does so in the order the caller wrote rather than the order the
  // work finished in.
  let state = obtain();
  for (let node of nodes) {
    if (node.kind === 'entry') {
      compose(state, node.entry, run.staged[node.at]);
      continue;
    }
    for (let at = node.from; at < node.to; at++) {
      compose(state, run.entries[at], run.staged[at]);
    }
  }
  return claims;
}

async function stageOne(
  node: ScheduledEntry,
  obtain: ObtainState,
  run: StagingRun,
  // Whether this entry folds its own change into the state it staged against.
  // A serial step does, so the step after it builds on this one. A direct
  // member of a parallel group does not: it shares the state around the group
  // with its siblings, and the fold-back that follows the group applies every
  // member's change in request order.
  { compose: composeIn }: { compose: boolean } = { compose: true },
): Promise<Claims> {
  let { entry, at } = node;
  // The branch's state is obtained inside the allowance, so a branch waiting
  // its turn has not copied anything yet.
  let { state, change } = await run.budget.spend(async () => {
    let state = obtain();
    return { state, change: await run.stage(entry, run.positions[at], state) };
  });
  run.staged[at] = change;
  run.baseHashes[at] = change.primaryPath
    ? (state.stored.get(change.primaryPath)?.contentHash ??
      state.storedMeta.get(change.primaryPath)?.contentHash)
    : undefined;
  if (composeIn) {
    compose(state, entry, change);
  }
  return claimsOf(change, at);
}

// The files one entry stages a change to: the ones it rewrites, the ones it
// adds to, and the ones it removes.
//
// All three count, and the append leg is the one worth stating, because it is
// the case where refusing is a choice rather than a necessity. A rewrite and
// an append to one file, or a removal and anything else, need an order picked
// for them, and the commit is not the place to pick one. Two appends do not:
// the commit joins them in request order, so that pair alone would land with a
// well-defined result. It is refused anyway, because a parallel group is a
// claim the caller makes about its members rather than a question about what
// the commit can cope with — and an append stages without reading its target,
// so saying those two serially costs the batch nothing.
function claimsOf(change: StagedChange, at: number): Claims {
  let claims: Claims = new Map();
  for (let path of [
    ...change.writes.map((write) => write.path),
    ...change.appends.map((append) => append.path),
    ...change.deletes,
  ]) {
    if (!claims.has(path)) {
      claims.set(path, at);
    }
  }
  return claims;
}

function conflictingTargets(
  positions: readonly EntryPosition[],
  owner: number,
  other: number,
  path: LocalPath,
): OperationFailure {
  return new OperationFailure({
    status: 400,
    code: 'conflicting-targets',
    title: 'Conflicting entries',
    detail:
      `entries ${positions[owner]} and ${positions[other]} are members of ` +
      `one parallel group and both change ${path}; a parallel group says its ` +
      `members are independent of each other, and two entries changing one ` +
      `file are not — put them in serial order, which is how a batch says ` +
      `that both touch it`,
    meta: { entry: positions[other], conflictsWith: positions[owner] },
  });
}

// Run one executor, and label whatever it refuses with the entry's position.
// A batch is rejected as a whole, so a caller reading one error needs to know
// which of the entries it sent produced it.
async function stageEntry(
  entry: BatchEntry,
  position: EntryPosition,
  ctx: StagingContext,
): Promise<StagedChange> {
  try {
    assertVersionable(entry, position);
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
          detail: `entry ${position} names no staged operation`,
        });
    }
  } catch (err: unknown) {
    throw atEntry(err, position);
  }
}

// A `baseVersion` names the state a write is computed on top of, and the
// result reports whether the target was still at it. Only the two entries that
// compute over the stored document have both — an update merges over it and a
// transform plans a program against it. A create has no prior state to name, a
// delete's result carries no state to report a match on, and an append never
// reads the state it edits, so it has nothing to compare one against.
function assertVersionable(entry: BatchEntry, position: EntryPosition): void {
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
    detail: `entry ${position} is a ${entry.op}, which has no base version`,
  });
}

function atEntry(err: unknown, position: EntryPosition): OperationFailure {
  if (isOperationFailure(err)) {
    return new OperationFailure({
      ...err.error,
      meta: { ...err.error.meta, entry: position },
    });
  }
  return new OperationFailure({
    status: 500,
    code: 'internal-error',
    title: 'Cannot stage batch',
    detail: `entry ${position} could not be staged: ${
      err instanceof Error ? err.message : String(err)
    }`,
    meta: { entry: position },
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
// Every file the batch may read, rewrite or remove — the set its writers are
// serialized over. Derived from what the entries name rather than from what
// staging produces, because it has to be known before the lock is taken.
//
// An entry's `href` names one of two things and only the stored bytes say
// which: a card, whose source is the path with `.json` appended, or a file,
// which is the path itself. Both are taken rather than reading first to tell
// them apart — an extra key costs one statement, and the only writer it
// excludes is one of a file that a card of that name would collide with
// anyway. Reading to narrow it would mean a read outside the lock, which is
// the thing the lock exists to prevent.
//
// A create's minted file is covered through `lids`, which resolved every
// client-named card to the path it will land at. A create that named no `lid`
// is deliberately absent: its file is named after an id minted during staging,
// so no other writer can be aimed at that path, and there is nothing for a
// lock to exclude. `settleDestinations` still refuses it if something is
// somehow there.
function lockPaths(
  entries: BatchEntry[],
  paths: RealmPaths,
  lids: LidIndex,
): LocalPath[] {
  let locked = new Set<LocalPath>();
  for (let entry of entries) {
    assertOpReachesALock(entry);
    if (!entry.href) {
      continue;
    }
    let url: URL;
    try {
      url = new URL(entry.href);
    } catch {
      // Not a URL this batch can resolve. The executor refuses it by name
      // once staging reaches it; locking nothing for it changes only which
      // error the caller gets, and it is the executor's to give.
      continue;
    }
    let localPath: LocalPath;
    try {
      localPath = paths.local(url);
    } catch {
      // Outside this realm — refused during staging, for the same reason.
      continue;
    }
    locked.add(localPath);
    locked.add(cardSourcePath(localPath));
  }
  for (let { path } of lids.values()) {
    locked.add(path);
  }
  return [...locked];
}

// Refuses at compile time to let an operation exist that nothing above locks
// for, from both directions: adding a member to `BatchEntry` fails the build
// until its route is stated, and an existing member losing the route it is
// listed under fails it too.
//
// It is a guard rather than a formality because of how the failure would
// present otherwise: an operation whose files reach neither route locks
// nothing, and a write that takes no lock does not error, return differently,
// or look unusual in any response — it races other writers of the same card
// and loses one of them, occasionally, under concurrency. There is no test a
// new operation would arrive with that fails on account of it.
// The two routes, which between them have to cover every member:
//
//   `update`, `delete`, `transform`, `appendLine`, `appendContainsMany`
//       reached by `href` — both spellings of the path it names are locked.
//   `create`
//       reached by `lids`, which resolves each client-named card to the path
//       it will land at; one the client named nothing for is covered by the
//       realm guard a write with no file still takes.
function assertOpReachesALock(entry: BatchEntry): void {
  switch (entry.op) {
    case 'update':
    case 'delete':
    case 'transform':
    case 'appendLine':
    case 'appendContainsMany':
      // The route itself, not just the membership. These five are locked
      // through the path `href` names, so this stops compiling the moment one
      // of them stops requiring it — an update addressed by a `lid` the way a
      // create can be would otherwise pass `lockPaths`'s `if (!entry.href)`
      // and take no lock, with nothing failing to say so.
      entry.href satisfies string;
      return;
    case 'create':
      return;
    default: {
      let unreached: never = entry;
      throw new Error(
        `batch entry reaches no lock: ${JSON.stringify(unreached)}`,
      );
    }
  }
}

function indexLids(
  entries: BatchEntry[],
  positions: readonly EntryPosition[],
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
            `entry ${positions[index]}`,
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
          `entry ${positions[index]}, included[${offset}]`,
        );
      }
    } catch (err: unknown) {
      throw atEntry(err, positions[index]);
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
function assertWritesAllowed(
  staged: StagedChange[],
  positions: readonly EntryPosition[],
): void {
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
          positions[index],
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
  positions: readonly EntryPosition[],
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
              `entry ${positions[index]} links to ${id}, which this batch ` +
              `removes; the edge would point at nothing once the batch commits`,
          }),
          positions[index],
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
  positions: readonly EntryPosition[],
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
          positions[index],
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
function assertWritesFit(
  core: BatchCore,
  staged: StagedChange[],
  positions: readonly EntryPosition[],
): void {
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
          positions[index],
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
// A side-load is the exception, and it is not written either way. It is a
// linked card the caller sent along so the link has something to point at, and
// a card of the same type already stored at its destination gives the link
// that just as well: the side-load is dropped and the stored bytes are left as
// they are, so the entry's own card links to the card that is there. That is
// the case a client re-sending a card whose create already landed presents,
// and refusing it would fail a save that has nothing wrong with the card it is
// saving. It grants nothing a link by URL does not already allow. A stored
// card of a different type is not the card the caller described, so that one
// still refuses the batch, and the refusal names the side-load rather than the
// entry's own card.
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
async function settleDestinations(
  core: BatchCore,
  paths: RealmPaths,
  staged: StagedChange[],
  positions: readonly EntryPosition[],
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
      let taken: LocalPath[] = [];
      for (let path of change.mints) {
        if (removedBefore[index].has(path)) {
          continue;
        }
        if (await core.fileExists(path)) {
          taken.push(path);
        }
      }
      return taken;
    }),
  );
  for (let [index, change] of staged.entries()) {
    for (let path of occupied[index]) {
      let lid = change.sideLoadMints?.get(path);
      if (lid === undefined) {
        throw new OperationFailure({
          status: 409,
          code: 'invalid-params',
          title: 'Resource already exists',
          detail:
            `a card is already stored at ${path}; a create mints a card ` +
            `rather than replacing one`,
          meta: { entry: positions[index] },
        });
      }
      let sent = stagedAdoptsFrom(change, path);
      let stored = await storedAdoptsFrom(core, path);
      let fileURL = paths.fileURL(path);
      if (
        !sent ||
        !stored ||
        core.codeRefKey(sent, fileURL) !== core.codeRefKey(stored, fileURL)
      ) {
        throw new OperationFailure({
          status: 409,
          code: 'invalid-params',
          title: 'Resource already exists',
          detail:
            `the linked card included in this save as "${lid}" would be ` +
            `stored at ${path}, where a card of another type is already ` +
            `stored; a create mints a card rather than replacing one`,
          meta: {
            entry: positions[index],
            included: {
              lid,
              id: fileURL.href.replace(/\.json$/, ''),
              ...(sent ? { adoptsFrom: sent } : {}),
            },
          },
        });
      }
      change.writes = change.writes.filter((write) => write.path !== path);
      change.mints = change.mints.filter((mint) => mint !== path);
    }
  }
}

// The type a staged side-load was sent as, read back off the bytes staging
// produced so it is spelled the way the stored card's is.
function stagedAdoptsFrom(
  change: StagedChange,
  path: LocalPath,
): CodeRef | undefined {
  let write = change.writes.find((candidate) => candidate.path === path);
  return typeof write?.content === 'string'
    ? adoptsFromOf(write.content)
    : undefined;
}

async function storedAdoptsFrom(
  core: BatchCore,
  path: LocalPath,
): Promise<CodeRef | undefined> {
  let stored = await core.readSourceFile(path);
  return stored ? adoptsFromOf(stored.content) : undefined;
}

// Undefined for anything that is not a card document naming its type, which
// is not a card a side-load can be linked to in its place.
function adoptsFromOf(content: string): CodeRef | undefined {
  try {
    let adoptsFrom = JSON.parse(content)?.data?.meta?.adoptsFrom;
    return adoptsFrom && typeof adoptsFrom === 'object'
      ? (adoptsFrom as CodeRef)
      : undefined;
  } catch {
    return undefined;
  }
}

async function commitStaged(
  core: BatchCore,
  entries: BatchEntry[],
  staged: StagedChange[],
  baseHashes: (string | undefined)[],
  positions: readonly EntryPosition[],
  opts: CommitBatchOptions,
  stageCursor: StageCursor | undefined,
  // Handed straight to the commit, which calls it the moment the batch's bytes
  // are durable. Everything from there on — the index pass, the results built
  // from what it reported — runs with the files open to other writers again,
  // and reads nothing off them: the results are assembled from what this batch
  // staged and what the commit returned.
  releaseLocks: () => void,
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
            `entry ${positions[index]} replaces the content of ` +
            `${write.path}, which entry ${positions[appender]} appends to; a ` +
            `batch appends to a file after it writes one, not before`,
          meta: {
            entry: positions[index],
            conflictsWith: positions[appender],
          },
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
            `entry ${positions[index]} writes ${write.path}, which an ` +
            `earlier entry removes; a batch cannot both remove a card and ` +
            `write it`,
          meta: { entry: positions[index] },
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
            `entries ${positions[owner]} and ${positions[index]} both ` +
            `replace the content of ${write.path}; a replacement composes ` +
            `over nothing, so only one of them could land`,
          meta: { entry: positions[index], conflictsWith: positions[owner] },
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
            `entries ${positions[owner]} and ${positions[index]} both ` +
            `write ${write.path}, and entry ${positions[index]} carries it ` +
            `as a side-load, which replaces the card rather than merging ` +
            `over it`,
          meta: { entry: positions[index], conflictsWith: positions[owner] },
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
            `entry ${positions[index]} appends to ${append.path}, which an ` +
            `earlier entry removes; a batch cannot both remove a file and ` +
            `add to it`,
          meta: { entry: positions[index] },
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
  // The file list is assembled, so the window that closes here is that
  // assembly and the refusals above it. Closed before the realm is reached
  // rather than left to the cursor's next mark, which is the realm's own
  // first stage — synchronous in-memory work reported as a wait for indexing
  // would be the exact confusion these stages exist to remove.
  stageCursor?.mark('commit');
  // The cards this batch mints under a name its caller chose. Those cards hold
  // what that caller sent, and a caller that was holding one when it sent it
  // may have moved on since — so the event says so, and re-reading them is
  // that caller's to decline. Every other card the batch touches took state
  // the realm computed, which no caller holds and every one of them wants.
  //
  // Reported even when it is empty, and the emptiness is the report: a batch
  // that only transformed cards authored none of them, which is a different
  // statement from a writer that said nothing about the question. Collapsing
  // the two would have a client read "I supplied none of this" as "no
  // information" and skip the whole pass — the cards it most needs to re-read.
  //
  // A caller that does not ask says nothing at all, which is what every front
  // door but the envelope does.
  let clientAuthored = opts.reportAuthorship
    ? staged
        .filter((change): change is StagedChange => Boolean(change?.lid))
        .map((change) => change.id)
    : undefined;
  let committed = await core.commitUnlocked(
    { writes, appends, deletes },
    {
      clientRequestId: opts.clientRequestId ?? null,
      ...(clientAuthored === undefined ? {} : { clientAuthored }),
      waitForIndex: opts.waitForIndex ?? true,
      // The batch's index job is tagged with the user whose request produced
      // it, the same as every other write path, so a reader draining its own
      // writes waits for this job rather than returning ahead of it.
      initiatingUser: opts.actor ?? null,
      ...(stageCursor ? { stageCursor } : {}),
      onDurable: releaseLocks,
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
        meta: { entry: positions[index] },
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
