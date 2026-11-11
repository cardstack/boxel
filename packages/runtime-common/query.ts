import { isEqual } from 'lodash-es';
import { BXL_FORMULA_FUNCTIONS } from '@cardstack/bxl/compiler';
import qs from 'qs';

import {
  assertJSONValue,
  assertJSONPrimitive,
  type JsonValue,
} from './json-validation.ts';
import { InvalidQueryError } from './invalid-query-error.ts';
import {
  type FilterOperatorName,
  grammarHints,
  grammarMembers,
  isEngineForm,
  isWire,
} from './query-grammar.ts';
import {
  assertDistinctFacets,
  assertPlainQueryData,
  DEFAULT_RERANK_TOP,
  MAX_OLDER_QUERY_DEPTH,
  hasOwn,
  lowerQuery,
  MAX_QUERY_DEPTH,
  MAX_RERANK_TOP,
  RERANK_REFUSAL,
  usesNewSyntax,
} from './query-syntax.ts';
import { assertQueryExpressionProfile, exprSortSql } from './formula-sql.ts';
import type { MATCH_RELEVANCE_SORT_KEY, BLEND_SORT_KEY } from './index.ts';
import {
  type CodeRef,
  isCodeRef,
  generalSortFields,
  isMatchRelevanceSort,
  isNearSort,
  isBlendSort,
} from './index.ts';
import {
  isVector,
  MAX_VECTOR_DIMENSIONS,
  type Vector,
} from './serializers/vector.ts';
import { SEARCH_RANK_SIGNALS, type SearchRankSignal } from './search-intent.ts';
import { isAbsoluteIdentifier } from './realm-identifiers.ts';
import { resolveTypeReferences } from './type-reference.ts';
import {
  BINDING_NAME,
  NO_BINDING_VALUE,
  RESERVED_BINDING_NAMES,
  internBindingReferences,
  unwrapLiterals,
} from './binding-reference.ts';
export { NO_BINDING_VALUE, internBindingReferences };
import {
  assertTimeZone,
  canonicalTimeZone,
  isUtcZone,
  resolveRelativeDateInZone,
  zoneOfClock,
} from './time-zone.ts';

// `query.ts` is where callers reach for the grammar's error, so it stays
// exported from here even though the class itself lives one module down.
export { InvalidQueryError };

// The same type `assertJSONValue` below holds a value to at run time, named
// here as the query grammar spells it.
type JSONValue = JsonValue;

export type SparseFieldsets = Record<string, string[]>;

// Count what the matched cards hold in one search-doc field: the field's
// values, each with how many matched cards hold it, most common first. A list
// field (containsMany) counts each of its values. Counted by the database over
// every match, not only the page returned. `by` is a field path, dotted for a
// compound field; `size` caps how many values come back (default 50, at most
// 1000). The counts ride `meta.facets[by]`.
//
// The other members are optional (docs/search-intent.md, Facets):
// - `own: 'ignore'` counts the facet over the filter without its own
//   selection, so a multi-select list keeps its other values while one is
//   picked: every filter node that constrains only `by` is left out.
// - `stats: true` adds the values' count, distinct count, and min, max, sum
//   and average (numbers) or min and max (text) in `meta.facetStats[by]`.
// - `ranges` counts the matches with a value in each `[from, to)` bucket,
//   labelled by `key` or "from-to" (`*` for an open end).
// - `interval` counts matches by the day, week (from Monday), month or year
//   of a date value (an ISO date string, or a number of seconds or
//   milliseconds since the epoch), labelled by the bucket's first day.
// - `prefix` keeps the values that start with it, ignoring case.
// - `missing: true` adds the count of matches with no value
//   (`meta.facetStats[by].missing`).
// - `order` sorts the values by `count` (most first, the default) or by
//   `value`; an interval sorts by value unless it says otherwise.
// - `measure` adds, to each value, an aggregate of another number field over
//   the matches holding it: `{ avg: 'price' }` is each brand's average price,
//   in `counts[i].measure.avg`. One of avg, min, max or sum. With
//   `order: 'measure'` the values sort by it, largest first.
// A field declared `search: { facet }` takes its shape from the declaration
// when the query names none of `stats`, `ranges` and `interval`: a number
// facet is range buckets with stats, a date facet a monthly histogram with
// stats.
export interface Facet {
  by: string;
  size?: number;
  own?: 'ignore';
  stats?: boolean;
  ranges?: FacetRange[];
  interval?: FacetInterval;
  prefix?: string;
  missing?: boolean;
  order?: 'count' | 'value' | 'measure';
  measure?: FacetMeasure;
}
export const FACET_MEASURES = ['avg', 'min', 'max', 'sum'] as const;
export type FacetMeasureOp = (typeof FACET_MEASURES)[number];
export type FacetMeasure = Partial<Record<FacetMeasureOp, string>>;
export interface FacetRange {
  key?: string;
  from?: number | string;
  to?: number | string;
}
export const FACET_INTERVALS = ['day', 'week', 'month', 'year'] as const;
export type FacetInterval = (typeof FACET_INTERVALS)[number];
export const MAX_FACETS = 8;
export const DEFAULT_FACET_SIZE = 50;
export const MAX_FACET_SIZE = 1000;
export const MAX_FACET_RANGES = 50;

export interface FacetCount {
  value: string;
  count: number;
  // A link facet's value is the linked card's id; `label` is its title, for
  // a plain-text list. Show the card itself by delegating to its
  // prerendered HTML by id.
  label?: string;
  // The facet's `measure` over the matches holding this value; absent when
  // none holds a number there.
  measure?: Partial<Record<FacetMeasureOp, number>>;
}

// A facet's statistics, in `meta.facetStats[by]`: `count` matches hold a
// value, `distinct` values in all; over number values, `min`, `max`, `sum`
// and `avg` (with `values`, how many number values they cover, so realms can
// be combined), or over text, `min` and `max`. `missing` is present when the
// facet asked for it; `order` says how its counts are sorted.
export interface FacetStats {
  count: number;
  distinct: number;
  values?: number;
  min?: number | string;
  max?: number | string;
  sum?: number;
  avg?: number;
  missing?: number;
  order?: 'count' | 'value' | 'measure';
}

// One result per group: of the cards that share a value at `by` (a variant
// group, a product type), only the best `keep` (default 1) by the query's own
// sort come back, and `meta.page.total` counts what remains. A card with no
// value at `by` is a group of its own. Facets still count every match. `on`
// names the type whose field `by` is; a search entry's root anchor supplies
// it. A string is shorthand for `{ by }`.
export type Collapse = string | { by: string; on?: CodeRef; keep?: number };
export const MAX_COLLAPSE_KEEP = 10;

export function collapseBy(
  collapse: Collapse | undefined,
): { by: string; on?: CodeRef; keep: number } | undefined {
  if (collapse == null) {
    return undefined;
  }
  return typeof collapse === 'string'
    ? { by: collapse, keep: 1 }
    : { by: collapse.by, on: collapse.on, keep: collapse.keep ?? 1 };
}

// Named lists a query computes first and uses in its filter, in the manner of
// a FLWOR `let`: `{ let: { saved: { from: { filter }, select: 'items.id' } },
// filter: { in: { id: '$saved' } } }`. `from` is a query over the same realm
// (filter, sort and a page size of at most MAX_LET_ROWS); `select` is a
// search-doc path whose values, across the rows it finds, become the list
// (a list field contributes each value, a link its id). An `in` names the
// binding as `"$name"`, in the filter or in a `_when` signal's filter.
//
// The engine joins when it can: a `from` that is one card by id, selecting
// a link field's ids, read by an `in` on `id`, runs as `linkedFrom` inside
// the same statement. Anything else runs `from` first and passes its values
// (at most MAX_LET_VALUES) to the query. `meta.lets` reports which it did.
//
// With `one: true` instead of `select`, the binding is one card: the first
// row `from` finds. The query reads its values as `"$name.path"` wherever a
// value goes: an `eq` value, a `range` bound, a `near` target (in a filter
// or a sort), and in a rerank formula as `name.path`. A path the card has
// no value at reads null, as does every path when `from` finds no card; a
// `range` bound or `near` target that reads null matches nothing.
export interface LetBinding {
  // A card query over this realm, or, with `log` or `logs`, a log's lines
  // (`LogBindingSource`), whose `filter` is then a log filter.
  from: {
    filter?: Filter;
    sort?: Sort;
    page?: { size: number };
    // the binding's own zone; absent, the query's
    timeZone?: string;
    log?: string;
    logs?: string[] | { under: string };
    select?: string;
  };
  select?: string;
  one?: true;
  // Internal, set by policyScopedQuery: the binding reads a card under that
  // card's own type's grants, composed into `from.filter`, rather than the
  // query's.
  ownGrants?: true;
}
export const MAX_LET_BINDINGS = 4;

// A binding whose `from` is a log (`log-query.ts`): `{ from: { log, filter },
// select: 'what.postUri' }` is the distinct values at `select` over the
// log's matching lines, a list an `in` or a `not in` reads as any list
// binding's (at most MAX_LET_VALUES of them, the most recently written
// first). `from` names one log (`log`), several (`logs: [...]`), or a
// folder's (`logs: { under }`); its `filter` is a log filter. `select` may
// also be written inside `from`. A realm policy applies to the lines it
// reads, as to a log search.
export interface LogBindingSource {
  log?: string;
  logs?: string[] | { under: string };
  // A log filter (`LogFilter` in log-query.ts).
  filter?: unknown;
  select?: string;
}

export function isLogBinding(binding: unknown): boolean {
  let from = (binding as { from?: unknown } | null)?.from;
  return (
    typeof from === 'object' &&
    from !== null &&
    !Array.isArray(from) &&
    ('log' in from || 'logs' in from)
  );
}

// A log binding's `select`, wherever it was written.
export function logBindingSelect(binding: LetBinding): string | undefined {
  return binding.select ?? binding.from?.select;
}

// The engine's form of a sort entry `{ expression, top?, compare?,
// direction? }` that leads the sort (query-syntax.ts lowers it; no caller
// writes `rerank`): the query ranks by the rest of its sort, the realm takes
// its first `top` rows (default 100, at most MAX_RERANK_TOP), scores the
// expression over them in SQL (BXL's score profile; anything else was
// refused), and orders them by the value, highest first unless `direction`
// is `asc`. A row whose expression has no number keeps its place after the
// ones that do; ties keep the base order. Pages read the re-ranked window;
// a page past it keeps the query's order. Each re-ranked row carries
// `meta._window`.
//
// The expression can compare a row with a comparison set: by default every
// match of the query, or `compare.filter`'s matches, and with `compare.by`
// only those sharing the row's value at that path (its own product type).
// Two names reach the set, for the fields the expression mentions, computed
// by SQL aggregates over the row's group:
// - `stats.<field>.<count|sum|avg|min|max|median|p10|p25|p75|p90|stdev>`:
//   aggregates over the set, e.g. `priceMin / stats.priceMin.median`.
// - `peers.<field>`: the set's values as a list, for the profile's list
//   functions: `PERCENTRANK_INC(peers.rating, rating)`.
// Aggregates a card already stores are fields like any other.
export interface Rerank {
  // The BXL expression each row is ranked by.
  expression: string;
  top?: number;
  direction?: 'asc' | 'desc';
  compare?: {
    filter?: Filter;
    by?: string;
    // Each row's own look-alikes: its `k` nearest cards by the vector field
    // at `near` (default 20, at most MAX_NEAR_PEERS), at least
    // `minSimilarity` similar. The field must declare
    // `search: { neighbors: true }`; `peers.similarity` holds how similar
    // each is.
    near?: string;
    k?: number;
    minSimilarity?: number;
  };
}
// The most rows a comparison set reads. Past it, `stats.` and `peers.`
// describe the first MAX_COMPARE_ROWS rows the set's query returns, and
// the `compare-truncated` warning says so.
export const MAX_COMPARE_ROWS = 10_000;
let compareRows = MAX_COMPARE_ROWS;
export function compareRowLimit(): number {
  return compareRows;
}
// For tests: a limit a few rows can reach.
export function setCompareRowLimitForTests(n: number | undefined): void {
  compareRows = n ?? MAX_COMPARE_ROWS;
}
export const DEFAULT_NEAR_PEERS = 20;
export const MAX_NEAR_PEERS = 100;
export { DEFAULT_RERANK_TOP, MAX_RERANK_TOP, RERANK_REFUSAL };

// Why a result ranks where it does: the first `_blend` (or `_relevance`)
// sort's fused score and each signal's part in it. `signal` names it: `text`,
// a `_relevance` signal (`popularity`, `quality`, `recency`, `priority`,
// `meaning`), `when` for a `_when` boost, or the field it sorts by. A signal
// the card has no value for has no rank and contributes nothing. `inverted`
// marks a negative weight.
export interface ResultExplanation {
  score: number;
  k: number;
  signals: {
    signal: string;
    weight: number;
    inverted?: true;
    value: unknown;
    rank: number | null;
    contribution: number;
  }[];
}
export const MAX_LET_ROWS = 10_000;
export const MAX_LET_VALUES = 10_000;
const LET_NAME = /^[A-Za-z_][\w]*$/;

// A binding reference as the engine holds it. A query writes a reference as
// a string, `"$saved"` (a list binding, read whole by an `in`) or
// `"$sofa.priceMin"` (a value of a one-card binding), and only for a name
// its `let` declares (binding-reference.ts); `internBindingReferences`
// turns each into this form at the grammar's boundary. The object form is
// the engine's own: a query that writes `{ "$let": "name" }` is refused
// (`unknown-key`), since its name has no `$`.
export interface LetReference {
  $let: string;
  path?: string;
}
export function isLetReference(value: unknown): value is LetReference {
  return (
    value != null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof (value as LetReference).$let === 'string' &&
    Object.keys(value).every((k) => k === '$let' || k === 'path')
  );
}

export function letReference(value: unknown): string | undefined {
  return isLetReference(value) && value.path === undefined
    ? value.$let
    : undefined;
}

// Rewrites each `in` node that names a binding: `replace` gets the node's
// field, the binding's name and the node, and returns the filter to run in
// its place. Walks the filter and every `_when` signal's filter in a sort.
export function mapLetReferences<T extends { filter?: Filter; sort?: Sort }>(
  query: T,
  replace: (field: string, name: string, node: InFilter) => Filter,
): T {
  let walk = (node: Filter): Filter => {
    if (!node || typeof node !== 'object') return node;
    if ('any' in node && Array.isArray(node.any))
      return { ...node, any: node.any.map(walk) };
    if ('every' in node && Array.isArray(node.every))
      return { ...node, every: node.every.map(walk) };
    if ('not' in node && node.not) return { ...node, not: walk(node.not) };
    if ('in' in node && node.in && typeof node.in === 'object') {
      let entries = Object.entries(node.in);
      let ref = entries.length === 1 ? letReference(entries[0][1]) : undefined;
      if (ref) return replace(entries[0][0], ref, node);
    }
    return node;
  };
  let out = { ...query };
  if (query.filter) out.filter = walk(query.filter);
  if (Array.isArray(query.sort))
    out.sort = query.sort.map((s: any) =>
      s && s.by === '_blend' && Array.isArray(s.of)
        ? {
            ...s,
            of: s.of.map((c: any) =>
              c && c.by === '_when' && c.when
                ? { ...c, when: walk(c.when) }
                : c,
            ),
          }
        : s,
    ) as Sort;
  return out;
}

// A one-card binding's value reference, `"$name.path"`, or undefined.
export function cardReference(
  value: unknown,
): { name: string; path: string } | undefined {
  return isLetReference(value) && typeof value.path === 'string'
    ? { name: value.$let, path: value.path.replace(/^item\./, '') }
    : undefined;
}

// Every binding reference in a query's filter, sort and comparison filter.
// A rerank's comparison filter, read only off a comparison that is an object
// (a list has a `filter` too: Array.prototype's).
function compareFilterOf(query: any): unknown {
  let c = query?.rerank?.compare;
  return c && typeof c === 'object' && !Array.isArray(c) && hasOwn(c, 'filter')
    ? c.filter
    : undefined;
}

function letReferencesIn(query: any): LetReference[] {
  let found: LetReference[] = [];
  let walk = (v: unknown) => {
    if (isLetReference(v)) {
      found.push(v);
    } else if (Array.isArray(v)) {
      v.forEach(walk);
    } else if (v && typeof v === 'object') {
      Object.values(v).forEach(walk);
    }
  };
  walk(query.filter);
  walk(query.sort);
  walk(compareFilterOf(query));
  return found;
}

