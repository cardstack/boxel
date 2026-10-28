import { v4 as uuidv4 } from '@lukeed/uuid';
import { Sha256 } from '@aws-crypto/sha256-js';
import { logger } from './log.ts';
import {
  param,
  query,
  separatedByCommas,
  type Expression,
} from './expression.ts';
import type { DBAdapter } from './db.ts';
import { OperationFailure } from './card-operations/types.ts';

// ============================================================================
// Realm revision history: the record half of a history-first write.
//
// A realm that records history treats its history as the source of truth and
// its directory on disk as a materialization of HEAD. A write therefore runs
// in this order:
//
//   1. Lock — the per-file advisory locks every writer of those files takes.
//   2. Stage — every file's final bytes, in memory. Nothing is written.
//   3. Record — one revision built from those staged bytes, committed to the
//      history backend under the write's operation id, with compare-and-swap
//      on HEAD. Serialized across replicas by a short-lived advisory lock of
//      its own (`DBAdapter.withHistoryCommitLock`).
//   4. Materialize — the bytes reach disk, and the revision's journal row is
//      stamped materialized.
//   5. Post-commit — file meta, the `update` broadcast, indexing, and the
//      `X-Boxel-Revision` response header.
//
// Nothing an observer can see — a NOTIFY, a realm event, a `realm_file_meta`
// row, an index job — happens before step 3 has committed, so no one is ever
// shown a write whose revision does not exist.
//
// The realm runs steps 2, 4 and 5 (see `Realm.#commitBatchUnlockedInner`);
// this module owns step 3, the revision's metadata, and the journal that
// records which revisions have reached disk.
// ============================================================================

export { HISTORY_DIR } from './paths.ts';

// A client's idempotency key for one write attempt. Retrying a write with the
// id it was first sent under returns the revision that attempt committed
// rather than writing again. Absent, the realm mints one.
export const OPERATION_ID_HEADER = 'X-Boxel-Operation-Id';
// How the write was made, recorded on its revision as `Boxel-Channel`.
// Advisory: it describes the client, which is not authenticated by it.
export const CHANNEL_HEADER = 'X-Boxel-Channel';
// The revision a write committed, or HEAD for a write that changed nothing.
export const REVISION_HEADER = 'X-Boxel-Revision';
// The id of the log lines a request produced. It is carried on the write's
// telemetry line beside the operation id, so a revision leads to its logs
// through its `Boxel-Operation-Id`. It stays off the revision itself: a client
// mints a fresh one per request, and history fingerprints a commit request
// with its trailers, so a retry carrying a new one would no longer match the
// attempt it retries.
export const CORRELATION_ID_HEADER = 'X-Boxel-Logging-Correlation-Id';

export type HistoryChannel =
  | 'host'
  | 'ai-assistant'
  | 'boxel-cli'
  | 'operations'
  | 'system';

// The channels a client may claim for itself. `system` is the realm's own,
// for writes no request made.
const CLIENT_CHANNELS: ReadonlySet<string> = new Set([
  'host',
  'ai-assistant',
  'boxel-cli',
  'operations',
]);

// An operation id deckd accepts: 1–128 characters from `[A-Za-z0-9._-]`, not
// starting with a dot.
const OPERATION_ID_PATTERN = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}$/;

export function isValidOperationId(id: string): boolean {
  return OPERATION_ID_PATTERN.test(id);
}

export function newOperationId(): string {
  return uuidv4();
}

// The author a revision names when no user made the write: the realm's own
// matrix account where it has one.
export const SYSTEM_AUTHOR = 'boxel-system';

export type RevisionWriteOutcome =
  // A revision was committed and its bytes reached disk.
  | 'committed'
  // The operation id had already committed; nothing was written again.
  | 'replayed'
  // Nothing the write staged differed from what the realm holds, so no
  // revision was recorded and HEAD was reported.
  | 'unchanged'
  // The write was definitely not recorded, and nothing reached disk.
  | 'aborted'
  // Whether the revision was recorded could not be established.
  | 'unknown'
  // The revision was recorded, and a later step failed. History stands; disk
  // is behind it until recovery brings it up to HEAD.
  | 'failed-after-record';

