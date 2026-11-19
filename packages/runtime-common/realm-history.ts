// Realm revision history: the contract between the realm server's write path,
// which records what changed, and realm-historian, which turns those records
// into git revisions after the fact.
//
// The write path appends one change event per write to the change journal, in
// the same transaction as the write's `realm_file_meta` update. It never
// commits, waits on or calls anything for history. realm-historian reads the
// journal and the realm's files, and writes the repos. The realm server reads
// history back through a `RealmHistoryReader`, straight from the repos.
//
// The in-browser realm has no journal and no reader: it emits no events, and
// its history operations answer `history-unavailable`.

import {
  emitChangeJournal,
  type ChangeJournalEvent,
} from './card-operations/telemetry.ts';
import { stringifyErrorForLog } from './error.ts';
import type { Querier } from './expression.ts';
import { logger } from './log.ts';
import {
  X_BOXEL_LOGGING_CORRELATION_ID_HEADER,
  sanitizeLoggingCorrelationId,
} from './prerender-headers.ts';

// How a write was made: the client that made it, not the endpoint it reached,
// so a batch sent through `/_operations` records the channel its request
// claims. `host`, `ai-assistant` and `boxel-cli` are what a client may claim
// in `X-Boxel-Write-Channel`. `operations`, `system`, `deploy` and `mcp` are
// the realm server's own: only a writer in the realm server names one, in
// code, and a header claiming one is ignored. `api` is a write whose request
// names no channel.
export type WriteChannel =
  | 'host'
  | 'ai-assistant'
  | 'mcp'
  | 'boxel-cli'
  | 'operations'
  | 'api'
  | 'system'
  | 'deploy';

export const WRITE_CHANNELS: readonly WriteChannel[] = [
  'host',
  'ai-assistant',
  'mcp',
  'boxel-cli',
  'operations',
  'api',
  'system',
  'deploy',
];

// The channels a request header may claim. The rest are the realm server's
// own, and a header claiming one of them is ignored.
export const CLIENT_WRITE_CHANNELS: readonly WriteChannel[] = [
  'host',
  'ai-assistant',
  'boxel-cli',
];

// The author of a write that no user made: a deploy, or a system write on a
// realm with no Matrix bot.
export const SYSTEM_AUTHOR = 'boxel-system';

// The request headers that carry a write's context. All of them are advisory:
// the author always comes from the authenticated user.
export const WRITE_CHANNEL_HEADER = 'X-Boxel-Write-Channel';
export const WRITE_AGENT_HEADER = 'X-Boxel-Write-Agent';
export const WRITE_ROOM_HEADER = 'X-Boxel-Write-Room';
export const WRITE_TOOL_CALL_HEADER = 'X-Boxel-Write-Tool-Call';
export const PUSH_ID_HEADER = 'X-Boxel-Push-Id';
export const PUSH_FINAL_HEADER = 'X-Boxel-Push-Final';

export const WRITE_CONTEXT_HEADERS = [
  WRITE_CHANNEL_HEADER,
  WRITE_AGENT_HEADER,
  WRITE_ROOM_HEADER,
  WRITE_TOOL_CALL_HEADER,
  PUSH_ID_HEADER,
  PUSH_FINAL_HEADER,
] as const;

// The Postgres channel the journal notifies on each insert. The payload is the
// realm's registry id, so a realm-historian task wakes only for the realms of
// the shards it holds; an empty payload wakes every task.
export const REALM_CHANGE_EVENTS_CHANNEL = 'realm_change_events';

// The git trailers a revision carries. They are the metadata contract of the
// repo format: realm-historian writes them and the reader parses them.
export const TRAILERS = {
  channel: 'Boxel-Channel',
  operationIds: 'Boxel-Operation-Ids',
  correlationIds: 'Boxel-Correlation-Ids',
  agent: 'Boxel-Agent',
  room: 'Boxel-Room',
  writeCount: 'Boxel-Write-Count',
  firstWriteAt: 'Boxel-First-Write-At',
  pushId: 'Boxel-Push-Id',
  revertOf: 'Boxel-Revert-Of',
  revertForced: 'Boxel-Revert-Forced',
  partial: 'Boxel-Partial',
  superseded: 'Boxel-Superseded',
  includesSuperseded: 'Boxel-Includes-Superseded',
  journalSeq: 'Boxel-Journal-Seq',
  gap: 'Boxel-Gap',
} as const;

