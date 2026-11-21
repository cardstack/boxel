// Range filters from the value store: a positive range test on a number
// field is narrowed to the cards the realm's value store holds in range, an
// ordered index read (`boxel_index_values_num_idx`), so the search reads
// those rows by key instead of testing the field on every row of the type.
// Owns: the candidate set and when it is exact enough to narrow by.
// Must not: change which rows match: the test itself stays, and the
// candidates hold every card it can admit.
// Guarantees: docs/search.md ("Filters").
//
// The candidates are a superset of the test's matches among live cards: a
// card with a number in range at the path, one whose value there the store
// holds only as a marker (at or above the path; the value is in the search
// doc), and one holding text there (which the test reads as a number when
// it spells one). The caller narrows only where every row it can return is
// a live card of the promoted index of one realm (`valueStoreRealm`), and
// only a positive test: under a negation, a narrowed test would turn an
// unknown (a card with no value) into a match.

import {
  type Expression,
  any,
  param,
  separatedByCommas,
  typesContains,
} from '../expression.ts';
import { type StoreGrantKeys, grantedTypeTest } from './store-grant.ts';

const BOUNDS: Record<string, string> = {
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
};

// The ids of the cards a positive range admits, among the realm's store:
// a number in range at the path, a marker at or above the path, or text
// there (which the test reads as a number when it spells one).
function storedRangeCardIds(
  realm: string,
  path: string,
  range: Record<string, unknown>,
): Expression | undefined {
  let entries = Object.entries(range);
  if (
    entries.length === 0 ||
    entries.some(
      ([op, v]) => !BOUNDS[op] || typeof v !== 'number' || !Number.isFinite(v),
    )
  ) {
    return undefined;
  }
  let segments = path.split('.');
  let prefixes = [''].concat(
    segments.map((_, i) => segments.slice(0, i + 1).join('.')),
  );
  let scope = (alias: string): Expression => [
    `${alias}.realm_id = (SELECT id FROM boxel_index_value_realms WHERE realm_url =`,
    param(realm),
    `) AND ${alias}.type_id IN (SELECT t.id FROM boxel_index_value_types AS t WHERE t.realm_url =`,
    param(realm),
    ')',
  ];
  let atPath = (alias: string): Expression => [
    ...scope(alias),
    `AND ${alias}.path_id = (SELECT id FROM boxel_index_value_paths WHERE path =`,
    param(path),
    ')',
  ];
  let bounds: Expression = [];
  for (let [op, v] of entries) {
    bounds.push(`AND v.num ${BOUNDS[op]}`, param(v as number), '::numeric');
  }
  return [
    'SELECT v.card_id FROM boxel_index_values AS v WHERE',
    ...atPath('v'),
    ...bounds,
    'UNION SELECT m.card_id FROM boxel_index_values AS m WHERE',
    ...scope('m'),
    'AND m.path_id IN (SELECT id FROM boxel_index_value_paths WHERE path IN (',
    ...(separatedByCommas(prefixes.map((p) => [param(p)])) as Expression),
    ")) AND m.kind = 'm'",
    'UNION SELECT s.card_id FROM boxel_index_values AS s WHERE',
    ...atPath('s'),
    "AND s.txt IS NOT NULL AND s.kind = 's'",
  ];
}

// The rows whose url is one of `ids`' cards: the card ids as one array, so
// each is read by key from the card dictionary rather than the dictionary
// read whole for a join, and the urls as one array, which the index reads
// by key.
function urlAmong(ids: Expression): Expression {
  return [
    'i.url = ANY (ARRAY(SELECT (c.url COLLATE "default")::varchar FROM boxel_index_value_cards AS c WHERE c.id = ANY (ARRAY(',
    ...ids,
    '))))',
  ];
}

export function storedRangeCandidates(
  realm: string,
  path: string,
  range: Record<string, unknown>,
): Expression | undefined {
  let ids = storedRangeCardIds(realm, path, range);
  return ids ? urlAmong(ids) : undefined;
}

// The candidates of several ranges that are conjuncts of one filter: the
// cards every one of them admits, their store sets intersected in SQL, as
// one array on url. One array per range put two `url = ANY` on the index
// scan, which Postgres 16's btree does not intersect: case 8's two ranges
// (1,642 and 4,343 urls) took 147 ms in that scan for 585 rows, against
// 25 ms with the one intersected array.
export function storedRangesCandidates(
  ranges: {
    realm: string;
    path: string;
    range: Record<string, unknown>;
  }[],
): Expression | undefined {
  let sets = ranges.map((r) => storedRangeCardIds(r.realm, r.path, r.range));
  if (sets.length === 0 || sets.some((ids) => !ids)) {
    return undefined;
  }
  return urlAmong(
    sets.flatMap(
      (ids, n): Expression => [
        ...(n > 0 ? [') INTERSECT ('] : ['(']),
        ...ids!,
        ...(n === sets.length - 1 ? [')'] : []),
      ],
    ),
  );
}

// The number of live cards of one realm whose type chain names one of
// `typeKeys`: one entry per card in the value store's text index (each live
// card's row at the empty path), so a count over a whole type reads no
// index row. The store holds exactly the cards a search of live instances
// of the promoted index admits. With `grant`, a realm policy's grant the
// store carries (store-grant.ts), only the cards of the types it admits.
export function storedTypeCount(
  realm: string,
  typeKeys: string[],
  grant?: StoreGrantKeys,
): Expression {
  return [
    'SELECT COUNT(*) AS total FROM boxel_index_values AS v WHERE v.realm_id = (SELECT id FROM boxel_index_value_realms WHERE realm_url =',
    param(realm),
    ') AND v.type_id IN (SELECT t.id FROM boxel_index_value_types AS t WHERE t.realm_url =',
    param(realm),
    'AND (',
    ...(any(
      typeKeys.map((key) => [typesContains(key, 't.types')]),
    ) as Expression),
    ')',
    ...(grant ? grantedTypeTest('t.types', grant) : []),
    ") AND v.path_id = (SELECT id FROM boxel_index_value_paths WHERE path = '') AND v.txt = '' AND v.kind = 'c'",
  ];
}
