// A Query V2 search over the lines of an append-only log, answered from
// `boxel_log_lines` (see `log-line-index.ts`) without reading the file.
//
//   {
//     from: { log: 'TasteProfile/my-taste.history.jsonl' },   // realm-relative or absolute
//     filter: { every: [{ eq: { 'what.action': 'like' } }, { range: { at: { gte: 'now-7d' } } }] },
//     sort: [{ by: 'at', direction: 'desc' }],
//     page: { size: 50, number: 0, total: 'capped' },
//     facets: [{ by: 'what.action', size: 10 }],
//   }
//
// Paths: `at` (the entry's time), `actor`, `line` (its line number), and any
// path into the entry (`what.action`, `what.postUri`). A `what` the writer
// encoded as a JSON string is already decoded in the rows, so its fields are
// paths like any other.
//
// Filters: eq, in, range (gt/gte/lt/lte; `at` takes ISO times or `now-<n><unit>`
// with s, m, h, d, w, M or y), contains (case-insensitive substring), exists,
// and every / any / not. An `eq` or `in` on an entry path is a GIN
// containment, so it stays fast on a long log.
//
// Facets count the filtered lines by a path's values, largest first: the
// aggregation over a subset that reading the file would otherwise mean.

import { param, query as runQuery, type Expression } from './expression.ts';
import type { DBAdapter } from './db.ts';
import { SEARCH_TOTAL_CAP } from './search-bounds.ts';

export class LogQueryError extends Error {}

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

