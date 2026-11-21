// A facet match set the value store decides: its cards are read from the
// store's narrow rows (`boxel_index_values`) instead of `boxel_index`, and,
// for a set that is whole types, its facets' values are the store's rows at
// their paths for those types, read without joining the set.
// Owns: `StoreFacetSet` and the statements' parts that read it.
// Must not: change which cards a facet counts or the values it counts.
// Guarantees: docs/search.md ("Facets").
//
// The rule. A facet's match set is read here when its filter is a
// conjunction of type tests (either way round) and `eq` or `in` tests on a
// text or boolean field, either way round, over a card type (store-blend.ts
// `storeFacetSet`), and the store holds no marker for any card of its types
// at or above a path the tests read. A card with a marker at or above a
// facet's path (the value is in its search doc) holds no store row there;
// that facet counts its value from its search doc
// (`storeFacetMarkedCards`), as the general read does for such a card.
//
// Why it is exact. The store holds every live card instance and nothing
// else (value-store.ts), one row at the empty path (`c`) per card and one
// row per value of its `search_keys`, so the cards of a card type the
// general read admits are those the store holds of the types whose chain
// names it. A test's text is the text the general read compares (a string's
// or a boolean's own text, a number's numeric text), so a positive test
// holds exactly for a card with a passing value at its path, and a negated
// one for a card with a value there that fails it (a card with no value is
// unknown to both). With no marker, every value the facets count is a store
// row, as the general facet read counts it.

import {
  type CardExpression,
  param,
  separatedByCommas,
} from '../expression.ts';
import { NUMERIC_TEXT } from './dialect.ts';

export interface StoreValueTest {
  pathId: number;
  op: 'eq' | 'in' | 'not-eq' | 'not-in' | 'range';
  values: (string | boolean)[];
  // A positive range's bounds (`gt`, `gte`, `lt`, `lte`), numbers.
  range?: Record<string, number>;
}

const BOUNDS: Record<string, string> = {
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
};

export interface StoreFacetSet {
  // The search's realms' ids in the store (a union's every realm that has
  // cards there), and each one's URL.
  realmIds: number[];
  realmURLs: Map<number, string>;
  // The types whose cards match (every positive type test, none negated).
  typeIds: number[];
  // Each type's key (its `types ->> 0`).
  typeKeys: Map<number, string>;
  rootId: number;
  tests: StoreValueTest[];
  // Some card of the types holds only a marker at or above a facet's path:
  // that facet reads that card's value from its search doc
  // (`storeFacetMarkedCards`).
  facetMarkers?: boolean;
  // The dictionary ids of the facets' paths and their prefixes.
  facetPrefixIds?: number[];
  // Each facet path's (and measured path's) dictionary id.
  facetPathIds?: Map<string, number>;
  // A counts-only html search over a realm whose error rows the filter
  // matches (`liveFromStore`): the realm's non-live rows the condition
  // admits are matches too, each counted by its index row's search doc, its
  // last good values (non-live-rows.ts).
  nonLive?: { realms: URL; condition: CardExpression };
}

const ints = (ids: number[]) =>
  ids.length ? ids.map(Number).join(', ') : 'NULL';

// Whether the store row `alias` passes `test`, read from its text
// (`txt`: a string's or a boolean's text) or its number (`num`), the two
// arms a test's rows are read by. A text or number test compares the
// text the general read compares (a number's numeric text), in byte order,
// whose equality is the database collation's. A range compares the number
// the general read reads (`numericField`): a number, or text that spells
// one (`NUMERIC_TEXT`).
function holds(
  alias: string,
  test: StoreValueTest,
  column: 'txt' | 'num',
): CardExpression {
  if (test.op === 'range') {
    let read =
      column === 'num'
        ? `${alias}.num`
        : `(CASE WHEN ${alias}.txt ~ '${NUMERIC_TEXT}' THEN ${alias}.txt::numeric END)`;
    return Object.entries(test.range ?? {}).flatMap(
      ([op, v], n): CardExpression => [
        ...(n > 0 ? ['AND'] : []),
        `${read} ${BOUNDS[op]}`,
        param(v),
        '::numeric',
      ],
    );
  }
  let read = column === 'num' ? `${alias}.num::text` : `${alias}.txt`;
  let listed = separatedByCommas(
    test.values.map((v): CardExpression => [param(v)]),
  ) as CardExpression;
  switch (test.op) {
    case 'eq':
      return [`${read} =`, ...listed];
    case 'not-eq':
      return [`${read} <>`, ...listed];
    case 'in':
      return [`${read} IN (`, ...listed, ')'];
    case 'not-in':
      return [`${read} NOT IN (`, ...listed, ')'];
  }
}

