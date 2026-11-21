import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename, dirname, join } from 'path';
import { createRequire } from 'module';
import { setupDB } from './helpers/index.ts';

const require = createRequire(import.meta.url);
const POSTGRES = dirname(require.resolve('@cardstack/postgres/package.json'));
const VALUE_STORE = join(
  POSTGRES,
  'migrations',
  '1795300001006_search-value-store.js',
);

const REALM_A = 'http://127.0.0.1:4444/a/';
const REALM_B = 'http://127.0.0.1:4444/b/';

module(basename(import.meta.filename), function () {
  module('the value-store migration over indexed cards', function (hooks) {
    let dbAdapter: any;

    setupDB(hooks, {
      beforeEach: async (_dbAdapter) => {
        dbAdapter = _dbAdapter;
        // Cards indexed before the store is filled: `search_keys` is generated
        // from the search doc.
        for (let [realm, cards] of [
          [REALM_A, 3],
          [REALM_B, 2],
        ] as const) {
          for (let n = 1; n <= cards; n++) {
            await dbAdapter.execute(
              `INSERT INTO boxel_index (url, file_alias, type, generation, realm_url, types, search_doc, is_deleted)
               VALUES ($1, $2, 'instance', 1, $3, $4, $5, false)`,
              {
                bind: [
                  `${realm}card-${n}.json`,
                  `${realm}card-${n}`,
                  realm,
                  JSON.stringify([`${realm}pet/Pet`]),
                  JSON.stringify({
                    cardTitle: `Pet ${n}`,
                    age: n,
                    vaccinated: n % 2 === 0,
                    born: `2026-01-0${n}`,
                    tags: ['a', 'b', 'a'],
                  }),
                ],
              },
            );
          }
        }
      },
    });

    // Runs the migration as node-pg-migrate does: its statements in order,
    // in one transaction.
    async function run(direction: 'up' | 'down') {
      let statements: string[] = [];
      await require(VALUE_STORE)[direction]({
        sql: (statement: string) => statements.push(statement),
        noTransaction: () => {},
      });
      await dbAdapter.withTransaction(async (txQuery: any) => {
        for (let statement of statements) {
          await txQuery([statement]);
        }
      });
    }

    async function counts() {
      let [row] = await dbAdapter.execute(
        `SELECT
           (SELECT count(*)::int FROM boxel_index_values) AS "values",
           (SELECT count(*)::int FROM boxel_index_values WHERE kind = 'c') AS "cardRows",
           (SELECT count(*)::int FROM boxel_index_value_cards) AS cards,
           (SELECT count(*)::int FROM boxel_index_value_paths) AS paths,
           (SELECT count(*)::int FROM boxel_index_value_types) AS types,
           (SELECT count(*)::int FROM boxel_index_value_realms) AS realms`,
      );
      return row;
    }

    test('running up fills the store once, and running it again leaves the counts unchanged', async function (assert) {
      await dbAdapter.execute(`TRUNCATE boxel_index_values`);
      await run('up');
      let after = await counts();
      assert.strictEqual(after.cardRows, 5, 'each live card has one card row');
      assert.strictEqual(after.cards, 5, 'each live card is in the dictionary');
      assert.strictEqual(after.realms, 2, 'each realm is in the dictionary');
      assert.strictEqual(
        after.values,
        5 * 7,
        'each card has its card row, one row per distinct scalar, and none twice',
      );
      await run('up');
      assert.deepEqual(
        await counts(),
        after,
        'running up again changes no count',
      );
    });

    test('running up over a store that lacks some cards fills only those', async function (assert) {
      await dbAdapter.execute(`TRUNCATE boxel_index_values`);
      await run('up');
      let full = await counts();
      await dbAdapter.execute(
        `DELETE FROM boxel_index_values
          WHERE card_id = (SELECT id FROM boxel_index_value_cards WHERE url = $1)`,
        { bind: [`${REALM_B}card-1.json`] },
      );
      await run('up');
      assert.deepEqual(
        await counts(),
        full,
        'the missing card is filled and the others are not filled again',
      );
    });
  });
});
