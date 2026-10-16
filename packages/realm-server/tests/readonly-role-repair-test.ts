import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename, dirname, join } from 'path';
import { createRequire } from 'module';
import { setupDB } from './helpers/index.ts';

const require = createRequire(import.meta.url);
const REPAIR_MIGRATION = join(
  dirname(require.resolve('@cardstack/postgres/package.json')),
  'migrations',
  '1792193136667_repair-readonly-role-withheld-table-grants.js',
);

const WITHHELD_TABLES = [
  'proxy_endpoints',
  'incoming_webhooks',
  'user_keys',
  'key_write_tickets',
];

const OWNER = 'admin_owner_for_readonly_role_repair_test';
const DELEGATOR = 'delegator_for_readonly_role_repair_test';
const DELEGATED_MEMBER =
  'readonly_delegated_member_for_readonly_role_repair_test';
const PASSING_MEMBER = 'readonly_passing_member_for_readonly_role_repair_test';
// Sorts ahead of the member that grants to it, so down() reaches its grant
// before the member holds the grant option again.
const RECIPIENT = 'a_recipient_for_readonly_role_repair_test';
const GROUP = 'readonly_group_for_readonly_role_repair_test';
const GROUP_LOGIN = 'readonly_group_login_for_readonly_role_repair_test';

