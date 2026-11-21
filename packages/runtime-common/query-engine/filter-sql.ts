// Pure SQL helpers for filter compilation: folding `any` of same-key `eq`s
// into one `in`, glob to LIKE, the short-title trigram
// probe, and finding a filter's type anchor.
// Owns: those helpers and the containment limits (`CONTAINMENT_ANY_MAX`,
// `JSONPATH_ANY_MAX`).
// Must not: read definitions or the index; filter-compiler.ts decides when
// each applies.
// Guarantees: docs/search.md ("Filters", "Edge cases and what is
// guaranteed").

import { CARD_TITLE_KEY } from '../search-doc-keys.ts';
import stringify from 'safe-stable-stringify';
import {
  type CardExpression,
  param,
  typeCondition as typeConditionNode,
} from '../expression.ts';
import type { CodeRef } from '../index.ts';
import type { EqFilter, Filter } from '../query-v2/query.ts';
import type { FilterContext } from './types.ts';
import type * as JSONTypes from 'json-typescript';
import { realmBound } from './index-sql.ts';
import { escapeLikePattern } from './dialect.ts';

// Up to this many values of an `in` test the row by containment, which the
// search doc's GIN index serves; past it, by the value read out once (see
// `#jsonContainsAny`).
export const CONTAINMENT_ANY_MAX = 32;

// Up to this many text values, a positive `in` is one SQL/JSON path test of
// the row's search doc (`search_doc @? 'strict $."f" ? (@ == "a" || …)'`),
// which the search doc's GIN index serves as it serves a containment, and
// which reads the row's search doc once however many values it holds (see
// `#containedJsonPath`). Past about 200 values Postgres prices the index
// search above a scan of the type's rows, so the bound stays well below it.
export const JSONPATH_ANY_MAX = 100;

// Search-doc keys whose substring (`contains`) match has a trigram index of
// its own (see the `add-search-doc-title-trigram-indexes` migration): a row's
// display title, as the search sheet matches it.
export const TRIGRAM_INDEXED_TITLE_KEYS = [
  CARD_TITLE_KEY,
  'cardTitle',
] as const;

// The filter with each `every` and `any` holding a member once: a member
// repeated adds nothing to an AND or an OR, and a query that repeats one
// thousands of times would otherwise compile to thousands of copies of it,
// which Postgres plans slowly. The first of each is kept, in order, so a
// refused member is refused as it was.
export function withoutRepeatedMembers(filter: Filter): Filter {
  let members = (list: Filter[]) => {
    let seen = new Set<string>();
    let kept: Filter[] = [];
    for (let member of list) {
      let once = withoutRepeatedMembers(member);
      let key = stringify(once) ?? '';
      if (!seen.has(key)) {
        seen.add(key);
        kept.push(once);
      }
    }
    return kept;
  };
  let f = filter as unknown as Record<string, unknown>;
  if (Array.isArray(f.every)) {
    return { ...f, every: members(f.every as Filter[]) } as Filter;
  }
  if (Array.isArray(f.any)) {
    return { ...f, any: members(f.any as Filter[]) } as Filter;
  }
  if (f.not && typeof f.not === 'object') {
    return { ...f, not: withoutRepeatedMembers(f.not as Filter) } as Filter;
  }
  return filter;
}

// An `any` whose branches are each a single-key `eq` on the same field (and
// the same type anchor) is an `in`: `any: [{eq: {vid: a}}, {eq: {vid: b}}]`
// selects exactly what `in: {vid: [a, b]}` does. Folding it lets the `in`
// plan (one indexed lookup) serve what would otherwise be an OR of
// per-branch type and containment checks, which slowed sharply past ~10
// branches. Returns undefined when the branches don't all have that shape.
export function foldSameKeyEqs(branches: Filter[]): Filter | undefined {
  if (branches.length < 2) {
    return undefined;
  }
  let key: string | undefined;
  let anchor: string | undefined;
  let on: CodeRef | undefined;
  let values: JSONTypes.Value[] = [];
  for (let branch of branches) {
    let keys = Object.keys(branch).filter((k) => k !== 'on');
    if (keys.length !== 1 || keys[0] !== 'eq') {
      return undefined;
    }
    let eq = (branch as EqFilter).eq;
    let entries = Object.entries(eq);
    if (entries.length !== 1) {
      return undefined;
    }
    let [k, v] = entries[0];
    let branchOn = (branch as { on?: CodeRef }).on;
    let branchAnchor = JSON.stringify(branchOn ?? null);
    if (key === undefined) {
      key = k;
      anchor = branchAnchor;
      on = branchOn;
    } else if (k !== key || branchAnchor !== anchor) {
      return undefined;
    }
    values.push(v);
  }
  return { ...(on ? { on } : {}), in: { [key!]: values } } as Filter;
}

