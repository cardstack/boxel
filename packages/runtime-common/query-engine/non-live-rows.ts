// The rows an html search lists that the value store does not hold: the
// instance rows that are not live cards (value-store.ts, `LIVE_CARD`), which
// an html search shows as error cards. A counts-only html search (`page.size:
// 0`) counts its matches from the store, so its total adds these, the ones
// the filter matches, to stay the total a paged search of the same filter
// reports. A paged search matches an error row by what its index row holds:
// its last good types, and its last good search doc with the error's own
// search data laid over it (index-writer.ts), read by the same compiled
// filter as any row. Counted the same way here, the total is exact.
//
// Both reads stay off the index's heap but for these rows: the migration
// add-boxel-index-non-live-row-indexes keys each kind of non-live row by
// realm, and the predicates below repeat its index predicates word for word,
// which the planner needs to read them. Postgres only.

import {
  tableValuedFunctionsPlaceholder,
  type CardExpression,
  type Expression,
} from '../expression.ts';
import { LIVE_CARD } from '../value-store.ts';
import { realmIs } from '../realm-union.ts';
import { storeFacetKeysCte, type StoreFacetSet } from './store-facets.ts';

// An instance row with an error (`boxel_index_non_live_rows_idx`). An
// instance row's types are always a list (the index writer writes them as
// one), so this and a standing render error are the only ways one is not
// live. Each predicate tests a column the planner has statistics for, so it
// reads these few rows off their index rather than expecting to find one
// early in a scan of the realm.
const nonLiveRow = (alias: string) =>
  `${alias}.type = 'instance' AND ${alias}.is_deleted IS NOT TRUE AND ${alias}.has_error`;

// Every instance render error (`prerendered_html_instance_errors_idx`): a
// superset of the ones that keep a card from being live, which stand
// against its generation and are not a transient failure.
const instanceRenderError = (alias: string) =>
  `${alias}.type = 'instance' AND ${alias}.error_doc IS NOT NULL`;

// Whether the search's realms (`realmURL`, a realm or a union of them) hold
// any row that may not be a live card: two index-only reads.
export function realmHoldsNonLiveRows(realmURL: URL): Expression {
  return [
    'SELECT EXISTS (SELECT 1 FROM boxel_index AS e WHERE',
    ...realmIs('e.realm_url', realmURL),
    `AND ${nonLiveRow('e')}) OR EXISTS (SELECT 1 FROM prerendered_html AS p WHERE`,
    ...realmIs('p.realm_url', realmURL),
    `AND ${instanceRenderError('p')}) AS held`,
  ];
}

// A condition on `boxel_index AS i` that keeps only the search's realms'
// rows that are not live cards, read through the two indexes rather than
// the realms' rows.
export function nonLiveRowsOf(realmURL: URL): CardExpression {
  return [
    "(i.url, i.type) IN (SELECT e.url, 'instance' FROM boxel_index AS e WHERE",
    ...realmIs('e.realm_url', realmURL),
    `AND ${nonLiveRow('e')} UNION SELECT p.url, 'instance' FROM prerendered_html AS p WHERE`,
    ...realmIs('p.realm_url', realmURL),
    `AND ${instanceRenderError('p')}) AND NOT (${LIVE_CARD})`,
  ];
}

// A counts-only search's match set `m` (`WITH` included), in the columns a
// page's match set has (`url`, `type`, `__realm_url`, `__type_key`): the
// live matches the value store names (`set`) and the realms' non-live rows
// that `condition`, the page's own condition, admits. The two are disjoint,
// and together they are the rows that condition admits, read without the
// realms' other index rows. A facet counts a live card's values from the
// store and a non-live row's from its index row's search doc, its last good
// values, as it does over a page's own match set.
export function liveAndNonLiveMatches(
  set: StoreFacetSet,
  condition: CardExpression,
  realmURL: URL,
): CardExpression {
  return [
    'WITH',
    ...storeFacetKeysCte('live_keys', set),
    ', m AS MATERIALIZED (',
    `SELECT (c.url COLLATE "default")::varchar AS url, 'instance'::varchar AS type, (c.realm_url COLLATE "default")::varchar AS __realm_url, (t.type COLLATE "default")::text AS __type_key FROM live_keys AS k JOIN boxel_index_value_cards AS c ON c.id = k.card_id JOIN boxel_index_value_types AS t ON t.id = k.type_id`,
    'UNION ALL',
    'SELECT DISTINCT i.url, i.type, i.realm_url, i.types ->> 0 FROM boxel_index AS i',
    tableValuedFunctionsPlaceholder,
    'WHERE',
    ...condition,
    'AND',
    ...nonLiveRowsOf(realmURL),
    ')',
  ];
}

// The non-live rows `condition` admits, each once, with its search doc, in
// the columns a facet's search-doc arm reads (`kn`, below every store card's
// id, `card_id`, `type_key`, `path_ids`, `search_doc`); their count; and
// their count by realm (`realm_url` -> count, as JSON). `condition` holds
// no list read as a table (the caller checks), so a row is read once.
export function nonLiveFacetRows(realmURL: URL, condition: CardExpression) {
  let rows: CardExpression = [
    'SELECT i.url, i.realm_url, i.types ->> 0 AS type_key, i.search_doc FROM boxel_index AS i WHERE',
    ...condition,
    'AND',
    ...nonLiveRowsOf(realmURL),
  ];
  return {
    docs: [
      '(SELECT (-ROW_NUMBER() OVER ())::bigint AS kn, NULL::integer AS card_id, x.type_key, NULL::integer[] AS path_ids, x.search_doc FROM (',
      ...rows,
      ') AS x)',
    ] as CardExpression,
    count: ['(SELECT COUNT(*) FROM (', ...rows, ') AS x)'] as CardExpression,
    byRealm: [
      "(SELECT COALESCE(json_object_agg(y.realm_url, y.n), '{}'::json) FROM (SELECT x.realm_url, COUNT(*) AS n FROM (",
      ...rows,
      ') AS x GROUP BY x.realm_url) AS y)',
    ] as CardExpression,
  };
}
