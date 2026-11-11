// A Query V2 search over the lines of append-only logs, answered from
// `boxel_log_lines` (see `log-line-index.ts`) without reading the files.
//
//   {
//     from: { log: 'TasteProfile/my-taste.history.jsonl' },   // realm-relative or absolute
//     filter: { every: [{ eq: { 'what.action': 'like' } }, { range: { at: { gte: 'now-7d' } } }] },
//     sort: [{ by: 'at', direction: 'desc' }],
//     page: { size: 50, number: 0, total: 'capped' },
//     facets: [{ by: 'what.action', size: 10 }],
//   }
//
// `from` names one log (`{ log }`), a list of them (`{ logs: [...] }`), or
// every log in a folder (`{ logs: { under: 'Folder/' } }`); a query over
// several reads their lines as one set, each row carrying its `file`.
//
// Paths: `at` (the entry's time), `actor`, `line` (its line number), `file`
// (its log's URL), and any path into the entry (`what.action`,
// `what.postUri`). A `what` the writer encoded as a JSON string holding an
// object or a list is already decoded in the rows, so its fields are paths
// like any other.
//
// Filters: eq, in, range (gt/gte/lt/lte; `at` takes an ISO time, read as UTC
// when it names no zone, epoch milliseconds, or a relative date the card
// grammar takes: `now`, `now-7d`, `now+1w`, `now-1M/d`), contains
// (case-insensitive substring), exists, and every / any / not. An `eq` or
// `in` on an entry path is a GIN containment, so it stays fast on a long log.
//
// Facets count the filtered lines by a path's values, largest first; `at`
// counts per UTC day. `select` returns only the named paths per line.
// `group` returns one row per distinct value of a path (or several), with
// count, min, max, sum, avg, distinct and latest aggregates over each
// group's lines.
//
// How a query is answered: every member is checked before anything runs
// (an unknown member is refused with the nearest name, a wrong value with
// `invalid-value`, too much of something with `limit-exceeded`); the clock is
// read once; a log no index pass has synced yet is synced first; then the
// page, its count and its facets are read in one snapshot. A realm policy
// that admits a caller to their own lines ANDs `actor = <caller>` into the
// one WHERE every statement shares, so rows, totals, groups and facets all
// cover only those lines. See docs/search.md, "Searching a log".

import { param, query as runQuery, type Expression } from './expression.ts';
import type { DBAdapter } from './db.ts';
import { dialectFor } from './query-engine/dialect.ts';
import {
  CONTAINMENT_ANY_MAX,
  escapeLikePattern,
} from './query-engine/filter-sql.ts';
import { InvalidQueryError } from './invalid-query-error.ts';
import {
  assertPostgresKnowsTimeZone,
  assertTimeZone,
  clockInZone,
  DEFAULT_TIME_ZONE,
  isUtcZone,
  pgBucketLabel,
  pgLocalTimestamp,
  resolveRelativeDateInZone,
  zoneOfClock,
} from './time-zone.ts';
import {
  isRelativeDate,
  MAX_IN_VALUES,
  MAX_PAGE_NUMBER,
  MAX_SORT_ENTRIES,
  MAX_TEXT_TERM_LENGTH,
  nearestMember,
} from './query.ts';
import { MAX_QUERY_DEPTH } from './query-syntax.ts';
import {
  PAGE_SIZE_CLAMPED,
  SEARCH_TOTAL_CAP,
  TOTAL_ESTIMATED,
  totalEstimatedMessage,
} from './search-bounds.ts';
import { RealmPaths } from './paths.ts';
import { arrayElement, sqlTextArrayLiteral } from './sql-literal.ts';
import { isPrefixForm } from './realm-identifiers.ts';
import { resolveRRIReference } from './url.ts';
import type { VirtualNetwork } from './virtual-network.ts';
import { ensureLogPartition } from './log-line-partitions.ts';
import {
  isLogFileURL,
  parseISOTimeAsUTC,
  syncLogFile,
  type LogFileReader,
} from './log-line-index.ts';

// A refusal of a log query. `code` is the card grammar's vocabulary (see
// `invalid-query-error.ts`), plus three a log has and a card query doesn't:
// `log-not-found` (404: no such log), `log-not-indexed` (409: the log has no
// rows and nothing could sync it) and `log-not-readable` (403: the caller
// may read neither the realm nor any of the log's lines).
export class LogQueryError extends InvalidQueryError {
  status: number;
  constructor(message: string, code = 'invalid-value', status = 400) {
    super(message, code);
    this.name = 'LogQueryError';
    this.status = status;
  }
}

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

export type LogSource =
  | { log: string }
  | { logs: string[] }
  | { logs: { under: string } };

export interface LogQuery {
  from: LogSource;
  // The IANA zone whose calendar days and relative dates are reckoned in
  // (docs/search.md, "Time zones"); else the caller's, else the realm's
  // default, else UTC.
  timeZone?: string;
  filter?: LogFilter;
  sort?: { by: string; direction?: 'asc' | 'desc' }[];
  page?: {
    size?: number;
    number?: number;
    total?: 'exact' | 'capped' | 'none';
  };
  facets?: { by: string; size?: number }[];
  // The paths each row carries, instead of its whole entry: `at`, `actor`,
  // `line`, `file`, or a path into the entry. A row is then
  // `{ line, <path>: value }` (and `file` when the query reads several logs).
  select?: string[];
  // One row per distinct value of `by` (a path, or several), with
  // aggregates over each group's lines. A row is
  // `{ group: { <path>: value }, <name>: value }`.
  group?: { by: string | string[]; aggregates?: Record<string, LogAggregate> };
}

export type LogAggregate =
  | { count: true | string }
  | { min: string }
  | { max: string }
  | { sum: string }
  | { avg: string }
  | { distinct: string }
  | { latest: string };

export type LogFilter =
  | { eq: Record<string, Json> }
  | { in: Record<string, Json[]> }
  | { range: Record<string, { gt?: Json; gte?: Json; lt?: Json; lte?: Json }> }
  | { contains: Record<string, string> }
  | { exists: string }
  | { missing: string }
  | { every: LogFilter[] }
  | { any: LogFilter[] }
  | { not: LogFilter };

export interface LogQueryWarning {
  code: string;
  message: string;
}

export interface LogQueryResult {
  data: Record<string, unknown>[];
  meta: {
    // `total` is a lower bound when `warnings` holds `total-estimated`.
    page: { total: number; hasMore: boolean };
    facets?: Record<string, { value: Json; count: number }[]>;
    // The log, for a query over one; the logs, in file order, for a query
    // over several (`logs`), which then also names each row's `file`.
    log?: string;
    logs?: string[];
    // The logs a realm policy scoped to the caller's own lines.
    policyScopedLogs?: string[];
    // The zone days and relative dates were reckoned in, when the query
    // named one or a zone other than UTC applied.
    timeZone?: string;
    warnings?: LogQueryWarning[];
  };
}

// What a log query may hold. Past these it is refused (`limit-exceeded`),
// except a page size, which is clamped with a `page-size-clamped` warning.
export const LOG_MAX_PAGE_SIZE = 1000;
export const LOG_DEFAULT_PAGE_SIZE = 50;
export const LOG_DEFAULT_FACET_SIZE = 20;
export const LOG_MAX_FACET_SIZE = 1000;
export const LOG_MAX_FACETS = 8;
export const LOG_MAX_SELECT = 64;
export const LOG_MAX_GROUP_BY = 8;
export const LOG_MAX_AGGREGATES = 32;
// logs one query reads, named or under a folder
export const LOG_MAX_FILES = 100;
// the values a query binds, past which Postgres (65,535) would refuse it
const LOG_MAX_BOUND_VALUES = 60_000;
// entry values compared one containment each, which the GIN index serves;
// a longer `in` compares the path's value with a list (the card engine's
// limit, query-engine/filter-sql.ts)
const LOG_CONTAINMENT_ANY_MAX = CONTAINMENT_ANY_MAX;

export function isLogQuery(payload: unknown): payload is LogQuery {
  let from = (payload as { from?: unknown } | null)?.from;
  if (typeof from !== 'object' || from === null || Array.isArray(from)) {
    return false;
  }
  return (
    typeof (from as { log?: unknown }).log === 'string' ||
    (from as { logs?: unknown }).logs !== undefined
  );
}

// A Map rather than an object: a path is the caller's string, and an
// object lookup would answer `constructor` or `toString` from the prototype
// and put that into the SQL.
const COLUMNS: ReadonlyMap<string, string> = new Map([
  ['at', 'l.at'],
  ['actor', 'l.actor'],
  ['line', 'l.line_no'],
  ['file', 'l.url'],
]);

function pathSegments(path: string): string[] {
  if (
    typeof path !== 'string' ||
    !/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(path)
  ) {
    throw new LogQueryError(
      `Invalid log path: ${JSON.stringify(String(path).slice(0, 200))} (a path is names joined by dots, each a letter, _ or $ then letters, digits, _ or $)`,
    );
  }
  return path.split('.');
}

// The path's value as jsonb.
function jsonPath(path: string): Expression {
  return [
    '(l.entry #>',
    param(`{${pathSegments(path).join(',')}}`),
    '::text[])',
  ];
}