// The prerendered_html rows paired with the boxel_index rows `tableFromOpts`
// selects: the same pass's staged HTML rows for a staged read, the production
// table otherwise.

// A card's full-text vector, as `matches` and relevance read it. Production
// rows carry it in `markdown_tsv`, which the index writer computes as it
// promotes a pass (see `promotePrerenderedHtmlPending`); a pass's staged rows
// don't carry it, so a search over them computes it inline, which is
// affordable because staging only ever holds one pass.
// A `contains` on a title key (and nothing else) whose text is one or two
// characters: too short for the title trigram index to narrow.
export function shortTitleContains(
  filter: any,
): { key: string; value: string } | undefined {
  if (!filter || typeof filter.contains !== 'object' || 'on' in filter) {
    return undefined;
  }
  let entries = Object.entries(filter.contains ?? {});
  if (entries.length !== 1) {
    return undefined;
  }
  let [key, value] = entries[0];
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    [...value].length >= 3 ||
    !(TRIGRAM_INDEXED_TITLE_KEYS as readonly string[]).includes(key)
  ) {
    return undefined;
  }
  return { key, value };
}

// The realm's rows whose title holds a short substring, at most `limit` of
// them when given. The key is one of the fixed title keys, so it is spliced
// in as a literal.
// The cap counts and takes only cards of the queried type (`on`), so other
// rows holding the substring (files, cards of other types) never use it up.
export function shortTitleContainsSelect(
  { key, value }: { key: string; value: string },
  context: FilterContext,
  limit?: number,
  on?: CodeRef,
  kind?: 'instance' | 'file',
): CardExpression {
  return [
    `SELECT ti.url, ti.realm_url, ti.type FROM ${context.indexTable} AS ti WHERE ti.search_doc ->> '${key}' ILIKE`,
    param(`%${escapeLikePattern(String(value))}%`),
    `ESCAPE '\\'`,
    ...realmBound('ti', context),
    `AND (ti.is_deleted = FALSE OR ti.is_deleted IS NULL)`,
    ...(on ? ['AND', typeConditionNode(on, 'ti.types')] : []),
    ...(kind ? ['AND ti.type =', param(kind)] : []),
    ...(limit ? [`LIMIT ${Number(limit)}`] : []),
  ];
}

// A `pattern` glob is path-aware: `*` is any run of characters within one
// `/`-separated segment, `?` one character other than `/`, and `**` any run
// at all, across segments. As a LIKE pattern every wildcard crosses `/`, so
// the LIKE form is exact only for a glob whose wildcards are all `**` (see
// `globNeedsSegments`); otherwise it is the superset the trigram prefilter
// and the field test narrow by, and `globToRegex` decides.
export function globToLike(glob: string): string {
  return glob
    .replace(/[\\%_]/g, (c) => `\\${c}`)
    .replace(/\*+/g, '%')
    .replace(/\?/g, '_');
}

// Whether a glob holds a wildcard that stays within one segment: a `?`, or a
// `*` that is not part of a `**`.
export function globNeedsSegments(glob: string): boolean {
  return /\?|(^|[^*])\*(?!\*)/.test(glob);
}

// The glob as an anchored POSIX regular expression (Postgres's `~*`), with
// `*` as `[^/]*`, `?` as `[^/]` and `**` (any run of two or more `*`) as `.*`.
export function globToRegex(glob: string): string {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    let c = glob[i];
    if (c === '*') {
      let j = i;
      while (glob[j + 1] === '*') j++;
      out += j > i ? '.*' : '[^/]*';
      i = j;
    } else if (c === '?') {
      out += '[^/]';
    } else if (/[\\^$.|+()[\]{}]/.test(c)) {
      out += `\\${c}`;
    } else {
      out += c;
    }
  }
  return `^${out}$`;
}

export function filterAnchor(filter: Filter | undefined): CodeRef | undefined {
  if (!filter) {
    return undefined;
  }
  if ('on' in filter && filter.on) {
    return filter.on;
  }
  if ('type' in filter && filter.type) {
    return filter.type;
  }
  if ('every' in filter) {
    for (let branch of filter.every) {
      let anchor = filterAnchor(branch);
      if (anchor) {
        return anchor;
      }
    }
  }
  return undefined;
}

// The types every card `filter` admits is of: each positive node's `on` (or
// else its `type`), which the node tests as a conjunct, through the branches
// of an `every`; never one under a `not` or an `any`.
export function requiredTypes(filter: Filter | undefined): CodeRef[] {
  if (!filter || 'not' in filter) {
    return [];
  }
  let own =
    ('on' in filter ? filter.on : undefined) ??
    ('type' in filter ? filter.type : undefined);
  return [
    ...(own ? [own] : []),
    ...('every' in filter ? filter.every.flatMap(requiredTypes) : []),
  ];
}

export { escapeLikePattern };
