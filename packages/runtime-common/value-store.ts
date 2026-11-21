// The value store (`boxel_index_values`, see the add-boxel-index-values
// migration): every small value of every live card, one row per value, read
// out of the card's promoted `search_keys` by the one walk the migration
// defines (`boxel_value_rows`). The index writer calls `syncValueStore` in the
// swap transaction, after the pass's rows (and, where the pass publishes it,
// its prerendered html) are promoted, so a card's value rows and its
// `boxel_index` row change together.
//
// A card has rows only while it is live: an instance, not deleted, without an
// error, and with no prerendered error from its generation or later (the
// engine's liveness test, `LIVE_CARD`). A transient render failure stored as
// an error before the writer kept the last good render instead
// (`ungatedRenderErrorSQL`: a render timeout, an aborted prerender request)
// does not count: it is not a fact about the card, so it must not take the
// card's rows out of every search. A pass that promotes only prerendered
// html changes no search doc, only liveness, so it calls
// `syncValueStoreLiveness`: a card that stopped being live loses its rows and
// one that became live gets them. Postgres only.

import {
  type Expression,
  addExplicitParens,
  param,
  separatedByCommas,
} from './expression.ts';
import type { DBAdapter } from './db.ts';
import { ungatedRenderErrorSQL } from './error.ts';
import { dialectFor } from './query-engine/dialect.ts';

export interface ValueStoreHost {
  dbAdapter: DBAdapter;
  query: (expression: Expression) => Promise<Record<string, unknown>[]>;
}

// The engine's liveness test over `boxel_index AS i` (its realm and url
// already chosen by the caller).
export const LIVE_CARD = `i.type = 'instance'
  AND (i.is_deleted = FALSE OR i.is_deleted IS NULL)
  AND NOT COALESCE(i.has_error, FALSE)
  AND jsonb_typeof(i.types) = 'array'
  AND NOT EXISTS (
    SELECT 1 FROM prerendered_html AS phe
    WHERE phe.url = i.url AND phe.realm_url = i.realm_url
      AND phe.type = i.type AND phe.error_doc IS NOT NULL
      AND phe.generation >= i.generation
      AND NOT ${ungatedRenderErrorSQL('phe')})`;

const CHUNK = 500;

const urlList = (urls: string[]): Expression =>
  addExplicitParens(
    separatedByCommas(urls.map((url) => [param(url)]) as Expression[]),
  ) as Expression;

async function realmId(host: ValueStoreHost, realmURL: string) {
  // Its own statements: a realm another pass added concurrently is read
  // after that pass commits.
  await host.query([
    'INSERT INTO boxel_index_value_realms (realm_url) VALUES (',
    param(realmURL),
    ') ON CONFLICT DO NOTHING',
  ]);
  let [row] = await host.query([
    'SELECT id FROM boxel_index_value_realms WHERE realm_url =',
    param(realmURL),
  ]);
  return Number(row.id);
}

// The cards of `urls` (that the dictionary knows) lose every value row.
function deleteRows(realmURL: string, urls: string[]): Expression {
  return [
    'DELETE FROM boxel_index_values WHERE card_id IN (SELECT c.id FROM boxel_index_value_cards AS c WHERE c.realm_url =',
    param(realmURL),
    'AND c.url IN',
    ...urlList(urls),
    ')',
  ];
}

// Writes the value rows of the live cards among `urls`, which hold none. A
// dictionary entry this statement adds is read back from its own insert; one
// a concurrent pass added after this statement's snapshot is not visible, so
// its rows would be dropped. The statement answers how many rows it did not
// write, and the caller writes those cards again in a fresh statement.
function insertRows(
  realmURL: string,
  realm: number,
  urls: string[],
  extraCondition?: string,
): Expression {
  let r = () => param(realmURL);
  return [
    'WITH live AS MATERIALIZED (SELECT i.url, i.types, i.search_keys FROM boxel_index AS i WHERE i.realm_url =',
    r(),
    'AND i.url IN',
    ...urlList(urls),
    `AND ${LIVE_CARD}`,
    ...(extraCondition ? [`AND ${extraCondition}`] : []),
    '),',
    `src AS MATERIALIZED (SELECT l.url, COALESCE(l.types ->> 0, '') AS type, v.path, v.kind, v.txt, v.num, v.ts FROM live AS l CROSS JOIN LATERAL boxel_value_rows(l.search_keys) AS v),`,
    `nt AS (INSERT INTO boxel_index_value_types (realm_url, type, types) SELECT DISTINCT ON (COALESCE(l.types ->> 0, ''))`,
    r(),
    `, COALESCE(l.types ->> 0, ''), l.types FROM live AS l WHERE NOT EXISTS (SELECT 1 FROM boxel_index_value_types AS t WHERE t.realm_url =`,
    r(),
    `AND t.type = COALESCE(l.types ->> 0, '')) ORDER BY COALESCE(l.types ->> 0, '') ON CONFLICT DO NOTHING RETURNING id, type),`,
    'nc AS (INSERT INTO boxel_index_value_cards (realm_url, url) SELECT',
    r(),
    ', l.url FROM live AS l WHERE NOT EXISTS (SELECT 1 FROM boxel_index_value_cards AS c WHERE c.realm_url =',
    r(),
    'AND c.url = l.url) ORDER BY l.url ON CONFLICT DO NOTHING RETURNING id, url),',
    'np AS (INSERT INTO boxel_index_value_paths (path) SELECT DISTINCT s.path FROM src AS s WHERE NOT EXISTS (SELECT 1 FROM boxel_index_value_paths AS p WHERE p.path = s.path) ON CONFLICT DO NOTHING RETURNING id, path),',
    'ins AS (INSERT INTO boxel_index_values (realm_id, type_id, path_id, card_id, kind, txt, num, ts) SELECT',
    param(realm),
    ', t.id, p.id, c.id, s.kind, s.txt, s.num, s.ts FROM src AS s',
    'JOIN (SELECT id, type FROM boxel_index_value_types WHERE realm_url =',
    r(),
    'UNION ALL SELECT id, type FROM nt) AS t ON t.type = s.type',
    'JOIN (SELECT id, url FROM boxel_index_value_cards WHERE realm_url =',
    r(),
    'AND url IN',
    ...urlList(urls),
    'UNION ALL SELECT id, url FROM nc) AS c ON c.url = s.url',
    'JOIN (SELECT id, path FROM boxel_index_value_paths UNION ALL SELECT id, path FROM np) AS p ON p.path = s.path',
    'RETURNING 1),',
    // A type whose chain changed (its module now extends something else).
    `ut AS (UPDATE boxel_index_value_types AS t SET types = l.types FROM (SELECT DISTINCT ON (COALESCE(types ->> 0, '')) types FROM live ORDER BY COALESCE(types ->> 0, '')) AS l WHERE t.realm_url =`,
    r(),
    `AND t.type = COALESCE(l.types ->> 0, '') AND t.types IS DISTINCT FROM l.types RETURNING 1)`,
    'SELECT (SELECT count(*) FROM src) - (SELECT count(*) FROM ins) AS missing',
  ];
}