// The path's value as text, the way `->>` reads it.
function textPath(path: string): Expression {
  return [
    '(l.entry #>>',
    param(`{${pathSegments(path).join(',')}}`),
    '::text[])',
  ];
}

// `{"what":{"action":"like"}}` for `what.action` = "like".
function containmentFor(path: string, value: Json): string {
  let nested: Json = value;
  for (let segment of pathSegments(path).reverse()) {
    nested = { [segment]: nested };
  }
  return JSON.stringify(nested);
}

// A time Date can hold, as ISO text, or a refusal: past about 275,000 years
// from 1970 a Date is invalid and `toISOString` throws a RangeError.
function isoTimeOf(ms: number, value: Json): string {
  let date = new Date(ms);
  if (!Number.isFinite(date.getTime())) {
    throw new LogQueryError(
      `Not a time: ${JSON.stringify(value)} is outside the range of dates`,
    );
  }
  return date.toISOString();
}

// A time bound as an ISO instant. Epoch milliseconds; a relative date in the
// card grammar's form (`now`, `now-7d`, `now+1w`, `now-1M/d`: calendar
// months and years, Monday weeks, rounded in UTC), reckoned from `now`, the
// query's one clock reading; or an ISO 8601 time, read as UTC when it names
// no zone. Anything else is refused, `March 7` included, which `Date.parse`
// would read in the server's own zone.
export function resolveLogTime(value: Json, now: Date = new Date()): string {
  if (typeof value === 'number') {
    return isoTimeOf(value, value);
  }
  if (typeof value !== 'string') {
    throw new LogQueryError(
      `A time must be a string or a number, not ${JSON.stringify(value)}`,
    );
  }
  let text: string = value;
  // Not the guard itself, which would leave `text` a `never` below.
  let relative: boolean = isRelativeDate(text);
  if (relative) {
    // Rounded on the calendar of the zone the query's clock reads in
    // (`clockInZone`): UTC unless the query names another.
    let resolved: string | undefined;
    try {
      resolved = resolveRelativeDateInZone(text, now, zoneOfClock(now));
    } catch (e) {
      if (e instanceof InvalidQueryError) {
        throw new LogQueryError(e.message);
      }
      throw e;
    }
    if (resolved === undefined || Number.isNaN(Date.parse(resolved))) {
      throw new LogQueryError(
        `"${text}" moves past the last date there is (about 275,000 years from 1970 either way)`,
      );
    }
    return resolved;
  }
  let ms = parseISOTimeAsUTC(text);
  if (ms === undefined) {
    throw new LogQueryError(
      `Not a time: ${JSON.stringify(text.slice(0, 200))} (a time is an ISO 8601 time, read as UTC when it names no zone, epoch milliseconds, or a relative date such as now-7d, now+1w or now-1M/d)`,
    );
  }
  return isoTimeOf(ms, value);
}

// A Map for the same reason as COLUMNS: `range: { at: { constructor: … } }`
// must be refused, not read from the prototype.
const RANGE_OPS: ReadonlyMap<string, string> = new Map([
  ['gt', '>'],
  ['gte', '>='],
  ['lt', '<'],
  ['lte', '<='],
]);

function andAll(parts: Expression[], joiner: 'AND' | 'OR'): Expression {
  if (parts.length === 0) {
    return [joiner === 'AND' ? 'TRUE' : 'FALSE'];
  }
  let out: Expression = ['('];
  parts.forEach((part, i) => {
    if (i > 0) {
      out.push(joiner);
    }
    out.push('(', ...part, ')');
  });
  out.push(')');
  return out;
}

// What a filter compiles against: the query's clock, and how a `file`
// value names a log.
interface CompileContext {
  now: Date;
  fileURL: (value: Json) => string;
}

// The day `column` (a timestamptz) falls on in `zone`, as the date a card
// facet's day bucket is labelled with (`YYYY-MM-DD`, on the zone's calendar).
function dayOf(column: string, zone: string): Expression {
  return [
    `to_jsonb(${pgBucketLabel('day', pgLocalTimestamp(`${column} AT TIME ZONE 'UTC'`, zone))})`,
  ];
}

// A time as the ISO string a row's `at` is answered with.
function isoTime(sql: string): string {
  return `to_char(${sql} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
}

// A column's value as text, for `contains`: `at` in its ISO form, never in
// the session's time zone.
function columnText(path: string): string {
  if (path === 'at') return isoTime('l.at');
  if (path === 'line') return 'l.line_no::text';
  return COLUMNS.get(path)!;
}

// Compiles a filter `validateFilter` has passed. A comparison with a missing
// value is neither true nor false (SQL NULL), and `not`, `every` and `any`
// carry that through, so neither a filter nor its `not` keeps such a line.
// `underNot` says a `not` encloses this filter: only there does unknown
// differ from false, so only there does `eq` pay for telling them apart.
function compileFilter(
  filter: LogFilter,
  ctx: CompileContext,
  underNot = false,
): Expression {
  if ('every' in filter) {
    return andAll(
      filter.every.map((f) => compileFilter(f, ctx, underNot)),
      'AND',
    );
  }
  if ('any' in filter) {
    return andAll(
      filter.any.map((f) => compileFilter(f, ctx, underNot)),
      'OR',
    );
  }
  if ('not' in filter) {
    return ['NOT (', ...compileFilter(filter.not, ctx, true), ')'];
  }
  if ('missing' in filter) {
    // The twin of `exists`, as in a card query: no value at the path.
    let path = filter.missing;
    let column = COLUMNS.get(path);
    return column ? [`${column} IS NULL`] : [...textPath(path), 'IS NULL'];
  }
  if ('exists' in filter) {
    let path = filter.exists;
    let column = COLUMNS.get(path);
    // Read as text, where a JSON null is no value, the same as an absent one.
    return column
      ? [`${column} IS NOT NULL`]
      : [...textPath(path), 'IS NOT NULL'];
  }
  if ('eq' in filter) {
    return andAll(
      Object.entries(filter.eq).map(([path, value]) =>
        eqCondition(path, value, underNot, ctx),
      ),
      'AND',
    );
  }
  if ('in' in filter) {
    return andAll(
      Object.entries(filter.in).map(([path, values]) =>
        inCondition(path, values, underNot, ctx),
      ),
      'AND',
    );
  }
  if ('contains' in filter) {
    return andAll(
      Object.entries(filter.contains).map(([path, value]) => {
        let target = COLUMNS.has(path) ? [columnText(path)] : textPath(path);
        return [
          ...target,
          'ILIKE',
          param(`%${escapeLikePattern(String(value))}%`),
        ];
      }),
      'AND',
    );
  }
  if ('range' in filter) {
    return andAll(
      Object.entries(filter.range).flatMap(([path, bounds]) =>
        Object.entries(bounds).map(([op, value]) => {
          let sqlOp = RANGE_OPS.get(op)!;
          if (path === 'at') {
            return [
              `l.at ${sqlOp}`,
              param(resolveLogTime(value as Json, ctx.now)),
              '::timestamptz',
            ];
          }
          if (path === 'line') {
            return [`l.line_no ${sqlOp}`, param(Number(value))];
          }
          if (path === 'actor') {
            return [`l.actor ${sqlOp}`, param(String(value))];
          }
          if (typeof value === 'number') {
            // A number bound compares numbers: a line whose value there is
            // not a number has no value to compare, as a missing one hasn't.
            return [
              'CASE WHEN jsonb_typeof(',
              ...jsonPath(path),
              ") = 'number' THEN (",
              ...textPath(path),
              `)::numeric ${sqlOp}`,
              param(value),
              'END',
            ];
          }
          return [...textPath(path), sqlOp, param(String(value))];
        }),
      ),
      'AND',
    );
  }
  throw new LogQueryError(`A log filter is one of ${FILTER_OPS.join(', ')}`);
}

function columnValue(path: string, value: Json, ctx: CompileContext) {
  if (path === 'at') return resolveLogTime(value, ctx.now);
  if (path === 'line') return Number(value);
  if (path === 'file') return ctx.fileURL(value);
  return String(value);
}

function eqCondition(
  path: string,
  value: Json,
  underNot: boolean,
  ctx: CompileContext,
): Expression {
  let column = COLUMNS.get(path);
  if (column) {
    if (value === null) {
      return [`${column} IS NULL`];
    }
    return [
      `${column} =`,
      param(columnValue(path, value, ctx)),
      ...(path === 'at' ? ['::timestamptz'] : []),
    ];
  }
  if (value === null) {
    // Read as text, where a JSON null is no value, the same as an absent one.
    return [...textPath(path), 'IS NULL'];
  }
  // As on a card's list field, a list at the path matches when some item
  // does: `eq: { 'what.tags': 'x' }` keeps a line whose tags hold "x". A
  // list value is compared whole.
  let equal: Expression;
  if (typeof value !== 'object') {
    // Containments the entry GIN index answers: the value itself, or a list
    // holding it.
    equal = [
      '(l.entry @>',
      param(containmentFor(path, value)),
      '::jsonb OR l.entry @>',
      param(containmentFor(path, [value])),
      '::jsonb)',
    ];
  } else if (Array.isArray(value)) {
    // A list or an object is contained by any value that holds its items or
    // members, so equality is checked on the lines the index keeps.
    equal = [
      '(l.entry @>',
      param(containmentFor(path, value)),
      '::jsonb AND',
      ...jsonPath(path),
      '=',
      param(JSON.stringify(value)),
      '::jsonb)',
    ];
  } else {
    equal = [
      '(',
      ...jsonPath(path),
      '=',
      param(JSON.stringify(value)),
      '::jsonb OR (l.entry @>',
      param(containmentFor(path, [value])),
      '::jsonb AND EXISTS (SELECT 1 FROM jsonb_array_elements(',
      ...listAt(path),
      ') AS item WHERE item =',
      param(JSON.stringify(value)),
      '::jsonb)))',
    ];
  }
  return guardedUnderNot(path, equal, underNot);
}

// The list at `path`, or an empty one where the value there is no list.
function listAt(path: string): Expression {
  return [
    'CASE WHEN jsonb_typeof(',
    ...jsonPath(path),
    ") = 'array' THEN",
    ...jsonPath(path),
    "ELSE '[]'::jsonb END",
  ];
}

// With no value at the path the comparison is unknown, not false. Outside a
// `not` the two drop the same lines, and the bare comparison keeps the
// index.
function guardedUnderNot(
  path: string,
  test: Expression,
  underNot: boolean,
): Expression {
  return underNot
    ? ['CASE WHEN', ...textPath(path), 'IS NOT NULL THEN', ...test, 'END']
    : test;
}

function inCondition(
  path: string,
  values: Json[],
  underNot: boolean,
  ctx: CompileContext,
): Expression {
  let column = COLUMNS.get(path);
  let present = values.filter((v) => v !== null);
  let tests: Expression[] = [];
  if (present.length !== values.length) {
    tests.push(eqCondition(path, null, underNot, ctx));
  }
  if (present.length === 0) {
    return andAll(tests, 'OR');
  }
  if (column) {
    let cast =
      path === 'at' ? 'timestamptz' : path === 'line' ? 'integer' : 'text';
    tests.push([
      `${column} = ANY(ARRAY[`,
      ...present.flatMap((v, i) => [
        ...(i > 0 ? [','] : []),
        param(columnValue(path, v, ctx)),
        `::${cast}`,
      ]),
      '])',
    ]);
    return andAll(tests, 'OR');
  }
  if (present.length <= LOG_CONTAINMENT_ANY_MAX) {
    for (let value of present) {
      tests.push(eqCondition(path, value, underNot, ctx));
    }
    return andAll(tests, 'OR');
  }
  // Past a handful of values, one comparison of the path's value with the
  // list: the same equality each containment checks, in one statement term.
  let list = (): Expression => [
    'ARRAY[',
    ...present.flatMap((v, i) => [
      ...(i > 0 ? [','] : []),
      param(JSON.stringify(v)),
      '::jsonb',
    ]),
    ']',
  ];
  tests.push(
    guardedUnderNot(
      path,
      [
        '(',
        ...jsonPath(path),
        '= ANY(',
        ...list(),
        ') OR EXISTS (SELECT 1 FROM jsonb_array_elements(',
        ...listAt(path),
        ') AS item WHERE item = ANY(',
        ...list(),
        ')))',
      ],
      underNot,
    ),
  );
  return andAll(tests, 'OR');
}

function orderBy(sort: LogQuery['sort'], manyFiles: boolean): string {
  let terms = (sort ?? []).map(({ by, direction }) => {
    let dir = direction === 'desc' ? 'DESC' : 'ASC';
    if (by === 'at') {
      return `l.at ${dir} NULLS LAST`;
    }
    if (by === 'line') {
      return `l.line_no ${dir}`;
    }
    if (by === 'actor') {
      return `l.actor ${dir} NULLS LAST`;
    }
    if (by === 'file') {
      return `l.url COLLATE "C" ${dir}`;
    }
    // An entry path sorts by its text; a numeric path sorts numerically.
    let at = `l.entry #> ${sqlTextArrayLiteral(pathSegments(by))}`;
    return `CASE WHEN jsonb_typeof(${at}) = 'number' THEN (${at} #>> '{}')::numeric END ${dir} NULLS LAST, (${at} #>> '{}') ${dir} NULLS LAST`;
  });
  // Ties keep file order: by log, then line, whatever the direction. Over
  // one log the line alone, so a newest-first page reads the
  // `(url, at DESC NULLS LAST, line_no)` index in order.
  terms.push(...(manyFiles ? ['l.url COLLATE "C" ASC'] : []), 'l.line_no ASC');
  return `ORDER BY ${terms.join(', ')}`;
}

