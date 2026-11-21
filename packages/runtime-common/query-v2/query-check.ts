// Checks a query against the grammar: every refusal a query can meet before
// it runs (docs/search.md, "Refusals"). Member sets come from the grammar
// table (query-grammar.ts), messages from the refusal table
// (query-refusals.ts). A rule here is a row `[holds, refusal, member?,
// values?]` in a list checked in order, or a line of code where it reads
// more than one node.
import { refuse, refuseLog } from './query-refusals.ts';
import type { RefusalId, LogRefusalId } from './query-refusals.ts';
import { MAX_COLUMNS } from './search-bounds.ts';
import { isEqual } from 'lodash-es';
import { BXL_FORMULA_FUNCTIONS } from '@cardstack/bxl/compiler';
import qs from 'qs';
import { assertJSONValue, assertJSONPrimitive } from './json-validation.ts';
import { InvalidQueryError } from '../invalid-query-error.ts';
import { parsePathSpecifier } from '../path-specifier.ts';
import {
  type FilterOperatorName,
  type GrammarScopeName,
  grammarHints,
  grammarMembers,
  isEngineForm,
  isWire,
  logMembers,
  refusedForLogs,
} from '../query-grammar.ts';
import {
  isObject,
  assertDistinctFacets,
  assertPlainQueryData,
  MAX_OLDER_QUERY_DEPTH,
  MAX_QUERY_DEPTH,
  hasOwn,
  lowerQuery,
  usesNewSyntax,
  assertExpressionText,
  assertExpressionLength,
  assertWindowTop,
  assertWindowCompareObject,
  assertWindowMembers,
  misnamedFormula,
} from './query-syntax.ts';
import {
  assertQueryExpressionProfile,
  checkExpressionSql,
} from './query-expression.ts';
import { isCodeRef } from '../index.ts';
import {
  generalSortFields,
  isMatchRelevanceSort,
  isNearSort,
  isBlendSort,
} from './sort-kinds.ts';
import { isVector, MAX_VECTOR_DIMENSIONS } from '../serializers/vector.ts';
import { isAbsoluteIdentifier, isPrefixForm } from '../realm-identifiers.ts';
import { resolveTypeReferences } from './type-reference.ts';
import {
  BINDING_NAME,
  RESERVED_BINDING_NAMES,
  internBindingReferences,
  unwrapLiterals,
} from './binding-reference.ts';
import { assertTimeZone } from './time-zone.ts';
import type {
  FacetRange,
  LetBinding,
  CardReferenceRole,
  Query,
} from './query.ts';
import {
  FACET_MEASURES,
  FACET_INTERVALS,
  MAX_FACETS,
  MAX_FACET_SIZE,
  MAX_FACET_RANGES,
  MAX_COLLAPSE_KEEP,
  MAX_LET_BINDINGS,
  isLogBinding,
  MAX_NEAR_PEERS,
  MAX_LET_ROWS,
  LET_NAME,
  mapLetReferences,
  compareFilterOf,
  letReferencesIn,
  mapCardReferences,
  PAGE_TOTAL_MODES,
  WHEN_SIGNAL_KEY,
  MAX_BLEND_COMPONENTS,
  RELEVANCE_SIGNALS,
  isRelevanceSort,
  EXPR_SORT_KEY,
  isExprSort,
  collectPositiveMatchTerms,
} from './query-values.ts';

export const MAX_IN_VALUES = 10_000;
export const MAX_OLDER_IN_VALUES = 65_000;
export const MAX_OLDER_TEXT_TERM_LENGTH = 99_999;
export const MAX_OLDER_SORT_ENTRIES = 800;
export const MAX_TEXT_TERM_LENGTH = 10_000;
export const MAX_SORT_ENTRIES = 64;
// 0-based
export const MAX_PAGE_NUMBER = 1_000_000_000;
export const MAX_BLEND_K = 1_000_000;
export const MAX_VECTOR_COMPONENT = 1_000_000_000;
// A field path: names joined by dots, such as `brand.name`.
export const FIELD_PATH = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/;

// Set while the older spelling is read: it ignores a member it doesn't know
// rather than refusing it (queries saved in realms carry them, `page.cursor`
// for one), and keeps its own, wider limits.
let older = false;
// Set while a log query is checked (`assertLogQuery`): the log source.
let logSource: LogQuerySource | undefined;

// ---- the rule walker --------------------------------------------------
// Where a refusal points: a JSON pointer's segments, or text as written.
type At = string | readonly string[];
const under = (at: At, member: string): At =>
  typeof at === 'string' ? `${at}/${member}` : [...at, member];

function need(
  holds: unknown,
  id: RefusalId,
  at?: At,
  values?: Record<string, unknown>,
): asserts holds {
  if (!holds) throw refuse(id, at, values);
}
function needLog(
  holds: unknown,
  id: LogRefusalId,
  values?: Record<string, unknown>,
): asserts holds {
  if (!holds) throw refuseLog(id, values);
}

// One rule of a node: what must hold, the refusal when it does not, the
// member it is reported at (the node itself when absent), and the values
// its message names.
type Values = Record<string, unknown>;
type Rule = readonly [
  holds: (node: any) => unknown,
  id: RefusalId,
  member?: string | null,
  values?: Values | ((node: any) => Values),
];
function check(node: any, rules: readonly Rule[], at: At) {
  for (let [holds, id, member, values] of rules) {
    if (holds(node)) continue;
    let named = typeof values === 'function' ? values(node) : values;
    throw refuse(id, member ? under(at, member) : at, named);
  }
}

// What a value may be. `maybe` passes a member that is `undefined`; a rule
// that reads `'name' in node` instead also holds one written as `undefined`.
const isString = (v: unknown): v is string => typeof v === 'string';
// an object or a list
const isRecord = (v: unknown): boolean => typeof v === 'object' && v != null;
const isBoolean = (v: unknown) => typeof v === 'boolean';
const isPath = (v: unknown) => isString(v) && FIELD_PATH.test(v);
const isDirection = (v: unknown) => v === 'asc' || v === 'desc';
const isFiniteNumber = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v);
const intIn = (v: unknown, min: number, max: number) =>
  Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
const maybe = (v: unknown, is: (v: any) => unknown) => v === undefined || is(v);
// a string is read as the whole number it spells, digits only
const wholeNumber = (v: unknown) =>
  typeof v === 'number'
    ? v
    : isString(v) && /^-?\d+$/.test(v)
      ? Number(v)
      : NaN;
const grouped = (n: number) => n.toLocaleString('en-US');

// ---- unknown members ---------------------------------------------------
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

