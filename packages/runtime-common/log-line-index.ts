// The lines of a realm's append-only logs as rows (`boxel_log_lines`), kept
// in step with the files, so a query can filter, sort and count a subset of
// a log without reading the file (`log-query.ts`).
//
// A log is a `.jsonl` or `.log` file written one line at a time. Keeping its
// rows costs what was added, never the whole log:
//
// - Write-through. When the realm appends to a log (`record`, `appendLine`)
//   it knows the bytes it wrote and where they landed, so it inserts their
//   rows itself, right after the append (`appendThroughLogIndex`), reading
//   nothing. The line is searchable when the append returns, and the index
//   pass that follows finds the log's size equal to what is indexed and
//   reads nothing either.
// - Incremental. Any other growth (an append the write-through could not
//   place, a partial line completed later) is read from the indexed offset
//   on: the new complete lines are inserted, and a trailing partial line
//   waits for its terminator. Before trusting the indexed prefix, the pass
//   re-reads the last indexed line and compares it with its stored md5.
// - Full resync, the rare path: when nothing is indexed yet, the file
//   shrank, the last indexed line changed, or the realm wrote the file some
//   other way than appending (a file `update`, which marks the state stale,
//   `markLogRewritten`). It reads the whole file and rebuilds the rows, and
//   is counted (`logLineSyncStats`) and logged.
//
// `boxel_log_files` holds, per log: the line count; the byte offset just past
// the last complete indexed line; a running hash of the indexed lines (each
// line's md5 folded into the previous value, so it extends without reading
// the prefix); and the byte length and md5 of the last indexed line.
//
// What that guarantees: every append the realm makes is indexed exactly, and
// any change that moves the file's size below the offset, or changes the last
// indexed line, is caught and rebuilt. A change made outside the realm (the
// file edited on disk) that keeps the last indexed line intact and only
// rewrites earlier bytes is not seen until the log is resynced; the realm's
// own non-append writes always are.
//
// Two syncs of one log never interleave: each takes a transaction-scoped
// advisory lock on the log's URL.
//
// Postgres only, like the other derived tables the writer keeps.

import type { DBAdapter } from './db.ts';
import { md5 } from 'super-fast-md5';
import { param, type Expression, type PgPrimitive } from './expression.ts';
import { logger } from './log.ts';

const log = logger('realm:log-lines');

// What reads a log's bytes. `read(url, start, end?)` answers bytes
// `[start, end)` (to the end of the file when `end` is omitted) and the
// file's size, or undefined when there is no file. A range past the end
// answers no bytes, and is what a reader that serves ranges answers without
// reading anything. A plain text reader (`(url) => { content }`) is read whole
// and sliced, for callers that hold the text anyway.
export interface LogFileSource {
  read(
    url: string,
    start: number,
    end?: number,
  ): Promise<{ bytes: Uint8Array; size: number } | undefined>;
}

export type LogFileReader =
  | ((url: string) => Promise<{ content: string } | undefined>)
  | LogFileSource;

export function logFileSource(reader: LogFileReader): LogFileSource {
  if (typeof reader !== 'function') {
    return reader;
  }
  return {
    async read(url, start, end) {
      let file = await reader(url);
      if (!file) return undefined;
      let all = new TextEncoder().encode(file.content);
      let from = Math.min(start, all.byteLength);
      let to = Math.min(end ?? all.byteLength, all.byteLength);
      return {
        bytes: all.subarray(from, Math.max(from, to)),
        size: all.byteLength,
      };
    },
  };
}

// How often each sync path ran in this process, for tests and diagnostics.
export const logLineSyncStats = {
  writeThrough: 0,
  incremental: 0,
  unchanged: 0,
  fullResync: 0,
  fullResyncReasons: {} as Record<string, number>,
};

export interface LogLineIndexHost {
  dbAdapter: DBAdapter;
  realmURL: string;
  query(expression: Expression): Promise<Record<string, PgPrimitive>[]>;
  readLogFile: LogFileReader | undefined;
}

export interface LogLineRow {
  line_no: number;
  at: string | null;
  actor: string | null;
  entry: Record<string, unknown>;
}