export type ChangeStatus = 'A' | 'M' | 'D';

// One path a write changed. `contentHash` is the `content-hash.ts`
// fingerprint `realm_file_meta` holds, and `size` the file's length after
// the write; a deletion carries neither. `appended` marks a change from the
// append leg: `size` is then the file's length after this append, so a
// reader can take exactly the bytes this write left.
export interface ChangeEventChange {
  path: string;
  status: ChangeStatus;
  contentHash?: string;
  size?: number;
  appended?: boolean;
}

// An event that names its own revision. Such an event is never coalesced
// with other writes.
//
// A `scan` comes from a writer that changed the realm's files outside the
// realm: create-realm after seeding a new realm, or a deploy after its rsync.
// It asks realm-historian to record every earlier event for the realm, then
// sweep the realm and record what differs as one revision by the scan's
// author, so it names no paths. A deploy's scan carries the repository it
// deployed from as `source` (such as `cardstack/boxel`) and the deployed
// commit's full SHA as `commit`; create-realm's carries neither.
export type ChangeIntent =
  | { kind: 'revert'; revision: string; path: string; forced: boolean }
  | { kind: 'scan'; source?: string; commit?: string }
  | { kind: 'delete-realm' };

// The context a write carries beside its changes. `channel` says how the
// write was made; `agent` and `room` describe an AI write; `correlationId`
// is the tool call on `ai-assistant` and `mcp` writes and the request's
// logging correlation id otherwise; `pushId` and `pushFinal` group the
// requests of one `boxel realm push`.
export interface WriteContext {
  channel: WriteChannel;
  agent?: string;
  room?: string;
  operationId?: string;
  correlationId?: string;
  pushId?: string;
  pushFinal?: boolean;
  intent?: ChangeIntent;
}

// The longest value a write's context keeps. Values become git trailers, so
// a value is also refused when it holds anything but printable ASCII: a
// newline in one would forge a trailer of its own.
const MAX_CONTEXT_VALUE_LENGTH = 256;
const CONTEXT_VALUE_PATTERN = /^[\x20-\x7E]+$/;

function contextValue(raw: string | null | undefined): string | undefined {
  let trimmed = raw?.trim();
  if (
    !trimmed ||
    trimmed.length > MAX_CONTEXT_VALUE_LENGTH ||
    !CONTEXT_VALUE_PATTERN.test(trimmed)
  ) {
    return undefined;
  }
  return trimmed;
}

// A write's context as its request states it. The headers are advisory, and
// none of them can change who the author is.
//
// - The channel is the client's claim only when it is one a client may make
//   (`CLIENT_WRITE_CHANNELS`). A request that claims one of the realm
//   server's own channels, names an unknown one, or names none is `api`.
// - `agent`, `room` and the tool call describe an AI write, so they are kept
//   only on `ai-assistant`. A stray one on another channel would split
//   realm-historian's grouping for nothing.
// - The correlation id is the tool call on an AI write, so each tool call
//   is its own revision. Otherwise, and on an AI write that names no tool
//   call, it is the request's logging correlation id.
// - The push id and its final mark group the requests of one
//   `boxel realm push`, so they are kept only on `boxel-cli`. A push group
//   stays open past realm-historian's quiet period and maximum age, so a
//   stray push id on another channel would hold that writer's revision open.
//   `pushFinal` marks the push's last request, so it is kept only beside a
//   push id. It closes the group early; a push whose last request records no
//   event (it was refused, or changed nothing) closes at realm-historian's
//   push timeout instead.
//
// A writer with no request sets its context itself. `mcp` is the channel for
// writes made through the MCP connector, with the OAuth client as `agent` and
// the connector's write id as `correlationId`.
export function writeContextFromHeaders(headers: {
  get(name: string): string | null;
}): WriteContext {
  let claimed = headers.get(WRITE_CHANNEL_HEADER)?.trim().toLowerCase();
  let channel: WriteChannel =
    claimed && (CLIENT_WRITE_CHANNELS as readonly string[]).includes(claimed)
      ? (claimed as WriteChannel)
      : 'api';
  let loggingCorrelationId =
    sanitizeLoggingCorrelationId(
      headers.get(X_BOXEL_LOGGING_CORRELATION_ID_HEADER),
    ) ?? undefined;
  let agent: string | undefined;
  let room: string | undefined;
  let correlationId = loggingCorrelationId;
  if (channel === 'ai-assistant') {
    agent = contextValue(headers.get(WRITE_AGENT_HEADER));
    room = contextValue(headers.get(WRITE_ROOM_HEADER));
    correlationId =
      contextValue(headers.get(WRITE_TOOL_CALL_HEADER)) ?? loggingCorrelationId;
  }
  let pushId: string | undefined;
  let pushFinal = false;
  if (channel === 'boxel-cli') {
    pushId = contextValue(headers.get(PUSH_ID_HEADER));
    pushFinal =
      pushId !== undefined &&
      headers.get(PUSH_FINAL_HEADER)?.trim().toLowerCase() === 'true';
  }
  return {
    channel,
    ...(agent ? { agent } : {}),
    ...(room ? { room } : {}),
    ...(correlationId ? { correlationId } : {}),
    ...(pushId ? { pushId } : {}),
    ...(pushFinal ? { pushFinal: true } : {}),
  };
}

