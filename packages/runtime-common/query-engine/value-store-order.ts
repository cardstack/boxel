// The ordered read: a plain page sorted by a number, date or date-time field, read off
// the value store's number or instant index (`boxel_index_values`) in the sort's order, testing
// each card against the search's condition and stopping once the page and
// its lookahead row are found. The engine then orders that small candidate
// set by the query's own sort, so the page is the one the general read
// would return.
// Owns: when the ordered read applies (`ORDERED_READ_ENTRIES`,
// `ORDERED_READ_PAGE_END`) and its statement.
// Must not: change which rows match or their order.
// Guarantees: docs/search.md ("Pagination").
//
// The rule. The read walks the sort field's values in order, merged across
// the queried type's stored types (one ordered index read per type), at most
// `ORDERED_READ_ENTRIES` entries. When the condition admits enough of them to
// fill the page and its lookahead row, the page comes from them. Otherwise,
// a selective condition or too few cards with a value, it gives up and the
// page is read the general way: a selective filter pays at most that many
// probes of the index row on top of the general read, never a walk of the
// whole type.
//
// A date or date-time field sorts by its text in the database's collation.
// For a fixed-width form, `YYYY-MM-DD` for a date and `YYYY-MM-DDTHH:MM`
// (no zone, read as UTC) for a date-time, the text's order is its
// instant's, so the instant index walks the field's one form in the query's
// order, and two cards tie exactly when their instants do. The walk reads
// each entry's text and keeps only the field's form (the entries it drops
// count toward `ORDERED_READ_ENTRIES`); every other card at the path is a
// candidate:
// - text with no instant, or with an instant but in no fixed form (an
//   offset, seconds, a fraction), read off the partial index
//   `boxel_index_values_unplaced_txt_idx`, whose predicate
//   `UNPLACED_TEXT` repeats;
// - the other fixed form (a day in a date-time field, a minute in a date
//   field), whose text and instant orders disagree at a tie
//   (`2026-01-01` sorts before `2026-01-01T00:00` at one instant): such an
//   entry ahead of the last instant found is read off the instant index up
//   to it, at most the walk's own entries; one at that instant is in the
//   tie group; and one past it sorts after the page, since for these two
//   forms text before text means an instant no later.
// A text field does not walk: the store keeps text in byte order ("C") and
// the query orders it in the database's collation (en_US on the bench:
// "apple" before "Banana", which byte order reverses), so the walk would
// not meet the query's first cards first.
//
// Why the candidates hold the page: every card the condition admits with a
// value past the last one found was walked before it, so it is among those
// found; a card with the last value found ties it, and every card with that
// value is a candidate (the whole tie group, whether or not it was walked);
// a card whose value the store holds only as a marker, or as text that reads
// as a number, is a candidate too, since the store cannot place it; and a
// card with no value sorts after every value (missing last), past the page.

import {
  type CardExpression,
  any,
  param,
  separatedByCommas,
  typesContains,
} from '../expression.ts';

// The most index entries the ordered read walks before it gives up.
export const ORDERED_READ_ENTRIES = 2000;

// The furthest page end (offset, size and the lookahead row) it reads.
export const ORDERED_READ_PAGE_END = 201;

// The fixed-width forms the instant index walks, one per field: a date's
// and a date-time's (to the minute, no zone).
export const WALKED_FORMS = {
  date: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$',
  datetime: '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}$',
} as const;

// Text the instant index cannot place in either fixed form: the predicate
// of `boxel_index_values_unplaced_txt_idx` (migration
// add-boxel-index-values-unplaced-txt-idx), over the alias `alias`. It is
// written out the same so the planner proves the index applies.
export function unplacedText(alias: string): string {
  return `${alias}.txt IS NOT NULL AND (${alias}.ts IS NULL OR ${alias}.txt !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}(T[0-9]{2}:[0-9]{2})?$')`;
}

// The value store's ids of the realm's types whose cards are cards of every
// type `typeKeys` lists (each type's `types` chain names one of its keys).
export function orderedReadTypes(
  realm: string,
  typeKeys: string[][],
): CardExpression {
  return [
    'SELECT t.id FROM boxel_index_value_types AS t WHERE t.realm_url =',
    param(realm),
    ...typeKeys.flatMap((keys) => [
      'AND',
      ...(any(
        keys.map((key) => [typesContains(key, 't.types')]),
      ) as CardExpression),
    ]),
    'ORDER BY t.id',
  ];
}