// A vector sidecar is JSON Lines too, but it's its card's vectors, not a log.
export function isLogFileURL(url: string): boolean {
  return (
    (url.endsWith('.jsonl') && !url.endsWith('.vectors.jsonl')) ||
    url.endsWith('.log')
  );
}

// LogFile's `record` writes `yyyy-mm-dd hh:mm:ss <actor> <what>`.
const LOG_LINE = /^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d) (\S+) (.*)$/;

// A line's time as an ISO instant, or null. Only an ISO 8601 time is a time:
// `yyyy-mm-dd hh:mm:ss` (what `record` writes, from the realm's NOW(), which
// is UTC) and an ISO time with no zone are read as UTC, whatever the server's
// own zone; any other text (`March 7`, which `Date.parse` would read in the
// server's zone) is no time.
export function logTimeOrNull(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  let ms = parseISOTimeAsUTC(value.trim());
  return ms === undefined ? null : new Date(ms).toISOString();
}

const ISO_TIME =
  /^(\d{4})-(\d\d)-(\d\d)(?:[T ](\d\d):(\d\d)(?::(\d\d)(?:\.(\d{1,9}))?)?)?(Z|[+-]\d\d:?\d\d)?$/i;

// Milliseconds since 1970 for an ISO 8601 date or date-time, a missing zone
// read as UTC; undefined for anything else, a day or hour out of range
// included (`2026-13-45`).
export function parseISOTimeAsUTC(value: string): number | undefined {
  let m = ISO_TIME.exec(value);
  if (!m) {
    return undefined;
  }
  let [, y, mo, d, h = '00', mi = '00', s = '00', frac = '', zone] = m;
  let [year, month, day, hour, minute, second] = [y, mo, d, h, mi, s].map(
    Number,
  );
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return undefined;
  }
  let ms = Date.UTC(
    year,
    month - 1,
    day,
    hour,
    minute,
    second,
    Number(frac.slice(0, 3).padEnd(3, '0')),
  );
  // Date.UTC rolls an impossible day over (February 30 is March 2).
  if (new Date(ms).getUTCDate() !== day) {
    return undefined;
  }
  if (zone && zone.toUpperCase() !== 'Z') {
    let sign = zone[0] === '-' ? -1 : 1;
    let digits = zone.slice(1).replace(':', '');
    let offset = Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2));
    if (Number(digits.slice(0, 2)) > 23 || Number(digits.slice(2)) > 59) {
      return undefined;
    }
    ms -= sign * offset * 60_000;
  }
  return Number.isFinite(ms) ? ms : undefined;
}