module(basename(import.meta.filename), function () {
  module('the read-only role repair migration', function (hooks) {
    let dbAdapter: any;

    setupDB(hooks, {
      beforeEach: async (_dbAdapter) => {
        dbAdapter = _dbAdapter;
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

    async function grantAs(role: string, sql: string) {
      await dbAdapter.withTransaction(async (query: any) => {
        await query([`SET LOCAL ROLE ${role}`]);
        await query([sql]);
      });
    }

    async function selectAs(role: string, sql: string) {
      return await dbAdapter.withTransaction(async (query: any) => {
        await query([`SET LOCAL ROLE ${role}`]);
        return await query([sql]);
      });
    }

    async function runMigration(direction: 'up' | 'down') {
      let statements: string[] = [];
      require(REPAIR_MIGRATION)[direction]({
        sql: (statement: string) => statements.push(statement),
      });
      for (let statement of statements) {
        await dbAdapter.execute(statement);
      }
    }

    // Every grant on the withheld tables and on their columns, with who made
    // it.
    async function tableGrants() {
      return await dbAdapter.execute(
        `SELECT tbl.relname::text AS table_name, NULL::text AS column_name,
           grantee_role.rolname AS grantee, grantor_role.rolname AS grantor,
           acl.privilege_type, acl.is_grantable
         FROM pg_class tbl
         CROSS JOIN LATERAL aclexplode(tbl.relacl) acl
         JOIN pg_roles grantee_role ON grantee_role.oid = acl.grantee
         JOIN pg_roles grantor_role ON grantor_role.oid = acl.grantor
         WHERE tbl.relname = ANY ($1)
         UNION ALL
         SELECT tbl.relname::text, col.attname::text, grantee_role.rolname,
           grantor_role.rolname, acl.privilege_type, acl.is_grantable
         FROM pg_class tbl
         JOIN pg_attribute col ON col.attrelid = tbl.oid
         CROSS JOIN LATERAL aclexplode(col.attacl) acl
         JOIN pg_roles grantee_role ON grantee_role.oid = acl.grantee
         JOIN pg_roles grantor_role ON grantor_role.oid = acl.grantor
         WHERE tbl.relname = ANY ($1)
         ORDER BY 1, 2 NULLS FIRST, 3, 4, 5, 6`,
        { bind: [WITHHELD_TABLES] },
      );
    }

    async function ownerSelects() {
      return (
        await dbAdapter.execute(
          `SELECT tbl.relname::text AS table_name
           FROM pg_class tbl
           CROSS JOIN LATERAL aclexplode(tbl.relacl) acl
           WHERE tbl.relname = ANY ($1)
             AND acl.grantee = tbl.relowner
             AND acl.privilege_type = 'SELECT'
           ORDER BY 1`,
          { bind: [WITHHELD_TABLES] },
        )
      ).map(({ table_name }: { table_name: string }) => table_name);
    }

    hooks.beforeEach(async function () {
      // The roles are shared by every database on the server, so the test
      // database may have been migrated while the read-only role existed,
      // leaving that run's record behind. Each test starts from a database
      // where the repair hasn't recorded anything yet.
      await dbAdapter.execute(
        `DROP TABLE IF EXISTS readonly_role_repaired_select_grants`,
      );
      await createRole('readonly_role');
      // The tables' owner is an ADMIN-only member of the read-only role, as
      // Postgres 16 makes a role with CREATEROLE that creates it.
      await createRole(OWNER);
      for (let table of WITHHELD_TABLES) {
        await dbAdapter.execute(`ALTER TABLE ${table} OWNER TO ${OWNER}`);
      }
      await dbAdapter.execute(
        `GRANT readonly_role TO ${OWNER} WITH ADMIN TRUE, INHERIT FALSE, SET FALSE`,
      );
    });

    hooks.afterEach(async function () {
      await dbAdapter.execute(`REVOKE readonly_role FROM ${OWNER}`);
    });

    test('gives the owner back the SELECT a withholding pass revoked, and down leaves it', async function (assert) {
      // The state a pass that counted the owner as a reader leaves: the
      // read-only role's grant revoked, and the owner's own SELECT with it.
      for (let table of WITHHELD_TABLES) {
        await dbAdapter.execute(
          `REVOKE SELECT ON TABLE ${table} FROM ${OWNER}`,
        );
      }
      assert.deepEqual(
        await ownerSelects(),
        [],
        'the owner starts unable to read',
      );

      await runMigration('up');
      assert.deepEqual(
        await ownerSelects(),
        [...WITHHELD_TABLES].sort(),
        'up gives the owner back SELECT on every table',
      );
      for (let table of WITHHELD_TABLES) {
        assert.deepEqual(
          await selectAs(
            OWNER,
            `SELECT COUNT(*) >= 0 AS readable FROM ${table}`,
          ),
          [{ readable: true }],
          `the owner reads ${table}`,
        );
      }

      await runMigration('down');
      assert.deepEqual(
        await ownerSelects(),
        [...WITHHELD_TABLES].sort(),
        'down leaves the owner able to read',
      );
    });

    test('revokes every grant a reader holds whoever made it, and down restores them', async function (assert) {
      for (let role of [
        DELEGATOR,
        DELEGATED_MEMBER,
        PASSING_MEMBER,
        RECIPIENT,
        GROUP,
        GROUP_LOGIN,
      ]) {
        await createRole(role);
      }
      await dbAdapter.execute(`REVOKE readonly_role FROM ${DELEGATOR}`);
      await dbAdapter.execute(`REVOKE readonly_role FROM ${RECIPIENT}`);
      await dbAdapter.execute(`GRANT readonly_role TO ${DELEGATED_MEMBER}`);
      await dbAdapter.execute(`GRANT readonly_role TO ${PASSING_MEMBER}`);
      // A login that reaches the read-only role through a group.
      await dbAdapter.execute(`GRANT readonly_role TO ${GROUP}`);
      await dbAdapter.execute(`GRANT ${GROUP} TO ${GROUP_LOGIN}`);
      for (let table of WITHHELD_TABLES) {
        await dbAdapter.execute(
          `GRANT SELECT ON TABLE ${table} TO readonly_role`,
        );
      }
      // A grant another role made to a member.
      await dbAdapter.execute(
        `GRANT SELECT ON TABLE proxy_endpoints TO ${DELEGATOR} WITH GRANT OPTION`,
      );
      await grantAs(
        DELEGATOR,
        `GRANT SELECT ON TABLE proxy_endpoints TO ${DELEGATED_MEMBER}`,
      );
      // A member's grant that it passed on to a role outside the read-only
      // role.
      await dbAdapter.execute(
        `GRANT SELECT ON TABLE incoming_webhooks TO ${PASSING_MEMBER} WITH GRANT OPTION`,
      );
      await grantAs(
        PASSING_MEMBER,
        `GRANT SELECT ON TABLE incoming_webhooks TO ${RECIPIENT}`,
      );
      // A grant to the login that reads through the group.
      await dbAdapter.execute(
        `GRANT SELECT (id) ON TABLE user_keys TO ${GROUP_LOGIN}`,
      );
      let before = await tableGrants();

      await runMigration('up');
      for (let [role, table] of [
        ['readonly_role', 'key_write_tickets'],
        [DELEGATED_MEMBER, 'proxy_endpoints'],
        [PASSING_MEMBER, 'incoming_webhooks'],
        [GROUP_LOGIN, 'user_keys'],
      ]) {
        await assert.rejects(
          selectAs(role, `SELECT COUNT(*) FROM ${table}`),
          new RegExp(`permission denied for table ${table}`),
          `${role} can't read ${table}`,
        );
      }
      let afterUp = await tableGrants();
      assert.deepEqual(
        afterUp
          .filter(
            ({ grantee }: { grantee: string }) =>
              grantee === DELEGATOR || grantee === RECIPIENT,
          )
          .map(({ grantee }: { grantee: string }) => grantee),
        [DELEGATOR],
        'the grantor outside the role keeps its own grant, and the grant passed on from a member goes with it',
      );

      await runMigration('down');
      assert.deepEqual(
        await tableGrants(),
        before,
        'down restores every grant up revoked, each from the role that made it',
      );
      let [{ record }] = await dbAdapter.execute(
        `SELECT to_regclass('readonly_role_repaired_select_grants') AS record`,
      );
      assert.strictEqual(record, null, 'down drops the record');
    });

    test('running up a second time keeps the record of the first', async function (assert) {
      await createRole(DELEGATED_MEMBER);
      await dbAdapter.execute(`GRANT readonly_role TO ${DELEGATED_MEMBER}`);
      await dbAdapter.execute(
        `GRANT SELECT ON TABLE proxy_endpoints TO ${DELEGATED_MEMBER}`,
      );
      let before = await tableGrants();

      await runMigration('up');
      await runMigration('up');
      await runMigration('down');

      assert.deepEqual(await tableGrants(), before);
    });
  });
});
