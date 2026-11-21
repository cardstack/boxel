// The value-level helpers of the query types in query.ts.
import { refuse } from './query-refusals.ts';
import qs from 'qs';
import { hasOwn } from './query-syntax.ts';
import type { CodeRef } from '../index.ts';
import { SEARCH_RANK_SIGNALS } from '../search-intent.ts';
import { resolveTypeReferences } from './type-reference.ts';
import { NO_BINDING_VALUE } from './binding-reference.ts';
import {
  canonicalTimeZone,
  localDateInZone,
  RELATIVE_DATE,
  resolveRelativeDateInZone,
  zoneOfClock,
} from './time-zone.ts';
import type {
  Collapse,
  LetBinding,
  LetReference,
  CardReferenceRole,
  PageTotalMode,
  Query,
  Filter,
  WhenSignal,
  RelevanceSignal,
  RelevanceSortExpression,
  Sort,
  ExprSortExpression,
  CardTypeFilter,
  AnyFilter,
  EveryFilter,
  NotFilter,
  RangeOperator,
  RangeFilter,
  InFilter,
  MatchesFilter,
  TypeAheadFilter,
  MatchTerm,
  NearFilter,
} from './query.ts';
import { parseQuery } from './query-check.ts';

export const FACET_MEASURES = ['avg', 'min', 'max', 'sum'] as const;
export const FACET_INTERVALS = ['day', 'week', 'month', 'year'] as const;
export const MAX_FACETS = 8;
export const DEFAULT_FACET_SIZE = 50;
export const MAX_FACET_SIZE = 1000;
export const MAX_FACET_RANGES = 50;
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
export const MAX_LET_BINDINGS = 4;

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
export const MAX_LET_ROWS = 10_000;
export const MAX_LET_VALUES = 10_000;
export const LET_NAME = /^[A-Za-z_][\w]*$/;
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
export function compareFilterOf(query: any): unknown {
  let c = query?.rerank?.compare;
  return c && typeof c === 'object' && !Array.isArray(c) && hasOwn(c, 'filter')
    ? c.filter
    : undefined;
}

export function letReferencesIn(query: any): LetReference[] {
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
export const PAGE_TOTAL_MODES: readonly PageTotalMode[] = [
  'exact',
  'capped',
  'none',
];

// A "should" clause: a blend signal that lifts the cards matching `when`
// without dropping the rest. Every match ties for first place in it, so each
// gains `weight / (k + 1)` and a card that doesn't match gains nothing.
// Only inside a `_blend`. `when` is any filter, anchored like the query's.
export const WHEN_SIGNAL_KEY = '_when';
export function isWhenSignal(sort: object): sort is WhenSignal {
  return (sort as { by?: unknown }).by === WHEN_SIGNAL_KEY;
}

// The most signals one blend takes; each is a ranking pass over the
// filtered set.
export const MAX_BLEND_COMPONENTS = 8;
export const DEFAULT_RRF_K = 60;

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

export function isRelevanceSort(sort: object): sort is RelevanceSortExpression {
  return (sort as { by?: unknown }).by === RELEVANCE_SORT_KEY;
}

// Ranks by a spreadsheet formula over each card's fields, in the BXL score
// profile (`compileBxlScoreToSql`): numbers, fields, arithmetic, comparisons
// and IF, IFERROR, ROUND, LN, LOG10, SQRT, POWER, MIN, MAX, AVERAGE, DAYS,
// NOW and the like. `{ by: '_expr', expr: 'rating / LN(priceMin + 1)' }`.
// Highest first unless `direction` is `asc`; a card whose formula has no
// value (a missing field, a division by zero) ranks last. It also takes part
// in a `_blend` as a signal. Postgres only.
export const EXPR_SORT_KEY = '_expr';
export function isExprSort(sort: object): sort is ExprSortExpression {
  return (sort as { by?: unknown }).by === EXPR_SORT_KEY;
}

export const RANGE_OPERATORS: Record<RangeOperator, string> = {
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
};

// A relative date in a `range` bound: `now`, optionally moved by whole units
// (`now-30d`, `now+1w`; s, m, h, d, w, M for months, y) and optionally
// rounded down to the start of a unit (`now-30d/d`, `now/M`) on the query's
// time zone's calendar, UTC unless it names one (`timeZone`). It is
// read when the query runs, so a saved search for "added this month" stays
// current. Any other string is a literal bound.
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
    throw refuse('date-field-not-relative', undefined, {
      path,
      value: JSON.stringify(value.slice(0, 80)),
    });
  }
}

