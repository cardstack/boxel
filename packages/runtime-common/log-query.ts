// The log-line source of a Query V2 search: a search over the lines of
// append-only logs, answered from `boxel_log_lines` (`log-line-index.ts`)
// without reading the files.
//
//   {
//     from: { log: 'TasteProfile/my-taste.history.jsonl' },   // realm-relative or absolute
//     filter: { every: [{ eq: { 'what.action': 'like' } }, { range: { at: { gte: 'now-7d' } } }] },
//     sort: [{ by: 'at', direction: 'desc' }],
//     page: { size: 50, number: 0, total: 'capped' },
//     facets: [{ by: 'what.action', size: 10 }],
//   }
//
// This module says what a line is and how its paths read: `at`, `actor`,
// `line` and `file` are the row's columns, any other path reads the entry's
// jsonb. It resolves which logs `from` names, syncs a log no index pass has
// reached, and scopes a caller a policy admits to their own lines (ANDed into
// the one WHERE every statement shares). Everything else is the card
// engine's: validation (query-check.ts `assertLogQuery`, with this source's
// profile), the filter compiler (filter-operators.ts), ORDER BY
// (sort-order.ts), totals (paging.ts), projection aliases (columns.ts), and
// facet and aggregate SQL (facet-sql.ts). See docs/search.md, "Searching a
// log".

import {
  addExplicitParens,
  any,
  every,
  param,
  query as runQuery,
  type Expression,
} from './expression.ts';
import type { DBAdapter } from './db.ts';
import { dialectFor } from './query-engine/dialect.ts';
import { CONTAINMENT_ANY_MAX } from './query-engine/filter-sql.ts';
import { InvalidQueryError, LogQueryError } from './invalid-query-error.ts';
import { logRefusal, refuseLog } from './query-v2/query-refusals.ts';
import {
  type FilterSource,
  compileFilterTree,
} from './query-engine/filter-operators.ts';
import type { FilterPolarity } from './query-engine/types.ts';
import { orderBy, type OrderTerm } from './query-engine/sort-order.ts';
import { columnAlias, pageTotal } from './query-engine/index-sql.ts';
import {
  type SourceReads,
  sourceFacetSql,
  sourceGroupSql,
} from './query-engine/facet-sql.ts';
import {
  assertPostgresKnowsTimeZone,
  assertTimeZone,
  clockInZone,
  DEFAULT_TIME_ZONE,
  isUtcZone,
  pgBucketLabel,
  pgLocalTimestamp,
  zoneOfClock,
} from './query-v2/time-zone.ts';
import {
  DEFAULT_FACET_SIZE,
  isRelativeDate,
  resolveRelativeDate,
} from './query-v2/query.ts';
import { assertDistinctFacets } from './query-v2/query-syntax.ts';
import {
  assertLogQuery,
  FIELD_PATH,
  LOG_MAX_FILES,
} from './query-v2/query-check.ts';
import {
  PAGE_SIZE_CLAMPED,
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
import type { LogAccess } from './query-engine/types.ts';
export type { LogAccess };

// A refusal of a log query (`LogQueryError`, invalid-query-error.ts).
export { LogQueryError } from './invalid-query-error.ts';

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
  sort?: {
    by: string;
    direction?: 'asc' | 'desc';
    missing?: 'first' | 'last';
  }[];
  page?: {
    size?: number;
    number?: number;
    total?: 'exact' | 'capped' | 'none';
  };
  facets?: { by: string; size?: number }[];
  // The paths each row carries, instead of its whole entry: a row is then
  // `{ line, <path>: value }` (and `file` when the query reads several logs).
  select?: string[];
  // One row per distinct value of `by` (a path, or several), with
  // aggregates over each group's lines: `{ group: { <path>: value }, <name>: value }`.
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
  | { contains: Record<string, Json> }
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
    // The zone, when the query named one or a zone other than UTC applied.
    timeZone?: string;
    warnings?: LogQueryWarning[];
  };
}

// A page of lines: 50 unless the query says, and at most 1,000, past which
// the size is clamped with a `page-size-clamped` warning.
export const LOG_MAX_PAGE_SIZE = 1000;
export const LOG_DEFAULT_PAGE_SIZE = 50;
// the values a query binds, past which Postgres (65,535) would refuse it
const LOG_MAX_BOUND_VALUES = 60_000;

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