// The value rows of the set's cards at `test`'s path that pass it (`card_id`,
// `type_id`, `realm_id`): the text index's range and the number index's,
// by their leading key (realm, type, path).
function testRows(
  set: StoreFacetSet,
  test: StoreValueTest,
  alias: string,
): CardExpression {
  let at = `${alias}.realm_id IN (${ints(set.realmIds)}) AND ${alias}.type_id IN (${ints(set.typeIds)}) AND ${alias}.path_id = ${Number(test.pathId)}`;
  return [
    `SELECT ${alias}.card_id, ${alias}.type_id, ${alias}.realm_id FROM boxel_index_values AS ${alias} WHERE ${at} AND ${alias}.txt IS NOT NULL AND`,
    ...holds(alias, test, 'txt'),
    `UNION ALL SELECT ${alias}.card_id, ${alias}.type_id, ${alias}.realm_id FROM boxel_index_values AS ${alias} WHERE ${at} AND ${alias}.num IS NOT NULL AND`,
    ...holds(alias, test, 'num'),
  ];
}

// Whether every card of the set's types matches (no value test).
export function isWholeTypes(set: StoreFacetSet): boolean {
  return set.tests.length === 0;
}

// The set's matches, one row per card: `kn` (the card's id, by which the
// facet rows count it), `card_id`, `type_id` and `realm_id`. Set-based: one
// positive test's rows (or each card's row at the empty path), and each
// other test the set of cards whose rows pass it, joined by card; the
// planner chooses how. A card holds one row per value, so a list that
// holds a passing value twice is one card (DISTINCT).
export function storeFacetKeysCte(
  name: string,
  set: StoreFacetSet,
): CardExpression {
  let driver = set.tests.find(
    (t) => t.op === 'eq' || t.op === 'in' || t.op === 'range',
  );
  let rest = set.tests.filter((t) => t !== driver);
  let rows: CardExpression = driver
    ? [
        '(SELECT DISTINCT d.card_id, d.type_id, d.realm_id FROM (',
        ...testRows(set, driver, 'd'),
        ') AS d) AS d',
      ]
    : [
        `(SELECT d.card_id, d.type_id, d.realm_id FROM boxel_index_values AS d WHERE d.realm_id IN (${ints(set.realmIds)}) AND d.type_id IN (${ints(set.typeIds)}) AND d.path_id = ${Number(set.rootId)} AND d.txt = '') AS d`,
      ];
  let joins: CardExpression = rest.flatMap(
    (test, n): CardExpression => [
      'AND d.card_id IN (SELECT t.card_id FROM (',
      ...testRows(set, test, `t${n}`),
      ') AS t)',
    ],
  );
  return [
    `${name} AS MATERIALIZED (SELECT d.card_id::bigint AS kn, d.card_id, d.type_id, d.realm_id FROM`,
    ...rows,
    'WHERE TRUE',
    ...joins,
    ')',
  ];
}

