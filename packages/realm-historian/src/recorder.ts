// One realm's recorder: it turns the realm's change events into revisions in
// the realm's repo, exactly once.
//
// Events arrive from the consumer in the realm's journal order and are
// handled strictly in that order, one at a time, by a worker that takes a
// permit from a semaphore every recorder of the task shares, so realms record
// concurrently while one realm never commits two revisions at once. `record`
// only queues the event, so a slow realm doesn't hold up the others'; a full
// queue makes the consumer wait.
//
// For each event, in order:
//
// 1. Capture. Each changed path is read from the realm directory as soon as
//    the event is handled, and its bytes are written to the repo as a blob.
//    An appended change is read only up to the event's `size`, the bytes that
//    write left. An appended change to a file above the size threshold is not
//    read: it becomes a size-only entry, from the size and fingerprint the
//    event carries.
// 2. Check. The captured bytes' fingerprint is compared with the event's
//    `contentHash`. A mismatch means a newer write replaced the path before it
//    was captured. It is settled when the group closes, since a later event in
//    the same group replaces the path's capture anyway.
// 3. Group. `grouper.ts` decides whether the event joins the open group.
//    A group also closes on the clock: the task ticks every recorder with a
//    time by which every earlier event is in hand.
// 4. Commit, for each closed group in order:
//    * A mismatched path with a newer event in hand or in the journal is
//      superseded: the revision leaves it out and lists it in
//      `Boxel-Superseded`. The next revision to record the path names, in
//      `Boxel-Includes-Superseded`, every revision that superseded it since
//      it was last recorded, newest first. A mismatched path with no
//      newer event holds the group, and every group after it, until one
//      appears or the maximum age has passed since the write; then the
//      revision lists it as superseded, and an `Unattributed changes`
//      revision by `boxel-system` records the bytes found on disk.
//    * The HEAD check: when `refs/heads/main` is no longer the HEAD this
//      recorder committed or read, another writer has recorded some of the
//      realm's events. Their revisions' `Boxel-Journal-Seq` trailers say
//      which, the cursor moves past them, and the events after it are grouped
//      again. That is what keeps an event out of two revisions after a crash
//      between a commit and its cursor update, a lease handover, or two tasks
//      overlapping.
//    * The trees that changed are written from the in-memory tree of HEAD,
//      then the commit, then HEAD moves by compare-and-swap. In one Postgres
//      transaction the lease is checked and the cursor, HEAD and path state
//      move; the cursor update is conditional on the cursor the recorder
//      read, so it only ever moves forward from where this recorder left it.
//    * A group whose content equals HEAD records nothing and only moves the
//      cursor, unless a path in it was superseded: a write is never dropped
//      without a trace, so a group whose every path was superseded records an
//      empty revision by its author ending `(content not kept)`.
//
// A change to a path history can't hold is left out with a warning, and the
// rest of its event is recorded: a path with a segment git reads as `.git`
// or one named like a size-only entry's marker, or a path with a line break,
// which would split the message lines it appears in. A symlink, or anything
// else that isn't a regular file, is read as absent, so capture never follows
// a link out of the realm.
//
// A failure confined to the realm's repo or files stalls the realm: its state
// row says `stalled`, with the reason, and the other realms carry on. The
// recorder stays for as long as the task runs, dropping the realm's events,
// so a stall cleared by hand takes effect when a task next starts or takes
// over the realm's shard, and reads the realm's events again from its
// cursor. A lost lease or a failed query ends the task through `onFatal`.

import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import {
  CONTENT_HASH_WHOLE_LIMIT_BYTES,
  computeContentHash,
  logger,
  param,
  SYSTEM_AUTHOR,
  type ChangeEvent,
  type ChangeEventChange,
  type ChangeStatus,
  type DBAdapter,
  type PgPrimitive,
  type Querier,
} from '@cardstack/runtime-common';
import {
  BLOB_MODE,
  isDotGitName,
  ObjectStore,
  TREE_MODE,
  type Identity,
} from './git-objects.ts';
import { EMPTY_TREE_ID, HeadTree, type FileEntry } from './head-tree.ts';
import {
  closedByClock,
  decide,
  DEFAULT_GROUPING_LIMITS,
  type CloseReason,
  type GroupingLimits,
  type OpenGroup,
} from './grouper.ts';
import {
  authorIdentity,
  buildMessage,
  committerIdentity,
  formatIncludesSuperseded,
  formatJournalSeq,
  initRepo,
  MAIN_REF,
  parseJournalSeq,
  parseSizeOnlyMarker,
  readMain,
  readRevisions,
  repoPath,
  revisionMessage,
  runGit,
  SIZE_ONLY_MARKER_NAME,
  updateMain,
  writeSizeOnlyEntry,
  type JournalSeqRange,
  type RevisionRecord,
  type RevisionSubject,
  type Trailers,
} from './repo-format.ts';
import {
  comparePositions,
  JOURNAL_START,
  type ReadPosition,
  type RealmRecorder,
} from './consumer.ts';
import { LeaseLostError } from './lease.ts';
import type { Semaphore } from './semaphore.ts';
import type { RecordedRealm } from './realms.ts';

const log = logger('realm-historian:recorder');

// How many recorders do I/O at once in one task, by default.
export const DEFAULT_IO_CONCURRENCY = 16;

// How many events a recorder queues before the consumer waits for it.
const DEFAULT_MAX_QUEUED_EVENTS = 1000;

// How many of a realm's latest revisions a recorder reads when it starts, to
// learn which paths a revision left out as superseded that no later revision
// has recorded yet. A crash between a superseded revision and the revision of
// the newer write is the case it covers, and those are close together.
const SUPERSEDED_LOOKBACK = 100;

// Where a test can stop a recorder: before it captures an event, before the
// HEAD check that starts a commit, before it moves HEAD to a new commit, and
// before each Postgres transaction that moves the cursor.
export type RecorderStep = 'capture' | 'commit' | 'update-ref' | 'cursor';