// One line of a log as a row. `lineNo` counts from 1.
export function parseLogLine(
  line: string,
  lineNo: number,
  kind: 'jsonl' | 'log',
): LogLineRow {
  if (kind === 'log') {
    let m = LOG_LINE.exec(line);
    return m
      ? {
          line_no: lineNo,
          at: logTimeOrNull(m[1]),
          actor: m[2],
          entry: { text: m[3] },
        }
      : { line_no: lineNo, at: null, actor: null, entry: { text: line } };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { line_no: lineNo, at: null, actor: null, entry: { text: line } };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {
      line_no: lineNo,
      at: null,
      actor: null,
      entry: { value: parsed as unknown },
    };
  }
  let entry = { ...(parsed as Record<string, unknown>) };
  // JSONLFile's `record` takes `what` as a string, so a caller's structured
  // event arrives encoded inside it. Decoded here, a query reaches its fields.
  if (typeof entry.what === 'string' && /^\s*[[{]/.test(entry.what)) {
    try {
      entry.what = JSON.parse(entry.what);
    } catch {
      // Not JSON after all; it stays the string it was.
    }
  }
  return {
    line_no: lineNo,
    at: logTimeOrNull(entry.at),
    actor: typeof entry.actor === 'string' ? entry.actor : null,
    entry,
  };
}

// The complete lines of a log's content: a final segment without its newline
// is still being written.
export function completeLines(content: string): string[] {
  let lines = content.split('\n');
  lines.pop();
  return lines.map((line) => line.replace(/\r$/, ''));
}

const INSERT_CHUNK = 1000;

async function insertLines(
  host: LogLineIndexHost,
  url: string,
  rows: LogLineRow[],
) {
  for (let start = 0; start < rows.length; start += INSERT_CHUNK) {
    let chunk = rows.slice(start, start + INSERT_CHUNK);
    await host.query([
      'INSERT INTO boxel_log_lines (realm_url, url, line_no, at, actor, entry)',
      'SELECT',
      param(host.realmURL),
      ',',
      param(url),
      ', x.line_no, x.at, x.actor, x.entry',
      'FROM jsonb_to_recordset(',
      param(JSON.stringify(chunk)),
      '::jsonb) AS x(line_no integer, at timestamptz, actor text, entry jsonb)',
      'ON CONFLICT ON CONSTRAINT boxel_log_lines_pkey DO UPDATE SET',
      'at = EXCLUDED.at, actor = EXCLUDED.actor, entry = EXCLUDED.entry',
    ] as Expression);
  }
}

async function dropFile(host: LogLineIndexHost, url: string) {
  await host.query([
    'DELETE FROM boxel_log_lines WHERE realm_url =',
    param(host.realmURL),
    'AND url =',
    param(url),
  ] as Expression);
  await host.query([
    'DELETE FROM boxel_log_files WHERE url =',
    param(url),
  ] as Expression);
}

const NEWLINE = 0x0a;
const decoder = new TextDecoder();

function md5Hex(bytes: Uint8Array): string {
  return md5(bytes);
}

// The running hash after `line` (its bytes, newline included).
function extendHash(previous: string, line: Uint8Array): string {
  return md5(new TextEncoder().encode(`${previous}:${md5Hex(line)}`));
}

const EMPTY_HASH = md5(new Uint8Array());

interface LogFileState {
  lineCount: number;
  offset: number;
  hash: string;
  lastLineLength: number;
  lastLineHash: string | null;
}

// The complete lines of `bytes` (each with its newline), and how many bytes
// they span; a final segment without its newline is not a line yet.
function splitLines(bytes: Uint8Array): {
  lines: Uint8Array[];
  length: number;
} {
  let lines: Uint8Array[] = [];
  let start = 0;
  for (let i = 0; i < bytes.byteLength; i++) {
    if (bytes[i] === NEWLINE) {
      lines.push(bytes.subarray(start, i + 1));
      start = i + 1;
    }
  }
  return { lines, length: start };
}

function lineText(line: Uint8Array): string {
  return decoder.decode(line).replace(/\r?\n$/, '');
}

// Holds the log's advisory lock until the enclosing transaction ends, so two
// syncs of one log run one after the other (see the header).
async function lockLog(host: LogLineIndexHost, url: string) {
  await host.query([
    'SELECT pg_advisory_xact_lock(hashtextextended(',
    param(`boxel_log_lines:${url}`),
    ', 0))',
  ] as Expression);
}

async function readState(
  host: LogLineIndexHost,
  url: string,
): Promise<LogFileState | undefined> {
  let [row] = (await host.query([
    'SELECT line_count, prefix_length, prefix_hash, last_line_length, last_line_hash FROM boxel_log_files WHERE url =',
    param(url),
  ] as Expression)) as Record<string, PgPrimitive>[];
  if (
    !row ||
    row.prefix_hash == null ||
    row.prefix_length == null ||
    row.last_line_length == null
  ) {
    // No state, or one marked stale (`markLogRewritten`) or written by an
    // earlier version of this module: the log is resynced whole.
    return undefined;
  }
  return {
    lineCount: Number(row.line_count),
    offset: Number(row.prefix_length),
    hash: String(row.prefix_hash),
    lastLineLength: Number(row.last_line_length),
    lastLineHash:
      row.last_line_hash == null ? null : String(row.last_line_hash),
  };
}

async function hasStateRow(host: LogLineIndexHost, url: string) {
  let rows = (await host.query([
    'SELECT 1 FROM boxel_log_files WHERE url =',
    param(url),
  ] as Expression)) as unknown[];
  return rows.length > 0;
}

async function writeState(
  host: LogLineIndexHost,
  url: string,
  state: LogFileState,
) {
  await host.query([
    'INSERT INTO boxel_log_files (url, realm_url, line_count, prefix_length, prefix_hash, last_line_length, last_line_hash) VALUES (',
    param(url),
    ',',
    param(host.realmURL),
    ',',
    param(state.lineCount),
    ',',
    param(state.offset),
    ',',
    param(state.hash),
    ',',
    param(state.lastLineLength),
    ',',
    param(state.lastLineHash),
    ') ON CONFLICT (url) DO UPDATE SET line_count = EXCLUDED.line_count,',
    'prefix_length = EXCLUDED.prefix_length, prefix_hash = EXCLUDED.prefix_hash,',
    'last_line_length = EXCLUDED.last_line_length, last_line_hash = EXCLUDED.last_line_hash,',
    'realm_url = EXCLUDED.realm_url',
  ] as Expression);
}

// Inserts `lines` after `state`'s last line, and answers the state after
// them.
async function addLines(
  host: LogLineIndexHost,
  url: string,
  state: LogFileState,
  lines: Uint8Array[],
): Promise<LogFileState> {
  let kind: 'jsonl' | 'log' = url.endsWith('.log') ? 'log' : 'jsonl';
  let rows = lines.map((line, i) =>
    parseLogLine(lineText(line), state.lineCount + i + 1, kind),
  );
  await insertLines(host, url, rows);
  let next = { ...state };
  for (let line of lines) {
    next.lineCount++;
    next.offset += line.byteLength;
    next.hash = extendHash(next.hash, line);
    next.lastLineLength = line.byteLength;
    next.lastLineHash = md5Hex(line);
  }
  return next;
}

const EMPTY_STATE: LogFileState = {
  lineCount: 0,
  offset: 0,
  hash: EMPTY_HASH,
  lastLineLength: 0,
  lastLineHash: null,
};

async function fullResync(
  host: LogLineIndexHost,
  url: string,
  source: LogFileSource,
  reason: string,
): Promise<{ inserted: number; rebuilt: boolean }> {
  let file = await source.read(url, 0);
  if (!file) {
    await dropFile(host, url);
    return { inserted: 0, rebuilt: false };
  }
  logLineSyncStats.fullResync++;
  logLineSyncStats.fullResyncReasons[reason] =
    (logLineSyncStats.fullResyncReasons[reason] ?? 0) + 1;
  if (reason !== 'first-sync') {
    log.info(`log ${url}: rebuilding its line rows (${reason})`);
  }
  await host.query([
    'DELETE FROM boxel_log_lines WHERE realm_url =',
    param(host.realmURL),
    'AND url =',
    param(url),
  ] as Expression);
  let { lines } = splitLines(file.bytes);
  let state = await addLines(host, url, EMPTY_STATE, lines);
  await writeState(host, url, state);
  return { inserted: lines.length, rebuilt: true };
}

// Brings one log's rows in step with its file, reading only what was added
// since it was last indexed where it can (see the header). Returns how many
// lines it inserted and whether it rebuilt the file's rows. Run it inside a
// transaction (an index pass's swap, or `withTransaction`): its lock lasts
// as long as that.
export async function syncLogFile(
  host: LogLineIndexHost,
  url: string,
): Promise<{ inserted: number; rebuilt: boolean }> {
  // A batch that can't read files (an error batch) leaves the rows as they
  // are, rather than reading "no reader" as "the file is gone".
  if (!host.readLogFile) {
    return { inserted: 0, rebuilt: false };
  }
  let source = logFileSource(host.readLogFile);
  await lockLog(host, url);
  let state = await readState(host, url);
  if (!state) {
    return await fullResync(
      host,
      url,
      source,
      (await hasStateRow(host, url)) ? 'rewritten' : 'first-sync',
    );
  }
  // Only what lies past the indexed offset: nothing at all when the log has
  // not grown.
  let added = await source.read(url, state.offset);
  if (!added) {
    await dropFile(host, url);
    return { inserted: 0, rebuilt: false };
  }
  if (added.size < state.offset) {
    return await fullResync(host, url, source, 'shrank');
  }
  if (added.size === state.offset) {
    logLineSyncStats.unchanged++;
    return { inserted: 0, rebuilt: false };
  }
  // The log grew. The bytes before the offset are trusted once the last
  // indexed line reads as it did when it was indexed.
  if (state.lastLineLength > 0) {
    let last = await source.read(
      url,
      state.offset - state.lastLineLength,
      state.offset,
    );
    if (!last || md5Hex(last.bytes) !== state.lastLineHash) {
      return await fullResync(host, url, source, 'edited');
    }
  }
  let { lines } = splitLines(added.bytes);
  if (lines.length === 0) {
    // Only a partial line so far.
    logLineSyncStats.unchanged++;
    return { inserted: 0, rebuilt: false };
  }
  logLineSyncStats.incremental++;
  await writeState(host, url, await addLines(host, url, state, lines));
  return { inserted: lines.length, rebuilt: false };
}

// The realm's own append, indexed as it lands: `appended` are the bytes it
// added, and `sizeAfter` the file's size once they were. When the indexed
// offset is exactly where they began, their complete lines are inserted and
// the state moves past them, reading nothing. Otherwise (nothing indexed
// yet, a partial line before them, another writer's bytes in between) it
// does nothing, and the index pass syncs the log. Answers whether it
// indexed the append. Run it inside a transaction.
export async function appendThroughLogIndex(
  host: LogLineIndexHost,
  url: string,
  appended: string | Uint8Array,
  sizeAfter: number,
): Promise<boolean> {
  if (host.dbAdapter.kind !== 'pg' || !isLogFileURL(url)) {
    return false;
  }
  let bytes =
    typeof appended === 'string'
      ? new TextEncoder().encode(appended)
      : appended;
  await lockLog(host, url);
  let state = await readState(host, url);
  if (!state || state.offset !== sizeAfter - bytes.byteLength) {
    return false;
  }
  let { lines } = splitLines(bytes);
  if (lines.length === 0) {
    return false;
  }
  logLineSyncStats.writeThrough++;
  await writeState(host, url, await addLines(host, url, state, lines));
  return true;
}

// The realm wrote a log some other way than appending (a file `update`): its
// indexed lines can no longer be trusted, so its next sync rebuilds them.
export async function markLogRewritten(host: LogLineIndexHost, url: string) {
  if (host.dbAdapter.kind !== 'pg' || !isLogFileURL(url)) {
    return;
  }
  await host.query([
    'UPDATE boxel_log_files SET prefix_hash = NULL WHERE url =',
    param(url),
  ] as Expression);
}

// The log's file meta counts its lines from the line index rather than by
// reading the file (the file-def extraction of a log reads only its head and
// tail): its complete lines, and a final one still waiting for its newline.
// Runs in the swap, once the pass's file row is in the index.
async function stampLineCount(host: LogLineIndexHost, url: string) {
  let count = [
    '(SELECT to_jsonb(f.line_count + CASE WHEN',
    "COALESCE((i.pristine_doc->'attributes'->>'contentSize')::bigint, 0) > COALESCE(f.prefix_length, 0)",
    'THEN 1 ELSE 0 END) FROM boxel_log_files AS f WHERE f.url =',
    param(url),
    ')',
  ];
  await host.query([
    'UPDATE boxel_index AS i SET',
    "pristine_doc = jsonb_set(i.pristine_doc, '{attributes,lineCount}',",
    ...count,
    '),',
    "search_doc = CASE WHEN i.search_doc ? 'lineCount' THEN jsonb_set(i.search_doc, '{lineCount}',",
    ...count,
    ') ELSE i.search_doc END',
    'WHERE i.realm_url =',
    param(host.realmURL),
    'AND i.url = ',
    param(url),
    "AND i.type = 'file' AND jsonb_typeof(i.pristine_doc->'attributes') = 'object'",
    'AND EXISTS (SELECT 1 FROM boxel_log_files AS f WHERE f.url =',
    param(url),
    ')',
  ] as Expression);
}

// Every log among a pass's invalidated URLs.
export async function syncLogLineIndex(
  host: LogLineIndexHost,
  invalidations: string[],
): Promise<void> {
  if (host.dbAdapter.kind !== 'pg') {
    return;
  }
  // The realm's partition of the lines is not made here: this runs inside
  // the index pass's swap transaction, and making one takes a transaction of
  // its own (`log-line-partitions.ts`), which a pool with one connection to
  // spare would wait on forever. Lines a pass writes before the realm has
  // its partition land in the DEFAULT one, and move when it is made: by the
  // realm's first append, or its first log query.
  for (let url of invalidations) {
    if (isLogFileURL(url)) {
      await syncLogFile(host, url);
      await stampLineCount(host, url);
    }
  }
}