// Reckoned in `zone` (see time-zone.ts): by default the zone the query's
// clock reading carries (`clockInZone`), UTC for a bare `new Date()`.
// A relative date (`now-30d`) as a field of `serializerName` spells it in
// the search doc, reckoned from `now` in its zone. Only a date or date-time
// field reads one: undefined otherwise, and for a value that is not one, so
// the value stays the text as written. A date field holds the calendar day
// the instant falls on in the query's zone; a date-time field the zoneless
// `yyyy-MM-ddTHH:mm` a query reads as UTC. The engine and the host matcher
// both read relative dates through this.
export function relativeDateForField(
  value: unknown,
  serializerName: string | undefined,
  now: Date = new Date(),
): string | undefined {
  if (
    (serializerName !== 'date' && serializerName !== 'datetime') ||
    !isRelativeDate(value)
  ) {
    return undefined;
  }
  let when = new Date(resolveRelativeDate(value, now));
  return serializerName === 'date'
    ? localDateInZone(when, zoneOfClock(now))
    : when.toISOString().slice(0, 16);
}

const DATE_TIME_TEXT =
  /^\s*(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?\s*$/i;

// Whether a string is a date-time spelled with seconds, `Z` or an offset:
// on a date or date-time field it is an instant, which only a step that
// knows the field (`absoluteDateForField`) can spell as the search doc does.
export function spellsAnInstant(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  let match = DATE_TIME_TEXT.exec(value);
  return Boolean(match && (match[4] || match[6]));
}

// An absolute date-time bound as a field of `serializerName` spells it in
// the search doc: the instant it names (UTC when it has no zone), as
// docs/search.md reads it. Applies on a date-time field to a bound with
// seconds, `Z` or an offset (a bare `yyyy-MM-ddTHH:mm` is already the
// stored spelling), and on a date field to any date-time. Undefined
// otherwise, so the value stays as written.
//
// A stored date-time is a whole minute, a stored date the midnight (UTC) that
// starts its day. A bound between two of those is rounded so the comparison
// with the stored text stays exact: up for `gte` and `lt`, down for `gt` and
// `lte`. An `eq` (or `in`) with such a bound holds for no stored value, so it
// resolves to the bound's full ISO text, which no stored value equals.
export function absoluteDateForField(
  value: unknown,
  serializerName: string | undefined,
  bound: RangeOperator | 'eq' = 'eq',
): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (serializerName !== 'date' && serializerName !== 'datetime') {
    return undefined;
  }
  let match = DATE_TIME_TEXT.exec(value);
  if (!match) return undefined;
  let [, day, hh, mm, seconds, , zone] = match;
  if (serializerName === 'datetime' && !seconds && !zone) return undefined;
  let instant = Date.parse(`${day}T${hh}:${mm}${seconds ?? ''}${zone ?? 'Z'}`);
  if (Number.isNaN(instant)) return undefined;
  let unit = serializerName === 'date' ? 86_400_000 : 60_000;
  let floor = Math.floor(instant / unit) * unit;
  let rounded: number;
  if (floor === instant) {
    rounded = instant;
  } else if (bound === 'eq') {
    return new Date(instant).toISOString();
  } else {
    rounded = bound === 'gte' || bound === 'lt' ? floor + unit : floor;
  }
  return new Date(rounded)
    .toISOString()
    .slice(0, serializerName === 'date' ? 10 : 16);
}

// One implementation for every zone, the log engine's included
// (time-zone.ts); a value that is no relative date stays as written.
export function resolveRelativeDate(
  value: string,
  now = new Date(),
  zone: string = zoneOfClock(now),
): string {
  return resolveRelativeDateInZone(value, now, zone) ?? value;
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

// A type-ahead term's `or` (docs/search.md: `matches` reads `or` as
// `websearch_to_tsquery` does, binding the words either side of it more
// tightly than the words around them): "cafe or crem" is either word, and
// "brass lamp or light" is brass with lamp or light. The type-ahead node
// holds words that must all match, so a term with an `or` between two words
// runs as one node per combination, any of which matches. Undefined when
// the term has no such `or`, or more combinations than a type-ahead runs.
const MAX_TYPE_AHEAD_ALTERNATIVES = 32;
function typeAheadAlternatives(text: string): string[] | undefined {
  let tokens = text.trim().split(/\s+/);
  let isOr = (t: string | undefined) => t !== undefined && /^or$/i.test(t);
  if (!tokens.some((t, i) => isOr(t) && i > 0 && i < tokens.length - 1)) {
    return undefined;
  }
  let groups: string[][] = [];
  let joinNext = false;
  for (let token of tokens) {
    if (isOr(token) && groups.length > 0) {
      joinNext = true;
      continue;
    }
    if (joinNext) groups[groups.length - 1].push(token);
    else groups.push([token]);
    joinNext = false;
  }
  let combinations: string[][] = [[]];
  for (let group of groups) {
    combinations = combinations.flatMap((c) => group.map((w) => [...c, w]));
    if (combinations.length > MAX_TYPE_AHEAD_ALTERNATIVES) return undefined;
  }
  return combinations.map((words) => words.join(' '));
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
      let alternatives = typeAheadAlternatives(matches);
      return alternatives
        ? { any: alternatives.map((typeahead) => ({ ...rest, typeahead })) }
        : { ...rest, typeahead: matches };
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
