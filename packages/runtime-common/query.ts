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
export interface Facet {
  by: string;
  size?: number;
}
export const MAX_FACETS = 8;
export const DEFAULT_FACET_SIZE = 50;
export const MAX_FACET_SIZE = 1000;

export interface FacetCount {
  value: string;
  count: number;
}

interface QueryCommon {
  filter?: Filter;
  sort?: Sort;
  facets?: Facet[];
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
// `asc`.
export type BlendComponent = (
  | SortExpressionWithoutCodeRef
  | SortExpressionWithCodeRef
) & { weight?: number };

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
  of?: SortExpressionWithCodeRefWithInterpolations[];
  method?: string;
  k?: number;
};

type SortExpression =
  | SortExpressionWithoutCodeRef
  | SortExpressionWithCodeRef
  | BlendSortExpression;
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
}

// Type-ahead over a card's short names: its title and its
// `cardInfo.alternativeNames`, stamped into the search doc's `_typeahead` key.
// Every word of the query is a prefix of some word of that text, in any order,
// ignoring case and never stemmed. Unlike `matches` it never reads a card's
// rendered markdown, so a long definition or transcript can't match or slow
// it. A query with no letters or digits matches nothing.
export interface TypeAheadFilter extends TypedFilter {
  typeahead: string;
}

// The words of a type-ahead query: runs of letters and digits, lowercased.
export function typeAheadWords(text: string): string[] {
  return [...text.matchAll(/[\p{L}\p{N}]+/gu)].map((m) => m[0].toLowerCase());
}

export function isTypeAheadFilter(filter: Filter): filter is TypeAheadFilter {
  return (filter as TypeAheadFilter).typeahead !== undefined;
}

// One positive `matches` term, as a `_matchRelevance` sort scores it.
export type MatchTerm = Pick<MatchesFilter, 'matches' | 'prefix'>;

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
          filter.prefix
            ? { matches: filter.matches, prefix: true }
            : { matches: filter.matches },
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
    if (
      component &&
      'weight' in component &&
      !(
        typeof component.weight === 'number' &&
        Number.isFinite(component.weight) &&
        component.weight > 0
      )
    ) {
      throw new InvalidQueryError(
        `${at.join('/')}/weight: weight must be a positive number`,
      );
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
};

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
  if ('prefix' in filter && operator !== 'matches') {
    throw new InvalidQueryError(
      `${pointer.concat('prefix').join('/') || '/'}: prefix belongs beside matches`,
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
  if ('prefix' in filter && typeof filter.prefix !== 'boolean') {
    throw new InvalidQueryError(
      `${pointer.concat('prefix').join('/') || '/'}: prefix must be a boolean`,
    );
  }
}

const FACET_PATH = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/;

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
      if (key !== 'by' && key !== 'size') {
        throw new InvalidQueryError(`${at}: unknown facet member "${key}"`);
      }
    }
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

function assertTypeAheadFilter(
  filter: any,
  pointer: string[],
): asserts filter is TypeAheadFilter {
  if (typeof filter?.typeahead !== 'string') {
    throw new InvalidQueryError(
      `${pointer.concat('typeahead').join('/') || '/'}: typeahead must be a string`,
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
