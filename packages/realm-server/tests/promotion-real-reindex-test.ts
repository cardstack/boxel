import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import { rri } from '@cardstack/runtime-common';
import type { DBAdapter, Realm } from '@cardstack/runtime-common';
import { setupPermissionedRealmCached } from './helpers/index.ts';

// A reindex of unchanged cards, through the real indexer: the
// render, staging and promotion as a realm runs them. Each card's row is
// promoted by its bookkeeping alone, and no content column is rewritten. The
// unit tests of the promotion build their staged rows by hand, so a
// difference between a hand-built row and one the indexer stages (as the
// render's `_searchText` was) passes them and still rewrites every row; this
// test is the one that sees what the indexer actually stages. An audit
// trigger on `UPDATE OF search_doc` counts the content writes.

const testRealm = new URL('http://127.0.0.1:4445/test/');
const PERSON = `
        import { contains, field, CardDef } from "@cardstack/base/card-api";
        import StringField from "@cardstack/base/string";

        export class Person extends CardDef {
          @field firstName = contains(StringField, { search: { role: 'title' } });
          @field notes = contains(StringField, { search: { role: 'body' } });
        }
`;

module(basename(import.meta.filename), function (hooks) {
  let realm: Realm;
  let db: DBAdapter;

  setupPermissionedRealmCached(hooks, {
    mode: 'beforeEach',
    realmURL: testRealm,
    permissions: { '*': ['read'] },
    fileSystem: {
      'person.gts': PERSON,
      'mango.json': {
        data: {
          attributes: { firstName: 'Mango', notes: 'a pelican' },
          meta: { adoptsFrom: { module: rri('./person'), name: 'Person' } },
        },
      },
      'van-gogh.json': {
        data: {
          attributes: { firstName: 'Van Gogh', notes: 'a walrus' },
          meta: { adoptsFrom: { module: rri('./person'), name: 'Person' } },
        },
      },
    },
    onRealmSetup({ dbAdapter, testRealm: r }) {
      db = dbAdapter;
      realm = r;
    },
  });

  async function instances() {
    return (await db.execute(
      `SELECT url, generation, search_text_fp
       FROM boxel_index
       WHERE realm_url = $1 AND type = 'instance' AND is_deleted IS NOT TRUE
       ORDER BY url`,
      { bind: [testRealm.href] },
    )) as { url: string; generation: number; search_text_fp: string | null }[];
  }

  test('a reindex of unchanged cards rewrites no content', async function (assert) {
    // The realm's setup restores its files after their first index, with new
    // modification times; one reindex takes those in.
    await realm.realmIndexUpdater.fullIndex();
    let before = await instances();
    assert.deepEqual(
      before.map((r) => r.url),
      [`${testRealm}mango.json`, `${testRealm}van-gogh.json`],
      'both cards are indexed',
    );
    assert.true(
      before.every((r) => r.search_text_fp !== null),
      'the indexer staged each card with its search text',
    );
    await db.execute(`
      CREATE TABLE content_writes (url TEXT);
      CREATE FUNCTION record_content_write() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN INSERT INTO content_writes VALUES (NEW.url); RETURN NEW; END $$;
      CREATE TRIGGER record_content_write AFTER UPDATE OF search_doc ON boxel_index
        FOR EACH ROW EXECUTE FUNCTION record_content_write();
    `);
    let snapshot = async () =>
      (await db.execute(
        `SELECT url, to_jsonb(b) - 'generation' - 'indexed_at' - 'diagnostics' AS row FROM boxel_index b WHERE realm_url = $1 AND type = 'instance' ORDER BY url`,
        { bind: [testRealm.href] },
      )) as { url: string; row: Record<string, unknown> }[];
    let rowsBefore = await snapshot();
    try {
      // An incremental pass over both cards re-renders them, as a dependency
      // change fans out to its dependents.
      await realm.realmIndexUpdater.update([
        new URL(`${testRealm}mango.json`),
        new URL(`${testRealm}van-gogh.json`),
      ]);
      let rowsAfter = await snapshot();
      let moved = rowsAfter.flatMap((r, i) =>
        Object.keys(r.row)
          .filter(
            (k) =>
              JSON.stringify(r.row[k]) !==
              JSON.stringify(rowsBefore[i]?.row[k]),
          )
          .map(
            (k) =>
              `${r.url} ${k}: ${JSON.stringify(rowsBefore[i]?.row[k]).slice(0, 300)} -> ${JSON.stringify(r.row[k]).slice(0, 300)}`,
          ),
      );
      assert.deepEqual(moved, [], 'no content column moved');
      let after = await instances();
      let written = (await db.execute(
        `SELECT url FROM content_writes WHERE url LIKE $1 ORDER BY url`,
        { bind: [`${testRealm}%.json`] },
      )) as { url: string }[];
      assert.deepEqual(
        written.map((r) => r.url),
        [],
        'no instance row was rewritten',
      );
      assert.true(
        after.every((r, i) => r.generation > before[i].generation),
        'each card carries the new generation',
      );
    } finally {
      await db.execute(`
        DROP TRIGGER record_content_write ON boxel_index;
        DROP FUNCTION record_content_write();
        DROP TABLE content_writes;
      `);
    }
  });
});
