// Facets on SQLite, which keeps no value store: counted in JS over the
// matched rows' search docs (and index columns), as Postgres counts them.
//
// Owns: reading a facet's values off a row, and a facet's counts, ranges,
// date buckets and statistics over the rows read, with the bounds those rows
// are read within (`SQLITE_FACET_ROWS`, `SQLITE_FACET_CHUNK`,
// `SQLITE_FACET_BUDGET_MS`).
// Must not: run SQL (facets.ts reads the rows and labels the links), or run
// on Postgres.
// Guarantees: under the bounds, the counts and statistics are Postgres's for
// the same rows (docs/search.md, "On SQLite"), except that text orders and
// compares by code unit, as SQLite's does. Past a bound, they are the rows'
// that were read, which `sqliteFacetSampled` says.

import type { FacetCount, FacetRange, FacetStats } from '../query.ts';
import { facetRangeLabel } from '../query-v2/query-check.ts';
import {
  SQLITE_FACET_BUDGET_MS,
  SQLITE_FACET_CHUNK,
  SQLITE_FACET_ROWS,
} from '../query-v2/query-values.ts';
import {
  autoFacetRanges,
  facetRangeBound,
  type FacetPlan,
} from './facet-sql.ts';
import { removeBrackets } from './filter-paths.ts';
import type { QueryOptions } from './types.ts';

// The longest value a facet counts (as facets.ts's MAX_FACET_VALUE_LENGTH).
const MAX_VALUE_LENGTH = 1024;

// A matched row as the facets read it: its key, its search doc, and the
// index columns an index field reads.
export interface FacetRow {
  key: string;
  doc: unknown;
  columns: Record<string, unknown>;
}

// What counting a facet takes, decided by facets.ts (`#facetWork`).
export interface SqliteFacetWork {
  plan: FacetPlan;
  size: number;
  interval?: 'day' | 'week' | 'month' | 'year';
  order: 'count' | 'value' | 'measure';
  wantStats: boolean;
  ranges?: FacetRange[];
  autoRanges: boolean;
}

// One value of one row: its text, its number, and its label (an index
// field's display name).
interface Value {
  key: string;
  txt: string;
  num?: number;
  label?: string;
}

export function sqliteFacetLimits(opts: QueryOptions) {
  let given = opts.sqliteFacetLimits ?? {};
  return {
    rows: given.rows ?? SQLITE_FACET_ROWS,
    chunk: given.chunk ?? SQLITE_FACET_CHUNK,
    budgetMs: given.budgetMs ?? SQLITE_FACET_BUDGET_MS,
    clock: given.clock ?? (() => Date.now()),
  };
}

// Each work's values over `rows`, read a chunk at a time until the rows run
// out or the budget does. `read` is how many rows were read.
export function readFacetValues(
  works: SqliteFacetWork[],
  rows: FacetRow[],
  opts: QueryOptions,
): { values: Map<SqliteFacetWork, Value[]>; read: number } {
  let { chunk, budgetMs, clock } = sqliteFacetLimits(opts);
  let values = new Map(works.map((w) => [w, [] as Value[]]));
  let start = clock();
  let read = 0;
  while (read < rows.length) {
    for (let row of rows.slice(read, read + chunk)) {
      for (let work of works) {
        if (work.plan.empty || work.plan.uncounted) continue;
        values.get(work)!.push(...valuesOf(work.plan, row));
      }
    }
    read = Math.min(rows.length, read + chunk);
    if (read < rows.length && clock() - start > budgetMs) break;
  }
  return { values, read };
}

// A row's distinct values for a facet, as Postgres reads them: an index
// column, or the search doc at the facet's path, each element of a list, a
// link's id, no null, no text longer than MAX_VALUE_LENGTH.
function valuesOf(plan: FacetPlan, row: FacetRow): Value[] {
  let out = new Map<string, Value>();
  let add = (txt: string, num?: number, label?: string) => {
    if (txt.length > MAX_VALUE_LENGTH) return;
    let seen = out.get(txt);
    if (!seen || (seen.num === undefined && num !== undefined)) {
      out.set(txt, { key: row.key, txt, num, label });
    }
  };
  if (plan.column) {
    let value = columnValue(plan, row.columns);
    if (value) add(value.txt, undefined, value.label);
    return [...out.values()];
  }
  let segments = removeBrackets(plan.read ?? plan.facet.by).split('.');
  let found = at(row.doc, segments);
  if (found === undefined && plan.list) {
    found = laxAt(row.doc, segments);
  }
  for (let element of Array.isArray(found) ? found : [found]) {
    if (element === undefined || element === null) continue;
    if (plan.link) {
      let id = (element as { id?: unknown })?.id;
      if (id !== undefined && id !== null && typeof element === 'object') {
        add(textOf(id));
      }
      continue;
    }
    let num = typeof element === 'number' ? element : undefined;
    let txt = textOf(element);
    if (num === undefined && plan.bigInteger && /^\s*-?[0-9]+\s*$/.test(txt)) {
      num = Number(txt.trim());
    }
    add(txt, num);
  }
  return [...out.values()];
}