// What the task asks of a recorder beyond `record`. The methods are optional
// so a test can stand in a recorder that only records.
export interface ManagedRecorder extends RealmRecorder {
  // The time by which every event of the realm with an earlier `occurred_at`
  // has been handed to the recorder (see `closedByClock`), in milliseconds
  // since the epoch, on the database's clock.
  tick?(at: number): void;
  // When the recorder last had work, while it has nothing uncommitted and
  // may be dropped; undefined while it may not.
  idleSince?(): number | undefined;
  // Finishes the step in progress, then stops. Events not yet committed are
  // left to the next recorder, which reads them again from the cursor.
  stop?(): Promise<void>;
}

export interface RecorderOptions {
  db: DBAdapter;
  realm: Pick<RecordedRealm, 'id' | 'url' | 'directory' | 'shard'>;
  historyRoot: string;
  // The task's name in the lease rows, which the commit transaction checks.
  holder: string;
  io: Semaphore;
  // Called once when the task can't go on: the lease is lost or Postgres
  // failed.
  onFatal: (error: Error) => void;
  limits?: GroupingLimits;
  // Appended changes to files larger than this become size-only entries.
  sizeOnlyThresholdBytes?: number;
  maxQueuedEvents?: number;
  // Called as capture makes progress, for the task's health check.
  beat?: () => void;
  testHooks?: { before?(step: RecorderStep): Promise<void> };
}

// The task can't go on: a query failed, or a test hook stopped the recorder.
export class RecorderFatalError extends Error {
  constructor(message: string, options?: { cause: unknown }) {
    super(message, options);
    this.name = 'RecorderFatalError';
  }
}

// The cursor in Postgres is not the one this recorder read.
class CursorMovedError extends Error {
  constructor(realmURL: string) {
    super(`the cursor of ${realmURL} moved under its recorder`);
    this.name = 'CursorMovedError';
  }
}

interface CapturedChange {
  path: string;
  // The status the event gave the path.
  status: ChangeStatus;
  // What the path held when it was captured: a blob or a size-only entry,
  // or null when it was absent.
  entry: FileEntry | null;
  // The `content-hash.ts` fingerprint and size of `entry`.
  fingerprint?: string;
  size?: number;
  // Whether that is what the event says its write left.
  matched: boolean;
  // Wall-clock milliseconds.
  capturedAt: number;
}

interface CapturedEvent {
  event: ChangeEvent;
  position: ReadPosition;
  // One change per path: the event's last change to it.
  changes: Map<string, CapturedChange>;
}

interface Group {
  state: OpenGroup;
  events: CapturedEvent[];
  closedBy?: CloseReason;
}

// A path's last change in a group, and the event that made it.
interface Final {
  change: CapturedChange;
  captured: CapturedEvent;
}

interface PathState {
  path: string;
  contentHash: string;
  size: number;
  objectId: string;
}

// A revision that left a path out as superseded, and the `seq` of the first
// and last events it covers, which a revision with no `Boxel-Journal-Seq`
// lacks.
interface Supersession {
  revision: string;
  range: JournalSeqRange | undefined;
}

type Work =
  | { kind: 'event'; event: ChangeEvent }
  | { kind: 'tick'; at: number };

type CommitOutcome = 'committed' | 'waiting' | 'regrouped';

export class Recorder implements ManagedRecorder {
  #options: RecorderOptions;
  #limits: GroupingLimits;
  #sizeOnlyThreshold: number;
  #maxQueued: number;
  #gitDir: string;
  #store: ObjectStore;

  #state: 'running' | 'stalled' | 'stopped' = 'running';
  #queue: Work[] = [];
  #spaceWaiters: (() => void)[] = [];
  #draining: Promise<void> | undefined;
  #lastActiveAt: number;

  #loaded = false;
  // The last event recorded, as Postgres holds it.
  #cursor: ReadPosition = JOURNAL_START;
  // The last event handled: an event at or below it is a repeat.
  #handled: ReadPosition = JOURNAL_START;
  // The HEAD this recorder last committed or read, and its tree.
  #head: string | undefined;
  #tree = HeadTree.empty();
  // Events captured and not yet committed, in order: those of the closed
  // groups waiting to commit, then the open group's.
  #captured: CapturedEvent[] = [];
  #closed: Group[] = [];
  #open: Group | undefined;
  // The latest tick: the time by which every earlier event is in hand.
  #clock = -Infinity;
  // Paths revisions left out as superseded, with those revisions oldest
  // first, until the cursor moves past a later event for the path that
  // didn't supersede it. A revision that records the path then names every
  // one of them.
  #superseded = new Map<string, Supersession[]>();

  constructor(options: RecorderOptions) {
    this.#options = options;
    this.#limits = options.limits ?? DEFAULT_GROUPING_LIMITS;
    this.#sizeOnlyThreshold =
      options.sizeOnlyThresholdBytes ?? CONTENT_HASH_WHOLE_LIMIT_BYTES;
    this.#maxQueued = options.maxQueuedEvents ?? DEFAULT_MAX_QUEUED_EVENTS;
    this.#gitDir = repoPath(options.historyRoot, options.realm.id);
    this.#store = new ObjectStore(this.#gitDir);
    this.#lastActiveAt = Date.now();
  }

  get state(): 'running' | 'stalled' | 'stopped' {
    return this.#state;
  }