// Where a reference stands decides what it must be: a `near` target is a
// vector, a `range` bound a number or date, a `matches`, `pattern` or
// `regex` value text, anything else any value.
export type CardReferenceRole = 'vector' | 'bound' | 'text' | 'value';

// Replaces every reference to a binding in `names` in a filter or sort:
// `replace` gets the binding, the path and the reference's role, and
// returns the value to stand in its place, or NO_BINDING_VALUE when there
// is none. The rule is `$this`'s (query-field-utils.ts), for every binding:
//
// - a reference that reads nothing (NO_BINDING_VALUE: no card, or no value
//   at the path) makes the whole query match nothing;
// - one that reads null: under `eq` it finds the cards with no value there,
//   as `eq: null` does; as a `range` bound its node matches nothing; under
//   `matches`, `pattern`, `regex`, `near` and `in` the query matches
//   nothing (no text, no glob, no vector, no list).
export function mapCardReferences<T>(
  node: T,
  names: Set<string>,
  replace: (name: string, path: string, role: CardReferenceRole) => unknown,
): T {
  let missing = false;
  let nothing = (n: any) => ({
    ...(n && n.on ? { on: n.on } : {}),
    in: { id: [] },
  });
  let isRef = (v: unknown) => {
    let ref = cardReference(v);
    return Boolean(ref && names.has(ref.name));
  };
  let value = (v: unknown, role: CardReferenceRole): unknown => {
    let ref = cardReference(v);
    if (!ref || !names.has(ref.name)) return v;
    let r = replace(ref.name, ref.path, role);
    if (
      r === NO_BINDING_VALUE ||
      (r == null && (role === 'text' || role === 'vector'))
    ) {
      missing = true;
      return null;
    }
    return r;
  };
  let keyed = (o: any, role: CardReferenceRole) =>
    Object.fromEntries(Object.entries(o).map(([k, v]) => [k, value(v, role)]));
  let walkFilter = (n: any): any => {
    if (!n || typeof n !== 'object' || Array.isArray(n)) return n;
    if (Array.isArray(n.any)) return { ...n, any: n.any.map(walkFilter) };
    if (Array.isArray(n.every)) return { ...n, every: n.every.map(walkFilter) };
    if (n.not) return { ...n, not: walkFilter(n.not) };
    let out: any = { ...n };
    for (let op of ['eq', 'contains'] as const) {
      if (n[op] && typeof n[op] === 'object') {
        out[op] = keyed(n[op], 'value');
      }
    }
    for (let op of ['pattern', 'regex'] as const) {
      if (n[op] && typeof n[op] === 'object') {
        out[op] = keyed(n[op], 'text');
      }
    }
    if (isRef(n.matches)) {
      out.matches = value(n.matches, 'text');
    }
    if (n.in && typeof n.in === 'object' && !Array.isArray(n.in)) {
      out.in = Object.fromEntries(
        Object.entries(n.in).map(([k, list]) => {
          if (isRef(list)) {
            // a one-card binding's list (`"$sofa.tags"`), read whole
            let r = value(list, 'value');
            if (r == null) {
              missing = true;
              return [k, []];
            }
            return [k, Array.isArray(r) ? r : [r]];
          }
          return [
            k,
            Array.isArray(list) ? list.map((e) => value(e, 'value')) : list,
          ];
        }),
      );
    }
    if (n.range && typeof n.range === 'object') {
      let empty = false;
      out.range = Object.fromEntries(
        Object.entries(n.range).map(([k, bounds]) => [
          k,
          bounds && typeof bounds === 'object'
            ? Object.fromEntries(
                Object.entries(bounds as object).map(([b, v]) => {
                  let ref = isRef(v);
                  let r = value(v, 'bound');
                  if (r == null && ref) empty = true;
                  return [b, r];
                }),
              )
            : bounds,
        ]),
      );
      if (empty) return nothing(n);
    }
    if (n.near && typeof n.near === 'object') {
      out.near = Object.fromEntries(
        Object.entries(n.near).map(([k, t]: [string, any]) => {
          if (!t || typeof t !== 'object' || !('to' in t)) return [k, t];
          return [k, { ...t, to: value(t.to, 'vector') }];
        }),
      );
    }
    return out;
  };
  let walkSort = (e: any): any => {
    if (!e || typeof e !== 'object') return e;
    if (Array.isArray(e.of)) {
      return { ...e, of: e.of.map(walkSort) };
    }
    let out: any = { ...e };
    if ('near' in e && isRef(e.near)) {
      out.near = value(e.near, 'vector');
    }
    if (e.when) out.when = walkFilter(e.when);
    return out;
  };
  let q: any = node;
  if (q && typeof q === 'object' && ('filter' in q || 'sort' in q)) {
    let out: any = { ...q };
    if (q.filter) out.filter = walkFilter(q.filter);
    if (Array.isArray(q.sort)) out.sort = q.sort.map(walkSort);
    if (missing) {
      // nothing there: the query matches no card, and its sort has nothing
      // to rank by
      out.filter = nothing(q.filter);
      if (Array.isArray(q.sort)) {
        let ranks = (s: any): boolean =>
          !(s && typeof s === 'object' && 'near' in s && s.near == null);
        out.sort = out.sort
          .map((s: any) =>
            s && Array.isArray(s.of) ? { ...s, of: s.of.filter(ranks) } : s,
          )
          .filter(ranks);
      }
    }
    return out;
  }
  let out = walkFilter(node);
  return missing ? (nothing(node) as T) : out;
}

interface QueryCommon {
  // The query's card type, once: the filter, every sort entry and the
  // collapse inherit it.
  type?: CodeRef;
  filter?: Filter;
  sort?: Sort;
  facets?: Facet[];
  collapse?: Collapse;
  let?: Record<string, LetBinding>;
  // Each result explains its rank: `meta._explain` on every row of a query
  // sorted by `_blend` or `_relevance` lists the first blend's signals, each
  // with its value, its rank over the matches, its weight and its share of
  // the fused score (see `ResultExplanation`).
  explain?: boolean;
  rerank?: Rerank;
  // The IANA zone (`America/New_York`) whose calendar the query's dates are
  // reckoned in: relative dates and their rounding, facet `interval`
  // buckets, TODAY() and an expression's date parts. Stored values keep
  // their meaning (time-zone.ts). Absent: the realm's default zone, else
  // UTC. A `let` binding's query inherits it unless it names its own.
  timeZone?: string;
  page?: {
    number?: number; // page.number is 0-based
    size: number;
    generation?: number;
    // Count every match, however many: a broad `matches` term otherwise
    // ranks a capped candidate set and reports an estimated total
    // (the `total-estimated` warning). Still held to the time budget.
    exactTotal?: boolean;
    // How much counting the total costs. `capped` (the default in the newer
    // spelling, set by its lowering) counts up to `SEARCH_TOTAL_CAP` (1,000)
    // and reports a lower bound past it (the `total-estimated` warning).
    // `exact` (the default in the older spelling, as it always counted, and
    // for a counts-only `size: 0` page) counts every match. `none`
    // counts nothing: `meta.page.hasMore` says whether another page exists,
    // and the total is the rows seen so far. A page with no next page is
    // always exactly counted, whatever the mode. A query-backed field's
    // search counts exactly unless it says otherwise.
    total?: PageTotalMode;
  };
}

export type PageTotalMode = 'exact' | 'capped' | 'none';
export const PAGE_TOTAL_MODES: readonly PageTotalMode[] = [
  'exact',
  'capped',
  'none',
];

// fields is only valid when asData is true. This discriminated union
// makes it a compile-time error to specify fields without asData.
type QueryBase =
  | (QueryCommon & { asData?: false; fields?: never })
  | (QueryCommon & { asData: true; fields?: SparseFieldsets });

export type Query =
  | (QueryBase & { realm?: string; realms?: never })
  | (QueryBase & { realms?: string[]; realm?: never });

export type DataQuery = Query & { asData: true };

interface QueryWithInterpolationsBase {
  filter?: Filter;
  sort?: SortWithInterpolations;
  timeZone?: string;
  fields?: SparseFieldsets;
  page?: {
    number?: number; // page.number is 0-based
    size: number | string;
    generation?: number;
    exactTotal?: boolean;
    total?: PageTotalMode;
  };
}

// `realms` accepts a bare string here, unlike the resolved `Query`: an
// interpolation like `$this.someField` is a single placeholder standing in for
// the whole list, and resolves to an array before the query is executed.
export type QueryWithInterpolations =
  | (QueryWithInterpolationsBase & { realm?: string; realms?: never })
  | (QueryWithInterpolationsBase & {
      realms?: string | string[];
      realm?: never;
    });

export type CardURL = string;
export type Filter =
  | LinkedFromFilter
  | AnyFilter
  | EveryFilter
  | NotFilter
  | EqFilter
  | InFilter
  | ContainsFilter
  | RangeFilter
  | MatchesFilter
  | TypeAheadFilter
  | NearFilter
  | PatternFilter
  | RegexFilter
  | CardTypeFilter;

export interface TypedFilter {
  on?: CodeRef;
}

// The anchorless sort keys: the column-backed general fields plus the
// synthetic `_matchRelevance` (computed per query, no stored column).
type GeneralSortField =
  | keyof typeof generalSortFields
  | typeof MATCH_RELEVANCE_SORT_KEY;

type SortExpressionWithoutCodeRef = {
  by: GeneralSortField;
  direction?: 'asc' | 'desc';
};

type SortExpressionWithCodeRef = {
  by: string;
  on: CodeRef;
  direction?: 'asc' | 'desc';
  // Where cards with no value at `by` go: last (the default) or first.
  missing?: 'first' | 'last';
  // Ranks by cosine similarity between the VectorField at `by` and this
  // target, most similar first (`direction` defaults to `desc`). Cards with
  // no vector at `by` sort last. See `NearSortTarget`.
  near?: NearSortTarget;
};

// One signal inside a `_blend` sort: any other sort entry (text relevance, a
// near sort, a general field such as `createdAt`, or a card field such as an
// engagement count) plus an optional `weight` (default 1). Inside a blend
// each signal ranks best first: highest value first unless `direction` is
// `asc`. A negative weight inverts the signal, as in `_relevance`: it ranks
// the other way round with the weight's size (least popular first, least
// similar first), and a `_when` signal lifts the cards that don't match.
export type BlendComponent =
  | ((SortExpressionWithoutCodeRef | SortExpressionWithCodeRef) & {
      weight?: number;
    })
  | ExprSortExpression
  | WhenSignal;

// A "should" clause: a blend signal that lifts the cards matching `when`
// without dropping the rest. Every match ties for first place in it, so each
// gains `weight / (k + 1)` and a card that doesn't match gains nothing.
// Only inside a `_blend`. `when` is any filter, anchored like the query's.
export const WHEN_SIGNAL_KEY = '_when';
export interface WhenSignal {
  by: typeof WHEN_SIGNAL_KEY;
  when: Filter;
  weight?: number;
}
export function isWhenSignal(sort: object): sort is WhenSignal {
  return (sort as { by?: unknown }).by === WHEN_SIGNAL_KEY;
}

// Reciprocal rank fusion of several signals: each card scores
// sum(weight / (k + rank)) over the signals it has a value for, ranked over
// every card the filter admits. Most-fused first (`direction` defaults to
// `desc`). Each result carries the score in `meta._blendScore`.
export type BlendSortExpression = {
  by: typeof BLEND_SORT_KEY;
  of: BlendComponent[];
  method?: 'rrf';
  k?: number;
  direction?: 'asc' | 'desc';
};

// The most signals one blend takes; each is a ranking pass over the
// filtered set.
export const MAX_BLEND_COMPONENTS = 8;
export const DEFAULT_RRF_K = 60;

// A `near` sort's target: plain numbers, or a vector in its stored form (as
// a VectorField serializes it). Its dimension must match the field's.
export type NearSortTarget = number[] | Vector;

type SortExpressionWithoutCodeRefWithInterpolations = {
  by: GeneralSortField;
  direction?: string;
};

type SortExpressionWithCodeRefWithInterpolations = {
  by: string;
  on?: CodeRef;
  direction?: string;
  near?: NearSortTarget | string;
  weight?: number;
  weights?: Partial<Record<RelevanceSignal, number>>;
  of?: SortExpressionWithCodeRefWithInterpolations[];
  method?: string;
  k?: number;
};

// Ranking by search intent (docs/search-intent.md): text relevance, weighted
// by the matched fields' search roles, fused with the ranking signals the
// type declares (`rank: 'popularity'` and the like) and, given `near`, the
// similarity of the type's vector field as the `meaning` signal. The engine
// compiles it to a `_blend` of those signals, so each result carries the
// fused score in `meta._blendScore`. `on` names the type whose declarations
// it reads; a search entry's root anchor supplies it.
export const RELEVANCE_SORT_KEY = '_relevance';
export const RELEVANCE_SIGNALS = [
  'text',
  ...SEARCH_RANK_SIGNALS,
  'meaning',
] as const;
export type RelevanceSignal = 'text' | SearchRankSignal | 'meaning';
// A signal's weight when the query names none: the words a reader typed
// lead, and the card's own signals break ties among good matches.
export const DEFAULT_RELEVANCE_WEIGHTS: Record<RelevanceSignal, number> = {
  text: 1,
  popularity: 0.5,
  recency: 0.5,
  quality: 0.5,
  priority: 0.5,
  meaning: 1,
};
export type RelevanceSortExpression = {
  by: typeof RELEVANCE_SORT_KEY;
  on?: CodeRef;
  // Re-weights signals by name. 0 drops a signal; a negative weight inverts
  // it (least popular first).
  weights?: Partial<Record<RelevanceSignal, number>>;
  near?: NearSortTarget;
  direction?: 'asc' | 'desc';
};

export function isRelevanceSort(sort: object): sort is RelevanceSortExpression {
  return (sort as { by?: unknown }).by === RELEVANCE_SORT_KEY;
}

// The request grammar's signal sorts (query-syntax.ts lowers them):
// `{ blend: [...] }` fuses signals by reciprocal rank, `{ formula }` ranks by
// a spreadsheet formula (in SQL when the score profile can run it, else over
// the top window), and `{ boost }` inside a blend lifts the cards a filter
// admits.
export interface BlendSort {
  blend: (Sort[number] | FormulaSort | BoostSignal)[];
  k?: number;
}
export interface FormulaSort {
  formula: string;
  weight?: number;
  direction?: 'asc' | 'desc';
  placement?: 'top';
}
export interface BoostSignal {
  boost: Filter;
  weight?: number;
}
type SortExpression =
  | ExprSortExpression
  | SortExpressionWithoutCodeRef
  | SortExpressionWithCodeRef
  | BlendSortExpression
  | RelevanceSortExpression;
type SortExpressionWithInterpolations =
  | SortExpressionWithoutCodeRefWithInterpolations
  | SortExpressionWithCodeRefWithInterpolations;
export type Sort = SortExpression[];
type SortWithInterpolations = SortExpressionWithInterpolations[];

// Ranks by a spreadsheet formula over each card's fields, in the BXL score
// profile (`compileBxlScoreToSql`): numbers, fields, arithmetic, comparisons
// and IF, IFERROR, ROUND, LN, LOG10, SQRT, POWER, MIN, MAX, AVERAGE, DAYS,
// NOW and the like. `{ by: '_expr', expr: 'rating / LN(priceMin + 1)' }`.
// Highest first unless `direction` is `asc`; a card whose formula has no
// value (a missing field, a division by zero) ranks last. It also takes part
// in a `_blend` as a signal. Postgres only.
export const EXPR_SORT_KEY = '_expr';
export type ExprSortExpression = {
  by: typeof EXPR_SORT_KEY;
  expr: string;
  on?: CodeRef;
  direction?: 'asc' | 'desc';
  weight?: number;
};
export function isExprSort(sort: object): sort is ExprSortExpression {
  return (sort as { by?: unknown }).by === EXPR_SORT_KEY;
}

export { exprSortSql };

// The CardTypeFilter is used when you solely want to filter for all cards that
// adopt from some particular card type--no other predicates are included in
// this filter.
export interface CardTypeFilter {
  type: CodeRef;
}

export interface AnyFilter extends TypedFilter {
  any: Filter[];
}

