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
// already chosen by the caller). `byUrl` keeps every index but the url-led
// keys out of reach (see `LIVE_CARD_BY_URL`).
const liveCard = (
  byUrl: boolean,
) => `${byUrl ? `(i.type || '') = 'instance'` : `i.type = 'instance'`}
  AND (i.is_deleted = FALSE OR i.is_deleted IS NULL)
  AND NOT COALESCE(i.has_error, FALSE)
  AND jsonb_typeof(i.types) = 'array'
  AND NOT EXISTS (
    SELECT 1 FROM prerendered_html AS phe
    WHERE phe.url = i.url AND ${byUrl ? `(phe.realm_url || '')` : 'phe.realm_url'} = i.realm_url
      AND ${byUrl ? `(phe.type || '')` : 'phe.type'} = i.type AND phe.error_doc IS NOT NULL
      AND phe.generation >= i.generation
      AND NOT ${ungatedRenderErrorSQL('phe')})`;
export const LIVE_CARD = liveCard(false);

// The writer's per-chunk statements reach each card's `boxel_index` row by
// its url and nothing else: the realm and type are tested in a form no index
// serves (`(column || '')`), so the url-led keys are the only way in. Given a
// usable realm or type test, the planner, on row counts taken before a realm's
// first pass (or before it grew), reached the rows by `(realm_url, type)` and
// read every row of the realm for each url, so a pass cost the square of its
// size (130 s for 36,000 cards). index-writer-no-statistics-test fails
// without these forms.
const LIVE_CARD_BY_URL = liveCard(true);

const CHUNK = 500;

// A chunk's statements start from the chunk's url list and look each card
// up on its own (`LATERAL`): its `boxel_index` row by url
// (`LIVE_CARD_BY_URL`), its dictionary entry by the dictionary's unique
// `(realm_url, url)`, the only index that table has on either. Joined as
// sets instead, the planner read the realm's whole dictionary for each chunk.
const liveRow = (columns: string, realmURL: string): Expression => [
  // `(i.realm_url || '')`: see `LIVE_CARD_BY_URL`.
  `LEFT JOIN LATERAL (SELECT ${columns} FROM boxel_index AS i WHERE i.url = u.url AND (i.realm_url || '') =`,
  param(realmURL),
  `AND ${LIVE_CARD_BY_URL}) AS i ON true`,
];

// The dictionaries' text columns are `COLLATE "C"` and `boxel_index`'s are
// not. A comparison between them resolves to "C", which the dictionaries'
// indexes serve; a lookup from a dictionary row into `boxel_index` names
// "default", or `boxel_index`'s primary key cannot serve it and the lookup
// scans the table once per card.

// What a card's value rows derive from: its promoted `search_keys` and its
// type chain (the card's type is `types ->> 0`; the chain is kept on the type
// dictionary). `boxel_index_value_cards.keys_fp` holds it while the card has
// its rows, and is NULL while it has none, so a pass skips every card whose
// fingerprint is unchanged: a warm reindex of unchanged cards writes no value
// rows. It is an optimization key only: no search reads it. A missing one
// (NULL) only costs a rewrite; the writer keeps it exact, since a stale one
// would skip a card whose rows changed.
const fingerprint = (alias: string) =>
  `md5(${alias}.search_keys::text || '|' || COALESCE(${alias}.types::text, ''))`;

// The cards among `urls` whose stored fingerprint is not their promoted row's
// (NULL for a card that is not live): every one whose rows must be written
// again, or removed.
async function changedCards(
  host: ValueStoreHost,
  realmURL: string,
  urls: string[],
): Promise<string[]> {
  let rows = (await host.query([
    'SELECT u.url FROM jsonb_array_elements_text(',
    param(JSON.stringify(urls)),
    '::jsonb) AS u(url)',
    ...liveRow(`${fingerprint('i')} AS fp`, realmURL),
    'LEFT JOIN LATERAL (SELECT c.keys_fp FROM boxel_index_value_cards AS c WHERE c.realm_url =',
    param(realmURL),
    `AND c.url = u.url COLLATE "C") AS c ON true WHERE c.keys_fp IS DISTINCT FROM i.fp`,
  ])) as { url: string }[];
  return rows.map((r) => r.url);
}

