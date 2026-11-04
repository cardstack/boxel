import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename, dirname, join } from 'path';
import { createRequire } from 'module';
import { setupDB } from './helpers/index.ts';

const require = createRequire(import.meta.url);
const MIGRATION = join(
  dirname(require.resolve('@cardstack/postgres/package.json')),
  'migrations',
  '1793760268389_readonly-role-reads-key-shares-and-bindings.js',
);

const READABLE = ['key_shares', 'key_bindings'];
const STILL_WITHHELD = [
  'user_keys',
  'key_share_notices',
  'key_binding_approvals',
  'key_binding_notices',
];

// Roles and memberships are shared by every database on the server, so each
// test removes the memberships it makes, whatever happens.
const MEMBER = 'readonly_member_for_key_tables_test';

module(basename(import.meta.filename), function () {
  module('the read-only role and the key tables', function (hooks) {
    let dbAdapter: any;

    setupDB(hooks, {
      beforeEach: async (_dbAdapter) => {
        dbAdapter = _dbAdapter;
        // The role as staging and production have it: SELECT on every table
        // in the schema, except the key tables, whose migrations revoke it.
        await createRole('readonly_role');
        await dbAdapter.execute(
          `GRANT SELECT ON ALL TABLES IN SCHEMA public TO readonly_role`,
        );
        await dbAdapter.execute(
          `REVOKE SELECT ON TABLE ${[...READABLE, ...STILL_WITHHELD].join(
            ', ',
          )} FROM readonly_role`,
        );
      },
    });

    async function createRole(name: string) {
      await dbAdapter.execute(
        `DO $$
         BEGIN
           CREATE ROLE ${name};
         EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL;
         END
         $$`,
      );
    }

    async function run(direction: 'up' | 'down') {
      let statements: string[] = [];
      require(MIGRATION)[direction]({
        sql: (statement: string) => statements.push(statement),
      });
      for (let statement of statements) {
        await dbAdapter.execute(statement);
      }
    }

    async function canSelect(role: string, table: string): Promise<boolean> {
      let [{ readable }] = await dbAdapter.execute(
        `SELECT has_table_privilege('${role}', '${table}', 'SELECT') AS readable`,
      );
      return readable as boolean;
    }

    test('the read-only role and its members can read key_shares and key_bindings', async function (assert) {
      await createRole(MEMBER);
      await dbAdapter.execute(`GRANT readonly_role TO ${MEMBER}`);
      try {
        await run('up');

        for (let role of ['readonly_role', MEMBER]) {
          for (let table of READABLE) {
            assert.true(await canSelect(role, table), `${role} reads ${table}`);
          }
        }
      } finally {
        await dbAdapter.execute(`REVOKE readonly_role FROM ${MEMBER}`);
      }
    });

    async function readableTables(role: string): Promise<string[]> {
      let rows = await dbAdapter.execute(
        `SELECT tbl.relname AS name
         FROM pg_class tbl
         JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
         WHERE ns.nspname = 'public'
           AND tbl.relkind IN ('r', 'p')
           AND has_table_privilege('${role}', tbl.oid, 'SELECT')
         ORDER BY tbl.relname`,
      );
      return rows.map((row: { name: string }) => row.name);
    }

    test('makes only key_shares and key_bindings readable, and leaves the other key tables withheld', async function (assert) {
      let before = await readableTables('readonly_role');

      await run('up');

      let after = await readableTables('readonly_role');
      assert.deepEqual(
        after.filter((table) => !before.includes(table)),
        [...READABLE].sort(),
        'the only tables the role gains are key_shares and key_bindings',
      );
      assert.deepEqual(
        before.filter((table) => !after.includes(table)),
        [],
        'the role loses nothing',
      );
      for (let table of STILL_WITHHELD) {
        assert.false(
          await canSelect('readonly_role', table),
          `readonly_role can't read ${table}`,
        );
      }
    });

    test('running up again changes nothing, and down withholds both tables again', async function (assert) {
      await run('up');
      await run('up');
      for (let table of READABLE) {
        assert.true(await canSelect('readonly_role', table));
      }

      await run('down');
      for (let table of READABLE) {
        assert.false(
          await canSelect('readonly_role', table),
          `readonly_role can't read ${table}`,
        );
      }
    });
  });
});