// The context a change event records, from whatever its writer set. A
// writer with no request sets its context in code, sometimes from values it
// doesn't control (the OAuth client a connector acts for names itself), so
// every free-text field passes the same check a header value does, and a
// field that fails it is dropped. A channel the event can't name is `api`.
// An intent is checked too (`eventIntent`).
export function writeContextForEvent(context: WriteContext): WriteContext {
  let channel: WriteChannel = WRITE_CHANNELS.includes(context.channel)
    ? context.channel
    : 'api';
  let agent = contextValue(context.agent);
  let room = contextValue(context.room);
  let operationId = contextValue(context.operationId);
  let correlationId = contextValue(context.correlationId);
  let pushId = contextValue(context.pushId);
  let intent = eventIntent(context.intent);
  return {
    channel,
    ...(agent ? { agent } : {}),
    ...(room ? { room } : {}),
    ...(operationId ? { operationId } : {}),
    ...(correlationId ? { correlationId } : {}),
    ...(pushId ? { pushId } : {}),
    ...(pushId && context.pushFinal ? { pushFinal: true } : {}),
    ...(intent ? { intent } : {}),
  };
}

// A string in an intent reaches the revision message, as `Boxel-Revert-Of`
// and in the subject. A realm path may legally hold a line break, and git
// can't carry one there, or a NUL anywhere in a message.
const CONTROL_CHARACTER = /\p{Cc}/u;

function intentString(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    !CONTROL_CHARACTER.test(value)
  );
}

// The intent a change event records: one of the known kinds, rebuilt from
// its own fields. An intent whose kind is unknown, or one of whose strings
// is empty or holds a control character, is dropped whole, and its event
// records an ordinary write.
function eventIntent(
  intent: ChangeIntent | undefined,
): ChangeIntent | undefined {
  switch (intent?.kind) {
    case 'revert':
      return intentString(intent.revision) && intentString(intent.path)
        ? {
            kind: 'revert',
            revision: intent.revision,
            path: intent.path,
            forced: intent.forced === true,
          }
        : undefined;
    case 'scan':
      return (intent.source === undefined || intentString(intent.source)) &&
        (intent.commit === undefined || intentString(intent.commit))
        ? {
            kind: 'scan',
            ...(intent.source !== undefined ? { source: intent.source } : {}),
            ...(intent.commit !== undefined ? { commit: intent.commit } : {}),
          }
        : undefined;
    case 'delete-realm':
      return { kind: 'delete-realm' };
    default:
      return undefined;
  }
}

// What the write path hands the journal for one write. `author` is the
// effective authenticated user's Matrix id, the realm's bot for a write with
// no user, or `SYSTEM_AUTHOR`. `partial` marks a batch that failed partway:
// the changes are the paths that landed.
export interface ChangeEventInput extends WriteContext {
  realmURL: string;
  author: string;
  partial?: boolean;
  changes: ChangeEventChange[];
}