export interface EveryFilter extends TypedFilter {
  every: Filter[];
}

export interface NotFilter extends TypedFilter {
  not: Filter;
}

export interface EqFilter extends TypedFilter {
  eq: { [fieldName: string]: JSONValue };
}

export const RANGE_OPERATORS: Record<RangeOperator, string> = {
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
};
export type RangeOperator = 'gt' | 'gte' | 'lt' | 'lte';
export type RangeFilterValue = {
  [range in RangeOperator]?: JSONValue;
};

// A relative date in a `range` bound: `now`, optionally moved by whole units
// (`now-30d`, `now+1w`; s, m, h, d, w, M for months, y) and optionally
// rounded down to the start of a unit (`now-30d/d`, `now/M`) on the query's
// time zone's calendar, UTC unless it names one (`timeZone`). It is
// read when the query runs, so a saved search for "added this month" stays
// current. Any other string is a literal bound.
const RELATIVE_DATE = /^now(?:([+-])(\d+)([smhdwMy]))?(?:\/([smhdwMy]))?$/;

export function isRelativeDate(value: unknown): value is string {
  return typeof value === 'string' && RELATIVE_DATE.test(value);
}

// A bound on a date or date-time field that starts like a relative date
// (`now`, then a sign, a slash, a digit or nothing) but is not one
// (`now-3x`, `now-1`, `NOW/d`) is refused rather than compared as text,
// which would silently match nothing or everything. On any other field the
// same string stays literal text.
export function assertRelativeDateWellFormed(
  value: unknown,
  path: string,
): void {
  if (
    typeof value === 'string' &&
    /^\s*now\s*(?:[-+/\d]|$)/i.test(value) &&
    !RELATIVE_DATE.test(value)
  ) {
    throw new InvalidQueryError(
      `"${path}" is a date field, and ${JSON.stringify(value.slice(0, 80))} is not a relative date: write \`now\`, optionally moved by whole units and rounded down (\`now-30d\`, \`now+1w\`, \`now-1M/d\`), with units s, m, h, d, w, M, y`,
      'invalid-value',
    );
  }
}

// Reckoned in `zone` (see time-zone.ts): by default the zone the query's
// clock reading carries (`clockInZone`), UTC for a bare `new Date()`.
export function resolveRelativeDate(
  value: string,
  now = new Date(),
  zone: string = zoneOfClock(now),
): string {
  if (!isUtcZone(zone)) {
    return resolveRelativeDateInZone(value, now, zone) ?? value;
  }
  let match = RELATIVE_DATE.exec(value);
  if (!match) {
    return value;
  }
  let [, sign, amount, unit, round] = match;
  let d = new Date(now.getTime());
  if (sign) {
    let n = Number(amount) * (sign === '-' ? -1 : 1);
    switch (unit) {
      case 's':
        d.setUTCSeconds(d.getUTCSeconds() + n);
        break;
      case 'm':
        d.setUTCMinutes(d.getUTCMinutes() + n);
        break;
      case 'h':
        d.setUTCHours(d.getUTCHours() + n);
        break;
      case 'd':
        d.setUTCDate(d.getUTCDate() + n);
        break;
      case 'w':
        d.setUTCDate(d.getUTCDate() + 7 * n);
        break;
      case 'M':
        d.setUTCMonth(d.getUTCMonth() + n);
        break;
      case 'y':
        d.setUTCFullYear(d.getUTCFullYear() + n);
        break;
    }
  }
  if (round) {
    let order = ['s', 'm', 'h', 'd', 'M', 'y'];
    let upTo = round === 'w' ? order.indexOf('d') : order.indexOf(round);
    if (upTo >= 0) d.setUTCMilliseconds(0);
    if (upTo >= 1) d.setUTCSeconds(0);
    if (upTo >= 2) d.setUTCMinutes(0);
    if (upTo >= 3) d.setUTCHours(0);
    if (round === 'w') {
      // weeks start on Monday, as a facet's week interval does
      d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    }
    if (upTo >= 4) d.setUTCDate(1);
    if (upTo >= 5) d.setUTCMonth(0);
  }
  // a move past the dates a clock can name (`now+99999999y`)
  if (Number.isNaN(d.getTime())) {
    throw new InvalidQueryError(
      `"${value}" moves past the last date there is (about 275,000 years from 1970 either way)`,
      'invalid-value',
    );
  }
  return d.toISOString();
}

export interface RangeFilter extends TypedFilter {
  range: {
    [fieldName: string]: RangeFilterValue;
  };
}

export interface InFilter extends TypedFilter {
  // A string value is a `$this.<fieldPath>` interpolation (query-backed
  // fields), a placeholder standing in for the whole list that resolves to an
  // array before the query is executed; `assertQuery` accepts only the
  // resolved array form.
  // `{ "$let": name }` reads a list binding (see `LetBinding`).
  in: { [fieldName: string]: JSONValue[] | string | LetReference };
}

export interface ContainsFilter extends TypedFilter {
  contains: { [fieldName: string]: JSONValue };
  // Set by the engine, never on the wire: a one- or two-character substring of
  // a title that more of the realm's cards hold than the candidate cap, so it
  // matches at most this many of them (see `capBroadMatches`).
  candidateCap?: number;
}

/**
 * Full-text matches filter. The `matches` value is currently restricted to a
 * plain query string; the key is reserved so it can later be widened to an
 * object form (e.g. `{ query: string; fields?: string[]; operator?: 'and' | 'or' }`)
 * without breaking existing callers that pass a bare string.
 */
export interface MatchesFilter extends TypedFilter {
  matches: string;
  // Type-ahead: the query's last word matches as a prefix of a word in the
  // document (`kleppm` finds "Kleppmann"), and every earlier word matches as
  // it would without the flag. A query that ends in whitespace has no
  // unfinished word, so it matches exactly as without the flag.
  prefix?: boolean;
  // Search the passages of one of the card's PassageField lists instead of its
  // rendered markdown: a card matches when any passage does, a relevance sort
  // ranks it by its best passage, and the search reports the passages that
  // matched (`meta.passages`). Names a top-level field, e.g. `segments`.
  within?: string;
  // Only the values of these fields (dotted paths into the search doc, such
  // as `material` or `brand.name`; a list field's values all count): the
  // same stemmed, case-insensitive word match, so "metal" finds "Metal" and
  // "silicone" finds "Silicon". Evaluated per card rather than from an
  // index, so anchor it on a type. Postgres; SQLite matches the text as a
  // case-insensitive substring of any of the fields.
  fields?: string[];
  // Only the card's title, name and alias roles (docs/search-intent.md). Not
  // `in`, which is the membership operator: a node holding both would read as
  // two operators.
  scope?: 'title';
  // A misspelt word still matches (docs/search-intent.md): each word also
  // matches the closest words of the realm's fields declared `typos: true`.
  // Postgres only; SQLite matches the words as typed.
  typos?: boolean;
  // Set by the engine, never on the wire: the term's finished words widened
  // to their corrections, as tsquery text, and with `prefix` the corrections
  // of a long enough word still being typed.
  typoQuery?: string;
  typoPartial?: string;
  // Set by the engine, never on the wire: the term matched more of the
  // realm's cards than the candidate cap, so its match set is bounded to
  // this many candidates on each side (see `capBroadMatches`).
  candidateCap?: number;
}

// Membership in another card's links: keeps the cards that `card` links to
// in `field` (a linksTo or linksToMany, dotted through a compound field), as
// that card's index entry records them. "In my saved list" is
// `{ linkedFrom: { card: '…/Wishlist/mine', field: 'items' } }`. `card` is
// an absolute card URL in the realm being searched; a card in another realm,
// or one that doesn't exist, links to nothing here.
export interface LinkedFromFilter extends TypedFilter {
  linkedFrom: { card: string; field: string };
}

// A glob over a field's whole value, ignoring case, path-aware: `*` is any
// run of characters within one `/` segment, `?` any one character other than
// `/`, `**` any run across segments. Only on a field searched by pattern
// (declared `search: { patterns: true }`, or an `identifier` or `code` role);
// every file type's `url` and `name` are.
export interface PatternFilter extends TypedFilter {
  pattern: { [fieldName: string]: string };
}

// A POSIX regular expression over a field's value (Postgres's `~`), on the
// same fields as `pattern`. Postgres only.
export interface RegexFilter extends TypedFilter {
  regex: { [fieldName: string]: string };
}

// One passage that matched a search's `matches … within` term (see PassageField).
export interface PassageMatch {
  field: string;
  ordinal: number;
  start: number | null;
  end: number | null;
  score: number;
  // The stretch of the passage around what matched (Postgres `ts_headline`),
  // so a result can show the line without loading the field.
  snippet?: string;
}

// The engine's type-ahead node, which a title-scoped prefix `matches`
// (`{ matches, prefix: true, scope: 'title' }`) runs as; a caller that
// writes it is refused (`typeAheadRefusal`). Type-ahead over a card's short
// names: its title and its
// `cardInfo.alternativeNames`, stamped into the search doc's `_typeahead` key.
// Every word of the query is a prefix of some word of that text, in any order,
// ignoring case and never stemmed. Unlike `matches` it never reads a card's
// rendered markdown, so a long definition or transcript can't match or slow
// it. A query with no letters or digits matches nothing.
export interface TypeAheadFilter extends TypedFilter {
  typeahead: string;
  // Each word also matches the closest words of the realm's word list (its
  // cards' titles and alternative names, and fields declared `typos: true`),
  // within the word's edit budget. Postgres only.
  typos?: boolean;
  // Set by the engine, never on the wire.
  typoQuery?: string;
}

// The words of a type-ahead query: runs of letters and digits, lowercased.
export function typeAheadWords(text: string): string[] {
  return [...text.matchAll(/[\p{L}\p{N}]+/gu)].map((m) => m[0].toLowerCase());
}

// Postgres's English stop words (its `english.stop`), which the full-text
// configuration drops from a query.
const ENGLISH_STOP_WORDS = new Set(
  (
    'i me my myself we our ours ourselves you your yours yourself yourselves ' +
    'he him his himself she her hers herself it its itself they them their ' +
    'theirs themselves what which who whom this that these those am is are ' +
    'was were be been being have has had having do does did doing a an the ' +
    'and but if or because as until while of at by for with about against ' +
    'between into through during before after above below to from up down ' +
    'in out on off over under again further then once here there when where ' +
    'why how all any both each few more most other some such no nor not ' +
    'only own same so than too very s t can will just don should now'
  ).split(' '),
);

// A `matches` text that holds nothing to search for: every word in it is a
// stop word or a single letter or digit ("a", "the of", "x y"). Such a term
// matches no card, and never reaches a full-text scan: an empty text query
// still reads every rendered page to find that out.
export function matchesHoldsNoWord(text: string): boolean {
  return typeAheadWords(text).every(
    (word) => [...word].length < 2 || ENGLISH_STOP_WORDS.has(word),
  );
}

export function isTypeAheadFilter(filter: Filter): filter is TypeAheadFilter {
  return (filter as TypeAheadFilter).typeahead !== undefined;
}

// Type-ahead is written `{ matches, prefix: true, scope: 'title' }`: a prefix
// search over a card's names. The engine runs it as its internal type-ahead
// node (`TypeAheadFilter`, never accepted from a caller), so it keeps that
// node's rules: every word a word prefix of the title or an alternative
// name, in any order, unstemmed and accent-folded, a word under three
// letters whole unless a longer word narrows it, and a title-tier relevance
// (exact title first).
export function isTitlePrefixMatch(filter: unknown): filter is MatchesFilter {
  let f = filter as MatchesFilter | null;
  return (
    f != null &&
    typeof f === 'object' &&
    typeof f.matches === 'string' &&
    f.prefix === true &&
    f.scope === 'title' &&
    f.within === undefined &&
    f.fields === undefined
  );
}

// Rewrites each title-scoped prefix `matches` in a filter tree to the
// engine's type-ahead node. Idempotent; leaves every other node as it is.
export function lowerTitlePrefixMatches<T extends Filter | undefined>(
  filter: T,
): T {
  let walk = (node: any): any => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return node;
    if (isTitlePrefixMatch(node)) {
      let { matches, prefix: _p, scope: _s, ...rest } = node as any;
      return { ...rest, typeahead: matches };
    }
    if (Array.isArray(node.every))
      return { ...node, every: node.every.map(walk) };
    if (Array.isArray(node.any)) return { ...node, any: node.any.map(walk) };
    if (node.not && typeof node.not === 'object')
      return { ...node, not: walk(node.not) };
    return node;
  };
  return walk(filter);
}

// The same rewrite over a sort's blend signals (`_when` filters).
export function lowerTitlePrefixMatchesInSort<T extends Sort | undefined>(
  sort: T,
): T {
  if (!Array.isArray(sort)) return sort;
  return sort.map((s: any) =>
    s && s.by === '_blend' && Array.isArray(s.of)
      ? {
          ...s,
          of: s.of.map((c: any) =>
            c && c.by === '_when' && c.when
              ? { ...c, when: lowerTitlePrefixMatches(c.when) }
              : c,
          ),
        }
      : s,
  ) as T;
}

// One positive `matches` term, as a `_matchRelevance` sort scores it.
// A term's word statistics, set by the engine before it builds SQL when the
// type it searches declares `searchDefaults.wordStatistics`: each query
// lexeme with its inverse document frequency in the realm.
export interface WordStatistics {
  lexemes: string[];
  idfs: number[];
}

export type MatchTerm = Pick<
  MatchesFilter,
  | 'matches'
  | 'prefix'
  | 'within'
  | 'scope'
  | 'typos'
  | 'typoQuery'
  | 'typoPartial'
> & {
  wordStatistics?: WordStatistics;
  // A type-ahead term (`matches` with `prefix` and `scope: 'title'`, run
  // as the engine's type-ahead node), which ranks by title tier.
  typeahead?: boolean;
  // Under an `any` or a `not`: a row can be in the result without matching.
  optional?: boolean;
};

// The type-ahead split of a `prefix` query: the finished words, and the
// unfinished last word as letters and digits only (so it can be spliced into
// tsquery syntax), or `undefined` when the query ends in a finished word.
export function splitTypeAheadQuery(text: string): {
  words: string;
  partial: string | undefined;
} {
  let match = /([\p{L}\p{N}]+)$/u.exec(text);
  if (!match) {
    return { words: text, partial: undefined };
  }
  return {
    words: text.slice(0, match.index),
    partial: match[1].toLowerCase(),
  };
}

// Vector similarity, field-keyed like `range`: a card matches when its
// VectorField at the path has cosine similarity of at least `minSimilarity`
// to `to` (any of its vectors, for a plural path). Without `minSimilarity` it
// matches every card with a vector of `to`'s dimension at the path. Ranking
// is the near sort's job, and top-k is `page.size` on a near-sorted query.
export interface NearFilter extends TypedFilter {
  near: Record<string, NearFilterValue>;
}

export interface NearFilterValue {
  to: NearSortTarget;
  minSimilarity?: number;
}

export function isNearFilter(filter: Filter): filter is NearFilter {
  return 'near' in filter;
}

export function isCardTypeFilter(filter: Filter): filter is CardTypeFilter {
  return (filter as CardTypeFilter).type !== undefined;
}

export function isNotFilter(filter: Filter): filter is NotFilter {
  return (filter as NotFilter).not !== undefined;
}

export function isRangeFilter(filter: Filter): filter is RangeFilter {
  return (filter as RangeFilter).range !== undefined;
}

export function isEveryFilter(filter: Filter): filter is EveryFilter {
  return (filter as EveryFilter).every !== undefined;
}
export function isAnyFilter(filter: Filter): filter is AnyFilter {
  return (filter as AnyFilter).any !== undefined;
}
export function isInFilter(filter: Filter): filter is InFilter {
  return (filter as InFilter).in !== undefined;
}
export function isMatchesFilter(filter: Filter): filter is MatchesFilter {
  return (filter as MatchesFilter).matches !== undefined;
}

