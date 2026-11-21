// A log search on SQLite, the browser's index, which keeps no log tables:
// the log's file is read and the query is answered over its parsed lines.
//
// Owns: reading a log's lines from its file within a window, and the line
// evaluator: a log filter, sort, page, total, `select`, group roll-ups and
// facets over parsed lines, and the values a card query's `let` binding
// reads from a log. Each test
// answers as Postgres's SQL for it does (log-query.ts, `LOG_FIELDS`), the SQL
// rule for missing values included: a line with no value at a path matches
// neither a filter on it nor its `not`.
// Must not: run on Postgres (log-query.ts calls it only where the dialect
// keeps no log tables), or answer an invalid query: log-query.ts validates
// every query first, as it does for Postgres.
// Guarantees: within the window the rows are Postgres's. Past it (the newest
// `SQLITE_LOG_LINES` lines across the logs read, at most `SQLITE_LOG_BYTES`
// from the end of each) the answer covers the window, and the warning
// `sqlite-log-window` says how many lines were read of how many; never an
// error. Lines parse as the line index parses them (`parseLogLine`), so a
// line that is not JSON is the `{ text }` Postgres holds for it.

import { refuseLog } from '../query-v2/query-refusals.ts';
import {
  logFileSource,
  parseLogLine,
  type LogFileReader,
} from '../log-line-index.ts';
import { pageTotal } from './index-sql.ts';
import {
  TOTAL_ESTIMATED,
  totalEstimatedMessage,
} from '../query-v2/search-bounds.ts';
import { DEFAULT_FACET_SIZE } from '../query-v2/query-values.ts';
import { localDateInZone } from '../query-v2/time-zone.ts';

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

// The window a SQLite log search reads: the newest lines across the logs it
// reads, and the bytes read from the end of each log.
export const SQLITE_LOG_LINES = 5_000;
export const SQLITE_LOG_BYTES = 4 * 1024 * 1024;

export interface LineWindow {
  lines?: number;
  bytes?: number;
}

// One line of a log, as the line index holds it.
export interface LogLine {
  url: string;
  line_no: number;
  at: string | null;
  actor: string | null;
  entry: Record<string, unknown>;
}

// A log the query reads, and the actor whose lines alone a policy admits.
export interface LineFile {
  url: string;
  actor?: string;
}

// What a filter reads beyond the line: the query's clock, how a `file`
// value names a log, and a time bound as an ISO instant (`resolveLogTime`).
export interface LineContext {
  now: Date;
  fileURL: (value: Json) => string;
  time: (value: Json, now: Date) => string;
}

export interface LogWarning {
  code: string;
  message: string;
}

export function logWindowWarning(read: number, total: number): LogWarning {
  let n = (x: number) => x.toLocaleString('en-US');
  return {
    code: 'sqlite-log-window',
    message: `read the newest ${n(read)} of ${n(total)} lines: this index (SQLite) reads a log from its file, at most ${n(SQLITE_LOG_LINES)} lines and ${SQLITE_LOG_BYTES / (1024 * 1024)} MiB from the end of each log, so counts, totals, facets and roll-ups may be undercounts`,
  };
}

// ---- reading the lines ------------------------------------------------

const NEWLINE = 0x0a;
const decoder = new TextDecoder();