async function writeRows(
  host: ValueStoreHost,
  realmURL: string,
  realm: number,
  urls: string[],
  extraCondition?: string,
) {
  let [{ missing }] = await host.query(
    insertRows(realmURL, realm, urls, extraCondition),
  );
  if (Number(missing) > 0) {
    // A concurrent pass added a dictionary entry these rows need: this
    // statement's snapshot sees it now.
    await host.query(deleteRows(realmURL, urls));
    await host.query(insertRows(realmURL, realm, urls, extraCondition));
  }
}

// Replaces the value rows of every card among `urls` (a pass's promoted
// URLs): the old rows go, and a card that is live gets its rows from its
// promoted `search_keys`.
export async function syncValueStore(
  host: ValueStoreHost,
  realmURL: string,
  urls: string[],
): Promise<void> {
  if (!dialectFor(host.dbAdapter.kind).valueStore || urls.length === 0) {
    return;
  }
  let realm = await realmId(host, realmURL);
  for (let start = 0; start < urls.length; start += CHUNK) {
    let chunk = urls.slice(start, start + CHUNK);
    await host.query(deleteRows(realmURL, chunk));
    await writeRows(host, realmURL, realm, chunk);
  }
}

// After a pass that promoted only prerendered html: a card among `urls` that
// is no longer live loses its rows; one that is live and holds none (its
// render error cleared) gets them. A card whose liveness is unchanged is not
// rewritten.
export async function syncValueStoreLiveness(
  host: ValueStoreHost,
  realmURL: string,
  urls: string[],
): Promise<void> {
  if (!dialectFor(host.dbAdapter.kind).valueStore || urls.length === 0) {
    return;
  }
  let realm = await realmId(host, realmURL);
  for (let start = 0; start < urls.length; start += CHUNK) {
    let chunk = urls.slice(start, start + CHUNK);
    let cards = (await host.query([
      "SELECT c.url FROM boxel_index_value_cards AS c JOIN boxel_index_values AS v ON v.card_id = c.id AND v.path_id = (SELECT id FROM boxel_index_value_paths WHERE path = '') AND v.kind = 'c'",
      // The realm is a value the planner cannot see (an InitPlan) and every
      // lookup is keyed by the chunk's URLs: for a realm the statistics have
      // not seen yet, a visible realm looks like one row, and the planner
      // reads the realm's whole index and filters the URLs (time that grows
      // with the realm) instead of probing each URL's key.
      'WHERE c.realm_url = (SELECT',
      param(realmURL),
      '::text) AND c.url IN',
      ...urlList(chunk),
      // The live cards among the chunk, read by their own URLs: a correlated
      // NOT EXISTS became an anti join the planner could not drive by URL,
      // and under a realm the statistics have not seen yet it scanned the
      // whole index per card (about 500 ms a pass on a social app's realm).
      'AND c.url NOT IN (SELECT i.url FROM boxel_index AS i WHERE i.realm_url = (SELECT',
      param(realmURL),
      '::text) AND i.url IN',
      ...urlList(chunk),
      'AND',
      LIVE_CARD,
      ')',
    ])) as { url: string }[];
    if (cards.length > 0) {
      await host.query(
        deleteRows(
          realmURL,
          cards.map((c) => c.url),
        ),
      );
    }
    await writeRows(
      host,
      realmURL,
      realm,
      chunk,
      `NOT EXISTS (SELECT 1 FROM boxel_index_value_cards AS c JOIN boxel_index_values AS v ON v.card_id = c.id AND v.kind = 'c' WHERE c.realm_url = i.realm_url AND c.url = i.url)`,
    );
  }
}

// Every value row and dictionary entry of a realm, for its destruction.
export function valueStoreRealmDeletes(realmURL: string): Expression[] {
  return [
    [
      'DELETE FROM boxel_index_values WHERE card_id IN (SELECT id FROM boxel_index_value_cards WHERE realm_url =',
      param(realmURL),
      ')',
    ],
    ['DELETE FROM boxel_index_value_cards WHERE realm_url =', param(realmURL)],
    ['DELETE FROM boxel_index_value_types WHERE realm_url =', param(realmURL)],
    ['DELETE FROM boxel_index_value_realms WHERE realm_url =', param(realmURL)],
  ];
}
