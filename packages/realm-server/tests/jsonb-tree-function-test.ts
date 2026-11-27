import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { PgAdapter } from '@cardstack/postgres';
import { setupDB } from './helpers/index.ts';

// `jsonb_tree` walks a search doc for the filters that cannot be answered
// by containment (a `not` over a list, a range or a substring in one).
module(basename(import.meta.filename), function (hooks) {
  let dbAdapter: PgAdapter;
  setupDB(hooks, {
    beforeEach: async (adapter) => {
      dbAdapter = adapter;
    },
  });

  async function textValues(doc: unknown, root: string) {
    let rows = (await dbAdapter.execute(
      `SELECT text_value FROM jsonb_tree($1::jsonb, $2) WHERE level > 1 ORDER BY fullkey`,
      { bind: [JSON.stringify(doc), root] },
    )) as { text_value: string | null }[];
    return rows.map((row) => row.text_value);
  }

  test('a string reads as the string itself, without JSON escapes', async function (assert) {
    let tags = ['say "hi"', 'back\\slash', 'two\nlines', 'plain'];
    assert.deepEqual(await textValues({ tags }, '$.tags'), tags);
    assert.deepEqual(
      await textValues({ meta: { quote: 'say "hi"' } }, '$.meta'),
      ['say "hi"'],
    );
  });

  test('every other kind of value reads as before', async function (assert) {
    assert.deepEqual(
      await textValues({ list: [1, 2.5, true, null] }, '$.list'),
      ['1', '2.5', 'true', 'null'],
    );
  });

  test('it is stable and parallel safe, so a filter that walks the tree can be planned in parallel', async function (assert) {
    let [row] = (await dbAdapter.execute(
      `SELECT provolatile, proparallel FROM pg_proc WHERE proname = 'jsonb_tree'`,
    )) as { provolatile: string; proparallel: string }[];
    assert.strictEqual(row?.provolatile, 's', 'STABLE');
    assert.strictEqual(row?.proparallel, 's', 'PARALLEL SAFE');
  });
});