// Stamps the cards among `urls` with their promoted row's fingerprint, or
// NULL for one that is not live, after their rows were written or removed.
function stampFingerprints(realmURL: string, urls: string[]): Expression {
  return [
    // `(i.realm_url || '')`: see `LIVE_CARD_BY_URL`.
    `UPDATE boxel_index_value_cards AS c SET keys_fp = (SELECT ${fingerprint('i')} FROM boxel_index AS i WHERE i.url = c.url COLLATE "default" AND (i.realm_url || '') = c.realm_url COLLATE "default" AND`,
    LIVE_CARD_BY_URL,
    ') WHERE c.id IN (SELECT d.id FROM jsonb_array_elements_text(',
    param(JSON.stringify(urls)),
    '::jsonb) AS u(url) JOIN LATERAL (SELECT id FROM boxel_index_value_cards WHERE realm_url =',
    param(realmURL),
    'AND url = u.url COLLATE "C") AS d ON true)',
  ];
}

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
    'DELETE FROM boxel_index_values WHERE card_id IN (SELECT c.id FROM jsonb_array_elements_text(',
    param(JSON.stringify(urls)),
    '::jsonb) AS u(url) JOIN LATERAL (SELECT id FROM boxel_index_value_cards WHERE realm_url =',
    param(realmURL),
    'AND url = u.url COLLATE "C") AS c ON true)',
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
    'WITH u AS (SELECT url FROM jsonb_array_elements_text(',
    param(JSON.stringify(urls)),
    '::jsonb) AS u(url)),',
    // `(i.realm_url || '')`: see `LIVE_CARD_BY_URL`.
    "live AS MATERIALIZED (SELECT i.url, i.types, i.search_keys FROM u JOIN LATERAL (SELECT i.url, i.types, i.search_keys FROM boxel_index AS i WHERE i.url = u.url AND (i.realm_url || '') =",
    r(),
    `AND ${LIVE_CARD_BY_URL}`,
    ...(extraCondition ? [`AND ${extraCondition}`] : []),
    ') AS i ON true),',
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
    'JOIN (SELECT c.id, c.url FROM u JOIN LATERAL (SELECT id, url FROM boxel_index_value_cards WHERE realm_url =',
    r(),
    'AND url = u.url COLLATE "C") AS c ON true',
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
// URLs) whose fingerprint changed: the old rows go, and a card that is live
// gets its rows from its promoted `search_keys`. A card whose fingerprint is
// unchanged keeps its rows untouched.
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
    let chunk = await changedCards(
      host,
      realmURL,
      urls.slice(start, start + CHUNK),
    );
    if (chunk.length === 0) {
      continue;
    }
    await host.query(deleteRows(realmURL, chunk));
    await writeRows(host, realmURL, realm, chunk);
    await host.query(stampFingerprints(realmURL, chunk));
  }
}

// After a pass that rebuilt the whole realm: the realm's value rows whose
// card has no live row in the index go. A rebuild promotes the cards that
// exist, and a card that vanished while the index held nothing for it (an
// index emptied by a crash) gets no tombstone, so only this reaches its rows;
// it also repairs any other drift between the store and its source. One
// statement over the realm's cards, inside the swap.
export async function removeOrphanValueRows(
  host: ValueStoreHost,
  realmURL: string,
): Promise<void> {
  if (!dialectFor(host.dbAdapter.kind).valueStore) {
    return;
  }
  await host.query([
    'DELETE FROM boxel_index_values WHERE card_id IN (SELECT c.id FROM boxel_index_value_cards AS c WHERE c.realm_url =',
    param(realmURL),
    'AND NOT EXISTS (SELECT 1 FROM boxel_index AS i WHERE i.realm_url = c.realm_url COLLATE "default" AND i.url = c.url COLLATE "default" AND',
    LIVE_CARD,
    '))',
  ]);
  // They hold no rows now, so no fingerprint.
  await host.query([
    'UPDATE boxel_index_value_cards AS c SET keys_fp = NULL WHERE c.realm_url =',
    param(realmURL),
    'AND c.keys_fp IS NOT NULL AND NOT EXISTS (SELECT 1 FROM boxel_index AS i WHERE i.realm_url = c.realm_url COLLATE "default" AND i.url = c.url COLLATE "default" AND',
    LIVE_CARD,
    ')',
  ]);
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
      `NOT EXISTS (SELECT 1 FROM boxel_index_value_cards AS c JOIN boxel_index_values AS v ON v.card_id = c.id AND v.kind = 'c' WHERE c.realm_url = i.realm_url COLLATE "C" AND c.url = i.url COLLATE "C")`,
    );
    // The chunk's cards hold rows now exactly while they are live.
    await host.query(stampFingerprints(realmURL, chunk));
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
