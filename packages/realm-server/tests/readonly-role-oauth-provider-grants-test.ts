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
  '1794552668724_add-oauth-provider-grants.js',
);

// Roles and memberships are shared by every database on the server, so the
// test removes the membership it makes, whatever happens.
const MEMBER = 'readonly_member_for_oauth_provider_grants_test';

module(basename(import.meta.filename), function () {
  module('readonly_role and oauth_provider_grants', function (hooks) {
    let dbAdapter: PgAdapter;

    setupDB(hooks, {
      beforeEach: async (adapter) => {
        dbAdapter = adapter;
        // The role as staging and production have it, before this table's
        // migration grants it anything here.
        await createRole('readonly_role');
        await dbAdapter.execute(
          `REVOKE SELECT ON TABLE oauth_provider_grants FROM readonly_role`,
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

    async function canSelect(role: string): Promise<boolean> {
      let [{ readable }] = await dbAdapter.execute(
        `SELECT has_table_privilege('${role}', 'oauth_provider_grants', 'SELECT') AS readable`,
      );
      return readable as boolean;
    }

    test('the read-only role and its members can read the OAuth grants', async function (assert) {
      await createRole(MEMBER);
      await dbAdapter.execute(`GRANT readonly_role TO ${MEMBER}`);
      try {
        assert.false(await canSelect('readonly_role'), 'not before');
        await runUp();
        await runUp();
        for (let role of ['readonly_role', MEMBER]) {
          assert.true(await canSelect(role), `${role} reads the table`);
        }
      } finally {
        await dbAdapter.execute(`REVOKE readonly_role FROM ${MEMBER}`);
      }
    });
  });
});