  async record(event: ChangeEvent): Promise<void> {
    while (this.#state === 'running' && this.#queue.length >= this.#maxQueued) {
      await new Promise<void>((resolve) => this.#spaceWaiters.push(resolve));
    }
    if (this.#state !== 'running') {
      return;
    }
    this.#queue.push({ kind: 'event', event });
    this.#kick();
  }

  tick(at: number): void {
    if (this.#state !== 'running') {
      return;
    }
    if (
      this.#queue.length === 0 &&
      !this.#draining &&
      this.#captured.length === 0
    ) {
      // Nothing is open, so there is nothing for the clock to close.
      this.#clock = Math.max(this.#clock, at);
      return;
    }
    let last = this.#queue[this.#queue.length - 1];
    if (last?.kind === 'tick') {
      last.at = Math.max(last.at, at);
    } else {
      this.#queue.push({ kind: 'tick', at });
    }
    this.#kick();
  }

  idleSince(): number | undefined {
    if (this.#state === 'stalled') {
      // A recorder in its place would start from the realm's next event,
      // skipping those this one has dropped, so it stays.
      return undefined;
    }
    let busy =
      this.#state === 'running' &&
      (this.#queue.length > 0 ||
        this.#draining !== undefined ||
        this.#captured.length > 0);
    return busy ? undefined : this.#lastActiveAt;
  }

  // Resolves once every queued step has run.
  async settled(): Promise<void> {
    while (this.#draining) {
      await this.#draining;
    }
  }

  async stop(): Promise<void> {
    if (this.#state === 'running') {
      this.#state = 'stopped';
    }
    this.#discard();
    await this.settled();
  }

  #kick(): void {
    if (this.#draining || this.#queue.length === 0) {
      return;
    }
    this.#draining = this.#drain().finally(() => {
      this.#draining = undefined;
      if (this.#state === 'running') {
        this.#kick();
      }
    });
  }

  async #drain(): Promise<void> {
    while (this.#queue.length > 0 && this.#state === 'running') {
      let release = await this.#options.io.acquire();
      try {
        // Loaded before the work leaves the queue, so a load that fails and
        // recovers leaves the work for the next turn.
        await this.#ensureLoaded();
        if (this.#state !== 'running') {
          continue;
        }
        let work = this.#queue.shift();
        this.#wakeSpaceWaiters();
        if (!work) {
          continue;
        }
        if (work.kind === 'event') {
          this.#lastActiveAt = Date.now();
          await this.#handleEvent(work.event);
        } else {
          await this.#handleTick(work.at);
        }
      } catch (error) {
        await this.#recover(error);
      } finally {
        release();
      }
    }
  }

  #wakeSpaceWaiters(): void {
    for (let wake of this.#spaceWaiters.splice(0)) {
      wake();
    }
  }

  // Drops everything not yet committed. A later recorder reads it again from
  // the cursor.
  #discard(): void {
    this.#queue = [];
    this.#captured = [];
    this.#closed = [];
    this.#open = undefined;
    this.#wakeSpaceWaiters();
  }

  async #recover(error: unknown): Promise<void> {
    if (error instanceof CursorMovedError && this.#state === 'running') {
      log.warn(`${error.message}; reloading it and grouping again`);
      try {
        this.#loaded = false;
        await this.#ensureLoaded();
        this.#regroup();
        await this.#commitReady();
        return;
      } catch (again) {
        error = again;
      }
    }
    await this.#failed(error);
  }

  async #failed(error: unknown): Promise<void> {
    if (this.#state !== 'running') {
      return;
    }
    let { realm, db, onFatal } = this.#options;
    if (
      error instanceof LeaseLostError ||
      error instanceof RecorderFatalError
    ) {
      this.#state = 'stopped';
      this.#discard();
      onFatal(error);
      return;
    }
    let reason = error instanceof Error ? error.message : String(error);
    log.error(`recording ${realm.url} stalled: ${reason}`, error);
    this.#state = 'stalled';
    this.#discard();
    try {
      // Only the lease holder marks the realm, so a task that has lost the
      // lease can't stall a realm another task records.
      await db.withTransaction(async (query) => {
        await this.#checkLease(query);
        await query([
          `UPDATE realm_history_state SET status = 'stalled', stalled_reason =`,
          param(reason.slice(0, 2000)),
          'WHERE realm_id =',
          param(realm.id),
        ]);
      });
    } catch (stallError) {
      this.#state = 'stopped';
      onFatal(
        stallError instanceof LeaseLostError
          ? stallError
          : new RecorderFatalError(
              `could not mark ${realm.url} stalled: ${String(stallError)}`,
              { cause: stallError },
            ),
      );
    }
  }

  // Locks the lease row of the realm's shard for the rest of the
  // transaction, and throws `LeaseLostError` unless this task holds it.
  async #checkLease(query: Querier): Promise<void> {
    let { realm, holder } = this.#options;
    let lease = await query([
      'SELECT 1 FROM realm_historian_leases WHERE shard =',
      param(String(realm.shard)),
      'AND holder =',
      param(holder),
      'AND expires_at > now() FOR SHARE',
    ]);
    if (lease.length === 0) {
      throw new LeaseLostError([realm.shard]);
    }
  }

  async #query(
    sql: string,
    bind: PgPrimitive[],
  ): Promise<Record<string, PgPrimitive>[]> {
    try {
      return await this.#options.db.execute(sql, { bind });
    } catch (error) {
      throw new RecorderFatalError(
        `a query recording ${this.#options.realm.url} failed: ${String(error)}`,
        { cause: error },
      );
    }
  }

  async #hook(step: RecorderStep): Promise<void> {
    let before = this.#options.testHooks?.before;
    if (!before) {
      return;
    }
    try {
      await before(step);
    } catch (error) {
      throw new RecorderFatalError(`stopped before ${step}: ${String(error)}`, {
        cause: error,
      });
    }
  }

  // Reads the realm's cursor and HEAD from Postgres, the tree of that HEAD
  // and the superseded paths of its recent revisions from the repo, then runs
  // the HEAD check, which catches up with revisions committed after the
  // cursor last moved.
  async #ensureLoaded(): Promise<void> {
    if (this.#loaded) {
      return;
    }
    let { realm } = this.#options;
    let rows = await this.#query(
      `SELECT cursor_xid::text AS cursor_xid, cursor_seq::text AS cursor_seq,
              head, status
       FROM realm_history_state WHERE realm_id = $1`,
      [realm.id],
    );
    if (rows.length === 0) {
      log.info(`${realm.url} no longer records history`);
      this.#state = 'stopped';
      this.#discard();
      return;
    }
    let [row] = rows;
    if (row.status === 'stalled') {
      log.warn(`${realm.url} is stalled, so it isn't recorded`);
      this.#state = 'stalled';
      this.#discard();
      return;
    }
    await initRepo(this.#gitDir);
    this.#cursor = {
      xid: row.cursor_xid as string,
      seq: Number(row.cursor_seq),
    };
    this.#advanceHandled(this.#cursor);
    this.#head = (row.head as string | null) ?? undefined;
    this.#tree = this.#head
      ? await HeadTree.load(this.#gitDir, this.#head)
      : HeadTree.empty();
    this.#superseded = new Map();
    if (this.#head) {
      await this.#learnSuperseded(
        await readRevisions(this.#gitDir, [
          '-n',
          String(SUPERSEDED_LOOKBACK),
          this.#head,
        ]),
      );
    }
    this.#loaded = true;
    await this.#syncWithRepo();
  }

  // Walks revisions, newest first as `readRevisions` lists them, from the
  // oldest: a revision that changes a path has recorded it, and one that
  // lists it as superseded joins the path's superseding revisions. Then asks
  // the journal which of those a group that changed nothing at the path has
  // settled with no revision to show for it: a revision is settled by an
  // event for the path after its own last event, and before the next
  // superseding revision's first event, or up to the cursor after the
  // newest. That forgets the revision and every older one for the path.
  async #learnSuperseded(revisions: RevisionRecord[]): Promise<void> {
    for (let revision of [...revisions].reverse()) {
      for (let path of revision.changedPaths) {
        this.#superseded.delete(path);
      }
      let range = parseJournalSeq(revision.trailers.journalSeq?.[0] ?? '');
      for (let path of revision.trailers.superseded ?? []) {
        this.#supersede(path, { revision: revision.id, range });
      }
    }
    // A revision with no range, or whose next one has none, can't be
    // bounded, and is kept.
    let wanted = [...this.#superseded].flatMap(([path, supersessions]) =>
      supersessions.flatMap(({ range }, ordinal) => {
        let next = supersessions[ordinal + 1];
        return range && (!next || next.range)
          ? [
              {
                path,
                ordinal,
                since_seq: range.last,
                until_seq: next?.range?.first ?? null,
              },
            ]
          : [];
      }),
    );
    if (wanted.length === 0) {
      return;
    }
    let rows = await this.#query(
      `SELECT DISTINCT wanted.path, wanted.ordinal
       FROM jsonb_to_recordset($2::jsonb)
         AS wanted(path text, ordinal int, since_seq bigint, until_seq bigint)
       JOIN realm_change_events since
         ON since.realm_id = $1 AND since.seq = wanted.since_seq
       LEFT JOIN realm_change_events bound
         ON bound.realm_id = $1 AND bound.seq = wanted.until_seq
       JOIN realm_change_event_paths paths
         ON paths.realm_id = $1 AND paths.path = wanted.path
       JOIN realm_change_events events ON events.seq = paths.seq
       WHERE (events.xid, events.seq) > (since.xid, since.seq)
         AND (events.xid, events.seq) <= ($3::xid8, $4::bigint)
         AND (wanted.until_seq IS NULL
              OR (events.xid, events.seq) < (bound.xid, bound.seq))`,
      [
        this.#options.realm.id,
        JSON.stringify(wanted),
        this.#cursor.xid,
        this.#cursor.seq,
      ],
    );
    let settledThrough = new Map<string, number>();
    for (let row of rows) {
      let path = row.path as string;
      settledThrough.set(
        path,
        Math.max(settledThrough.get(path) ?? -1, Number(row.ordinal)),
      );
    }
    for (let [path, ordinal] of settledThrough) {
      let remaining = this.#superseded.get(path)!.slice(ordinal + 1);
      if (remaining.length > 0) {
        this.#superseded.set(path, remaining);
      } else {
        this.#superseded.delete(path);
      }
    }
  }

  #advanceHandled(position: ReadPosition): void {
    if (comparePositions(position, this.#handled) > 0) {
      this.#handled = position;
    }
  }

  async #handleEvent(event: ChangeEvent): Promise<void> {
    let position = positionOf(event);
    if (comparePositions(position, this.#handled) <= 0) {
      return;
    }
    this.#handled = position;
    await this.#hook('capture');
    let captured = await this.#capture(event);
    this.#captured.push(captured);
    this.#group(captured);
    await this.#commitReady();
  }

  async #handleTick(at: number): Promise<void> {
    this.#clock = Math.max(this.#clock, at);
    this.#closeByClock();
    await this.#commitReady();
  }

  async #capture(event: ChangeEvent): Promise<CapturedEvent> {
    // A write can name one path twice, such as a batch that writes a path and
    // then deletes it. Its last change is what the write left.
    let last = new Map<string, ChangeEventChange>();
    for (let change of event.changes) {
      assertRealmPath(change.path);
      let unrecordable = unrecordableReason(change.path);
      if (unrecordable) {
        log.warn(
          `event ${event.seq} of ${this.#options.realm.url} changes ${JSON.stringify(change.path)}, which history can't hold: ${unrecordable}; leaving it out`,
        );
        continue;
      }
      last.set(change.path, change);
    }
    let changes = new Map<string, CapturedChange>();
    for (let change of last.values()) {
      changes.set(change.path, await this.#captureChange(change));
      this.#options.beat?.();
    }
    return { event, position: positionOf(event), changes };
  }

  async #captureChange(change: ChangeEventChange): Promise<CapturedChange> {
    let { path, status, contentHash, size, appended } = change;
    let capturedAt = Date.now();
    let appendedBytes = appended && status !== 'D' ? size : undefined;
    if (
      appendedBytes !== undefined &&
      appendedBytes > this.#sizeOnlyThreshold &&
      contentHash
    ) {
      let id = await writeSizeOnlyEntry(this.#store, {
        size: appendedBytes,
        fingerprint: contentHash,
      });
      return {
        path,
        status,
        entry: { mode: TREE_MODE, id },
        fingerprint: contentHash,
        size: appendedBytes,
        matched: true,
        capturedAt,
      };
    }
    let bytes = await readRealmFile(
      join(this.#options.realm.directory, path),
      appendedBytes,
    );
    if (bytes === null) {
      return { path, status, entry: null, matched: status === 'D', capturedAt };
    }
    let fingerprint = computeContentHash(bytes);
    let { id } = await this.#store.writeBlob(bytes);
    return {
      path,
      status,
      entry: { mode: BLOB_MODE, id },
      fingerprint,
      size: bytes.byteLength,
      matched:
        status !== 'D' &&
        (contentHash === undefined || contentHash === fingerprint),
      capturedAt,
    };
  }

  #group(captured: CapturedEvent): void {
    let decision = decide(this.#open?.state, captured.event, this.#limits);
    if (decision.closeBefore) {
      this.#closeOpen(decision.closeBefore);
    }
    let group = this.#open ?? { state: decision.group, events: [] };
    group.state = decision.group;
    group.events.push(captured);
    this.#open = group;
    if (decision.closeAfter) {
      this.#closeOpen(decision.closeAfter);
    }
  }

  #closeOpen(reason: CloseReason): void {
    if (this.#open) {
      this.#open.closedBy = reason;
      this.#closed.push(this.#open);
      this.#open = undefined;
    }
  }

  #closeByClock(): void {
    if (this.#open) {
      let reason = closedByClock(this.#open.state, this.#clock, this.#limits);
      if (reason) {
        this.#closeOpen(reason);
      }
    }
  }

  // Groups the captured events after the cursor again, from scratch: after
  // the HEAD check has moved the cursor past events another writer recorded.
  // The captures stay as they were.
  #regroup(): void {
    this.#captured = this.#captured.filter(
      (captured) => comparePositions(captured.position, this.#cursor) > 0,
    );
    this.#open = undefined;
    this.#closed = [];
    for (let captured of this.#captured) {
      this.#group(captured);
    }
    this.#closeByClock();
  }

  async #commitReady(): Promise<void> {
    while (this.#closed.length > 0 && this.#state === 'running') {
      if ((await this.#commitGroup(this.#closed[0])) === 'waiting') {
        return;
      }
    }
  }

  async #commitGroup(group: Group): Promise<CommitOutcome> {
    let finals = finalChanges(group);
    let events = group.events.map((captured) => captured.event);
    let first = events[0];
    let lastPosition = group.events[group.events.length - 1].position;

    // Settle every path whose capture didn't match its write.
    let superseded = new Set<string>();
    let unattributed: Final[] = [];
    let mismatched = [...finals.values()].filter(
      (final) => !final.change.matched,
    );
    if (mismatched.length > 0) {
      let newer = await this.#withNewerEvents(mismatched);
      let waiting = mismatched.filter((final) => !newer.has(final.change.path));
      if (waiting.length > 0) {
        let until = Math.max(
          ...waiting.map(
            (final) => timeOf(final.captured.event) + this.#limits.maxAgeMs,
          ),
        );
        if (this.#clock < until) {
          return 'waiting';
        }
        unattributed = waiting;
      }
      for (let final of mismatched) {
        superseded.add(final.change.path);
      }
    }

    await this.#hook('commit');
    if (await this.#syncWithRepo()) {
      this.#regroup();
      return 'regrouped';
    }

    if (first.intent && first.intent.kind !== 'revert') {
      // A scan asks for a sweep and a realm deletion for the repo's removal,
      // neither of which the recorder does: the cursor moves past the event
      // and nothing is recorded.
      log.warn(
        `event ${first.seq} for ${this.#options.realm.url} asks for a ${first.intent.kind}, which the recorder doesn't perform; moving past it`,
      );
      await this.#hook('cursor');
      await this.#persist({ cursor: lastPosition, head: this.#head });
      this.#settleSuperseded(finals.keys());
      this.#finish(group);
      return 'committed';
    }

    let changes = new Map<string, FileEntry | null>();
    let upserts: PathState[] = [];
    let deletes: string[] = [];
    for (let [path, { change }] of finals) {
      if (superseded.has(path)) {
        continue;
      }
      changes.set(path, change.entry);
      if (change.entry) {
        upserts.push({
          path,
          contentHash: change.fingerprint!,
          size: change.size!,
          objectId: change.entry.id,
        });
      } else {
        deletes.push(path);
      }
    }
    let tree = await this.#tree.apply(this.#store, changes);
    let net = netChanges(this.#tree, tree, changes.keys());

    if (net.length === 0 && superseded.size === 0) {
      await this.#hook('cursor');
      await this.#persist({
        cursor: lastPosition,
        head: this.#head,
        upserts,
        deletes,
      });
      this.#settleSuperseded(finals.keys());
      this.#finish(group);
      log.debug(
        `events ${rangeOf(events)} of ${this.#options.realm.url} change nothing at HEAD; recorded no revision`,
      );
      return 'committed';
    }

    let includes = this.#includesSuperseded(net.map(({ path }) => path));
    let supersededPaths = [...superseded].sort();
    let subject: RevisionSubject =
      first.intent?.kind === 'revert'
        ? {
            kind: 'revert',
            path: first.intent.path,
            revision: first.intent.revision,
          }
        : {
            kind: 'changes',
            changes: [
              ...net,
              ...supersededPaths.map((path) => ({
                path,
                status: finals.get(path)!.change.status,
              })),
            ].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
          };
    let message = buildMessage(
      revisionMessage({
        subject,
        writeCount: events.length,
        contentNotKept: net.length === 0,
      }),
      revisionTrailers(group, supersededPaths, includes),
    );
    let commit = await this.#writeRevision(
      tree,
      authorIdentity(first.author, new Date(group.state.latestAt)),
      message,
    );
    if (!(await this.#moveHead(commit))) {
      this.#regroup();
      return 'regrouped';
    }
    await this.#hook('cursor');
    try {
      await this.#persist({
        cursor: lastPosition,
        head: commit,
        upserts,
        deletes,
      });
    } finally {
      // HEAD names the commit whether or not the cursor moved with it.
      this.#head = commit;
      this.#tree = tree;
    }
    this.#settleSuperseded(
      [...finals.keys()].filter((path) => !superseded.has(path)),
    );
    for (let path of supersededPaths) {
      this.#supersede(path, {
        revision: commit,
        range: { first: first.seq, last: lastPosition.seq },
      });
    }
    this.#finish(group);
    log.info(
      `recorded ${commit} for ${this.#options.realm.url}: events ${rangeOf(events)}, ${events.length} write(s) by ${first.author} on ${first.channel}, ${net.length} path(s) changed${supersededPaths.length > 0 ? `, ${supersededPaths.length} superseded` : ''}, closed by ${group.closedBy ?? 'unknown'}`,
    );
    if (unattributed.length > 0) {
      // The cursor has moved past the group already, so a crash or a lost
      // lease before this revision commits loses it: neither the journal
      // nor the repo says it was due. The paths stay superseded by the
      // revision above, and the bytes on disk go unrecorded.
      await this.#recordUnattributed(unattributed);
    }
    return 'committed';
  }

  // The cursor has moved past events for `paths`, so whatever superseded an
  // earlier write to them has been recorded, or changed nothing.
  #settleSuperseded(paths: Iterable<string>): void {
    for (let path of paths) {
      this.#superseded.delete(path);
    }
  }

  // `supersession` left `path` out, after any earlier revision that did and
  // that nothing has settled since.
  #supersede(path: string, supersession: Supersession): void {
    let supersessions = this.#superseded.get(path);
    if (supersessions) {
      supersessions.push(supersession);
    } else {
      this.#superseded.set(path, [supersession]);
    }
  }

  // Every revision that superseded `path` since it was last recorded, newest
  // first.
  #supersedingRevisions(path: string): string[] {
    return (this.#superseded.get(path) ?? [])
      .map(({ revision }) => revision)
      .reverse();
  }

  // The `Boxel-Includes-Superseded` values of a revision that records
  // `paths`: for each path in turn, its superseding revisions newest first.
  #includesSuperseded(paths: string[]): string[] {
    return paths.flatMap((path) =>
      this.#supersedingRevisions(path).map((revision) =>
        formatIncludesSuperseded({ revision, path }),
      ),
    );
  }

  // The paths among `finals` that an event after the one that made the
  // change has changed since: an event in hand, or one in the journal, which
  // holds events the consumer hasn't reached, such as those above the
  // visibility horizon.
  async #withNewerEvents(finals: Final[]): Promise<Set<string>> {
    let newer = new Set<string>();
    let unknown: Final[] = [];
    for (let final of finals) {
      let { path } = final.change;
      let inHand = this.#captured.some(
        (captured) =>
          comparePositions(captured.position, final.captured.position) > 0 &&
          captured.changes.has(path),
      );
      if (inHand) {
        newer.add(path);
      } else {
        unknown.push(final);
      }
    }
    if (unknown.length > 0) {
      let rows = await this.#query(
        `SELECT DISTINCT wanted.path
         FROM jsonb_to_recordset($2::jsonb)
           AS wanted(path text, xid text, seq bigint)
         JOIN realm_change_event_paths paths
           ON paths.realm_id = $1 AND paths.path = wanted.path
         JOIN realm_change_events events ON events.seq = paths.seq
         WHERE (events.xid, events.seq) > (wanted.xid::xid8, wanted.seq)`,
        [
          this.#options.realm.id,
          JSON.stringify(
            unknown.map(({ change, captured }) => ({
              path: change.path,
              xid: captured.position.xid,
              seq: captured.position.seq,
            })),
          ),
        ],
      );
      for (let row of rows) {
        newer.add(row.path as string);
      }
    }
    return newer;
  }

  // Records the bytes found on disk for paths whose write was replaced by
  // something no event explains, as `Unattributed changes` by
  // `boxel-system`, naming every revision that left them out since they were
  // last recorded: the one just committed, then any earlier ones. They are
  // read before the HEAD check, which can change what the recorder
  // remembers.
  async #recordUnattributed(finals: Final[]): Promise<void> {
    let { realm } = this.#options;
    let named = new Map(
      finals.map(({ change }) => [
        change.path,
        this.#supersedingRevisions(change.path),
      ]),
    );
    if (await this.#syncWithRepo()) {
      this.#regroup();
    }
    let changes = new Map<string, FileEntry | null>();
    let upserts: PathState[] = [];
    let deletes: string[] = [];
    for (let { change } of finals) {
      changes.set(change.path, change.entry);
      if (change.entry) {
        upserts.push({
          path: change.path,
          contentHash: change.fingerprint!,
          size: change.size!,
          objectId: change.entry.id,
        });
      } else {
        deletes.push(change.path);
      }
    }
    let tree = await this.#tree.apply(this.#store, changes);
    let net = netChanges(this.#tree, tree, changes.keys());
    if (net.length === 0) {
      log.info(
        `the disk content of ${finals.length} path(s) in ${realm.url} that no event explains equals HEAD; recorded no unattributed revision`,
      );
      return;
    }
    let message = buildMessage(
      revisionMessage({ subject: { kind: 'unattributed' }, writeCount: 0 }),
      {
        channel: ['system'],
        writeCount: ['0'],
        includesSuperseded: net.flatMap(({ path }) =>
          (named.get(path) ?? []).map((revision) =>
            formatIncludesSuperseded({ revision, path }),
          ),
        ),
      },
    );
    let at = Math.max(...finals.map(({ change }) => change.capturedAt));
    let commit = await this.#writeRevision(
      tree,
      authorIdentity(SYSTEM_AUTHOR, new Date(at)),
      message,
    );
    if (!(await this.#moveHead(commit))) {
      log.warn(
        `HEAD of ${realm.url} moved before its unattributed revision committed; the disk content of ${net.length} path(s) goes unrecorded`,
      );
      this.#regroup();
      return;
    }
    await this.#hook('cursor');
    try {
      await this.#persist({
        cursor: this.#cursor,
        head: commit,
        upserts,
        deletes,
      });
    } finally {
      this.#head = commit;
      this.#tree = tree;
    }
    this.#settleSuperseded(net.map(({ path }) => path));
    log.info(
      `recorded ${commit} for ${realm.url}: unattributed changes to ${net.length} path(s), superseding writes in ${[...new Set([...named.values()].flat())].join(', ')}`,
    );
  }

  async #writeRevision(
    tree: HeadTree,
    author: Identity,
    message: string,
  ): Promise<string> {
    if (tree.root === EMPTY_TREE_ID) {
      await this.#store.writeTree([]);
    }
    let { id } = await this.#store.writeCommit({
      tree: tree.root,
      parents: this.#head ? [this.#head] : [],
      author,
      committer: committerIdentity(new Date()),
      message,
    });
    return id;
  }

  // Moves HEAD to `commit` from the HEAD this recorder knows. False when
  // another writer moved HEAD first: the HEAD check has then caught up with
  // it, and the events after the new cursor need grouping again.
  async #moveHead(commit: string): Promise<boolean> {
    await this.#hook('update-ref');
    try {
      await updateMain(this.#gitDir, commit, this.#head);
      return true;
    } catch (error) {
      if (await this.#syncWithRepo()) {
        return false;
      }
      throw error;
    }
  }

  // The HEAD check. When `refs/heads/main` is no longer the HEAD this
  // recorder committed or read, reads the revisions after it, moves the
  // cursor past the furthest event their `Boxel-Journal-Seq` trailers
  // cover, and brings the tree and path state up to the new HEAD. Returns
  // whether HEAD had moved.
  async #syncWithRepo(): Promise<boolean> {
    let { realm } = this.#options;
    let actual = await readMain(this.#gitDir);
    if (actual === this.#head) {
      return false;
    }
    if (!actual) {
      throw new Error(
        `the repo of ${realm.url} has no ${MAIN_REF}, though ${this.#head} was recorded`,
      );
    }
    let revisions = await readRevisions(
      this.#gitDir,
      this.#head ? [`${this.#head}..${actual}`] : [actual],
    );
    let lastSeqs = new Set<number>();
    for (let revision of revisions) {
      for (let value of revision.trailers.journalSeq ?? []) {
        let range = parseJournalSeq(value);
        if (range) {
          lastSeqs.add(range.last);
        }
      }
    }
    let cursor = this.#cursor;
    if (lastSeqs.size > 0) {
      let rows = await this.#query(
        `SELECT xid::text AS xid, seq::text AS seq FROM realm_change_events
         WHERE realm_id = $1 AND seq = ANY($2::bigint[])
         ORDER BY xid DESC, seq DESC LIMIT 1`,
        [realm.id, [...lastSeqs].map(String)],
      );
      if (rows.length === 0) {
        throw new Error(
          `the journal no longer holds the events that revisions ${revisions.map((revision) => revision.id).join(', ')} of ${realm.url} cover`,
        );
      }
      let furthest = { xid: rows[0].xid as string, seq: Number(rows[0].seq) };
      if (comparePositions(furthest, cursor) > 0) {
        cursor = furthest;
      }
    }
    let tree = await HeadTree.load(this.#gitDir, actual);
    let { upserts, deletes } = await this.#pathStateBetween(this.#tree, tree);
    await this.#hook('cursor');
    await this.#persist({ cursor, head: actual, upserts, deletes });
    log.info(
      `HEAD of ${realm.url} moved from ${this.#head ?? 'no revision'} to ${actual} under its recorder; ${revisions.length} revision(s) read, cursor at seq ${cursor.seq}`,
    );
    this.#head = actual;
    this.#tree = tree;
    await this.#learnSuperseded(revisions);
    return true;
  }

  async #pathStateBetween(
    before: HeadTree,
    after: HeadTree,
  ): Promise<{ upserts: PathState[]; deletes: string[] }> {
    let upserts: PathState[] = [];
    let deletes: string[] = [];
    for (let [path, entry] of after.files) {
      let previous = before.entry(path);
      if (previous?.id === entry.id && previous.mode === entry.mode) {
        continue;
      }
      upserts.push(await this.#pathStateOf(after, path, entry));
    }
    for (let path of before.files.keys()) {
      if (!after.entry(path)) {
        deletes.push(path);
      }
    }
    return { upserts, deletes };
  }

  async #pathStateOf(
    tree: HeadTree,
    path: string,
    entry: FileEntry,
  ): Promise<PathState> {
    if (entry.mode === TREE_MODE) {
      let marker = tree.marker(path);
      let sizeOnly = marker
        ? parseSizeOnlyMarker(
            await runGit(this.#gitDir, ['cat-file', 'blob', marker]),
          )
        : undefined;
      if (!sizeOnly) {
        throw new Error(
          `${path} at HEAD is neither a file nor a size-only entry`,
        );
      }
      return {
        path,
        contentHash: sizeOnly.fingerprint,
        size: sizeOnly.size,
        objectId: entry.id,
      };
    }
    let bytes = await runGit(this.#gitDir, ['cat-file', 'blob', entry.id]);
    return {
      path,
      contentHash: computeContentHash(bytes),
      size: bytes.byteLength,
      objectId: entry.id,
    };
  }

  // Moves the cursor, HEAD and path state in one transaction, after checking
  // that this task still holds the realm's shard. The cursor moves only from
  // the one this recorder holds, so a cursor someone else moved is caught
  // rather than overwritten.
  async #persist({
    cursor,
    head,
    upserts = [],
    deletes = [],
  }: {
    cursor: ReadPosition;
    head: string | undefined;
    upserts?: PathState[];
    deletes?: string[];
  }): Promise<void> {
    let { db, realm } = this.#options;
    let previous = this.#cursor;
    try {
      await db.withTransaction(async (query) => {
        await this.#checkLease(query);
        let updated = await query([
          'UPDATE realm_history_state SET cursor_xid =',
          param(cursor.xid),
          '::xid8, cursor_seq =',
          param(cursor.seq),
          ', head =',
          param(head ?? null),
          ', recorded_at = now() WHERE realm_id =',
          param(realm.id),
          'AND cursor_xid =',
          param(previous.xid),
          '::xid8 AND cursor_seq =',
          param(previous.seq),
          'RETURNING realm_id',
        ]);
        if (updated.length === 0) {
          throw new CursorMovedError(realm.url);
        }
        if (deletes.length > 0) {
          await query([
            'DELETE FROM realm_history_path_state WHERE realm_id =',
            param(realm.id),
            'AND path IN (SELECT jsonb_array_elements_text(',
            param(JSON.stringify(deletes)),
            '::jsonb))',
          ]);
        }
        if (upserts.length > 0) {
          await query([
            'INSERT INTO realm_history_path_state',
            '(realm_id, path, content_hash, size, object_id) SELECT',
            param(realm.id),
            '::uuid, state.path, state.content_hash, state.size, state.object_id',
            'FROM jsonb_to_recordset(',
            param(
              JSON.stringify(
                upserts.map((state) => ({
                  path: state.path,
                  content_hash: state.contentHash,
                  size: state.size,
                  object_id: state.objectId,
                })),
              ),
            ),
            '::jsonb) AS state(path text, content_hash text, size bigint, object_id text)',
            'ON CONFLICT (realm_id, path) DO UPDATE SET',
            'content_hash = EXCLUDED.content_hash, size = EXCLUDED.size,',
            'object_id = EXCLUDED.object_id',
          ]);
        }
      });
    } catch (error) {
      if (
        error instanceof LeaseLostError ||
        error instanceof CursorMovedError
      ) {
        throw error;
      }
      throw new RecorderFatalError(
        `recording the cursor of ${realm.url} failed: ${String(error)}`,
        { cause: error },
      );
    }
    this.#cursor = cursor;
    this.#advanceHandled(cursor);
  }

  // A group's revision has committed, or its events changed nothing.
  #finish(group: Group): void {
    if (this.#closed[0] === group) {
      this.#closed.shift();
    }
    let covered = new Set(group.events);
    this.#captured = this.#captured.filter(
      (captured) => !covered.has(captured),
    );
  }
}