// Every positive-polarity `matches` string in a filter tree — the terms a
// `_matchRelevance` sort scores. Terms under an odd number of `not`s still
// filter rows out through their predicate but must not contribute to "how
// relevant", and whitespace-only terms rank nothing (mirroring the predicate's
// empty-query short-circuit), so both are excluded. Shared by `assertQuery`'s
// parse-time validation and the engine's rank expression so the two agree on
// what counts as a rankable term.
// `optional`: the term sits under an `any` (or a `not`), so a row can be in
// the result without matching it.
export function collectPositiveMatchTerms(
  filter: Filter | undefined,
  polarity: 'positive' | 'negated' = 'positive',
  optional = false,
): MatchTerm[] {
  if (!filter) {
    return [];
  }
  if ('matches' in filter) {
    return polarity === 'positive' && filter.matches.trim() !== ''
      ? [
          {
            matches: filter.matches,
            ...(filter.prefix ? { prefix: true } : {}),
            ...(filter.within ? { within: filter.within } : {}),
            ...(filter.scope ? { scope: filter.scope } : {}),
            ...(filter.typos ? { typos: true } : {}),
            ...(filter.typoQuery !== undefined
              ? { typoQuery: filter.typoQuery }
              : {}),
            ...(filter.typoPartial ? { typoPartial: filter.typoPartial } : {}),
            ...(optional ? { optional: true } : {}),
            ...((filter as { wordStatistics?: WordStatistics }).wordStatistics
              ? {
                  wordStatistics: (
                    filter as { wordStatistics?: WordStatistics }
                  ).wordStatistics,
                }
              : {}),
          },
        ]
      : [];
  }
  if ('typeahead' in filter && typeof filter.typeahead === 'string') {
    return polarity === 'positive' && filter.typeahead.trim() !== ''
      ? [
          {
            matches: filter.typeahead,
            typeahead: true,
            ...(filter.typoQuery !== undefined
              ? { typoQuery: filter.typoQuery }
              : {}),
          },
        ]
      : [];
  }
  if ('not' in filter) {
    return collectPositiveMatchTerms(
      filter.not,
      polarity === 'positive' ? 'negated' : 'positive',
      true,
    );
  }
  if ('every' in filter) {
    return filter.every.flatMap((f) =>
      collectPositiveMatchTerms(f, polarity, optional),
    );
  }
  if ('any' in filter) {
    return filter.any.flatMap((f) =>
      collectPositiveMatchTerms(f, polarity, true),
    );
  }
  return [];
}

// True when a filter path's leaf is a card/file reference (`id` / `url`). Such
// leaves get canonical-RRI tolerance in `in` filters — a registered-prefix
// value also matches its equivalent real-URL / virtual-alias spellings — while
// `eq` and other operators stay exact. Both the index query engine and the
// client-side instance-filter matcher key that tolerance off this predicate so
// they agree on which paths it covers.
export function isReferenceFilterField(path: string): boolean {
  let leaf = path.split('.').pop();
  return leaf === 'id' || leaf === 'url';
}

export function buildQueryParamValue(query: Query): string {
  return qs.stringify(query, { strictNullHandling: true, encode: false });
}

// What a query may hold, past which it is refused (`limit-exceeded`): far
// past any app's use, and short of where the database would fail on it.
export { MAX_QUERY_DEPTH };
// values in one `in` list
export const MAX_IN_VALUES = 10_000;
// A query in the older spelling is read as it always was, and refused only
// past where the database failed on it: an `in` past Postgres's 65,535 bound
// parameters, a term long enough to overflow its parser's stack, a sort past
// its 1,664-column target list.
export { MAX_OLDER_QUERY_DEPTH };
export const MAX_OLDER_IN_VALUES = 65_000;
export const MAX_OLDER_TEXT_TERM_LENGTH = 99_999;
export const MAX_OLDER_SORT_ENTRIES = 800;
// characters in a `matches` term
export const MAX_TEXT_TERM_LENGTH = 10_000;
// entries in `sort`
export const MAX_SORT_ENTRIES = 64;
// the largest `page.number` (0-based)
export const MAX_PAGE_NUMBER = 1_000_000_000;
// the largest `k` of a blend
export const MAX_BLEND_K = 1_000_000;
// the largest size of one component of a `near` target
export const MAX_VECTOR_COMPONENT = 1_000_000_000;

// The members a query may carry in the engine's form, for the unknown-key
// refusal (query-grammar.ts).
const QUERY_MEMBERS = grammarMembers('query', isEngineForm);
// Every member the check below reads: those, and a request's own.
const TOP_LEVEL_MEMBERS = [
  ...QUERY_MEMBERS,
  ...grammarMembers('query', isWire),
];
const PAGE_MEMBERS = grammarMembers('page');
const BINDING_MEMBERS = grammarMembers('binding');
// What an unknown top-level member is matched against: the engine form's
// members, the top-level `type` the lowering reads, and a request's own.
const QUERY_MEMBERS_AND_TYPE = grammarMembers(
  'query',
  (m) => m.form !== 'entry',
);

// Set while a query in the older spelling is being checked.
let readingOlderSpelling = false;

export function assertQuery(
  query: any,
  pointer: string[] = [''],
): asserts query is Query {
  if (typeof query !== 'object' || query == null) {
    throw new InvalidQueryError(
      `${pointer.join('/') || '/'}: missing query object`,
      'missing-member',
    );
  }
  let atTop = pointer.length === 1 && pointer[0] === '';
  if (atTop && !readingOlderSpelling) {
    // Plain JSON data, nested within bounds, before anything walks it.
    // held to the older spelling's bound here; a newer spelling is held to
    // its own when it is lowered
    assertPlainQueryData(query, MAX_OLDER_QUERY_DEPTH);
  }
  if (Array.isArray(query)) {
    throw new InvalidQueryError(
      `${pointer.join('/') || '/'}: a query is an object, not a list`,
      'invalid-value',
    );
  }
  // A type written as its shorthand is checked as the code ref it stands
  // for, in either spelling (type-reference.ts).
  if (atTop) {
    let resolved = resolveTypeReferences(query);
    if (resolved !== query) {
      assertQuery(resolved, pointer);
      return;
    }
  }
  // The request grammar's newer spellings are checked in their lowered form.
  if (atTop && usesNewSyntax(query)) {
    // Lowered as the engine lowers it, so an unknown function in an
    // expression is refused here rather than when the query runs.
    assertQuery(
      lowerQuery(query, { knownFunctions: BXL_FORMULA_FUNCTIONS }).query,
      ['', ''],
    );
    return;
  }

  // A query in the older spelling is read as it always was: a member the
  // grammar doesn't know is ignored rather than refused, since queries saved
  // in realms carry them (`page.cursor`, for one). The newer spellings are
  // checked strictly, above.
  if (pointer.length === 1 && pointer[0] === '' && !readingOlderSpelling) {
    readingOlderSpelling = true;
    try {
      assertQuery(query, pointer);
    } finally {
      readingOlderSpelling = false;
    }
    return;
  }

  if ('realm' in query && 'realms' in query) {
    throw new InvalidQueryError(
      `${pointer.join('/') || '/'}: query cannot specify both realm and realms`,
      'conflicting-members',
    );
  }

  // An unknown member first, so a misspelled `let` or `filter` is named as
  // the misspelling rather than as what its absence leads to.
  for (let key of Object.keys(query)) {
    if (!(TOP_LEVEL_MEMBERS as readonly string[]).includes(key)) {
      // `rerank` is the engine's form of a sort entry with `top`, never a
      // name to suggest
      throw unknownMember(
        pointer.join('/') || '/',
        key,
        grammarHints('query', (m) => m.form !== 'entry'),
      );
    }
  }

  // Bindings first; then the rest of the query is checked with each
  // `"$name"` stood in by an empty list, the shape it resolves to.
  // Every reference names a binding of the right kind: a list for
  // "$name", one card for "$name.path".
  query = internBindingReferences(query);
  if ('let' in query) {
    assertLetBindings(query.let, pointer.concat('let'));
  }
  let bindings = (query.let ?? {}) as Record<string, LetBinding>;
  for (let ref of letReferencesIn(query)) {
    if (ref.path !== undefined && typeof ref.path !== 'string') {
      throw new InvalidQueryError(
        `${pointer.join('/') || '/'}: "${ref.$let}.…" reads a field path, so its path is text`,
        'invalid-value',
      );
    }
    // a name every object inherits names no binding
    let binding = hasOwn(bindings, ref.$let) ? bindings[ref.$let] : undefined;
    if (!binding) {
      let near = nearestMember(ref.$let, Object.keys(bindings));
      throw new InvalidQueryError(
        `${pointer.join('/') || '/'}: "${ref.$let}" names no binding in let${near ? `; did you mean "${near}"?` : ''}`,
        'unknown-binding',
      );
    }
    if (Boolean(binding.one) !== (ref.path !== undefined)) {
      throw new InvalidQueryError(
        binding.one
          ? `${pointer.join('/') || '/'}: "${ref.$let}" is one card; read a value of it as "${ref.$let}.path", such as "${ref.$let}.id"`
          : `${pointer.join('/') || '/'}: "${ref.$let}" is a list; read it whole as "${ref.$let}", the one value of an \`in\``,
        'binding-kind',
      );
    }
  }
  // A list binding stands in for a whole list, so it goes only where the
  // engine reads one: as the one value of an `in` (in the filter or a
  // boost's filter, or a rerank's comparison filter). Anywhere else it would
  // match nothing.
  let placed = new Set<unknown>();
  for (let part of [
    { filter: query.filter, sort: query.sort },
    { filter: compareFilterOf(query) },
  ]) {
    mapLetReferences(part as any, (_field, _name, node) => {
      placed.add(Object.values(node.in)[0]);
      return node;
    });
  }
  for (let ref of letReferencesIn(query)) {
    if (ref.path === undefined && !placed.has(ref)) {
      throw new InvalidQueryError(
        `${pointer.join('/') || '/'}: "${ref.$let}" is a list, and a list binding goes only as the one value of an \`in\`: { "in": { "field": "${ref.$let}" } }`,
        'binding-kind',
      );
    }
  }
  if ('let' in query) {
    let cards = new Set(
      Object.entries(query.let as Record<string, LetBinding>)
        .filter(([, b]) => b.one)
        .map(([n]) => n),
    );
    // A one-card binding's references stand in as values of their role.
    if (cards.size) {
      let placeholder = (_n: string, _p: string, role: CardReferenceRole) =>
        role === 'vector'
          ? [0]
          : role === 'bound'
            ? 0
            : role === 'text'
              ? 'x'
              : null;
      let probe = mapCardReferences(
        { filter: query.filter, sort: query.sort } as any,
        cards,
        placeholder,
      );
      query = {
        ...query,
        ...(query.filter ? { filter: probe.filter } : {}),
        ...(query.sort ? { sort: probe.sort } : {}),
      };
      if (compareFilterOf(query)) {
        query = {
          ...query,
          rerank: {
            ...query.rerank,
            compare: {
              ...query.rerank.compare,
              filter: mapCardReferences(
                query.rerank.compare.filter,
                cards,
                placeholder,
              ),
            },
          },
        };
      }
    }
  }
  if (query.filter || query.sort) {
    let probe = mapLetReferences(
      { filter: query.filter, sort: query.sort } as any,
      (field, _name, node) => ({ ...node, in: { [field]: [] } }),
    );
    query = {
      ...query,
      ...(query.filter ? { filter: probe.filter } : {}),
      ...(query.sort ? { sort: probe.sort } : {}),
    };
  }
  // A rerank's comparison set runs with the query's bindings too.
  if (compareFilterOf(query)) {
    let probe = mapLetReferences(
      { filter: query.rerank.compare.filter } as any,
      (field, _name, node) => ({ ...node, in: { [field]: [] } }),
    );
    query = {
      ...query,
      rerank: {
        ...query.rerank,
        compare: { ...query.rerank.compare, filter: probe.filter },
      },
    };
  }
  // an escaped literal is checked as the text it stands for
  query = unwrapLiterals(query);

  for (let [key, value] of Object.entries(query)) {
    switch (key) {
      case 'filter':
        assertFilter(value, pointer.concat('filter'));
        break;
      case 'sort': {
        if (!Array.isArray(value)) {
          throw new InvalidQueryError(
            `${pointer.concat('sort').join('/') || '/'}: sort must be an array`,
            'invalid-value',
          );
        }
        let maxSort = readingOlderSpelling
          ? MAX_OLDER_SORT_ENTRIES
          : MAX_SORT_ENTRIES;
        if (value.length > maxSort) {
          throw new InvalidQueryError(
            `${pointer.concat('sort').join('/') || '/'}: a sort takes at most ${maxSort} entries, and this one has ${value.length}`,
            'limit-exceeded',
          );
        }
        value.forEach((sort, i) => {
          assertSortExpression(sort, pointer.concat(`sort[${i}]`));
        });
        break;
      }
      case 'queryString':
        if (typeof value !== 'string') {
          throw new InvalidQueryError(
            `${
              pointer.concat('queryString').join('/') || '/'
            }: queryString must be a string`,
            'invalid-value',
          );
        }
        break;
      case 'page':
        assertPage(value, pointer.concat('page'));
        break;
      case 'realm':
        assertRealm(value, pointer.concat('realm'));
        break;
      case 'realms':
        assertRealms(value, pointer.concat('realms'));
        break;
      case 'fields':
        assertFields(value, pointer.concat('fields'));
        break;
      case 'facets':
        assertFacets(value, pointer.concat('facets'));
        break;
      case 'collapse':
        assertCollapse(value, pointer.concat('collapse'));
        break;
      case 'let':
        break; // checked above
      case 'rerank': {
        // the engine's form of the sort entry with `top` that leads the sort
        // (query-syntax.ts lowers it), reported where it was written
        let at = pointer.concat('sort', '0').join('/') || '/';
        let value = query.rerank as any;
        if (
          typeof value !== 'object' ||
          value == null ||
          Array.isArray(value)
        ) {
          throw new InvalidQueryError(
            `${at}: rerank must be { expression, top?, direction? }`,
            'invalid-value',
          );
        }
        for (let key of Object.keys(value)) {
          if (!RERANK_MEMBERS.includes(key)) {
            throw key === 'expr' || key === 'formula'
              ? new InvalidQueryError(
                  `${at}: unknown rerank member "${key}"; did you mean "expression"?`,
                  'unknown-key',
                )
              : unknownMember(at, key, RERANK_MEMBERS, 'rerank member');
          }
        }
        if (
          typeof value.expression !== 'string' ||
          value.expression.trim() === ''
        ) {
          throw new InvalidQueryError(
            `${at}/expression: expression must be a non-empty BXL expression, such as "rating * 2"`,
            'invalid-expression',
          );
        }
        if (value.expression.length > 2000) {
          throw new InvalidQueryError(
            `${at}/expression: an expression is at most 2,000 characters, and this one has ${value.expression.length}`,
            'limit-exceeded',
          );
        }
        assertQueryExpressionProfile(`${at}/expression`, value.expression);
        if (
          value.top !== undefined &&
          (!Number.isInteger(value.top) ||
            value.top < 1 ||
            value.top > MAX_RERANK_TOP)
        ) {
          throw new InvalidQueryError(
            `${at}/top: top must be an integer from 1 to ${MAX_RERANK_TOP}`,
            'invalid-value',
          );
        }
        if (value.compare !== undefined) {
          let c = value.compare;
          if (typeof c !== 'object' || c == null || Array.isArray(c)) {
            throw new InvalidQueryError(
              `${at}/compare: compare is { filter?, by? } or { near, k?, minSimilarity?, filter? }`,
              'invalid-value',
            );
          }
          for (let key of Object.keys(c)) {
            if (!COMPARE_MEMBERS.includes(key)) {
              throw unknownMember(
                `${at}/compare`,
                key,
                COMPARE_MEMBERS,
                'comparison member',
              );
            }
          }
          if (c.near !== undefined) {
            if (typeof c.near !== 'string' || !FACET_PATH.test(c.near)) {
              throw new InvalidQueryError(
                `${at}/compare/near: near names a vector field, such as "imageEmbedding"`,
                'invalid-value',
              );
            }
            if (c.by !== undefined) {
              throw new InvalidQueryError(
                `${at}/compare: a row's look-alikes (near) are its own set, so compare takes near or by, not both`,
                'conflicting-members',
              );
            }
          }
          if (
            c.k !== undefined &&
            (c.near === undefined ||
              !Number.isInteger(c.k) ||
              c.k < 1 ||
              c.k > MAX_NEAR_PEERS)
          ) {
            throw new InvalidQueryError(
              `${at}/compare/k: k goes with near, an integer from 1 to ${MAX_NEAR_PEERS}`,
              'invalid-value',
            );
          }
          if (
            c.minSimilarity !== undefined &&
            (c.near === undefined ||
              typeof c.minSimilarity !== 'number' ||
              c.minSimilarity < -1 ||
              c.minSimilarity > 1)
          ) {
            throw new InvalidQueryError(
              `${at}/compare/minSimilarity: minSimilarity goes with near, a number from -1 to 1`,
              'invalid-value',
            );
          }
          if (
            c.by !== undefined &&
            (typeof c.by !== 'string' || !FACET_PATH.test(c.by))
          ) {
            throw new InvalidQueryError(
              `${at}/compare/by: by must be a field path, such as "productType"`,
              'invalid-value',
            );
          }
          if (c.filter !== undefined) {
            assertFilter(
              c.filter,
              pointer.concat('sort', '0', 'compare', 'filter'),
            );
          }
        }
        if (
          value.direction !== undefined &&
          value.direction !== 'asc' &&
          value.direction !== 'desc'
        ) {
          throw new InvalidQueryError(
            `${at}/direction: direction must be 'asc' or 'desc'`,
            'invalid-value',
          );
        }
        break;
      }
      case 'timeZone':
        assertTimeZone(value, pointer.concat('timeZone').join('/') || '/');
        break;
      case 'explain':
        if (typeof value !== 'boolean') {
          throw new InvalidQueryError(
            `${pointer.concat('explain').join('/') || '/'}: explain must be a boolean`,
            'invalid-value',
          );
        }
        break;
      case 'asData':
        if (typeof value !== 'boolean') {
          throw new InvalidQueryError(
            `${pointer.concat('asData').join('/') || '/'}: asData must be a boolean`,
            'invalid-value',
          );
        }
        break;

      default:
        throw unknownMember(
          pointer.join('/') || '/',
          key,
          QUERY_MEMBERS_AND_TYPE,
        );
    }
  }

  if ('fields' in query && query.asData !== true) {
    throw new InvalidQueryError(
      `${pointer.join('/') || '/'}: fields requires asData to be true`,
      'conflicting-members',
    );
  }

  // A `_matchRelevance` sort scores the filter's positive `matches` terms, so
  // a query with none has nothing to rank by. Validated here — where every
  // wire surface parses — so a bad request fails as an `InvalidQueryError`
  // (HTTP 400) rather than surfacing from the engine as a 500; the engine
  // re-checks as a backstop for callers that bypass `assertQuery`.
  if (
    Array.isArray(query.sort) &&
    query.sort.some(
      (s: any) =>
        isMatchRelevanceSort(s) ||
        (isBlendSort(s) && s.of.some(isMatchRelevanceSort)),
    ) &&
    collectPositiveMatchTerms(query.filter).length === 0
  ) {
    throw new InvalidQueryError(
      `${pointer.join('/') || '/'}: sort by textRelevance requires at least one positive \`matches\` filter`,
      'matches-required',
    );
  }
}

