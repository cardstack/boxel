import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename, dirname, join } from 'path';
import { createRequire } from 'module';
import { randomUUID } from 'crypto';
import { setupDB } from './helpers/index.ts';

const require = createRequire(import.meta.url);
const POSTGRES = dirname(require.resolve('@cardstack/postgres/package.json'));
const ALLOW = join(
  POSTGRES,
  'migrations',
  '1794325432239_allow-automation-key-use-mode.js',
);
const REQUIRE = join(
  POSTGRES,
  'migrations-removal',
  '1794325432513_require-automation-key-use-mode.js',
);

const REALM = 'http://127.0.0.1:4444/test/';
const CALLER = '@payer:localhost';

module(basename(import.meta.filename), function () {
  module('the automation mode of a key use', function (hooks) {
    let dbAdapter: any;
    let keyId: string;

    setupDB(hooks, {
      beforeEach: async (_dbAdapter) => {
        dbAdapter = _dbAdapter;
        keyId = randomUUID();
        // The ciphertext is never opened here: a use row only needs a key to
        // count against.
        await dbAdapter.execute(
          `INSERT INTO user_keys (id, owner, name, kind, state, value_ciphertext, value_nonce, value_tag, value_key_id)
           VALUES ($1, $2, 'vendor', 'api-key', 'active', '\\x00', '\\x00', '\\x00', 'test')`,
          { bind: [keyId, CALLER] },
        );
      },
    });

    async function run(file: string, direction: 'up' | 'down') {
      let statements: string[] = [];
      require(file)[direction]({
        sql: (statement: string) => statements.push(statement),
      });
      for (let statement of statements) {
        await dbAdapter.execute(statement);
      }
    }

    async function insertUse(
      mode: string,
      use: { refusal?: boolean; count?: number } = {},
    ): Promise<string> {
      let [row] = await dbAdapter.execute(
        use.refusal
          ? `INSERT INTO key_uses (key_id, realm_url, operation, caller, mode, outcome, code, count, refusal_window, created_at)
             VALUES ($1, $2, 'forecast', $3, $4, 'refused', 'rate-limited', $5, '2026-11-10T12:00:00Z', '2026-11-10T12:00:30Z') RETURNING id`
          : `INSERT INTO key_uses (key_id, realm_url, operation, caller, mode, outcome, status)
             VALUES ($1, $2, 'forecast', $3, $4, 'sent', 200) RETURNING id`,
        {
          bind: [
            keyId,
            REALM,
            CALLER,
            mode,
            ...(use.refusal ? [use.count ?? 1] : []),
          ],
        },
      );
      return String(row.id);
    }

    async function uses() {
      let rows = (await dbAdapter.execute(
        `SELECT mode, outcome, count FROM key_uses WHERE key_id = $1 ORDER BY outcome, mode`,
        { bind: [keyId] },
      )) as { mode: string; outcome: string; count: number }[];
      return rows.map((row) => [row.mode, row.outcome, Number(row.count)]);
    }

    // Whether the mode CHECK takes a use recorded under `mode`. The probe row
    // is removed again, leaving the rows a test set up as they were.
    async function accepts(mode: string) {
      let id: string;
      try {
        id = await insertUse(mode);
      } catch (error: any) {
        if (/key_uses_mode_check/.test(String(error?.message ?? error))) {
          return false;
        }
        throw error;
      }
      await dbAdapter.execute(`DELETE FROM key_uses WHERE id = $1`, {
        bind: [id],
      });
      return true;
    }

    test('a migrated database records automation uses and refuses pipeline ones', async function (assert) {
      assert.true(await accepts('automation'));
      assert.true(await accepts('interactive'));
      assert.false(await accepts('pipeline'));
    });

    test('rewrites pipeline uses as automation ones, allowing both until the removal phase', async function (assert) {
      await run(REQUIRE, 'down');
      await run(ALLOW, 'down');
      assert.false(await accepts('automation'), 'before: no automation mode');
      await insertUse('pipeline');
      await insertUse('pipeline', { refusal: true, count: 3 });

      await run(ALLOW, 'up');
      assert.deepEqual(await uses(), [
        ['automation', 'refused', 3],
        ['automation', 'sent', 1],
      ]);
      assert.true(
        await accepts('pipeline'),
        'a task that predates the name can still record its uses',
      );

      // A departing task's refusal in the same minute, under the old mode.
      await insertUse('pipeline', { refusal: true, count: 2 });
      await run(REQUIRE, 'up');
      assert.deepEqual(
        await uses(),
        [
          ['automation', 'refused', 5],
          ['automation', 'sent', 1],
        ],
        'the refusal is folded into its twin under the new mode',
      );
      assert.false(await accepts('pipeline'));
      assert.true(await accepts('automation'));
    });

    test('down restores the pipeline mode and its rows', async function (assert) {
      await insertUse('automation');
      await insertUse('automation', { refusal: true, count: 4 });

      await run(REQUIRE, 'down');
      assert.true(await accepts('pipeline'));
      await run(ALLOW, 'down');

      assert.deepEqual(await uses(), [
        ['pipeline', 'refused', 4],
        ['pipeline', 'sent', 1],
      ]);
      assert.false(await accepts('automation'));
      assert.true(await accepts('pipeline'));

      await run(ALLOW, 'up');
      await run(REQUIRE, 'up');
      assert.deepEqual(await uses(), [
        ['automation', 'refused', 4],
        ['automation', 'sent', 1],
      ]);
    });
  });
});
