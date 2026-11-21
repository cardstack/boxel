import type { JsonValue } from '../json-validation.ts';
import type { generalSortFields } from './sort-kinds.ts';
import type { CodeRef } from '../index.ts';
import type { MATCH_RELEVANCE_SORT_KEY, BLEND_SORT_KEY } from './sort-kinds.ts';
import type { Vector } from '../serializers/vector.ts';
import type { StoreKeep } from '../query-engine/store-narrow.ts';
import type { SearchRankSignal } from '../search-intent.ts';
import type {
  FACET_MEASURES,
  FACET_INTERVALS,
  WHEN_SIGNAL_KEY,
  RELEVANCE_SORT_KEY,
  EXPR_SORT_KEY,
} from './query-values.ts';
import { InvalidQueryError } from '../invalid-query-error.ts';
import {
  DEFAULT_RERANK_TOP,
  MAX_OLDER_QUERY_DEPTH,
  MAX_QUERY_DEPTH,
  MAX_RERANK_TOP,
  RERANK_REFUSAL,
} from './query-syntax.ts';
import {
  NO_BINDING_VALUE,
  internBindingReferences,
} from './binding-reference.ts';

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
export type FacetMeasureOp = (typeof FACET_MEASURES)[number];
export type FacetMeasure = Partial<Record<FacetMeasureOp, string>>;
export interface FacetRange {
  key?: string;
  from?: number | string;
  to?: number | string;
}
export type FacetInterval = (typeof FACET_INTERVALS)[number];

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

// Where a reference stands decides what it must be: a `near` target is a
// vector, a `range` bound a number or date, a `matches`, `pattern` or
// `regex` value text, anything else any value.
export type CardReferenceRole = 'vector' | 'bound' | 'text' | 'value';

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
  // their meaning (time-zone.ts). Absent: the caller's zone, else the
  // realm's default zone, else UTC. A `let` binding's query inherits it
  // unless it names its own.
  timeZone?: string;
  page?: {
    number?: number; // page.number is 0-based
    size: number;
    generation?: number;
    // Count every match, however many: a broad `matches` term otherwise
    // ranks a capped candidate set and reports an estimated total
    // (the `total-estimated` warning). Still held to the time budget.
    exactTotal?: boolean;
    // Compare every vector a near sort, signal or filter considers, however
    // many: past `VECTOR_EXACT_THRESHOLD` a near search otherwise reads its
    // candidates through the vector index and says so (the
    // `near-approximate` warning). Still held to the time budget.
    exactNear?: boolean;
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
    exactNear?: boolean;
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
  | PathsFilter
  | CardTypeFilter;

export interface TypedFilter {
  on?: CodeRef;
}

// The entries stored at realm paths a path specifier names (ADR 037): a list
// of prefixes, relative to the root of each realm the search reads, and an
// entry matches when its file falls under any of them. `blog/` matches every
// entry stored in `blog/`, and `blog/post-1.json` that one card or file. An
// empty list has no path limit. A policy that limits a search grant to some
// paths composes one of these into the search it scopes.
export interface PathsFilter extends TypedFilter {
  paths: string[];
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
export interface WhenSignal {
  by: typeof WHEN_SIGNAL_KEY;
  when: Filter;
  weight?: number;
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
export type RelevanceSignal = 'text' | SearchRankSignal | 'meaning';
export type RelevanceSortExpression = {
  by: typeof RELEVANCE_SORT_KEY;
  on?: CodeRef;
  // Re-weights signals by name. 0 drops a signal; a negative weight inverts
  // it (least popular first).
  weights?: Partial<Record<RelevanceSignal, number>>;
  near?: NearSortTarget;
  direction?: 'asc' | 'desc';
};

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
export type ExprSortExpression = {
  by: typeof EXPR_SORT_KEY;
  expr: string;
  on?: CodeRef;
  direction?: 'asc' | 'desc';
  weight?: number;
};

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
export type RangeOperator = 'gt' | 'gte' | 'lt' | 'lte';
export type RangeFilterValue = {
  [range in RangeOperator]?: JSONValue;
};

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
  // Set by the engine, never on the wire: the filter's other conjuncts the
  // value store decides, which narrow the term's candidates before their
  // rows are read (query-engine/store-narrow.ts).
  storeKeep?: StoreKeep;
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
  // A type-ahead term (`matches` with `prefix` and `scope: 'title'`, run
  // as the engine's type-ahead node), which ranks by title tier.
  typeahead?: boolean;
  // Under an `any` or a `not`: a row can be in the result without matching.
  optional?: boolean;
};

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

export { NO_BINDING_VALUE, internBindingReferences };

// `query.ts` is where callers reach for the grammar's error, so it stays
// exported from here even though the class itself lives one module down.
export { InvalidQueryError };
export { DEFAULT_RERANK_TOP, MAX_RERANK_TOP, RERANK_REFUSAL };

// What a query may hold, past which it is refused (`limit-exceeded`): far
// past any app's use, and short of where the database would fail on it.
export { MAX_QUERY_DEPTH };
// A query in the older spelling is read as it always was, and refused only
// past where the database failed on it: an `in` past Postgres's 65,535 bound
// parameters, a term long enough to overflow its parser's stack, a sort past
// its 1,664-column target list.
export { MAX_OLDER_QUERY_DEPTH };
export * from './query-check.ts';
export * from './query-values.ts';
