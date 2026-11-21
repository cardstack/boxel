// Facet plans and the pure parts of counting them: a facet's shape (values,
// range or date buckets), automatic ranges from statistics, a filter without
// a facet's own selection, and range bounds.
// Owns: `FacetPlan` and those helpers.
// Must not: run a statement (facets.ts counts from the value store).
// Guarantees: docs/search.md ("Facets").

import type { CodeRef } from '../index.ts';
import { type Expression, separatedByCommas } from '../expression.ts';
import {
  type Facet,
  type FacetCount,
  type FacetMeasureOp,
  type FacetRange,
  type FacetStats,
  type Filter,
  isRelativeDate,
  resolveRelativeDate,
} from '../query-v2/query.ts';
import {
  isLocalMidnight,
  isUtcZone,
  localDateInZone,
  zoneOfClock,
} from '../query-v2/time-zone.ts';

export type FacetShape = 'values' | 'range' | 'date';

export interface FacetPlan {
  facet: Facet;
  shape: FacetShape;
  // A built-in facet: the index row's column it reads (facet-declarations.ts).
  column?: string;
  // A built-in date column (an epoch), read as its ISO instant.
  builtInDate?: boolean;
  // The column that labels an index field's value (`_type`'s display name).
  labelColumn?: string;
  // No card the query could match holds the facet: it counts nothing.
  empty?: boolean;
  // Not counted on SQLite: a `measure` order, or a field of some matched
  // cards' types that only the value store resolves (sqlite-facets.ts).
  uncounted?: boolean;
  // A `measure`'s field, and whether it holds one number per card (a list
  // holds none to aggregate); `measureRead` is where its value is read.
  measurePath?: string;
  measureScalar?: boolean;
  measureRead?: string;
  // Where a declared field's values are read (`by`, or a compound's
  // `facetValue` under it), and whether that path crosses a list.
  read?: string;
  list?: boolean;
  // The card types whose cards are counted, when the facet is a field of
  // some of the matched cards' types and not of the queried type: those
  // that declare it (or, when none resolves now, those that hold it).
  holderTypes?: string[];
  // A link field: counted by the linked card's id, each value labelled with
  // the card's title (docs/search-intent.md, `facet`).
  link?: boolean;
  // The type the link field points at, whose grants decide which linked
  // cards may lend a label to a caller a policy scopes.
  linkTarget?: CodeRef;
  // A big integer field: its values are decimal text, compared as numbers.
  bigInteger?: boolean;
  // A date or date-time field: a range bound may be a relative date.
  dateField?: boolean;
  // a date field (calendar days), not a date-time
  dateOnly?: boolean;
}

export const DATE_SERIALIZERS = new Set(['date', 'datetime']);

// The column is `facet_value`, not `value`: the shared row coercion reads a
// column named `value` as JSON.
export function facetCountsOf(rows: Record<string, unknown>[]): FacetCount[] {
  return rows
    .filter((row) => row.facet_value != null)
    .map((row) => ({
      value: String(row.facet_value),
      count: Number(row.count),
    }));
}

// Range buckets for a number facet that declares its shape but names no
// ranges: up to ten equal buckets of a round width across the values'
// span, the last holding the maximum.
export function autoFacetRanges(stats: FacetStats | undefined): FacetRange[] {
  if (
    !stats?.values ||
    typeof stats.min !== 'number' ||
    typeof stats.max !== 'number'
  ) {
    return [];
  }
  let { min, max } = stats;
  if (min === max) {
    return [{ from: min }];
  }
  let rough = (max - min) / 5;
  let magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
  let step = rough / magnitude;
  let width = (step <= 1 ? 1 : step <= 2 ? 2 : step <= 5 ? 5 : 10) * magnitude;
  let round = (n: number) => Number(n.toPrecision(12));
  let ranges: FacetRange[] = [];
  for (
    let from = round(Math.floor(min / width) * width);
    from <= max && ranges.length < 10;
    from = round(from + width)
  ) {
    ranges.push({ from, to: round(from + width) });
  }
  return ranges;
}

// `filter` without the nodes that constrain only `by`, for a facet counted
// without its own selection (`own: 'ignore'`). A removed node's type anchor
// stays, so the count keeps the filter's type. A filter that tests `by`
// nowhere is returned as it is, the same object.
export function filterWithout(filter: Filter, by: string): Filter | undefined {
  let node = filter as any;
  let anchor = (): Filter | undefined =>
    node.on ? ({ type: node.on } as Filter) : undefined;
  for (let operator of ['eq', 'in', 'range', 'contains']) {
    if (operator in node) {
      let keys = Object.keys(node[operator] ?? {});
      // A link facet's selection filters by the linked card's id.
      return keys.length > 0 &&
        keys.every((key) => key === by || key === `${by}.id`)
        ? anchor()
        : filter;
    }
  }
  if ('not' in node) {
    return filterWithout(node.not, by) === node.not ? filter : anchor();
  }
  if ('any' in node) {
    let branches = (node.any as Filter[]).map((b) => filterWithout(b, by));
    if (branches.every((b, i) => b === (node.any as Filter[])[i])) {
      return filter;
    }
    // A branch with nothing left admits every card, and so does the `any`;
    // otherwise every branch stays, each without the field's tests.
    return branches.some((b) => b === undefined)
      ? anchor()
      : ({ ...node, any: branches } as Filter);
  }
  if ('every' in node) {
    let mapped = (node.every as Filter[]).map((b) => filterWithout(b, by));
    // Nothing removed: the filter itself, so an `any` holding it can tell
    // (above).
    if (mapped.every((b, i) => b === (node.every as Filter[])[i])) {
      return filter;
    }
    let kept = mapped.filter((b): b is Filter => b !== undefined);
    return kept.length === 0 ? anchor() : ({ ...node, every: kept } as Filter);
  }
  return filter;
}

