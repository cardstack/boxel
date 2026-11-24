import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { PgAdapter } from '@cardstack/postgres';

import { setupDB } from './helpers/index.ts';
import { ensureLogPartition } from '@cardstack/runtime-common/log-line-partitions';
import { removeRealmDatabaseArtifacts } from '../handlers/realm-destruction-utils.ts';

const GONE = 'http://removed-realm.test/';
const KEPT = 'http://kept-realm.test/';

// Removing a realm removes its rows in every table the index writer derives
// from boxel_index (vectors and sidecars, passages, the value store, the typo
// word list, a log's line rows and its file state), and no other realm's.
module(basename(import.meta.filename), function (hooks) {
  let adapter: PgAdapter;
  setupDB(hooks, {
    beforeEach: async (dbAdapter) => {
      adapter = dbAdapter;
    },
  });

  // One row in each table that holds a realm's derived rows. The vector
  // tables exist where pgvector is installed (row 21g's test image).
  async function seed(realm: string) {
    let one = async (sql: string, bind: unknown[] = [realm]) =>
      (await adapter.execute(sql, { bind } as never)) as { id: number }[];
    await one(
      `INSERT INTO boxel_index_vectors (realm_url, url, type, field_path, dims, embedding)
         VALUES ($1, $2, 'instance', 'embedding', 3, '[1,0,0]'::vector)`,
      [realm, `${realm}card.json`],
    );
    await one(
      `INSERT INTO boxel_index_vector_sidecars (realm_url, url, type, sidecar_hash)
         VALUES ($1, $2, 'instance', 'h')`,
      [realm, `${realm}card.json`],
    );
    await one(
      `INSERT INTO boxel_index_passages (realm_url, url, type, field_path, ordinal, body, tsv)
         VALUES ($1, $2, 'instance', 'segments', 0, 'a passage', to_tsvector('simple', 'a passage'))`,
      [realm, `${realm}card.json`],
    );
    await one(
      `INSERT INTO boxel_index_words (realm_url, word) VALUES ($1, 'lamp')`,
    );
    let [{ id: realmId }] = await one(
      `INSERT INTO boxel_index_value_realms (realm_url) VALUES ($1) RETURNING id`,
    );
    let [{ id: typeId }] = await one(
      `INSERT INTO boxel_index_value_types (realm_url, type, types) VALUES ($1, 'Note', '[]'::jsonb) RETURNING id`,
    );
    let [{ id: cardId }] = await one(
      `INSERT INTO boxel_index_value_cards (realm_url, url) VALUES ($1, $2) RETURNING id`,
      [realm, `${realm}card.json`],
    );
    let [{ id: pathId }] = await one(
      `INSERT INTO boxel_index_value_paths (path) VALUES ('title')
         ON CONFLICT (path) DO UPDATE SET path = EXCLUDED.path RETURNING id`,
      [],
    );
    await one(
      `INSERT INTO boxel_index_values (realm_id, type_id, path_id, card_id, kind, txt)
         VALUES ($1, $2, $3, $4, 's', 'a title')`,
      [realmId, typeId, pathId, cardId],
    );
    // A log's line in the realm's own partition of boxel_log_lines, which the
    // removal drops whole, and the log's file state.
    await ensureLogPartition(adapter, realm);
    await one(
      `INSERT INTO boxel_log_lines (realm_url, url, line_no, at, actor, entry)
         VALUES ($1, $2, 1, now(), '@ada:localhost', '{"what":"arrived"}'::jsonb)`,
      [realm, `${realm}events.jsonl`],
    );
    await one(
      `INSERT INTO boxel_log_files (url, realm_url, line_count) VALUES ($1, $2, 1)`,
      [`${realm}events.jsonl`, realm],
    );
  }

  // Every table above but boxel_index_values is keyed by realm_url;
  // boxel_index_values is counted through its realm. (boxel_vector_spaces and
  // boxel_index_value_paths hold no realm's rows.)
  const REALM_TABLES = [
    'boxel_index_vectors',
    'boxel_index_vector_sidecars',
    'boxel_index_passages',
    'boxel_index_words',
    'boxel_index_value_realms',
    'boxel_index_value_types',
    'boxel_index_value_cards',
    'boxel_log_lines',
    'boxel_log_files',
  ];

  async function counts(realm: string) {
    let out: Record<string, number> = {};
    for (let table of REALM_TABLES) {
      let [{ n }] = (await adapter.execute(
        `SELECT count(*)::int AS n FROM ${table} WHERE realm_url = $1`,
        { bind: [realm] },
      )) as { n: number }[];
      out[table] = n;
    }
    let [{ n }] = (await adapter.execute(
      `SELECT count(*)::int AS n FROM boxel_index_values v
         JOIN boxel_index_value_cards c ON c.id = v.card_id
        WHERE c.realm_url = $1`,
      { bind: [realm] },
    )) as { n: number }[];
    out.boxel_index_values = n;
    return out;
  }

  const every = (n: number) =>
    Object.fromEntries(
      [...REALM_TABLES, 'boxel_index_values'].map((table) => [table, n]),
    );

  test("a removed realm's derived rows go, and no other realm's", async function (assert) {
    await seed(GONE);
    await seed(KEPT);
    assert.deepEqual(await counts(GONE), every(1), 'seeded');
    await removeRealmDatabaseArtifacts({ dbAdapter: adapter, realmURL: GONE });
    assert.deepEqual(
      await counts(GONE),
      every(0),
      'the removed realm has none left',
    );
    assert.deepEqual(
      await counts(KEPT),
      every(1),
      'the other realm keeps its own',
    );
  });
});
