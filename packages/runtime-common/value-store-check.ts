// The value store's invariant, checked against the index it derives from
// (value-store.ts). Pages, totals and range candidates read the store
// (query-engine/value-store-order.ts, value-store-filter.ts), so a writer
// that changes boxel_index without the store silently drops or adds results;
// this check makes that loud. Read-only. Postgres only.
//
// Per realm:
// - the live cards of the index (`LIVE_CARD`) are exactly the cards with a
//   card row (kind 'c') in the store;
// - for a sample of those cards, the store's rows are exactly what
//   `boxel_value_rows` extracts from the card's `search_keys`, under its own
//   type (`types ->> 0`);
// - for the same sample, `search_keys` is `search_keys_of(search_doc)`: it is
//   an ordinary column filled when a row is staged, so a writer that changed
//   one without the other would make searches silently wrong.
// Used by the test harness after every test that wrote the index, and by
// operators (realm-server/scripts/check-value-store.ts), after the bridge
// migration and whenever results look short.

import { param, type Expression } from './expression.ts';
import { dialectFor } from './query-engine/dialect.ts';
import { LIVE_CARD, type ValueStoreHost } from './value-store.ts';

export interface ValueStoreProblem {
  realm: string;
  // 'missing': a live card with no card row; 'extra': a card row for a card
  // that is not live; 'rows': a sampled card whose rows differ from its
  // search keys' extraction; 'keys': a sampled card whose search_keys is not
  // its search doc's.
  kind: 'missing' | 'extra' | 'rows' | 'keys';
  count: number;
  // Up to five of the cards concerned.
  examples: string[];
}

const EXAMPLES = 5;

// The realms the index or the store holds.
export async function valueStoreRealms(
  host: ValueStoreHost,
): Promise<string[]> {
  let rows = await host.query([
    "SELECT DISTINCT realm_url FROM boxel_index WHERE type = 'instance' UNION SELECT realm_url FROM boxel_index_value_realms ORDER BY 1",
  ]);
  return rows.map((r) => String(r.realm_url));
}

// The invariant's breaches in `realmURL`, none when the store is in step. A
// sample of `sample` live cards (the first by url) has its rows compared.
export async function checkValueStore(
  host: ValueStoreHost,
  realmURL: string,
  opts: { sample?: number } = {},
): Promise<ValueStoreProblem[]> {
  if (!dialectFor(host.dbAdapter.kind).valueStore) {
    return [];
  }
  let r = () => param(realmURL);
  let problems: ValueStoreProblem[] = [];
  let carded: Expression = [
    "SELECT c.url FROM boxel_index_value_cards AS c JOIN boxel_index_values AS v ON v.card_id = c.id AND v.kind = 'c' AND v.path_id = (SELECT id FROM boxel_index_value_paths WHERE path = '') WHERE c.realm_url =",
    r(),
  ];
  let live: Expression = [
    'SELECT i.url FROM boxel_index AS i WHERE i.realm_url =',
    r(),
    `AND ${LIVE_CARD}`,
  ];
  for (let [kind, from, without] of [
    ['missing', live, carded],
    ['extra', carded, live],
  ] as const) {
    let rows = await host.query([
      'WITH d AS (',
      ...from,
      'EXCEPT',
      ...without,
      `) SELECT (SELECT count(*) FROM d) AS n, ARRAY(SELECT url FROM d ORDER BY url LIMIT ${EXAMPLES}) AS examples`,
    ]);
    let n = Number(rows[0]?.n ?? 0);
    if (n > 0) {
      problems.push({
        realm: realmURL,
        kind,
        count: n,
        examples: (rows[0].examples as string[]) ?? [],
      });
    }
  }
  let sample = Math.max(0, Math.floor(opts.sample ?? 50));
  if (sample > 0) {
    let rows = await host.query([
      'WITH s AS MATERIALIZED (SELECT i.url, i.types, i.search_keys FROM boxel_index AS i WHERE i.realm_url =',
      r(),
      `AND ${LIVE_CARD} ORDER BY i.url LIMIT ${sample}),`,
      `want AS (SELECT s.url, COALESCE(s.types ->> 0, '') AS type, x.path, x.kind, x.txt, x.num, x.ts FROM s CROSS JOIN LATERAL boxel_value_rows(s.search_keys) AS x),`,
      'have AS (SELECT c.url, t.type, p.path, v.kind, v.txt, v.num, v.ts FROM boxel_index_values AS v',
      'JOIN boxel_index_value_cards AS c ON c.id = v.card_id',
      'JOIN boxel_index_value_types AS t ON t.id = v.type_id',
      'JOIN boxel_index_value_paths AS p ON p.id = v.path_id',
      'WHERE c.realm_url =',
      r(),
      'AND c.url IN (SELECT url FROM s)),',
      'd AS ((SELECT * FROM want EXCEPT ALL SELECT * FROM have) UNION ALL (SELECT * FROM have EXCEPT ALL SELECT * FROM want))',
      `SELECT (SELECT count(DISTINCT url) FROM d) AS n, ARRAY(SELECT DISTINCT url FROM d ORDER BY url LIMIT ${EXAMPLES}) AS examples`,
    ]);
    let n = Number(rows[0]?.n ?? 0);
    if (n > 0) {
      problems.push({
        realm: realmURL,
        kind: 'rows',
        count: n,
        examples: (rows[0].examples as string[]) ?? [],
      });
    }
    let keys = await host.query([
      'WITH s AS MATERIALIZED (SELECT i.url FROM boxel_index AS i WHERE i.realm_url =',
      r(),
      `AND ${LIVE_CARD} AND i.search_keys IS DISTINCT FROM search_keys_of(i.search_doc) ORDER BY i.url LIMIT ${sample})`,
      `SELECT (SELECT count(*) FROM s) AS n, ARRAY(SELECT url FROM s ORDER BY url LIMIT ${EXAMPLES}) AS examples`,
    ]);
    let k = Number(keys[0]?.n ?? 0);
    if (k > 0) {
      problems.push({
        realm: realmURL,
        kind: 'keys',
        count: k,
        examples: (keys[0].examples as string[]) ?? [],
      });
    }
  }
  return problems;
}
