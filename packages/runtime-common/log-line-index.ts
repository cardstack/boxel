// The lines of a realm's append-only logs as rows (`boxel_log_lines`), kept
// in step with the files when they're indexed, so a query can filter, sort
// and count a subset of a log without reading the file (`log-query.ts`).
//
// A log is a `.jsonl` or `.log` file written one line at a time. A pass that
// indexes one reads it and compares it with what the table holds
// (`boxel_log_files`: the line count and the hash of the last line). When the
// file has only grown, which is what an append does, only the new lines are
// inserted; when anything earlier changed, the file's rows are rebuilt; when
// the file is gone, its rows go. A line the file doesn't yet end with a
// newline is not a line yet, and waits for its terminator.
//
// Postgres only, like the other derived tables the writer keeps.

import type { DBAdapter } from './db.ts';
import { computeContentHash } from './content-hash.ts';
import { param, type Expression, type PgPrimitive } from './expression.ts';

export type LogFileReader = (
  url: string,
) => Promise<{ content: string } | undefined>;

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

function timeOrNull(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }
  // `yyyy-mm-dd hh:mm:ss` from the realm's NOW() is UTC.
  let iso = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value;
  return Number.isNaN(Date.parse(iso)) ? null : new Date(iso).toISOString();
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
          at: timeOrNull(m[1]),
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
    at: timeOrNull(entry.at),
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
    'DELETE FROM boxel_log_lines WHERE url =',
    param(url),
  ] as Expression);
  await host.query([
    'DELETE FROM boxel_log_files WHERE url =',
    param(url),
  ] as Expression);
}

// Brings one log's rows in step with its file. Returns how many lines it
// inserted and whether it rebuilt the file's rows.
export async function syncLogFile(
  host: LogLineIndexHost,
  url: string,
): Promise<{ inserted: number; rebuilt: boolean }> {
  // A batch that can't read files (an error batch) leaves the rows as they
  // are, rather than reading "no reader" as "the file is gone".
  if (!host.readLogFile) {
    return { inserted: 0, rebuilt: false };
  }
  let file = await host.readLogFile(url);
  if (!file) {
    await dropFile(host, url);
    return { inserted: 0, rebuilt: false };
  }
  let kind: 'jsonl' | 'log' = url.endsWith('.log') ? 'log' : 'jsonl';
  let lines = completeLines(file.content);
  let [state] = (await host.query([
    'SELECT line_count, last_line_hash FROM boxel_log_files WHERE url =',
    param(url),
  ] as Expression)) as { line_count: number; last_line_hash: string | null }[];
  let known = state ? Number(state.line_count) : 0;
  let grew =
    state !== undefined &&
    lines.length >= known &&
    (known === 0 ||
      computeContentHash(lines[known - 1]) === state.last_line_hash);
  let from = grew ? known : 0;
  if (!grew) {
    await host.query([
      'DELETE FROM boxel_log_lines WHERE url =',
      param(url),
    ] as Expression);
  }
  let rows = lines
    .slice(from)
    .map((line, i) => parseLogLine(line, from + i + 1, kind));
  await insertLines(host, url, rows);
  await host.query([
    'INSERT INTO boxel_log_files (url, realm_url, line_count, last_line_hash) VALUES (',
    param(url),
    ',',
    param(host.realmURL),
    ',',
    param(lines.length),
    ',',
    param(lines.length ? computeContentHash(lines[lines.length - 1]) : null),
    ') ON CONFLICT (url) DO UPDATE SET line_count = EXCLUDED.line_count,',
    'last_line_hash = EXCLUDED.last_line_hash, realm_url = EXCLUDED.realm_url',
  ] as Expression);
  return { inserted: rows.length, rebuilt: !grew };
}

// Every log among a pass's invalidated URLs.
export async function syncLogLineIndex(
  host: LogLineIndexHost,
  invalidations: string[],
): Promise<void> {
  if (host.dbAdapter.kind !== 'pg') {
    return;
  }
  for (let url of invalidations) {
    if (isLogFileURL(url)) {
      await syncLogFile(host, url);
    }
  }
}