// A journal row as a reader sees it. `xid` is the inserting transaction's id,
// a `xid8` carried as text, by which realm-historian orders its reads.
export interface ChangeEvent extends ChangeEventInput {
  seq: number;
  xid: string;
  realmId: string;
  occurredAt: string;
}

// The change journal. `append` runs on the write's own transaction, through
// its `Querier`, so the event commits with the write's file meta or not at
// all. It writes nothing for a realm whose recording is off, or that is
// published, and says whether it wrote.
//
// A writer never calls `append` itself. It appends through `withChangeEvent`,
// or through `appendStandaloneChangeEvent` when it has no transaction of its
// own. Those two own the savepoint, the rollback and the
// `boxel:change-journal` record.
export interface ChangeJournal {
  append(querier: Querier, event: ChangeEventInput): Promise<boolean>;
}

// The savepoint a writer's change event is appended under.
const CHANGE_JOURNAL_SAVEPOINT = 'change_journal';

// What one append did: the part of its `boxel:change-journal` record that the
// event doesn't already say.
type AppendResult = Pick<
  ChangeJournalEvent,
  'outcome' | 'durationMs' | 'error'
>;

// Runs a writer's transaction with its change event appended on it, and
// reports the append once that transaction has finished. Every writer whose
// event commits with its own write appends this way.
//
// `transaction` opens the writer's transaction and calls `appendChangeEvent`
// with the transaction's querier once on every run of its body. A transaction
// that is retried from the start appends again, and only its last run's
// append is reported. `appendChangeEvent` does nothing when there is no
// journal or no event. A transaction that commits without having called it
// loses its event, which is logged as an error.
//
// The append runs under a savepoint, so a journal failure doesn't fail the
// write: the transaction rolls back to the savepoint, the rest of it still
// commits, and reconciliation records the change unattributed. If rolling back
// to the savepoint fails too, `appendChangeEvent` throws, and the write fails
// with it. Carrying on would leave the transaction aborted, and Postgres
// answers the COMMIT of an aborted transaction with ROLLBACK and no error, so
// the write would report success with its own rows silently rolled back.
//
// Nothing is reported while the transaction is open. An event the journal
// wrote is reported `written` only once `transaction` resolves, which is once
// the event has committed. If `transaction` rejects instead, the event rolled
// back with it and is reported `failed`, with the transaction's error.
export async function withChangeEvent<T>(
  journal: ChangeJournal | undefined,
  event: ChangeEventInput | undefined,
  transaction: (
    appendChangeEvent: (querier: Querier) => Promise<void>,
  ) => Promise<T>,
): Promise<T> {
  // Cast, so the compiler doesn't narrow it to `undefined` for good: only
  // `appendChangeEvent` assigns it.
  let appended = undefined as AppendResult | undefined;
  let appendChangeEvent = async (querier: Querier): Promise<void> => {
    if (!journal || !event) {
      return;
    }
    appended = undefined;
    let started = performance.now();
    await querier([`SAVEPOINT ${CHANGE_JOURNAL_SAVEPOINT}`]);
    let written: boolean;
    try {
      written = await journal.append(querier, event);
    } catch (appendError: unknown) {
      appended = {
        outcome: 'failed',
        durationMs: elapsedMs(started),
        error: errorMessage(appendError),
      };
      await rollBackAppend(querier, event, appendError);
      return;
    }
    appended = {
      outcome: written ? 'written' : 'skipped',
      durationMs: elapsedMs(started),
    };
    await querier([`RELEASE SAVEPOINT ${CHANGE_JOURNAL_SAVEPOINT}`]);
  };

  let result: T;
  try {
    result = await transaction(appendChangeEvent);
  } catch (transactionError: unknown) {
    if (event && appended) {
      reportAppend(
        event,
        appended.outcome === 'written'
          ? {
              outcome: 'failed',
              durationMs: appended.durationMs,
              error: errorMessage(transactionError),
            }
          : appended,
      );
    }
    throw transactionError;
  }
  if (event && appended) {
    reportAppend(event, appended);
  } else if (journal && event) {
    changeJournalLog().error(
      `${describeEvent(event)} was never appended: its writer's transaction committed without calling appendChangeEvent`,
    );
  }
  return result;
}