// One request's write as history sees it, threaded from the handler that
// received the request down to the commit, which fills in what happened. A
// handler reads `revision` back to answer with it.
export interface WriteRecording {
  operationId: string;
  channel: HistoryChannel;
  correlationId?: string;
  // What the write asked for: the request as the client sent it, and who sent
  // it. Journaled with the revision, so a later request under the same id is
  // a retry only when it asks for the same thing. Absent for a write no
  // request made.
  fingerprint?: string;
  // The matrix user the write is attributed to: the request's authenticated
  // user after assume-user. Never read from a header. Absent, the revision is
  // attributed to the realm itself.
  author?: string;
  // Set once known: the committed revision, or HEAD for a write that changed
  // nothing.
  revision?: string;
  outcome?: RevisionWriteOutcome;
  // Whether a commit took this write through recording at all. False for a
  // realm that does not record history, which leaves every other field unset.
  engaged?: boolean;
  // Revisions already recorded whose bytes this commit brings to disk, as
  // recovery completes them: the commit records nothing of its own, and
  // stamps these materialized and post-committed instead.
  recovered?: string[];
  // Per-step wall clock, for the write's telemetry line.
  startedAt?: number;
  lockWaitMs?: number;
  recordMs?: number;
  historyLockWaitMs?: number;
  materializeMs?: number;
  postCommitMs?: number;
  recordedAt?: number;
  durableAt?: number;
  historyCalls?: HistoryCallTiming[];
}

export interface HistoryCallTiming {
  endpoint: 'commit' | 'outcome' | 'head' | 'tree' | 'read';
  ms: number;
  // `ok`, or the backend's error code, or `transport` for a call whose
  // response never arrived.
  status: string;
}

export function writeRecordingFor(
  request: Request,
  requestContext: { authenticatedUser?: string; requestDigest?: string },
  defaultChannel: HistoryChannel,
): WriteRecording {
  let suppliedId = request.headers.get(OPERATION_ID_HEADER)?.trim();
  if (suppliedId !== undefined && suppliedId !== '') {
    if (!isValidOperationId(suppliedId)) {
      throw new OperationFailure({
        status: 400,
        code: 'invalid-params',
        title: 'Invalid operation id',
        detail: `${OPERATION_ID_HEADER} must be 1–128 characters from [A-Za-z0-9._-], not starting with a dot`,
      });
    }
  }
  let claimed = request.headers.get(CHANNEL_HEADER)?.trim().toLowerCase();
  let correlationId = request.headers.get(CORRELATION_ID_HEADER)?.trim();
  return {
    operationId: suppliedId || newOperationId(),
    channel:
      claimed && CLIENT_CHANNELS.has(claimed)
        ? (claimed as HistoryChannel)
        : defaultChannel,
    ...(correlationId ? { correlationId: oneLine(correlationId) } : {}),
    ...(requestContext.authenticatedUser
      ? { author: requestContext.authenticatedUser }
      : {}),
    ...(requestContext.requestDigest
      ? {
          fingerprint: `${requestContext.requestDigest}:${requestContext.authenticatedUser ?? ''}`,
        }
      : {}),
  };
}