// The lines of `files` within the window, each file's policy scope applied,
// with how many lines were read and how many the files hold. A log whose
// file is not there is refused as Postgres refuses it.
export async function readLogLines(
  files: LineFile[],
  reader: LogFileReader | undefined,
  window: LineWindow = {},
): Promise<{ lines: LogLine[]; read: number; total: number }> {
  let maxLines = window.lines ?? SQLITE_LOG_LINES;
  let maxBytes = window.bytes ?? SQLITE_LOG_BYTES;
  if (files.length === 0) return { lines: [], read: 0, total: 0 };
  if (!reader) {
    throw refuseLog('log-has-no-indexed-lines-yet', { missing: files[0].url });
  }
  let source = logFileSource(reader);
  let kept: LogLine[] = [];
  let total = 0;
  for (let file of files) {
    let read = await source.read(file.url, 0);
    if (!read) {
      throw refuseLog('log-does-not-exist', { absent: file.url });
    }
    let { bytes } = read;
    // The complete lines (a final segment without its newline is not a
    // line yet), and which of them end within the last `maxBytes`.
    let ends: number[] = [];
    for (let i = 0; i < bytes.byteLength; i++) {
      if (bytes[i] === NEWLINE) ends.push(i + 1);
    }
    total += ends.length;
    let kind: 'jsonl' | 'log' = file.url.endsWith('.log') ? 'log' : 'jsonl';
    let first = ends.length;
    let budget = 0;
    while (first > 0) {
      let start = first > 1 ? ends[first - 2] : 0;
      let length = ends[first - 1] - start;
      if (budget + length > maxBytes) break;
      budget += length;
      first--;
    }
    for (let i = first; i < ends.length; i++) {
      let start = i > 0 ? ends[i - 1] : 0;
      let text = decoder
        .decode(bytes.subarray(start, ends[i]))
        .replace(/\r?\n$/, '');
      let row = parseLogLine(text, i + 1, kind);
      kept.push({ url: file.url, ...row });
    }
  }
  if (kept.length > maxLines) {
    if (files.length === 1) {
      kept = kept.slice(kept.length - maxLines);
    } else {
      // Across logs, the newest by time (a line with no time is the
      // oldest), then the later file and line.
      let newest = [...kept].sort(
        (a, b) =>
          compareNullable(timeOf(b.at), timeOf(a.at), false) ||
          compareBytes(b.url, a.url) ||
          b.line_no - a.line_no,
      );
      let chosen = new Set(newest.slice(0, maxLines));
      kept = kept.filter((l) => chosen.has(l));
    }
  }
  let read = kept.length;
  let scoped = new Map(files.map((f) => [f.url, f.actor]));
  let lines = kept.filter((l) => {
    let actor = scoped.get(l.url);
    return actor === undefined || l.actor === actor;
  });
  return { lines, read, total };
}

// ---- what a path reads ------------------------------------------------

const COLUMNS = new Set(['at', 'actor', 'line', 'file']);

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const hasOwn = (o: object, k: string) =>
  Object.prototype.hasOwnProperty.call(o, k);

// `entry #> path`: objects by key, lists by index (from the end when
// negative). Undefined where the path reaches nothing (SQL NULL).
function atPath(entry: unknown, path: string): unknown {
  let at: unknown = entry;
  for (let segment of path.split('.')) {
    if (isObject(at) && hasOwn(at, segment)) {
      at = at[segment];
    } else if (Array.isArray(at) && /^-?\d+$/.test(segment)) {
      let i = Number(segment);
      at = at[i < 0 ? at.length + i : i];
    } else {
      return undefined;
    }
  }
  return at;
}

// The value a containment (`entry @> {path: …}`) reaches: objects by key only.
function containedAt(entry: unknown, path: string): unknown {
  let at: unknown = entry;
  for (let segment of path.split('.')) {
    if (!isObject(at) || !hasOwn(at, segment)) return undefined;
    at = at[segment];
  }
  return at;
}

// jsonb's text form of a value (`#>>`): a string as itself, a JSON null as
// no value, anything else as jsonb prints it (`{"a": 1, "b": [1, 2]}`, keys
// shortest first, then in byte order).
function jsonbText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value;
  return jsonbPrint(value);
}

function jsonbPrint(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value !== 'object') return String(value);
  if (Array.isArray(value)) return `[${value.map(jsonbPrint).join(', ')}]`;
  let keys = Object.keys(value).sort(
    (a, b) => a.length - b.length || compareBytes(a, b),
  );
  return `{${keys
    .map(
      (k) =>
        `${JSON.stringify(k)}: ${jsonbPrint((value as Record<string, unknown>)[k])}`,
    )
    .join(', ')}}`;
}