// Resolves `from.log` against the realm, refusing a file outside it or one
// that isn't a log. `from.log` is realm-relative, an absolute URL, or an id in
// prefix form (`@scope/realm/x.jsonl`). The join and the membership test go
// through the RRI helpers (ADR 002): a prefix-form id resolves through the
// virtual network, and `RealmPaths` decides whether the file is in the realm.
// Without a virtual network a prefix-form id is refused, since nothing could
// say where it lives.
export function resolveLogURL(
  log: string,
  realmURL: string,
  virtualNetwork?: VirtualNetwork,
): string {
  let url = resolveInRealm(log, realmURL, virtualNetwork, 'log');
  if (!isLogFileURL(url.href)) {
    throw new LogQueryError(`${url.href} is not a log (.jsonl or .log)`);
  }
  return url.href;
}

function resolveInRealm(
  reference: string,
  realmURL: string,
  virtualNetwork: VirtualNetwork | undefined,
  what: 'log' | 'folder',
): URL {
  let realm = new URL(realmURL);
  let url: URL;
  try {
    url = virtualNetwork
      ? virtualNetwork.resolveURL(reference, realm)
      : new URL(resolveRRIReference(reference, realm));
  } catch {
    throw new LogQueryError(
      isPrefixForm(reference)
        ? `Not a ${what} URL: ${JSON.stringify(reference)} (no realm is known by that prefix)`
        : `Not a ${what} URL: ${JSON.stringify(reference)}`,
    );
  }
  if (!new RealmPaths(realm).inRealm(url)) {
    throw new LogQueryError(`${url.href} is not in ${realmURL}`);
  }
  return url;
}

// A folder of the realm, as the URL prefix its files share: realm-relative
// (`Folder/`, ADR 002), absolute, or in prefix form; with or without its
// trailing slash, which names the same folder.
export function resolveLogFolder(
  folder: string,
  realmURL: string,
  virtualNetwork?: VirtualNetwork,
): string {
  let url = resolveInRealm(
    folder === '' ? './' : folder,
    realmURL,
    virtualNetwork,
    'folder',
  );
  url.search = '';
  url.hash = '';
  return url.href.endsWith('/') ? url.href : `${url.href}/`;
}

const QUERY_KEYS = [
  'from',
  'timeZone',
  'filter',
  'sort',
  'page',
  'facets',
  'select',
  'group',
];
const AGGREGATE_OPS = [
  'count',
  'min',
  'max',
  'sum',
  'avg',
  'distinct',
  'latest',
];

const FILTER_OPS = [
  'eq',
  'in',
  'range',
  'contains',
  'exists',
  'missing',
  'every',
  'any',
  'not',
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Members of a card query a log query does not take, and why: refused as
// `not-supported-for-logs` rather than as unknown, since a caller who writes
// one wrote a valid card query (docs/search.md, "What logs don't support").
const CARD_ONLY_MEMBERS: ReadonlyMap<string, string> = new Map([
  ['type', 'a log has no card type: name the log in from'],
  ['fields', 'a line is answered whole, or by select'],
  ['collapse', 'collapse to one per group with group'],
  ['let', 'a log query has no bindings; a card query can bind a log'],
  ['explain', 'a log query ranks nothing'],
  ['asData', 'a line is data already'],
  ['realm', 'a log names its realm by its URL'],
  ['realms', 'a log search runs on one realm'],
  ['cardUrls', 'a log query reads lines, not cards'],
  ['scope', 'a log query reads lines, not cards or files'],
  ['htmlQuery', 'a line has no rendering'],
  ['queryString', 'a log query is JSON'],
]);
const CARD_ONLY_FILTERS: ReadonlyMap<string, string> = new Map([
  ['matches', 'a line has no full-text index; use contains'],
  ['near', 'a line has no vectors'],
  ['type', 'a line has no card type'],
  ['on', 'a line has no card type'],
  ['linkedFrom', 'a line has no links'],
  ['prefix', 'a line has no full-text index; use contains'],
]);
// Members no query takes, card or log: a retired or draft spelling. Refused
// as a card query refuses them (`unknown-key`, with what to write instead),
// since they are not a card query's features a log lacks; they don't exist.
const RETIRED_MEMBERS: ReadonlyMap<string, string> = new Map([
  [
    'rerank',
    '"rerank" is not a query member; re-ranking is a card query\'s sort entry ({ expression, top }), and a log query orders lines with sort',
  ],
]);
const RETIRED_FILTERS: ReadonlyMap<string, string> = new Map([
  [
    'typeahead',
    '"typeahead" is not a filter operator; a card query writes type-ahead as { matches, prefix: true, scope: \'title\' }, and a line, which has no full-text index, is searched with contains',
  ],
]);

function retiredMember(hint: string, where: string): LogQueryError {
  return new LogQueryError(`${where}: ${hint}`, 'unknown-key');
}

function notSupportedForLogs(key: string, why: string): LogQueryError {
  return new LogQueryError(
    `"${key}" is a card query's, and a log query does not support it: ${why}`,
    'not-supported-for-logs',
  );
}

function unknownMember(
  key: string,
  allowed: readonly string[],
  where: string,
): LogQueryError {
  let near = nearestMember(key, allowed);
  return new LogQueryError(
    `unknown member "${key.slice(0, 80)}" in ${where}${near ? `; did you mean "${near}"?` : ''} (it takes ${allowed.join(', ')})`,
    'unknown-key',
  );
}

// Refused rather than ignored: a key this grammar doesn't read would leave
// its caller believing it applied.
function assertMembers(
  value: Record<string, unknown>,
  allowed: readonly string[],
  where: string,
) {
  for (let key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      let retired =
        where === 'a log query' ? RETIRED_MEMBERS.get(key) : undefined;
      if (retired !== undefined) {
        throw retiredMember(retired, where);
      }
      let why =
        where === 'a log query' ? CARD_ONLY_MEMBERS.get(key) : undefined;
      throw why !== undefined
        ? notSupportedForLogs(key, why)
        : unknownMember(key, allowed, where);
    }
  }
}

