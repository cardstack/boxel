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
// at or above a path the facets or the tests read.
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

export interface StoreValueTest {
  pathId: number;
  op: 'eq' | 'in' | 'not-eq' | 'not-in';
  values: (string | boolean)[];
}

export interface StoreFacetSet {
  realmId: number;
  // The types whose cards match (every positive type test, none negated).
  typeIds: number[];
  // Each type's key (its `types ->> 0`).
  typeKeys: Map<number, string>;
  rootId: number;
  tests: StoreValueTest[];
}

const ints = (ids: number[]) =>
  ids.length ? ids.map(Number).join(', ') : 'NULL';

// The text a test compares, of the store row `alias`.
const text = (alias: string) =>
  `COALESCE(${alias}.txt COLLATE "default", ${alias}.num::text)`;

// Whether `read` (a store row's text) passes `test`.
function holds(
  alias: string,
  test: StoreValueTest,
  read = text(alias),
): CardExpression {
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

// Whether every card of the set's types matches (no value test).
export function isWholeTypes(set: StoreFacetSet): boolean {
  return set.tests.length === 0;
}

// The set's matches, one row per card: `kn` (the card's id, by which the
// facet rows count it), `card_id` and `type_id`. Read from one positive
// test's rows (or each card's row at the empty path), each other test a
// keyed read of the card's row at its path.
export function storeFacetKeysCte(
  name: string,
  set: StoreFacetSet,
): CardExpression {
  let driver = set.tests.find((t) => t.op === 'eq' || t.op === 'in');
  let rest = set.tests.filter((t) => t !== driver);
  let scope = `d.realm_id = ${Number(set.realmId)} AND d.type_id IN (${ints(set.typeIds)})`;
  let probes: CardExpression = rest.flatMap(
    (test): CardExpression => [
      `AND EXISTS (SELECT 1 FROM boxel_index_values AS sv WHERE sv.card_id = d.card_id AND sv.path_id = ${Number(test.pathId)} AND`,
      ...holds('sv', test),
      ')',
    ],
  );
  let rows: CardExpression = driver
    ? [
        // The driving test's rows: its text by the text index's key (byte
        // equality is the database collation's equality), and a number's
        // text from the number index.
        `(SELECT d.card_id, d.type_id FROM boxel_index_values AS d WHERE ${scope} AND d.path_id = ${Number(driver.pathId)} AND`,
        ...holds('d', driver, 'd.txt'),
        `UNION ALL SELECT d.card_id, d.type_id FROM boxel_index_values AS d WHERE ${scope} AND d.path_id = ${Number(driver.pathId)} AND d.num IS NOT NULL AND`,
        ...holds('d', driver, 'd.num::text'),
        ') AS d',
      ]
    : [
        `(SELECT d.card_id, d.type_id FROM boxel_index_values AS d WHERE ${scope} AND d.path_id = ${Number(set.rootId)} AND d.txt = '') AS d`,
      ];
  return [
    `${name} AS MATERIALIZED (SELECT d.card_id::bigint AS kn, d.card_id, d.type_id FROM`,
    ...rows,
    'WHERE TRUE',
    ...probes,
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
  fs: number[],
  holders: Map<number, string[]>,
): CardExpression[] {
  let list = fs.join(', ');
  let holderTest = (alias: string): string => {
    if (holders.size === 0) {
      return '';
    }
    let cases = [...holders].map(([f, keys]) => {
      let ids = [...set.typeKeys]
        .filter(([, key]) => keys.includes(key))
        .map(([id]) => id);
      return `WHEN ${Number(f)} THEN ${alias}.type_id IN (${ints(ids)})`;
    });
    return ` AND CASE fp.f ${cases.join(' ')} ELSE TRUE END`;
  };
  if (isWholeTypes(set)) {
    // Every card of the types matches: the rows at each facet's path, by
    // the index's leading key, with no join to the set.
    let scan = (column: 'txt' | 'num') =>
      `SELECT fp.f, v.card_id::bigint AS kn, ${
        column === 'txt' ? 'v.txt' : 'v.num::text'
      } COLLATE "C" AS value, ${
        column === 'txt' ? 'NULL::numeric' : 'v.num'
      } AS num, NULL::text AS label FROM facet_paths AS fp JOIN boxel_index_values AS v ON v.path_id = fp.path_id AND v.realm_id = ${Number(
        set.realmId,
      )} AND v.type_id IN (${ints(set.typeIds)}) AND v.${column} IS NOT NULL WHERE fp.f IN (${list})${holderTest('v')}`;
    return [[scan('txt')], [scan('num')]];
  }
  // Each match's rows at its facets' paths, one keyed read per card.
  return [
    [
      `SELECT fp.f, k.kn, COALESCE(v.txt, v.num::text) COLLATE "C" AS value, v.num, NULL::text AS label FROM ${name} AS k CROSS JOIN LATERAL (SELECT v.path_id, v.txt, v.num FROM boxel_index_values AS v WHERE v.card_id = k.card_id AND v.path_id = ANY (ARRAY(SELECT fp.path_id FROM facet_paths AS fp WHERE fp.f IN (${list}) AND fp.path_id IS NOT NULL)) AND v.kind IN ('s', 'n', 'b')) AS v JOIN facet_paths AS fp ON fp.path_id = v.path_id AND fp.f IN (${list}) WHERE TRUE${holderTest('k')}`,
    ],
  ];
}