// ---- what a line is ---------------------------------------------------

// A Map rather than an object: a path is the caller's string, and an object
// lookup would answer `constructor` from the prototype.
const COLUMNS: ReadonlyMap<string, string> = new Map([
  ['at', 'l.at'],
  ['actor', 'l.actor'],
  ['line', 'l.line_no'],
  ['file', 'l.url'],
]);

function pathSegments(path: string): string[] {
  if (typeof path !== 'string' || !FIELD_PATH.test(path)) {
    throw refuseLog('log-invalid-path-path-names-joined', {
      path: JSON.stringify(String(path).slice(0, 200)),
    });
  }
  return path.split('.');
}

// The path's value in the entry, as jsonb (`#>`) or as text (`#>>`).
const entryAt = (op: '#>' | '#>>', path: string): Expression => [
  `(l.entry ${op}`,
  param(`{${pathSegments(path).join(',')}}`),
  '::text[])',
];
const jsonPath = (path: string) => entryAt('#>', path);
const textPath = (path: string) => entryAt('#>>', path);

// `{"what":{"action":"like"}}` for `what.action` = "like".
function containmentFor(path: string, value: Json): string {
  let nested: Json = value;
  for (let segment of pathSegments(path).reverse()) {
    nested = { [segment]: nested };
  }
  return JSON.stringify(nested);
}