// A path into the entry or one of the columns.
function assertPath(path: unknown, where: string) {
  if (typeof path !== 'string') {
    throw new LogQueryError(
      `${where} names a path, not ${JSON.stringify(path)}`,
    );
  }
  if (!COLUMNS.has(path)) {
    pathSegments(path);
  }
}

// `line` is a number column: any other value would reach Postgres as one.
function assertLineNumber(value: unknown, where: string) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new LogQueryError(
      `${where} must be a number, not ${JSON.stringify(value)}`,
    );
  }
}

// `actor` and `file` hold text: a number or a list there would never match,
// so it is refused rather than compared.
function assertColumnValue(
  path: string,
  value: unknown,
  where: string,
  now: Date,
) {
  if (value === null) return;
  if (path === 'line') {
    assertLineNumber(value, where);
  } else if (path === 'at') {
    resolveLogTime(value as Json, now);
  } else if (
    (path === 'actor' || path === 'file') &&
    typeof value !== 'string'
  ) {
    throw new LogQueryError(
      `${where} compares with text, not ${JSON.stringify(value)}`,
    );
  }
}

function validateFilter(filter: unknown, now: Date, depth = 1) {
  if (depth > MAX_QUERY_DEPTH) {
    throw new LogQueryError(
      `a log filter nests at most ${MAX_QUERY_DEPTH} deep`,
      'limit-exceeded',
    );
  }
  if (!isPlainObject(filter)) {
    throw new LogQueryError(
      `A log filter must be an object, not ${JSON.stringify(filter)?.slice(0, 80)}`,
    );
  }
  let keys = Object.keys(filter);
  let ops = keys.filter((key) => FILTER_OPS.includes(key));
  let unknown = keys.find((key) => !FILTER_OPS.includes(key));
  if (ops.length === 0) {
    if (unknown === undefined) {
      throw new LogQueryError(
        `A log filter is one of ${FILTER_OPS.join(', ')}, and this filter has none`,
        'missing-member',
      );
    }
    let retired = RETIRED_FILTERS.get(unknown);
    if (retired !== undefined) {
      throw retiredMember(retired, 'a log filter');
    }
    let why = CARD_ONLY_FILTERS.get(unknown);
    if (why !== undefined) {
      throw notSupportedForLogs(unknown, why);
    }
    let near = nearestMember(unknown, FILTER_OPS);
    throw new LogQueryError(
      `unknown filter operator "${unknown.slice(0, 80)}": a log filter is one of ${FILTER_OPS.join(', ')}${near ? `; did you mean "${near}"?` : ''}`,
      'unknown-key',
    );
  }
  if (unknown !== undefined) {
    throw new LogQueryError(
      `unknown member "${unknown.slice(0, 80)}" beside "${ops[0]}" in a log filter`,
      'unknown-key',
    );
  }
  if (ops.length > 1) {
    throw new LogQueryError(
      `a log filter takes one operator, not ${ops.join(' and ')} (combine them with every or any)`,
      'conflicting-members',
    );
  }
  let op = ops[0];
  let operand = filter[op];
  if (op === 'every' || op === 'any') {
    if (!Array.isArray(operand)) {
      throw new LogQueryError(`${op} is a list of filters`);
    }
    for (let item of operand) validateFilter(item, now, depth + 1);
    return;
  }
  if (op === 'not') {
    validateFilter(operand, now, depth + 1);
    return;
  }
  if (op === 'exists' || op === 'missing') {
    assertPath(operand, op);
    return;
  }
  if (!isPlainObject(operand)) {
    throw new LogQueryError(`${op} takes an object keyed by path`);
  }
  for (let [path, value] of Object.entries(operand)) {
    assertPath(path, op);
    if (op === 'eq') {
      assertColumnValue(path, value, `eq.${path}`, now);
    } else if (op === 'in') {
      if (!Array.isArray(value)) {
        throw new LogQueryError(`in.${path} must be a list`);
      }
      if (value.length > MAX_IN_VALUES) {
        throw new LogQueryError(
          `in.${path} lists ${value.length} values, and an in takes at most ${MAX_IN_VALUES.toLocaleString('en-US')}`,
          'limit-exceeded',
        );
      }
      value.forEach((item) => assertColumnValue(path, item, `in.${path}`, now));
    } else if (op === 'contains') {
      if (typeof value !== 'string') {
        throw new LogQueryError(
          `contains.${path} takes text, not ${JSON.stringify(value)?.slice(0, 80)}`,
        );
      }
      if (value.length > MAX_TEXT_TERM_LENGTH) {
        throw new LogQueryError(
          `contains.${path} is ${value.length} characters, and a term holds at most ${MAX_TEXT_TERM_LENGTH.toLocaleString('en-US')}`,
          'limit-exceeded',
        );
      }
    } else if (op === 'range') {
      if (!isPlainObject(value)) {
        throw new LogQueryError(
          `range.${path} takes an object of gt, gte, lt and lte`,
        );
      }
      if (path === 'file') {
        throw new LogQueryError(
          'range does not take file: name the logs in from, or filter file with eq or in',
        );
      }
      for (let [bound, limit] of Object.entries(value)) {
        if (!RANGE_OPS.has(bound)) {
          throw unknownMember(bound, [...RANGE_OPS.keys()], `range.${path}`);
        }
        if (path === 'line') {
          assertLineNumber(limit, `range.line.${bound}`);
        } else if (path === 'at') {
          resolveLogTime(limit as Json, now);
        } else if (typeof limit !== 'number' && typeof limit !== 'string') {
          // Card queries refuse a null bound too: it names no end.
          throw new LogQueryError(
            `range.${path}.${bound} is a number or text, not ${JSON.stringify(limit)?.slice(0, 80)}`,
          );
        }
      }
    }
  }
}

// Postgres stores neither a NUL character nor half of a surrogate pair in
// text or jsonb; sent, either is refused with a raw SQLSTATE (22P05, 22021).
// So a query carrying one, as a value, a path or a key, is refused here. The
// message names neither, so the refusal does not echo the caller's text.
const UNPAIRED_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function assertStorableText(query: unknown): void {
  // A stack rather than recursion, so a deeply nested filter is walked whole.
  let pending: unknown[] = [query];
  while (pending.length) {
    let value = pending.pop();
    if (typeof value === 'string') {
      if (value.includes('\u0000') || UNPAIRED_SURROGATE.test(value)) {
        throw new LogQueryError(
          'a log query cannot carry a NUL character or an unpaired surrogate',
        );
      }
    } else if (Array.isArray(value)) {
      pending.push(...value);
    } else if (typeof value === 'object' && value !== null) {
      for (let [key, item] of Object.entries(value)) {
        pending.push(key, item);
      }
    }
  }
}

