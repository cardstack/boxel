// Pure helpers for sorting and ranking: a key's sort values by kind, NULLS
// placement, blend aliases, the rows a window compares, and `explain`'s
// per-row breakdown.
// Owns: those helpers.
// Must not: build an ORDER BY (sort-order.ts) or run a statement.
// Guarantees: docs/search.md ("Sort Order", "Why a result ranks where it
// does (`explain`)").

import {
  BLEND_SCORE_KEY,
  EXPLAIN_KEY,
  MATCH_RELEVANCE_SORT_KEY,
  isBlendSort,
  isMatchRelevanceSort,
} from './types.ts';
import {
  type BlendSortExpression,
  DEFAULT_RRF_K,
  type RelevanceSignal,
  type ResultExplanation,
  type Sort,
  isExprSort,
  isWhenSignal,
} from '../query.ts';
import { exprFieldPaths } from '../formula-sql.ts';
import { isNearSort, nearSimilarityAlias } from '../vector-query.ts';

// How a sort key's values compare: as numbers, or as text. A merge across
// realms cannot tell from the value alone, since Postgres hands back
// `numeric` and `bigint` columns as strings.
export type SortValueKind = 'number' | 'text';

// A number-kind sort value as the merge reads it. Postgres returns `numeric`
// and `bigint` as strings; they become JS numbers here so the merge never has
// to guess whether a string of digits is a number. A whole number past 2^53
// (a big-integer field holding wei, say) would lose digits as a double and
// tie with its neighbours, so it travels as `{ bigint: '<digits>' }`, which
// survives JSON and compares exactly (`compareSortValues`). A decimal with
// more significant digits than a double holds is rounded: two such values
// that differ only past that precision tie and fall to the next key. Text
// that is no number (`numeric`'s 'NaN') stays a string, which the merge puts
// after every number, as Postgres does.
export function numberSortValue(v: unknown): unknown {
  if (typeof v === 'bigint') {
    v = String(v);
  }
  if (typeof v !== 'string' || v.trim() === '') {
    return v;
  }
  let n = Number(v);
  if (Number.isNaN(n)) {
    return v;
  }
  if (/^[+-]?\d+$/.test(v) && !Number.isSafeInteger(n)) {
    return { bigint: v };
  }
  return n;
}

// The values a narrow-pass key row was ordered by, one per sort entry: a
// field's `_sort_i`, a blend's score, a near sort's similarity, text
// relevance; then the url tiebreak. Each value carries its key's type
// (`kinds`, from `sortValueKinds`): a number key's value is a number, a text
// key's a string.
export function sortValuesOf(
  key: Record<string, unknown>,
  sort: Sort | undefined,
  kinds: SortValueKind[],
): unknown[] {
  let values = (sort ?? []).map((s, i) => {
    let column = isBlendSort(s)
      ? blendScoreAlias(sort!, i)
      : isNearSort(s)
        ? nearSimilarityAlias(sort!, i)
        : isMatchRelevanceSort(s as { by: string })
          ? MATCH_RELEVANCE_SORT_KEY
          : `_sort_${i}`;
    let v = key[column];
    if (v === undefined || v === null) {
      return null;
    }
    return kinds[i] === 'number'
      ? numberSortValue(v)
      : typeof v === 'string'
        ? v
        : String(v);
  });
  return [...values, key.url];
}

export function blendScoreAlias(sort: Sort, index: number): string {
  let firstBlend = sort.findIndex((s) => isBlendSort(s));
  return index === firstBlend ? BLEND_SCORE_KEY : `${BLEND_SCORE_KEY}_${index}`;
}

// Where a field sort puts cards with no value: last unless it says first.
export function nullsPlacement(s: unknown): string {
  return (s as { missing?: string }).missing === 'first'
    ? 'NULLS FIRST'
    : 'NULLS LAST';
}

export const RELEVANCE_SORT_KEY_NAME = '_relevance';

// The card type a filter is anchored on: its own `on` or `type`, or the first
// anchor among the branches of a top-level `every`.
// A glob as a LIKE pattern: `*` is `%`, `?` is `_`, and LIKE's own
// wildcards and escape are escaped.
// The rows a window is compared with: each holds the fields the
// expression reads through `peers.` and `stats.` (`vals`), keyed by the
// group it belongs to (a `compare.by` value, or the window row a look-alike
// is a neighbour of).
export interface ComparedRows {
  fields: string[];
  rows: { ord: number; key: string; vals: Record<string, unknown> }[];
  truncated?: { rows: number; total: number };
}

// A window row's doc cut to the paths an expression reads (and a
// binding's card under its expression key), so the scoring statement binds
// only what it reads. Paths into `peers` and `stats` come from the
// comparison rows instead.
export function readsOnly(
  expr: string,
  docs: Record<string, unknown>[],
): Record<string, unknown>[] {
  let paths = exprFieldPaths(expr);
  if (!paths) return docs;
  let heads = [...new Set(paths.map((p) => p[0]))].filter(
    (h) => h !== 'peers' && h !== 'stats',
  );
  return docs.map((doc) =>
    Object.fromEntries(
      heads
        .filter((h) => Object.prototype.hasOwnProperty.call(doc, h))
        .map((h) => [h, doc[h]]),
    ),
  );
}

// The comparison group a row belongs to: its value at `by`, as text.
export function groupKey(doc: Record<string, unknown>, by: string | undefined) {
  if (!by) return '';
  let v: unknown = doc;
  for (let part of by.split('.')) {
    v =
      v && typeof v === 'object'
        ? (v as Record<string, unknown>)[part]
        : undefined;
  }
  return v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
}

// The `_relevance` signal a blend component stands for, by identity: set
// when `#relevanceBlend` builds the component, read by `explainRows`.
export const explainNames = new WeakMap<
  object,
  { name: RelevanceSignal; weight: number }
>();

// Folds each row's per-signal `_xN_value` / `_xN_rank` columns into one
// `_explain` object (see `ResultExplanation`) and drops them.
export function explainRows(
  rows: Record<string, unknown>[],
  sort: Sort | undefined,
) {
  let blend = (sort ?? []).find((s) => isBlendSort(s)) as
    | BlendSortExpression
    | undefined;
  if (!blend) {
    return;
  }
  let k = blend.k ?? DEFAULT_RRF_K;
  let labels = blend.of.map((c) => {
    let named = explainNames.get(c);
    if (named) {
      return { signal: named.name, weight: named.weight };
    }
    let signal = isExprSort(c)
      ? c.expr
      : isWhenSignal(c)
        ? 'when'
        : isMatchRelevanceSort(c)
          ? 'text'
          : c.by;
    return { signal, weight: c.weight ?? 1 };
  });
  for (let row of rows) {
    let signals = labels.map(({ signal, weight }, j) => {
      let rawRank = row[`_x${j}_rank`];
      let rank = rawRank == null ? null : Number(rawRank);
      let value = row[`_x${j}_value`] ?? null;
      delete row[`_x${j}_rank`];
      delete row[`_x${j}_value`];
      return {
        signal,
        weight,
        ...(weight < 0 ? { inverted: true as const } : {}),
        value:
          typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value)
            ? Number(value)
            : value,
        rank,
        contribution: rank == null ? 0 : Math.abs(weight) / (k + rank),
      };
    });
    row[EXPLAIN_KEY] = {
      score: Number(row[BLEND_SCORE_KEY] ?? 0),
      k,
      signals,
    } satisfies ResultExplanation;
  }
}