// Appends a change event for a writer with no transaction to commit it with,
// such as realm-historian's deploy scan. `querier` commits each statement as
// it runs, so there is no savepoint to roll back to, and the append is
// reported as soon as the journal answers. A failure is reported and then
// thrown, for the writer to handle.
export async function appendStandaloneChangeEvent(
  querier: Querier,
  journal: ChangeJournal,
  event: ChangeEventInput,
): Promise<boolean> {
  let started = performance.now();
  let written: boolean;
  try {
    written = await journal.append(querier, event);
  } catch (error: unknown) {
    reportAppend(event, {
      outcome: 'failed',
      durationMs: elapsedMs(started),
      error: errorMessage(error),
    });
    throw error;
  }
  reportAppend(event, {
    outcome: written ? 'written' : 'skipped',
    durationMs: elapsedMs(started),
  });
  return written;
}

async function rollBackAppend(
  querier: Querier,
  event: ChangeEventInput,
  appendError: unknown,
): Promise<void> {
  try {
    await querier([`ROLLBACK TO SAVEPOINT ${CHANGE_JOURNAL_SAVEPOINT}`]);
  } catch (rollbackError: unknown) {
    changeJournalLog().error(
      `could not append ${describeEvent(event)} to the change journal, nor roll back to the journal's savepoint, so the write fails. The append: ${stringifyErrorForLog(appendError)} The rollback: ${stringifyErrorForLog(rollbackError)}`,
    );
    throw rollbackError;
  }
  changeJournalLog().error(
    `could not append ${describeEvent(event)} to the change journal; reconciliation will record the change unattributed: ${stringifyErrorForLog(appendError)}`,
  );
}

function reportAppend(
  event: ChangeEventInput,
  { outcome, durationMs, error }: AppendResult,
): void {
  emitChangeJournal({
    realm: event.realmURL,
    outcome,
    durationMs,
    paths: event.changes.length,
    partial: event.partial === true,
    ...(error !== undefined ? { error } : {}),
  });
}

// "the change event for 2 path(s) in <realm>", or "the scan event for <realm>"
// for an event that names no paths.
function describeEvent(event: ChangeEventInput): string {
  let kind = event.intent?.kind ?? 'change';
  return event.changes.length > 0
    ? `the ${kind} event for ${event.changes.length} path(s) in ${event.realmURL}`
    : `the ${kind} event for ${event.realmURL}`;
}

