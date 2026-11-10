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
}

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
  data: {
    line: number;
    at: string | null;
    actor: string | null;
    entry: Record<string, unknown>;
  }[];
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

export async function runLogQuery(
  dbAdapter: DBAdapter,
  realmURL: string,
  q: LogQuery,
): Promise<LogQueryResult> {
  if (dbAdapter.kind !== 'pg') {
    throw new LogQueryError('Log queries need Postgres');
  }
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

  let rows = size
    ? ((await run([
        'SELECT l.line_no, l.at, l.actor, l.entry FROM boxel_log_lines AS l',
        ...where,
        orderBy(q.sort),
        `LIMIT ${size + 1} OFFSET ${number * size}`,
      ])) as {
        line_no: number;
        at: unknown;
        actor: string | null;
        entry: Record<string, unknown>;
      }[])
    : [];
  let hasMore = rows.length > size;
  rows = rows.slice(0, size);

  let total: number;
  let totalIsEstimate = false;
  if (totalMode === 'none') {
    total = number * size + rows.length;
    totalIsEstimate = hasMore;
  } else if (!hasMore && size > 0) {
    total = number * size + rows.length;
  } else if (totalMode === 'capped') {
    let [row] = (await run([
      'SELECT COUNT(*) AS total FROM (SELECT 1 FROM boxel_log_lines AS l',
      ...where,
      `LIMIT ${SEARCH_TOTAL_CAP + 1}) AS capped`,
    ])) as { total: unknown }[];
    let counted = Number(row?.total ?? 0);
    total = Math.min(counted, SEARCH_TOTAL_CAP);
    totalIsEstimate = counted > SEARCH_TOTAL_CAP;
  } else {
    let [row] = (await run([
      'SELECT COUNT(*) AS total FROM boxel_log_lines AS l',
      ...where,
    ])) as { total: unknown }[];
    total = Number(row?.total ?? 0);
  }

  let facets: Record<string, { value: Json; count: number }[]> | undefined;
  if (q.facets?.length) {
    facets = {};
    for (let facet of q.facets) {
      let value: Expression =
        facet.by === 'actor'
          ? ['to_jsonb(l.actor)']
          : facet.by === 'at'
            ? ["to_jsonb(date_trunc('day', l.at))"]
            : jsonPath(facet.by);
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
    data: rows.map((r) => ({
      line: Number(r.line_no),
      at: r.at == null ? null : new Date(r.at as string).toISOString(),
      actor: r.actor,
      entry: typeof r.entry === 'string' ? JSON.parse(r.entry) : r.entry,
    })),
    meta: {
      page: { total, ...(totalIsEstimate ? { totalIsEstimate } : {}), hasMore },
      ...(facets ? { facets } : {}),
      log: url,
    },
  };
}