// The ordered read's one statement. `cardCondition` is the search's
// condition over `boxel_index AS i` (with the prerendered join `join`),
// `select` the page's key and sort columns, `orderKeys` the query's order.
// Its rows are the page's keys in order, with the lookahead row, each
// carrying `__walked`, the number of cards the walk found; no key row is
// returned when it found too few, and the caller reads the page the general
// way.
export function orderedReadStatement({
  realm,
  typeIds,
  path,
  column,
  form,
  direction,
  pageEnd,
  size,
  offset,
  join,
  cardCondition,
  select,
  orderKeys,
  then,
}: {
  realm: string;
  typeIds: number[];
  path: string;
  // The value the sort reads: a number, or a calendar day's instant.
  column: 'num' | 'ts';
  // For the instant index, the field's kind, which names its walked form.
  form?: 'date' | 'datetime';
  direction: 'asc' | 'desc';
  pageEnd: number;
  size: number;
  offset: number;
  join: string;
  cardCondition: CardExpression;
  select: CardExpression;
  orderKeys: CardExpression[];
  // The query's second sort key, when it is a number field read missing
  // last: the tie group of the last value found is then read in its order.
  then?: { path: string; direction: 'asc' | 'desc' };
}): CardExpression {
  let dir = direction === 'desc' ? 'DESC' : 'ASC';
  let walked = column === 'ts' ? WALKED_FORMS[form ?? 'date'] : undefined;
  let types = typeIds.map(Number).join(', ');
  let segments = path.split('.');
  let prefixes = [''].concat(
    segments.map((_, i) => segments.slice(0, i + 1).join('.')),
  );
  let where = (alias: string): CardExpression => [
    `${alias}.realm_id = (SELECT id FROM boxel_index_value_realms WHERE realm_url =`,
    param(realm),
    `) AND ${alias}.path_id = (SELECT id FROM boxel_index_value_paths WHERE path =`,
    param(path),
    ')',
  ];
  // One ordered read per type, merged in the sort's order.
  let perType: CardExpression = [];
  typeIds.forEach((id, index) => {
    perType.push(
      ...(index > 0 ? ['UNION ALL'] : []),
      `(SELECT v.card_id, v.${column} AS val${walked ? ', v.txt' : ''} FROM boxel_index_values AS v WHERE`,
      ...where('v'),
      `AND v.type_id = ${Number(id)} AND v.${column} IS NOT NULL ORDER BY v.${column} ${dir} LIMIT ${ORDERED_READ_ENTRIES})`,
    );
  });
  return [
    `WITH walked AS MATERIALIZED (SELECT w.card_id, w.val FROM (SELECT u.card_id, u.val${walked ? ', u.txt' : ''} FROM (`,
    ...perType,
    `) AS u ORDER BY u.val ${dir} LIMIT ${ORDERED_READ_ENTRIES}) AS w`,
    `WHERE ${walked ? `w.txt ~ '${walked}' AND ` : ''}EXISTS (SELECT 1 FROM boxel_index AS i ${join} WHERE i.realm_url =`,
    param(realm),
    `AND i.url = (SELECT (c.url COLLATE "default")::varchar FROM boxel_index_value_cards AS c WHERE c.id = w.card_id) AND`,
    ...cardCondition,
    `) ORDER BY w.val ${dir} LIMIT ${Number(pageEnd)}),`,
    `edge AS (SELECT COUNT(*) AS n, ${direction === 'desc' ? 'MIN' : 'MAX'}(val) AS e FROM walked),`,
    ...(then
      ? tieInOrder({
          realm,
          types,
          path,
          column,
          then,
          pageEnd,
          join,
          cardCondition,
        })
      : []),
    'candidates AS (SELECT card_id FROM walked',
    ...(then
      ? ['UNION SELECT card_id FROM tie_kept']
      : [
          // The tie group of the last value found.
          'UNION SELECT t.card_id FROM boxel_index_values AS t WHERE',
          ...where('t'),
          `AND t.type_id IN (${types}) AND t.${column} = (SELECT e FROM edge)`,
        ]),
    // Values the store cannot place: a marker at or above the path, or text.
    'UNION SELECT m.card_id FROM boxel_index_values AS m WHERE m.realm_id = (SELECT id FROM boxel_index_value_realms WHERE realm_url =',
    param(realm),
    `) AND m.type_id IN (${types}) AND m.path_id IN (SELECT id FROM boxel_index_value_paths WHERE path IN (`,
    ...separatedByCommas(prefixes.map((p) => [param(p)])),
    ")) AND m.kind = 'm'",
    'UNION SELECT s.card_id FROM boxel_index_values AS s WHERE',
    ...where('s'),
    ...(column === 'num'
      ? [
          `AND s.type_id IN (${types}) AND s.txt IS NOT NULL AND s.txt ~ '^\\s*-?[0-9]+(\\.[0-9]+)?([eE][-+]?[0-9]+)?\\s*$')`,
        ]
      : [
          // Text the instant index cannot place, and numbers.
          `AND s.type_id IN (${types}) AND ${unplacedText('s')}`,
          'UNION SELECT n.card_id FROM boxel_index_values AS n WHERE',
          ...where('n'),
          `AND n.type_id IN (${types}) AND n.num IS NOT NULL`,
          // The other fixed form, ahead of the last instant found.
          'UNION SELECT o.card_id FROM boxel_index_values AS o WHERE',
          ...where('o'),
          `AND o.type_id IN (${types}) AND o.ts ${direction === 'desc' ? '>' : '<'} (SELECT e FROM edge) AND o.txt !~ '${walked}')`,
        ]),
    'SELECT p.*, edge.n AS __walked FROM edge LEFT JOIN LATERAL (',
    ...select,
    `FROM boxel_index AS i ${join} WHERE`,
    ...cardCondition,
    'AND edge.n >=',
    param(pageEnd),
    `AND i.url = ANY (ARRAY(SELECT (c.url COLLATE "default")::varchar FROM boxel_index_value_cards AS c WHERE c.id IN (SELECT card_id FROM candidates)))`,
    'ORDER BY',
    ...separatedByCommas(orderKeys),
    `LIMIT ${Number(size) + 1} OFFSET ${Number(offset)}) AS p ON TRUE`,
  ];
}