// A time as the ISO string a row's `at` is answered with.
const isoTime = (sql: string) =>
  `to_char(${sql} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

// A path's reads (facet-sql.ts): as jsonb for a projection, a group key or
// a facet (a JSON null is no value, the same as an absent one), as a number
// and as text.
function readsOf(path: string): SourceReads {
  switch (path) {
    case 'at':
      return {
        value: [`to_jsonb(${isoTime('l.at')})`],
        number: ['NULL::numeric'],
        text: [isoTime('l.at')],
        extreme: (fn) => [`to_jsonb(${isoTime(`${fn}(l.at)`)})`],
      };
    case 'line':
      return {
        value: ['to_jsonb(l.line_no)'],
        number: ['l.line_no::numeric'],
        text: ['l.line_no::text'],
      };
    case 'actor':
    case 'file':
      return {
        value: [`to_jsonb(${COLUMNS.get(path)})`],
        number: ['NULL::numeric'],
        text: [COLUMNS.get(path)!],
      };
  }
  return {
    value: ['NULLIF(', ...jsonPath(path), ", 'null'::jsonb)"],
    number: [
      'CASE WHEN jsonb_typeof(',
      ...jsonPath(path),
      ") = 'number' THEN (",
      ...textPath(path),
      ')::numeric END',
    ],
    text: textPath(path),
  };
}

// A time Date can hold, as ISO text: past about 275,000 years from 1970 a
// Date is invalid and `toISOString` throws.
function isoTimeOf(ms: number, value: Json): string {
  let date = new Date(ms);
  if (!Number.isFinite(date.getTime())) {
    throw refuseLog('log-not-time-outside-range-dates', {
      value: JSON.stringify(value),
    });
  }
  return date.toISOString();
}

// A time bound as an ISO instant: epoch milliseconds; a relative date in the
// card grammar's form (`now-7d`, `now-1M/d`), reckoned from `now`, the
// query's one clock reading, in its zone; or an ISO 8601 time, read as UTC
// when it names no zone. Anything else is refused, `March 7` included, which
// `Date.parse` would read in the server's own zone.
export function resolveLogTime(value: Json, now: Date = new Date()): string {
  if (typeof value === 'number') return isoTimeOf(value, value);
  if (typeof value !== 'string') {
    throw refuseLog('log-time-must-string-number-not', {
      value: JSON.stringify(value),
    });
  }
  let text: string = value;
  // Not the guard itself, which would leave `text` a `never` below.
  let relative: boolean = isRelativeDate(text);
  if (relative) {
    try {
      return resolveRelativeDate(text, now);
    } catch (e) {
      if (e instanceof InvalidQueryError) {
        throw logRefusal(e.message, 'invalid-value');
      }
      throw e;
    }
  }
  let ms = parseISOTimeAsUTC(text);
  if (ms === undefined) {
    throw refuseLog('log-not-time-time-iso-8601', {
      text: JSON.stringify(text.slice(0, 200)),
    });
  }
  return isoTimeOf(ms, value);
}

// The log source's profile for the validator (query-check.ts): the paths a
// line has, and the values its columns hold. `line` is a number, `at` a
// time, `actor` and `file` text; `file` takes no range.
function lineProfile(now: Date) {
  return {
    path: (path: unknown) => void pathSegments(path as string),
    value(path: string, value: unknown, bound?: string) {
      if (path === 'file' && bound) {
        throw refuseLog('log-range-does-not-take-file');
      }
      if (value === null) return;
      if (path === 'line') {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          throw refuseLog('log-must-number-not', {
            where: bound ? `line.${bound}` : 'line',
            value: JSON.stringify(value),
          });
        }
      } else if (path === 'at') {
        resolveLogTime(value as Json, now);
      } else if (!bound && COLUMNS.has(path) && typeof value !== 'string') {
        throw refuseLog('log-compares-with-text-not', {
          where: path,
          value: JSON.stringify(value),
        });
      }
    },
  };
}

// Checks every member, type and value of a query before any of it runs.
export function validateLogQuery(q: LogQuery, now: Date = new Date()): void {
  assertLogQuery(q, lineProfile(now));
}

// ---- the line as a filter source --------------------------------------

// What a filter compiles against: the query's clock, and how a `file`
// value names a log.
interface CompileContext {
  now: Date;
  fileURL: (value: Json) => string;
}

// `range: { at: { constructor: … } }` must not read the prototype.
const RANGE_OPS: ReadonlyMap<string, string> = new Map([
  ['gt', '>'],
  ['gte', '>='],
  ['lt', '<'],
  ['lte', '<='],
]);

// `any` over SQL with no symbolic node.
const anyOf = (parts: Expression[]) => any(parts) as Expression;

// Log lines as a filter source (query-engine/filter-operators.ts), so a
// missing value matches neither a filter nor its `not`, as on a card.
const LOG_FIELDS: FilterSource<CompileContext> = {
  anchor: (_filter, scope) => ({ scope, conjuncts: [] }),
  eq: (ctx, path, value, polarity) =>
    lineEq(path, value as Json, polarity, ctx),
  in: (ctx, path, values, polarity) =>
    lineIn(path, values as Json[], polarity, ctx),
  // `at` in its ISO form, never in the session's time zone
  like: (_ctx, path, pattern) => [
    ...(COLUMNS.has(path) ? readsOf(path).text : textPath(path)),
    'ILIKE',
    param(pattern),
  ],
  range: (ctx, path, bounds) =>
    every(
      Object.entries(bounds).map(([op, value]): Expression => {
        let sqlOp = RANGE_OPS.get(op)!;
        if (path === 'at') {
          return [
            `l.at ${sqlOp}`,
            param(resolveLogTime(value as Json, ctx.now)),
            '::timestamptz',
          ];
        }
        if (path === 'line')
          return [`l.line_no ${sqlOp}`, param(Number(value))];
        if (path === 'actor') return [`l.actor ${sqlOp}`, param(String(value))];
        if (typeof value === 'number') {
          // A number bound compares numbers: a value there that is no
          // number has nothing to compare, as a missing one hasn't.
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
  // Read as text, where a JSON null is no value, the same as an absent one.
  missing: (_ctx, path) => {
    let column = COLUMNS.get(path);
    return column ? [`${column} IS NULL`] : [...textPath(path), 'IS NULL'];
  },
  refuse: () => refuseLog('log-filter-one'),
};

function columnValue(path: string, value: Json, ctx: CompileContext) {
  if (path === 'at') return resolveLogTime(value, ctx.now);
  if (path === 'line') return Number(value);
  if (path === 'file') return ctx.fileURL(value);
  return String(value);
}

// A present value at the path.
function lineEq(
  path: string,
  value: Json,
  polarity: FilterPolarity,
  ctx: CompileContext,
): Expression {
  let column = COLUMNS.get(path);
  if (column) {
    return [
      `${column} =`,
      param(columnValue(path, value, ctx)),
      ...(path === 'at' ? ['::timestamptz'] : []),
    ];
  }
  // As on a card's list field, a list at the path matches when some item
  // does; a list value is compared whole.
  let equal: Expression;
  if (typeof value !== 'object') {
    // Containments the entry GIN index answers: the value, or a list
    // holding it.
    equal = [
      '(l.entry @>',
      param(containmentFor(path, value)),
      '::jsonb OR l.entry @>',
      param(containmentFor(path, [value])),
      '::jsonb)',
    ];
  } else if (Array.isArray(value)) {
    // Contained by any value holding its items, so equality is checked on
    // the lines the index keeps.
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
  return unknownWhenMissing(path, equal, polarity);
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

// A containment is false, not unknown, with no value at the path. At
// positive polarity the two drop the same lines, and the bare containment
// keeps the index; negated, it must stay unknown.
function unknownWhenMissing(
  path: string,
  test: Expression,
  polarity: FilterPolarity,
): Expression {
  return polarity === 'negated'
    ? ['CASE WHEN', ...textPath(path), 'IS NOT NULL THEN', ...test, 'END']
    : test;
}

// Present values at the path.
function lineIn(
  path: string,
  values: Json[],
  polarity: FilterPolarity,
  ctx: CompileContext,
): Expression {
  let column = COLUMNS.get(path);
  if (column) {
    let cast =
      path === 'at' ? 'timestamptz' : path === 'line' ? 'integer' : 'text';
    return [
      `${column} = ANY(ARRAY[`,
      ...values.flatMap((v, i) => [
        ...(i > 0 ? [','] : []),
        param(columnValue(path, v, ctx)),
        `::${cast}`,
      ]),
      '])',
    ];
  }
  // One containment each, which the GIN index serves, up to the card
  // engine's limit (query-engine/filter-sql.ts).
  if (values.length <= CONTAINMENT_ANY_MAX) {
    return anyOf(values.map((v) => lineEq(path, v, polarity, ctx)));
  }
  // Past it, one comparison of the path's value with the list.
  let list = (): Expression => [
    'ARRAY[',
    ...values.flatMap((v, i) => [
      ...(i > 0 ? [','] : []),
      param(JSON.stringify(v)),
      '::jsonb',
    ]),
    ']',
  ];
  return unknownWhenMissing(
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
    polarity,
  );
}

// How a line sorts by a path (sort-order.ts `orderBy`): a column by itself
// (`line` and `file` always have a value, so an index serves them); an
// entry path numerically over numbers, then by its text.
function lineOrderTerm({ by }: { by: string }): OrderTerm {
  if (by === 'line') return { reads: [['l.line_no']], nulls: false };
  if (by === 'file') return { reads: [['l.url COLLATE "C"']], nulls: false };
  let column = COLUMNS.get(by);
  if (column) return { reads: [[column]] };
  let at = `l.entry #> ${sqlTextArrayLiteral(pathSegments(by))}`;
  return {
    reads: [
      [
        `CASE WHEN jsonb_typeof(${at}) = 'number' THEN (${at} #>> '{}')::numeric END`,
      ],
      [`(${at} #>> '{}')`],
    ],
  };
}

// ---- which logs `from` names ------------------------------------------

// Resolves `from.log` against the realm, refusing a file outside it or one
// that isn't a log. Realm-relative, absolute, or in prefix form
// (`@scope/realm/x.jsonl`, resolved through the virtual network; refused
// without one): the RRI helpers (ADR 002) join, and `RealmPaths` decides
// membership.
export function resolveLogURL(
  log: string,
  realmURL: string,
  virtualNetwork?: VirtualNetwork,
): string {
  let url = resolveInRealm(log, realmURL, virtualNetwork, 'log');
  if (!isLogFileURL(url.href)) {
    throw refuseLog('log-not-jsonl', { url: url.href });
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
    let value = JSON.stringify(reference);
    throw isPrefixForm(reference)
      ? refuseLog('log-unknown-realm-prefix', { what, value })
      : refuseLog('log-not-url', { what, value });
  }
  if (!new RealmPaths(realm).inRealm(url)) {
    throw refuseLog('log-not-in', { url: url.href, realmURL });
  }
  return url;
}

// A folder of the realm, as the URL prefix its files share, with or
// without its trailing slash.
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

export interface LogQueryOptions {
  // Resolves a prefix-form `from.log` to the realm's URL.
  virtualNetwork?: VirtualNetwork;
  // Reads a log's text, so a log no index pass has synced yet is synced
  // before it is searched; without one it is refused (`log-not-indexed`).
  readLogFile?: LogFileReader;
  // What the caller may read of each log. Unset, every log is read whole.
  access?: (url: string) => LogAccess | Promise<LogAccess>;
  // The query's one clock reading, when an enclosing query has one; a
  // reading made by `clockInZone` carries that query's zone.
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
      throw refuseLog('log-holds-logs-query-reads-at', {
        underFolder,
        length: named.length,
        LOG_MAX_FILES,
      });
    }
  }
  named.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  let files: ResolvedSource['files'] = [];
  for (let url of named) {
    let access = opts.access ? await opts.access(url) : 'all';
    if (access === 'none') {
      if (underFolder !== undefined) continue;
      throw refuseLog('log-this-s-lines-are-not', { url });
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
// still without state then does not exist (`log-not-found`), or, with no
// reader, could not be synced (`log-not-indexed`).
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
    throw refuseLog('log-has-no-indexed-lines-yet', { missing: missing[0] });
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
    throw refuseLog('log-does-not-exist', { absent });
  }
}