// An index field's value: the row's column, as facet-declarations.ts reads it.
function columnValue(
  plan: FacetPlan,
  columns: Record<string, unknown>,
): { txt: string; label?: string } | undefined {
  let list = (name: string) => {
    let v = parsed(columns[name]);
    return Array.isArray(v) ? v : [];
  };
  switch (plan.facet.by) {
    case '_type': {
      let type = list('types')[0];
      let label = list('display_names')[0];
      return type == null
        ? undefined
        : {
            txt: String(type),
            ...(label != null ? { label: String(label) } : {}),
          };
    }
    case '_cardType': {
      let name = list('display_names')[0];
      return name == null ? undefined : { txt: String(name) };
    }
    case '_realm':
      return columns.realm_url == null
        ? undefined
        : { txt: String(columns.realm_url) };
    case 'createdAt':
    case 'lastModified': {
      let raw =
        columns[
          plan.facet.by === 'createdAt'
            ? 'resource_created_at'
            : 'last_modified'
        ];
      let epoch = Number(raw);
      if (raw === null || raw === undefined || !Number.isFinite(epoch)) {
        return undefined;
      }
      let ms = Math.abs(epoch) >= 100_000_000_000 ? epoch : epoch * 1000;
      return { txt: new Date(ms).toISOString().slice(0, 19) + 'Z' };
    }
  }
  return undefined;
}

function parsed(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

// `#>`: the value at a path, undefined when absent.
function at(doc: unknown, segments: string[]): unknown {
  let value: unknown = doc;
  for (let segment of segments) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }
    value = (value as Record<string, unknown>)[segment];
  }
  return value;
}

// A lax JSON path that steps into every list on the way, its matches as a
// list (`jsonb_path_query_array(doc, 'lax $."a"."b"[*]')`).
function laxAt(doc: unknown, segments: string[]): unknown[] {
  let values: unknown[] = [doc];
  for (let segment of segments) {
    values = values
      .flatMap((v) => (Array.isArray(v) ? v : [v]))
      .map((v) =>
        v && typeof v === 'object'
          ? (v as Record<string, unknown>)[segment]
          : undefined,
      )
      .filter((v) => v !== undefined);
  }
  return values.flatMap((v) => (Array.isArray(v) ? v : [v]));
}