function assertRealm(realm: any, pointer: string[]): asserts realm is string {
  if (typeof realm !== 'string') {
    throw new InvalidQueryError(
      `${pointer.join('/') || '/'}: realm must be a string`,
      'invalid-value',
    );
  }
}

function assertRealms(
  realms: any,
  pointer: string[],
): asserts realms is string[] {
  if (!Array.isArray(realms)) {
    throw new InvalidQueryError(
      `${pointer.join('/') || '/'}: realms must be an array of strings`,
      'invalid-value',
    );
  }
  for (let realm of realms) {
    if (typeof realm !== 'string') {
      throw new InvalidQueryError(
        `${pointer.join('/') || '/'}: realms must be an array of strings`,
        'invalid-value',
      );
    }
  }
}

function assertFields(
  fields: any,
  pointer: string[],
): asserts fields is SparseFieldsets {
  if (typeof fields !== 'object' || fields == null || Array.isArray(fields)) {
    throw new InvalidQueryError(
      `${pointer.join('/') || '/'}: fields must be an object mapping type names to arrays of field names`,
      'invalid-value',
    );
  }
  for (let [typeName, fieldNames] of Object.entries(fields)) {
    if (!Array.isArray(fieldNames)) {
      throw new InvalidQueryError(
        `${pointer.concat(typeName).join('/') || '/'}: fields value must be an array of field names`,
        'invalid-value',
      );
    }
    for (let fieldName of fieldNames) {
      if (typeof fieldName !== 'string') {
        throw new InvalidQueryError(
          `${pointer.concat(typeName).join('/') || '/'}: each field name must be a string`,
          'invalid-value',
        );
      }
    }
  }
}

const RERANK_MEMBERS = grammarMembers('window');
const COMPARE_MEMBERS = grammarMembers('compare');

// An unknown member, refused with the nearest known one (`unknown-key`).
function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  let before = prev;
  for (let i = 1; i <= a.length; i++) {
    let cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      // two letters swapped is one slip, not two
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        cur[j] = Math.min(cur[j], before[j - 2] + 1);
      }
    }
    before = prev;
    prev = cur;
  }
  return prev[b.length];
}

// Whether every letter of `a` appears in `b`, in order.
function isSubsequence(a: string, b: string): boolean {
  let i = 0;
  for (let c of b) if (c === a[i]) i++;
  return i === a.length;
}
// The known member nearest an unknown one, when it is close enough to be a
// slip ("ordr" for "order"); undefined otherwise.
export function nearestMember(
  key: string,
  known: readonly string[],
): string | undefined {
  // a very long name is no slip of the keyboard
  if (key.length > 100) return undefined;
  // the nearest by edit distance; on a tie, the one with the same letters,
  // then the one that holds every letter
  // written (a dropped letter) or that every letter written holds (an extra
  // one), then the one that starts alike, then the order `known` gives
  let k0 = key.toLowerCase();
  let nearest = [...known]
    .map((k, order) => {
      let kl = k.toLowerCase();
      return {
        k,
        d: editDistance(kl, k0),
        // the same letters in another order: a swap
        anagram: [...kl].sort().join('') === [...k0].sort().join('') ? 0 : 1,
        contains: isSubsequence(k0, kl) || isSubsequence(kl, k0) ? 0 : 1,
        start: kl[0] === k0[0] ? 0 : 1,
        order,
      };
    })
    .sort(
      (a, b) =>
        a.d - b.d ||
        a.anagram - b.anagram ||
        a.contains - b.contains ||
        a.start - b.start ||
        a.order - b.order,
    )[0];
  return nearest && nearest.d <= Math.max(2, Math.floor(key.length / 3))
    ? nearest.k
    : undefined;
}
// `known` lists the members to suggest, in the order to prefer them on a
// tie; `what` names the kind of member ("facet member").
function unknownMember(
  where: string,
  key: string,
  known: readonly string[],
  what = 'member',
): InvalidQueryError {
  let near = nearestMember(key, known);
  let hint = near
    ? `; did you mean "${near}"?`
    : ` (known: ${known.join(', ')})`;
  return new InvalidQueryError(
    `${where}: unknown ${what} "${key.slice(0, 80)}"${hint}`,
    'unknown-key',
  );
}
// `always`: the member set is a feature's, read strictly in both spellings,
// since no query was ever saved with a member it ignored.
function assertKnownMembers(
  value: Record<string, unknown>,
  known: readonly string[],
  pointer: string[],
  always = false,
) {
  if (readingOlderSpelling && !always) return;
  for (let key of Object.keys(value)) {
    if (!known.includes(key)) {
      throw unknownMember(pointer.join('/') || '/', key, known);
    }
  }
}

// What a sort entry may hold, in either spelling, for the nearest name.
const SORT_ENTRY_HINTS = grammarHints('sortEntry');

function assertSortExpression(
  sort: any,
  pointer: string[],
): asserts sort is Query['sort'] {
  if (typeof sort !== 'object' || sort == null) {
    throw new InvalidQueryError(
      `${pointer.join('/') || '/'}: missing sort object`,
      'missing-member',
    );
  }
  if (!('by' in sort)) {
    // In the newer spelling a misspelled member is named as the slip it is.
    let stray = readingOlderSpelling
      ? undefined
      : Object.keys(sort).find((k) => !SORT_ENTRY_HINTS.includes(k));
    if (stray !== undefined) {
      throw unknownMember(
        pointer.join('/') || '/',
        stray,
        SORT_ENTRY_HINTS,
        'sort member',
      );
    }
    throw new InvalidQueryError(
      `${pointer.concat('by').join('/') || '/'}: missing by object`,
      'missing-member',
    );
  }
  if (typeof sort.by !== 'string') {
    throw new InvalidQueryError(
      `${pointer.concat('by').join('/') || '/'}: by must be a string`,
      'invalid-value',
    );
  }
  if (sort.by === WHEN_SIGNAL_KEY) {
    throw new InvalidQueryError(
      `${pointer.join('/') || '/'}: a boost ranks only inside a blend`,
      'invalid-nesting',
    );
  }
  // Every sort entry carries a direction, whether or not it names a type: a
  // general sort field is anchored by the column it maps to rather than by
  // `on`, so it takes the same `asc`/`desc` constraint. Checked ahead of the
  // branching below so neither shape can reach a `return` with it unchecked.
  if ('missing' in sort) {
    let m = (sort as { missing?: unknown }).missing;
    if (m !== 'first' && m !== 'last') {
      throw new InvalidQueryError(
        `${pointer.concat('missing').join('/') || '/'}: missing is 'first' or 'last'`,
        'invalid-value',
      );
    }
  }
  if ('direction' in sort) {
    if (sort.direction !== 'asc' && sort.direction !== 'desc') {
      throw new InvalidQueryError(
        `${
          pointer.concat('direction').join('/') || '/'
        }: direction must be either 'asc' or 'desc'`,
        'invalid-value',
      );
    }
  }

  if (isRelevanceSort(sort)) {
    assertRelevanceSort(sort, pointer);
    return;
  }

  if (isExprSort(sort)) {
    for (let key of Object.keys(sort)) {
      if (!['by', 'expr', 'on', 'direction', 'weight'].includes(key)) {
        throw unknownMember(
          pointer.join('/') || '/',
          key,
          ['expression', 'direction', 'weight', 'top', 'compare', 'on'],
          'expression sort member',
        );
      }
    }
    if (typeof (sort as any).expr !== 'string') {
      throw new InvalidQueryError(
        `${pointer.concat('expr').join('/') || '/'}: expr must be a formula, such as "rating / LN(priceMin + 1)"`,
        'invalid-value',
      );
    }
    if ('on' in sort) {
      assertCardType((sort as any).on, pointer.concat('on'));
    }
    assertQueryExpressionProfile(
      pointer.concat('expr').join('/') || 'expr',
      (sort as any).expr,
    );
    exprSortSql((sort as any).expr);
    return;
  }

  if (isNearSort(sort)) {
    if (!('on' in sort)) {
      throw new InvalidQueryError(
        `${pointer.concat('on').join('/') || '/'}: a near sort needs an on object naming the card type whose field it ranks by`,
        'needs-type',
      );
    }
    // a near sort is a feature of its own: strict in both spellings
    assertKnownMembers(
      sort,
      ['by', 'on', 'near', 'direction', 'weight'],
      pointer,
      true,
    );
    assertCardType(sort.on, pointer.concat('on'));
    assertNearTarget(sort.near, pointer.concat('near'));
    return;
  }

  if (isBlendSort(sort)) {
    assertBlendSort(sort, pointer);
    return;
  }

  // A relevance sort needs no `on` and ignores one, though a present `on`
  // must still be a well-formed ref.
  if (isMatchRelevanceSort(sort)) {
    assertKnownMembers(sort, ['by', 'on', 'direction', 'weight'], pointer);
    if ('on' in sort) {
      assertCardType(sort.on, pointer.concat('on'));
    }
    return;
  }
  assertKnownMembers(
    sort,
    ['by', 'on', 'direction', 'missing', 'weight'],
    pointer,
  );
  if (!('on' in sort)) {
    if (Object.keys(generalSortFields).includes(sort.by)) {
      return;
    }
    throw new InvalidQueryError(
      `${pointer.concat('on').join('/') || '/'}: missing on object: "${sort.by}" is a card field, so the query must name its type (a top-level "type", or "on" on the filter or this entry)`,
      'sort-needs-type',
    );
  }
  assertCardType(sort.on, pointer.concat('on'));
}

function assertRelevanceSort(sort: any, pointer: string[]) {
  let where = pointer.join('/') || '/';
  if ('on' in sort) {
    assertCardType(sort.on, pointer.concat('on'));
  }
  if ('near' in sort && sort.near != null) {
    assertNearTarget(sort.near, pointer.concat('near'));
  }
  if ('weights' in sort) {
    let weights = sort.weights;
    if (
      typeof weights !== 'object' ||
      weights == null ||
      Array.isArray(weights)
    ) {
      throw new InvalidQueryError(
        `${where}/weights: weights must be an object of signal weights`,
        'invalid-value',
      );
    }
    for (let [signal, weight] of Object.entries(weights)) {
      if (!(RELEVANCE_SIGNALS as readonly string[]).includes(signal)) {
        throw new InvalidQueryError(
          `${where}/weights/${signal}: unknown signal (expected one of ${RELEVANCE_SIGNALS.join(', ')})`,
          'unknown-key',
        );
      }
      if (typeof weight !== 'number' || !Number.isFinite(weight)) {
        throw new InvalidQueryError(
          `${where}/weights/${signal}: a weight must be a finite number`,
          'invalid-value',
        );
      }
    }
  }
  for (let key of Object.keys(sort)) {
    if (!['by', 'on', 'near', 'weights', 'direction'].includes(key)) {
      throw unknownMember(
        where,
        key,
        ['relevance', 'on', 'near', 'direction'],
        'relevance sort member',
      );
    }
  }
}

// What a blend takes, as the request grammar spells it (`blend` is the
// engine's `of`), and the near misses that name another member.
const BLEND_MEMBERS = grammarMembers('blend');
const BLEND_MEMBER_ALIASES: Record<string, string> = {
  fusion: 'method',
  fuse: 'method',
  signals: 'blend',
};

function assertBlendSort(sort: any, pointer: string[]) {
  let where = pointer.join('/') || '/';
  for (let key of Object.keys(sort)) {
    if (!['by', 'of', 'method', 'k', 'direction'].includes(key)) {
      let near =
        (hasOwn(BLEND_MEMBER_ALIASES, key.toLowerCase())
          ? BLEND_MEMBER_ALIASES[key.toLowerCase()]
          : undefined) ?? nearestMember(key, BLEND_MEMBERS);
      throw new InvalidQueryError(
        `${where}: unknown blend member "${key.slice(0, 80)}"${near ? `; did you mean "${near}"?` : ''} (a blend takes ${BLEND_MEMBERS.join(', ')})`,
        'unknown-key',
      );
    }
  }
  if (!Array.isArray(sort.of) || sort.of.length === 0) {
    throw new InvalidQueryError(
      `${where}/of: a blend needs an array of the sort entries to fuse`,
      'missing-member',
    );
  }
  if (sort.of.length > MAX_BLEND_COMPONENTS) {
    throw new InvalidQueryError(
      `${where}/of: a blend fuses at most ${MAX_BLEND_COMPONENTS} signals, and this one has ${sort.of.length}; past the limit: ${sort.of
        .slice(MAX_BLEND_COMPONENTS)
        .map((e: any) =>
          e?.by === EXPR_SORT_KEY
            ? `formula "${e.expr}"`
            : `"${String(e?.by ?? 'a signal').replace(/^_/, '')}"`,
        )
        .join(', ')}`,
      'limit-exceeded',
    );
  }
  if ('method' in sort && sort.method !== 'rrf') {
    throw new InvalidQueryError(
      `${where}/method: a blend supports method "rrf" (reciprocal rank fusion)`,
      'invalid-value',
    );
  }
  if (
    'k' in sort &&
    !(Number.isInteger(sort.k) && sort.k >= 1 && sort.k <= MAX_BLEND_K)
  ) {
    throw new InvalidQueryError(
      `${where}/k: k must be a whole number from 1 to ${MAX_BLEND_K.toLocaleString('en-US')}`,
      'invalid-value',
    );
  }
  if ('on' in sort) {
    throw new InvalidQueryError(
      `${where}: a blend takes no "on"; put "on" on its signals`,
      'conflicting-members',
    );
  }
  sort.of.forEach((component: any, i: number) => {
    let at = pointer.concat('of', String(i));
    if (
      typeof component !== 'object' ||
      component == null ||
      Array.isArray(component)
    ) {
      throw new InvalidQueryError(
        `${at.join('/')}: a blend signal is a sort entry, such as { by: "rating" }`,
        'missing-member',
      );
    }
    if (isBlendSort(component) || 'blend' in component) {
      throw new InvalidQueryError(
        `${at.join('/')}: a blend cannot contain another blend`,
        'invalid-nesting',
      );
    }
    if (component && isRelevanceSort(component)) {
      throw new InvalidQueryError(
        `${at.join('/')}: a blend cannot contain a relevance sort, which is itself a blend`,
        'invalid-nesting',
      );
    }
    if (
      component &&
      'weight' in component &&
      !(
        typeof component.weight === 'number' &&
        Number.isFinite(component.weight) &&
        component.weight !== 0
      )
    ) {
      throw new InvalidQueryError(
        `${at.join('/')}/weight: weight must be a nonzero number (a negative weight inverts the signal)`,
        'invalid-value',
      );
    }
    if (component && component.by === WHEN_SIGNAL_KEY) {
      for (let key of Object.keys(component)) {
        if (!['by', 'when', 'weight'].includes(key)) {
          throw unknownMember(
            at.join('/'),
            key,
            ['boost', 'weight'],
            'boost member',
          );
        }
      }
      if (typeof component.when !== 'object' || component.when == null) {
        throw new InvalidQueryError(
          `${at.join('/')}/when: a boost needs a filter`,
          'missing-member',
        );
      }
      assertFilter(component.when, at.concat('when'));
      return;
    }
    assertSortExpression(component, at);
  });
}