// jsonb equality: numbers by value, objects by their keys, lists in order.
function jsonbEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    let bs = b as unknown[];
    return a.length === bs.length && a.every((v, i) => jsonbEqual(v, bs[i]));
  }
  let ka = Object.keys(a);
  let kb = Object.keys(b);
  return (
    ka.length === kb.length &&
    ka.every(
      (k) =>
        hasOwn(b, k) &&
        jsonbEqual(
          (a as Record<string, unknown>)[k],
          (b as Record<string, unknown>)[k],
        ),
    )
  );
}

// A column's text (`at` in its ISO form), or an entry path's.
function textOf(line: LogLine, path: string): string | null {
  switch (path) {
    case 'at':
      return line.at;
    case 'actor':
      return line.actor;
    case 'line':
      return String(line.line_no);
    case 'file':
      return line.url;
  }
  return jsonbText(atPath(line.entry, path));
}

// A path's value as a projection, a key or a `let` reads it: a JSON null is
// no value, the same as an absent one.
export function lineValue(line: LogLine, path: string): Json | undefined {
  switch (path) {
    case 'at':
      return line.at ?? undefined;
    case 'actor':
      return line.actor ?? undefined;
    case 'line':
      return line.line_no;
    case 'file':
      return line.url;
  }
  let value = atPath(line.entry, path);
  return value === null || value === undefined ? undefined : (value as Json);
}

const timeOf = (iso: string | null) =>
  iso === null ? null : new Date(iso).getTime();