// The query's WHERE, which every statement shares so rows, counts, groups
// and facets cover one set: the realm's partition of the lines, the logs
// read (each scoped to the caller's own lines where a policy says so), and
// the caller's filter.
function logWhere(
  realmURL: string,
  source: ResolvedSource,
  filter: LogFilter | undefined,
  ctx: CompileContext,
): Expression {
  if (source.files.length === 0) return ['WHERE FALSE'];
  let whole = source.files.filter((f) => f.actor === undefined);
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
  for (let file of source.files) {
    if (file.actor === undefined) continue;
    reach.push([
      '(l.url =',
      param(file.url),
      'AND l.actor =',
      param(file.actor),
      ')',
    ]);
  }
  return [
    'WHERE l.realm_url =',
    param(realmURL),
    'AND',
    ...anyOf(reach),
    'AND',
    // Only strings and parameters: no log test is symbolic.
    ...((filter
      ? addExplicitParens(
          compileFilterTree(filter, LOG_FIELDS, ctx, 'positive'),
        )
      : ['TRUE']) as Expression),
  ];
}

// A `file` value as the URL a row's `file` holds, as `from` names a log.
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

// A card grammar's refusal (the validator's, the compiler's) as a log
// query's.
async function asLogRefusal<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof InvalidQueryError && !(e instanceof LogQueryError)) {
      throw logRefusal(e.message, e.code);
    }
    throw e;
  }
}