function positionOf(event: ChangeEvent): ReadPosition {
  return { xid: event.xid, seq: event.seq };
}

function timeOf(event: ChangeEvent): number {
  return Date.parse(event.occurredAt);
}

function rangeOf(events: ChangeEvent[]): string {
  return formatJournalSeq({
    first: events[0].seq,
    last: events[events.length - 1].seq,
  });
}

function finalChanges(group: Group): Map<string, Final> {
  let finals = new Map<string, Final>();
  for (let captured of group.events) {
    for (let change of captured.changes.values()) {
      finals.set(change.path, { change, captured });
    }
  }
  return finals;
}

// How each of `paths` differs between two trees: added, modified or
// deleted, leaving out the paths that are the same in both.
function netChanges(
  before: HeadTree,
  after: HeadTree,
  paths: Iterable<string>,
): { path: string; status: ChangeStatus }[] {
  let changes: { path: string; status: ChangeStatus }[] = [];
  for (let path of paths) {
    let previous = before.entry(path);
    let next = after.entry(path);
    if (!previous && next) {
      changes.push({ path, status: 'A' });
    } else if (previous && !next) {
      changes.push({ path, status: 'D' });
    } else if (
      previous &&
      next &&
      (previous.id !== next.id || previous.mode !== next.mode)
    ) {
      changes.push({ path, status: 'M' });
    }
  }
  return changes;
}