// Text in byte order (UTF-8 and UTF-16 order agree outside surrogates), as
// `COLLATE "C"` orders it: a log's URL.
function compareBytes(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// Text as the database's default collation orders it (a linguistic order:
// `like` before `Like` before `seen`), byte order breaking its ties, as
// Postgres does. ICU's order here and the database's libc order can differ
// on punctuation and some scripts.
const collator = new Intl.Collator('en-US');
function compareText(a: string, b: string): number {
  return collator.compare(a, b) || compareBytes(a, b);
}

// Two values of one read; a null goes first or last whatever the direction.
function compareNullable<T extends number | string>(
  a: T | null,
  b: T | null,
  nullsFirst: boolean,
): number {
  if (a === null || b === null) {
    if (a === b) return 0;
    return (a === null) === nullsFirst ? -1 : 1;
  }
  return typeof a === 'number'
    ? (a as number) - (b as number)
    : compareText(a as string, b as string);
}

// ---- the filter -------------------------------------------------------

type Truth = boolean | null;
type Polarity = 'positive' | 'negated';

const and3 = (parts: Truth[]): Truth =>
  parts.some((p) => p === false)
    ? false
    : parts.some((p) => p === null)
      ? null
      : true;
const or3 = (parts: Truth[]): Truth =>
  parts.some((p) => p === true)
    ? true
    : parts.some((p) => p === null)
      ? null
      : false;
const not3 = (t: Truth): Truth => (t === null ? null : !t);

// The lines a filter keeps.
export function lineFilter(
  filter: object | undefined,
  ctx: LineContext,
): (line: LogLine) => boolean {
  if (!filter) return () => true;
  return (line) => evaluate(filter, line, ctx, 'positive') === true;
}

function evaluate(
  filter: object,
  line: LogLine,
  ctx: LineContext,
  polarity: Polarity,
): Truth {
  let node = filter as Record<string, any>;
  let perField = (
    fields: Record<string, unknown>,
    test: (path: string, value: any) => Truth,
  ) => and3(Object.entries(fields).map(([path, value]) => test(path, value)));
  if ('eq' in node) {
    return perField(node.eq, (path, value) =>
      value === null
        ? missing(line, path)
        : eq(line, path, value, polarity, ctx),
    );
  }
  if ('in' in node) {
    return perField(node.in, (path, values: Json[]) => {
      if (values.length === 0) return false;
      let present = values.filter((v) => v !== null);
      let parts: Truth[] = [];
      if (present.length)
        parts.push(inValues(line, path, present, polarity, ctx));
      if (present.length !== values.length) parts.push(missing(line, path));
      return or3(parts);
    });
  }
  if ('contains' in node) {
    return perField(node.contains, (path, value) => {
      if (value === null) return missing(line, path);
      let text = textOf(line, path);
      return text === null
        ? null
        : text.toLowerCase().includes(String(value).toLowerCase());
    });
  }
  if ('not' in node) {
    return not3(
      evaluate(
        node.not,
        line,
        ctx,
        polarity === 'positive' ? 'negated' : 'positive',
      ),
    );
  }
  if ('range' in node) {
    return perField(node.range, (path, bounds: Record<string, Json>) =>
      and3(
        Object.entries(bounds).map(([op, value]) =>
          range(line, path, op, value, ctx),
        ),
      ),
    );
  }
  if ('every' in node) {
    return and3(
      (node.every as object[]).map((c) => evaluate(c, line, ctx, polarity)),
    );
  }
  if ('any' in node) {
    return or3(
      (node.any as object[]).map((c) => evaluate(c, line, ctx, polarity)),
    );
  }
  if ('missing' in node) return missing(line, node.missing);
  if ('exists' in node) return not3(missing(line, node.exists));
  throw refuseLog('log-filter-one');
}

// `IS NULL` of the path's text: a JSON null is no value.
function missing(line: LogLine, path: string): Truth {
  return textOf(line, path) === null;
}

function columnEquals(
  line: LogLine,
  path: string,
  value: Json,
  ctx: LineContext,
): Truth {
  switch (path) {
    case 'at':
      return line.at === null
        ? null
        : timeOf(line.at) === timeOf(ctx.time(value, ctx.now));
    case 'line':
      return line.line_no === Number(value);
    case 'file':
      return line.url === ctx.fileURL(value);
    default:
      return line.actor === null ? null : line.actor === String(value);
  }
}

// A present value at an entry path: the value, or a list holding it; a list
// value compared whole. Negated, a line with no value there is unknown.
function entryEquals(line: LogLine, path: string, value: Json): boolean {
  let contained = containedAt(line.entry, path);
  let at = atPath(line.entry, path);
  if (typeof value !== 'object' || value === null) {
    return (
      contained !== undefined &&
      (jsonbEqual(contained, value) ||
        (Array.isArray(contained) &&
          contained.some((item) => jsonbEqual(item, value))))
    );
  }
  if (Array.isArray(value)) {
    return contained !== undefined && jsonbEqual(at, value);
  }
  return (
    jsonbEqual(at, value) ||
    (Array.isArray(contained) &&
      Array.isArray(at) &&
      at.some((item) => jsonbEqual(item, value)))
  );
}

function eq(
  line: LogLine,
  path: string,
  value: Json,
  polarity: Polarity,
  ctx: LineContext,
): Truth {
  if (COLUMNS.has(path)) return columnEquals(line, path, value, ctx);
  if (polarity === 'negated' && textOf(line, path) === null) return null;
  return entryEquals(line, path, value);
}

function inValues(
  line: LogLine,
  path: string,
  values: Json[],
  polarity: Polarity,
  ctx: LineContext,
): Truth {
  if (COLUMNS.has(path)) {
    return or3(values.map((v) => columnEquals(line, path, v, ctx)));
  }
  // Postgres tests one containment each up to the card engine's limit, and
  // compares with the list past it; the two answer alike.
  if (polarity === 'negated' && textOf(line, path) === null) return null;
  return values.some((v) => entryEquals(line, path, v));
}

function range(
  line: LogLine,
  path: string,
  op: string,
  value: Json,
  ctx: LineContext,
): Truth {
  let holds = (c: number) =>
    op === 'gt' ? c > 0 : op === 'gte' ? c >= 0 : op === 'lt' ? c < 0 : c <= 0;
  if (path === 'at') {
    if (line.at === null) return null;
    return holds(timeOf(line.at)! - timeOf(ctx.time(value, ctx.now))!);
  }
  if (path === 'line') return holds(line.line_no - Number(value));
  if (path === 'actor') {
    return line.actor === null
      ? null
      : holds(compareText(line.actor, String(value)));
  }
  if (typeof value === 'number') {
    let at = atPath(line.entry, path);
    return typeof at === 'number' ? holds(at - value) : null;
  }
  let text = textOf(line, path);
  return text === null ? null : holds(compareText(text, String(value)));
}

// ---- order ------------------------------------------------------------

type SortEntry = { by: string; direction?: string; missing?: string };

// The lines in the query's order; ties keep file order (by log, then line).
export function sortLines(
  lines: LogLine[],
  sort: SortEntry[],
  many: boolean,
): LogLine[] {
  type Read = (l: LogLine) => number | string | null;
  let keys: { read: Read; desc: boolean; nullsFirst: boolean }[] = [];
  // `file` orders as `COLLATE "C"`: its URL as a number of bytes apart is
  // no number, so it is read as its rank among the logs, in byte order.
  let rank = new Map(
    [...new Set(lines.map((l) => l.url))]
      .sort(compareBytes)
      .map((u, i) => [u, i] as const),
  );
  for (let entry of sort) {
    let desc = String(entry.direction ?? '').toLowerCase() === 'desc';
    let nullsFirst = entry.missing === 'first';
    let reads: Read[];
    switch (entry.by) {
      case 'line':
        reads = [(l) => l.line_no];
        break;
      case 'file':
        reads = [(l) => rank.get(l.url)!];
        break;
      case 'at':
        reads = [(l) => timeOf(l.at)];
        break;
      case 'actor':
        reads = [(l) => l.actor];
        break;
      default: {
        let path = entry.by;
        reads = [
          (l) => {
            let v = atPath(l.entry, path);
            return typeof v === 'number' ? v : null;
          },
          (l) => jsonbText(atPath(l.entry, path)),
        ];
      }
    }
    for (let read of reads) keys.push({ read, desc, nullsFirst });
  }
  return [...lines].sort((a, b) => {
    for (let { read, desc, nullsFirst } of keys) {
      let va = read(a);
      let vb = read(b);
      let c =
        va === null || vb === null
          ? compareNullable(va, vb, nullsFirst)
          : (desc ? -1 : 1) * compareNullable(va, vb, nullsFirst);
      if (c) return c;
    }
    return (many ? compareBytes(a.url, b.url) : 0) || a.line_no - b.line_no;
  });
}

// ---- answers ----------------------------------------------------------

export interface LinesQuery {
  filter?: object;
  sort?: SortEntry[];
  page?: { total?: 'exact' | 'capped' | 'none' };
  select?: string[];
  group?: LineGroup;
  facets?: { by: string; size?: number }[];
}

export interface LineGroup {
  by: string | string[];
  aggregates?: Record<string, Record<string, string | true>>;
}

// ---- group roll-ups and facets -----------------------------------------

// jsonb's order (its btree's): an object after a list after a boolean after
// a number after a string after null; a longer list or object after a
// shorter; then item by item (an object's keys in jsonb's own key order).
function jsonbCompare(a: unknown, b: unknown): number {
  let rank = (v: unknown) =>
    v === null
      ? 0
      : typeof v === 'string'
        ? 1
        : typeof v === 'number'
          ? 2
          : typeof v === 'boolean'
            ? 3
            : Array.isArray(v)
              ? 4
              : 5;
  let ra = rank(a);
  let rb = rank(b);
  if (ra !== rb) return ra - rb;
  switch (ra) {
    case 0:
      return 0;
    case 1:
      return compareText(a as string, b as string);
    case 2:
      return (a as number) - (b as number);
    case 3:
      return Number(a) - Number(b);
    case 4: {
      let xs = a as unknown[];
      let ys = b as unknown[];
      if (xs.length !== ys.length) return xs.length - ys.length;
      for (let i = 0; i < xs.length; i++) {
        let c = jsonbCompare(xs[i], ys[i]);
        if (c) return c;
      }
      return 0;
    }
  }
  let order = (o: object) =>
    Object.keys(o).sort((x, y) => x.length - y.length || compareBytes(x, y));
  let ka = order(a as object);
  let kb = order(b as object);
  if (ka.length !== kb.length) return ka.length - kb.length;
  for (let i = 0; i < ka.length; i++) {
    let c =
      ka[i].length - kb[i].length ||
      compareBytes(ka[i], kb[i]) ||
      jsonbCompare(
        (a as Record<string, unknown>)[ka[i]],
        (b as Record<string, unknown>)[kb[i]],
      );
    if (c) return c;
  }
  return 0;
}

// Two values of an ORDER BY over jsonb, a null first or last whatever the
// direction.
function compareJsonb(
  a: unknown,
  b: unknown,
  desc: boolean,
  nullsFirst: boolean,
): number {
  let na = a === null || a === undefined;
  let nb = b === null || b === undefined;
  if (na || nb) return na === nb ? 0 : na === nullsFirst ? -1 : 1;
  return (desc ? -1 : 1) * jsonbCompare(a, b);
}

const keyOf = (v: Json | undefined) =>
  v === undefined ? '\u0000' : jsonbPrint(v);

// A path's value as a number (the number read), and as text (the text read).
function numberOf(line: LogLine, path: string): number | null {
  if (path === 'line') return line.line_no;
  if (COLUMNS.has(path)) return null;
  let v = atPath(line.entry, path);
  return typeof v === 'number' ? v : null;
}

// The newest line first: by time (no time last), then the later file and
// line, as a group's `latest` reads it.
const newestFirst = (a: LogLine, b: LogLine) =>
  compareNullable(timeOf(b.at), timeOf(a.at), false) ||
  compareBytes(b.url, a.url) ||
  b.line_no - a.line_no;

function aggregate(lines: LogLine[], op: string, path: string | true): Json {
  if (path === true) return lines.length;
  switch (op) {
    case 'count':
      return lines.filter((l) => lineValue(l, path) !== undefined).length;
    case 'latest':
      return lineValue([...lines].sort(newestFirst)[0], path) ?? null;
    case 'distinct': {
      let seen = new Map<string, Json>();
      for (let l of lines) {
        let v = lineValue(l, path);
        if (v !== undefined) seen.set(keyOf(v), v);
      }
      return [...seen.values()].sort(jsonbCompare);
    }
    case 'sum':
    case 'avg': {
      let numbers = lines
        .map((l) => numberOf(l, path))
        .filter((n): n is number => n !== null);
      if (!numbers.length) return null;
      let sum = numbers.reduce((x, y) => x + y, 0);
      return op === 'sum' ? sum : sum / numbers.length;
    }
  }
  let pick = op === 'min' ? -1 : 1;
  if (path === 'at') {
    let times = lines.map((l) => l.at).filter((t): t is string => t !== null);
    if (!times.length) return null;
    return times.reduce((x, y) =>
      Math.sign(timeOf(y)! - timeOf(x)!) === pick ? y : x,
    );
  }
  let numbers = lines
    .map((l) => numberOf(l, path))
    .filter((n): n is number => n !== null);
  if (numbers.length) {
    return op === 'min' ? Math.min(...numbers) : Math.max(...numbers);
  }
  let texts = lines
    .map((l) => textOf(l, path))
    .filter((t): t is string => t !== null);
  if (!texts.length) return null;
  return texts.reduce((x, y) =>
    Math.sign(compareText(y, x)) === pick ? y : x,
  );
}

// A query's groups, each `{ group: { <path>: value }, <name>: value }`, in
// its order: its sort over keys and aggregates, then each key ascending.
function groupLines(
  lines: LogLine[],
  group: LineGroup,
  sort: SortEntry[],
): Record<string, unknown>[] {
  let by = [group.by].flat();
  let aggregates = Object.entries(group.aggregates ?? {});
  let groups = new Map<
    string,
    { key: (Json | undefined)[]; lines: LogLine[] }
  >();
  for (let line of lines) {
    let key = by.map((path) => lineValue(line, path));
    let id = key.map(keyOf).join('\u0001');
    let found = groups.get(id);
    if (found) found.lines.push(line);
    else groups.set(id, { key, lines: [line] });
  }
  let rows = [...groups.values()].map(({ key, lines: held }) => {
    let row: Record<string, unknown> = {
      group: Object.fromEntries(by.map((path, i) => [path, key[i] ?? null])),
    };
    for (let [name, spec] of aggregates) {
      let [op, path] = Object.entries(spec)[0];
      row[name] = aggregate(held, op, path);
    }
    return { row, key };
  });
  let read = (entry: SortEntry) => {
    let i = by.indexOf(entry.by);
    return (r: (typeof rows)[number]) =>
      i >= 0 ? (r.key[i] ?? null) : (r.row[entry.by] ?? null);
  };
  let terms = sort.map((entry) => ({
    read: read(entry),
    desc: String(entry.direction ?? '').toLowerCase() === 'desc',
    nullsFirst: entry.missing === 'first',
  }));
  rows.sort((a, b) => {
    for (let { read: r, desc, nullsFirst } of terms) {
      let c = compareJsonb(r(a), r(b), desc, nullsFirst);
      if (c) return c;
    }
    for (let i = 0; i < by.length; i++) {
      let c = compareJsonb(a.key[i] ?? null, b.key[i] ?? null, false, false);
      if (c) return c;
    }
    return 0;
  });
  return rows.map((r) => r.row);
}

// A facet's counts: most first then by value, or, for `at`, a count per day
// of the zone in date order; lines with no value left out before `size`.
function facetCounts(
  lines: LogLine[],
  facet: { by: string; size?: number },
  zone: string,
): { value: Json; count: number }[] {
  let day = facet.by === 'at';
  let counts = new Map<string, { value: Json; count: number }>();
  for (let line of lines) {
    let value: Json | undefined = day
      ? line.at === null
        ? undefined
        : localDateInZone(timeOf(line.at)!, zone)
      : lineValue(line, facet.by);
    if (value === undefined) continue;
    let id = keyOf(value);
    let found = counts.get(id);
    if (found) found.count++;
    else counts.set(id, { value, count: 1 });
  }
  return [...counts.values()]
    .sort((a, b) =>
      day
        ? jsonbCompare(a.value, b.value)
        : b.count - a.count || jsonbCompare(a.value, b.value),
    )
    .slice(0, Number(facet.size ?? DEFAULT_FACET_SIZE));
}

// A page of a log query's lines, its total, and its warnings, as
// log-query.ts's `answerLogQuery` answers on Postgres.
export async function answerLogLines(
  q: LinesQuery,
  files: LineFile[],
  many: boolean,
  reader: LogFileReader | undefined,
  opts: {
    size: number;
    number: number;
    ctx: LineContext;
    // the zone an `at` facet counts days in
    zone: string;
    window?: LineWindow;
  },
): Promise<{
  data: Record<string, unknown>[];
  meta: {
    page: { total: number; hasMore: boolean };
    facets?: Record<string, { value: Json; count: number }[]>;
    warnings?: LogWarning[];
  };
}> {
  let { size, number, ctx } = opts;
  let {
    lines,
    read,
    total: held,
  } = await readLogLines(files, reader, opts.window);
  let warnings: LogWarning[] = [];
  if (read < held) warnings.push(logWindowWarning(read, held));
  let kept = lines.filter(lineFilter(q.filter, ctx));
  let facets = q.facets?.length
    ? Object.fromEntries(
        q.facets.map((f) => [f.by, facetCounts(kept, f, opts.zone)]),
      )
    : undefined;
  let offset = number * size;
  // The page's rows, one past it, and how many there are in all.
  let matched: unknown[];
  let rows: unknown[];
  let answerOf: (row: any) => Record<string, unknown>;
  if (q.group) {
    let groups = groupLines(kept, q.group, q.sort ?? []);
    matched = groups;
    rows = size ? groups.slice(offset, offset + size + 1) : [];
    answerOf = (g: Record<string, unknown>) => g;
  } else {
    let sorted = sortLines(kept, q.sort ?? [], files.length > 1);
    matched = sorted;
    rows = size ? sorted.slice(offset, offset + size + 1) : [];
    let selected = q.select?.length ? [...new Set(q.select)] : undefined;
    answerOf = (l: LogLine) => {
      let row: Record<string, unknown> = {
        line: l.line_no,
        ...(many ? { file: l.url } : {}),
      };
      if (selected) {
        for (let path of selected) row[path] = lineValue(l, path) ?? null;
        return row;
      }
      return { ...row, at: l.at, actor: l.actor, entry: l.entry };
    };
  }
  let hasMore = rows.length > size;
  let data = rows.slice(0, size).map(answerOf);
  let totalMode = q.page?.total ?? 'capped';
  let { total, totalIsEstimate } = await pageTotal(
    size,
    totalMode,
    offset,
    data.length,
    hasMore,
    async (cap) => (cap ? Math.min(cap, matched.length) : matched.length),
  );
  if (totalIsEstimate) {
    warnings.push({
      code: TOTAL_ESTIMATED,
      message: totalEstimatedMessage(
        totalMode === 'none' ? 'uncounted' : 'capped',
      ),
    });
  }
  return {
    data,
    meta: {
      page: { total, hasMore },
      ...(facets ? { facets } : {}),
      ...(warnings.length ? { warnings } : {}),
    },
  };
}

// The distinct values of `select` over the lines a filter keeps, most
// recently written first (by their latest line's time, then file and line),
// at most `cap` of them, as log-query.ts's `logBindingValues` reads them.
export async function logLineValues(
  files: LineFile[],
  reader: LogFileReader | undefined,
  filter: object | undefined,
  select: string,
  cap: number,
  ctx: LineContext,
  window?: LineWindow,
): Promise<{ values: Json[]; truncated?: true; window?: LogWarning }> {
  let { lines, read, total } = await readLogLines(files, reader, window);
  let keep = lineFilter(filter, ctx);
  let groups = new Map<
    string,
    { value: Json; lastAt: number | null; lastLine: string }
  >();
  for (let line of lines) {
    if (!keep(line)) continue;
    let value = lineValue(line, select);
    if (value === undefined) continue;
    let key = jsonbPrint(value);
    let at = timeOf(line.at);
    let position = `${line.url}:${String(line.line_no).padStart(10, '0')}`;
    let group = groups.get(key);
    if (!group) {
      groups.set(key, { value, lastAt: at, lastLine: position });
      continue;
    }
    if (at !== null && (group.lastAt === null || at > group.lastAt)) {
      group.lastAt = at;
    }
    if (compareBytes(position, group.lastLine) > 0) group.lastLine = position;
  }
  let ordered = [...groups.values()].sort(
    (a, b) =>
      compareNullable(b.lastAt, a.lastAt, false) ||
      compareBytes(b.lastLine, a.lastLine),
  );
  let values = ordered.slice(0, cap).map((g) => g.value);
  return {
    values,
    ...(ordered.length > cap ? { truncated: true as const } : {}),
    ...(read < total ? { window: logWindowWarning(read, total) } : {}),
  };
}