// A digest of a write request as the client sent it: its method, URL,
// content type and body. Taken from the body the handler read, before
// anything is derived from it, because what a handler derives from a request
// can depend on the realm's state, which a retry finds moved on.
export function requestDigest(request: Request, body: Uint8Array): string {
  let hash = new Sha256();
  let encoder = new TextEncoder();
  let field = (bytes: Uint8Array) => {
    hash.update(encoder.encode(`${bytes.byteLength}:`));
    hash.update(bytes);
  };
  field(encoder.encode(request.method));
  field(encoder.encode(request.url));
  field(encoder.encode(request.headers.get('Content-Type') ?? ''));
  hash.update(body);
  return Array.from(hash.digestSync(), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

export function systemWriteRecording(): WriteRecording {
  return { operationId: newOperationId(), channel: 'system' };
}

// ---------------------------------------------------------------------------
// The history backend: deckd, reached over HTTP by realm-server. Declared here
// so the realm depends on the protocol, not on the transport; a realm running
// in the browser has none.
// ---------------------------------------------------------------------------

export interface HistoryChange {
  path: string;
  content?: Uint8Array;
  delete?: true;
}

export interface HistoryCommitRequest {
  parent: string;
  operationId: string;
  author: { name: string; email: string };
  message: string;
  trailers: { key: string; value: string }[];
  changes: HistoryChange[];
}

export interface HistoryCommitResult {
  revision: string;
  // False when the changes left HEAD's tree as it was, and `revision` is HEAD.
  created: boolean;
  // True when the operation id had already committed, and `revision` is the
  // revision it committed then.
  replayed: boolean;
}

export interface PreparedCommit {
  // Send the commit as a child of `parent`. Sent again under a new parent
  // after a `parent-mismatch`.
  commit(parent: string): Promise<HistoryCommitResult>;
}

export type HistoryOutcome =
  | { state: 'committed'; revision: string }
  // Reporting `absent` fences the id: it can never commit afterwards.
  | { state: 'absent' };

// One file in a revision's tree. `blob` is the git blob id of its bytes (see
// `gitBlobId`), so a file on disk is compared with it without reading the
// revision's copy.
export interface HistoryTreeEntry {
  path: string;
  blob: string;
}

export interface HistoryReadResult {
  // Each path asked for, in order: its bytes at the revision, or no content
  // where the revision has no file there.
  files: { path: string; content?: Uint8Array }[];
  // The paths asked for and not read, because the answer reached the
  // backend's ceiling. They are asked for again.
  remaining: string[];
}

export interface HistoryBackend {
  // Encode a commit for sending before its parent is known. The recorder
  // prepares a commit before it takes the history commit lock, so the writer
  // holding the lock spends it on the call to the backend, not on encoding.
  prepareCommit(request: Omit<HistoryCommitRequest, 'parent'>): PreparedCommit;
  outcome(operationId: string): Promise<HistoryOutcome>;
  head(): Promise<string>;
  tree(revision: string): Promise<HistoryTreeEntry[]>;
  read(revision: string, paths: string[]): Promise<HistoryReadResult>;
}

// A refusal the backend made with a typed answer, so its outcome is known.
// `nothingWritten` is true for every code but a commit `internal` failure,
// whose outcome has to be asked for.
export class HistoryBackendError extends Error {
  readonly code: string;
  readonly status: number;
  // The current HEAD, on a `parent-mismatch`.
  readonly head?: string;
  // The revision the id committed, on an `operation-mismatch`.
  readonly revision?: string;
  constructor(
    code: string,
    status: number,
    message: string,
    extra?: { head?: string; revision?: string },
  ) {
    super(message);
    this.name = 'HistoryBackendError';
    this.code = code;
    this.status = status;
    this.head = extra?.head;
    this.revision = extra?.revision;
  }
}

export function isHistoryBackendError(
  err: unknown,
): err is HistoryBackendError {
  return err instanceof HistoryBackendError;
}

// ---------------------------------------------------------------------------
// The journal: one row per revision this realm-server recorded, in history
// order, saying whether its bytes have reached disk. `materializedRevision` is
// derived from it rather than stored, because two writers of different files
// can reach disk in the opposite order to the one they recorded in.
// ---------------------------------------------------------------------------

// `pending` from before the write asks history to record it until its
// outcome is known; `committed` with its revision; `aborted` once history has
// reported the operation absent, which fences it.
export type JournalState = 'pending' | 'committed' | 'aborted';

// `write` for a revision a write made, `drift` for changes recovery found on
// disk that no revision explained, `gap` for changes made while the realm did
// not record.
export type RevisionKind = 'write' | 'drift' | 'gap';

export interface JournalEntry {
  state: JournalState;
  // Absent until the row is committed.
  revision?: string;
  materialized: boolean;
  // See `WriteRecording.fingerprint`.
  fingerprint?: string;
  // What the write answered with, kept so a retry under the same operation id
  // answers the same way. Absent until the coordinator has built it.
  results?: unknown;
}

// ---------------------------------------------------------------------------
// The recorder: one per realm that records history.
// ---------------------------------------------------------------------------

const MAX_REPARENT_ATTEMPTS = 8;

// The most bytes one revision carries. deckd takes a commit as one JSON body
// of at most 64 MiB with every file base64-encoded, which grows its bytes by a
// third, so 48 MiB of content is the ceiling with nothing left for the rest of
// the body. A write over this is refused before anything is recorded, since
// deckd would refuse it on every attempt.
export const HISTORY_COMMIT_MAX_BYTES = 40 * 1024 * 1024;

export class RealmHistoryRecorder {
  // See `HISTORY_COMMIT_MAX_BYTES`. Settable so a test can reach it without
  // sending tens of megabytes.
  maxCommitBytes = HISTORY_COMMIT_MAX_BYTES;
  #backend: HistoryBackend;
  #dbAdapter: DBAdapter;
  #realmURL: string;
  // Who a write no user made is attributed to.
  #systemAuthor: string;
  // The last HEAD this replica saw. A commit names it as its parent, and a
  // stale one — another replica committed since — costs one refused commit
  // that carries the HEAD to retry from.
  #head: string | undefined;
  #log = logger('realm:history');

  constructor({
    backend,
    dbAdapter,
    realmURL,
    systemAuthor,
  }: {
    backend: HistoryBackend;
    dbAdapter: DBAdapter;
    realmURL: string;
    systemAuthor?: string;
  }) {
    this.#backend = backend;
    this.#dbAdapter = dbAdapter;
    this.#realmURL = realmURL;
    this.#systemAuthor = systemAuthor || SYSTEM_AUTHOR;
  }

  // The journal row for an operation id, when this realm recorded it.
  async journalEntry(operationId: string): Promise<JournalEntry | undefined> {
    let [row] = await query(this.#dbAdapter, [
      `SELECT state, revision, materialized_at IS NOT NULL AS materialized,
              results, fingerprint
       FROM realm_history_revisions WHERE realm_url =`,
      param(this.#realmURL),
      `AND operation_id =`,
      param(operationId),
    ]);
    if (!row) {
      return undefined;
    }
    return {
      state: String(row.state) as JournalState,
      ...(row.revision != null ? { revision: String(row.revision) } : {}),
      materialized: Boolean(row.materialized),
      ...(row.fingerprint != null
        ? { fingerprint: String(row.fingerprint) }
        : {}),
      ...(row.results != null ? { results: parseJSON(row.results) } : {}),
    };
  }

  // The newest revision whose bytes, and every earlier revision's, have
  // reached disk. Behind HEAD while a write is between Record and the end of
  // Materialize, or after one died there; recovery brings disk up to HEAD.
  async materializedRevision(): Promise<string | undefined> {
    let [row] = await query(this.#dbAdapter, [
      `SELECT revision FROM realm_history_revisions WHERE realm_url =`,
      param(this.#realmURL),
      `AND state = 'committed'
       AND seq < COALESCE((SELECT min(seq) FROM realm_history_revisions
         WHERE realm_url =`,
      param(this.#realmURL),
      `AND state = 'committed' AND materialized_at IS NULL),
         9223372036854775807)
       ORDER BY seq DESC LIMIT 1`,
    ]);
    return row ? String(row.revision) : undefined;
  }

  async head(recording?: WriteRecording): Promise<string> {
    let head = await this.#timed(recording, 'head', () => this.#backend.head());
    this.#head = head;
    return head;
  }

  // Record one revision from the staged changes. Resolves with the revision,
  // having journaled it, or with HEAD when the changes leave HEAD's tree as it
  // was. Rejects with an `OperationFailure` whose outcome is set on
  // `recording`: `aborted` when nothing was recorded, `unknown` when that
  // could not be established.
  //
  // The write is journaled `pending` before history is asked anything, in a
  // statement of its own, so a write whose answer is lost — and whose outcome
  // could not be asked for either — leaves a row that recovery resolves. A
  // write that definitely recorded nothing takes its row away again, except
  // one history reported absent: that id is fenced, and its row says so to a
  // retry.
  async record(
    recording: WriteRecording,
    changes: { change: HistoryChange; verb: 'Create' | 'Update' | 'Delete' }[],
    opts?: {
      kind?: RevisionKind;
      message?: string;
      trailers?: { key: string; value: string }[];
    },
  ): Promise<string> {
    if (!this.#dbAdapter.withHistoryCommitLock) {
      throw new Error(
        `${this.#realmURL} records history, but its database adapter has no history commit lock`,
      );
    }
    let author = this.#author(recording.author);
    let kind = opts?.kind ?? 'write';
    let request: Omit<HistoryCommitRequest, 'parent'> = {
      operationId: recording.operationId,
      author,
      message: opts?.message ?? commitMessage(changes),
      trailers: [
        { key: 'Boxel-Operation-Id', value: recording.operationId },
        { key: 'Boxel-Channel', value: recording.channel },
        ...(kind === 'gap'
          ? [{ key: 'Boxel-Gap', value: 'recording-disabled' }]
          : []),
        ...(opts?.trailers ?? []),
      ],
      changes: changes.map(({ change }) => change),
    };
    let paths = changes.map(({ change }) => change.path);
    await query(this.#dbAdapter, [
      `INSERT INTO realm_history_revisions
         (realm_url, operation_id, fingerprint, paths, kind, state,
          recorded_at)
       VALUES (`,
      param(this.#realmURL),
      `,`,
      param(recording.operationId),
      `,`,
      param(recording.fingerprint ?? null),
      `,`,
      ...textArray(paths),
      `,`,
      param(kind),
      `, 'pending', now()) ON CONFLICT (realm_url, operation_id) DO NOTHING`,
    ]);
    let started = Date.now();
    try {
      // Encoded before the lock is taken: every other writer in the realm
      // waits for whoever holds it.
      let prepared = this.#backend.prepareCommit(request);
      let requestedAt = Date.now();
      return await this.#dbAdapter.withHistoryCommitLock(
        this.#realmURL,
        async (txQuerier) => {
          recording.historyLockWaitMs = Date.now() - requestedAt;
          let result = await this.#commitWithReparent(recording, prepared);
          // In the same transaction as the lock, so rows are journaled in the
          // order revisions were committed. A retry of an operation that had
          // already committed finds its row already committed.
          await txQuerier([
            `INSERT INTO realm_history_revisions
               (realm_url, revision, parent, operation_id, fingerprint, paths,
                kind, state, recorded_at)
             VALUES (`,
            param(this.#realmURL),
            `,`,
            param(result.revision),
            `,`,
            param(result.parent),
            `,`,
            param(recording.operationId),
            `,`,
            param(recording.fingerprint ?? null),
            `,`,
            ...textArray(paths),
            `,`,
            param(kind),
            `, 'committed', now())
             ON CONFLICT (realm_url, operation_id) DO UPDATE SET
               revision = EXCLUDED.revision, parent = EXCLUDED.parent,
               state = 'committed', seq = nextval(pg_get_serial_sequence(
                 'realm_history_revisions', 'seq'))
             WHERE realm_history_revisions.state = 'pending'`,
          ]);
          return result.revision;
        },
      );
    } catch (err: unknown) {
      // After the lock is released, so no other pool checkout waits inside it.
      if (err instanceof FencedSignal) {
        await this.#markAborted(recording.operationId);
        throw err.failure;
      }
      if (
        err instanceof UnchangedTreeSignal ||
        recording.outcome === 'aborted'
      ) {
        await this.#forgetPending(recording.operationId);
      }
      throw err;
    } finally {
      recording.recordMs = Date.now() - started;
    }
  }

  // Stamp the revisions materialized: their bytes are on disk.
  async markMaterialized(revisions: string | string[]): Promise<void> {
    let list = typeof revisions === 'string' ? [revisions] : revisions;
    if (list.length === 0) {
      return;
    }
    await query(this.#dbAdapter, [
      `UPDATE realm_history_revisions SET materialized_at = now()
       WHERE materialized_at IS NULL AND realm_url =`,
      param(this.#realmURL),
      `AND revision = ANY(`,
      ...textArray(list),
      `)`,
    ]);
  }

  // Stamp the revisions post-committed: the index pass over their paths is
  // queued, and their change has been announced.
  async markPostCommitted(revisions: string[]): Promise<void> {
    if (revisions.length === 0) {
      return;
    }
    await query(this.#dbAdapter, [
      `UPDATE realm_history_revisions SET post_committed_at = now()
       WHERE post_committed_at IS NULL AND realm_url =`,
      param(this.#realmURL),
      `AND revision = ANY(`,
      ...textArray(revisions),
      `)`,
    ]);
  }

  // A committed revision other than `operationId`'s that touches one of
  // `paths` and has not reached disk. Asked by a write holding those paths'
  // locks: a writer keeps its locks until its bytes are on disk, so such a
  // revision's writer is gone, and disk holds older bytes than HEAD there.
  async unmaterializedRevisionTouching(
    paths: string[],
    operationId: string,
  ): Promise<string | undefined> {
    if (paths.length === 0) {
      return undefined;
    }
    let [row] = await query(this.#dbAdapter, [
      `SELECT revision FROM realm_history_revisions WHERE realm_url =`,
      param(this.#realmURL),
      `AND state = 'committed' AND materialized_at IS NULL
       AND operation_id <>`,
      param(operationId),
      `AND paths &&`,
      ...textArray(paths),
      `ORDER BY seq LIMIT 1`,
    ]);
    return row ? String(row.revision) : undefined;
  }

  // Writes other than `operationId` journaled `pending` that touch one of
  // `paths`. Asked by a write holding those paths' locks: a writer keeps its
  // locks until it has its answer or has given up on it, so each one's
  // answer was lost.
  async pendingOperationsTouching(
    paths: string[],
    operationId: string,
  ): Promise<string[]> {
    if (paths.length === 0) {
      return [];
    }
    let rows = await query(this.#dbAdapter, [
      `SELECT operation_id FROM realm_history_revisions WHERE realm_url =`,
      param(this.#realmURL),
      `AND state = 'pending' AND operation_id <>`,
      param(operationId),
      `AND paths &&`,
      ...textArray(paths),
      `ORDER BY seq`,
    ]);
    return rows.map((row) => String(row.operation_id));
  }

  // Writes journaled `pending` since before `olderThan`: each one's answer was
  // lost, along with any chance of asking for it then.
  async pendingOperations(olderThan: Date): Promise<string[]> {
    let rows = await query(this.#dbAdapter, [
      `SELECT operation_id FROM realm_history_revisions WHERE realm_url =`,
      param(this.#realmURL),
      `AND state = 'pending' AND recorded_at <`,
      param(olderThan.toISOString()),
      `ORDER BY seq`,
    ]);
    return rows.map((row) => String(row.operation_id));
  }

  // Settle a pending write by asking history for its outcome, which fences
  // the id when it never committed. Resolves with the revision it committed,
  // or with nothing when it did not.
  async resolvePending(operationId: string): Promise<string | undefined> {
    let outcome = await this.#timed(undefined, 'outcome', () =>
      this.#backend.outcome(operationId),
    );
    if (outcome.state === 'absent') {
      await this.#markAborted(operationId);
      return undefined;
    }
    // Its commit stood. It is journaled after every revision this realm has
    // already journaled, which is where it belongs among those still to reach
    // disk: none of them can have committed after it and reached disk first,
    // because its paths' locks were held until its writer was gone.
    await query(this.#dbAdapter, [
      `UPDATE realm_history_revisions SET state = 'committed', revision =`,
      param(outcome.revision),
      `, seq = nextval(pg_get_serial_sequence('realm_history_revisions',
          'seq'))
       WHERE state = 'pending' AND realm_url =`,
      param(this.#realmURL),
      `AND operation_id =`,
      param(operationId),
    ]);
    return outcome.revision;
  }

  // Committed revisions whose bytes have not all reached disk, or whose index
  // pass was never queued, in the order they were recorded.
  async incompleteRevisions(): Promise<
    { revision: string; paths: string[]; materialized: boolean }[]
  > {
    let rows = await query(this.#dbAdapter, [
      `SELECT revision, paths, materialized_at IS NOT NULL AS materialized
       FROM realm_history_revisions WHERE realm_url =`,
      param(this.#realmURL),
      `AND state = 'committed'
       AND (materialized_at IS NULL OR post_committed_at IS NULL)
       ORDER BY seq`,
    ]);
    return rows.map((row) => ({
      revision: String(row.revision),
      paths: parseTextArray(row.paths),
      materialized: Boolean(row.materialized),
    }));
  }

  // The kind of a revision this realm journaled: whether it is a write, drift
  // recovery found, or a gap left while recording was off.
  async revisionKind(revision: string): Promise<RevisionKind | undefined> {
    let [row] = await query(this.#dbAdapter, [
      `SELECT kind FROM realm_history_revisions WHERE realm_url =`,
      param(this.#realmURL),
      `AND revision =`,
      param(revision),
    ]);
    return row ? (String(row.kind) as RevisionKind) : undefined;
  }

  async tree(revision: string): Promise<HistoryTreeEntry[]> {
    return await this.#timed(undefined, 'tree', () =>
      this.#backend.tree(revision),
    );
  }

  // Every path's bytes at `revision`, over as many calls as the backend's
  // ceiling takes.
  async read(
    revision: string,
    paths: string[],
  ): Promise<Map<string, Uint8Array | undefined>> {
    let found = new Map<string, Uint8Array | undefined>();
    let remaining = paths;
    while (remaining.length > 0) {
      let result = await this.#timed(undefined, 'read', () =>
        this.#backend.read(revision, remaining),
      );
      if (result.files.length === 0) {
        throw new Error(
          `history read no file of ${remaining.length} asked for at ${revision}`,
        );
      }
      for (let { path, content } of result.files) {
        found.set(path, content);
      }
      remaining = result.remaining;
    }
    return found;
  }

  async recordResults(operationId: string, results: unknown): Promise<void> {
    await query(this.#dbAdapter, [
      `UPDATE realm_history_revisions SET results =`,
      param(JSON.stringify(results)),
      `WHERE realm_url =`,
      param(this.#realmURL),
      `AND operation_id =`,
      param(operationId),
    ]);
  }

  async #markAborted(operationId: string): Promise<void> {
    await query(this.#dbAdapter, [
      `UPDATE realm_history_revisions SET state = 'aborted'
       WHERE state = 'pending' AND realm_url =`,
      param(this.#realmURL),
      `AND operation_id =`,
      param(operationId),
    ]);
  }

  async #forgetPending(operationId: string): Promise<void> {
    try {
      await query(this.#dbAdapter, [
        `DELETE FROM realm_history_revisions
         WHERE state = 'pending' AND realm_url =`,
        param(this.#realmURL),
        `AND operation_id =`,
        param(operationId),
      ]);
    } catch (err: unknown) {
      // Left pending, recovery asks for its outcome, finds it absent, and
      // marks it aborted.
      this.#log.warn(
        `could not remove the pending row of ${operationId} in ${this.#realmURL}: ${describe(err)}`,
      );
    }
  }

  async #commitWithReparent(
    recording: WriteRecording,
    prepared: PreparedCommit,
  ): Promise<{ revision: string; parent: string }> {
    let parent = this.#head ?? (await this.head(recording));
    for (let attempt = 1; ; attempt++) {
      let result: HistoryCommitResult;
      try {
        result = await this.#timed(recording, 'commit', () =>
          prepared.commit(parent),
        );
      } catch (err: unknown) {
        if (
          isHistoryBackendError(err) &&
          err.code === 'parent-mismatch' &&
          err.head &&
          attempt < MAX_REPARENT_ATTEMPTS
        ) {
          // Another replica committed since this one last saw HEAD. The file
          // locks keep its paths disjoint from this write's, so this write
          // goes on top of it unchanged.
          parent = err.head;
          this.#head = err.head;
          continue;
        }
        return await this.#resolveFailedCommit(recording, err, parent);
      }
      if (result.replayed) {
        // The revision this id committed earlier. HEAD may have moved on
        // since, so it is asked for again next time.
        this.#head = undefined;
        return { revision: result.revision, parent };
      }
      this.#head = result.revision;
      if (result.created) {
        return { revision: result.revision, parent };
      }
      // The changes left HEAD's tree as it was, which the realm's own
      // unchanged check rules out unless disk had drifted from HEAD. Nothing
      // was recorded, so there is nothing to journal.
      throw new UnchangedTreeSignal(result.revision);
    }
  }

  // A commit that did not answer with a revision. A typed refusal says what
  // happened; anything else — a timeout, a reset connection, an internal
  // failure — leaves the outcome open, and it is asked for. Asking fences the
  // id, so once the answer is `absent` the write can never commit late.
  async #resolveFailedCommit(
    recording: WriteRecording,
    err: unknown,
    parent: string,
  ): Promise<{ revision: string; parent: string }> {
    if (isHistoryBackendError(err) && err.code !== 'internal') {
      if (err.code === 'operation-fenced') {
        recording.outcome = 'aborted';
        throw new FencedSignal(operationFenced(recording.operationId));
      }
      if (err.code === 'operation-mismatch') {
        recording.outcome = 'aborted';
        throw new OperationFailure({
          status: 409,
          code: 'operation-id-conflict',
          title: 'Operation id already used',
          detail: `operation ${recording.operationId} already committed a different write, as revision ${err.revision}; send this write under a new ${OPERATION_ID_HEADER}`,
          meta: { operationId: recording.operationId, revision: err.revision },
        });
      }
      recording.outcome = 'aborted';
      if (err.code === 'payload-too-large') {
        // Sending it again is refused again.
        throw new OperationFailure({
          status: 413,
          code: 'payload-too-large',
          title: 'Write too large to record',
          detail: `operation ${recording.operationId} is larger than the realm's history takes in one revision, and nothing was written`,
          meta: { operationId: recording.operationId },
        });
      }
      if (err.code === 'invalid-request') {
        // The realm built a request its history cannot read, which no retry
        // changes.
        throw new OperationFailure({
          status: 500,
          code: 'internal-error',
          title: 'Write not recorded',
          detail: `operation ${recording.operationId} was not recorded, and nothing was written (${describe(err)})`,
          meta: { operationId: recording.operationId },
        });
      }
      throw this.#aborted(recording, err);
    }
    this.#log.warn(
      `recording ${recording.operationId} in ${this.#realmURL} did not answer (${describe(err)}); asking for its outcome`,
    );
    let outcome: HistoryOutcome;
    try {
      outcome = await this.#timed(recording, 'outcome', () =>
        this.#backend.outcome(recording.operationId),
      );
    } catch (outcomeErr: unknown) {
      recording.outcome = 'unknown';
      this.#head = undefined;
      throw new OperationFailure({
        status: 503,
        code: 'revision-outcome-unknown',
        title: 'Write outcome unknown',
        detail: `could not establish whether operation ${recording.operationId} was recorded (${describe(outcomeErr)}); retry it under the same ${OPERATION_ID_HEADER}`,
        meta: { operationId: recording.operationId },
      });
    }
    this.#head = undefined;
    if (outcome.state === 'committed') {
      return { revision: outcome.revision, parent };
    }
    // Asking fenced the id, so it can never commit late, and a retry under it
    // is told to send the write under a new one.
    recording.outcome = 'aborted';
    throw new FencedSignal(this.#aborted(recording, err));
  }

  #aborted(recording: WriteRecording, cause: unknown): OperationFailure {
    return new OperationFailure({
      status: 503,
      code: 'revision-aborted',
      title: 'Write not recorded',
      detail: `operation ${recording.operationId} was not recorded, and nothing was written (${describe(cause)})`,
      meta: { operationId: recording.operationId },
    });
  }

  #author(matrixUserId: string | undefined): { name: string; email: string } {
    let name = oneLine(matrixUserId || this.#systemAuthor).replace(/[<>]/g, '');
    // deckd wants an email for git's author line. A matrix id names its
    // homeserver, so `@jane:example.com` reads as `jane@example.com`; the realm
    // itself has no homeserver to name.
    let match = /^@([^:]+):(.+)$/.exec(name);
    let email = match ? `${match[1]}@${match[2]}` : `${name}@boxel.invalid`;
    return { name, email: email.replace(/[\s<>]/g, '') };
  }

  async #timed<T>(
    recording: WriteRecording | undefined,
    endpoint: HistoryCallTiming['endpoint'],
    fn: () => Promise<T>,
  ): Promise<T> {
    let started = Date.now();
    let status = 'ok';
    try {
      return await fn();
    } catch (err: unknown) {
      status = isHistoryBackendError(err) ? err.code : 'transport';
      throw err;
    } finally {
      recording?.historyCalls?.push({
        endpoint,
        ms: Date.now() - started,
        status,
      });
    }
  }
}