function revisionTrailers(
  group: Group,
  superseded: string[],
  includes: string[],
): Trailers {
  let events = group.events.map((captured) => captured.event);
  let [first] = events;
  let distinct = (values: (string | undefined)[]): string[] => [
    ...new Set(values.filter((value): value is string => Boolean(value))),
  ];
  let trailers: Trailers = { channel: [first.channel] };
  let operationIds = distinct(events.map((event) => event.operationId));
  if (operationIds.length > 0) {
    trailers.operationIds = operationIds;
  }
  let correlationIds = distinct(events.map((event) => event.correlationId));
  if (correlationIds.length > 0) {
    trailers.correlationIds = correlationIds;
  }
  if (first.agent) {
    trailers.agent = [first.agent];
  }
  if (first.room) {
    trailers.room = [first.room];
  }
  trailers.writeCount = [String(events.length)];
  if (events.length > 1) {
    trailers.firstWriteAt = [new Date(group.state.earliestAt).toISOString()];
  }
  if (first.pushId) {
    trailers.pushId = [first.pushId];
  }
  if (first.intent?.kind === 'revert') {
    trailers.revertOf = [first.intent.revision];
    trailers.revertForced = [String(first.intent.forced)];
  }
  if (events.some((event) => event.partial)) {
    trailers.partial = ['true'];
  }
  if (superseded.length > 0) {
    trailers.superseded = superseded;
  }
  if (includes.length > 0) {
    trailers.includesSuperseded = includes;
  }
  trailers.journalSeq = [rangeOf(events)];
  return trailers;
}