// ---- answering --------------------------------------------------------

// What a log query, or a `let` over a log, answers on SQLite, which keeps no
// log tables: no lines, said so (docs/search.md, "On SQLite").
export const SQLITE_LOG_NOT_READ = {
  code: 'sqlite-log-not-read',
  message:
    'this index (SQLite) keeps no log tables, so no log lines were read: a log query has no rows, and a let over a log has no values',
};

export function runLogQuery(
  dbAdapter: DBAdapter,
  realmURL: string,
  q: LogQuery,
  opts: LogQueryOptions = {},
): Promise<LogQueryResult> {
  return asLogRefusal(() => logQuery(dbAdapter, realmURL, q, opts));
}

async function logQuery(
  dbAdapter: DBAdapter,
  realmURL: string,
  q: LogQuery,
  opts: LogQueryOptions,
): Promise<LogQueryResult> {
  // One clock reading for the whole query and any it encloses.
  let now = opts.now ?? new Date();
  validateLogQuery(q, now);
  // Without the log tables (SQLite) a valid log query answers with no lines.
  if (!dialectFor(dbAdapter.kind).logs) {
    return {
      data: [],
      meta: {
        page: { total: 0, hasMore: false },
        warnings: [SQLITE_LOG_NOT_READ],
      },
    };
  }
  // The zone, resolved as a card query resolves it: the query's own, the
  // caller's, the enclosing query's clock's, the realm's default, UTC.
  let zone =
    (q.timeZone !== undefined ? assertTimeZone(q.timeZone) : undefined) ??
    (opts.timeZone !== undefined ? assertTimeZone(opts.timeZone) : undefined) ??
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
  let askedSize = Number(q.page?.size ?? LOG_DEFAULT_PAGE_SIZE);
  let size = Math.min(LOG_MAX_PAGE_SIZE, askedSize);
  if (askedSize > size) {
    warnings.push({
      code: PAGE_SIZE_CLAMPED,
      message: `page.size ${askedSize} is more than a page of log lines holds, so this page holds at most ${size.toLocaleString('en-US')} rows: page through the rest with page.number`,
    });
  }
  let number = Number(q.page?.number ?? 0);

  // The realm's own partition, made by its first query if no append has.
  if (!opts.reader) await ensureLogPartition(dbAdapter, realmURL);
  let source = await resolveSource(dbAdapter, realmURL, q.from, opts);
  if (!opts.reader) {
    await ensureLogsIndexed(
      dbAdapter,
      realmURL,
      source.files.map((f) => f.url),
      opts.readLogFile,
    );
  }
  let where = logWhere(realmURL, source, q.filter, {
    now,
    fileURL: fileURLIn(realmURL),
  });
  let bound = where.filter((p) => (p as { kind?: string })?.kind === 'param');
  if (bound.length > LOG_MAX_BOUND_VALUES) {
    throw refuseLog('log-this-query-compares-with-more', {
      LOG_MAX_BOUND_VALUES: LOG_MAX_BOUND_VALUES.toLocaleString('en-US'),
    });
  }
  let answer = (reader: DBAdapter) =>
    answerLogQuery(reader, q, source, where, size, number, zone, opts.signal);
  // One snapshot: the page, its count and its facets read the database as
  // it stood at the first of them.
  let result =
    opts.reader || !dbAdapter.withReadSnapshot
      ? await answer(opts.reader ?? dbAdapter)
      : await dbAdapter.withReadSnapshot(
          answer,
          opts.signal ? { signal: opts.signal } : undefined,
        );
  let policyScoped = source.files.filter((f) => f.actor).map((f) => f.url);
  warnings.push(...(result.meta.warnings ?? []));
  result.meta = {
    ...result.meta,
    ...('log' in q.from
      ? { log: source.files[0]?.url }
      : { logs: source.files.map((f) => f.url) }),
    ...(policyScoped.length ? { policyScopedLogs: policyScoped } : {}),
    // As a card query says it: when the query named a zone, or one other
    // than UTC applied.
    ...(q.timeZone !== undefined || !isUtcZone(zone) ? { timeZone: zone } : {}),
    ...(warnings.length ? { warnings } : {}),
  };
  return result;
}