function validateFrom(from: unknown) {
  if (!isPlainObject(from)) {
    throw new LogQueryError(
      'a log query is an object with from: { log }, from: { logs: [...] } or from: { logs: { under } }',
      'missing-member',
    );
  }
  let names = Object.keys(from);
  for (let key of names) {
    if (key !== 'log' && key !== 'logs') {
      let near = nearestMember(key, ['log', 'logs']);
      throw new LogQueryError(
        `unknown member "from.${key.slice(0, 80)}"${near ? `; did you mean "${near}"?` : ''} (it takes log or logs)`,
        'unknown-key',
      );
    }
  }
  if ('log' in from && 'logs' in from) {
    throw new LogQueryError(
      'from takes log (one log) or logs (several), not both',
      'conflicting-members',
    );
  }
  if ('log' in from) {
    if (typeof from.log !== 'string') {
      throw new LogQueryError('from.log names a log file');
    }
    return;
  }
  let logs = from.logs;
  if (Array.isArray(logs)) {
    if (logs.length === 0) {
      throw new LogQueryError(
        'from.logs names at least one log',
        'missing-member',
      );
    }
    if (logs.length > LOG_MAX_FILES) {
      throw new LogQueryError(
        `from.logs names ${logs.length} logs, and a query reads at most ${LOG_MAX_FILES}`,
        'limit-exceeded',
      );
    }
    logs.forEach((log, i) => {
      if (typeof log !== 'string') {
        throw new LogQueryError(`from.logs[${i}] names a log file`);
      }
    });
    return;
  }
  if (isPlainObject(logs)) {
    assertMembers(logs, ['under'], 'from.logs');
    if (typeof logs.under !== 'string') {
      throw new LogQueryError(
        'from.logs.under names a folder of the realm, such as "Folder/"',
        logs.under === undefined ? 'missing-member' : 'invalid-value',
      );
    }
    return;
  }
  throw new LogQueryError(
    'from.logs is a list of logs or { under: "Folder/" }',
  );
}

// Checks every member, type and value of a query before any of it runs, so
// the code below can take a well-formed query.
export function validateLogQuery(q: LogQuery, now: Date = new Date()): void {
  if (!isPlainObject(q)) {
    throw new LogQueryError(
      'a log query is an object with from: { log }',
      'invalid-value',
    );
  }
  assertStorableText(q);
  assertMembers(q, QUERY_KEYS, 'a log query');
  validateFrom(q.from);
  if (q.timeZone !== undefined) {
    assertLogTimeZone(q.timeZone);
  }
  if (q.filter != null) {
    validateFilter(q.filter, now);
  }
  if (q.sort != null) {
    if (!Array.isArray(q.sort)) {
      throw new LogQueryError('sort is a list of { by, direction }');
    }
    if (q.sort.length > MAX_SORT_ENTRIES) {
      throw new LogQueryError(
        `sort lists ${q.sort.length} keys, and a query sorts by at most ${MAX_SORT_ENTRIES}`,
        'limit-exceeded',
      );
    }
    for (let entry of q.sort as unknown[]) {
      if (!isPlainObject(entry)) {
        throw new LogQueryError('a sort entry is an object of by, direction');
      }
      for (let key of ['blend', 'expression', 'relevance', 'near', 'boost']) {
        if (key in entry) {
          throw notSupportedForLogs(
            key,
            'a line has no ranking signals: sort by a path',
          );
        }
      }
      assertMembers(entry, ['by', 'direction'], 'a sort entry');
      if (entry.by === undefined) {
        throw new LogQueryError(
          'a sort entry names its path in "by"',
          'missing-member',
        );
      }
      if (typeof entry.by !== 'string') {
        throw new LogQueryError('a sort entry names its path in "by"');
      }
      if (
        entry.direction != null &&
        entry.direction !== 'asc' &&
        entry.direction !== 'desc'
      ) {
        throw new LogQueryError(
          `a sort direction is asc or desc, not ${JSON.stringify(entry.direction)}`,
        );
      }
      if (!q.group) {
        assertPath(entry.by, 'a sort entry');
      }
    }
  }
  if (q.page != null) {
    if (!isPlainObject(q.page)) {
      throw new LogQueryError(
        'page is an object of size, number, total',
        'invalid-page',
      );
    }
    assertMembers(q.page, ['size', 'number', 'total'], 'page');
    if (
      q.page.total != null &&
      !['exact', 'capped', 'none'].includes(q.page.total)
    ) {
      throw new LogQueryError(
        `page.total is one of exact, capped, none, not ${JSON.stringify(q.page.total)}`,
        'invalid-page',
      );
    }
  }
  if (q.facets != null) {
    if (!Array.isArray(q.facets)) {
      throw new LogQueryError('facets is a list of { by, size }');
    }
    if (q.facets.length > LOG_MAX_FACETS) {
      throw new LogQueryError(
        `facets lists ${q.facets.length}, and a query takes at most ${LOG_MAX_FACETS} facets`,
        'limit-exceeded',
      );
    }
    let seen = new Set<string>();
    for (let facet of q.facets as unknown[]) {
      if (!isPlainObject(facet)) {
        throw new LogQueryError('a facet is an object of by, size');
      }
      assertMembers(facet, ['by', 'size'], 'a facet');
      if (facet.by === undefined) {
        throw new LogQueryError(
          'a facet names its path in "by"',
          'missing-member',
        );
      }
      assertPath(facet.by, 'a facet\'s "by"');
      if (seen.has(facet.by as string)) {
        // Its counts are answered under its path, so a second would replace
        // the first.
        throw new LogQueryError(
          `two facets count by "${facet.by}"; a query counts a path once`,
          'conflicting-members',
        );
      }
      seen.add(facet.by as string);
      if (
        facet.size !== undefined &&
        (typeof facet.size !== 'number' ||
          !Number.isInteger(facet.size) ||
          facet.size < 1 ||
          facet.size > LOG_MAX_FACET_SIZE)
      ) {
        throw new LogQueryError(
          `a facet's size must be an integer from 1 to ${LOG_MAX_FACET_SIZE}, not ${JSON.stringify(facet.size)}`,
        );
      }
    }
  }
  if (q.select !== undefined && !Array.isArray(q.select)) {
    throw new LogQueryError('select is a list of paths');
  }
  if (q.select !== undefined && q.group !== undefined) {
    throw new LogQueryError(
      'select and group are separate shapes: a grouped row is its group and aggregates',
      'conflicting-members',
    );
  }
  if (q.select && q.select.length > LOG_MAX_SELECT) {
    throw new LogQueryError(
      `select lists ${q.select.length} paths, and a query selects at most ${LOG_MAX_SELECT}`,
      'limit-exceeded',
    );
  }
  q.select?.forEach((path) => assertPath(path, 'select'));
  if (q.group != null) {
    if (!isPlainObject(q.group)) {
      throw new LogQueryError('group is an object of by, aggregates');
    }
    assertMembers(q.group, ['by', 'aggregates'], 'group');
    let by: unknown = q.group.by;
    if (by === undefined) {
      throw new LogQueryError(
        'group.by names a path or a list of paths',
        'missing-member',
      );
    }
    if (typeof by !== 'string' && !Array.isArray(by)) {
      throw new LogQueryError('group.by names a path or a list of paths');
    }
    let paths = Array.isArray(by) ? by : [by];
    if (paths.length === 0) {
      throw new LogQueryError(
        'group.by names at least one path',
        'missing-member',
      );
    }
    if (paths.length > LOG_MAX_GROUP_BY) {
      throw new LogQueryError(
        `group.by lists ${paths.length} paths, and a query groups by at most ${LOG_MAX_GROUP_BY}`,
        'limit-exceeded',
      );
    }
    paths.forEach((path) => assertPath(path, 'group.by'));
    if (new Set(paths).size !== paths.length) {
      throw new LogQueryError(
        'group.by names a path twice; a group key holds each path once',
        'conflicting-members',
      );
    }
    if (q.group.aggregates != null && !isPlainObject(q.group.aggregates)) {
      throw new LogQueryError(
        'group.aggregates is an object of name: aggregate',
      );
    }
    let aggregates = Object.entries(q.group.aggregates ?? {});
    if (aggregates.length > LOG_MAX_AGGREGATES) {
      throw new LogQueryError(
        `group.aggregates names ${aggregates.length}, and a query takes at most ${LOG_MAX_AGGREGATES}`,
        'limit-exceeded',
      );
    }
    for (let [name, spec] of aggregates) {
      validateAggregate(name, spec);
    }
    let names = new Set(aggregates.map(([name]) => name));
    for (let { by: key } of q.sort ?? []) {
      if (!paths.includes(key) && !names.has(key)) {
        throw new LogQueryError(
          `a grouped query sorts by a group path or an aggregate, not ${JSON.stringify(key)}`,
        );
      }
    }
  }
}

function assertLogTimeZone(zone: unknown): string {
  try {
    return assertTimeZone(zone);
  } catch (e) {
    if (e instanceof InvalidQueryError) {
      throw new LogQueryError(e.message, e.code);
    }
    throw e;
  }
}

function validateAggregate(name: string, spec: unknown) {
  if (!/^[A-Za-z_]\w*$/.test(name)) {
    throw new LogQueryError(
      `Invalid aggregate name: ${JSON.stringify(name.slice(0, 80))} (a name is a letter or _ then letters, digits or _)`,
    );
  }
  if (!isPlainObject(spec)) {
    throw new LogQueryError(
      `aggregate "${name}" is one of ${AGGREGATE_OPS.join(', ')}, as { <op>: <path> }`,
    );
  }
  let entries = Object.entries(spec);
  if (entries.length !== 1) {
    throw new LogQueryError(
      `aggregate "${name}" names one of ${AGGREGATE_OPS.join(', ')}, not ${entries.length}`,
      entries.length === 0 ? 'missing-member' : 'conflicting-members',
    );
  }
  let [op, path] = entries[0];
  if (!AGGREGATE_OPS.includes(op)) {
    let near = nearestMember(op, AGGREGATE_OPS);
    throw new LogQueryError(
      `aggregate "${name}": unknown aggregate "${op.slice(0, 80)}"${near ? `; did you mean "${near}"?` : ''} (it is one of ${AGGREGATE_OPS.join(', ')})`,
      'unknown-key',
    );
  }
  if (op === 'count') {
    if (path !== true && typeof path !== 'string') {
      throw new LogQueryError(
        `aggregate "${name}" counts true (every line) or a path`,
      );
    }
  } else if (typeof path !== 'string') {
    throw new LogQueryError(`aggregate "${name}" takes a path`);
  }
  if (typeof path === 'string') {
    assertPath(path, `aggregate "${name}"`);
  }
}