function assertNearTarget(near: any, pointer: string[]) {
  let where = pointer.join('/') || '/';
  if (Array.isArray(near)) {
    if (near.length < 1 || near.length > MAX_VECTOR_DIMENSIONS) {
      throw new InvalidQueryError(
        `${where}: near must have from 1 to ${MAX_VECTOR_DIMENSIONS} components`,
        'limit-exceeded',
      );
    }
    if (!near.every((c) => typeof c === 'number' && Number.isFinite(c))) {
      throw new InvalidQueryError(
        `${where}: near must be an array of finite numbers`,
        'invalid-value',
      );
    }
    if (near.some((c) => Math.abs(c) > MAX_VECTOR_COMPONENT)) {
      throw new InvalidQueryError(
        `${where}: a vector component is at most ${MAX_VECTOR_COMPONENT.toLocaleString('en-US')} in size`,
        'invalid-value',
      );
    }
    return;
  }
  if (!isVector(near)) {
    throw new InvalidQueryError(
      `${where}: near must be an array of numbers or a vector ({ dims, encoding, scale?, data })`,
      'invalid-value',
    );
  }
}

function assertPage(
  page: any,
  pointer: string[],
): asserts page is Query['page'] {
  if (typeof page !== 'object' || page == null || Array.isArray(page)) {
    throw new InvalidQueryError(
      `${pointer.join('/') || '/'}: page must be an object, such as { size: 20, number: 0 }`,
      'invalid-page',
    );
  }

  assertKnownMembers(page, PAGE_MEMBERS, pointer);
  if (
    'total' in page &&
    !(PAGE_TOTAL_MODES as readonly unknown[]).includes(page.total)
  ) {
    throw new InvalidQueryError(
      `${pointer.concat('total').join('/') || '/'}: total is one of ${PAGE_TOTAL_MODES.join(', ')}`,
      'invalid-page',
    );
  }
  if ('exactTotal' in page && typeof page.exactTotal !== 'boolean') {
    throw new InvalidQueryError(
      `${pointer.concat('exactTotal').join('/') || '/'}: exactTotal is true or false`,
      'invalid-page',
    );
  }
  // size 0 asks for counts and facets only
  if ('size' in page) {
    // a string is read as the whole number it spells, digits only
    let size =
      typeof page.size === 'number'
        ? page.size
        : typeof page.size === 'string' && /^-?\d+$/.test(page.size)
          ? Number(page.size)
          : NaN;
    if (
      !Number.isInteger(size) ||
      // a negative size is clamped to the default, as it always was
      (size < 0 && !readingOlderSpelling)
    ) {
      throw new InvalidQueryError(
        `${pointer.concat('size').join('/') || '/'}: size must be a whole number, 0 or more`,
        'invalid-page',
      );
    }
  }
  if ('number' in page) {
    // a string is read as the whole number it spells, digits only
    let number =
      typeof page.number === 'number'
        ? page.number
        : typeof page.number === 'string' && /^-?\d+$/.test(page.number)
          ? Number(page.number)
          : NaN;
    if (!Number.isInteger(number) || number < 0 || number > MAX_PAGE_NUMBER) {
      throw new InvalidQueryError(
        `${pointer.concat('number').join('/') || '/'}: number is a 0-based page number, at most ${MAX_PAGE_NUMBER.toLocaleString('en-US')}`,
        'invalid-page',
      );
    }
  }
}

// Maps each filter operator to its validator. `assertFilter` derives both
// the operator list and its dispatch from this one map, so an operator cannot
// be recognized by one without the other.
// Keyed by the grammar's operators (query-grammar.ts), in the canonical
// operator order `filterOperators` reports them in.
const FILTER_OPERATOR_ASSERTS: Record<
  FilterOperatorName,
  (filter: any, pointer: string[]) => void
> = {
  any: assertAnyFilter,
  every: assertEveryFilter,
  not: assertNotFilter,
  eq: assertEqFilter,
  in: assertInFilter,
  contains: assertContainsFilter,
  range: assertRangeFilter,
  matches: assertMatchesFilter,
  near: assertNearFilter,
  linkedFrom: assertLinkedFromFilter,
  pattern: (filter, pointer) =>
    assertStringKeyedFilter(filter, pointer, 'pattern'),
  regex: (filter, pointer) => assertStringKeyedFilter(filter, pointer, 'regex'),
};

function assertLinkedFromFilter(filter: any, pointer: string[]) {
  let at = pointer.concat('linkedFrom').join('/') || '/';
  let v = filter.linkedFrom;
  if (typeof v !== 'object' || v == null || Array.isArray(v)) {
    throw new InvalidQueryError(
      `${at}: linkedFrom must be { card, field }`,
      'invalid-value',
    );
  }
  for (let key of Object.keys(v)) {
    if (key !== 'card' && key !== 'field') {
      throw unknownMember(
        at,
        key,
        grammarMembers('linkedFrom'),
        'linkedFrom member',
      );
    }
  }
  if (typeof v.card !== 'string' || !/^https?:\/\//.test(v.card)) {
    throw new InvalidQueryError(
      `${at}/card: card must be an absolute card URL`,
      'invalid-value',
    );
  }
  if (
    typeof v.field !== 'string' ||
    !/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(v.field)
  ) {
    throw new InvalidQueryError(
      `${at}/field: field must name a link field of that card, such as "items"`,
      'invalid-value',
    );
  }
}

function assertStringKeyedFilter(
  filter: any,
  pointer: string[],
  operator: 'pattern' | 'regex',
) {
  let at = pointer.concat(operator);
  let value = filter[operator];
  if (typeof value !== 'object' || value == null || Array.isArray(value)) {
    throw new InvalidQueryError(
      `${at.join('/') || '/'}: ${operator} must be an object of field paths`,
      'invalid-value',
    );
  }
  let entries = Object.entries(value);
  if (entries.length === 0) {
    throw new InvalidQueryError(
      `${at.join('/') || '/'}: ${operator} needs a field`,
      'missing-member',
    );
  }
  for (let [key, v] of entries) {
    assertKey(key, at);
    if (typeof v !== 'string' || v === '') {
      throw new InvalidQueryError(
        `${at.concat(key).join('/')}: a ${operator} must be a non-empty string`,
        'invalid-value',
      );
    }
  }
}

const FILTER_OPERATORS = Object.keys(
  FILTER_OPERATOR_ASSERTS,
) as FilterOperatorName[];

// The operator keys present on a filter node, in the canonical operator
// order. Exactly one is legal; the client-side matcher consults this too
// (`isClientEvaluable`), so both sides read the same list.
export function filterOperators(filter: object): string[] {
  return FILTER_OPERATORS.filter((key) => key in filter);
}

// The operator validators below report a failure by throwing and return
// nothing on success, so a collection of them is walked with `forEach`.
// `every` reads each callback's `undefined` as false and stops, which would
// check a collection's first entry and silently accept the rest.
function assertFilter(
  filter: any,
  pointer: string[],
): asserts filter is Filter {
  if (typeof filter !== 'object' || filter == null) {
    throw new InvalidQueryError(
      `${pointer.join('/') || '/'}: missing filter object`,
      'missing-member',
    );
  }
  if (Array.isArray(filter)) {
    throw new InvalidQueryError(
      `${pointer.join('/') || '/'}: a filter is an object, not a list; to combine filters, put them under every or any`,
      'invalid-value',
    );
  }

  if ('type' in filter) {
    assertCardType(filter.type, pointer.concat('type'));
    if (isEqual(Object.keys(filter), ['type'])) {
      return; // This is a pure card type filter
    }
  }

  if ('on' in filter) {
    assertCardType(filter.on, pointer.concat('on'));
  }

  // Each consumer — this validator, the SQL compiler (`filterCondition`) and
  // the client-side matcher — picks a single operator from a node in its own
  // order, so a node carrying several would be read differently by each. All
  // three reject it, the engine through its own backstop for the
  // query-backed-field path that never reaches this validator, so they agree by
  // construction. Only `type`/`on` may sit beside one operator.
  if ('typeahead' in filter) {
    throw typeAheadRefusal(pointer);
  }
  let operators = filterOperators(filter);
  if (operators.length > 1) {
    throw new InvalidQueryError(
      `${pointer.join('/') || '/'}: a filter may use only one operator, but found ${operators
        .map((key) => `"${key}"`)
        .join(', ')}; combine operators by nesting them under "every" or "any"`,
      'conflicting-members',
    );
  }

  let operator = operators[0];
  for (let key of Object.keys(filter)) {
    if (
      key !== operator &&
      !FILTER_MODIFIERS.includes(key) &&
      // the older spelling ignores a member it does not know, but a node
      // with no operator at all is refused, naming what it holds instead
      (!readingOlderSpelling || !operator)
    ) {
      throw unknownMember(pointer.join('/') || '/', key, FILTER_MEMBER_HINTS);
    }
  }
  if ('fields' in filter && operator !== 'matches') {
    throw new InvalidQueryError(
      `${pointer.concat('fields').join('/') || '/'}: fields belongs beside matches`,
      'conflicting-members',
    );
  }
  if ('within' in filter && operator !== 'matches') {
    throw new InvalidQueryError(
      `${pointer.concat('within').join('/') || '/'}: within belongs beside matches`,
      'conflicting-members',
    );
  }
  if ('prefix' in filter && operator !== 'matches') {
    throw new InvalidQueryError(
      `${pointer.concat('prefix').join('/') || '/'}: prefix belongs beside matches`,
      'conflicting-members',
    );
  }
  if ('typos' in filter && operator !== 'matches') {
    throw new InvalidQueryError(
      `${pointer.concat('typos').join('/') || '/'}: typos belongs beside matches`,
      'conflicting-members',
    );
  }
  if ('scope' in filter && operator !== 'matches') {
    throw new InvalidQueryError(
      `${pointer.concat('scope').join('/') || '/'}: scope belongs beside matches`,
      'conflicting-members',
    );
  }
  if (!operator) {
    throw new InvalidQueryError(
      `${pointer.join('/') || '/'}: a filter needs an operator (eq, contains, range, matches, every, any, not, …)`,
      'missing-member',
    );
  }
  FILTER_OPERATOR_ASSERTS[operator as FilterOperatorName](filter, pointer);
}

// What may sit beside a filter's one operator: its type anchor and the
// options that belong to `matches` (and the engine's own annotations).
const FILTER_MODIFIERS = grammarMembers('filter', (m) => m.role === 'modifier');
// The names a misspelled filter member is matched against: the operators
// (with the newer spelling's `exists` and `missing`), then the options an
// author writes; the engine's own annotations are never suggested.
const FILTER_MEMBER_HINTS = grammarHints('filter');

function assertCardType(type: any, pointer: string[]) {
  if (!isCodeRef(type)) {
    throw new InvalidQueryError(
      `${pointer.join('/') || '/'}: type is not valid`,
      'invalid-type',
    );
  }
  // An empty module passes the shape check but cannot be resolved, so the
  // engine throws on it in every realm the query reaches. A model that fills
  // every schema property sends `{ module: '', name: '' }` for a type it does
  // not mean to set; naming the key tells it to leave the key out.
  if (!('type' in type) && (type.module === '' || type.name === '')) {
    throw new InvalidQueryError(
      `${pointer.join('/') || '/'}: module and name must not be empty; omit the key when you do not filter by it`,
      'invalid-type',
    );
  }
  // A module no realm can resolve: not an identifier (`https://…`,
  // `@scope/…`) and not a reference a caller resolves against its own
  // module (`./`, `../`, `$REALM/`).
  if (
    !('type' in type) &&
    !(
      /^https?:\/\/[^/]/.test(type.module) ||
      // prefix form names a scope and a package: `@scope/name/…`
      (isAbsoluteIdentifier(type.module) && /^@[^/]+\/[^/]+/.test(type.module))
    ) &&
    !/^(\.\.?\/|\$REALM\/)/.test(type.module)
  ) {
    throw new InvalidQueryError(
      `${pointer.join('/') || '/'}: module "${String(type.module).slice(0, 80)}" names no module; write its URL or its @scope/… identifier`,
      'invalid-type',
    );
  }
}

function assertAnyFilter(
  filter: any,
  pointer: string[],
): asserts filter is AnyFilter {
  if (typeof filter !== 'object' || filter == null) {
    throw new InvalidQueryError(
      `${pointer.join('/') || '/'}: filter must be an object`,
      'invalid-value',
    );
  }
  let anyPointer = pointer.concat('any');
  if (!('any' in filter)) {
    throw new InvalidQueryError(
      `${anyPointer.join('/') || '/'}: AnyFilter must have any property`,
      'missing-member',
    );
  }

  if (!Array.isArray(filter.any)) {
    throw new InvalidQueryError(
      `${anyPointer.join('/') || '/'}: any must be an array of Filters`,
      'invalid-value',
    );
  } else {
    filter.any.forEach((value: any, index: number) => {
      assertFilter(value, anyPointer.concat(`[${index}]`));
    });
  }
}

function assertEveryFilter(
  filter: any,
  pointer: string[],
): asserts filter is EveryFilter {
  if (typeof filter !== 'object' || filter == null) {
    throw new InvalidQueryError(
      `${pointer.join('/') || '/'}: filter must be an object`,
      'invalid-value',
    );
  }
  let everyPointer = pointer.concat('every');
  if (!('every' in filter)) {
    throw new InvalidQueryError(
      `${everyPointer.join('/') || '/'}: EveryFilter must have every property`,
      'missing-member',
    );
  }

  if (!Array.isArray(filter.every)) {
    throw new InvalidQueryError(
      `${everyPointer.join('/') || '/'}: every must be an array of Filters`,
      'invalid-value',
    );
  } else {
    filter.every.forEach((value: any, index: number) => {
      assertFilter(value, everyPointer.concat(`[${index}]`));
    });
  }
}

function assertNotFilter(
  filter: any,
  pointer: string[],
): asserts filter is NotFilter {
  if (typeof filter !== 'object' || filter == null) {
    throw new InvalidQueryError(
      `${pointer.join('/') || '/'}: filter must be an object`,
      'invalid-value',
    );
  }
  let notPointer = pointer.concat('not');
  if (!('not' in filter)) {
    throw new InvalidQueryError(
      `${notPointer.join('/') || '/'}: NotFilter must have not property`,
      'missing-member',
    );
  }

  assertFilter(filter.not, notPointer);
}

