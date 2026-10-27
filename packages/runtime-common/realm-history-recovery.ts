import { logger } from './log.ts';
import type { DBAdapter } from './db.ts';
import type { LocalPath } from './paths.ts';
import { isHistoryPath, isPartialWritePath } from './paths.ts';
import {
  gitBlobId,
  newOperationId,
  type HistoryChange,
  type RealmHistoryRecorder,
  type RevisionKind,
  type WriteRecording,
} from './realm-history.ts';
import {
  claimRecoveryLease,
  realmHistoryState,
  recoveryLeased,
  releaseRecoveryLease,
  setRealmReadOnly,
  setRealmRecording,
} from './db-queries/realm-history-state-queries.ts';
import {
  emitRealmRecovery,
  type RealmRecoveryEvent,
} from './card-operations/telemetry.ts';

// ============================================================================
// Realm recovery: bringing a realm that records history back to agreement
// with it.
//
// History is the realm's truth and disk is a materialization of HEAD, so
// after a crash, a lost answer from history, or an edit made to disk directly,
// recovery leaves the realm in one of three states:
//
//   - disk matches HEAD, and every revision has been indexed and announced;
//   - what disk held that no revision explained has been recorded as a system
//     revision — drift, or a gap left while the realm did not record; or
//   - the realm is read-only: it serves reads and refuses writes until an
//     operator clears it (see docs/realm-history-recovery-runbook.md).
//
// It runs in order:
//
//   1. Pending writes — those journaled before they asked history to record,
//      whose answer never came back — are settled by asking history for their
//      outcome. Asking fences each one, so an absent write can never commit
//      late.
//   2. Revisions recorded but not all on disk, or never indexed, are
//      completed: their paths are brought to what HEAD holds, under those
//      paths' write locks, through the realm's own commit, which announces
//      and indexes them.
//   3. Disk is compared with HEAD. What still differs is recorded as one
//      revision — a gap when the realm last ran without recording, drift
//      otherwise — after a second look under the paths' write locks, so a file
//      a peer has just written is never mistaken for one written out of band.
//
// Any failure leaves the realm read-only, and the mount it runs in goes on.
// ============================================================================

// How long a pending write is left to finish before recovery asks history for
// its outcome. Asking fences the operation, so asking about a write still in
// flight would abort it. A write's calls to history give up well inside this.
export const PENDING_GRACE_MS = 5 * 60 * 1000;

// How long a recovery lease lasts. A replica that dies holding one stops
// excluding the others when it lapses.
const LEASE_MS = 10 * 60 * 1000;

// How long a replica mounting a realm another replica is recovering waits for
// it, before mounting anyway. Writes to anything recovery has yet to bring up
// to HEAD wait for it either way.
const LEASE_WAIT_MS = 60 * 1000;

// The most paths one drift or gap revision takes, which bounds the file locks
// held while it is recorded. A realm with more changes is taken in over
// several revisions that share a `Boxel-Recovery-Id` trailer.
const MAX_PATHS_PER_REVISION = 2000;

export const DRIFT_MESSAGE = 'Unattributed external changes';
export const GAP_MESSAGE = 'Unrecorded changes (recording was disabled)';

export type RecoveryTrigger = RealmRecoveryEvent['trigger'];

// What recovery needs of the realm it recovers.
export interface RecoveryHost {
  url: string;
  history: RealmHistoryRecorder;
  dbAdapter: DBAdapter;
  // Every file in the realm directory a revision could hold, with its bytes.
  listFiles(): AsyncIterable<LocalPath>;
  readFile(path: LocalPath): Promise<Uint8Array | undefined>;
  withFileWriteLocks<T>(
    paths: LocalPath[],
    fn: (releaseLocks: () => void) => Promise<T>,
  ): Promise<T>;
  // Bring `paths` to `contents` (absent meaning removed) through the realm's
  // commit, announcing and indexing every one of them, and stamp `revisions`
  // materialized and post-committed. Called holding the paths' locks.
  applyRevisions(
    contents: Map<LocalPath, Uint8Array | undefined>,
    revisions: string[],
    releaseLocks: () => void,
  ): Promise<void>;
  // A system revision's author: the realm's own matrix user.
  systemRecording(): WriteRecording;
  reportError(message: string, err: unknown): void;
}

export interface RecoveryResult {
  outcome: RealmRecoveryEvent['outcome'];
  event: RealmRecoveryEvent;
}

