import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename, dirname, join } from 'path';
import { createRequire } from 'module';
import type { PgAdapter } from '@cardstack/postgres';
import { setupDB } from './helpers/index.ts';

const require = createRequire(import.meta.url);
const MIGRATION = join(
  dirname(require.resolve('@cardstack/postgres/package.json')),
  'migrations',
  '1794937324604_add-platform-secrets.js',
);

// Roles and memberships are shared by every database on the server, so each
// test removes the memberships it makes, whatever happens.
const MEMBER = 'readonly_member_for_platform_secrets_test';

module(basename(import.meta.filename), function () {
  module('the read-only role and platform_secrets', function (hooks) {
    let dbAdapter: PgAdapter;

    setupDB(hooks, {
      beforeEach: async (adapter) => {
        dbAdapter = adapter;
        // The role as staging and production have it: SELECT on every table
        // in the schema, which its default privileges grant on each new
        // table, and here a column grant besides.
        await createRole('readonly_role');
        await dbAdapter.execute(
          `GRANT SELECT ON ALL TABLES IN SCHEMA public TO readonly_role`,
        );
        await dbAdapter.execute(
          `GRANT SELECT (name, note) ON platform_secrets TO readonly_role`,
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

    async function runUp() {
      let statements: string[] = [];
      require(MIGRATION).up({
        sql: (statement: string) => statements.push(statement),
      });
      for (let statement of statements) {
        await dbAdapter.execute(statement);
      }
    }

    async function readableColumns(role: string): Promise<string[]> {
      let rows = await dbAdapter.execute(
        `SELECT col.attname AS name
         FROM pg_attribute col
         WHERE col.attrelid = 'platform_secrets'::regclass
           AND col.attnum > 0 AND NOT col.attisdropped
           AND has_column_privilege('${role}', col.attrelid, col.attnum, 'SELECT')`,
      );
      return rows.map((row) => String(row.name));
    }

    async function canSelect(role: string, table: string): Promise<boolean> {
      let [{ readable }] = await dbAdapter.execute(
        `SELECT has_table_privilege('${role}', '${table}', 'SELECT') AS readable`,
      );
      return readable as boolean;
    }

    test('the read-only role and its members cannot read platform_secrets, and running up again changes nothing', async function (assert) {
      await createRole(MEMBER);
      await dbAdapter.execute(`GRANT readonly_role TO ${MEMBER}`);
      try {
        assert.true(
          await canSelect('readonly_role', 'platform_secrets'),
          'the role reads the table before the migration withholds it',
        );
        await runUp();
        await runUp();
        for (let role of ['readonly_role', MEMBER]) {
          assert.false(
            await canSelect(role, 'platform_secrets'),
            `${role} can't read the table`,
          );
          assert.deepEqual(
            await readableColumns(role),
            [],
            `${role} can't read any column of it`,
          );
          assert.true(
            await canSelect(role, 'platform_secret_history'),
            `${role} reads the history, which holds no value`,
          );
        }
      } finally {
        await dbAdapter.execute(`REVOKE readonly_role FROM ${MEMBER}`);
      }
    });

    test('up stops when a member of the role can still read the table through another grant', async function (assert) {
      await createRole(MEMBER);
      await dbAdapter.execute(`GRANT readonly_role TO ${MEMBER}`);
      try {
        await dbAdapter.execute(`GRANT SELECT ON platform_secrets TO PUBLIC`);
        await assert.rejects(
          runUp(),
          /can read platform_secrets\./,
          'a grant to PUBLIC is not the migration to revoke, so it stops',
        );
      } finally {
        await dbAdapter.execute(
          `REVOKE SELECT ON platform_secrets FROM PUBLIC`,
        );
        await dbAdapter.execute(`REVOKE readonly_role FROM ${MEMBER}`);
      }
    });
  });
});
