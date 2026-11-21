// A re-rank's comparison set from the value store: when the set is every
// live card of one card type and each field the expression compares (and
// the `compare.by` group) is a primitive field, the set's rows, in the
// general read's order and cut at the same row limit, come from the store's
// narrow rows (`boxel_index_values`), so no `boxel_index` row of the type is
// read.
// Owns: the statement that reads the set from the store.
// Must not: change the set's rows, their order, their values or the total.
// Guarantees: docs/search.md ("Ranking by an expression (`expression`)").
//
// Why it is the general read's set. The general read selects the type's
// live instances of the realm (the base conditions and the type test), in
// `url` byte order, up to the row limit, and counts all of them; the store
// holds exactly the live cards (value-store.ts), each with one `c` row at
// the empty path, and its card dictionary keeps each card's `url` in the
// "C" collation, whose order is the general read's "POSIX". The general
// read reads a field through the hot doc (`search_keys`, or `search_doc`
// where search_keys holds a marker at or above the path); the store's rows
// are search_keys' values. A primitive field reached through `contains`
// fields holds at most one value: a number is a `n` row (`num`, the same
// numeric `#>>` prints, so the same double), a string a `s` row (`txt`), a
// boolean a `b` row, and a missing or null value no row. So `c<i>` (the
// number), `t<i>` (a string's text) and `g` (the group's text as `#>>`
// reads it: a string's or a boolean's text, a number's numeric text) read
// the same values. A card whose value at or above one of those paths is
// held only as a marker (the value is in the search doc) is flagged
// `marked`: the store cannot read it, and the caller then reads the set the
// general way.
//
// The statement is plain: the set's cards joined to their value rows at the
// compared paths (and the paths above them, for markers), grouped by card,
// the planner choosing the join. The realm, the types and the paths are
// written as values, from a read of the dictionaries first
// (`storedComparisonIds`), and the paths filter the join itself, so each
// card's rows are one keyed read of the card index. On a 12,000-product shop bench
// (case 8, 10,000 of 12,084 products compared) it reads ~2,370 blocks cold
// and runs in ~64 ms warm, with the same plan when the statistics are
// withheld (156k hits, 62 ms). Two other forms were tried. A fenced form
// (each path's rows a MATERIALIZED range scan, hash-joined) read 188 blocks
// in 38 ms warm, but without statistics it nested-looped over its CTE scans
// for 8.3 s. A form that joined the cards to a path dictionary CTE probed
// three times per card (285 ms warm). Neither is used.

import {
  type Expression,
  any,
  param,
  separatedByCommas,
  typesContains,
} from '../expression.ts';

// The dictionary ids the set's statement names: the realm, the types whose
// chain names the set's type, and the paths it reads.
export function storedComparisonIds({
  realm,
  typeKeys,
  paths,
}: {
  realm: string;
  typeKeys: string[];
  paths: string[];
}): Expression {
  return [
    'SELECT (SELECT id FROM boxel_index_value_realms WHERE realm_url =',
    param(realm),
    ") AS realm, (SELECT COALESCE(json_agg(t.id), '[]'::json) FROM boxel_index_value_types AS t WHERE t.realm_url =",
    param(realm),
    'AND (',
    ...(any(
      typeKeys.map((key) => [typesContains(key, 't.types')]),
    ) as Expression),
    ")) AS types, (SELECT COALESCE(json_object_agg(p.path, p.id), '{}'::json) FROM boxel_index_value_paths AS p WHERE p.path IN (",
    ...(separatedByCommas(paths.map((p) => [param(p)])) as Expression),
    ')) AS paths',
  ];
}

// The paths the set reads: the compared fields, the group, and every path
// above them (where a marker would hold their values).
export function comparedPaths(fields: string[], by: string | undefined) {
  let paths = new Set<string>(['']);
  for (let path of [...fields, ...(by ? [by] : [])]) {
    let segments = path.split('.');
    segments.forEach((_, i) => paths.add(segments.slice(0, i + 1).join('.')));
  }
  return paths;
}

export function storedComparisonSet({
  realmId,
  typeIds,
  pathIds,
  fields,
  by,
  limit,
}: {
  realmId: number;
  typeIds: number[];
  pathIds: Map<string, number>;
  fields: string[];
  by: string | undefined;
  limit: number;
}): Expression {
  // A path the dictionary does not hold holds no card's value.
  let id = (path: string) => Number(pathIds.get(path) ?? -1);
  let ids = (list: Iterable<string>) =>
    [...new Set([...list].map(id))].join(', ');
  let types = typeIds.length ? typeIds.map(Number).join(', ') : 'NULL';
  let prefixes = comparedPaths(fields, by);
  let scope = (alias: string) =>
    `${alias}.realm_id = ${Number(realmId)} AND ${alias}.type_id IN (${types})`;
  return [
    // each live card of the type, once (its `c` row)
    `WITH k AS (SELECT v.card_id FROM boxel_index_values AS v WHERE ${scope('v')} AND v.path_id = ${id('')} AND v.txt = '' AND v.kind = 'c'),`,
    's AS (SELECT c.id, c.url FROM boxel_index_value_cards AS c WHERE c.id IN (SELECT card_id FROM k) ORDER BY c.url LIMIT',
    param(limit),
    ')',
    // The set's cards joined to their rows at the compared paths (and the
    // paths above them, for markers), grouped by card: one plain
    // statement, the planner choosing the join.
    `SELECT s.url, (SELECT COUNT(*) FROM k) AS total, COALESCE(bool_or(v.kind = 'm'), FALSE) AS marked`,
    ...fields.flatMap((f, i) => [
      `, (MAX(v.num) FILTER (WHERE v.path_id = ${id(f)} AND v.kind = 'n'))::double precision AS c${i}, MAX(v.txt) FILTER (WHERE v.path_id = ${id(f)} AND v.kind = 's') AS t${i}`,
    ]),
    ...(by
      ? [
          `, MAX(COALESCE(v.txt, v.num::text)) FILTER (WHERE v.path_id = ${id(by)} AND v.kind IN ('s', 'n', 'b')) AS g`,
        ]
      : []),
    `FROM s LEFT JOIN boxel_index_values AS v ON v.card_id = s.id AND ${scope('v')} AND v.path_id IN (${ids(prefixes)})`,
    'GROUP BY s.id, s.url ORDER BY s.url',
  ];
}