// The tie group of the walk's last value (`edge`), read in the order of the
// query's second sort key, a number field read missing last, from the
// store: the cards of the group the condition admits, in that order, until
// the page and its lookahead row are filled after the walk's cards past the
// last value (`tie_found`); then every card of the group that ties the last
// of those, and every one whose second value the store cannot place (a
// marker at or above its path, or text). When the group holds too few
// admitted cards with a second value, the whole group is kept. The kept
// cards (`tie_kept`) hold the group's share of the page: an admitted card
// ahead of the last one found by the second key was found, one tying it is
// kept, and one past it (or with no second value) sorts after the page.
function tieInOrder({
  realm,
  types,
  path,
  column,
  then,
  pageEnd,
  join,
  cardCondition,
}: {
  realm: string;
  types: string;
  path: string;
  column: 'num' | 'ts';
  then: { path: string; direction: 'asc' | 'desc' };
  pageEnd: number;
  join: string;
  cardCondition: CardExpression;
}): CardExpression {
  let dir = then.direction === 'desc' ? 'DESC' : 'ASC';
  let segments = then.path.split('.');
  let prefixes = [''].concat(
    segments.map((_, i) => segments.slice(0, i + 1).join('.')),
  );
  let realmId: CardExpression = [
    '(SELECT id FROM boxel_index_value_realms WHERE realm_url =',
    param(realm),
    ')',
  ];
  let at = (alias: string, p: string): CardExpression => [
    `${alias}.realm_id =`,
    ...realmId,
    `AND ${alias}.type_id IN (${types}) AND ${alias}.path_id = (SELECT id FROM boxel_index_value_paths WHERE path =`,
    param(p),
    ')',
  ];
  // The page's rows the group must fill: those the walk's cards past the
  // last value leave.
  let need = `GREATEST(${Number(pageEnd)} - (SELECT COUNT(*) FROM walked WHERE val <> (SELECT e FROM edge)), 0)`;
  return [
    'tie AS MATERIALIZED (SELECT t.card_id, (SELECT h.num FROM boxel_index_values AS h WHERE',
    ...at('h', then.path),
    'AND h.card_id = t.card_id AND h.num IS NOT NULL LIMIT 1) AS hn FROM boxel_index_values AS t WHERE',
    ...at('t', path),
    `AND t.${column} = (SELECT e FROM edge)),`,
    // Read in order, each card tested as it is reached, until enough pass.
    `tie_found AS MATERIALIZED (SELECT f.card_id, f.hn FROM (SELECT card_id, hn FROM tie WHERE hn IS NOT NULL ORDER BY hn ${dir} OFFSET 0) AS f WHERE EXISTS (SELECT 1 FROM boxel_index AS i ${join} WHERE i.realm_url =`,
    param(realm),
    'AND i.url = (SELECT (c.url COLLATE "default")::varchar FROM boxel_index_value_cards AS c WHERE c.id = f.card_id) AND',
    ...cardCondition,
    `) ORDER BY f.hn ${dir} LIMIT ${need}),`,
    `tie_edge AS (SELECT COUNT(*) AS n, ${dir === 'DESC' ? 'MIN' : 'MAX'}(hn) AS e FROM tie_found),`,
    'tie_kept AS (SELECT g.card_id FROM tie AS g WHERE',
    `(SELECT n FROM tie_edge) < ${need} OR g.hn = (SELECT e FROM tie_edge) OR g.card_id IN (SELECT card_id FROM tie_found)`,
    // Second values the store cannot place.
    'OR g.card_id IN (SELECT m.card_id FROM boxel_index_values AS m WHERE m.realm_id =',
    ...realmId,
    `AND m.type_id IN (${types}) AND m.path_id IN (SELECT id FROM boxel_index_value_paths WHERE path IN (`,
    ...separatedByCommas(prefixes.map((p) => [param(p)])),
    `)) AND m.kind = 'm')`,
    'OR g.card_id IN (SELECT s.card_id FROM boxel_index_values AS s WHERE',
    ...at('s', then.path),
    "AND s.txt IS NOT NULL AND s.txt ~ '^\\s*-?[0-9]+(\\.[0-9]+)?([eE][-+]?[0-9]+)?\\s*$')),",
  ];
}