// `#>> '{}'`: a string as itself, anything else as its JSON text.
function textOf(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// A facet's counts (and statistics) over its values, `matches` being how
// many rows were counted (for `missing`).
export function countFacet(
  work: SqliteFacetWork,
  values: Value[],
  matches: number,
  now: Date | undefined,
): { counts: FacetCount[]; stats?: FacetStats } {
  let { plan } = work;
  let { facet } = plan;
  let stats = statsOf(values, plan);
  let counts: FacetCount[];
  let ranges = work.ranges;
  if (work.autoRanges) {
    ranges = autoFacetRanges(stats);
    if (ranges.length === 0) ranges = undefined;
  }
  if (ranges) {
    counts = ranges.map((range) => ({
      value: facetRangeLabel(range),
      count: rangeCount(values, range, plan, now),
    }));
  } else if (work.interval) {
    counts = bucketCounts(values, work);
  } else {
    counts = valueCounts(values, work);
  }
  if (!work.wantStats) {
    return { counts };
  }
  let reported: FacetStats = { count: stats.count, distinct: stats.distinct };
  if (facet.stats || plan.shape !== 'values') {
    Object.assign(reported, stats);
  }
  if (facet.missing) {
    reported.missing = Math.max(0, matches - stats.count);
  }
  if (plan.shape !== 'range') {
    reported.order = work.order;
  }
  return { counts, stats: reported };
}

function valueCounts(values: Value[], work: SqliteFacetWork): FacetCount[] {
  let { facet } = work.plan;
  let groups = new Map<string, { keys: Set<string>; label?: string }>();
  for (let v of values) {
    let g = groups.get(v.txt) ?? { keys: new Set<string>() };
    g.keys.add(v.key);
    if (v.label !== undefined && (g.label === undefined || v.label > g.label)) {
      g.label = v.label;
    }
    groups.set(v.txt, g);
  }
  let prefix = facet.prefix?.toLowerCase();
  let rows = [...groups.entries()]
    .filter(([txt]) => !prefix || txt.toLowerCase().startsWith(prefix))
    .map(([txt, g]) => ({ value: txt, count: g.keys.size, label: g.label }));
  rows.sort((a, b) =>
    work.order === 'value'
      ? byText(a.value, b.value)
      : b.count - a.count || byText(a.value, b.value),
  );
  return rows.slice(0, work.size).map(({ value, count, label }) => ({
    value,
    count,
    ...(work.plan.labelColumn && label !== undefined ? { label } : {}),
  }));
}

function rangeCount(
  values: Value[],
  range: FacetRange,
  plan: FacetPlan,
  now: Date | undefined,
): number {
  let numeric = typeof (range.from ?? range.to) === 'number';
  let from = plan.dateField
    ? facetRangeBound(range.from, now, Boolean(plan.dateOnly))
    : range.from;
  let to = plan.dateField
    ? facetRangeBound(range.to, now, Boolean(plan.dateOnly))
    : range.to;
  let inRange = (v: Value) => {
    let x: number | string | undefined = numeric ? v.num : v.txt;
    if (x === undefined) return false;
    if (from !== undefined && from !== null && x < (from as typeof x)) {
      return false;
    }
    if (to !== undefined && to !== null && !(x < (to as typeof x))) {
      return false;
    }
    return true;
  };
  return new Set(values.filter(inRange).map((v) => v.key)).size;
}

function bucketCounts(values: Value[], work: SqliteFacetWork): FacetCount[] {
  let order = work.order === 'measure' ? 'count' : work.order;
  let buckets = new Map<string, Set<string>>();
  for (let v of values) {
    let bucket = bucketOf(v, work.interval!);
    if (bucket === undefined) continue;
    let keys = buckets.get(bucket) ?? new Set<string>();
    keys.add(v.key);
    buckets.set(bucket, keys);
  }
  let rows = [...buckets.entries()].map(([value, keys]) => ({
    value,
    count: keys.size,
  }));
  rows.sort((a, b) =>
    order === 'value'
      ? byText(a.value, b.value)
      : b.count - a.count || byText(a.value, b.value),
  );
  return rows.slice(0, work.size);
}

// The first day (yyyy-MM-dd, UTC) of the day, week (from Monday), month or
// year holding a value's instant: a number is epoch seconds (or
// milliseconds); text on a real calendar day is a date or date-time, read as
// UTC when it names no zone. Anything else has no bucket.
function bucketOf(v: Value, interval: SqliteFacetWork['interval']) {
  let ms: number;
  if (v.num !== undefined) {
    ms = Math.abs(v.num) >= 100_000_000_000 ? v.num : v.num * 1000;
  } else if (/^\d{4}-\d{2}-\d{2}/.test(v.txt)) {
    let zoned =
      /[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?\s*(Z|[+-]\d{2}(:?\d{2})?)$/.test(v.txt);
    let text = v.txt.replace(' ', 'T');
    if (!zoned) {
      text = /T\d{2}:\d{2}/.test(text)
        ? `${text}Z`
        : `${text.slice(0, 10)}T00:00:00Z`;
    }
    ms = Date.parse(text);
  } else {
    return undefined;
  }
  if (!Number.isFinite(ms)) return undefined;
  let d = new Date(ms);
  let day = (date: Date) => date.toISOString().slice(0, 10);
  switch (interval) {
    case 'day':
      return day(d);
    case 'week': {
      let monday = new Date(
        Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
      );
      monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
      return day(monday);
    }
    case 'month':
      return `${day(d).slice(0, 7)}-01`;
    case 'year':
      return `${day(d).slice(0, 4)}-01-01`;
  }
  return undefined;
}

// As `#statsOf` reads Postgres's: over each row's distinct values.
function statsOf(values: Value[], plan: FacetPlan): FacetStats {
  let stats: FacetStats = {
    count: new Set(values.map((v) => v.key)).size,
    distinct: new Set(values.map((v) => v.txt)).size,
  };
  let numbers = values.filter((v) => v.num !== undefined).map((v) => v.num!);
  if (numbers.length > 0) {
    let sum = numbers.reduce((a, b) => a + b, 0);
    Object.assign(stats, {
      values: numbers.length,
      min: Math.min(...numbers),
      max: Math.max(...numbers),
      sum,
      avg: sum / numbers.length,
    });
  } else if (values.length > 0) {
    let texts = values.map((v) => v.txt).sort(byText);
    Object.assign(stats, { min: texts[0], max: texts[texts.length - 1] });
  }
  void plan;
  return stats;
}

// The warning a facet group whose rows a bound cut carries.
export function sqliteFacetSampled(read: number, total: number) {
  return {
    code: 'sqlite-facet-sampled',
    message: `the facets were counted over ${read} of ${total} matches: this index (SQLite) counts facets from the rows it reads, within its limits`,
  };
}

export function sqliteFacetIntervalUtc(by: string, zone: string) {
  return {
    code: 'sqlite-facet-interval-utc',
    message: `the facet by "${by}" was bucketed in UTC, not in "${zone}": this index (SQLite) buckets dates in UTC only`,
  };
}

export function sqliteFacetNotCounted(by: string, why: string) {
  return {
    code: 'sqlite-facet-not-counted',
    message: `the facet by "${by}" has no counts: ${why}, which this index (SQLite) cannot count`,
  };
}