function elapsedMs(started: number): number {
  return Math.round(performance.now() - started);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

let log: ReturnType<typeof logger> | undefined;

function changeJournalLog(): ReturnType<typeof logger> {
  return (log ??= logger('realm:change-journal'));
}

// A write under `path` the journal holds and the historian has not yet
// recorded.
export interface PendingWrite {
  seq: number;
  author: string;
  channel: WriteChannel;
  correlationId?: string;
  occurredAt: string;
  paths: string[];
}

// Why a change carries no diff: its content is binary, its diff is larger
// than the per-file cap, the response's diff budget was spent before it, or
// one side of it is a size-only entry, whose content history doesn't keep.
export type DiffOmitted =
  | 'binary'
  | 'too-large'
  | 'budget'
  | 'content-not-kept';

export interface RevisionChange {
  path: string;
  status: ChangeStatus;
  // Git blob ids, or a tree id for a size-only entry. They identify content
  // within history, and are not the `content-hash.ts` fingerprint.
  beforeBlob?: string;
  afterBlob?: string;
  // The file's size after the change, or before it for a deletion. A
  // size-only entry's is the size its marker records.
  size?: number;
  // The file's section of `git diff-tree -p`, when diffs were asked for.
  diff?: string;
  diffOmitted?: DiffOmitted;
}

export interface RevisionSummary {
  id: string;
  parent?: string;
  // A Matrix user id, or `SYSTEM_AUTHOR`.
  author: string;
  // The last write's time, as an ISO timestamp.
  timestamp: string;
  // The message without its trailer block.
  message: string;
  // The `Boxel-*` trailers by their git names, such as `Boxel-Channel`.
  trailers: Record<string, string[]>;
  // A revision that records what changed while nothing recorded the realm.
  gap?: boolean;
  changes: RevisionChange[];
}

export interface ReadHistoryParams {
  // The path filters. Each is a file path, a directory ending in `/`, or `/`
  // for the whole realm, relative to the realm with no leading slash
  // needed. A revision is listed when it changes a path under any of them,
  // and its changes elsewhere are left out. Absent means the whole realm,
  // and an empty list matches nothing.
  paths?: string[];
  // At most `MAX_HISTORY_LIMIT`.
  limit?: number;
  // A revision a previous page ended on: the listing continues after it.
  before?: string;
  includeDiffs?: boolean;
  status?: ChangeStatus;
  correlationId?: string;
}

export const DEFAULT_HISTORY_LIMIT = 50;
export const MAX_HISTORY_LIMIT = 500;

export interface HistoryUnavailable {
  kind: 'history-unavailable';
}

export type ReadHistoryResult =
  | {
      kind: 'history';
      // Newest first, except a superseded write's revision, which changed
      // nothing under the paths: it follows the oldest listed revision whose
      // `Boxel-Includes-Superseded` names it, so a newer revision that
      // changed another path under the filters can come after it.
      revisions: RevisionSummary[];
      // Whether a page after this one may list more.
      hasMore: boolean;
      diffsTruncated?: boolean;
    }
  // `before` names no revision in the realm's history.
  | { kind: 'revision-not-found' }
  | HistoryUnavailable;

export type ReadAtRevisionResult =
  | {
      kind: 'file';
      // UTF-8 text, or base64 when `binary` is set. A `range` is always
      // base64, so the parts of a file join back into its bytes.
      content: string;
      binary: boolean;
      // The whole file's size.
      size: number;
      // The bytes returned, when a range was asked for.
      range?: { start: number; length: number };
    }
  | {
      kind: 'directory';
      entries: { name: string; kind: 'file' | 'directory' }[];
    }
  | { kind: 'too-large'; size: number }
  | { kind: 'content-not-kept'; size: number }
  | {
      kind:
        | 'revision-not-found'
        | 'path-not-found-at-revision'
        | 'path-deleted-at-revision';
    }
  | HistoryUnavailable;

// A file in a revision's tree. `id` is its blob id, or its tree id when it
// is a size-only entry, whose content history doesn't keep.
export interface TreeFileAtRevision {
  path: string;
  id: string;
  size: number;
  sizeOnly?: true;
}

export type ReadTreeAtRevisionResult =
  | { kind: 'tree'; files: TreeFileAtRevision[] }
  | {
      kind:
        | 'revision-not-found'
        | 'path-not-found-at-revision'
        | 'path-deleted-at-revision';
    }
  | HistoryUnavailable;

// Reads a realm's history from its repo. Runs in the realm server, with
// read-only git commands, and never calls realm-historian. `realmId` is the
// realm's `realm_registry.id`, which keys its repo.
export interface RealmHistoryReader {
  readHistory(
    realmId: string,
    params: ReadHistoryParams,
  ): Promise<ReadHistoryResult>;
  // A file's content, or a directory's listing, at `revision`. `path` is a
  // file, a directory ending in `/`, or `/` for the realm's root.
  readAtRevision(
    realmId: string,
    revision: string,
    path: string,
    range?: { start: number; length: number },
  ): Promise<ReadAtRevisionResult>;
  // Every file at or under `path` at `revision`: the whole realm when `path`
  // is absent or `/`.
  readTreeAtRevision(
    realmId: string,
    revision: string,
    path?: string,
  ): Promise<ReadTreeAtRevisionResult>;
}

const HISTORY_UNAVAILABLE: HistoryUnavailable = { kind: 'history-unavailable' };

// The reader of a realm that records no history, such as the in-browser
// realm: every read answers `history-unavailable`.
export const unavailableHistoryReader: RealmHistoryReader = {
  async readHistory() {
    return HISTORY_UNAVAILABLE;
  },
  async readAtRevision() {
    return HISTORY_UNAVAILABLE;
  },
  async readTreeAtRevision() {
    return HISTORY_UNAVAILABLE;
  },
};

// The realm's history collaborators, injected by the realm server. A realm
// with none emits no events and answers `history-unavailable`.
export interface RealmHistory {
  journal: ChangeJournal;
  reader?: RealmHistoryReader;
}