function assertEqFilter(
  filter: any,
  pointer: string[],
): asserts filter is EqFilter {
  if (typeof filter !== 'object' || filter == null) {
    throw new InvalidQueryError(
      `${pointer.join('/') || '/'}: filter must be an object`,
      'invalid-value',
    );
  }
  let eqPointer = pointer.concat('eq');
  if (!('eq' in filter)) {
    throw new InvalidQueryError(
      `${eqPointer.join('/') || '/'}: EqFilter must have eq property`,
      'missing-member',
    );
  }
  if (
    typeof filter.eq !== 'object' ||
    filter.eq == null ||
    Array.isArray(filter.eq)
  ) {
    throw new InvalidQueryError(
      `${eqPointer.join('/') || '/'}: eq must be an object keyed by field paths, not ${Array.isArray(filter.eq) ? 'a list' : JSON.stringify(filter.eq)}`,
      'invalid-value',
    );
  }
  Object.entries(filter.eq).forEach(([key, value]) => {
    assertKey(key, eqPointer);
    assertJSONValue(value, eqPointer.concat(key));
  });
}

function assertInFilter(
  filter: any,
  pointer: string[],
): asserts filter is InFilter {
  if (typeof filter !== 'object' || filter == null) {
    throw new InvalidQueryError(
      `${pointer.join('/') || '/'}: filter must be an object`,
      'invalid-value',
    );
  }
  let inPointer = pointer.concat('in');
  if (!('in' in filter)) {
    throw new InvalidQueryError(
      `${inPointer.join('/') || '/'}: InFilter must have in property`,
      'missing-member',
    );
  }
  if (
    typeof filter.in !== 'object' ||
    filter.in == null ||
    Array.isArray(filter.in)
  ) {
    throw new InvalidQueryError(
      `${inPointer.join('/') || '/'}: in must be an object keyed by field paths, not ${Array.isArray(filter.in) ? 'a list' : JSON.stringify(filter.in)}`,
      'invalid-value',
    );
  }
  Object.entries(filter.in).forEach(([key, value]) => {
    assertKey(key, inPointer);
    if (!Array.isArray(value)) {
      throw new InvalidQueryError(
        `${inPointer.concat(key).join('/') || '/'}: in values must be arrays`,
        'invalid-value',
      );
    }
    let maxIn = readingOlderSpelling ? MAX_OLDER_IN_VALUES : MAX_IN_VALUES;
    if (value.length > maxIn) {
      throw new InvalidQueryError(
        `${inPointer.concat(key).join('/') || '/'}: an in list holds at most ${maxIn.toLocaleString('en-US')} values, and this one has ${value.length.toLocaleString('en-US')}`,
        'limit-exceeded',
      );
    }
    value.forEach((item, index) => {
      assertJSONValue(item, inPointer.concat(key, `[${index}]`));
    });
  });
}

function assertContainsFilter(
  filter: any,
  pointer: string[],
): asserts filter is ContainsFilter {
  if (typeof filter !== 'object' || filter == null) {
    throw new InvalidQueryError(
      `${pointer.join('/') || '/'}: filter must be an object`,
      'invalid-value',
    );
  }
  let containsPointer = pointer.concat('contains');
  if (!('contains' in filter)) {
    throw new InvalidQueryError(
      `${containsPointer.join('/') || '/'}: ContainsFilter must have contains property`,
      'missing-member',
    );
  }
  if (
    typeof filter.contains !== 'object' ||
    filter.contains == null ||
    Array.isArray(filter.contains)
  ) {
    throw new InvalidQueryError(
      `${containsPointer.join('/') || '/'}: contains must be an object keyed by field paths, not ${Array.isArray(filter.contains) ? 'a list' : JSON.stringify(filter.contains)}`,
      'invalid-value',
    );
  }
  Object.entries(filter.contains).forEach(([key, value]) => {
    assertKey(key, containsPointer);
    assertJSONValue(value, containsPointer.concat(key));
  });
}

function assertRangeFilter(
  filter: any,
  pointer: string[],
): asserts filter is RangeFilter {
  if (typeof filter !== 'object' || filter == null) {
    throw new InvalidQueryError(
      `${pointer.join('/') || '/'}: filter must be an object`,
      'invalid-value',
    );
  }
  let rangePointer = pointer.concat('range');
  if (!('range' in filter)) {
    throw new InvalidQueryError(
      `${rangePointer.join('/') || '/'}: RangeFilter must have range property`,
      'missing-member',
    );
  }
  if (
    typeof filter.range !== 'object' ||
    filter.range == null ||
    Array.isArray(filter.range)
  ) {
    throw new InvalidQueryError(
      `${rangePointer.join('/') || '/'}: range must be an object keyed by field paths, not ${Array.isArray(filter.range) ? 'a list' : JSON.stringify(filter.range)}`,
      'invalid-value',
    );
  }
  Object.entries(filter.range).forEach(([fieldPath, constraints]) => {
    let innerPointer = [...rangePointer, fieldPath];
    if (typeof constraints !== 'object' || constraints == null) {
      throw new InvalidQueryError(
        `${innerPointer.join('/') || '/'}: range constraint must be an object`,
        'invalid-value',
      );
    }
    Object.entries(constraints).forEach(([key, value]) => {
      switch (key) {
        case 'gt':
        case 'gte':
        case 'lt':
        case 'lte':
          assertJSONPrimitive(value, innerPointer.concat(key));
          if (value === null || typeof value === 'boolean') {
            throw new InvalidQueryError(
              `${innerPointer.concat(key).join('/')}: a range bound is a number, a date or text, not ${String(value)}`,
              'invalid-value',
            );
          }
          return;
        default:
          throw unknownMember(
            innerPointer.join('/') || '/',
            key,
            grammarMembers('rangeBound'),
            'range bound',
          );
      }
    });
  });
}

function assertMatchesFilter(
  filter: any,
  pointer: string[],
): asserts filter is MatchesFilter {
  if (typeof filter !== 'object' || filter == null) {
    throw new InvalidQueryError(
      `${pointer.join('/') || '/'}: filter must be an object`,
      'invalid-value',
    );
  }
  let matchesPointer = pointer.concat('matches');
  if (!('matches' in filter)) {
    throw new InvalidQueryError(
      `${matchesPointer.join('/') || '/'}: MatchesFilter must have matches property`,
      'missing-member',
    );
  }
  if (typeof filter.matches !== 'string') {
    throw new InvalidQueryError(
      `${matchesPointer.join('/') || '/'}: matches must be a string`,
      'invalid-value',
    );
  }
  assertTextTermLength(filter.matches, matchesPointer, 'matches');
  if (
    'within' in filter &&
    (typeof filter.within !== 'string' ||
      !/^[A-Za-z_$][\w$]*$/.test(filter.within))
  ) {
    throw new InvalidQueryError(
      `${pointer.concat('within').join('/') || '/'}: within must name a top-level passage list field, such as "segments"`,
      'invalid-value',
    );
  }
  if ('prefix' in filter && typeof filter.prefix !== 'boolean') {
    throw new InvalidQueryError(
      `${pointer.concat('prefix').join('/') || '/'}: prefix must be a boolean`,
      'invalid-value',
    );
  }
  if ('typos' in filter && typeof filter.typos !== 'boolean') {
    throw new InvalidQueryError(
      `${pointer.concat('typos').join('/') || '/'}: typos must be a boolean`,
      'invalid-value',
    );
  }
  for (let internal of ['typoQuery', 'typoPartial']) {
    if (internal in filter) {
      throw new InvalidQueryError(
        `${pointer.concat(internal).join('/') || '/'}: ${internal} is set by the engine`,
        'engine-only',
      );
    }
  }
  if ('scope' in filter && filter.scope !== 'title') {
    throw new InvalidQueryError(
      `${pointer.concat('scope').join('/') || '/'}: scope must be "title"`,
      'invalid-value',
    );
  }
  if ('scope' in filter && 'within' in filter) {
    throw new InvalidQueryError(
      `${pointer.join('/') || '/'}: a matches term takes scope or within, not both`,
      'conflicting-members',
    );
  }
  if ('fields' in filter) {
    if (
      !Array.isArray(filter.fields) ||
      filter.fields.length === 0 ||
      !filter.fields.every(
        (f: unknown) => typeof f === 'string' && FACET_PATH.test(f),
      )
    ) {
      throw new InvalidQueryError(
        `${pointer.concat('fields').join('/') || '/'}: fields must list 1 to 8 field paths, such as ["material", "brand.name"]`,
        'invalid-value',
      );
    }
    if (filter.fields.length > 8) {
      throw new InvalidQueryError(
        `${pointer.concat('fields').join('/') || '/'}: fields lists at most 8 field paths, and this one has ${filter.fields.length}`,
        'limit-exceeded',
      );
    }
    if ('scope' in filter || 'within' in filter || 'prefix' in filter) {
      throw new InvalidQueryError(
        `${pointer.join('/') || '/'}: a matches term with fields takes no scope, within or prefix`,
        'conflicting-members',
      );
    }
  }
}

const FACET_PATH = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/;

function assertLetBindings(lets: any, pointer: string[]) {
  let where = pointer.join('/') || '/';
  if (typeof lets !== 'object' || lets == null || Array.isArray(lets)) {
    throw new InvalidQueryError(
      `${where}: let must map names to bindings`,
      'invalid-value',
    );
  }
  let names = Object.keys(lets);
  if (names.length === 0 || names.length > MAX_LET_BINDINGS) {
    throw new InvalidQueryError(
      `${where}: let takes 1 to ${MAX_LET_BINDINGS} bindings`,
      'limit-exceeded',
    );
  }
  for (let name of names) {
    let at = pointer.concat(name);
    let b = lets[name];
    if (RESERVED_BINDING_NAMES.has(name)) {
      throw new InvalidQueryError(
        `${at.join('/')}: "${name}" is reserved (${name === '$this' ? 'the card a query-backed field belongs to' : 'the escape for literal text, { "$literal": "…" }'}); name the binding otherwise`,
        'invalid-value',
      );
    }
    if (!BINDING_NAME.test(name)) {
      throw new InvalidQueryError(
        LET_NAME.test(name)
          ? `${at.join('/')}: a binding is declared with its $, as it is read: write "$${name}" (and read it as "$${name}" or "$${name}.path")`
          : `${at.join('/')}: a binding's name is $ then letters, digits and underscores, such as "$sofa"`,
        'invalid-value',
      );
    }
    if (typeof b !== 'object' || b == null || Array.isArray(b)) {
      throw new InvalidQueryError(
        `${at.join('/')}: a binding is { from, select }`,
        'invalid-value',
      );
    }
    for (let key of Object.keys(b)) {
      if (!BINDING_MEMBERS.includes(key)) {
        throw unknownMember(
          at.join('/'),
          key,
          BINDING_MEMBERS,
          'binding member',
        );
      }
    }
    if (isLogBinding(b)) {
      assertLogBinding(b, at);
      continue;
    }
    if ('one' in b) {
      if (b.one !== true || 'select' in b) {
        throw new InvalidQueryError(
          `${at.join('/')}: a binding is { from, select } for a list, or { from, one: true } for one card`,
          'invalid-value',
        );
      }
    } else if (typeof b.select !== 'string' || !FACET_PATH.test(b.select)) {
      throw new InvalidQueryError(
        `${at.concat('select').join('/')}: select must be a field path, such as "items.id"`,
        'invalid-value',
      );
    }
    let from = b.from;
    if (typeof from !== 'object' || from == null || Array.isArray(from)) {
      throw new InvalidQueryError(
        `${at.concat('from').join('/')}: from must be a query with a filter`,
        'invalid-value',
      );
    }
    for (let key of Object.keys(from)) {
      if (!grammarMembers('bindingQuery', isEngineForm).includes(key)) {
        throw unknownMember(
          at.concat('from').join('/'),
          key,
          grammarMembers('bindingQuery'),
          "binding's query member",
        );
      }
    }
    if (from.timeZone !== undefined) {
      assertTimeZone(from.timeZone, at.concat('from', 'timeZone').join('/'));
    }
    if (from.filter === undefined) {
      throw new InvalidQueryError(
        `${at.concat('from').join('/')}: from needs a filter`,
        'missing-member',
      );
    }
    if (
      from.page !== undefined &&
      (typeof from.page !== 'object' ||
        from.page == null ||
        Object.keys(from.page).some((k) => k !== 'size') ||
        !Number.isInteger(from.page.size) ||
        from.page.size < 1 ||
        from.page.size > MAX_LET_ROWS)
    ) {
      throw new InvalidQueryError(
        `${at.concat('from', 'page').join('/')}: page is { size } from 1 to ${MAX_LET_ROWS}`,
        'invalid-value',
      );
    }
    let inner: any = {
      filter: from.filter,
      ...(from.sort ? { sort: from.sort } : {}),
    };
    let nested = false;
    mapLetReferences(inner, (_f, _n, node) => {
      nested = true;
      return node;
    });
    mapCardReferences(inner, new Set(names), () => {
      nested = true;
      return null;
    });
    // a declared name read anywhere in it, a list where a value goes too
    if (letReferencesIn(inner).length > 0) nested = true;
    if (nested) {
      throw new InvalidQueryError(
        `${at.concat('from').join('/')}: a binding's query cannot use another binding`,
        'invalid-nesting',
      );
    }
    assertQuery(inner, at.concat('from'));
  }
}

// A binding read from a log: its shape here, its log query when it runs
// (`logBindingValues`, which refuses what the log grammar does not take).
function assertLogBinding(b: any, at: string[]) {
  let from = b.from;
  for (let key of Object.keys(from)) {
    if (!grammarMembers('logBinding').includes(key)) {
      throw unknownMember(
        at.concat('from').join('/'),
        key,
        grammarMembers('logBinding'),
        "log binding's member",
      );
    }
  }
  if ('one' in b) {
    throw new InvalidQueryError(
      `${at.join('/')}: a binding read from a log is a list: { from: { log, filter }, select }`,
      'invalid-value',
    );
  }
  if ('select' in b && 'select' in from) {
    throw new InvalidQueryError(
      `${at.join('/')}: select is written once, beside from or inside it`,
      'conflicting-members',
    );
  }
  let select = b.select ?? from.select;
  if (typeof select !== 'string' || !FACET_PATH.test(select)) {
    throw new InvalidQueryError(
      `${at.concat('select').join('/')}: select must be a path into the log's lines, such as "what.postUri"`,
      select === undefined ? 'missing-member' : 'invalid-value',
    );
  }
  if ('log' in from && 'logs' in from) {
    throw new InvalidQueryError(
      `${at.concat('from').join('/')}: from takes log (one log) or logs (several), not both`,
      'conflicting-members',
    );
  }
  if ('log' in from && typeof from.log !== 'string') {
    throw new InvalidQueryError(
      `${at.concat('from', 'log').join('/')}: log names a log file`,
      'invalid-value',
    );
  }
  if (
    from.filter !== undefined &&
    (typeof from.filter !== 'object' ||
      from.filter === null ||
      Array.isArray(from.filter))
  ) {
    throw new InvalidQueryError(
      `${at.concat('from', 'filter').join('/')}: a log filter is an object`,
      'invalid-value',
    );
  }
}

function assertCollapse(
  collapse: any,
  pointer: string[],
): asserts collapse is Collapse {
  let where = pointer.join('/') || '/';
  let shape =
    typeof collapse === 'string'
      ? { by: collapse }
      : typeof collapse === 'object' &&
          collapse != null &&
          !Array.isArray(collapse)
        ? collapse
        : undefined;
  if (!shape) {
    throw new InvalidQueryError(
      `${where}: collapse must be a field path or { by, on?, keep? }`,
      'invalid-value',
    );
  }
  for (let key of Object.keys(shape)) {
    if (!grammarMembers('collapse').includes(key)) {
      throw unknownMember(
        where,
        key,
        grammarMembers('collapse'),
        'collapse member',
      );
    }
  }
  if (typeof shape.by !== 'string' || !FACET_PATH.test(shape.by)) {
    throw new InvalidQueryError(
      `${where}/by: by must be a field path such as "productType" or "brand.name"`,
      'invalid-value',
    );
  }
  if (shape.on !== undefined) {
    assertCardType(shape.on, pointer.concat('on'));
  }
  if (
    shape.keep !== undefined &&
    (!Number.isInteger(shape.keep) ||
      shape.keep < 1 ||
      shape.keep > MAX_COLLAPSE_KEEP)
  ) {
    throw new InvalidQueryError(
      `${where}/keep: keep must be an integer from 1 to ${MAX_COLLAPSE_KEEP}`,
      'invalid-value',
    );
  }
}

