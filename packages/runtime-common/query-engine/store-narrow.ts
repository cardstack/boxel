// A full-text term's candidates narrowed by the value store: before each
// candidate's `boxel_index` row is read, the store drops those it proves the
// rest of the filter refuses (a card of another type, one whose tested value
// fails), so only the rest are read.
// Owns: `StoreKeep` and the condition a candidate is kept by.
// Must not: change which rows match: the filter's own tests still apply to
// every row read, and the store drops only a card it can decide.
// Guarantees: docs/search.md ("Full-text search").
//
// The rule. The engine marks a `matches` term that is a conjunct of the
// whole filter (`storeKeep`, never on the wire) with the other conjuncts the
// store decides: the search's card types, a type it excludes, and, under a
// `not`, an `eq` or `in` on a text or boolean field (store-blend.ts). A
// candidate is kept when it is a card instance the store holds (a live
// instance, the only kind the search's card type admits; a card type's
// chain is never a file row's) of a type the tests admit, and for each
// value test the store holds a value at its path that passes it, or holds
// the card's value there only as a marker (the value is in the search doc,
// so the store cannot decide it). A card the store drops fails a conjunct
// of the filter, so it was never a match.

import {
  type Expression,
  any,
  param,
  separatedByCommas,
  typesContains,
} from '../expression.ts';
import type { MatchesFilter } from '../query.ts';

export interface StoreKeep {
  realm: string;
  // Each a type the card must be of (any one of its keys).
  types: string[][];
  // Each a type the card must not be of.
  notTypes: string[][];
  values: {
    path: string;
    op: 'not-eq' | 'not-in';
    values: (string | boolean)[];
  }[];
}

// The condition a candidate row (`alias`, with url, realm_url and type) is
// kept by.
export function storeKeepCondition(alias: string, keep: StoreKeep): Expression {
  let typeIds = (keys: string[]): Expression => [
    'SELECT t.id FROM boxel_index_value_types AS t WHERE t.realm_url =',
    param(keep.realm),
    'AND',
    ...(any(
      keys.map((key): Expression => [typesContains(key, 't.types')]),
    ) as Expression),
  ];
  let pathId = (path: string): Expression => [
    '(SELECT p.id FROM boxel_index_value_paths AS p WHERE p.path =',
    param(path),
    ')',
  ];
  let rootTests: Expression = [
    // Each set read once (an InitPlan), not once per candidate.
    ...keep.types.flatMap((keys) => [
      'AND sr.type_id = ANY (ARRAY(',
      ...typeIds(keys),
      '))',
    ]),
    ...keep.notTypes.flatMap((keys) => [
      'AND sr.type_id <> ALL (ARRAY(',
      ...typeIds(keys),
      '))',
    ]),
  ];
  let valueTests: Expression = keep.values.flatMap((test): Expression => {
    let segments = test.path.split('.');
    let prefixes = [''].concat(
      segments.map((_, i) => segments.slice(0, i + 1).join('.')),
    );
    let listed = separatedByCommas(
      test.values.map((v): Expression => [param(v)]),
    ) as Expression;
    return [
      'AND (EXISTS (SELECT 1 FROM boxel_index_values AS sv WHERE sv.card_id = sc.id AND sv.path_id =',
      ...pathId(test.path),
      'AND COALESCE(sv.txt COLLATE "default", sv.num::text)',
      ...(test.op === 'not-eq'
        ? ['<>', ...listed]
        : ['NOT IN (', ...listed, ')']),
      ") OR EXISTS (SELECT 1 FROM boxel_index_values AS sm WHERE sm.card_id = sc.id AND sm.kind = 'm' AND sm.path_id = ANY (ARRAY(SELECT p.id FROM boxel_index_value_paths AS p WHERE p.path IN (",
      ...(separatedByCommas(
        prefixes.map((p): Expression => [param(p)]),
      ) as Expression),
      ')))))',
    ];
  });
  return [
    `(${alias}.type = 'instance' AND EXISTS (SELECT 1 FROM boxel_index_value_cards AS sc WHERE sc.realm_url = ${alias}.realm_url AND sc.url = ${alias}.url`,
    'AND EXISTS (SELECT 1 FROM boxel_index_values AS sr WHERE sr.card_id = sc.id AND sr.path_id =',
    ...pathId(''),
    ...rootTests,
    ')',
    ...valueTests,
    '))',
  ];
}

// The test a side of a `matches` term's candidate read adds for its rows
// (`alias`, with url, realm_url and type): none, or, for a term marked
// `storeKeep`, that the store keeps the row.
export function storeKept(filter: MatchesFilter, alias: string): Expression {
  return filter.storeKeep
    ? ['AND', ...storeKeepCondition(alias, filter.storeKeep)]
    : [];
}