// The facet value rows (`f`, `kn`, `value`, `num`, `label`) of the facets
// `fs` over set `name`, as the general read's store arm reads them: each
// store row at a facet's path (`facet_paths`), of a card of the facet's
// holder types (`holders`, by facet, when it names them).
export function storeFacetValueArms(
  name: string,
  set: StoreFacetSet,
  facets: { f: number; path: string }[],
  holders: Map<number, string[]>,
): CardExpression[] {
  // The rows at each facet's path, one arm per facet and kind of value: the
  // text index's and the number index's range for (realm, type, path), the
  // path's id written as a value. An equality on the index's leading key
  // is an index condition whatever the planner's statistics say: joined to
  // the paths through a CTE, a realm the statistics had not seen read every
  // value row of its types per facet (the no-statistics gate). Every card of
  // the types when the set is whole types, else joined to the set's cards
  // (one join; the planner chooses how).
  let whole = isWholeTypes(set);
  let typesOf = (f: number) => {
    let keys = holders.get(f);
    return keys
      ? [...set.typeKeys]
          .filter(([, key]) => keys.includes(key))
          .map(([id]) => id)
      : set.typeIds;
  };
  return facets.flatMap(({ f, path }): CardExpression[] => {
    let pathId = set.facetPathIds?.get(path);
    if (pathId === undefined) {
      // a path the dictionary does not hold holds no card's value
      return [];
    }
    let scan = (column: 'txt' | 'num') =>
      `SELECT ${Number(f)} AS f, ${whole ? 'v.card_id::bigint' : 'k.kn'} AS kn, ${
        column === 'txt' ? 'v.txt' : 'v.num::text'
      } COLLATE "C" AS value, ${
        column === 'txt' ? 'NULL::numeric' : 'v.num'
      } AS num, NULL::text AS label FROM boxel_index_values AS v${
        whole ? '' : ` JOIN ${name} AS k ON k.card_id = v.card_id`
      } WHERE v.realm_id IN (${ints(set.realmIds)}) AND v.type_id IN (${ints(typesOf(f))}) AND v.path_id = ${Number(pathId)} AND v.${column} IS NOT NULL`;
    return [[scan('txt')], [scan('num')]];
  });
}

// The set's cards that hold only a marker at or above some facet's path,
// each once, with its index row's search doc: `kn`, `card_id`,
// `type_key`, `path_ids` (the marked paths) and `search_doc`, for the facets'
// search-doc arms. Read from the marker index for the set's types (a few
// rows), then each card's index row by key. The paths are the dictionary's
// ids, written as values, as the realm and types are, so the planner reads
// their statistics: through the `facet_paths` CTE it expected a thousand
// marked cards and hash-joined a scan of the whole card dictionary (117k
// rows, 2,855 pages) to find one.
export function storeFacetMarkedCards(
  name: string,
  set: StoreFacetSet,
): CardExpression {
  let inSet = isWholeTypes(set)
    ? ''
    : ` AND mk.card_id IN (SELECT k.card_id FROM ${name} AS k)`;
  return [
    `(SELECT mk.kn, mk.card_id, mk.type_key, mk.path_ids, di.search_doc FROM (SELECT mk.card_id::bigint AS kn, mk.card_id, MAX(t.type COLLATE "default") AS type_key, array_agg(DISTINCT mk.path_id) AS path_ids FROM boxel_index_values AS mk JOIN boxel_index_value_types AS t ON t.id = mk.type_id WHERE mk.realm_id IN (${ints(set.realmIds)}) AND mk.type_id IN (${ints(set.typeIds)}) AND mk.kind = 'm' AND mk.path_id IN (${ints(set.facetPrefixIds ?? [])})${inSet} GROUP BY mk.card_id) AS mk`,
    'JOIN boxel_index_value_cards AS c ON c.id = mk.card_id',
    `JOIN boxel_index AS di ON di.realm_url = (c.realm_url COLLATE "default")::varchar AND di.url = (c.url COLLATE "default")::varchar AND di.type = 'instance')`,
  ];
}

// A measure's value rows (`f`, `kn`, `measure`): each number at the
// measured path of a card of the set's types (kind `n`: the only rows with
// a number), by the number index's leading key, joined to the set by card
// unless the set is whole types.
export function storeMeasureRows(
  name: string,
  set: StoreFacetSet,
  f: number,
  path: string,
): CardExpression {
  let whole = isWholeTypes(set);
  let pathId = set.facetPathIds?.get(path) ?? -1;
  return [
    `SELECT ${Number(f)} AS f, ${whole ? 'v.card_id::bigint' : 'k.kn'} AS kn, v.num AS measure FROM boxel_index_values AS v${whole ? '' : ` JOIN ${name} AS k ON k.card_id = v.card_id`} WHERE v.realm_id IN (${ints(set.realmIds)}) AND v.type_id IN (${ints(set.typeIds)}) AND v.path_id = ${Number(pathId)} AND v.num IS NOT NULL`,
  ];
}
