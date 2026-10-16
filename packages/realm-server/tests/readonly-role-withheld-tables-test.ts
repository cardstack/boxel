import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename, dirname, join } from 'path';
import { createRequire } from 'module';
import { setupDB } from './helpers/index.ts';

const require = createRequire(import.meta.url);
const CHECK_MIGRATION = join(
  dirname(require.resolve('@cardstack/postgres/package.json')),
  'migrations',
  '1792192933698_check-readonly-role-cant-read-withheld-tables.js',
);

const WITHHELD_TABLES = [
  'proxy_endpoints',
  'incoming_webhooks',
  'user_keys',
  'key_write_tickets',
];

// Roles and memberships are shared by every database on the server, so each
// test removes the memberships it makes, whatever happens.
const MEMBER = 'readonly_member_for_withheld_tables_test';
const GROUP = 'readonly_group_for_withheld_tables_test';
const LEAF = 'readonly_leaf_for_withheld_tables_test';
const ADMIN_MEMBER = 'readonly_admin_member_for_withheld_tables_test';
const OWNER = 'readonly_owner_for_withheld_tables_test';
const OTHER_ROLE = 'other_role_for_withheld_tables_test';
const OUTSIDER = 'outsider_for_withheld_tables_test';

module(basename(import.meta.filename), function () {
  module('the read-only role check', function (hooks) {
    let dbAdapter: any;

    setupDB(hooks, {
      beforeEach: async (_dbAdapter) => {
        dbAdapter = _dbAdapter;
        // The role and its blanket grant as staging and production have them,
        // with SELECT revoked on the withheld tables as the migrations that
        // create or seal them leave it.
        await createRole('readonly_role');
        await dbAdapter.execute(
          `GRANT SELECT ON ALL TABLES IN SCHEMA public TO readonly_role`,
        );
        await dbAdapter.execute(
          `REVOKE SELECT ON TABLE ${WITHHELD_TABLES.join(', ')} FROM readonly_role`,
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
      require(CHECK_MIGRATION).up({
        sql: (statement: string) => statements.push(statement),
      });
      for (let statement of statements) {
        await dbAdapter.execute(statement);
      }
    }

    async function withMemberships(
      memberships: [role: string, member: string, options?: string][],
      fn: () => Promise<void>,
    ) {
      for (let [role, member] of memberships) {
        await createRole(role);
        await createRole(member);
      }
      try {
        for (let [role, member, options] of memberships) {
          await dbAdapter.execute(
            `GRANT ${role} TO ${member}${options ? ` WITH ${options}` : ''}`,
          );
        }
        await fn();
      } finally {
        for (let [role, member] of [...memberships].reverse()) {
          await dbAdapter.execute(`REVOKE ${role} FROM ${member}`);
        }
      }
    }

    test('passes when only a role outside the read-only role reads the tables', async function (assert) {
      await createRole(OUTSIDER);
      await dbAdapter.execute(
        `GRANT SELECT ON TABLE ${WITHHELD_TABLES.join(', ')} TO ${OUTSIDER}`,
      );

      await runUp();

      assert.ok(true, 'up completes');
    });

    test('stops when PUBLIC can read a column', async function (assert) {
      await dbAdapter.execute(
        `GRANT SELECT (api_key) ON TABLE proxy_endpoints TO PUBLIC`,
      );

      await assert.rejects(
        runUp(),
        /can read proxy_endpoints\.api_key, which is withheld from readonly_role/,
      );
    });

    test('stops when a member reads a table through another role', async function (assert) {
      await withMemberships(
        [
          ['readonly_role', MEMBER],
          [OTHER_ROLE, MEMBER],
        ],
        async () => {
          await dbAdapter.execute(
            `GRANT SELECT ON TABLE user_keys TO ${OTHER_ROLE}`,
          );

          await assert.rejects(
            runUp(),
            new RegExp(
              `${MEMBER} can read user_keys\\.\\w+, which is withheld`,
            ),
          );
        },
      );
    });

    test('stops when a role that inherits the read-only role through a group reads a table', async function (assert) {
      await withMemberships(
        [
          ['readonly_role', GROUP],
          [GROUP, LEAF],
          [OTHER_ROLE, LEAF],
        ],
        async () => {
          await dbAdapter.execute(
            `GRANT SELECT (owner) ON TABLE key_write_tickets TO ${OTHER_ROLE}`,
          );

          await assert.rejects(
            runUp(),
            new RegExp(
              `${LEAF} can read key_write_tickets\\.owner, which is withheld`,
            ),
          );
        },
      );
    });

    test('leaves a member that holds only the ADMIN option on the role', async function (assert) {
      // The role that creates the read-only role holds this membership on
      // Postgres 16 and later, and reads nothing through it.
      await withMemberships(
        [
          [
            'readonly_role',
            ADMIN_MEMBER,
            'ADMIN TRUE, INHERIT FALSE, SET FALSE',
          ],
          [OTHER_ROLE, ADMIN_MEMBER],
        ],
        async () => {
          await dbAdapter.execute(
            `GRANT SELECT ON TABLE ${WITHHELD_TABLES.join(', ')} TO ${OTHER_ROLE}`,
          );

          await runUp();

          let [{ readable }] = await dbAdapter.execute(
            `SELECT has_table_privilege('${ADMIN_MEMBER}', 'proxy_endpoints', 'SELECT') AS readable`,
          );
          assert.true(
            readable,
            'the member still reads through the other role',
          );
        },
      );
    });

    test('leaves a member that owns a table reading it', async function (assert) {
      await createRole(OWNER);
      await dbAdapter.execute(
        `ALTER TABLE incoming_webhooks OWNER TO ${OWNER}`,
      );
      await withMemberships([['readonly_role', OWNER]], async () => {
        await runUp();

        assert.ok(true, 'up completes');
      });
    });
  });
});