// Thrown inside the history lock by a write whose operation id is fenced, so
// its journal row is marked aborted once the lock is released.
class FencedSignal extends Error {
  readonly failure: OperationFailure;
  constructor(failure: OperationFailure) {
    super(failure.message);
    this.name = 'FencedSignal';
    this.failure = failure;
  }
}

// The answer to a write under an operation id history has fenced: it reported
// the id absent, so the write it named never happened and never can.
export function operationFenced(operationId: string): OperationFailure {
  return new OperationFailure({
    status: 409,
    code: 'operation-fenced',
    title: 'Operation id already aborted',
    detail: `operation ${operationId} was not recorded, and can no longer be; send this write under a new ${OPERATION_ID_HEADER}`,
    meta: { operationId },
  });
}

// Thrown by a commit that recorded nothing because the tree was already as
// staged: the realm answers with `head`, as it does for any unchanged write.
export class UnchangedTreeSignal extends Error {
  readonly head: string;
  constructor(head: string) {
    super(`the staged changes leave HEAD ${head} as it is`);
    this.name = 'UnchangedTreeSignal';
    this.head = head;
  }
}

// `Update Author/jane.json` for one path; `Update 3 files`, with each path on
// a line of its own below, for several.
export function commitMessage(
  changes: { change: HistoryChange; verb: 'Create' | 'Update' | 'Delete' }[],
): string {
  if (changes.length === 1) {
    let [{ change, verb }] = changes;
    return `${verb} ${change.path}`;
  }
  let verbs = new Set(changes.map(({ verb }) => verb));
  let verb = verbs.size === 1 ? [...verbs][0] : 'Update';
  return [
    `${verb} ${changes.length} files`,
    '',
    ...changes.map(({ change, verb }) => `${verb} ${change.path}`),
  ].join('\n');
}