// A path's value as jsonb, for a projection or a group key.
function valueOf(path: string): Expression {
  if (path === 'at') {
    // The same ISO form a full row's `at` takes.
    return [`to_jsonb(${isoTime('l.at')})`];
  }
  if (path === 'actor') {
    return ['to_jsonb(l.actor)'];
  }
  if (path === 'line') {
    return ['to_jsonb(l.line_no)'];
  }
  if (path === 'file') {
    return ['to_jsonb(l.url)'];
  }
  // A JSON null is no value, the same as an absent one: one group key, and
  // nothing for count, distinct or a facet to count.
  return ['NULLIF(', ...jsonPath(path), ", 'null'::jsonb)"];
}

function numericOf(path: string): Expression {
  if (path === 'line') {
    return ['l.line_no::numeric'];
  }
  if (COLUMNS.has(path)) {
    return ['NULL::numeric'];
  }
  return [
    'CASE WHEN jsonb_typeof(',
    ...jsonPath(path),
    ") = 'number' THEN (",
    ...textPath(path),
    ')::numeric END',
  ];
}

function aggregateSql(name: string, spec: LogAggregate): Expression {
  let [op, path] = Object.entries(spec)[0] as [string, string | true];
  let alias = `AS "a_${name}"`;
  if (op === 'count') {
    return path === true
      ? ['to_jsonb(COUNT(*))', alias]
      : ['to_jsonb(COUNT(', ...valueOf(path as string), '))', alias];
  }
  let p = path as string;
  if (op === 'latest') {
    return [
      '(array_agg(',
      ...valueOf(p),
      'ORDER BY l.at DESC NULLS LAST, l.url COLLATE "C" DESC, l.line_no DESC))[1]',
      alias,
    ];
  }
  if (op === 'distinct') {
    return [
      'COALESCE(to_jsonb(array_agg(DISTINCT',
      ...valueOf(p),
      ') FILTER (WHERE',
      ...valueOf(p),
      "IS NOT NULL)), '[]'::jsonb)",
      alias,
    ];
  }
  if (p === 'at' && (op === 'min' || op === 'max')) {
    return [`to_jsonb(${isoTime(`${op.toUpperCase()}(l.at)`)})`, alias];
  }
  if (op === 'sum' || op === 'avg') {
    return [`to_jsonb(${op.toUpperCase()}(`, ...numericOf(p), '))', alias];
  }
  // min / max: numerically over numbers, else by text.
  let fn = op.toUpperCase();
  return [
    `COALESCE(to_jsonb(${fn}(`,
    ...numericOf(p),
    `)), to_jsonb(${fn}(`,
    ...(p === 'actor'
      ? ['l.actor']
      : p === 'file'
        ? ['l.url']
        : p === 'line'
          ? ['l.line_no::text']
          : textPath(p)),
    ')))',
    alias,
  ];
}

function pageTotal(
  mode: 'exact' | 'capped' | 'none',
  number: number,
  size: number,
  shown: number,
  hasMore: boolean,
  count: (cap?: number) => Promise<number>,
): Promise<{ total: number; totalIsEstimate: boolean }> {
  // The last page ends at the true count, so nothing is counted. An empty
  // page after the first lies past the end and says nothing about it.
  if (!hasMore && size > 0 && (shown > 0 || number === 0)) {
    return Promise.resolve({
      total: number * size + shown,
      totalIsEstimate: false,
    });
  }
  // A page with no next page is counted exactly, whatever the mode.
  if (!hasMore && size > 0) {
    return count().then((total) => ({ total, totalIsEstimate: false }));
  }
  if (mode === 'none') {
    return Promise.resolve({
      total: number * size + shown,
      totalIsEstimate: hasMore,
    });
  }
  if (mode === 'capped') {
    return count(SEARCH_TOTAL_CAP + 1).then((counted) => ({
      total: Math.min(counted, SEARCH_TOTAL_CAP),
      totalIsEstimate: counted > SEARCH_TOTAL_CAP,
    }));
  }
  return count().then((total) => ({ total, totalIsEstimate: false }));
}

// What a caller may read of one log: all of its lines, only the lines a
// realm policy admits them to (`{ actor }`: the lines the realm stamped with
// their id), or none.
export type LogAccess = 'all' | { actor: string } | 'none';

export interface LogQueryOptions {
  // Resolves a prefix-form `from.log` to the realm's URL.
  virtualNetwork?: VirtualNetwork;
  // Reads a log's text, so a log no index pass has synced yet is synced
  // before it is searched. Without one, such a log is refused
  // (`log-not-indexed`) rather than answered as empty.
  readLogFile?: LogFileReader;
  // What the caller may read of each log the query names. Unset, every log
  // is read whole (the caller reads the realm).
  access?: (url: string) => LogAccess | Promise<LogAccess>;
  // The query's one clock reading, when an enclosing query has one. A
  // reading made by `clockInZone` carries the zone of the query it came
  // from, which a query naming no zone of its own reckons in.
  now?: Date;
  // The caller's zone, for a query that names none (`timeZone`).
  timeZone?: string;
  // The realm's default zone, for a query and a caller that name none.
  realmTimeZone?: () => Promise<string | undefined>;
  // The snapshot of an enclosing search, when this one runs inside it.
  reader?: DBAdapter;
  signal?: AbortSignal;
}

// The logs a query reads, in file order, each with what the caller may read
// of it; a folder's logs the caller may read none of are left out, as a
// realm the caller cannot read contributes nothing to a federated search.
interface ResolvedSource {
  files: { url: string; actor?: string }[];
  many: boolean;
}

async function resolveSource(
  dbAdapter: DBAdapter,
  realmURL: string,
  from: LogSource,
  opts: LogQueryOptions,
): Promise<ResolvedSource> {
  let named: string[];
  let underFolder: string | undefined;
  if ('log' in from) {
    named = [resolveLogURL(from.log, realmURL, opts.virtualNetwork)];
  } else if (Array.isArray(from.logs)) {
    named = [
      ...new Set(
        from.logs.map((log) =>
          resolveLogURL(log, realmURL, opts.virtualNetwork),
        ),
      ),
    ];
  } else {
    underFolder = resolveLogFolder(
      from.logs.under,
      realmURL,
      opts.virtualNetwork,
    );
    named = await logsUnder(dbAdapter, realmURL, underFolder);
    if (named.length > LOG_MAX_FILES) {
      throw new LogQueryError(
        `${underFolder} holds ${named.length} logs, and a query reads at most ${LOG_MAX_FILES}: name a narrower folder`,
        'limit-exceeded',
      );
    }
  }
  named.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  let files: ResolvedSource['files'] = [];
  for (let url of named) {
    let access = opts.access ? await opts.access(url) : 'all';
    if (access === 'none') {
      if (underFolder !== undefined) continue;
      throw new LogQueryError(
        `${url}: this log's lines are not readable to you`,
        'log-not-readable',
        403,
      );
    }
    files.push(access === 'all' ? { url } : { url, actor: access.actor });
  }
  return { files, many: !('log' in from) };
}

// The logs in a folder: every `.jsonl` and `.log` file the realm's index
// holds under it, and any log whose lines are already synced there.
async function logsUnder(
  dbAdapter: DBAdapter,
  realmURL: string,
  folder: string,
): Promise<string[]> {
  let rows = (await runQuery(dbAdapter, [
    'SELECT url FROM boxel_index WHERE realm_url =',
    param(realmURL),
    "AND type = 'file' AND (is_deleted = false OR is_deleted IS NULL)",
    'AND starts_with(url,',
    param(folder),
    ") AND (url LIKE '%.jsonl' OR url LIKE '%.log')",
    'UNION SELECT url FROM boxel_log_files WHERE realm_url =',
    param(realmURL),
    'AND starts_with(url,',
    param(folder),
    ')',
  ] as Expression)) as { url: string }[];
  return [...new Set(rows.map((r) => r.url).filter(isLogFileURL))];
}

