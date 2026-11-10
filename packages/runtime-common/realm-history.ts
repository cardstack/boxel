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

import type { Querier } from './expression.ts';
import {
  X_BOXEL_LOGGING_CORRELATION_ID_HEADER,
  sanitizeLoggingCorrelationId,
} from './prerender-headers.ts';

// How a write was made. The realm server sets `operations`, `system`,
// `deploy` and `mcp` itself. `host`, `ai-assistant` and `boxel-cli` are what
// a client may claim in `X-Boxel-Write-Channel`. `api` is a write whose
// request names no channel.
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

// The longest header value a write's context keeps. Values become git
// trailers, so a value is also refused when it holds anything but printable
// ASCII: a newline in one would forge a trailer of its own.
const MAX_CONTEXT_VALUE_LENGTH = 256;
const CONTEXT_VALUE_PATTERN = /^[\x20-\x7E]+$/;

function contextValue(raw: string | null): string | undefined {
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
// - `pushFinal` marks the last request of a push, so it is kept only beside a
//   push id.
//
// Writes the realm server makes without a request set their context
// themselves. `/mcp` sets `channel: 'mcp'`, with the OAuth client as `agent`
// and the connector's `writeId` as `correlationId`.
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
  let pushId = contextValue(headers.get(PUSH_ID_HEADER));
  let pushFinal =
    pushId !== undefined &&
    headers.get(PUSH_FINAL_HEADER)?.trim().toLowerCase() === 'true';
  return {
    channel,
    ...(agent ? { agent } : {}),
    ...(room ? { room } : {}),
    ...(correlationId ? { correlationId } : {}),
    ...(pushId ? { pushId } : {}),
    ...(pushFinal ? { pushFinal: true } : {}),
  };
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
export interface ChangeJournal {
  append(querier: Querier, event: ChangeEventInput): Promise<boolean>;
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

export interface RevisionChange {
  path: string;
  status: ChangeStatus;
  // Git blob ids, or a tree id for a size-only entry. They identify content
  // within history, and are not the `content-hash.ts` fingerprint.
  beforeBlob?: string;
  afterBlob?: string;
  size?: number;
  diff?: string;
}

export interface RevisionSummary {
  id: string;
  parent?: string;
  // A Matrix user id, or `SYSTEM_AUTHOR`.
  author: string;
  // The last write's time, as an ISO timestamp.
  timestamp: string;
  message: string;
  trailers: Record<string, string[]>;
  gap?: boolean;
  changes: RevisionChange[];
}

export interface ReadHistoryParams {
  path?: string;
  limit?: number;
  before?: string;
  includeDiffs?: boolean;
  status?: ChangeStatus;
  correlationId?: string;
}

export interface ReadHistoryResult {
  revisions: RevisionSummary[];
  diffsTruncated?: boolean;
}

export type ReadAtRevisionResult =
  | { kind: 'file'; content: string; binary: boolean; size: number }
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
    };

// Reads a realm's history from its repo. Runs in the realm server, with
// read-only git commands, and never calls realm-historian.
export interface RealmHistoryReader {
  readHistory(
    realmId: string,
    params: ReadHistoryParams,
  ): Promise<ReadHistoryResult>;
  readAtRevision(
    realmId: string,
    revision: string,
    path: string,
    range?: { start: number; length: number },
  ): Promise<ReadAtRevisionResult>;
}

// The realm's history collaborators, injected by the realm server. A realm
// with none emits no events and answers `history-unavailable`.
export interface RealmHistory {
  journal: ChangeJournal;
  reader?: RealmHistoryReader;
}