function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, ' ');
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// `values` as a postgres `text[]`.
function textArray(values: string[]): Expression {
  if (values.length === 0) {
    return [`'{}'::text[]`];
  }
  return [
    'CAST(ARRAY[',
    ...separatedByCommas(values.map((value) => [param(value)])),
    '] AS text[])',
  ] as Expression;
}

// A postgres `text[]`, which a SQLite-backed or older driver may hand back as
// its literal.
function parseTextArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String);
  }
  if (typeof value === 'string') {
    let inner = value.replace(/^\{|\}$/g, '');
    return inner === ''
      ? []
      : inner.split(',').map((item) => item.replace(/^"|"$/g, ''));
  }
  return [];
}

// The git blob id of `bytes`: what history's tree names a file by, so a file
// on disk is compared with a revision without reading the revision's copy.
export async function gitBlobId(bytes: Uint8Array): Promise<string> {
  let header = new TextEncoder().encode(`blob ${bytes.byteLength}\0`);
  let object = new Uint8Array(header.byteLength + bytes.byteLength);
  object.set(header, 0);
  object.set(bytes, header.byteLength);
  let digest = await globalThis.crypto.subtle.digest('SHA-1', object);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

function parseJSON(value: unknown): unknown {
  return typeof value === 'string' ? JSON.parse(value) : value;
}