export interface LogQuery {
  from: { log: string };
  filter?: LogFilter;
  sort?: { by: string; direction?: 'asc' | 'desc' }[];
  page?: {
    size?: number;
    number?: number;
    total?: 'exact' | 'capped' | 'none';
  };
  facets?: { by: string; size?: number }[];
  // The paths each row carries, instead of its whole entry: `at`, `actor`,
  // `line`, or a path into the entry. A row is then `{ line, <path>: value }`.
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
  | { every: LogFilter[] }
  | { any: LogFilter[] }
  | { not: LogFilter };

export interface LogQueryResult {
  data: Record<string, unknown>[];
  meta: {
    page: { total: number; totalIsEstimate?: boolean; hasMore: boolean };
    facets?: Record<string, { value: Json; count: number }[]>;
    log: string;
  };
}

const MAX_PAGE = 1000;
const DEFAULT_PAGE = 50;
const DEFAULT_FACET_SIZE = 20;

export function isLogQuery(payload: unknown): payload is LogQuery {
  let from = (payload as { from?: unknown } | null)?.from;
  return (
    typeof from === 'object' &&
    from !== null &&
    typeof (from as { log?: unknown }).log === 'string'
  );
}

const COLUMNS: Record<string, string> = {
  at: 'l.at',
  actor: 'l.actor',
  line: 'l.line_no',
};

function pathSegments(path: string): string[] {
  if (!/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(path)) {
    throw new LogQueryError(`Invalid log path: ${JSON.stringify(path)}`);
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

const UNITS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
  M: 30 * 86_400_000,
  y: 365 * 86_400_000,
};

export function resolveLogTime(value: Json, now = Date.now()): string {
  if (typeof value === 'number') {
    return new Date(value).toISOString();
  }
  if (typeof value !== 'string') {
    throw new LogQueryError(`A time must be a string or a number`);
  }
  if (value === 'now') {
    return new Date(now).toISOString();
  }
  let rel = /^now-(\d+)([smhdwMy])$/.exec(value);
  if (rel) {
    return new Date(now - Number(rel[1]) * UNITS[rel[2]]).toISOString();
  }
  let iso = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value;
  if (Number.isNaN(Date.parse(iso))) {
    throw new LogQueryError(`Not a time: ${JSON.stringify(value)}`);
  }
  return new Date(iso).toISOString();
}

const RANGE_OPS: Record<string, string> = {
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
};

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

function compileFilter(filter: LogFilter): Expression {
  if (typeof filter !== 'object' || filter === null) {
    throw new LogQueryError('A log filter must be an object');
  }
  if ('every' in filter) {
    return andAll(filter.every.map(compileFilter), 'AND');
  }
  if ('any' in filter) {
    return andAll(filter.any.map(compileFilter), 'OR');
  }
  if ('not' in filter) {
    return ['NOT (', ...compileFilter(filter.not), ')'];
  }
  if ('exists' in filter) {
    let path = filter.exists;
    return COLUMNS[path]
      ? [`${COLUMNS[path]} IS NOT NULL`]
      : [...jsonPath(path), 'IS NOT NULL'];
  }
  if ('eq' in filter) {
    return andAll(
      Object.entries(filter.eq).map(([path, value]) =>
        eqCondition(path, value),
      ),
      'AND',
    );
  }
  if ('in' in filter) {
    return andAll(
      Object.entries(filter.in).map(([path, values]) => {
        if (!Array.isArray(values)) {
          throw new LogQueryError(`in.${path} must be a list`);
        }
        return andAll(
          values.map((value) => eqCondition(path, value)),
          'OR',
        );
      }),
      'AND',
    );
  }
  if ('contains' in filter) {
    return andAll(
      Object.entries(filter.contains).map(([path, value]) => {
        let target = COLUMNS[path]
          ? [`${COLUMNS[path]}::text`]
          : textPath(path);
        return [
          ...target,
          'ILIKE',
          param(`%${String(value).replace(/[\\%_]/g, (c) => `\\${c}`)}%`),
        ];
      }),
      'AND',
    );
  }
  if ('range' in filter) {
    return andAll(
      Object.entries(filter.range).flatMap(([path, bounds]) =>
        Object.entries(bounds).map(([op, value]) => {
          let sqlOp = RANGE_OPS[op];
          if (!sqlOp) {
            throw new LogQueryError(
              `range takes gt, gte, lt and lte, not ${op}`,
            );
          }
          if (path === 'at') {
            return [
              `l.at ${sqlOp}`,
              param(resolveLogTime(value as Json)),
              '::timestamptz',
            ];
          }
          if (path === 'line') {
            return [`l.line_no ${sqlOp}`, param(Number(value))];
          }
          if (typeof value === 'number') {
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
  throw new LogQueryError(
    `A log filter is one of eq, in, range, contains, exists, every, any or not`,
  );
}

function eqCondition(path: string, value: Json): Expression {
  if (path === 'at') {
    return ['l.at =', param(resolveLogTime(value)), '::timestamptz'];
  }
  if (path === 'actor') {
    return value === null
      ? ['l.actor IS NULL']
      : ['l.actor =', param(String(value))];
  }
  if (path === 'line') {
    return ['l.line_no =', param(Number(value))];
  }
  if (value === null) {
    return [...jsonPath(path), 'IS NULL'];
  }
  // A containment the entry GIN index answers.
  return ['l.entry @>', param(containmentFor(path, value)), '::jsonb'];
}

function orderBy(sort: LogQuery['sort']): string {
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
    // An entry path sorts by its text; a numeric path sorts numerically.
    let segments = pathSegments(by).map((s) => s.replace(/'/g, "''"));
    let at = `l.entry #> '{${segments.join(',')}}'`;
    return `CASE WHEN jsonb_typeof(${at}) = 'number' THEN (${at} #>> '{}')::numeric END ${dir} NULLS LAST, (${at} #>> '{}') ${dir} NULLS LAST`;
  });
  terms.push('l.line_no ASC');
  return `ORDER BY ${terms.join(', ')}`;
}

// Resolves `from.log` against the realm, refusing a file outside it or one
// that isn't a log.
export function resolveLogURL(log: string, realmURL: string): string {
  let url: URL;
  try {
    url = new URL(log, realmURL);
  } catch {
    throw new LogQueryError(`Not a log URL: ${JSON.stringify(log)}`);
  }
  if (!url.href.startsWith(realmURL)) {
    throw new LogQueryError(`${url.href} is not in ${realmURL}`);
  }
  if (
    !/\.(jsonl|log)$/.test(url.pathname) ||
    url.pathname.endsWith('.vectors.jsonl')
  ) {
    throw new LogQueryError(`${url.href} is not a log (.jsonl or .log)`);
  }
  return url.href;
}

const QUERY_KEYS = new Set([
  'from',
  'filter',
  'sort',
  'page',
  'facets',
  'select',
  'group',
]);
const AGGREGATE_OPS = new Set([
  'count',
  'min',
  'max',
  'sum',
  'avg',
  'distinct',
  'latest',
]);

// Refused rather than ignored: a key this grammar doesn't read would leave
// its caller believing it applied.
function assertKnownKeys(q: LogQuery) {
  for (let key of Object.keys(q)) {
    if (!QUERY_KEYS.has(key)) {
      throw new LogQueryError(
        `unknown member "${key}" in a log query (it takes ${[...QUERY_KEYS].join(', ')})`,
      );
    }
  }
  for (let key of Object.keys(q.from)) {
    if (key !== 'log') {
      throw new LogQueryError(`unknown member "from.${key}" (it takes log)`);
    }
  }
  if (q.select !== undefined && !Array.isArray(q.select)) {
    throw new LogQueryError('select is a list of paths');
  }
  if (q.select !== undefined && q.group !== undefined) {
    throw new LogQueryError(
      'select and group are separate shapes: a grouped row is its group and aggregates',
    );
  }
}

// A time as the ISO string a row's `at` is answered with.
function isoTime(sql: string): string {
  return `to_char(${sql} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
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
  return jsonPath(path);
}

function numericOf(path: string): Expression {
  if (path === 'line') {
    return ['l.line_no::numeric'];
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
  if (!/^[A-Za-z_]\w*$/.test(name)) {
    throw new LogQueryError(`Invalid aggregate name: ${JSON.stringify(name)}`);
  }
  let entries = Object.entries(spec ?? {});
  if (entries.length !== 1 || !AGGREGATE_OPS.has(entries[0][0])) {
    throw new LogQueryError(
      `aggregate "${name}" is one of ${[...AGGREGATE_OPS].join(', ')}`,
    );
  }
  let [op, path] = entries[0] as [string, string | true];
  let alias = `AS "a_${name}"`;
  if (op === 'count') {
    return path === true
      ? ['to_jsonb(COUNT(*))', alias]
      : ['to_jsonb(COUNT(', ...valueOf(path as string), '))', alias];
  }
  if (typeof path !== 'string') {
    throw new LogQueryError(`aggregate "${name}" takes a path`);
  }
  if (op === 'latest') {
    return [
      '(array_agg(',
      ...valueOf(path),
      'ORDER BY l.at DESC NULLS LAST, l.line_no DESC))[1]',
      alias,
    ];
  }
  if (op === 'distinct') {
    return [
      'COALESCE(to_jsonb(array_agg(DISTINCT',
      ...valueOf(path),
      ') FILTER (WHERE',
      ...valueOf(path),
      "IS NOT NULL)), '[]'::jsonb)",
      alias,
    ];
  }
  if (path === 'at' && (op === 'min' || op === 'max')) {
    return [`to_jsonb(${isoTime(`${op.toUpperCase()}(l.at)`)})`, alias];
  }
  if (op === 'sum' || op === 'avg') {
    return [`to_jsonb(${op.toUpperCase()}(`, ...numericOf(path), '))', alias];
  }
  // min / max: numerically over numbers, else by text.
  let fn = op.toUpperCase();
  return [
    `COALESCE(to_jsonb(${fn}(`,
    ...numericOf(path),
    `)), to_jsonb(${fn}(`,
    ...(path === 'actor'
      ? ['l.actor']
      : path === 'line'
        ? ['l.line_no::text']
        : textPath(path)),
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
  if (mode === 'none') {
    return Promise.resolve({
      total: number * size + shown,
      totalIsEstimate: hasMore,
    });
  }
  if (!hasMore && size > 0) {
    return Promise.resolve({
      total: number * size + shown,
      totalIsEstimate: false,
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

export async function runLogQuery(
  dbAdapter: DBAdapter,
  realmURL: string,
  q: LogQuery,
): Promise<LogQueryResult> {
  if (dbAdapter.kind !== 'pg') {
    throw new LogQueryError('Log queries need Postgres');
  }
  assertKnownKeys(q);
  let url = resolveLogURL(q.from.log, realmURL);
  let size = Math.min(
    MAX_PAGE,
    Math.max(0, Number(q.page?.size ?? DEFAULT_PAGE)),
  );
  let number = Math.max(0, Number(q.page?.number ?? 0));
  let totalMode = q.page?.total ?? 'capped';
  let where: Expression = [
    'WHERE l.url =',
    param(url),
    'AND',
    ...(q.filter ? compileFilter(q.filter) : ['TRUE']),
  ];
  let run = (e: Expression) => runQuery(dbAdapter, e);
  let limit = `LIMIT ${size + 1} OFFSET ${number * size}`;

  let data: Record<string, unknown>[] = [];
  let hasMore = false;
  let count: (cap?: number) => Promise<number>;

  if (q.group) {
    let by = Array.isArray(q.group.by) ? q.group.by : [q.group.by];
    if (by.length === 0) {
      throw new LogQueryError('group.by names at least one path');
    }
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
      throw new LogQueryError(
        `a grouped query sorts by a group path or an aggregate, not ${JSON.stringify(key)}`,
      );
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
    let columns: Expression =
      q.select && q.select.length
        ? [
            'l.line_no, jsonb_build_object(',
            ...q.select.flatMap((path, i) => [
              ...(i > 0 ? [','] : []),
              param(path),
              '::text,',
              ...valueOf(path),
            ]),
            ') AS projected',
          ]
        : ['l.line_no, l.at, l.actor, l.entry'];
    let rows = size
      ? ((await run([
          'SELECT',
          ...columns,
          'FROM boxel_log_lines AS l',
          ...where,
          orderBy(q.sort),
          limit,
        ])) as Record<string, unknown>[])
      : [];
    hasMore = rows.length > size;
    data = rows.slice(0, size).map((r) => {
      if ('projected' in r) {
        let projected =
          typeof r.projected === 'string'
            ? JSON.parse(r.projected)
            : (r.projected as Record<string, unknown>);
        return { line: Number(r.line_no), ...projected };
      }
      return {
        line: Number(r.line_no),
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
      let value: Expression =
        facet.by === 'at'
          ? [`to_jsonb(${isoTime("date_trunc('day', l.at)")})`]
          : valueOf(facet.by);
      let facetSize = Math.min(
        200,
        Math.max(1, Number(facet.size ?? DEFAULT_FACET_SIZE)),
      );
      let counted = (await run([
        'SELECT',
        ...value,
        'AS value, COUNT(*) AS count FROM boxel_log_lines AS l',
        ...where,
        'GROUP BY 1 ORDER BY 2 DESC, 1',
        `LIMIT ${facetSize}`,
      ])) as { value: Json; count: unknown }[];
      facets[facet.by] = counted
        .filter((r) => r.value !== null)
        .map((r) => ({ value: r.value, count: Number(r.count) }));
    }
  }

  return {
    data,
    meta: {
      page: { total, ...(totalIsEstimate ? { totalIsEstimate } : {}), hasMore },
      ...(facets ? { facets } : {}),
      log: url,
    },
  };
}

// A `_search` answer for a log query: the result, or the refusal of a query
// this module can't run, as a status and a JSON body.
export async function logSearchResponse(
  dbAdapter: DBAdapter,
  realmURL: string,
  payload: LogQuery,
): Promise<{ status: number; body: unknown }> {
  try {
    return {
      status: 200,
      body: await runLogQuery(dbAdapter, realmURL, payload),
    };
  } catch (e) {
    if (e instanceof LogQueryError) {
      return {
        status: 400,
        body: {
          errors: [
            {
              status: '400',
              title: 'Invalid Query',
              message: `Invalid query: ${e.message}`,
              code: 'invalid-log-query',
            },
          ],
        },
      };
    }
    throw e;
  }
}