export async function recoverRealmHistory(
  host: RecoveryHost,
  trigger: RecoveryTrigger,
  opts: { leaseOwner: string },
): Promise<RecoveryResult> {
  let log = logger('realm:history-recovery');
  let started = Date.now();
  let owner = opts.leaseOwner;
  let event: RealmRecoveryEvent = {
    kind: 'realm-recovery',
    realmURL: host.url,
    trigger,
    outcome: 'clean',
    resolvedCommitted: 0,
    resolvedAborted: 0,
    caughtUpRevisions: 0,
    caughtUpPaths: 0,
    driftPaths: 0,
    driftRevisions: [],
    gapPaths: 0,
    gapRevisions: [],
    fileCount: null,
    bytesHashed: null,
    scanMs: null,
    treeMs: null,
    totalMs: 0,
    error: null,
  };
  let finish = (outcome: RealmRecoveryEvent['outcome']) => {
    event.outcome = outcome;
    event.totalMs = Date.now() - started;
    emitRealmRecovery(event);
    return { outcome, event };
  };

  if (!(await claimRecoveryLease(host.dbAdapter, host.url, owner, LEASE_MS))) {
    if (trigger === 'mount') {
      // Another replica is recovering the realm. Waiting for it keeps this
      // replica from serving disk it is about to change.
      let deadline = Date.now() + LEASE_WAIT_MS;
      while (
        Date.now() < deadline &&
        (await recoveryLeased(host.dbAdapter, host.url))
      ) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    return finish('leased');
  }

  let outcome: RealmRecoveryEvent['outcome'] = 'clean';
  try {
    let state = await realmHistoryState(host.dbAdapter, host.url);

    // 1. Pending writes.
    for (let operationId of await host.history.pendingOperations(
      new Date(Date.now() - PENDING_GRACE_MS),
    )) {
      if (await host.history.resolvePending(operationId)) {
        event.resolvedCommitted++;
      } else {
        event.resolvedAborted++;
      }
    }

    // 2. Revisions not complete.
    let incomplete = await host.history.incompleteRevisions();
    if (incomplete.length > 0) {
      let paths = [
        ...new Set(incomplete.flatMap(({ paths }) => paths)),
      ] as LocalPath[];
      let revisions = incomplete.map(({ revision }) => revision);
      await host.withFileWriteLocks(paths, async (releaseLocks) => {
        // Read under the locks, so no write to these paths can land between
        // reading HEAD and bringing disk to it. HEAD rather than each revision
        // in turn: it is the newest state of every one of these paths, so no
        // write that landed after the one being completed is rolled back.
        let head = await host.history.head();
        let contents = await host.history.read(head, paths);
        await host.applyRevisions(
          contents as Map<LocalPath, Uint8Array | undefined>,
          revisions,
          releaseLocks,
        );
      });
      event.caughtUpRevisions = revisions.length;
      event.caughtUpPaths = paths.length;
      outcome = 'recovered';
      log.info(
        `${host.url}: completed ${revisions.length} revision(s) across ${paths.length} path(s)`,
      );
    }

    // 3. Disk against HEAD.
    let kind: RevisionKind = state?.recording ? 'drift' : 'gap';
    let differing = await scan(host, event);
    if (differing.length > 0) {
      let recorded = await recordDifferences(host, differing, kind);
      if (recorded.revisions.length > 0) {
        outcome = 'recovered';
        if (kind === 'gap') {
          event.gapPaths = recorded.paths;
          event.gapRevisions = recorded.revisions;
        } else {
          event.driftPaths = recorded.paths;
          event.driftRevisions = recorded.revisions;
          // Unsupported: an edit made to disk directly. Raised so whoever made
          // it hears that it was taken in, under the realm's own name.
          host.reportError(
            `${host.url} had ${recorded.paths} file(s) changed outside the realm, recorded as ${recorded.revisions.join(', ')}`,
            undefined,
          );
        }
      }
    }
    if (!state?.recording) {
      await setRealmRecording(host.dbAdapter, host.url, true);
    }
  } catch (err: unknown) {
    outcome = 'read-only';
    event.error = describe(err);
    try {
      await setRealmReadOnly(
        host.dbAdapter,
        host.url,
        'recovery-failed',
        event.error,
      );
    } catch (sealErr: unknown) {
      log.error(
        `${host.url}: could not seal the realm read-only after recovery failed: ${describe(sealErr)}`,
      );
    }
    host.reportError(
      `${host.url} could not recover from its history, and refuses writes until an operator clears it: ${event.error}`,
      err,
    );
  } finally {
    try {
      await releaseRecoveryLease(host.dbAdapter, host.url, owner, outcome);
    } catch (err: unknown) {
      // It lapses on its own.
      log.warn(
        `${host.url}: could not release the recovery lease: ${describe(err)}`,
      );
    }
  }
  return finish(outcome);
}

// Every path where disk and HEAD disagree, found by comparing each file's git
// blob id with HEAD's tree, so nothing is read out of history.
async function scan(
  host: RecoveryHost,
  event: RealmRecoveryEvent,
): Promise<LocalPath[]> {
  let head = await host.history.head();
  let treeStarted = Date.now();
  let tree = new Map(
    (await host.history.tree(head)).map(({ path, blob }) => [path, blob]),
  );
  event.treeMs = Date.now() - treeStarted;
  let scanStarted = Date.now();
  let differing: LocalPath[] = [];
  let seen = new Set<string>();
  let fileCount = 0;
  let bytesHashed = 0;
  for await (let path of host.listFiles()) {
    let bytes = await host.readFile(path);
    if (!bytes) {
      continue;
    }
    fileCount++;
    bytesHashed += bytes.byteLength;
    seen.add(path);
    let blob = tree.get(path);
    if (blob === undefined || blob !== (await gitBlobId(bytes))) {
      differing.push(path);
    }
  }
  for (let path of tree.keys()) {
    if (!seen.has(path)) {
      differing.push(path as LocalPath);
    }
  }
  event.fileCount = fileCount;
  event.bytesHashed = bytesHashed;
  event.scanMs = Date.now() - scanStarted;
  return differing;
}

// Record what disk holds at `differing` as system revisions of `kind`, each
// path looked at again under its write lock first. A path that agrees with
// HEAD by then — a peer's write just landed there, and the first look saw a
// stale listing — is left out.
async function recordDifferences(
  host: RecoveryHost,
  differing: LocalPath[],
  kind: RevisionKind,
): Promise<{ revisions: string[]; paths: number }> {
  let recoveryId = newOperationId();
  let revisions: string[] = [];
  let recordedPaths = 0;
  // Bounded by path count; a chunk whose bytes are over what one revision
  // takes is refused by `record`, which fails recovery.
  let chunks: LocalPath[][] = [];
  for (let i = 0; i < differing.length; i += MAX_PATHS_PER_REVISION) {
    chunks.push(differing.slice(i, i + MAX_PATHS_PER_REVISION));
  }
  for (let chunk of chunks) {
    let paths = chunk;
    await host.withFileWriteLocks(paths, async (releaseLocks) => {
      let head = await host.history.head();
      let atHead = await host.history.read(head, paths);
      let changes: {
        change: HistoryChange;
        verb: 'Create' | 'Update' | 'Delete';
      }[] = [];
      let contents = new Map<LocalPath, Uint8Array | undefined>();
      for (let path of paths) {
        let onDisk = await host.readFile(path);
        let inHead = atHead.get(path);
        if (sameBytes(onDisk, inHead)) {
          continue;
        }
        contents.set(path, onDisk);
        changes.push(
          onDisk
            ? {
                change: { path, content: onDisk },
                verb: inHead ? 'Update' : 'Create',
              }
            : { change: { path, delete: true }, verb: 'Delete' },
        );
      }
      if (changes.length === 0) {
        releaseLocks();
        return;
      }
      let recording = host.systemRecording();
      let revision = await host.history.record(recording, changes, {
        kind,
        message: recoveryMessage(kind, changes),
        ...(chunks.length > 1
          ? { trailers: [{ key: 'Boxel-Recovery-Id', value: recoveryId }] }
          : {}),
      });
      revisions.push(revision);
      recordedPaths += changes.length;
      // Disk already holds these bytes. What is left is what a write does
      // after them: announcing them, their metadata rows, and indexing.
      await host.applyRevisions(contents, [revision], releaseLocks);
    });
  }
  return { revisions, paths: recordedPaths };
}

function recoveryMessage(
  kind: RevisionKind,
  changes: { change: HistoryChange; verb: 'Create' | 'Update' | 'Delete' }[],
): string {
  return [
    kind === 'gap' ? GAP_MESSAGE : DRIFT_MESSAGE,
    '',
    ...changes.map(({ change, verb }) => `${verb} ${change.path}`),
  ].join('\n');
}

function sameBytes(
  a: Uint8Array | undefined,
  b: Uint8Array | undefined,
): boolean {
  if (!a || !b) {
    return a === b;
  }
  if (a.byteLength !== b.byteLength) {
    return false;
  }
  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

// Whether a path the disk scan finds is one a revision could hold: not the
// history itself, not a git checkout's own store, and not a file the realm is
// part-way through writing.
export function isRecordablePath(path: LocalPath): boolean {
  return (
    !isHistoryPath(path) &&
    path !== '.git' &&
    !path.startsWith('.git/') &&
    !isPartialWritePath(path)
  );
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