// A facet's `measure`, as the aggregate and the field it reads.
export function facetMeasureOf(
  facet: Facet,
): { op: FacetMeasureOp; path: string } | undefined {
  if (!facet.measure) {
    return undefined;
  }
  let [op, path] = Object.entries(facet.measure)[0] ?? [];
  return op && path ? { op: op as FacetMeasureOp, path } : undefined;
}

// A facet range bound, with a relative date (`now-1y/M`) resolved the way a
// `range` filter resolves one. Facet values compare as their search-doc
// strings, so a bound that falls on a UTC midnight (a `/d` or `/M` rounding)
// is spelled as the day alone: a date field's `2025-11-01` must not sort
// before the bound `2025-11-01T00:00:00.000Z` and drop its own first day.
//
// In a zone other than UTC (`timeZone`) a rounding falls on the zone's
// midnight: on a date field that is spelled as the zone's day, and on a
// date-time field (zoneless values read as UTC) as the instant.
export function facetRangeBound<T>(
  bound: T,
  now = new Date(),
  dateOnly = false,
): T | string {
  if (typeof bound !== 'string' || !isRelativeDate(bound)) {
    return bound;
  }
  let iso = resolveRelativeDate(bound, now);
  let zone = zoneOfClock(now);
  if (!isUtcZone(zone)) {
    // a date field: the zone's day; a date-time field: as a `range`
    // filter spells the bound (`yyyy-MM-ddTHH:mm` in UTC), so a value at
    // the bound itself counts
    return dateOnly
      ? isLocalMidnight(new Date(iso), zone)
        ? localDateInZone(new Date(iso), zone)
        : iso
      : iso.slice(0, 16);
  }
  return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso;
}

// ---- a source with no facet table (log lines) -------------------------
// Its facets and its group aggregates are read from the matched rows
// themselves (`from` is the statement's FROM and WHERE), with the source's
// own reads of a path.

// A path's reads: its value as jsonb (SQL NULL for none), as a number (NULL
// unless it is one) and as text; `extreme` overrides MIN and MAX.
export interface SourceReads {
  value: Expression;
  number: Expression;
  text: Expression;
  extreme?: (fn: 'MIN' | 'MAX') => Expression;
}

// A facet's counts, ordered as a card facet orders them: a value facet by
// count (most first) then value, a date bucket by value. Rows with no value
// are left out before the limit, so `size` counts values.
export function sourceFacetSql(
  from: Expression,
  value: Expression,
  size: number,
  order: 'count' | 'value',
): Expression {
  return [
    'SELECT',
    ...value,
    'AS value, COUNT(*) AS count',
    ...from,
    'AND',
    ...value,
    'IS NOT NULL GROUP BY 1',
    order === 'value' ? 'ORDER BY 1' : 'ORDER BY 2 DESC, 1',
    `LIMIT ${Number(size)}`,
  ];
}

// A group's aggregate as jsonb: `count` (rows, or values at a path),
// `distinct` values, the `latest` value (by `latestOrder`), and the measures
// a card facet takes (FACET_MEASURES): `sum` and `avg` over numbers, `min`
// and `max` numerically over numbers, else by text.
export function sourceAggregateSql(
  op: string,
  reads: SourceReads | true,
  latestOrder: string,
): Expression {
  if (reads === true) return ['to_jsonb(COUNT(*))'];
  let { value, number, text, extreme } = reads;
  switch (op) {
    case 'count':
      return ['to_jsonb(COUNT(', ...value, '))'];
    case 'latest':
      return ['(array_agg(', ...value, `ORDER BY ${latestOrder}))[1]`];
    case 'distinct':
      return [
        'COALESCE(to_jsonb(array_agg(DISTINCT',
        ...value,
        ') FILTER (WHERE',
        ...value,
        "IS NOT NULL)), '[]'::jsonb)",
      ];
    case 'sum':
    case 'avg':
      return [`to_jsonb(${op.toUpperCase()}(`, ...number, '))'];
  }
  let fn: 'MIN' | 'MAX' = op === 'min' ? 'MIN' : 'MAX';
  if (extreme) return extreme(fn);
  return [
    `COALESCE(to_jsonb(${fn}(`,
    ...number,
    `)), to_jsonb(${fn}(`,
    ...text,
    ')))',
  ];
}

// A grouped page over a source's rows: one row per distinct key (`"g<i>"`),
// with its aggregates (`"a_<name>"`) and how many groups there are in all
// (`"groups"`, counted before the page's LIMIT), in `order`; and the groups
// its total counts when the page shows none, grouped by the key reads
// themselves (a subquery has no SELECT list for ordinals to name).
export function sourceGroupSql(
  from: Expression,
  keys: Expression[],
  aggregates: [string, SourceReads | true][],
  names: string[],
  latestOrder: string,
  order: Expression,
  limit: string,
): { page: Expression; counted: Expression } {
  return {
    page: [
      'SELECT',
      ...separatedByCommas([
        ...keys.map((key, i): Expression => [...key, `AS "g${i}"`]),
        ...aggregates.map(
          ([op, reads], i): Expression => [
            ...sourceAggregateSql(op, reads, latestOrder),
            `AS "a_${names[i]}"`,
          ],
        ),
        ['COUNT(*) OVER () AS "groups"'],
      ]),
      ...from,
      `GROUP BY ${keys.map((_, i) => i + 1).join(', ')}`,
      ...order,
      limit,
    ] as Expression,
    counted: [
      'SELECT 1',
      ...from,
      'GROUP BY',
      ...separatedByCommas(keys),
    ] as Expression,
  };
}
