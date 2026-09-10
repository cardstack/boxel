import { computeContentHash } from '../content-hash.ts';
import { isCardError } from '../error.ts';
import { RealmPaths, type LocalPath } from '../paths.ts';
import {
  createIdentity,
  includedResources,
  localIdOf,
  namesForeignRealm,
  stageCreate,
  stageDelete,
  stagedIdentity,
  stageUpdate,
  type BatchEntry,
  type LidIndex,
  type StagedChange,
  type StagedIdentity,
  type StagingContext,
  type StoredFile,
} from './executors.ts';
import {
  OperationFailure,
  isOperationFailure,
  type OperationIdentityResult,
} from './types.ts';
import type { CodeRef } from '../code-ref.ts';
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
  // Whether anything is stored at this path. Distinct from reading it: the
  // destinations a create mints are checked for being free, and their bytes
  // are of no interest.
  fileExists(localPath: LocalPath): Promise<boolean>;
  // Refuses bytes the realm will not store at this path — the size ceiling a
  // card or a file is held to. Throws the realm's own error, whose status the
  // coordinator carries through to the caller.
  assertWriteSize(localPath: LocalPath, content: string): void;
  // Waits for indexing already in flight. A card's serialization resolves the
  // definitions its type is built from, and a module written moments earlier
  // may still be indexing, so a batch drains before it stages rather than
  // failing to resolve a type the realm already holds.
  drainIndexing(): Promise<void>;
  // Whether the realm's ignore rules exclude this URL. An ignored file is
  // never visited by indexing, so it never gets an index row.
  isIgnored(url: URL): Promise<boolean>;

  // The realm's unlocked commit: writes and removals under one index job and
  // one index event. Assumes the write lock is held, which it is.
  commitUnlocked(
    batch: {
      writes?: Map<LocalPath, string | Uint8Array>;
      deletes?: LocalPath[];
    },
    options?: { clientRequestId?: string | null; waitForIndex?: boolean },
  ): Promise<{
    writes: { path: string; lastModified: number; contentHash: string }[];
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
  waitForIndex?: boolean;
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
  return await core.withWriteLock(async () => {
    // Drained inside the lock, before anything is staged. Staging serializes
    // each card against its type's definition, and a module written moments
    // earlier may still be indexing; without this a batch that follows a
    // module upload fails to resolve a type the realm already has on disk.
    await core.drainIndexing();
    // Every `lid` in the batch resolves to a URL before any executor runs. A
    // created card's file is named after its `lid`, so its URL is path math
    // over the type it adopts — no read and no write — which is what lets an
    // entry link to a card a later entry mints.
    let lids = indexLids(entries, paths);
    let stored = await readStoredFiles(core, entries, paths);
    let staged: StagedChange[] = [];
    // The version each entry's merge was computed over, captured as it stages
    // rather than read back at the end: `stored` moves underneath the batch
    // as entries compose, so by the commit it no longer holds what the first
    // entry to touch a file merged over.
    let baseHashes: (string | undefined)[] = [];
    for (let [index, entry] of entries.entries()) {
      let change = await stageEntry(entry, index, {
        realmURL: core.realmURL,
        paths,
        lids,
        stored,
        actor: opts.actor ?? '',
        serializeCard: core.serializeCard,
        codeRefKey: core.codeRefKey,
        resolveModuleId: core.resolveModuleId,
        lookupDefinition: core.lookupDefinition,
      });
      baseHashes.push(
        change.primaryPath
          ? stored.get(change.primaryPath)?.contentHash
          : undefined,
      );
      compose(stored, entry, change);
      staged.push(change);
    }
    assertWritesAllowed(staged);
    assertWritesFit(core, staged);
    await assertRemovalsAllowed(core, paths, staged);
    await assertDestinationsFree(core, staged);
    // Everything above either produced bytes for every entry or threw, and a
    // throw leaves the realm as it was.
    return await commitStaged(core, entries, staged, baseHashes, opts);
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
  entry: BatchEntry,
  change: StagedChange,
): void {
  for (let path of change.deletes) {
    stored.delete(path);
  }
  if (entry.op === 'create') {
    return;
  }
  for (let write of change.writes) {
    stored.set(write.path, {
      content: write.content,
      // The file has not been written yet, so its modification time is still
      // the one on disk; the commit reports the real one.
      lastModified: stored.get(write.path)?.lastModified ?? 0,
      contentHash: computeContentHash(write.content),
    });
  }
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
// result reports whether the target was still at it. Only an update has both:
// a create has no prior state to name, and a delete's result carries no state
// to report a match on.
function assertVersionable(entry: BatchEntry, index: number): void {
  if (entry.baseVersion === undefined || entry.op === 'update') {
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
function indexLids(entries: BatchEntry[], paths: RealmPaths): LidIndex {
  let lids = new Map<string, StagedIdentity>();
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
    if (entry.op === 'delete') {
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
        if (
          typeof resource.lid !== 'string' ||
          namesForeignRealm(resource, paths.url)
        ) {
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
  return lids;
}

// ---------------------------------------------------------------------------
// Reading the pre-state
// ---------------------------------------------------------------------------

// Every file the batch reads, loaded once inside the write lock: the merge base
// for each update, the existence check for each delete, and the anchoring card
// a named create reads through `instance(…)`. Loading them up front is what
// makes the executors pure — they resolve nothing and read nothing — and it is
// what makes the bytes a `baseVersion` is compared against the same bytes the
// merge is computed over, read inside the critical section the write happens
// in.
async function readStoredFiles(
  core: BatchCore,
  entries: BatchEntry[],
  paths: RealmPaths,
): Promise<Map<LocalPath, StoredFile>> {
  let wanted = new Set<LocalPath>();
  for (let entry of entries) {
    // A create's href is the card it is anchored on, when it has one; an
    // update's and a delete's is the card itself.
    if (!entry.href) {
      continue;
    }
    let localPath = sourcePathOf(entry.href, paths);
    if (localPath) {
      wanted.add(localPath);
    }
  }
  let stored = new Map<LocalPath, StoredFile>();
  await Promise.all(
    [...wanted].map(async (localPath) => {
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
  );
  return stored;
}

// The stored-source path a target's href names, or undefined when the href is
// not a URL this realm contains. An unusable href is left for the executor to
// refuse, which has the target's own terms to refuse it in.
function sourcePathOf(href: string, paths: RealmPaths): LocalPath | undefined {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return undefined;
  }
  try {
    return `${paths.local(url)}.json` as LocalPath;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Committing
// ---------------------------------------------------------------------------

// `_screenshot/` is claimed by capture serving, so a realm file stored there
// could never be read back — it would index and list, and answer every GET as
// an uncaptured miss. Direct writes and `/_atomic` operations each refuse the
// subtree before writing anything, and a batch is the third way in, so it
// refuses it too. Removals are not covered, deliberately: they are the
// recovery path for anything already stored there, which is why the other two
// admit them as well.
function assertWritesAllowed(staged: StagedChange[]): void {
  for (let [index, change] of staged.entries()) {
    for (let write of change.writes) {
      if (write.path.startsWith('_screenshot/')) {
        throw atEntry(
          new OperationFailure({
            status: 422,
            code: 'invalid-params',
            title: 'Reserved path',
            detail: `cannot write "${write.path}": "_screenshot/" is reserved for serving captures`,
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
    for (let write of change.writes) {
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
async function assertDestinationsFree(
  core: BatchCore,
  staged: StagedChange[],
): Promise<void> {
  let occupied = await Promise.all(
    staged.map(async (change, index) => {
      for (let path of change.mints) {
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
  let writes = new Map<LocalPath, string | Uint8Array>();
  let deleted = new Set<LocalPath>();
  let writtenBy = new Map<LocalPath, number>();
  for (let [index, change] of staged.entries()) {
    for (let write of change.writes) {
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
    for (let path of change.deletes) {
      deleted.add(path);
      writes.delete(path);
    }
  }
  let deletes = [...deleted];
  let committed = await core.commitUnlocked(
    { writes, deletes },
    {
      clientRequestId: opts.clientRequestId ?? null,
      waitForIndex: opts.waitForIndex ?? true,
    },
  );
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