async function answerLogQuery(
  reader: DBAdapter,
  q: LogQuery,
  source: ResolvedSource,
  where: Expression,
  size: number,
  number: number,
  zone: string,
  signal?: AbortSignal,
): Promise<LogQueryResult> {
  let run = async (e: Expression) =>
    (await runQuery(reader, e, undefined, signal)) as Record<string, unknown>[];
  let from: Expression = ['FROM boxel_log_lines AS l', ...where];
  let offset = number * size;
  let limit = `LIMIT ${size + 1} OFFSET ${offset}`;
  // The page's statement, the set its total counts, and a row's answer.
  let page: Expression;
  let counted: Expression;
  let answerOf: (r: Record<string, unknown>) => Record<string, unknown>;

  if (q.group) {
    let by = [q.group.by].flat();
    let aggregates = Object.entries(q.group.aggregates ?? {});
    let keys = by.map((path) => readsOf(path).value);
    ({ page, counted } = sourceGroupSql(
      from,
      keys,
      aggregates.map(([, spec]) => {
        let [op, path] = Object.entries(spec)[0] as [string, string | true];
        return [op, path === true ? true : readsOf(path)];
      }),
      aggregates.map(([name]) => name),
      'l.at DESC NULLS LAST, l.url COLLATE "C" DESC, l.line_no DESC',
      orderBy(
        q.sort ?? [],
        ({ by: key }) => ({
          reads: [[by.includes(key) ? `"g${by.indexOf(key)}"` : `"a_${key}"`]],
        }),
        by.map((_, i) => [`"g${i}" ASC NULLS LAST`]),
      ) as Expression,
      limit,
    ));
    answerOf = (r) => {
      let group: Record<string, unknown> = {};
      by.forEach((path, i) => (group[path] = r[`g${i}`] ?? null));
      let out: Record<string, unknown> = { group };
      for (let [name] of aggregates) out[name] = r[`a_${name}`] ?? null;
      return out;
    };
  } else {
    let selected = q.select?.length ? [...new Set(q.select)] : undefined;
    page = [
      'SELECT l.line_no, l.url',
      ...(selected
        ? selected.flatMap((path, i) => [
            ',',
            ...readsOf(path).value,
            `AS "${columnAlias(i)}"`,
          ])
        : [', l.at, l.actor, l.entry']),
      ...from,
      // Ties keep file order: by log, then line, whatever the direction.
      // Over one log the line alone, so a newest-first page reads the
      // `(url, at DESC NULLS LAST, line_no)` index in order.
      ...orderBy(q.sort ?? [], lineOrderTerm, [
        ...(source.files.length > 1 ? [['l.url COLLATE "C" ASC']] : []),
        ['l.line_no ASC'],
      ]),
      limit,
    ] as Expression;
    counted = ['SELECT 1', ...from];
    answerOf = (r) => {
      let line = {
        line: Number(r.line_no),
        ...(source.many ? { file: r.url as string } : {}),
      };
      if (selected) {
        let out: Record<string, unknown> = line;
        selected.forEach((path, i) => (out[path] = r[columnAlias(i)] ?? null));
        return out;
      }
      return {
        ...line,
        at: r.at == null ? null : new Date(r.at as string).toISOString(),
        actor: r.actor,
        entry: typeof r.entry === 'string' ? JSON.parse(r.entry) : r.entry,
      };
    };
  }
  let rows = size ? await run(page) : [];
  let data = rows.slice(0, size).map(answerOf);
  let hasMore = rows.length > size;
  let totalMode = q.page?.total ?? 'capped';
  let { total, totalIsEstimate } = await pageTotal(
    size,
    totalMode,
    offset,
    data.length,
    hasMore,
    async (cap) => {
      let [row] = await run([
        'SELECT COUNT(*) AS total FROM (',
        ...counted,
        ...(cap ? [`LIMIT ${cap}`] : []),
        ') AS counted',
      ]);
      return Number(row?.total ?? 0);
    },
  );

  let facets: Record<string, { value: Json; count: number }[]> | undefined;
  if (q.facets?.length) {
    facets = {};
    for (let facet of assertDistinctFacets(q.facets) as typeof q.facets) {
      // `at` counts per day of the query's zone, in date order.
      let day = facet.by === 'at';
      let counts = await run(
        sourceFacetSql(
          from,
          day
            ? [
                `to_jsonb(${pgBucketLabel('day', pgLocalTimestamp(`l.at AT TIME ZONE 'UTC'`, zone))})`,
              ]
            : readsOf(facet.by).value,
          facet.size ?? DEFAULT_FACET_SIZE,
          day ? 'value' : 'count',
        ),
      );
      facets[facet.by] = counts.map((r) => ({
        value: r.value as Json,
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
// them, the most recently written first (by their latest line's time, then
// file and line), so a cut list keeps what was written last; `truncated`
// says it was cut.
export async function logBindingValues(
  dbAdapter: DBAdapter,
  realmURL: string,
  from: { filter?: LogFilter } & LogSource,
  select: string,
  cap: number,
  opts: LogQueryOptions = {},
): Promise<{ values: Json[]; truncated?: true; notRead?: true }> {
  return asLogRefusal(async () => {
    let now = opts.now ?? new Date();
    let { filter, ...sourceOnly } = from;
    let q: LogQuery = {
      from: sourceOnly as LogSource,
      ...(filter !== undefined ? { filter } : {}),
      select: [select],
    };
    validateLogQuery(q, now);
    // Without the log tables (SQLite) a valid binding reads no values.
    if (!dialectFor(dbAdapter.kind).logs) {
      return { values: [], notRead: true };
    }
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
    let where = logWhere(realmURL, source, filter, {
      now,
      fileURL: fileURLIn(realmURL),
    });
    let value = readsOf(select).value;
    let read = async (db: DBAdapter) =>
      (await runQuery(
        db,
        [
          'SELECT v.value::text AS value FROM (SELECT',
          ...value,
          'AS value,',
          'MAX(l.at) AS last_at,',
          "MAX(l.url COLLATE \"C\" || ':' || lpad(l.line_no::text, 10, '0')) AS last_line",
          'FROM boxel_log_lines AS l',
          ...where,
          'AND',
          ...value,
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
  });
}

// The realm's default zone for a log search: the card engine's
// (query-engine/realm-time-zone.ts).
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