// A change event's path is relative to the realm, so it never climbs out of
// the realm directory: no empty, `.` or `..` segment, and no NUL.
function assertRealmPath(path: string): void {
  let segments = path.split('/');
  if (
    path === '' ||
    path.includes('\0') ||
    segments.some(
      (segment) => segment === '' || segment === '.' || segment === '..',
    )
  ) {
    throw new Error(
      `a change event names the invalid path ${JSON.stringify(path)}`,
    );
  }
}

// Why history can't hold a realm path, or undefined when it can: a segment
// git reads as `.git`, a segment size-only entries reserve, or a line break,
// which would split the message lines the path appears in.
function unrecordableReason(path: string): string | undefined {
  if (path.includes('\n')) {
    return 'it has a line break';
  }
  for (let segment of path.split('/')) {
    if (isDotGitName(segment)) {
      return `git refuses the name ${JSON.stringify(segment)}`;
    }
    if (segment === SIZE_ONLY_MARKER_NAME) {
      return `size-only entries reserve the name ${SIZE_ONLY_MARKER_NAME}`;
    }
  }
  return undefined;
}

// The file's bytes, or only its first `limit` bytes, or null when no regular
// file is at the path: nothing, a directory, a symlink, which is not
// followed, or a special file, which is not read.
async function readRealmFile(
  path: string,
  limit?: number,
): Promise<Uint8Array | null> {
  let handle;
  try {
    // Non-blocking, so opening a FIFO doesn't wait for a writer.
    handle = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  } catch (error: any) {
    if (['ENOENT', 'ENOTDIR', 'EISDIR', 'ELOOP'].includes(error?.code)) {
      return null;
    }
    throw error;
  }
  try {
    if (!(await handle.stat()).isFile()) {
      return null;
    }
    if (limit === undefined) {
      return await handle.readFile();
    }
    let buffer = Buffer.alloc(limit);
    let filled = 0;
    while (filled < limit) {
      let { bytesRead } = await handle.read(
        buffer,
        filled,
        limit - filled,
        filled,
      );
      if (bytesRead === 0) {
        break;
      }
      filled += bytesRead;
    }
    return buffer.subarray(0, filled);
  } finally {
    await handle.close();
  }
}
