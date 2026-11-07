import { isEqual } from 'lodash-es';
import qs from 'qs';

import {
  assertJSONValue,
  assertJSONPrimitive,
  type JsonValue,
} from './json-validation.ts';
import { InvalidQueryError } from './invalid-query-error.ts';
import {
  type CodeRef,
  isCodeRef,
  generalSortFields,
  isMatchRelevanceSort,
  isNearSort,
  isBlendSort,
  MATCH_RELEVANCE_SORT_KEY,
  BLEND_SORT_KEY,
} from './index.ts';
import {
  isVector,
  MAX_VECTOR_DIMENSIONS,
  type Vector,
} from './serializers/vector.ts';
import { SEARCH_RANK_SIGNALS, type SearchRankSignal } from './search-intent.ts';

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
export interface LetBinding {
  from: { filter?: Filter; sort?: Sort; page?: { size: number } };
  select: string;
}
export const MAX_LET_BINDINGS = 4;

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
export const MAX_LET_ROWS = 1000;
export const MAX_LET_VALUES = 1000;
const LET_NAME = /^[A-Za-z_][\w]*$/;

// The binding an `in` value names, or undefined for a plain list.
export function letReference(value: unknown): string | undefined {
  return typeof value === 'string' &&
    value.startsWith('$') &&
    LET_NAME.test(value.slice(1))
    ? value.slice(1)
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

interface QueryCommon {
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
  page?: {
    number?: number; // page.number is 0-based
    size: number;
    generation?: number;
  };
}

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
  fields?: SparseFieldsets;
  page?: {
    number?: number; // page.number is 0-based
    size: number | string;
    generation?: number;
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

type SortExpression =
  | SortExpressionWithoutCodeRef
  | SortExpressionWithCodeRef
  | BlendSortExpression
  | RelevanceSortExpression;
type SortExpressionWithInterpolations =
  | SortExpressionWithoutCodeRefWithInterpolations
  | SortExpressionWithCodeRefWithInterpolations;
export type Sort = SortExpression[];
type SortWithInterpolations = SortExpressionWithInterpolations[];

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
// rounded down to the start of a unit in UTC (`now-30d/d`, `now/M`). It is
// read when the query runs, so a saved search for "added this month" stays
// current. Any other string is a literal bound.
const RELATIVE_DATE = /^now(?:([+-])(\d+)([smhdwMy]))?(?:\/([smhdwMy]))?$/;

export function isRelativeDate(value: unknown): value is string {
  return typeof value === 'string' && RELATIVE_DATE.test(value);
}

export function resolveRelativeDate(value: string, now = new Date()): string {
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
  in: { [fieldName: string]: JSONValue[] | string };
}

export interface ContainsFilter extends TypedFilter {
  contains: { [fieldName: string]: JSONValue };
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

// A glob over a field's whole value, ignoring case: `*` is any run of
// characters, `?` any one. Only on a field searched by pattern (declared
// `search: { patterns: true }`, or an `identifier` or `code` role).
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
}

// Type-ahead over a card's short names: its title and its
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

export function isTypeAheadFilter(filter: Filter): filter is TypeAheadFilter {
  return (filter as TypeAheadFilter).typeahead !== undefined;
}

// One positive `matches` term, as a `_matchRelevance` sort scores it.
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
  // A type-ahead term (`{ typeahead }`), which ranks by title tier.
  typeahead?: boolean;
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
export function collectPositiveMatchTerms(
  filter: Filter | undefined,
  polarity: 'positive' | 'negated' = 'positive',
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
    );
  }
  if ('every' in filter) {
    return filter.every.flatMap((f) => collectPositiveMatchTerms(f, polarity));
  }
  if ('any' in filter) {
    return filter.any.flatMap((f) => collectPositiveMatchTerms(f, polarity));
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

export function assertQuery(
  query: any,
  pointer: string[] = [''],
): asserts query is Query {
  if (typeof query !== 'object' || query == null) {
    throw new InvalidQueryError(
      `${pointer.join('/') || '/'}: missing query object`,
    );
  }

  if ('realm' in query && 'realms' in query) {
    throw new InvalidQueryError(
      `${pointer.join('/') || '/'}: query cannot specify both realm and realms`,
    );
  }

  // Bindings first; then the rest of the query is checked with each
  // `"$name"` stood in by an empty list, the shape it resolves to.
  let declared = new Set<string>();
  if ('let' in query) {
    assertLetBindings(query.let, pointer.concat('let'));
    declared = new Set(Object.keys(query.let));
  }
  if (query.filter || query.sort) {
    let unknown: string[] = [];
    let probe = mapLetReferences(
      { filter: query.filter, sort: query.sort } as any,
      (field, name, node) => {
        if (!declared.has(name)) unknown.push(name);
        return { ...node, in: { [field]: [] } };
      },
    );
    if (unknown.length) {
      throw new InvalidQueryError(
        `${pointer.join('/') || '/'}: "$${unknown[0]}" names no binding in let`,
      );
    }
    query = {
      ...query,
      ...(query.filter ? { filter: probe.filter } : {}),
      ...(query.sort ? { sort: probe.sort } : {}),
    };
  }

  for (let [key, value] of Object.entries(query)) {
    switch (key) {
      case 'filter':
        assertFilter(value, pointer.concat('filter'));
        break;
      case 'sort':
        if (!Array.isArray(value)) {
          throw new InvalidQueryError(
            `${pointer.concat('sort').join('/') || '/'}: sort must be an array`,
          );
        }
        value.forEach((sort, i) => {
          assertSortExpression(sort, pointer.concat(`sort[${i}]`));
        });
        break;
      case 'queryString':
        if (typeof value !== 'string') {
          throw new InvalidQueryError(
            `${
              pointer.concat('queryString').join('/') || '/'
            }: queryString must be a string`,
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
      case 'explain':
        if (typeof value !== 'boolean') {
          throw new InvalidQueryError(
            `${pointer.concat('explain').join('/') || '/'}: explain must be a boolean`,
          );
        }
        break;
      case 'asData':
        if (typeof value !== 'boolean') {
          throw new InvalidQueryError(
            `${pointer.concat('asData').join('/') || '/'}: asData must be a boolean`,
          );
        }
        break;

      default:
        throw new InvalidQueryError(`unknown field in query: ${key}`);
    }
  }

  if ('fields' in query && query.asData !== true) {
    throw new InvalidQueryError(
      `${pointer.join('/') || '/'}: fields requires asData to be true`,
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
      `${pointer.join('/') || '/'}: sort by "${MATCH_RELEVANCE_SORT_KEY}" requires at least one positive \`matches\` filter`,
    );
  }
}

function assertRealm(realm: any, pointer: string[]): asserts realm is string {
  if (typeof realm !== 'string') {
    throw new InvalidQueryError(
      `${pointer.join('/') || '/'}: realm must be a string`,
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
    );
  }
  for (let realm of realms) {
    if (typeof realm !== 'string') {
      throw new InvalidQueryError(
        `${pointer.join('/') || '/'}: realms must be an array of strings`,
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
    );
  }
  for (let [typeName, fieldNames] of Object.entries(fields)) {
    if (!Array.isArray(fieldNames)) {
      throw new InvalidQueryError(
        `${pointer.concat(typeName).join('/') || '/'}: fields value must be an array of field names`,
      );
    }
    for (let fieldName of fieldNames) {
      if (typeof fieldName !== 'string') {
        throw new InvalidQueryError(
          `${pointer.concat(typeName).join('/') || '/'}: each field name must be a string`,
        );
      }
    }
  }
}

function assertSortExpression(
  sort: any,
  pointer: string[],
): asserts sort is Query['sort'] {
  if (typeof sort !== 'object' || sort == null) {
    throw new InvalidQueryError(
      `${pointer.join('/') || '/'}: missing sort object`,
    );
  }
  if (!('by' in sort)) {
    throw new InvalidQueryError(
      `${pointer.concat('by').join('/') || '/'}: missing by object`,
    );
  }
  if (typeof sort.by !== 'string') {
    throw new InvalidQueryError(
      `${pointer.concat('by').join('/') || '/'}: by must be a string`,
    );
  }
  if (sort.by === WHEN_SIGNAL_KEY) {
    throw new InvalidQueryError(
      `${pointer.join('/') || '/'}: a ${WHEN_SIGNAL_KEY} signal ranks only inside a _blend sort`,
    );
  }
  // Every sort entry carries a direction, whether or not it names a type: a
  // general sort field is anchored by the column it maps to rather than by
  // `on`, so it takes the same `asc`/`desc` constraint. Checked ahead of the
  // branching below so neither shape can reach a `return` with it unchecked.
  if ('direction' in sort) {
    if (sort.direction !== 'asc' && sort.direction !== 'desc') {
      throw new InvalidQueryError(
        `${
          pointer.concat('direction').join('/') || '/'
        }: direction must be either 'asc' or 'desc'`,
      );
    }
  }

  if (isRelevanceSort(sort)) {
    assertRelevanceSort(sort, pointer);
    return;
  }

  if (isNearSort(sort)) {
    if (!('on' in sort)) {
      throw new InvalidQueryError(
        `${pointer.concat('on').join('/') || '/'}: a near sort needs an on object naming the card type whose field it ranks by`,
      );
    }
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
    if ('on' in sort) {
      assertCardType(sort.on, pointer.concat('on'));
    }
    return;
  }
  if (!('on' in sort)) {
    if (Object.keys(generalSortFields).includes(sort.by)) {
      return;
    }
    throw new InvalidQueryError(
      `${pointer.concat('on').join('/') || '/'}: missing on object`,
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
      );
    }
    for (let [signal, weight] of Object.entries(weights)) {
      if (!(RELEVANCE_SIGNALS as readonly string[]).includes(signal)) {
        throw new InvalidQueryError(
          `${where}/weights/${signal}: unknown signal (expected one of ${RELEVANCE_SIGNALS.join(', ')})`,
        );
      }
      if (typeof weight !== 'number' || !Number.isFinite(weight)) {
        throw new InvalidQueryError(
          `${where}/weights/${signal}: a weight must be a finite number`,
        );
      }
    }
  }
  for (let key of Object.keys(sort)) {
    if (!['by', 'on', 'near', 'weights', 'direction'].includes(key)) {
      throw new InvalidQueryError(
        `${where}/${key}: a ${RELEVANCE_SORT_KEY} sort takes by, on, near, weights and direction`,
      );
    }
  }
}

function assertBlendSort(sort: any, pointer: string[]) {
  let where = pointer.join('/') || '/';
  if (!Array.isArray(sort.of) || sort.of.length === 0) {
    throw new InvalidQueryError(
      `${where}/of: a ${BLEND_SORT_KEY} sort needs an "of" array of the sort entries to fuse`,
    );
  }
  if (sort.of.length > MAX_BLEND_COMPONENTS) {
    throw new InvalidQueryError(
      `${where}/of: a ${BLEND_SORT_KEY} sort fuses at most ${MAX_BLEND_COMPONENTS} signals`,
    );
  }
  if ('method' in sort && sort.method !== 'rrf') {
    throw new InvalidQueryError(
      `${where}/method: ${BLEND_SORT_KEY} supports method "rrf" (reciprocal rank fusion)`,
    );
  }
  if (
    'k' in sort &&
    !(typeof sort.k === 'number' && Number.isFinite(sort.k) && sort.k > 0)
  ) {
    throw new InvalidQueryError(`${where}/k: k must be a positive number`);
  }
  if ('on' in sort) {
    throw new InvalidQueryError(
      `${where}: a ${BLEND_SORT_KEY} sort takes no "on"; put "on" on its signals`,
    );
  }
  sort.of.forEach((component: any, i: number) => {
    let at = pointer.concat('of', String(i));
    if (component && isBlendSort(component)) {
      throw new InvalidQueryError(
        `${at.join('/')}: a ${BLEND_SORT_KEY} sort cannot contain another`,
      );
    }
    if (component && isRelevanceSort(component)) {
      throw new InvalidQueryError(
        `${at.join('/')}: a ${BLEND_SORT_KEY} sort cannot contain a ${RELEVANCE_SORT_KEY} sort, which is itself a blend`,
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
      );
    }
    if (component && component.by === WHEN_SIGNAL_KEY) {
      for (let key of Object.keys(component)) {
        if (!['by', 'when', 'weight'].includes(key)) {
          throw new InvalidQueryError(
            `${at.join('/')}: a ${WHEN_SIGNAL_KEY} signal takes by, when and weight, not "${key}"`,
          );
        }
      }
      if (typeof component.when !== 'object' || component.when == null) {
        throw new InvalidQueryError(
          `${at.join('/')}/when: a ${WHEN_SIGNAL_KEY} signal needs a filter in "when"`,
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
      );
    }
    if (!near.every((c) => typeof c === 'number' && Number.isFinite(c))) {
      throw new InvalidQueryError(
        `${where}: near must be an array of finite numbers`,
      );
    }
    return;
  }
  if (!isVector(near)) {
    throw new InvalidQueryError(
      `${where}: near must be an array of numbers or a vector ({ dims, encoding, scale?, data })`,
    );
  }
}

function assertPage(
  page: any,
  pointer: string[],
): asserts page is Query['page'] {
  if (typeof page !== 'object' || page == null) {
    throw new InvalidQueryError(
      `${pointer.join('/') || '/'}: missing page object`,
    );
  }

  if ('size' in page) {
    if (
      (typeof page.size !== 'number' && typeof page.size !== 'string') ||
      (typeof page.size === 'string' && isNaN(page.size))
    ) {
      throw new InvalidQueryError(
        `${pointer.concat('size').join('/') || '/'}: size must be a number`,
      );
    }
  }

  if ('cursor' in page && typeof page.cursor !== 'string') {
    throw new InvalidQueryError(
      `${pointer.concat('cursor').join('/') || '/'}: cursor must be a string`,
    );
  }
}

// Maps each filter operator to its validator. `assertFilter` derives both
// the operator list and its dispatch from this one map, so an operator cannot
// be recognized by one without the other.
const FILTER_OPERATOR_ASSERTS: Record<
  string,
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
  typeahead: assertTypeAheadFilter,
  near: assertNearFilter,
  linkedFrom: assertLinkedFromFilter,
  pattern: (filter, pointer) =>
    assertStringKeyedFilter(filter, pointer, 'pattern'),
  regex: (filter, pointer) => assertStringKeyedFilter(filter, pointer, 'regex'),
};

function assertLinkedFromFilter(filter: any, pointer: string[]) {
  let at = pointer.concat('linkedFrom').join('/') || '/';
  let v = filter.linkedFrom;
  if (
    typeof v !== 'object' ||
    v == null ||
    Array.isArray(v) ||
    Object.keys(v).some((k) => k !== 'card' && k !== 'field')
  ) {
    throw new InvalidQueryError(`${at}: linkedFrom must be { card, field }`);
  }
  if (typeof v.card !== 'string' || !/^https?:\/\//.test(v.card)) {
    throw new InvalidQueryError(
      `${at}/card: card must be an absolute card URL`,
    );
  }
  if (
    typeof v.field !== 'string' ||
    !/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(v.field)
  ) {
    throw new InvalidQueryError(
      `${at}/field: field must name a link field of that card, such as "items"`,
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
    );
  }
  let entries = Object.entries(value);
  if (entries.length === 0) {
    throw new InvalidQueryError(
      `${at.join('/') || '/'}: ${operator} needs a field`,
    );
  }
  for (let [key, v] of entries) {
    assertKey(key, at);
    if (typeof v !== 'string' || v === '') {
      throw new InvalidQueryError(
        `${at.concat(key).join('/')}: a ${operator} must be a non-empty string`,
      );
    }
  }
}

const FILTER_OPERATORS = Object.keys(FILTER_OPERATOR_ASSERTS);

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
  let operators = filterOperators(filter);
  if (operators.length > 1) {
    throw new InvalidQueryError(
      `${pointer.join('/') || '/'}: a filter may use only one operator, but found ${operators
        .map((key) => `"${key}"`)
        .join(', ')}; combine operators by nesting them under "every" or "any"`,
    );
  }

  let operator = operators[0];
  if ('fields' in filter && operator !== 'matches') {
    throw new InvalidQueryError(
      `${pointer.concat('fields').join('/') || '/'}: fields belongs beside matches`,
    );
  }
  if ('within' in filter && operator !== 'matches') {
    throw new InvalidQueryError(
      `${pointer.concat('within').join('/') || '/'}: within belongs beside matches`,
    );
  }
  if ('prefix' in filter && operator !== 'matches') {
    throw new InvalidQueryError(
      `${pointer.concat('prefix').join('/') || '/'}: prefix belongs beside matches`,
    );
  }
  if ('typos' in filter && operator !== 'matches' && operator !== 'typeahead') {
    throw new InvalidQueryError(
      `${pointer.concat('typos').join('/') || '/'}: typos belongs beside matches or typeahead`,
    );
  }
  if ('scope' in filter && operator !== 'matches') {
    throw new InvalidQueryError(
      `${pointer.concat('scope').join('/') || '/'}: scope belongs beside matches`,
    );
  }
  if (!operator) {
    throw new InvalidQueryError(
      `${pointer.join('/') || '/'}: cannot determine the type of filter`,
    );
  }
  FILTER_OPERATOR_ASSERTS[operator](filter, pointer);
}

function assertCardType(type: any, pointer: string[]) {
  if (!isCodeRef(type)) {
    throw new InvalidQueryError(
      `${pointer.join('/') || '/'}: type is not valid`,
    );
  }
  // An empty module passes the shape check but cannot be resolved, so the
  // engine throws on it in every realm the query reaches. A model that fills
  // every schema property sends `{ module: '', name: '' }` for a type it does
  // not mean to set; naming the key tells it to leave the key out.
  if (!('type' in type) && (type.module === '' || type.name === '')) {
    throw new InvalidQueryError(
      `${pointer.join('/') || '/'}: module and name must not be empty; omit the key when you do not filter by it`,
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
    );
  }
  let anyPointer = pointer.concat('any');
  if (!('any' in filter)) {
    throw new InvalidQueryError(
      `${anyPointer.join('/') || '/'}: AnyFilter must have any property`,
    );
  }

  if (!Array.isArray(filter.any)) {
    throw new InvalidQueryError(
      `${anyPointer.join('/') || '/'}: any must be an array of Filters`,
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
    );
  }
  let everyPointer = pointer.concat('every');
  if (!('every' in filter)) {
    throw new InvalidQueryError(
      `${everyPointer.join('/') || '/'}: EveryFilter must have every property`,
    );
  }

  if (!Array.isArray(filter.every)) {
    throw new InvalidQueryError(
      `${everyPointer.join('/') || '/'}: every must be an array of Filters`,
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
    );
  }
  let notPointer = pointer.concat('not');
  if (!('not' in filter)) {
    throw new InvalidQueryError(
      `${notPointer.join('/') || '/'}: NotFilter must have not property`,
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
    );
  }
  let eqPointer = pointer.concat('eq');
  if (!('eq' in filter)) {
    throw new InvalidQueryError(
      `${eqPointer.join('/') || '/'}: EqFilter must have eq property`,
    );
  }
  if (typeof filter.eq !== 'object' || filter.eq == null) {
    throw new InvalidQueryError(
      `${eqPointer.join('/') || '/'}: eq must be an object`,
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
    );
  }
  let inPointer = pointer.concat('in');
  if (!('in' in filter)) {
    throw new InvalidQueryError(
      `${inPointer.join('/') || '/'}: InFilter must have in property`,
    );
  }
  if (typeof filter.in !== 'object' || filter.in == null) {
    throw new InvalidQueryError(
      `${inPointer.join('/') || '/'}: in must be an object`,
    );
  }
  Object.entries(filter.in).forEach(([key, value]) => {
    assertKey(key, inPointer);
    if (!Array.isArray(value)) {
      throw new InvalidQueryError(
        `${inPointer.concat(key).join('/') || '/'}: in values must be arrays`,
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
    );
  }
  let containsPointer = pointer.concat('contains');
  if (!('contains' in filter)) {
    throw new InvalidQueryError(
      `${containsPointer.join('/') || '/'}: ContainsFilter must have contains property`,
    );
  }
  if (typeof filter.contains !== 'object' || filter.contains == null) {
    throw new InvalidQueryError(
      `${containsPointer.join('/') || '/'}: contains must be an object`,
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
    );
  }
  let rangePointer = pointer.concat('range');
  if (!('range' in filter)) {
    throw new InvalidQueryError(
      `${rangePointer.join('/') || '/'}: RangeFilter must have range property`,
    );
  }
  if (typeof filter.range !== 'object' || filter.range == null) {
    throw new InvalidQueryError(
      `${rangePointer.join('/') || '/'}: range must be an object`,
    );
  }
  Object.entries(filter.range).forEach(([fieldPath, constraints]) => {
    let innerPointer = [...rangePointer, fieldPath];
    if (typeof constraints !== 'object' || constraints == null) {
      throw new InvalidQueryError(
        `${innerPointer.join('/') || '/'}: range constraint must be an object`,
      );
    }
    Object.entries(constraints).forEach(([key, value]) => {
      switch (key) {
        case 'gt':
        case 'gte':
        case 'lt':
        case 'lte':
          assertJSONPrimitive(value, innerPointer.concat(key));
          return;
        default:
          throw new InvalidQueryError(
            `${
              innerPointer.concat(key).join('/') || '/'
            }: range item must be gt, gte, lt, or lte`,
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
    );
  }
  let matchesPointer = pointer.concat('matches');
  if (!('matches' in filter)) {
    throw new InvalidQueryError(
      `${matchesPointer.join('/') || '/'}: MatchesFilter must have matches property`,
    );
  }
  if (typeof filter.matches !== 'string') {
    throw new InvalidQueryError(
      `${matchesPointer.join('/') || '/'}: matches must be a string`,
    );
  }
  if (
    'within' in filter &&
    (typeof filter.within !== 'string' ||
      !/^[A-Za-z_$][\w$]*$/.test(filter.within))
  ) {
    throw new InvalidQueryError(
      `${pointer.concat('within').join('/') || '/'}: within must name a top-level passage list field, such as "segments"`,
    );
  }
  if ('prefix' in filter && typeof filter.prefix !== 'boolean') {
    throw new InvalidQueryError(
      `${pointer.concat('prefix').join('/') || '/'}: prefix must be a boolean`,
    );
  }
  if ('typos' in filter && typeof filter.typos !== 'boolean') {
    throw new InvalidQueryError(
      `${pointer.concat('typos').join('/') || '/'}: typos must be a boolean`,
    );
  }
  for (let internal of ['typoQuery', 'typoPartial']) {
    if (internal in filter) {
      throw new InvalidQueryError(
        `${pointer.concat(internal).join('/') || '/'}: ${internal} is set by the engine`,
      );
    }
  }
  if ('scope' in filter && filter.scope !== 'title') {
    throw new InvalidQueryError(
      `${pointer.concat('scope').join('/') || '/'}: scope must be "title"`,
    );
  }
  if ('scope' in filter && 'within' in filter) {
    throw new InvalidQueryError(
      `${pointer.join('/') || '/'}: a matches term takes scope or within, not both`,
    );
  }
  if ('fields' in filter) {
    if (
      !Array.isArray(filter.fields) ||
      filter.fields.length === 0 ||
      filter.fields.length > 8 ||
      !filter.fields.every(
        (f: unknown) => typeof f === 'string' && FACET_PATH.test(f),
      )
    ) {
      throw new InvalidQueryError(
        `${pointer.concat('fields').join('/') || '/'}: fields must list 1 to 8 field paths, such as ["material", "brand.name"]`,
      );
    }
    if ('scope' in filter || 'within' in filter || 'prefix' in filter) {
      throw new InvalidQueryError(
        `${pointer.join('/') || '/'}: a matches term with fields takes no scope, within or prefix`,
      );
    }
  }
}

const FACET_PATH = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/;

function assertLetBindings(lets: any, pointer: string[]) {
  let where = pointer.join('/') || '/';
  if (typeof lets !== 'object' || lets == null || Array.isArray(lets)) {
    throw new InvalidQueryError(`${where}: let must map names to bindings`);
  }
  let names = Object.keys(lets);
  if (names.length === 0 || names.length > MAX_LET_BINDINGS) {
    throw new InvalidQueryError(
      `${where}: let takes 1 to ${MAX_LET_BINDINGS} bindings`,
    );
  }
  for (let name of names) {
    let at = pointer.concat(name);
    let b = lets[name];
    if (!LET_NAME.test(name)) {
      throw new InvalidQueryError(
        `${at.join('/')}: a binding's name is letters, digits and underscores`,
      );
    }
    if (typeof b !== 'object' || b == null || Array.isArray(b)) {
      throw new InvalidQueryError(
        `${at.join('/')}: a binding is { from, select }`,
      );
    }
    for (let key of Object.keys(b)) {
      if (key !== 'from' && key !== 'select') {
        throw new InvalidQueryError(
          `${at.join('/')}: unknown binding member "${key}"`,
        );
      }
    }
    if (typeof b.select !== 'string' || !FACET_PATH.test(b.select)) {
      throw new InvalidQueryError(
        `${at.concat('select').join('/')}: select must be a field path, such as "items.id"`,
      );
    }
    let from = b.from;
    if (typeof from !== 'object' || from == null || Array.isArray(from)) {
      throw new InvalidQueryError(
        `${at.concat('from').join('/')}: from must be a query with a filter`,
      );
    }
    for (let key of Object.keys(from)) {
      if (!['filter', 'sort', 'page'].includes(key)) {
        throw new InvalidQueryError(
          `${at.concat('from').join('/')}: from takes filter, sort and page, not "${key}"`,
        );
      }
    }
    if (from.filter === undefined) {
      throw new InvalidQueryError(
        `${at.concat('from').join('/')}: from needs a filter`,
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
    if (nested) {
      throw new InvalidQueryError(
        `${at.concat('from').join('/')}: a binding's query cannot use another binding`,
      );
    }
    assertQuery(inner, at.concat('from'));
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
    );
  }
  for (let key of Object.keys(shape)) {
    if (!['by', 'on', 'keep'].includes(key)) {
      throw new InvalidQueryError(`${where}: unknown collapse member "${key}"`);
    }
  }
  if (typeof shape.by !== 'string' || !FACET_PATH.test(shape.by)) {
    throw new InvalidQueryError(
      `${where}/by: by must be a field path such as "productType" or "brand.name"`,
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
    );
  }
}

function assertFacets(
  facets: any,
  pointer: string[],
): asserts facets is Facet[] {
  let where = pointer.join('/') || '/';
  if (!Array.isArray(facets)) {
    throw new InvalidQueryError(`${where}: facets must be an array`);
  }
  if (facets.length > MAX_FACETS) {
    throw new InvalidQueryError(
      `${where}: a query takes at most ${MAX_FACETS} facets`,
    );
  }
  facets.forEach((facet, i) => {
    let at = `${where}[${i}]`;
    if (typeof facet !== 'object' || facet == null || Array.isArray(facet)) {
      throw new InvalidQueryError(`${at}: a facet must be an object`);
    }
    for (let key of Object.keys(facet)) {
      if (!FACET_MEMBERS.has(key)) {
        throw new InvalidQueryError(`${at}: unknown facet member "${key}"`);
      }
    }
    assertFacetMembers(facet, at);
    if (typeof facet.by !== 'string' || !FACET_PATH.test(facet.by)) {
      throw new InvalidQueryError(
        `${at}/by: by must be a field path such as "category" or "speaker.name"`,
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
      );
    }
  });
}

const FACET_MEMBERS = new Set([
  'by',
  'size',
  'own',
  'stats',
  'ranges',
  'interval',
  'prefix',
  'missing',
  'order',
  'measure',
]);

function assertFacetMembers(facet: any, at: string) {
  if (facet.own !== undefined && facet.own !== 'ignore') {
    throw new InvalidQueryError(`${at}/own: own must be "ignore"`);
  }
  for (let flag of ['stats', 'missing'] as const) {
    if (facet[flag] !== undefined && typeof facet[flag] !== 'boolean') {
      throw new InvalidQueryError(`${at}/${flag}: ${flag} must be a boolean`);
    }
  }
  if (facet.prefix !== undefined && typeof facet.prefix !== 'string') {
    throw new InvalidQueryError(`${at}/prefix: prefix must be a string`);
  }
  if (
    facet.order !== undefined &&
    facet.order !== 'count' &&
    facet.order !== 'value' &&
    facet.order !== 'measure'
  ) {
    throw new InvalidQueryError(
      `${at}/order: order must be "count", "value" or "measure"`,
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
      );
    }
    if (facet.ranges !== undefined || facet.interval !== undefined) {
      throw new InvalidQueryError(
        `${at}/measure: measure counts values, so it takes no ranges or interval`,
      );
    }
  }
  if (facet.order === 'measure' && facet.measure === undefined) {
    throw new InvalidQueryError(`${at}/order: order "measure" needs a measure`);
  }
  if (
    facet.interval !== undefined &&
    !(FACET_INTERVALS as readonly unknown[]).includes(facet.interval)
  ) {
    throw new InvalidQueryError(
      `${at}/interval: interval must be one of ${FACET_INTERVALS.join(', ')}`,
    );
  }
  if (facet.ranges !== undefined) {
    if (facet.interval !== undefined) {
      throw new InvalidQueryError(
        `${at}: a facet takes ranges or interval, not both`,
      );
    }
    if (
      !Array.isArray(facet.ranges) ||
      facet.ranges.length === 0 ||
      facet.ranges.length > MAX_FACET_RANGES
    ) {
      throw new InvalidQueryError(
        `${at}/ranges: ranges must be a list of 1 to ${MAX_FACET_RANGES} buckets`,
      );
    }
    facet.ranges.forEach((range: any, j: number) => {
      let where = `${at}/ranges[${j}]`;
      if (typeof range !== 'object' || range == null || Array.isArray(range)) {
        throw new InvalidQueryError(`${where}: a range must be an object`);
      }
      for (let key of Object.keys(range)) {
        if (key !== 'key' && key !== 'from' && key !== 'to') {
          throw new InvalidQueryError(
            `${where}: a range takes key, from and to`,
          );
        }
      }
      if (range.from === undefined && range.to === undefined) {
        throw new InvalidQueryError(`${where}: a range needs from or to`);
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
        );
      }
      if (range.key !== undefined && typeof range.key !== 'string') {
        throw new InvalidQueryError(`${where}/key: key must be a string`);
      }
    });
  }
}

// A range bucket's label: its `key`, or "from-to" with `*` for an open end.
export function facetRangeLabel(range: FacetRange): string {
  return range.key ?? `${range.from ?? '*'}-${range.to ?? '*'}`;
}

function assertTypeAheadFilter(
  filter: any,
  pointer: string[],
): asserts filter is TypeAheadFilter {
  if (typeof filter?.typeahead !== 'string') {
    throw new InvalidQueryError(
      `${pointer.concat('typeahead').join('/') || '/'}: typeahead must be a string`,
    );
  }
  if ('typos' in filter && typeof filter.typos !== 'boolean') {
    throw new InvalidQueryError(
      `${pointer.concat('typos').join('/') || '/'}: typos must be a boolean`,
    );
  }
  if ('typoQuery' in filter) {
    throw new InvalidQueryError(
      `${pointer.concat('typoQuery').join('/') || '/'}: typoQuery is set by the engine`,
    );
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
    );
  }
  let entries = Object.entries(near);
  if (entries.length !== 1) {
    throw new InvalidQueryError(
      `${where}: near takes exactly one field path; combine several under "every" or "any"`,
    );
  }
  let [path, value] = entries[0] as [string, any];
  assertKey(path, nearPointer);
  if (typeof value !== 'object' || value == null || !('to' in value)) {
    throw new InvalidQueryError(
      `${where}/${path}: expected { to: <vector>, minSimilarity?: <number> }`,
    );
  }
  for (let key of Object.keys(value)) {
    if (key !== 'to' && key !== 'minSimilarity') {
      throw new InvalidQueryError(
        `${where}/${path}: unknown member "${key}" (near takes "to" and "minSimilarity"; for the k nearest, sort by near and set page.size)`,
      );
    }
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
    );
  }
}

export function assertKey(key: string, pointer: string[]) {
  if (key.startsWith('[') && key.endsWith(']')) {
    throw new InvalidQueryError(
      `${pointer.join('/')}: field names cannot be wrapped in brackets: ${key}`,
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
  let cloned = sortKeysDeep(JSON.parse(JSON.stringify(query)));

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