// Syncs each of `urls` that has no rows yet (a log written before the line
// tables existed, or one no pass has reached), reading it with `read`. A log
// that still has no state after that does not exist (`log-not-found`), or,
// with no reader to ask, could not be synced (`log-not-indexed`).
export async function ensureLogsIndexed(
  dbAdapter: DBAdapter,
  realmURL: string,
  urls: string[],
  read: LogFileReader | undefined,
): Promise<void> {
  if (urls.length === 0) return;
  let known = async () =>
    new Set(
      (
        (await runQuery(dbAdapter, [
          'SELECT url FROM boxel_log_files WHERE url = ANY(',
          param(`{${urls.map(arrayElement).join(',')}}`),
          '::text[])',
        ] as Expression)) as { url: string }[]
      ).map((r) => r.url),
    );
  let synced = await known();
  let missing = urls.filter((url) => !synced.has(url));
  if (missing.length === 0) return;
  if (!read) {
    throw new LogQueryError(
      `${missing[0]} has no indexed lines yet; it is searchable once the realm indexes it`,
      'log-not-indexed',
      409,
    );
  }
  await ensureLogPartition(dbAdapter, realmURL);
  for (let url of missing) {
    await dbAdapter.withTransaction(async (tx) => {
      await syncLogFile(
        { dbAdapter, realmURL, query: (e) => tx(e), readLogFile: read },
        url,
      );
    });
  }
  synced = await known();
  let absent = urls.find((url) => !synced.has(url));
  if (absent) {
    throw new LogQueryError(`${absent} does not exist`, 'log-not-found', 404);
  }
}

// The query's WHERE: the logs it reads, each scoped to the caller's own
// lines where a policy says so, and the caller's filter. Every statement of
// the search shares it, so rows, counts, groups and facets cover one set.
function whereClause(
  realmURL: string,
  source: ResolvedSource,
  filter: LogFilter | undefined,
  ctx: CompileContext,
): Expression {
  let whole = source.files.filter((f) => !isScoped(f));
  let scoped = source.files.filter(isScoped);
  let reach: Expression[] = [];
  if (whole.length === 1) {
    reach.push(['l.url =', param(whole[0].url)]);
  } else if (whole.length > 1) {
    reach.push([
      'l.url = ANY(ARRAY[',
      ...whole.flatMap((f, i) => [...(i > 0 ? [','] : []), param(f.url)]),
      ']::text[])',
    ]);
  }
  for (let file of scoped) {
    reach.push([
      '(l.url =',
      param(file.url),
      'AND l.actor =',
      param(file.actor!),
      ')',
    ]);
  }
  return [
    // The realm's own partition of the lines (`log-line-partitions.ts`).
    'WHERE l.realm_url =',
    param(realmURL),
    'AND',
    ...andAll(reach, 'OR'),
    'AND',
    ...(filter ? compileFilter(filter, ctx) : ['TRUE']),
  ];
}

// A `file` value as the URL a row's `file` holds: realm-relative or
// absolute, as `from` names a log.
function fileURLIn(realmURL: string): (value: Json) => string {
  let realm = new URL(realmURL);
  return (value) => {
    try {
      return new URL(resolveRRIReference(String(value), realm)).href;
    } catch {
      return String(value);
    }
  };
}

function isScoped(file: ResolvedSource['files'][number]): boolean {
  return file.actor !== undefined;
}

function countBound(e: Expression): number {
  let n = 0;
  for (let part of e) {
    if (typeof part === 'object' && part !== null && 'kind' in part) {
      if ((part as { kind?: string }).kind === 'param') n++;
    }
  }
  return n;
}

export async function runLogQuery(
  dbAdapter: DBAdapter,
  realmURL: string,
  q: LogQuery,
  opts: LogQueryOptions = {},
): Promise<LogQueryResult> {
  dialectFor(dbAdapter.kind).requirePostgres(
    'Log queries need Postgres',
    (m, code) => new LogQueryError(m, code),
  );
  // One clock reading for the whole query: every relative time in it, and
  // in any query it encloses, is reckoned from this instant.
  let now = opts.now ?? new Date();
  validateLogQuery(q, now);
  // The zone, resolved once as a card query resolves it: the query's own,
  // the caller's, the enclosing query's clock's, the realm's default, UTC.
  let zone =
    (q.timeZone !== undefined ? assertLogTimeZone(q.timeZone) : undefined) ??
    (opts.timeZone !== undefined
      ? assertLogTimeZone(opts.timeZone)
      : undefined) ??
    (opts.now && !isUtcZone(zoneOfClock(opts.now))
      ? zoneOfClock(opts.now)
      : undefined) ??
    (await opts.realmTimeZone?.()) ??
    DEFAULT_TIME_ZONE;
  if (!isUtcZone(zone)) {
    await assertPostgresKnowsTimeZone(zone, (sql, bind) =>
      dbAdapter.execute(sql, { bind: bind as any }),
    );
  }
  now = clockInZone(now, zone);
  // Bounds were checked against a UTC clock; checked again in the zone.
  validateLogQuery(q, now);
  let warnings: LogQueryWarning[] = [];
  // Whole numbers only: both go into LIMIT and OFFSET.
  let wholeNumber = (value: unknown, what: string): number => {
    let n = Number(value);
    // A safe integer: past 2^53 a number is no longer exact, and the
    // offset it makes would leave Postgres's bigint range.
    if (!Number.isSafeInteger(n) || n < 0) {
      throw new LogQueryError(
        `page.${what} is a whole number, not ${JSON.stringify(value)}`,
        'invalid-page',
      );
    }
    return n;
  };
  let askedSize = wholeNumber(q.page?.size ?? LOG_DEFAULT_PAGE_SIZE, 'size');
  let size = Math.min(LOG_MAX_PAGE_SIZE, askedSize);
  if (askedSize > size) {
    warnings.push({
      code: PAGE_SIZE_CLAMPED,
      message: `page.size ${askedSize} is more than a page of log lines holds, so this page holds at most ${size.toLocaleString('en-US')} rows: page through the rest with page.number`,
    });
  }
  let number = wholeNumber(q.page?.number ?? 0, 'number');
  if (number > MAX_PAGE_NUMBER || !Number.isSafeInteger(number * size)) {
    throw new LogQueryError(
      'page.number is past any page a log can have',
      'invalid-page',
    );
  }
  let totalMode = q.page?.total ?? 'capped';

  // The realm's own partition of the lines, made (and its lines moved into
  // it) by its first query if no append has made it yet.
  if (!opts.reader) {
    await ensureLogPartition(dbAdapter, realmURL);
  }
  let source = await resolveSource(dbAdapter, realmURL, q.from, opts);
  let policyScoped = source.files.filter(isScoped).map((f) => f.url);
  if (!opts.reader) {
    await ensureLogsIndexed(
      dbAdapter,
      realmURL,
      source.files.map((f) => f.url),
      opts.readLogFile,
    );
  }
  let ctx: CompileContext = { now, fileURL: fileURLIn(realmURL) };
  let where: Expression =
    source.files.length === 0
      ? ['WHERE FALSE']
      : whereClause(realmURL, source, q.filter, ctx);
  if (countBound(where) > LOG_MAX_BOUND_VALUES) {
    throw new LogQueryError(
      `this query compares with more than ${LOG_MAX_BOUND_VALUES.toLocaleString('en-US')} values in all`,
      'limit-exceeded',
    );
  }
  let answer = async (reader: DBAdapter) =>
    await answerLogQuery(reader, q, source, where, {
      size,
      number,
      totalMode,
      signal: opts.signal,
      zone,
    });
  // One snapshot: the page, its count and its facets read the database as
  // it stood at the first of them, whatever an index pass commits between.
  let result =
    opts.reader || !dbAdapter.withReadSnapshot
      ? await answer(opts.reader ?? dbAdapter)
      : await dbAdapter.withReadSnapshot(
          answer,
          opts.signal ? { signal: opts.signal } : undefined,
        );
  result.meta = {
    ...result.meta,
    ...('log' in q.from
      ? { log: source.files[0]?.url }
      : { logs: source.files.map((f) => f.url) }),
    ...(policyScoped.length ? { policyScopedLogs: policyScoped } : {}),
    // As a card query says it: when the query named a zone, or one other
    // than UTC applied.
    ...(q.timeZone !== undefined || !isUtcZone(zone) ? { timeZone: zone } : {}),
    ...(warnings.length || result.meta.warnings?.length
      ? { warnings: [...warnings, ...(result.meta.warnings ?? [])] }
      : {}),
  };
  return result;
}

