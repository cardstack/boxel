import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename, dirname, join } from 'path';
import { createRequire } from 'module';
import { setupDB } from './helpers/index.ts';

const require = createRequire(import.meta.url);
const POSTGRES = dirname(require.resolve('@cardstack/postgres/package.json'));
const LOG_LINES = join(
  POSTGRES,
  'migrations',
  '1794379480500_add-boxel-log-lines.js',
);
const { migrationRenames } = require(
  join(POSTGRES, 'scripts', 'migration-name-fixes.cjs'),
);

const REALM_A = 'http://127.0.0.1:4444/a/';
const REALM_B = 'http://127.0.0.1:4444/b/';

// The tables the log-lines migration made under its first number
// (1794293714555), before the lines were partitioned by realm.
const FLAT_TABLES = `
  CREATE TABLE boxel_log_lines (
    realm_url TEXT NOT NULL,
    url TEXT NOT NULL,
    line_no INTEGER NOT NULL,
    at TIMESTAMPTZ,
    actor TEXT,
    entry JSONB NOT NULL,
    CONSTRAINT boxel_log_lines_pkey PRIMARY KEY (url, line_no)
  );
  CREATE INDEX boxel_log_lines_at_idx ON boxel_log_lines (url, at);
  CREATE INDEX boxel_log_lines_entry_idx
    ON boxel_log_lines USING gin (entry jsonb_path_ops);
  CREATE TABLE boxel_log_files (
    url TEXT NOT NULL PRIMARY KEY,
    realm_url TEXT NOT NULL,
    line_count INTEGER NOT NULL,
    last_line_hash TEXT
  );
`;

module(basename(import.meta.filename), function () {
  module('the log-lines migration over the flat tables', function (hooks) {
    let dbAdapter: any;

    setupDB(hooks, {
      beforeEach: async (_dbAdapter) => {
        dbAdapter = _dbAdapter;
        // Back to a database that ran the first, flat log-lines migration.
        await run('down');
        for (let statement of FLAT_TABLES.split(';')) {
          if (statement.trim()) {
            await dbAdapter.execute(statement);
          }
        }
        for (let [realm, lines] of [
          [REALM_A, 3],
          [REALM_B, 2],
        ] as const) {
          for (let n = 1; n <= lines; n++) {
            await dbAdapter.execute(
              `INSERT INTO boxel_log_lines (realm_url, url, line_no, at, actor, entry)
               VALUES ($1, $2, $3, '2026-11-10T12:00:00Z', '@a:localhost', $4)`,
              {
                bind: [
                  realm,
                  `${realm}activity.jsonl`,
                  n,
                  JSON.stringify({ n }),
                ],
              },
            );
          }
          await dbAdapter.execute(
            `INSERT INTO boxel_log_files (url, realm_url, line_count, last_line_hash)
             VALUES ($1, $2, $3, 'h')`,
            { bind: [`${realm}activity.jsonl`, realm, lines] },
          );
        }
      },
    });

    // Runs the migration as node-pg-migrate does: its statements in order,
    // in one transaction.
    async function run(direction: 'up' | 'down') {
      let statements: string[] = [];
      require(LOG_LINES)[direction]({
        sql: (statement: string) => statements.push(statement),
      });
      await dbAdapter.withTransaction(async (txQuery: any) => {
        for (let statement of statements) {
          await txQuery([statement]);
        }
      });
    }

    async function state() {
      let [partitioned] = await dbAdapter.execute(
        `SELECT count(*)::int AS n FROM pg_partitioned_table
          WHERE partrelid = to_regclass('boxel_log_lines')`,
      );
      let realms = await dbAdapter.execute(
        `SELECT realm_url, partition_name FROM boxel_log_realms ORDER BY realm_url`,
      );
      let perPartition = await dbAdapter.execute(
        `SELECT tableoid::regclass::text AS part, realm_url, count(*)::int AS n
           FROM boxel_log_lines GROUP BY 1, 2 ORDER BY 2`,
      );
      let files = await dbAdapter.execute(
        `SELECT url, line_count, prefix_length, last_line_length
           FROM boxel_log_files ORDER BY url`,
      );
      let [flat] = await dbAdapter.execute(
        `SELECT to_regclass('boxel_log_lines_flat') IS NULL AS gone`,
      );
      return {
        partitioned: partitioned.n === 1,
        realms,
        perPartition,
        files,
        flatGone: flat.gone,
      };
    }

    test('a database that ran the flat migration is not marked as having run the new one', function (assert) {
      let renamedFrom = migrationRenames.map(([from]: [string]) => from);
      assert.notOk(
        renamedFrom.includes('1794293714555_add-boxel-log-lines'),
        'the flat migration is not renamed to the partitioned one',
      );
      assert.ok(
        renamedFrom.includes('1794341377555_add-boxel-log-lines'),
        'the earlier name of the partitioned migration still is',
      );
    });

    test('running up moves each realm’s lines into its own partition', async function (assert) {
      await run('up');
      let after = await state();
      assert.true(after.partitioned, 'boxel_log_lines is partitioned');
      assert.true(after.flatGone, 'the flat table is dropped');
      assert.deepEqual(
        after.realms.map((r: any) => r.realm_url),
        [REALM_A, REALM_B],
        'each realm with lines has a partition',
      );
      assert.deepEqual(
        after.perPartition.map((r: any) => [r.part, r.realm_url, r.n]),
        after.realms.map((r: any, i: number) => [
          r.partition_name,
          r.realm_url,
          i === 0 ? 3 : 2,
        ]),
        'every line is kept, in its realm’s partition',
      );
      assert.deepEqual(
        after.files.map((f: any) => [
          f.url,
          f.line_count,
          f.prefix_length,
          f.last_line_length,
        ]),
        [
          [`${REALM_A}activity.jsonl`, 3, null, null],
          [`${REALM_B}activity.jsonl`, 2, null, null],
        ],
        'the file rows are kept and gain the new columns',
      );
    });

    test('running up again changes nothing', async function (assert) {
      await run('up');
      let once = await state();
      await run('up');
      assert.deepEqual(await state(), once);
    });
  });
});