function assertFacets(
  facets: any,
  pointer: string[],
): asserts facets is Facet[] {
  let where = pointer.join('/') || '/';
  if (!Array.isArray(facets)) {
    throw new InvalidQueryError(
      `${where}: facets must be an array`,
      'invalid-value',
    );
  }
  if (facets.length > MAX_FACETS) {
    throw new InvalidQueryError(
      `${where}: a query takes at most ${MAX_FACETS} facets`,
      'limit-exceeded',
    );
  }
  facets.forEach((facet, i) => {
    let at = `${where}[${i}]`;
    if (typeof facet !== 'object' || facet == null || Array.isArray(facet)) {
      throw new InvalidQueryError(
        `${at}: a facet must be an object`,
        'invalid-value',
      );
    }
    for (let key of Object.keys(facet)) {
      if (!FACET_MEMBERS.has(key)) {
        throw unknownMember(at, key, [...FACET_MEMBERS], 'facet member');
      }
    }
    assertFacetMembers(facet, at);
    if (typeof facet.by !== 'string' || !FACET_PATH.test(facet.by)) {
      throw new InvalidQueryError(
        `${at}/by: by must be a field path such as "category" or "speaker.name"`,
        'invalid-value',
      );
    }
    if (
      facet.size !== undefined &&
      (!Number.isInteger(facet.size) ||
        facet.size < 1 ||
        facet.size > MAX_FACET_SIZE)
    ) {
      throw new InvalidQueryError(
        `${at}/size: size must be an integer from 1 to ${MAX_FACET_SIZE}`,
        'invalid-value',
      );
    }
  });
  assertDistinctFacets(facets, where);
}

const FACET_MEMBERS = new Set(grammarMembers('facet'));

function assertFacetMembers(facet: any, at: string) {
  if (facet.own !== undefined && facet.own !== 'ignore') {
    throw new InvalidQueryError(
      `${at}/own: own must be "ignore"`,
      'invalid-value',
    );
  }
  for (let flag of ['stats', 'missing'] as const) {
    if (facet[flag] !== undefined && typeof facet[flag] !== 'boolean') {
      throw new InvalidQueryError(
        `${at}/${flag}: ${flag} must be a boolean`,
        'invalid-value',
      );
    }
  }
  if (facet.prefix !== undefined && typeof facet.prefix !== 'string') {
    throw new InvalidQueryError(
      `${at}/prefix: prefix must be a string`,
      'invalid-value',
    );
  }
  if (
    facet.order !== undefined &&
    facet.order !== 'count' &&
    facet.order !== 'value' &&
    facet.order !== 'measure'
  ) {
    throw new InvalidQueryError(
      `${at}/order: order must be "count", "value" or "measure"`,
      'invalid-value',
    );
  }
  if (facet.measure !== undefined) {
    let m = facet.measure;
    let keys =
      typeof m === 'object' && m != null && !Array.isArray(m)
        ? Object.keys(m)
        : [];
    if (
      keys.length !== 1 ||
      !(FACET_MEASURES as readonly string[]).includes(keys[0]) ||
      typeof m[keys[0]] !== 'string' ||
      !FACET_PATH.test(m[keys[0]])
    ) {
      throw new InvalidQueryError(
        `${at}/measure: measure must be one of ${FACET_MEASURES.map((k) => `{ ${k}: "<field>" }`).join(', ')}`,
        'invalid-value',
      );
    }
    if (facet.ranges !== undefined || facet.interval !== undefined) {
      throw new InvalidQueryError(
        `${at}/measure: measure counts values, so it takes no ranges or interval`,
        'conflicting-members',
      );
    }
  }
  if (facet.order === 'measure' && facet.measure === undefined) {
    throw new InvalidQueryError(
      `${at}/order: order "measure" needs a measure`,
      'missing-member',
    );
  }
  if (
    facet.interval !== undefined &&
    !(FACET_INTERVALS as readonly unknown[]).includes(facet.interval)
  ) {
    throw new InvalidQueryError(
      `${at}/interval: interval must be one of ${FACET_INTERVALS.join(', ')}`,
      'invalid-value',
    );
  }
  if (facet.ranges !== undefined) {
    if (facet.interval !== undefined) {
      throw new InvalidQueryError(
        `${at}: a facet takes ranges or interval, not both`,
        'conflicting-members',
      );
    }
    if (!Array.isArray(facet.ranges) || facet.ranges.length === 0) {
      throw new InvalidQueryError(
        `${at}/ranges: ranges must be a list of 1 to ${MAX_FACET_RANGES} buckets, such as [{ to: 10 }, { from: 10 }]`,
        'invalid-value',
      );
    }
    if (facet.ranges.length > MAX_FACET_RANGES) {
      throw new InvalidQueryError(
        `${at}/ranges: ranges lists at most ${MAX_FACET_RANGES} buckets, and this one has ${facet.ranges.length}`,
        'limit-exceeded',
      );
    }
    facet.ranges.forEach((range: any, j: number) => {
      let where = `${at}/ranges[${j}]`;
      if (typeof range !== 'object' || range == null || Array.isArray(range)) {
        throw new InvalidQueryError(
          `${where}: a range must be an object`,
          'invalid-value',
        );
      }
      for (let key of Object.keys(range)) {
        if (!grammarMembers('facetRange').includes(key)) {
          throw unknownMember(
            where,
            key,
            grammarMembers('facetRange'),
            'facet range member',
          );
        }
      }
      if (range.from === undefined && range.to === undefined) {
        throw new InvalidQueryError(
          `${where}: a range needs from or to`,
          'missing-member',
        );
      }
      for (let end of ['from', 'to'] as const) {
        let bound = range[end];
        if (
          bound !== undefined &&
          !(
            typeof bound === 'string' ||
            (typeof bound === 'number' && Number.isFinite(bound))
          )
        ) {
          throw new InvalidQueryError(
            `${where}/${end}: a bound must be a number or a string`,
            'invalid-value',
          );
        }
      }
      if (
        range.from !== undefined &&
        range.to !== undefined &&
        typeof range.from !== typeof range.to
      ) {
        throw new InvalidQueryError(
          `${where}: from and to must both be numbers or both be strings`,
          'conflicting-members',
        );
      }
      if (range.key !== undefined && typeof range.key !== 'string') {
        throw new InvalidQueryError(
          `${where}/key: key must be a string`,
          'invalid-value',
        );
      }
    });
  }
}

// A range bucket's label: its `key`, or "from-to" with `*` for an open end.
export function facetRangeLabel(range: FacetRange): string {
  return range.key ?? `${range.from ?? '*'}-${range.to ?? '*'}`;
}

// `typeahead` was an operator of earlier drafts; type-ahead is written
// `{ matches, prefix: true, scope: 'title' }`, which answers the same.
export function typeAheadRefusal(pointer: string[]): InvalidQueryError {
  return new InvalidQueryError(
    `${pointer.concat('typeahead').join('/') || '/'}: "typeahead" is not a filter operator; write type-ahead as { matches, prefix: true, scope: 'title' }`,
    'unknown-key',
  );
}

// A caller's query that still writes `typeahead`, wherever a filter goes (the
// filter, a boost, a binding's query, a comparison filter): refused. The
// engine runs type-ahead as an internal node of that name, so it checks what
// it is handed before it rewrites anything. Walks only filter structure, so
// a field named "typeahead" inside an `eq` is a field.
export function assertNoTypeAheadOperator(query: unknown): void {
  let walkFilter = (node: any, pointer: string[]): void => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    if ('typeahead' in node) throw typeAheadRefusal(pointer);
    if (Array.isArray(node.every))
      node.every.forEach((n: any, i: number) =>
        walkFilter(n, pointer.concat('every', String(i))),
      );
    if (Array.isArray(node.any))
      node.any.forEach((n: any, i: number) =>
        walkFilter(n, pointer.concat('any', String(i))),
      );
    if (node.not) walkFilter(node.not, pointer.concat('not'));
  };
  let walkSort = (sort: any, pointer: string[]) => {
    if (!Array.isArray(sort)) return;
    sort.forEach((s: any, i: number) => {
      if (!s || typeof s !== 'object') return;
      let at = pointer.concat(String(i));
      for (let key of ['of', 'blend']) {
        if (Array.isArray(s[key])) {
          s[key].forEach((c: any, k: number) => {
            if (c && typeof c === 'object') {
              if (c.when) walkFilter(c.when, at.concat(key, String(k), 'when'));
              if (c.boost)
                walkFilter(c.boost, at.concat(key, String(k), 'boost'));
            }
          });
        }
      }
      if (s.compare && typeof s.compare === 'object')
        walkFilter(s.compare.filter, at.concat('compare', 'filter'));
    });
  };
  let q = query as any;
  if (!q || typeof q !== 'object') return;
  walkFilter(q.filter, ['filter']);
  walkSort(q.sort, ['sort']);
  if (q.rerank && typeof q.rerank === 'object' && q.rerank.compare)
    walkFilter(q.rerank.compare.filter, ['rerank', 'compare', 'filter']);
  if (q.let && typeof q.let === 'object') {
    for (let [name, b] of Object.entries(q.let as Record<string, any>)) {
      if (b && typeof b === 'object' && b.from && typeof b.from === 'object') {
        walkFilter(b.from.filter, ['let', name, 'from', 'filter']);
        walkSort(b.from.sort, ['let', name, 'from', 'sort']);
      }
    }
  }
}

function assertNearFilter(
  filter: any,
  pointer: string[],
): asserts filter is NearFilter {
  let nearPointer = pointer.concat('near');
  let where = nearPointer.join('/') || '/';
  let near = filter?.near;
  if (typeof near !== 'object' || near == null || Array.isArray(near)) {
    throw new InvalidQueryError(
      `${where}: near must be an object keyed by the VectorField's path`,
      'invalid-value',
    );
  }
  let entries = Object.entries(near);
  if (entries.length !== 1) {
    throw new InvalidQueryError(
      `${where}: near takes exactly one field path; combine several under "every" or "any"`,
      'conflicting-members',
    );
  }
  let [path, value] = entries[0] as [string, any];
  assertKey(path, nearPointer);
  if (typeof value !== 'object' || value == null || Array.isArray(value)) {
    throw new InvalidQueryError(
      `${where}/${path}: expected { to: <vector>, minSimilarity?: <number> }`,
      'invalid-value',
    );
  }
  for (let key of Object.keys(value)) {
    if (!grammarMembers('nearTarget').includes(key)) {
      let near =
        key === 'k'
          ? undefined
          : nearestMember(key, grammarMembers('nearTarget'));
      throw new InvalidQueryError(
        `${where}/${path}: unknown member "${key.slice(0, 80)}"${near ? `; did you mean "${near}"?` : ''} (near takes "to" and "minSimilarity"; for the k nearest, sort by near and set page.size)`,
        'unknown-key',
      );
    }
  }
  if (!('to' in value)) {
    throw new InvalidQueryError(
      `${where}/${path}: expected { to: <vector>, minSimilarity?: <number> }`,
      'invalid-value',
    );
  }
  assertNearTarget(value.to, nearPointer.concat(path, 'to'));
  if (
    'minSimilarity' in value &&
    !(
      typeof value.minSimilarity === 'number' &&
      value.minSimilarity >= -1 &&
      value.minSimilarity <= 1
    )
  ) {
    throw new InvalidQueryError(
      `${where}/${path}/minSimilarity: minSimilarity must be a number from -1 to 1`,
      'invalid-value',
    );
  }
}

function assertTextTermLength(text: string, pointer: string[], member: string) {
  let max = readingOlderSpelling
    ? MAX_OLDER_TEXT_TERM_LENGTH
    : MAX_TEXT_TERM_LENGTH;
  if (text.length > max) {
    throw new InvalidQueryError(
      `${pointer.join('/') || '/'}: a ${member} term is at most ${max.toLocaleString('en-US')} characters, and this one has ${text.length.toLocaleString('en-US')}`,
      'limit-exceeded',
    );
  }
}

export function assertKey(key: string, pointer: string[]) {
  if (key.startsWith('[') && key.endsWith(']')) {
    throw new InvalidQueryError(
      `${pointer.join('/')}: field names cannot be wrapped in brackets: ${key}`,
      'invalid-value',
    );
  }
}

export const parseQuery = (queryString: string) => {
  return qs.parse(queryString, {
    depth: 10,
    strictDepth: true,
    strictNullHandling: true,
  });
};

export function normalizeQueryForSignature(query: Query): Query {
  // a type's shorthand and its code ref are one query
  let cloned = canonicalSets(
    sortKeysDeep(JSON.parse(JSON.stringify(resolveTypeReferences(query)))),
  );

  // a zone's spellings (`america/new_york`, `US/Eastern`) are one zone; a
  // query that names none keeps the signature it always had, since what it
  // reckons in is the realm's (generation-keyed) default
  let named = canonicalTimeZone((cloned as { timeZone?: unknown }).timeZone);
  if (named) (cloned as { timeZone?: string }).timeZone = named;
  if (cloned.page) {
    let page: any = cloned.page;
    if (typeof page.size === 'string') {
      let parsedSize = Number(page.size);
      page.size = Number.isFinite(parsedSize) ? parsedSize : page.size;
    }
    if (typeof page.number === 'string') {
      let parsedNumber = Number(page.number);
      page.number = Number.isFinite(parsedNumber) ? parsedNumber : page.number;
    }
  }

  return cloned;
}

// The lists a query holds as sets, written in one order, each member once:
// the children of `every` and `any`, the values of an `in`, and the entries
// of `facets`, wherever a filter sits (the filter, a boost, a binding's
// query, a rerank's comparison set). Sequences keep their order: the sort
// list, a facet's ranges, `select`. Values compared as written (`eq`,
// `contains`, `range`, `near`) are left exactly as they are. Reads keys
// already sorted (`sortKeysDeep`), so equal members print alike.
function canonicalSets(query: any): any {
  let text = (v: unknown) => JSON.stringify(v);
  let asSet = (list: unknown[]) => {
    let seen = new Map<string, unknown>();
    for (let v of list) seen.set(text(v), v);
    return [...seen.keys()].sort().map((k) => seen.get(k));
  };
  let filter = (node: any): any => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return node;
    let out: any = { ...node };
    for (let k of ['every', 'any'] as const) {
      if (Array.isArray(node[k])) out[k] = asSet(node[k].map(filter));
    }
    if (node.not) out.not = filter(node.not);
    if (node.in && typeof node.in === 'object' && !Array.isArray(node.in)) {
      out.in = Object.fromEntries(
        Object.entries(node.in).map(([path, v]) => [
          path,
          Array.isArray(v) ? asSet(v) : v,
        ]),
      );
    }
    return out;
  };
  let sortEntry = (e: any): any => {
    if (!e || typeof e !== 'object') return e;
    let out: any = { ...e };
    if (Array.isArray(e.of)) out.of = e.of.map(sortEntry);
    if (e.when) out.when = filter(e.when);
    return out;
  };
  let walk = (q: any): any => {
    if (!q || typeof q !== 'object' || Array.isArray(q)) return q;
    let out: any = { ...q };
    if (q.filter) out.filter = filter(q.filter);
    if (Array.isArray(q.sort)) out.sort = q.sort.map(sortEntry);
    if (Array.isArray(q.facets)) out.facets = asSet(q.facets);
    if (compareFilterOf(q)) {
      out.rerank = {
        ...q.rerank,
        compare: {
          ...q.rerank.compare,
          filter: filter(q.rerank.compare.filter),
        },
      };
    }
    if (q.let && typeof q.let === 'object') {
      out.let = Object.fromEntries(
        Object.entries(q.let).map(([name, b]: [string, any]) => [
          name,
          b && typeof b === 'object' && b.from
            ? { ...b, from: walk(b.from) }
            : b,
        ]),
      );
    }
    return out;
  };
  return walk(query);
}

export function sortKeysDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => sortKeysDeep(item)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    let sorted = Object.keys(value)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
    return sorted as unknown as T;
  }
  return value;
}

export function parseSearchURL(searchURL: string | URL): {
  query: Query;
  realm: URL;
} {
  let url = new URL(searchURL);
  let queryParam = url.searchParams.get('query');
  let query = queryParam
    ? parseQuery(queryParam)
    : parseQuery(url.search.slice(1));

  // Strip the trailing `/_search` path segment — with or without a trailing
  // slash — to recover the realm URL. Matching the segment's leading slash
  // and substituting a single `/` leaves exactly one separator (a trailing-
  // slash input like `/realm/_search/` must not collapse to `/realm//`).
  url.pathname = url.pathname.replace(/\/_search\/?$/, '/');
  url.search = '';

  return { query, realm: url };
}