async function answerLogQuery(
  reader: DBAdapter,
  q: LogQuery,
  source: ResolvedSource,
  where: Expression,
  {
    size,
    number,
    totalMode,
    signal,
    zone,
  }: {
    size: number;
    number: number;
    totalMode: 'exact' | 'capped' | 'none';
    signal?: AbortSignal;
    zone: string;
  },
): Promise<LogQueryResult> {
  let run = (e: Expression) => runQuery(reader, e, undefined, signal);
  let limit = `LIMIT ${size + 1} OFFSET ${number * size}`;
  let data: Record<string, unknown>[] = [];
  let hasMore = false;
  let count: (cap?: number) => Promise<number>;

  if (q.group) {
    let by = Array.isArray(q.group.by) ? q.group.by : [q.group.by];
    let keys: Expression = [];
    by.forEach((path, i) => {
      if (i > 0) keys.push(',');
      keys.push(...valueOf(path), `AS "g${i}"`);
    });
    let aggregates = Object.entries(q.group.aggregates ?? {});
    let aggSql: Expression = [];
    for (let [name, spec] of aggregates) {
      aggSql.push(',', ...aggregateSql(name, spec));
    }
    let groupBy = `GROUP BY ${by.map((_, i) => i + 1).join(', ')}`;
    let names = new Set(aggregates.map(([name]) => name));
    let order = (q.sort ?? []).map(({ by: key, direction }) => {
      let dir = direction === 'desc' ? 'DESC' : 'ASC';
      let gi = by.indexOf(key);
      if (gi >= 0) return `"g${gi}" ${dir} NULLS LAST`;
      if (names.has(key)) return `"a_${key}" ${dir} NULLS LAST`;
      // validateLogQuery refused it.
      throw new LogQueryError(`cannot sort by ${JSON.stringify(key)}`);
    });
    order.push(...by.map((_, i) => `"g${i}" ASC NULLS LAST`));
    let rows = size
      ? ((await run([
          'SELECT',
          ...keys,
          ...aggSql,
          'FROM boxel_log_lines AS l',
          ...where,
          groupBy,
          `ORDER BY ${order.join(', ')}`,
          limit,
        ])) as Record<string, unknown>[])
      : [];
    hasMore = rows.length > size;
    data = rows.slice(0, size).map((r) => {
      let group: Record<string, unknown> = {};
      by.forEach((path, i) => (group[path] = r[`g${i}`] ?? null));
      let out: Record<string, unknown> = { group };
      for (let [name] of aggregates) out[name] = r[`a_${name}`] ?? null;
      return out;
    });
    count = async (cap) => {
      let [row] = (await run([
        'SELECT COUNT(*) AS total FROM (SELECT 1 FROM boxel_log_lines AS l',
        ...where,
        // Grouped by the key expressions themselves: this subquery has no
        // SELECT list for ordinals to name.
        'GROUP BY',
        ...by.flatMap((path, i) =>
          i > 0 ? [',', ...valueOf(path)] : valueOf(path),
        ),
        ...(cap ? [`LIMIT ${cap}`] : []),
        ') AS g',
      ])) as { total: unknown }[];
      return Number(row?.total ?? 0);
    };
  } else {
    let selected = q.select ? [...new Set(q.select)] : undefined;
    let columns: Expression =
      selected && selected.length
        ? [
            'l.line_no, l.url, jsonb_build_object(',
            ...selected.flatMap((path, i) => [
              ...(i > 0 ? [','] : []),
              param(path),
              '::text,',
              ...valueOf(path),
            ]),
            ') AS projected',
          ]
        : ['l.line_no, l.url, l.at, l.actor, l.entry'];
    let rows = size
      ? ((await run([
          'SELECT',
          ...columns,
          'FROM boxel_log_lines AS l',
          ...where,
          orderBy(q.sort, source.files.length > 1),
          limit,
        ])) as Record<string, unknown>[])
      : [];
    hasMore = rows.length > size;
    data = rows.slice(0, size).map((r) => {
      let file = source.many ? { file: r.url as string } : {};
      if ('projected' in r) {
        let projected =
          typeof r.projected === 'string'
            ? JSON.parse(r.projected)
            : (r.projected as Record<string, unknown>);
        return { line: Number(r.line_no), ...file, ...projected };
      }
      return {
        line: Number(r.line_no),
        ...file,
        at: r.at == null ? null : new Date(r.at as string).toISOString(),
        actor: r.actor,
        entry: typeof r.entry === 'string' ? JSON.parse(r.entry) : r.entry,
      };
    });
    count = async (cap) => {
      let [row] = (await run(
        cap
          ? [
              'SELECT COUNT(*) AS total FROM (SELECT 1 FROM boxel_log_lines AS l',
              ...where,
              `LIMIT ${cap}) AS capped`,
            ]
          : ['SELECT COUNT(*) AS total FROM boxel_log_lines AS l', ...where],
      )) as { total: unknown }[];
      return Number(row?.total ?? 0);
    };
  }

  let { total, totalIsEstimate } = await pageTotal(
    totalMode,
    number,
    size,
    data.length,
    hasMore,
    count,
  );

  let facets: Record<string, { value: Json; count: number }[]> | undefined;
  if (q.facets?.length) {
    facets = {};
    for (let facet of q.facets) {
      // `at` counts per day, the UTC day, whatever the session's zone.
      let value: Expression =
        facet.by === 'at' ? dayOf('l.at', zone) : valueOf(facet.by);
      let counted = (await run([
        'SELECT',
        ...value,
        'AS value, COUNT(*) AS count FROM boxel_log_lines AS l',
        ...where,
        // Lines with no value are left out before the limit, so `size`
        // counts values.
        'AND',
        ...value,
        'IS NOT NULL',
        'GROUP BY 1 ORDER BY 2 DESC, 1',
        `LIMIT ${facet.size ?? LOG_DEFAULT_FACET_SIZE}`,
      ])) as { value: Json; count: unknown }[];
      facets[facet.by] = counted.map((r) => ({
        value: r.value,
        count: Number(r.count),
      }));
    }
  }

  return {
    data,
    meta: {
      page: { total, hasMore },
      ...(facets ? { facets } : {}),
      ...(totalIsEstimate
        ? {
            warnings: [
              {
                code: TOTAL_ESTIMATED,
                message: totalEstimatedMessage(
                  totalMode === 'none' ? 'uncounted' : 'capped',
                ),
              },
            ],
          }
        : {}),
    },
  };
}

// The distinct values of `select` over a log query's lines: what a card
// query's `let` binding whose `from` is a log reads
// (`{ from: { log, filter }, select: 'what.postUri' }`). At most `cap` of
// them, as a list binding holds, the most recently written first (by their
// latest line's time, then file and line), so a cut list keeps what was
// written last; `truncated` says it was cut.
export async function logBindingValues(
  dbAdapter: DBAdapter,
  realmURL: string,
  from: { filter?: LogFilter } & LogSource,
  select: string,
  cap: number,
  opts: LogQueryOptions = {},
): Promise<{ values: Json[]; truncated?: true }> {
  dialectFor(dbAdapter.kind).requirePostgres(
    'A binding read from a log needs Postgres',
    (m, code) => new LogQueryError(m, code),
  );
  let now = opts.now ?? new Date();
  let { filter, ...sourceOnly } = from;
  let q: LogQuery = {
    from: sourceOnly as LogSource,
    ...(filter !== undefined ? { filter } : {}),
    select: [select],
  };
  validateLogQuery(q, now);
  let reader = opts.reader ?? dbAdapter;
  let source = await resolveSource(reader, realmURL, q.from, opts);
  // Inside a search's snapshot nothing is synced: a log with no rows there
  // is refused rather than read as empty.
  await ensureLogsIndexed(
    reader,
    realmURL,
    source.files.map((f) => f.url),
    opts.reader ? undefined : opts.readLogFile,
  );
  if (source.files.length === 0) return { values: [] };
  let where = whereClause(realmURL, source, filter, {
    now,
    fileURL: fileURLIn(realmURL),
  });
  let read = async (db: DBAdapter) =>
    (await runQuery(
      db,
      [
        'SELECT v.value::text AS value FROM (SELECT',
        ...valueOf(select),
        'AS value,',
        'MAX(l.at) AS last_at,',
        "MAX(l.url COLLATE \"C\" || ':' || lpad(l.line_no::text, 10, '0')) AS last_line",
        'FROM boxel_log_lines AS l',
        ...where,
        'AND',
        ...valueOf(select),
        'IS NOT NULL GROUP BY 1) AS v',
        'ORDER BY v.last_at DESC NULLS LAST, v.last_line DESC',
        `LIMIT ${cap + 1}`,
      ] as Expression,
      undefined,
      opts.signal,
    )) as { value: unknown }[];
  let rows =
    opts.reader || !dbAdapter.withReadSnapshot
      ? await read(reader)
      : await dbAdapter.withReadSnapshot(read);
  let values = rows.slice(0, cap).map((r) => JSON.parse(String(r.value)));
  return rows.length > cap ? { values, truncated: true } : { values };
}

// The realm's default zone for a log search: one implementation with the
// card engine's (query-engine/realm-time-zone.ts).
export { realmTimeZoneFromIndex } from './query-engine/realm-time-zone.ts';

// A `_search` answer for a log query: the result, or the refusal of a query
// this module can't run, as a status and a JSON body.
export async function logSearchResponse(
  dbAdapter: DBAdapter,
  realmURL: string,
  payload: LogQuery,
  opts: LogQueryOptions = {},
): Promise<{ status: number; body: unknown }> {
  try {
    return {
      status: 200,
      body: await runLogQuery(dbAdapter, realmURL, payload, opts),
    };
  } catch (e) {
    if (e instanceof LogQueryError) {
      return { status: e.status, body: logQueryErrorBody(e) };
    }
    throw e;
  }
}

export function logQueryErrorBody(e: LogQueryError) {
  return {
    errors: [
      {
        status: String(e.status),
        title:
          e.status === 404
            ? 'Not Found'
            : e.status === 403
              ? 'Forbidden'
              : e.status === 409
                ? 'Not Indexed'
                : 'Invalid Query',
        message: e.status === 400 ? `Invalid query: ${e.message}` : e.message,
        code: e.code,
      },
    ],
  };
}