function isSubsequence(a: string, b: string): boolean {
  let i = 0;
  for (let c of b) if (c === a[i]) i++;
  return i === a.length;
}
// The known member nearest an unknown one, if close enough to be a slip.
export function nearestMember(
  key: string,
  known: readonly string[],
): string | undefined {
  // a very long name is no slip of the keyboard
  if (key.length > 100) return undefined;
  // nearest by edit distance; ties go to a swap, then a dropped or extra
  // letter, then the same first letter, then `known`'s order
  let k0 = key.toLowerCase();
  let nearest = [...known]
    .map((k, order) => {
      let kl = k.toLowerCase();
      return {
        k,
        d: editDistance(kl, k0),
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
const didYouMean = (near: string | undefined) =>
  near ? `; did you mean "${near}"?` : '';

function unknownMember(
  at: At,
  key: string,
  known: readonly string[],
  what = 'member',
): InvalidQueryError {
  let hint =
    didYouMean(nearestMember(key, known)) || ` (known: ${known.join(', ')})`;
  return refuse('unknown', at, { what, key: key.slice(0, 80), hint });
}
// Refuses the first member of `value` that `known` does not list, naming
// the nearest of `hints` (in tie order); `what` names the kind of member.
function onlyMembers(
  value: object,
  known: readonly string[],
  at: At,
  what?: string,
  hints: readonly string[] = known,
) {
  let stray = Object.keys(value).find((key) => !known.includes(key));
  if (stray !== undefined) throw unknownMember(at, stray, hints, what);
}
// The same, where the older spelling ignores what it does not know.
function onlyMembersWhenNewer(value: object, known: readonly string[], at: At) {
  if (!older) onlyMembers(value, known, at);
}

// ---- the query ---------------------------------------------------------
const TOP_LEVEL_MEMBERS = [
  ...grammarMembers('query', isEngineForm),
  ...grammarMembers('query', isWire),
];
const TOP_LEVEL_HINTS = grammarHints('query', (m) => m.form !== 'entry');
const TOP_LEVEL_HINTS_AND_ENGINE = grammarMembers(
  'query',
  (m) => m.form !== 'entry',
);

// `query` with its filter and sort passed through `main`, and a rerank's
// comparison filter through `compare`; members keep their order.
function mapFilterPlaces(
  query: any,
  main: (part: { filter?: unknown; sort?: unknown }) => any,
  compare: (filter: any) => any,
) {
  let out = { ...query };
  if (query.filter || query.sort) {
    let probe = main({ filter: query.filter, sort: query.sort });
    if (query.filter) out.filter = probe.filter;
    if (query.sort) out.sort = probe.sort;
  }
  let filter = compareFilterOf(query);
  if (filter) {
    let c = { ...query.rerank.compare, filter: compare(filter) };
    out.rerank = { ...query.rerank, compare: c };
  }
  return out;
}

export function assertQuery(
  query: any,
  pointer: string[] = [''],
): asserts query is Query {
  need(isRecord(query), 'missing-query-object', pointer);
  let atTop = pointer.length === 1 && pointer[0] === '';
  // Plain JSON within the older spelling's bound before anything walks it;
  // a newer spelling is held to its own when it is lowered
  if (atTop) assertPlainQueryData(query, MAX_OLDER_QUERY_DEPTH);
  need(!Array.isArray(query), 'query-object-not-list', pointer);
  if (!atTop) return assertEngineQuery(query, pointer);
  // A type shorthand is checked as the code ref it stands for.
  let resolved = resolveTypeReferences(query);
  if (resolved !== query) return assertQuery(resolved, pointer);
  if (usesNewSyntax(query)) {
    // Lowered as the engine lowers it, so an unknown function in an
    // expression is refused here rather than when the query runs.
    let lowered = lowerQuery(query, { knownFunctions: BXL_FORMULA_FUNCTIONS });
    return assertEngineQuery(lowered.query, ['', '']);
  }
  older = true;
  try {
    assertEngineQuery(query, pointer);
  } finally {
    older = false;
  }
}

// A query in the engine form, at the top or as a binding's.
function assertEngineQuery(query: any, pointer: string[]) {
  let oneRealm = !('realm' in query && 'realms' in query);
  need(oneRealm, 'query-cannot-specify-both', pointer);
  // An unknown member first, so a misspelled `let` or `filter` is named as
  // the misspelling rather than as what its absence leads to.
  onlyMembers(query, TOP_LEVEL_MEMBERS, pointer, undefined, TOP_LEVEL_HINTS);

  // Bindings first; the rest is checked with each `"$name"` as an empty list.
  // A reference names a list binding as "$name", one card as "$name.path".
  query = internBindingReferences(query);
  if ('let' in query) assertLetBindings(query.let, pointer.concat('let'));
  let bindings = (query.let ?? {}) as Record<string, LetBinding>;
  for (let ref of letReferencesIn(query)) {
    let values = { let: ref.$let };
    need(maybe(ref.path, isString), 'reads-field-path-text', pointer, values);
    // a name every object inherits names no binding
    let binding = hasOwn(bindings, ref.$let) ? bindings[ref.$let] : undefined;
    if (!binding) {
      let near = didYouMean(nearestMember(ref.$let, Object.keys(bindings)));
      throw refuse('names-no-binding-let', pointer, { ...values, near });
    }
    if (Boolean(binding.one) !== (ref.path !== undefined)) {
      let kind: RefusalId = binding.one
        ? 'binding-is-one-card'
        : 'binding-is-a-list';
      throw refuse(kind, pointer, values);
    }
  }
  // A list binding goes only where the engine reads a whole list, as the one
  // value of an `in`; anywhere else it would match nothing.
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
    let isPlaced = ref.path !== undefined || placed.has(ref);
    need(isPlaced, 'list-binding-goes-only', pointer, { let: ref.$let });
  }
  // A one-card binding's references stand in as values of their role.
  let cards = new Set(
    Object.entries(bindings)
      .filter(([, b]) => b.one)
      .map(([n]) => n),
  );
  if (cards.size) {
    let placeholder = (_n: string, _p: string, role: CardReferenceRole) =>
      role === 'vector'
        ? [0]
        : role === 'bound'
          ? 0
          : role === 'text'
            ? 'x'
            : null;
    query = mapFilterPlaces(
      query,
      (part) => mapCardReferences(part as any, cards, placeholder),
      (filter) => mapCardReferences(filter, cards, placeholder),
    );
  }
  let empty = (part: any) =>
    mapLetReferences(part, (field, _name, node) => ({
      ...node,
      in: { [field]: [] },
    }));
  query = mapFilterPlaces(query, empty, (filter) => empty({ filter }).filter);
  query = unwrapLiterals(query);
  for (let [key, value] of Object.entries(query)) {
    if (!hasOwn(QUERY_MEMBER_CHECKS, key)) {
      throw unknownMember(pointer, key, TOP_LEVEL_HINTS_AND_ENGINE);
    }
    QUERY_MEMBER_CHECKS[key](value, pointer.concat(key), pointer);
  }
  let asData = !('fields' in query) || query.asData === true;
  need(asData, 'fields-requires-asdata-true', pointer);

  // A `_matchRelevance` sort needs a positive `matches` term; checked here so
  // it is a 400, not an engine 500 (the engine re-checks as a backstop).
  let ranksByText =
    Array.isArray(query.sort) &&
    query.sort.some(
      (s: any) =>
        isMatchRelevanceSort(s) ||
        (isBlendSort(s) && s.of.some(isMatchRelevanceSort)),
    );
  if (ranksByText && collectPositiveMatchTerms(query.filter).length === 0) {
    throw refuse('sort-textrelevance-requires-at', pointer);
  }
}

type MemberCheck = (value: any, at: string[], pointer: string[]) => void;
const ofType =
  (type: 'string' | 'boolean'): MemberCheck =>
  (value, at) =>
    need(typeof value === type, `must-be-a-${type}`, at, { name: at.at(-1) });

// Every member `TOP_LEVEL_MEMBERS` lists, checked in the query's own order.
const QUERY_MEMBER_CHECKS: Record<string, MemberCheck> = {
  filter: (value, at) => assertFilter(value, at),
  sort: (value, _at, pointer) =>
    assertSortList(
      value,
      pointer,
      older ? MAX_OLDER_SORT_ENTRIES : MAX_SORT_ENTRIES,
    ),
  queryString: ofType('string'),
  page: assertPage,
  realm: ofType('string'),
  realms: (value, at) =>
    need(
      Array.isArray(value) && value.every(isString),
      'realms-must-array-strings',
      at,
    ),
  fields: assertFields,
  facets: assertFacets,
  collapse: assertCollapse,
  let: () => {}, // checked before the references to it
  rerank: (value, _at, pointer) => assertRerank(value, pointer),
  timeZone: (value, at) => assertTimeZone(value, at.join('/') || '/'),
  explain: ofType('boolean'),
  asData: ofType('boolean'),
};

function assertFields(fields: any, pointer: string[]) {
  need(isObject(fields), 'fields-must-object-mapping', pointer);
  for (let [typeName, fieldNames] of Object.entries(fields)) {
    let at = pointer.concat(typeName);
    need(Array.isArray(fieldNames), 'fields-value-must-array', at);
    need(fieldNames.every(isString), 'each-field-name-must', at);
  }
}

// ---- sort --------------------------------------------------------------
const RERANK_MEMBERS = grammarMembers('window');
const COMPARE_MEMBERS = grammarMembers('compare');
// prettier-ignore
const COMPARE_RULES: Rule[] = [
  [(c) => maybe(c.near, isPath), 'near-names-vector-field'],
  [(c) => c.near === undefined || c.by === undefined, 'row-s-look-alikes'],
  [(c) => c.k === undefined || (c.near !== undefined && intIn(c.k, 1, MAX_NEAR_PEERS)), 'k-goes-with-near', null, { MAX_NEAR_PEERS }],
  [(c) => c.minSimilarity === undefined || (c.near !== undefined && typeof c.minSimilarity === 'number' && !(c.minSimilarity < -1) && !(c.minSimilarity > 1)), 'minsimilarity-goes-with-near'],
  [(c) => maybe(c.by, isPath), 'must-field-path-producttype'],
];

// The engine form of a leading `top` sort entry (query-syntax.ts), reported
// where it was written.
function assertRerank(value: any, pointer: string[]) {
  let at = pointer.concat('sort', '0').join('/');
  need(isObject(value), 'rerank-must-expression-top', at);
  let keys = Object.keys(value);
  let first = keys.find((k) => !RERANK_MEMBERS.includes(k));
  if (first === 'expr' || first === 'formula') throw misnamedFormula(at, first);
  assertWindowMembers(at, keys);
  assertExpressionText(`${at}/expression`, value.expression);
  assertExpressionLength(`${at}/expression`, value.expression);
  assertQueryExpressionProfile(`${at}/expression`, value.expression);
  assertWindowTop(`${at}/top`, value.top);
  assertWindowCompareObject(`${at}/compare`, value.compare);
  let c = value.compare;
  if (c !== undefined) {
    onlyMembers(c, COMPARE_MEMBERS, `${at}/compare`, 'comparison member');
    check(c, COMPARE_RULES, at);
    if (c.filter !== undefined) {
      assertFilter(c.filter, pointer.concat('sort', '0', 'compare', 'filter'));
    }
  }
  need(maybe(value.direction, isDirection), 'direction-must-asc-desc', at);
}

function assertSortList(
  sort: unknown,
  pointer: string[],
  maxSort: number,
  each?: (entry: any) => void,
) {
  let at = pointer.concat('sort');
  need(Array.isArray(sort), 'must-be-an-array', at, { name: 'sort' });
  let { length } = sort;
  need(length <= maxSort, 'sort-takes-at-most', at, { maxSort, length });
  sort.forEach((entry, i) => {
    assertSortExpression(entry, pointer.concat(`sort[${i}]`));
    each?.(entry);
  });
}

const SORT_ENTRY_HINTS = grammarHints('sortEntry');
const LOG_SORT_MEMBERS = logMembers('logSortEntry');
// What every sort entry holds past its `by`, typed or not.
// prettier-ignore
const SORT_ENTRY_RULES: Rule[] = [
  [(s) => Boolean(logSource) || s.by !== WHEN_SIGNAL_KEY, 'boost-ranks-only-inside'],
  [(s) => !('missing' in s) || s.missing === 'first' || s.missing === 'last', 'missing-first-last', 'missing'],
  [(s) => !('direction' in s) || isDirection(s.direction), 'direction-must-either-asc', 'direction'],
];
const assertOn = (node: any, pointer: string[]) => {
  if ('on' in node) assertCardType(node.on, pointer.concat('on'));
};

function assertSortExpression(sort: any, pointer: string[]) {
  need(isRecord(sort), 'missing-sort-object', pointer);
  if (logSource) refuseCardOnly(sort, 'logSortEntry', pointer);
  if (!('by' in sort)) {
    // In the newer spelling a misspelled member is named as the slip it is.
    let hints = logSource ? LOG_SORT_MEMBERS : SORT_ENTRY_HINTS;
    if (!older) onlyMembers(sort, hints, pointer, 'sort member');
    throw refuse('missing-object', pointer.concat('by'));
  }
  need(isString(sort.by), 'must-be-a-string', pointer.concat('by'), {
    name: 'by',
  });
  if (logSource) onlyMembers(sort, LOG_SORT_MEMBERS, pointer, 'sort member');
  check(sort, SORT_ENTRY_RULES, pointer);
  if (logSource) return;
  if (isRelevanceSort(sort)) return assertRelevanceSort(sort, pointer);
  if (isExprSort(sort)) {
    let expr = (sort as any).expr;
    onlyMembers(
      sort,
      ['by', 'expr', 'on', 'direction', 'weight'],
      pointer,
      'expression sort member',
      ['expression', 'direction', 'weight', 'top', 'compare', 'on'],
    );
    need(isString(expr), 'expr-must-formula-rating', pointer.concat('expr'));
    assertOn(sort, pointer);
    assertQueryExpressionProfile(pointer.concat('expr').join('/'), expr);
    // compiled on the server, parsed elsewhere (query-expression.ts)
    return checkExpressionSql(expr);
  }
  if (isNearSort(sort)) {
    need('on' in sort, 'near-sort-needs-object', pointer.concat('on'));
    // a near sort is a feature of its own: strict in both spellings
    onlyMembers(sort, ['by', 'on', 'near', 'direction', 'weight'], pointer);
    assertCardType(sort.on, pointer.concat('on'));
    return assertNearTarget(sort.near, pointer.concat('near'));
  }
  if (isBlendSort(sort)) return assertBlendSort(sort, pointer);
  // A relevance sort ignores `on`, but a present one must be well-formed.
  if (isMatchRelevanceSort(sort)) {
    onlyMembersWhenNewer(sort, ['by', 'on', 'direction', 'weight'], pointer);
    return assertOn(sort, pointer);
  }
  onlyMembersWhenNewer(
    sort,
    ['by', 'on', 'direction', 'missing', 'weight'],
    pointer,
  );
  if (!('on' in sort) && Object.keys(generalSortFields).includes(sort.by))
    return;
  need('on' in sort, 'missing-object-card-field', pointer.concat('on'), {
    by: sort.by,
  });
  assertCardType(sort.on, pointer.concat('on'));
}

function assertRelevanceSort(sort: any, pointer: string[]) {
  assertOn(sort, pointer);
  if ('near' in sort && sort.near != null) {
    assertNearTarget(sort.near, pointer.concat('near'));
  }
  if ('weights' in sort) {
    need(isObject(sort.weights), 'weights-must-object-signal', pointer);
    for (let [signal, weight] of Object.entries(sort.weights)) {
      let values = { signal, RELEVANCE_SIGNALS: RELEVANCE_SIGNALS.join(', ') };
      let known = (RELEVANCE_SIGNALS as readonly string[]).includes(signal);
      need(known, 'unknown-signal-expected', pointer, values);
      need(isFiniteNumber(weight), 'weight-must-finite-number', pointer, {
        signal,
      });
    }
  }
  onlyMembers(
    sort,
    ['by', 'on', 'near', 'weights', 'direction'],
    pointer,
    'relevance sort member',
    ['relevance', 'on', 'near', 'direction'],
  );
}

// The request grammar's blend members, and near misses naming another one.
const BLEND_MEMBERS = grammarMembers('blend');
const BLEND_MEMBER_ALIASES: Record<string, string> = {
  fusion: 'method',
  fuse: 'method',
  signals: 'blend',
};
// prettier-ignore
const BLEND_RULES: Rule[] = [
  [(s) => Array.isArray(s.of) && s.of.length > 0, 'blend-needs-array-sort'],
  [(s) => s.of.length <= MAX_BLEND_COMPONENTS, 'blend-fuses-at-most', null, (s) => ({ MAX_BLEND_COMPONENTS, length: s.of.length, _: s.of.slice(MAX_BLEND_COMPONENTS).map(signalName).join(', ') })],
  [(s) => !('method' in s) || s.method === 'rrf', 'blend-supports-method-rrf'],
  [(s) => !('k' in s) || intIn(s.k, 1, MAX_BLEND_K), 'k-must-whole-number', null, { US: grouped(MAX_BLEND_K) }],
];
// prettier-ignore
const BLEND_SIGNAL_RULES: Rule[] = [
  [isObject, 'blend-signal-sort-entry'],
  [(c) => !isBlendSort(c) && !('blend' in c), 'blend-cannot-contain-another'],
  [(c) => !isRelevanceSort(c), 'blend-cannot-contain-relevance'],
  [(c) => !('weight' in c) || (isFiniteNumber(c.weight) && c.weight !== 0), 'weight-must-nonzero-number'],
];
const signalName = (e: any) =>
  e?.by === EXPR_SORT_KEY
    ? `formula "${e.expr}"`
    : `"${String(e?.by ?? 'a signal').replace(/^_/, '')}"`;

function assertBlendSort(sort: any, pointer: string[]) {
  let stray = Object.keys(sort).find(
    (key) => !['by', 'of', 'method', 'k', 'direction'].includes(key),
  );
  if (stray !== undefined) {
    let alias = stray.toLowerCase();
    let near = hasOwn(BLEND_MEMBER_ALIASES, alias)
      ? BLEND_MEMBER_ALIASES[alias]
      : nearestMember(stray, BLEND_MEMBERS);
    throw refuse('unknown-blend-member-blend', pointer, {
      key: stray.slice(0, 80),
      near: didYouMean(near),
      BLEND_MEMBERS: BLEND_MEMBERS.join(', '),
    });
  }
  check(sort, BLEND_RULES, pointer);
  sort.of.forEach((signal: any, i: number) => {
    let at = pointer.concat('of', String(i));
    check(signal, BLEND_SIGNAL_RULES, at);
    if (signal.by !== WHEN_SIGNAL_KEY) return assertSortExpression(signal, at);
    onlyMembers(signal, ['by', 'when', 'weight'], at, 'boost member', [
      'boost',
      'weight',
    ]);
    need(isRecord(signal.when), 'boost-needs-filter', at);
    assertFilter(signal.when, at.concat('when'));
  });
}

// prettier-ignore
const NEAR_VECTOR_RULES: Rule[] = [
  [(v) => v.length >= 1 && v.length <= MAX_VECTOR_DIMENSIONS, 'near-must-have-from', null, { MAX_VECTOR_DIMENSIONS }],
  [(v) => v.every(isFiniteNumber), 'near-must-array-finite'],
  [(v) => !v.some((c: number) => Math.abs(c) > MAX_VECTOR_COMPONENT), 'vector-component-at-most', null, { US: grouped(MAX_VECTOR_COMPONENT) }],
];
function assertNearTarget(near: any, pointer: string[]) {
  if (Array.isArray(near)) return check(near, NEAR_VECTOR_RULES, pointer);
  need(isVector(near), 'near-must-array-numbers', pointer);
}

// ---- page --------------------------------------------------------------
const PAGE_MEMBERS = grammarMembers('page');
const LOG_PAGE_MEMBERS = logMembers('logPage');
// size 0 asks for counts and facets only; a negative size is clamped to the
// default in the older spelling, as it always was
// prettier-ignore
const PAGE_RULES: Rule[] = [
  [(p) => !('total' in p) || (PAGE_TOTAL_MODES as readonly unknown[]).includes(p.total), 'total', 'total', { PAGE_TOTAL_MODES: PAGE_TOTAL_MODES.join(', ') }],
  [(p) => !('exactTotal' in p) || isBoolean(p.exactTotal), 'exacttotal-true-false', 'exactTotal'],
  [(p) => !('exactNear' in p) || isBoolean(p.exactNear), 'exactnear-true-false', 'exactNear'],
  [(p) => !('size' in p) || (Number.isInteger(wholeNumber(p.size)) && (older || wholeNumber(p.size) >= 0)), 'size-must-whole-number', 'size'],
  [(p) => !('number' in p) || intIn(wholeNumber(p.number), 0, MAX_PAGE_NUMBER), 'number-0-based-page', 'number', { US: grouped(MAX_PAGE_NUMBER) }],
];
function assertPage(page: any, pointer: string[]) {
  need(isObject(page), 'page-must-object-size', pointer);
  onlyMembersWhenNewer(
    page,
    logSource ? LOG_PAGE_MEMBERS : PAGE_MEMBERS,
    pointer,
  );
  check(page, PAGE_RULES, pointer);
}

// ---- filter ------------------------------------------------------------
// Each operator's validator, in canonical order (query-grammar.ts);
// `assertFilter` derives its operator list and dispatch from this one map.
type FilterCheck = (filter: any, pointer: string[]) => void;
const FILTER_OPERATOR_ASSERTS: Record<FilterOperatorName, FilterCheck> = {
  any: (f, p) => assertFilters(f.any, 'any', p.concat('any')),
  every: (f, p) => assertFilters(f.every, 'every', p.concat('every')),
  not: (f, p) => assertFilter(f.not, p.concat('not')),
  eq: (f, p) => assertValuesAt(f, p, 'eq'),
  in: assertInFilter,
  contains: (f, p) => assertValuesAt(f, p, 'contains'),
  range: assertRangeFilter,
  matches: (f, p) => check(f, MATCHES_RULES, p),
  near: assertNearFilter,
  linkedFrom: (f, p) => assertLinkedFrom(f.linkedFrom, p.concat('linkedFrom')),
  pattern: (f, p) => assertStringKeyedFilter(f, p, 'pattern'),
  regex: (f, p) => assertStringKeyedFilter(f, p, 'regex'),
  paths: assertPathsFilter,
};

// A `paths` filter: realm path prefixes, as main's grammar reads them.
function assertPathsFilter(filter: any, pointer: string[]): void {
  let pathsPointer = pointer.concat('paths');
  if (
    !Array.isArray(filter.paths) ||
    filter.paths.some((path: unknown) => typeof path !== 'string')
  ) {
    throw new InvalidQueryError(
      `${pathsPointer.join('/')}: paths must be a list of path prefixes`,
      'invalid-value',
    );
  }
  let parsed = parsePathSpecifier(filter.paths);
  if (!parsed.ok) {
    let [first] = parsed.errors;
    throw new InvalidQueryError(
      `${pathsPointer.concat(String(first.prefixIndex)).join('/')}: ${first.message}`,
      'invalid-value',
    );
  }
}
const FILTER_OPERATORS = Object.keys(
  FILTER_OPERATOR_ASSERTS,
) as FilterOperatorName[];

// The operator keys on a filter node, in canonical order. The client-side
// matcher (`isClientEvaluable`) reads this too, so both sides agree.
export function filterOperators(filter: object): string[] {
  return FILTER_OPERATORS.filter((key) => key in filter);
}

// What may sit beside a filter's operator: type anchor, `matches` options.
const FILTER_MODIFIERS = grammarMembers('filter', (m) => m.role === 'modifier');
// the authored options of `matches`, refused beside any other operator
const MATCHES_OPTIONS = grammarMembers(
  'filter',
  (m) => m.role === 'modifier' && m.spelling === 'newer',
);
// What a misspelled filter member is matched against: the operators (and
// `exists`, `missing`), then authored options; never engine annotations.
const FILTER_MEMBER_HINTS = grammarHints('filter');
const LOG_FILTER_OPERATORS = logMembers('logFilter');

function assertFilter(filter: any, pointer: string[]) {
  need(isRecord(filter), 'missing-filter-object', pointer);
  need(!Array.isArray(filter), 'filter-object-not-list', pointer);
  if (!logSource) {
    if ('type' in filter) {
      assertCardType(filter.type, pointer.concat('type'));
      // a pure card type filter
      if (isEqual(Object.keys(filter), ['type'])) return;
    }
    assertOn(filter, pointer);
  }
  if ('typeahead' in filter) throw typeAheadRefusal(pointer);
  if (logSource) refuseCardOnly(filter, 'logFilter', pointer);

  // The validator, SQL compiler and client matcher each pick one operator in
  // their own order, so all three refuse a node holding several.
  let operators = logSource
    ? LOG_FILTER_OPERATORS.filter((key) => key in filter)
    : filterOperators(filter);
  need(operators.length <= 1, 'filter-may-use-only', pointer, {
    key: operators.map((key) => `"${key}"`).join(', '),
  });
  let operator = operators[0];
  // the older spelling ignores a member it does not know, but a node with
  // no operator at all is refused, naming what it holds instead
  if (logSource || !older || !operator) {
    onlyMembers(
      filter,
      logSource ? [operator] : [operator, ...FILTER_MODIFIERS],
      pointer,
      undefined,
      logSource ? LOG_FILTER_OPERATORS : FILTER_MEMBER_HINTS,
    );
  }
  for (let option of operator === 'matches' ? [] : MATCHES_OPTIONS) {
    let id = `${option}-belongs-beside-matches` as RefusalId;
    need(!(option in filter), id, pointer.concat(option));
  }
  need(operator, 'filter-needs-operator-eq', pointer);
  if (operator === 'exists' || operator === 'missing') {
    need(isString(filter[operator]), 'filter-takes-field-path', undefined, {
      k: operator,
    });
    return logSource!.path(filter[operator]);
  }
  FILTER_OPERATOR_ASSERTS[operator as FilterOperatorName](filter, pointer);
  if (logSource) assertLineValues(filter, operator, logSource);
}

// What a line can hold at each path a log filter's operator names.
function assertLineValues(
  filter: any,
  operator: string,
  source: LogQuerySource,
) {
  if (operator === 'every' || operator === 'any' || operator === 'not') return;
  for (let [path, value] of Object.entries(filter[operator])) {
    source.path(path);
    if (operator === 'eq') {
      source.value(path, value);
    } else if (operator === 'in') {
      (value as unknown[]).forEach((item) => source.value(path, item));
    } else if (operator === 'range') {
      for (let [bound, limit] of Object.entries(value as object)) {
        source.value(path, limit, bound);
      }
    }
  }
}

// A module some realm can resolve: an identifier (`https://…`, or the
// prefix form naming a scope and a package, `@scope/name/…`).
const isResolvable = (id: string, isPrefixed: (id: string) => boolean) =>
  /^https?:\/\/[^/]/.test(id) || (isPrefixed(id) && /^@[^/]+\/[^/]+/.test(id));

function assertCardType(type: any, pointer: string[]) {
  need(isCodeRef(type), 'type-not-valid', pointer);
  if ('type' in type) return;
  // An empty module passes the shape check but the engine throws on it; a
  // model filling every property sends `{ module: '', name: '' }` for none.
  need(type.module !== '' && type.name !== '', 'module-name-must-not', pointer);
  // or one relative to the caller's module (`./`, `../`, `$REALM/`)
  let named =
    isResolvable(type.module, isAbsoluteIdentifier) ||
    /^(\.\.?\/|\$REALM\/)/.test(type.module);
  need(named, 'module-names-no-module', pointer, {
    module: String(type.module).slice(0, 80),
  });
}

// An operand keyed by field paths, as its entries; none wrapped in brackets.
function pathsOf(filter: any, op: string, at: string[]) {
  let v = filter[op];
  if (!isObject(v)) {
    let value = Array.isArray(v) ? 'a list' : JSON.stringify(v);
    throw refuse('operator-keyed-by-paths', at, { op, value });
  }
  return Object.entries(v);
}

function assertFilters(filters: unknown, op: string, at: string[]) {
  need(Array.isArray(filters), 'operator-takes-filters', at, { op });
  filters.forEach((f, i) => assertFilter(f, at.concat(`[${i}]`)));
}

// `eq` and `contains`: a JSON value at each field path.
function assertValuesAt(filter: any, pointer: string[], op: string) {
  let at = pointer.concat(op);
  pathsOf(filter, op, at).forEach(([key, value]) => {
    assertKey(key, at);
    assertJSONValue(value, at.concat(key));
  });
}

function assertInFilter(filter: any, pointer: string[]) {
  let at = pointer.concat('in');
  let max = older ? MAX_OLDER_IN_VALUES : MAX_IN_VALUES;
  pathsOf(filter, 'in', at).forEach(([key, value]) => {
    assertKey(key, at);
    need(Array.isArray(value), 'values-must-arrays', at.concat(key));
    need(value.length <= max, 'list-holds-at-most', at.concat(key), {
      US: grouped(max),
      US2: grouped(value.length),
    });
    value.forEach((item, index) => {
      assertJSONValue(item, at.concat(key, `[${index}]`));
    });
  });
}

const RANGE_BOUNDS = grammarMembers('rangeBound');
function assertRangeFilter(filter: any, pointer: string[]) {
  let at = pointer.concat('range');
  pathsOf(filter, 'range', at).forEach(([fieldPath, constraints]) => {
    let inner = [...at, fieldPath];
    need(isRecord(constraints), 'range-constraint-must-object', inner);
    Object.entries(constraints).forEach(([key, value]) => {
      if (!RANGE_BOUNDS.includes(key)) {
        throw unknownMember(inner, key, RANGE_BOUNDS, 'range bound');
      }
      assertJSONPrimitive(value, inner.concat(key));
      if (value === null || isBoolean(value)) {
        let values = { value: String(value) };
        throw refuse('range-bound-number-date', inner.concat(key), values);
      }
    });
  });
}

const has =
  (...names: string[]) =>
  (node: object) =>
    names.some((n) => n in node);
// A `matches` term and the options beside it.
// prettier-ignore
const MATCHES_RULES: Rule[] = [
  [(f) => isString(f.matches), 'must-be-a-string', 'matches', { name: 'matches' }],
  [(f) => f.matches.length <= maxTextTerm(), 'term-at-most-characters', 'matches', (f) => ({ member: 'matches', US: grouped(maxTextTerm()), US2: grouped(f.matches.length) })],
  [(f) => !('within' in f) || (isString(f.within) && /^[A-Za-z_$][\w$]*$/.test(f.within)), 'within-must-name-top', 'within'],
  [(f) => !('prefix' in f) || isBoolean(f.prefix), 'must-be-a-boolean', 'prefix', { name: 'prefix' }],
  [(f) => !('typos' in f) || isBoolean(f.typos), 'must-be-a-boolean', 'typos', { name: 'typos' }],
  [(f) => !('typoQuery' in f), 'set-engine', 'typoQuery', { internal: 'typoQuery' }],
  [(f) => !('typoPartial' in f), 'set-engine', 'typoPartial', { internal: 'typoPartial' }],
  [(f) => !('scope' in f) || f.scope === 'title', 'scope-must-title', 'scope'],
  [(f) => !('scope' in f && 'within' in f), 'matches-term-takes-scope'],
  [(f) => !('fields' in f) || (Array.isArray(f.fields) && f.fields.length > 0 && f.fields.every(isPath)), 'fields-must-list-1', 'fields'],
  [(f) => !('fields' in f) || f.fields.length <= 8, 'fields-lists-at-most', 'fields', (f) => ({ length: f.fields.length })],
  [(f) => !('fields' in f) || !has('scope', 'within', 'prefix')(f), 'matches-term-with-fields'],
];
const maxTextTerm = () =>
  older ? MAX_OLDER_TEXT_TERM_LENGTH : MAX_TEXT_TERM_LENGTH;

// Any form a card reference takes (ADR 002): an absolute URL, a prefix id,
// or `$REALM/<path>`, resolved against the query's realm.
const isCardReference = (card: unknown) =>
  isString(card) &&
  !/\s/.test(card) &&
  (isResolvable(card, isPrefixForm) ||
    (card.startsWith('$REALM/') && card.length > '$REALM/'.length));
const LINKED_FROM_MEMBERS = grammarMembers('linkedFrom');
function assertLinkedFrom(v: any, at: string[]) {
  need(isObject(v), 'linkedfrom-must-card-field', at);
  onlyMembers(v, LINKED_FROM_MEMBERS, at, 'linkedFrom member');
  need(isCardReference(v.card), 'card-must-card-s', at);
  need(isPath(v.field), 'field-must-name-link', at);
}

function assertStringKeyedFilter(
  filter: any,
  pointer: string[],
  operator: string,
) {
  let at = pointer.concat(operator);
  let value = filter[operator];
  need(isObject(value), 'must-object-field-paths', at, { operator });
  let entries = Object.entries(value);
  need(entries.length > 0, 'needs-field', at, { operator });
  for (let [key, v] of entries) {
    assertKey(key, at);
    need(isString(v) && v !== '', 'must-non-empty-string', at.concat(key), {
      operator,
    });
  }
}

const NEAR_TARGET_MEMBERS = grammarMembers('nearTarget');
function assertNearFilter(filter: any, pointer: string[]) {
  let at = pointer.concat('near');
  need(isObject(filter.near), 'near-must-object-keyed', at);
  let entries = Object.entries(filter.near);
  need(entries.length === 1, 'near-takes-exactly-field', at);
  let [path, value] = entries[0] as [string, any];
  assertKey(path, at);
  need(isObject(value), 'expected-vector-minsimilarity-number', at, { path });
  let stray = Object.keys(value).find((k) => !NEAR_TARGET_MEMBERS.includes(k));
  if (stray !== undefined) {
    let near =
      stray === 'k' ? undefined : nearestMember(stray, NEAR_TARGET_MEMBERS);
    throw refuse('unknown-member-near-takes', at, {
      path,
      key: stray.slice(0, 80),
      near: didYouMean(near),
    });
  }
  need('to' in value, 'expected-vector-minsimilarity-number', at, { path });
  assertNearTarget(value.to, at.concat(path, 'to'));
  let min = value.minSimilarity;
  let inRange = typeof min === 'number' && min >= -1 && min <= 1;
  if ('minSimilarity' in value && !inRange) {
    throw refuse('minsimilarity-must-number-from', at, { path });
  }
}

export function assertKey(key: string, pointer: string[]) {
  let wrapped = key.startsWith('[') && key.endsWith(']');
  need(!wrapped, 'field-names-cannot-wrapped', pointer.join('/'), { key });
}

// `typeahead` was an operator of earlier drafts; type-ahead is written
// `{ matches, prefix: true, scope: 'title' }`, which answers the same.
export function typeAheadRefusal(pointer: string[]): InvalidQueryError {
  return refuse('typeahead-not-filter-operator', pointer.concat('typeahead'));
}

// Refuses `typeahead` wherever a filter goes. The engine runs an internal
// node of that name, so this checks before it rewrites. Walks only filters,
// so a field named "typeahead" inside an `eq` is a field.
export function assertNoTypeAheadOperator(query: unknown): void {
  let walkFilter = (node: any, pointer: string[]): void => {
    if (!isObject(node)) return;
    if ('typeahead' in node) throw typeAheadRefusal(pointer);
    for (let op of ['every', 'any']) {
      if (!Array.isArray(node[op])) continue;
      node[op].forEach((n: any, i: number) =>
        walkFilter(n, pointer.concat(op, String(i))),
      );
    }
    if (node.not) walkFilter(node.not, pointer.concat('not'));
  };
  let walkSort = (sort: any, pointer: string[]) => {
    if (!Array.isArray(sort)) return;
    sort.forEach((s: any, i: number) => {
      if (!isObject(s)) return;
      let at = pointer.concat(String(i));
      for (let key of ['of', 'blend']) {
        if (!Array.isArray(s[key])) continue;
        s[key].forEach((c: any, k: number) => {
          if (!isObject(c)) return;
          if (c.when) walkFilter(c.when, at.concat(key, String(k), 'when'));
          if (c.boost) walkFilter(c.boost, at.concat(key, String(k), 'boost'));
        });
      }
      if (isObject(s.compare)) {
        walkFilter(s.compare.filter, at.concat('compare', 'filter'));
      }
    });
  };
  let q = query as any;
  if (!q || typeof q !== 'object') return;
  walkFilter(q.filter, ['filter']);
  walkSort(q.sort, ['sort']);
  walkFilter(q.rerank?.compare?.filter, ['rerank', 'compare', 'filter']);
  if (!q.let || typeof q.let !== 'object') return;
  for (let [name, b] of Object.entries(q.let as Record<string, any>)) {
    if (!b || typeof b !== 'object' || !b.from || typeof b.from !== 'object') {
      continue;
    }
    walkFilter(b.from.filter, ['let', name, 'from', 'filter']);
    walkSort(b.from.sort, ['let', name, 'from', 'sort']);
  }
}

// ---- let ---------------------------------------------------------------
const BINDING_MEMBERS = grammarMembers('binding');
const BINDING_QUERY_MEMBERS = grammarMembers('bindingQuery', isEngineForm);
const BINDING_QUERY_HINTS = grammarMembers('bindingQuery');
const isRowLimit = (page: unknown) =>
  isObject(page) &&
  Object.keys(page).every((k) => k === 'size') &&
  intIn(page.size, 1, MAX_LET_ROWS);

function assertLetBindings(lets: any, pointer: string[]) {
  need(isObject(lets), 'let-must-map-names', pointer);
  let names = Object.keys(lets);
  if (!intIn(names.length, 1, MAX_LET_BINDINGS)) {
    throw refuse('let-takes-1-bindings', pointer, { MAX_LET_BINDINGS });
  }
  for (let name of names) {
    let at = pointer.concat(name);
    let b = lets[name];
    if (RESERVED_BINDING_NAMES.has(name)) {
      let literal =
        name === '$this'
          ? 'the card a query-backed field belongs to'
          : 'the escape for literal text, { "$literal": "…" }';
      throw refuse('reserved-name-binding-otherwise', at, { name, literal });
    }
    if (!BINDING_NAME.test(name)) {
      let id: RefusalId = LET_NAME.test(name)
        ? 'binding-declared-with-its-dollar'
        : 'binding-name-shape';
      throw refuse(id, at, { name });
    }
    need(isObject(b), 'binding-from-select', at);
    onlyMembers(b, BINDING_MEMBERS, at, 'binding member');
    if (isLogBinding(b)) {
      assertLogBinding(b, at);
      continue;
    }
    if ('one' in b)
      need(b.one === true && !('select' in b), 'binding-from-select-for', at);
    else need(isPath(b.select), 'select-must-field-path', at.concat('select'));
    let from = b.from;
    let fromAt = at.concat('from');
    need(isObject(from), 'from-must-query-with', fromAt);
    onlyMembers(
      from,
      BINDING_QUERY_MEMBERS,
      fromAt,
      "binding's query member",
      BINDING_QUERY_HINTS,
    );
    if (from.timeZone !== undefined) {
      assertTimeZone(from.timeZone, fromAt.concat('timeZone').join('/'));
    }
    need(from.filter !== undefined, 'from-needs-filter', fromAt);
    if (!maybe(from.page, isRowLimit)) {
      throw refuse('page-size-from-1', fromAt.concat('page'), { MAX_LET_ROWS });
    }
    let inner: any = {
      filter: from.filter,
      ...(from.sort ? { sort: from.sort } : {}),
    };
    // a declared name read anywhere in it, a list where a value goes too
    let nested = letReferencesIn(inner).length > 0;
    mapLetReferences(inner, (_f, _n, node) => {
      nested = true;
      return node;
    });
    mapCardReferences(inner, new Set(names), () => {
      nested = true;
      return null;
    });
    need(!nested, 'binding-s-query-cannot', fromAt);
    assertQuery(inner, fromAt);
  }
}

// prettier-ignore
const LOG_BINDING_SOURCE_RULES: Rule[] = [
  [(from) => !('log' in from && 'logs' in from), 'from-takes-log-logs'],
  [(from) => !('log' in from) || isString(from.log), 'log-names-log-file', 'log'],
  [(from) => maybe(from.filter, isObject), 'log-filter-object', 'filter'],
];
// A binding read from a log: its shape here, its log query when it runs
// (`logBindingValues`, which refuses what the log grammar does not take).
function assertLogBinding(b: any, at: string[]) {
  let from = b.from;
  let fromAt = at.concat('from');
  onlyMembers(
    from,
    grammarMembers('logBinding'),
    fromAt,
    "log binding's member",
  );
  need(!('one' in b), 'binding-read-from-log', at);
  need(!('select' in b && 'select' in from), 'select-written-once-beside', at);
  let select = b.select ?? from.select;
  if (!isPath(select)) {
    let id: RefusalId =
      select === undefined ? 'log-select-missing' : 'log-select-invalid';
    throw refuse(id, at.concat('select'));
  }
  check(from, LOG_BINDING_SOURCE_RULES, fromAt);
}

// ---- collapse and facets -----------------------------------------------
const COLLAPSE_MEMBERS = grammarMembers('collapse');
function assertCollapse(collapse: any, pointer: string[]) {
  let shape = isString(collapse) ? { by: collapse } : collapse;
  need(isObject(shape), 'collapse-must-field-path', pointer);
  onlyMembers(shape, COLLAPSE_MEMBERS, pointer, 'collapse member');
  need(isPath(shape.by), 'must-field-path-producttype-2', pointer);
  if (shape.on !== undefined) assertCardType(shape.on, pointer.concat('on'));
  if (!maybe(shape.keep, (k) => intIn(k, 1, MAX_COLLAPSE_KEEP))) {
    throw refuse('keep-must-integer-from', pointer, { MAX_COLLAPSE_KEEP });
  }
}

const FACET_MEMBERS = grammarMembers('facet');
const LOG_FACET_MEMBERS = logMembers('logFacet');
const FACET_RANGE_MEMBERS = grammarMembers('facetRange');
// The field a well-shaped measure names: `{ <measure>: "<field>" }`.
const measured = (m: unknown): unknown => {
  let keys = isObject(m) ? Object.keys(m) : [];
  let known = (FACET_MEASURES as readonly string[]).includes(keys[0]);
  return keys.length === 1 && known ? (m as any)[keys[0]] : undefined;
};
const isBound = (v: unknown) => isString(v) || isFiniteNumber(v);
// prettier-ignore
const FACET_RULES: Rule[] = [
  [(f) => maybe(f.own, (v) => v === 'ignore'), 'own-must-ignore'],
  [(f) => maybe(f.stats, isBoolean), 'must-boolean', null, { flag: 'stats' }],
  [(f) => maybe(f.missing, isBoolean), 'must-boolean', null, { flag: 'missing' }],
  [(f) => maybe(f.prefix, isString), 'prefix-must-string'],
  [(f) => maybe(f.order, (v) => ['count', 'value', 'measure'].includes(v)), 'order-must-count-value'],
  [(f) => maybe(f.measure, (m) => isString(measured(m))), 'measure-must', null, { field: FACET_MEASURES.map((k) => `{ ${k}: "<field>" }`).join(', ') }],
  // the shape is right, but the field is no path or label `by` would take
  [(f) => maybe(f.measure, (m) => isPath(measured(m))), 'not-field-path-write', null, (f) => ({ keys: JSON.stringify(measured(f.measure)) })],
  [(f) => f.measure === undefined || (f.ranges === undefined && f.interval === undefined), 'measure-counts-values-takes'],
  [(f) => f.order !== 'measure' || f.measure !== undefined, 'order-measure-needs-measure'],
  [(f) => maybe(f.interval, (v) => (FACET_INTERVALS as readonly unknown[]).includes(v)), 'interval-must', null, { FACET_INTERVALS: FACET_INTERVALS.join(', ') }],
  [(f) => f.ranges === undefined || f.interval === undefined, 'facet-takes-ranges-interval'],
  [(f) => maybe(f.ranges, (r) => Array.isArray(r) && r.length > 0), 'ranges-must-list-1', null, { MAX_FACET_RANGES }],
  [(f) => maybe(f.ranges, (r) => r.length <= MAX_FACET_RANGES), 'ranges-lists-at-most', null, (f) => ({ MAX_FACET_RANGES, length: f.ranges.length })],
];
// prettier-ignore
const FACET_RANGE_RULES: Rule[] = [
  [(r) => r.from !== undefined || r.to !== undefined, 'range-needs-from'],
  [(r) => maybe(r.from, isBound), 'bound-must-number-string', null, { end: 'from' }],
  [(r) => maybe(r.to, isBound), 'bound-must-number-string', null, { end: 'to' }],
  [(r) => r.from === undefined || r.to === undefined || typeof r.from === typeof r.to, 'from-must-both-numbers'],
  [(r) => maybe(r.key, isString), 'key-must-string'],
];

function assertFacets(facets: any, pointer: string[]) {
  let where = pointer.join('/') || '/';
  need(Array.isArray(facets), 'must-be-an-array', where, { name: 'facets' });
  need(facets.length <= MAX_FACETS, 'query-takes-at-most', where, {
    MAX_FACETS,
  });
  facets.forEach((facet, i) => {
    let at = `${where}[${i}]`;
    need(isObject(facet), 'facet-must-object', at);
    if (logSource) refuseCardOnly(facet, 'logFacet', at);
    onlyMembers(
      facet,
      logSource ? LOG_FACET_MEMBERS : FACET_MEMBERS,
      at,
      'facet member',
    );
    check(facet, FACET_RULES, at);
    (facet.ranges ?? []).forEach((range: unknown, j: number) => {
      let rangeAt = `${at}/ranges[${j}]`;
      need(isObject(range), 'range-must-object', rangeAt);
      onlyMembers(range, FACET_RANGE_MEMBERS, rangeAt, 'facet range member');
      check(range, FACET_RANGE_RULES, rangeAt);
    });
    need(isPath(facet.by), 'must-field-path-category', at);
    logSource?.path(facet.by);
    if (!maybe(facet.size, (s) => intIn(s, 1, MAX_FACET_SIZE))) {
      throw refuse('size-must-integer-from', at, { MAX_FACET_SIZE });
    }
  });
  assertDistinctFacets(facets, where);
}

// A range bucket's label: its `key`, or "from-to" with `*` for an open end.
export function facetRangeLabel(range: FacetRange): string {
  return range.key ?? `${range.from ?? '*'}-${range.to ?? '*'}`;
}

export const parseQuery = (queryString: string) => {
  return qs.parse(queryString, {
    depth: 10,
    strictDepth: true,
    strictNullHandling: true,
  });
};

// ---- log queries ------------------------------------------------------
// A log query is checked by this validator, with the log source's profile
// (the `log*` scopes of query-grammar.ts): the card walker, operators,
// unknown-member and one-operator rules, in its order and wording. A card
// query's member a log query lacks is `not-supported-for-logs`. What only a
// log query has (`from`, `select`, `group`) is checked here too; the source
// says which paths and column values a line can hold (log-query.ts).
export interface LogQuerySource {
  // refuses a path a line cannot have
  path(path: unknown): void;
  // refuses a value the column at `path` cannot hold (a range passes its
  // bound's name)
  value(path: string, value: unknown, bound?: string): void;
}

export const LOG_MAX_GROUP_BY = 8;
export const LOG_MAX_AGGREGATES = 32;
// logs one query reads, named or under a folder
export const LOG_MAX_FILES = 100;

const LOG_AGGREGATES = logMembers('logAggregate');

// Refuses the first member of `value` its log scope does not take: a card
// query's as `not-supported-for-logs`, any other as unknown.
function logScopeMembers(
  value: object,
  scope: GrammarScopeName,
  pointer: string[],
) {
  refuseCardOnly(value, scope, pointer);
  onlyMembers(value, logMembers(scope), pointer);
}

function refuseCardOnly(value: object, scope: GrammarScopeName, at: At) {
  for (let key of Object.keys(value)) {
    let why = refusedForLogs(scope, key);
    need(why === undefined, 'not-supported-for-logs', at, { key, why });
  }
}

export function assertLogQuery(query: any, source: LogQuerySource): void {
  assertPlainQueryData(query, MAX_QUERY_DEPTH);
  need(typeof query === 'object' && query != null, 'missing-query-object', [
    '',
  ]);
  need(!Array.isArray(query), 'query-object-not-list', ['']);
  refuseCardOnly(query, 'logQuery', ['']);
  // `rerank` is refused as the card grammar refuses it
  let stray = Object.keys(query).find((k) => !LOG_QUERY_MEMBERS.includes(k));
  if (stray === 'rerank') throw refuse('rerank-not-a-member');
  onlyMembers(query, LOG_QUERY_MEMBERS, ['']);
  logSource = source;
  try {
    assertLogFrom(query.from);
    for (let [key, value] of Object.entries(query)) {
      // `undefined` reads as absent (`assertPlainQueryData`)
      if (value !== undefined)
        LOG_MEMBER_CHECKS[key]?.(value, ['', key], query);
    }
    if (query.group !== undefined) assertGroupedSort(query.group, query.sort);
  } finally {
    logSource = undefined;
  }
}

const LOG_QUERY_MEMBERS = logMembers('logQuery');
// A log query's members past `from`, checked in the query's own order.
const LOG_MEMBER_CHECKS: Record<
  string,
  (value: any, at: string[], query: any) => void
> = {
  timeZone: (value, at) => assertTimeZone(value, at.join('/')),
  filter: (value, at) => assertFilter(value, at),
  // a grouped query sorts by its keys and aggregates (`assertGroupedSort`)
  sort: (value, _at, query) =>
    assertSortList(value, [''], MAX_SORT_ENTRIES, (entry) => {
      if (query.group === undefined) logSource!.path(entry.by);
    }),
  page: assertPage,
  facets: assertFacets,
  select(value, _at, query) {
    needLog(Array.isArray(value), 'log-select-list-paths');
    needLog(query.group === undefined, 'log-select-group-are-separate-shapes');
    let values = { length: value.length, MAX_COLUMNS };
    let fits = value.length <= MAX_COLUMNS;
    needLog(fits, 'log-select-lists-paths-query-selects', values);
    value.forEach((path) => logSource!.path(path));
  },
  group: assertLogGroup,
};

function assertLogFrom(from: any) {
  needLog(isObject(from), 'log-query-object-with-from-from');
  logScopeMembers(from, 'logFrom', ['', 'from']);
  let both = 'log' in from && 'logs' in from;
  needLog(!both, 'log-from-takes-one-logs-several');
  if ('log' in from) return needLog(isString(from.log), 'log-from-names-file');
  let logs = from.logs;
  if (Array.isArray(logs)) {
    let { length } = logs;
    needLog(length > 0, 'log-from-logs-names-at-least');
    needLog(length <= LOG_MAX_FILES, 'log-from-logs-names-logs-query', {
      length,
      LOG_MAX_FILES,
    });
    return logs.forEach((log, i) =>
      needLog(isString(log), 'log-from-logs-names-file', { i }),
    );
  }
  needLog(isObject(logs), 'log-from-logs-list-logs-under');
  logScopeMembers(logs, 'logFolder', ['', 'from', 'logs']);
  needLog(logs.under !== undefined, 'log-from-logs-under-names-folder');
  needLog(isString(logs.under), 'log-from-logs-under-names-folder-2');
}

function assertLogGroup(group: any) {
  needLog(isObject(group), 'log-group-object-by-aggregates');
  logScopeMembers(group, 'logGroup', ['', 'group']);
  let by: unknown = group.by;
  needLog(by !== undefined, 'log-group-by-names-path-list');
  needLog(isString(by) || Array.isArray(by), 'log-group-by-names-path-list-2');
  let paths: unknown[] = Array.isArray(by) ? by : [by];
  let { length } = paths;
  needLog(length > 0, 'log-group-by-names-at-least');
  needLog(length <= LOG_MAX_GROUP_BY, 'log-group-by-lists-paths-query', {
    length,
    LOG_MAX_GROUP_BY,
  });
  paths.forEach((path) => logSource!.path(path));
  needLog(new Set(paths).size === length, 'log-group-by-names-path-twice');
  let named = group.aggregates ?? {};
  needLog(isObject(named), 'log-group-aggregates-object-name-aggregate');
  let aggregates = Object.entries(named);
  if (aggregates.length > LOG_MAX_AGGREGATES) {
    let values = { length: aggregates.length, LOG_MAX_AGGREGATES };
    throw refuseLog('log-group-aggregates-names-query-takes', values);
  }
  let ops = LOG_AGGREGATES.join(', ');
  for (let [name, spec] of aggregates) {
    if (!/^[A-Za-z_]\w*$/.test(name)) {
      let values = { name: JSON.stringify(name.slice(0, 80)) };
      throw refuseLog('log-invalid-aggregate-name-name-letter', values);
    }
    needLog(isObject(spec), 'log-aggregate-one-as-op-path', { name, ops });
    let entries = Object.entries(spec);
    if (entries.length !== 1) {
      let id: LogRefusalId = entries.length
        ? 'log-aggregate-names-one-not-2'
        : 'log-aggregate-names-one-not';
      throw refuseLog(id, { name, ops, length: entries.length });
    }
    onlyMembers(spec, LOG_AGGREGATES, `/group/aggregates/${name}`, 'aggregate');
    let [op, path] = entries[0];
    if (!isString(path) && !(op === 'count' && path === true)) {
      let id: LogRefusalId =
        op === 'count'
          ? 'log-aggregate-counts-true-every-line'
          : 'log-aggregate-takes-path';
      throw refuseLog(id, { name });
    }
    if (isString(path)) logSource!.path(path);
  }
}

// A grouped query sorts by its group paths and aggregates.
function assertGroupedSort(group: any, sort: unknown) {
  let paths: unknown[] = [group.by].flat();
  let names = new Set(Object.keys(group.aggregates ?? {}));
  for (let entry of Array.isArray(sort) ? sort : []) {
    let key = entry?.by;
    needLog(
      paths.includes(key) || names.has(key),
      'log-grouped-query-sorts-by-group',
      {
        key: JSON.stringify(key),
      },
    );
  }
}
