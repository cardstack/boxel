import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename, dirname, join } from 'path';
import { createRequire } from 'module';
import { inspect } from 'util';
import { setupDB } from './helpers/index.ts';
import { logLinesDuring } from './helpers/log-capture.ts';
import {
  startSentryCapture,
  type SentryEvent,
} from './helpers/sentry-capture.ts';
import {
  installSecretsKeyring,
  LocalKeyProvider,
  reportPlaintextCensus,
  resealUnderCurrentKey,
  resetSecretsAtRest,
  SEALED_COLUMNS,
  sealedColumnBindings,
  sealedFromColumns,
  SecretsKeyring,
} from '../lib/secrets-at-rest/index.ts';
import {
  INCOMING_WEBHOOK_SECRET_COLUMNS,
  INCOMING_WEBHOOK_SECRET_FIELD,
  incomingWebhookSecretBinding,
  insertIncomingWebhook,
  readIncomingWebhookSecret,
  rotateIncomingWebhookSecret,
  type IncomingWebhookSecretRow,
} from '../lib/incoming-webhook-secrets.ts';

const require = createRequire(import.meta.url);
const SEAL_MIGRATION = join(
  dirname(require.resolve('@cardstack/postgres/package.json')),
  'migrations',
  '1791999900813_seal-incoming-webhook-signing-secrets.js',
);

const OWNER = '@webhook-owner:localhost';
const FIRST_ID = '11111111-1111-4111-8111-111111111111';
const SECOND_ID = '22222222-2222-4222-8222-222222222222';
const FIRST_SECRET = 'first-signing-secret-incoming-webhook-secrets-test';
const SECOND_SECRET = 'second-signing-secret-incoming-webhook-secrets-test';

module(basename(import.meta.filename), function () {
  module('incoming webhook signing secrets', function (hooks) {
    let dbAdapter: any;
    let keyring: SecretsKeyring;

    setupDB(hooks, {
      beforeEach: async (_dbAdapter) => {
        dbAdapter = _dbAdapter;
        keyring = installSecretsKeyring(
          await new LocalKeyProvider().loadDataKeys(),
        );
      },
      afterEach: async () => {
        resetSecretsAtRest();
      },
    });

    // A row as the application writes it: the secret sealed under its
    // binding.
    async function insertSealedRow(
      id: string,
      signingSecret: string,
      ring: SecretsKeyring = keyring,
    ) {
      await dbAdapter.execute(
        `INSERT INTO incoming_webhooks (id, username, webhook_path, verification_type, verification_config, signing_secret_ciphertext, signing_secret_nonce, signing_secret_tag, signing_secret_key_id, created_at, updated_at)
         VALUES ($1, $2, $3, 'HMAC_SHA256_HEADER', '{"header": "X-Hub-Signature-256", "encoding": "hex"}'::jsonb, decode($4, 'base64'), decode($5, 'base64'), decode($6, 'base64'), $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        {
          bind: [
            id,
            OWNER,
            `whk_${id}`,
            ...sealedColumnBindings(
              ring.seal(
                signingSecret,
                incomingWebhookSecretBinding({ id, username: OWNER }),
              ),
            ),
          ],
        },
      );
    }

    async function secretRow(id: string): Promise<IncomingWebhookSecretRow> {
      let [row] = await dbAdapter.execute(
        `SELECT id, username, ${INCOMING_WEBHOOK_SECRET_COLUMNS} FROM incoming_webhooks WHERE id = $1`,
        { bind: [id] },
      );
      return row as unknown as IncomingWebhookSecretRow;
    }

    function openedFrom(row: IncomingWebhookSecretRow, ring = keyring) {
      return ring.open(
        sealedFromColumns({ ...row }, 'signing_secret')!,
        incomingWebhookSecretBinding(row),
      );
    }

    test('the table holds no plain-text secret, and the census reports no plain-text secret columns', async function (assert) {
      let columns = await dbAdapter.execute(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'incoming_webhooks'
           AND column_name = 'signing_secret'`,
      );
      assert.deepEqual(columns, [], 'the plain-text column is dropped');

      let lines = await logLinesDuring(['secrets-at-rest'], () =>
        reportPlaintextCensus(dbAdapter),
      );
      assert.deepEqual(
        lines
          .map(({ message }) => message)
          .filter((message) => message.startsWith('plaintext census:')),
        ['plaintext census: no plain-text secret columns'],
      );
    });

    test('registering and rotating seal the secret under its binding, and reads open it', async function (assert) {
      let { signingSecret } = await insertIncomingWebhook(
        dbAdapter,
        {
          username: OWNER,
          webhookPath: 'whk_registered',
          verificationType: 'HMAC_SHA256_HEADER',
          verificationConfig: {
            header: 'X-Hub-Signature-256',
            encoding: 'hex',
          },
        },
        { id: FIRST_ID },
      );
      let row = await secretRow(FIRST_ID);
      assert.strictEqual(row.signing_secret_key_id, keyring.currentKeyId);
      assert.strictEqual(
        keyring.open(sealedFromColumns({ ...row }, 'signing_secret')!, {
          field: INCOMING_WEBHOOK_SECRET_FIELD,
          owner: OWNER,
          id: FIRST_ID,
        }),
        signingSecret,
        'the sealed value opens to the secret under its field, its owner and its id',
      );
      assert.strictEqual(readIncomingWebhookSecret(row), signingSecret);

      let rotated = await rotateIncomingWebhookSecret(dbAdapter, {
        id: FIRST_ID,
        username: OWNER,
      });

      assert.ok(rotated);
      assert.notStrictEqual(rotated!.signingSecret, signingSecret);
      let rotatedRow = await secretRow(FIRST_ID);
      assert.strictEqual(openedFrom(rotatedRow), rotated!.signingSecret);
      assert.strictEqual(
        readIncomingWebhookSecret(rotatedRow),
        rotated!.signingSecret,
      );
      assert.strictEqual(
        await rotateIncomingWebhookSecret(dbAdapter, {
          id: FIRST_ID,
          username: '@someone-else:localhost',
        }),
        undefined,
        "another user's webhook is not rotated",
      );
    });

    test('a sealed secret whose owner was edited outside the application is not read, and is reported once to the log and Sentry', async function (assert) {
      await insertSealedRow(FIRST_ID, FIRST_SECRET);
      let newOwner = '@new-owner:localhost';
      await dbAdapter.execute(
        `UPDATE incoming_webhooks SET username = $1 WHERE id = $2`,
        { bind: [newOwner, FIRST_ID] },
      );

      let failures: string[] = [];
      let sentry = startSentryCapture({ tracing: false });
      let events: SentryEvent[];
      let lines: Awaited<ReturnType<typeof logLinesDuring>>;
      try {
        lines = await logLinesDuring(['incoming-webhook-secrets'], async () => {
          for (let i = 0; i < 2; i++) {
            let row = await secretRow(FIRST_ID);
            try {
              readIncomingWebhookSecret(row);
            } catch (e: any) {
              failures.push(e.message);
            }
          }
        });
        events = await sentry.flushedEvents();
      } finally {
        await sentry.stop();
      }

      assert.strictEqual(
        failures.length,
        2,
        'the secret bound to the old owner never verifies for the new one',
      );
      assert.false(failures.some((message) => message.includes(FIRST_SECRET)));
      let errors = lines!.filter(({ level }) => level === 'error');
      assert.strictEqual(
        errors.length,
        1,
        'the failure is logged once, not on every delivery',
      );
      assert.true(errors[0].message.includes(FIRST_ID));
      assert.false(
        errors[0].message.includes(FIRST_SECRET),
        'the log line never carries the secret',
      );
      assert.strictEqual(events!.length, 1, 'the failure reaches Sentry once');
      let reported = JSON.stringify(events![0]);
      assert.true(reported.includes(FIRST_ID));
      assert.false(
        reported.includes(FIRST_SECRET),
        'the Sentry event never carries the secret',
      );

      let rotated = await rotateIncomingWebhookSecret(dbAdapter, {
        id: FIRST_ID,
        username: newOwner,
      });
      assert.strictEqual(
        readIncomingWebhookSecret(await secretRow(FIRST_ID)),
        rotated!.signingSecret,
        'rotating issues a secret bound to the new owner',
      );
    });

    test('a secret sealed under a data key this process has not loaded is not read, and is reported', async function (assert) {
      // Another task, further into a data-key rotation, sealed the row under
      // a key this one doesn't hold.
      let newer = new SecretsKeyring(
        [{ keyId: 'kms-newer', key: Buffer.alloc(32, 7) }],
        'kms-newer',
      );
      await insertSealedRow(FIRST_ID, FIRST_SECRET, newer);

      let lines = await logLinesDuring(
        ['incoming-webhook-secrets'],
        async () => {
          let row = await secretRow(FIRST_ID);
          assert.throws(
            () => readIncomingWebhookSecret(row),
            /has no signing secret to verify with/,
          );
          assert.strictEqual(
            readIncomingWebhookSecret(row, newer),
            FIRST_SECRET,
            'a process that holds the key reads it',
          );
        },
      );

      let errors = lines.filter(({ level }) => level === 'error');
      assert.strictEqual(errors.length, 1);
      assert.true(errors[0].message.includes(FIRST_ID));
      assert.false(errors[0].message.includes(FIRST_SECRET));
    });

    test('a webhook with no sealed secret is not read, and is reported', async function (assert) {
      await insertSealedRow(FIRST_ID, FIRST_SECRET);
      await dbAdapter.execute(
        `UPDATE incoming_webhooks SET signing_secret_ciphertext = NULL WHERE id = $1`,
        { bind: [FIRST_ID] },
      );

      let lines = await logLinesDuring(
        ['incoming-webhook-secrets'],
        async () => {
          let row = await secretRow(FIRST_ID);
          assert.throws(
            () => readIncomingWebhookSecret(row),
            /has no signing secret to verify with/,
          );
        },
      );

      let errors = lines.filter(({ level }) => level === 'error');
      assert.strictEqual(errors.length, 1);
      assert.true(errors[0].message.includes('is not sealed'));
    });

    test('a secret in a statement that fails never reaches the error or its log', async function (assert) {
      await insertSealedRow(FIRST_ID, FIRST_SECRET);
      let logged: string[] = [];
      let originalConsoleError = console.error;
      console.error = (...args: unknown[]) => {
        logged.push(args.map((arg) => inspect(arg, { depth: 10 })).join(' '));
      };
      let thrown: unknown;
      let sealedSecrets: string[] = [];
      let recording = Object.create(keyring) as SecretsKeyring;
      recording.seal = (value, binding) => {
        sealedSecrets.push(value);
        return keyring.seal(value, binding);
      };
      let issued: string[] = [];
      let recordingAdapter = Object.create(dbAdapter);
      recordingAdapter.execute = async (sql: string, opts?: any) => {
        issued.push(...(opts?.bind ?? []).map(String));
        return dbAdapter.execute(sql, opts);
      };
      try {
        // The webhook path is unique, and Postgres quotes the failing key in
        // the error.
        await insertIncomingWebhook(
          recordingAdapter,
          {
            username: OWNER,
            webhookPath: `whk_${FIRST_ID}`,
            verificationType: 'HMAC_SHA256_HEADER',
            verificationConfig: {},
          },
          { id: SECOND_ID, keyring: recording },
        );
      } catch (e) {
        thrown = e;
      } finally {
        console.error = originalConsoleError;
      }

      assert.ok(thrown, 'the statement fails');
      let [secret] = sealedSecrets;
      assert.ok(secret, 'a secret was issued');
      assert.false(
        issued.some((binding) => binding.includes(secret)),
        'the statement carries only the sealed secret',
      );
      assert.false(
        inspect(thrown, { depth: 10 }).includes(secret),
        'the error carries no secret',
      );
      assert.true(logged.length > 0, 'the failure is logged');
      assert.false(
        logged.some((line) => line.includes(secret)),
        'the log carries no secret',
      );
    });

    test('a data-key rotation re-seals signing secrets under the new data key, and they still verify', async function (assert) {
      await insertSealedRow(FIRST_ID, FIRST_SECRET);
      await insertSealedRow(SECOND_ID, SECOND_SECRET);
      let column = SEALED_COLUMNS.find(
        ({ field }) => field === INCOMING_WEBHOOK_SECRET_FIELD,
      );
      assert.ok(column, 'the column is registered with the re-seal pass');
      let local = await new LocalKeyProvider().loadDataKeys();
      let rotated = new SecretsKeyring(
        [...local.keys, { keyId: 'kms-new', key: Buffer.alloc(32, 5) }],
        'kms-new',
      );

      let report = await resealUnderCurrentKey(dbAdapter, rotated, {
        columns: [column!],
      });

      assert.deepEqual(report.columns, [
        {
          field: INCOMING_WEBHOOK_SECRET_FIELD,
          resealed: 2,
          changedConcurrently: 0,
          unopenable: 0,
        },
      ]);
      let row = await secretRow(FIRST_ID);
      assert.strictEqual(row.signing_secret_key_id, 'kms-new');
      let errors = (
        await logLinesDuring(['incoming-webhook-secrets'], async () => {
          assert.strictEqual(
            readIncomingWebhookSecret(row, rotated),
            FIRST_SECRET,
          );
        })
      ).filter(({ level }) => level === 'error');
      assert.strictEqual(
        errors.length,
        0,
        'the re-sealed secret opens under the binding its writes use',
      );
    });

    test("the read-only role can't select the table", async function (assert) {
      // The role and its blanket grant as staging and production have them,
      // then the migration that withholds this table.
      await dbAdapter.execute(
        `DO $$
         BEGIN
           CREATE ROLE readonly_role;
         EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL;
         END
         $$`,
      );
      await dbAdapter.execute(
        `GRANT SELECT ON ALL TABLES IN SCHEMA public TO readonly_role`,
      );
      // A user that inherits the role and was also granted SELECT on the
      // table directly.
      await dbAdapter.execute(
        `DO $$
         BEGIN
           CREATE ROLE readonly_member_for_incoming_webhooks_test;
         EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL;
         END
         $$`,
      );
      await dbAdapter.execute(
        `GRANT readonly_role TO readonly_member_for_incoming_webhooks_test`,
      );
      await dbAdapter.execute(
        `GRANT SELECT ON TABLE incoming_webhooks TO readonly_member_for_incoming_webhooks_test`,
      );
      let statements: string[] = [];
      require(SEAL_MIGRATION).up({
        sql: (statement: string) => statements.push(statement),
      });
      for (let statement of statements) {
        await dbAdapter.execute(statement);
      }
      await insertSealedRow(FIRST_ID, FIRST_SECRET);

      async function selectAsReadOnly(sql: string, role = 'readonly_role') {
        return await dbAdapter.withTransaction(async (query: any) => {
          await query([`SET LOCAL ROLE ${role}`]);
          return await query([sql]);
        });
      }

      await assert.rejects(
        selectAsReadOnly(
          'SELECT signing_secret_ciphertext FROM incoming_webhooks',
        ),
        /permission denied for table incoming_webhooks/,
      );
      await assert.rejects(
        selectAsReadOnly('SELECT webhook_path FROM incoming_webhooks'),
        /permission denied for table incoming_webhooks/,
      );
      await assert.rejects(
        selectAsReadOnly(
          'SELECT signing_secret_ciphertext FROM incoming_webhooks',
          'readonly_member_for_incoming_webhooks_test',
        ),
        /permission denied for table incoming_webhooks/,
        'a member granted SELECT directly is denied too',
      );
      assert.deepEqual(
        await selectAsReadOnly('SELECT COUNT(*) >= 0 AS readable FROM plans'),
        [{ readable: true }],
        'the role keeps reading other tables',
      );
    });

    test('the migration records when each existing secret was issued', async function (assert) {
      await insertSealedRow(FIRST_ID, FIRST_SECRET);
      await dbAdapter.execute(
        `UPDATE incoming_webhooks
           SET created_at = '2026-01-02 03:04:05', signing_secret_created_at = NULL
         WHERE id = $1`,
        { bind: [FIRST_ID] },
      );
      let statements: string[] = [];
      require(SEAL_MIGRATION).up({
        sql: (statement: string) => statements.push(statement),
      });
      for (let statement of statements) {
        await dbAdapter.execute(statement);
      }

      let [row] = await dbAdapter.execute(
        `SELECT signing_secret_created_at = created_at AS matches FROM incoming_webhooks WHERE id = $1`,
        { bind: [FIRST_ID] },
      );
      assert.true(row.matches, 'issued with the webhook');
    });

    module('the migration down', function (hooks) {
      const DIRECT_MEMBER = 'readonly_direct_member_for_incoming_webhooks_test';
      const INHERITING_MEMBER =
        'readonly_inheriting_member_for_incoming_webhooks_test';
      const OUTSIDER = 'outsider_for_incoming_webhooks_test';
      const COLUMN_MEMBER = 'readonly_column_member_for_incoming_webhooks_test';
      const DELEGATOR = 'delegator_for_incoming_webhooks_test';
      const DELEGATED_MEMBER =
        'readonly_delegated_member_for_incoming_webhooks_test';
      // Sorts ahead of the member that grants to it, so down() reaches its
      // grant before the member holds the grant option again.
      const RECIPIENT = 'a_recipient_for_incoming_webhooks_test';
      const DROPPED_MEMBER =
        'readonly_dropped_member_for_incoming_webhooks_test';

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

      async function runMigration(direction: 'up' | 'down') {
        let statements: string[] = [];
        require(SEAL_MIGRATION)[direction]({
          sql: (statement: string) => statements.push(statement),
        });
        for (let statement of statements) {
          await dbAdapter.execute(statement);
        }
      }

      async function selectAs(role: string, sql: string) {
        return await dbAdapter.withTransaction(async (query: any) => {
          await query([`SET LOCAL ROLE ${role}`]);
          return await query([sql]);
        });
      }

      // Every grant on the table and on its columns, with who made it.
      async function tableGrants() {
        return await dbAdapter.execute(
          `SELECT NULL::text AS column_name, grantee_role.rolname AS grantee,
             grantor_role.rolname AS grantor, acl.privilege_type, acl.is_grantable
           FROM pg_class tbl
           CROSS JOIN LATERAL aclexplode(tbl.relacl) acl
           JOIN pg_roles grantee_role ON grantee_role.oid = acl.grantee
           JOIN pg_roles grantor_role ON grantor_role.oid = acl.grantor
           WHERE tbl.oid = 'incoming_webhooks'::regclass
           UNION ALL
           SELECT col.attname::text, grantee_role.rolname, grantor_role.rolname,
             acl.privilege_type, acl.is_grantable
           FROM pg_attribute col
           CROSS JOIN LATERAL aclexplode(col.attacl) acl
           JOIN pg_roles grantee_role ON grantee_role.oid = acl.grantee
           JOIN pg_roles grantor_role ON grantor_role.oid = acl.grantor
           WHERE col.attrelid = 'incoming_webhooks'::regclass
           ORDER BY 1 NULLS FIRST, 2, 3, 4, 5`,
        );
      }

      // The roles this module sets up. The table's owner also shows up once
      // the table has explicit grants, and the migration never touches it.
      const rolesUnderTest = [
        'readonly_role',
        DIRECT_MEMBER,
        INHERITING_MEMBER,
        OUTSIDER,
      ];

      function selectGranteesIn(
        grants: {
          column_name: string | null;
          grantee: string;
          privilege_type: string;
        }[],
      ) {
        return grants
          .filter(
            ({ column_name, grantee, privilege_type }) =>
              column_name === null &&
              privilege_type === 'SELECT' &&
              rolesUnderTest.includes(grantee),
          )
          .map(({ grantee }) => grantee);
      }

      hooks.beforeEach(async function () {
        // The roles are shared by every database on the server, so the test
        // database may have been migrated while the read-only role existed,
        // leaving that run's record behind. Each test starts from a database
        // where the migration hasn't recorded anything yet.
        await dbAdapter.execute(
          `DROP TABLE IF EXISTS readonly_role_revoked_select_grants`,
        );
        // The role and its blanket grant as staging and production have them.
        await createRole('readonly_role');
        await dbAdapter.execute(
          `GRANT SELECT ON ALL TABLES IN SCHEMA public TO readonly_role`,
        );
        // A member granted SELECT on the table directly, with the right to
        // grant it on; a member that reads only through the role; and a role
        // outside it with its own grant.
        await createRole(DIRECT_MEMBER);
        await createRole(INHERITING_MEMBER);
        await createRole(OUTSIDER);
        await dbAdapter.execute(`GRANT readonly_role TO ${DIRECT_MEMBER}`);
        await dbAdapter.execute(`GRANT readonly_role TO ${INHERITING_MEMBER}`);
        await dbAdapter.execute(`REVOKE readonly_role FROM ${OUTSIDER}`);
        await dbAdapter.execute(
          `GRANT SELECT ON TABLE incoming_webhooks TO ${DIRECT_MEMBER} WITH GRANT OPTION`,
        );
        await dbAdapter.execute(
          `REVOKE SELECT ON TABLE incoming_webhooks FROM ${INHERITING_MEMBER}`,
        );
        await dbAdapter.execute(
          `GRANT SELECT ON TABLE incoming_webhooks TO ${OUTSIDER}`,
        );
      });

      test('restores every grant up revoked, and no others', async function (assert) {
        let before = await tableGrants();
        assert.deepEqual(
          selectGranteesIn(before).sort(),
          [DIRECT_MEMBER, OUTSIDER, 'readonly_role'].sort(),
          'the roles start with their direct grants',
        );

        await runMigration('up');
        assert.deepEqual(
          selectGranteesIn(await tableGrants()),
          [OUTSIDER],
          'up revokes the role and its member, and leaves the outsider',
        );

        await runMigration('down');
        assert.deepEqual(
          await tableGrants(),
          before,
          'every role has the privileges it had before up',
        );
        let [{ record }] = await dbAdapter.execute(
          `SELECT to_regclass('readonly_role_revoked_select_grants') AS record`,
        );
        assert.strictEqual(record, null, 'down removes the empty record');
      });

      test('a read-only role with no direct grant before up gets none from down', async function (assert) {
        await dbAdapter.execute(
          `REVOKE SELECT ON TABLE incoming_webhooks FROM readonly_role`,
        );
        let before = await tableGrants();

        await runMigration('up');
        await runMigration('down');

        assert.deepEqual(await tableGrants(), before);
        assert.notOk(
          selectGranteesIn(before).includes('readonly_role'),
          'the read-only role still has no direct grant',
        );
      });

      test('running up a second time keeps the record of the first', async function (assert) {
        let before = await tableGrants();

        await runMigration('up');
        await runMigration('up');
        await runMigration('down');

        assert.deepEqual(await tableGrants(), before);
      });

      test('with no record, down grants SELECT back to the read-only role alone', async function (assert) {
        await runMigration('up');
        await dbAdapter.execute(
          `DROP TABLE readonly_role_revoked_select_grants`,
        );

        await runMigration('down');

        assert.deepEqual(
          selectGranteesIn(await tableGrants()).sort(),
          [OUTSIDER, 'readonly_role'].sort(),
        );
      });

      test('restores the SELECT grants a member held on individual columns', async function (assert) {
        await createRole(COLUMN_MEMBER);
        await dbAdapter.execute(`GRANT readonly_role TO ${COLUMN_MEMBER}`);
        await dbAdapter.execute(
          `GRANT SELECT (id) ON TABLE incoming_webhooks TO ${COLUMN_MEMBER} WITH GRANT OPTION`,
        );
        await dbAdapter.execute(
          `GRANT SELECT (webhook_path) ON TABLE incoming_webhooks TO ${COLUMN_MEMBER}`,
        );
        let before = await tableGrants();

        await runMigration('up');
        assert.notOk(
          (await tableGrants()).some(
            ({ grantee }: { grantee: string }) => grantee === COLUMN_MEMBER,
          ),
          'up revokes the column grants with the table grant',
        );

        await runMigration('down');
        assert.deepEqual(await tableGrants(), before);
      });

      test('revokes a grant another role made to a member, and down restores it', async function (assert) {
        await createRole(DELEGATOR);
        await createRole(DELEGATED_MEMBER);
        await dbAdapter.execute(`GRANT readonly_role TO ${DELEGATED_MEMBER}`);
        await dbAdapter.execute(
          `GRANT SELECT ON TABLE incoming_webhooks TO ${DELEGATOR} WITH GRANT OPTION`,
        );
        await dbAdapter.withTransaction(async (query: any) => {
          await query([`SET LOCAL ROLE ${DELEGATOR}`]);
          await query([
            `GRANT SELECT ON TABLE incoming_webhooks TO ${DELEGATED_MEMBER}`,
          ]);
        });
        let before = await tableGrants();

        await runMigration('up');
        await assert.rejects(
          selectAs(
            DELEGATED_MEMBER,
            'SELECT signing_secret_ciphertext FROM incoming_webhooks',
          ),
          /permission denied for table incoming_webhooks/,
          'the member is denied',
        );
        assert.deepEqual(
          (await tableGrants())
            .filter(
              ({ grantee }: { grantee: string }) =>
                grantee === DELEGATOR || grantee === DELEGATED_MEMBER,
            )
            .map(({ grantee }: { grantee: string }) => grantee),
          [DELEGATOR],
          'the grantor outside the role keeps its own grant',
        );

        await runMigration('down');
        assert.deepEqual(
          await tableGrants(),
          before,
          'down restores the grant from the role that made it',
        );
      });

      test('revokes a member grant that was passed on, and down restores both', async function (assert) {
        await createRole(RECIPIENT);
        await dbAdapter.execute(`REVOKE readonly_role FROM ${RECIPIENT}`);
        // The member's grant carries the grant option, and it passes SELECT
        // on to a role outside the read-only role.
        await dbAdapter.withTransaction(async (query: any) => {
          await query([`SET LOCAL ROLE ${DIRECT_MEMBER}`]);
          await query([
            `GRANT SELECT ON TABLE incoming_webhooks TO ${RECIPIENT}`,
          ]);
        });
        let before = await tableGrants();

        await runMigration('up');
        await assert.rejects(
          selectAs(
            DIRECT_MEMBER,
            'SELECT signing_secret_ciphertext FROM incoming_webhooks',
          ),
          /permission denied for table incoming_webhooks/,
          'the member is denied',
        );
        assert.notOk(
          (await tableGrants()).some(
            ({ grantee }: { grantee: string }) => grantee === RECIPIENT,
          ),
          'the grant passed on from the member goes with it',
        );

        await runMigration('down');
        assert.deepEqual(
          await tableGrants(),
          before,
          'down restores the member and the grant it passed on',
        );
      });

      test('revokes a column grant a member passed on from its table grant, and down restores both', async function (assert) {
        // Revoking a table grant with CASCADE leaves the column grants passed
        // on from it, so up has to reach the column grant first.
        const COLUMN_RECIPIENT =
          'readonly_column_recipient_for_incoming_webhooks_test';
        await createRole(COLUMN_RECIPIENT);
        await dbAdapter.execute(`GRANT readonly_role TO ${COLUMN_RECIPIENT}`);
        await dbAdapter.withTransaction(async (query: any) => {
          await query([`SET LOCAL ROLE ${DIRECT_MEMBER}`]);
          await query([
            `GRANT SELECT (id) ON TABLE incoming_webhooks TO ${COLUMN_RECIPIENT}`,
          ]);
        });
        let before = await tableGrants();

        await runMigration('up');
        assert.notOk(
          (await tableGrants()).some(
            ({ grantee }: { grantee: string }) =>
              grantee === DIRECT_MEMBER || grantee === COLUMN_RECIPIENT,
          ),
          'up revokes the member and the column grant it passed on',
        );

        await runMigration('down');
        assert.deepEqual(
          await tableGrants(),
          before,
          'down restores the member and the column grant it passed on',
        );
      });

      test('restores a grant passed on by a member that also inherits the grant option from the role', async function (assert) {
        // Named to sort after the read-only role and the recipient, so down()
        // reaches the recipient's grant once the role holds the grant option
        // again but before the member does.
        const MEMBER = 'zz_inheriting_grantor_for_incoming_webhooks_test';
        const RECIPIENT_OF_MEMBER = 'x_recipient_for_incoming_webhooks_test';
        await createRole(MEMBER);
        await createRole(RECIPIENT_OF_MEMBER);
        await dbAdapter.execute(`GRANT readonly_role TO ${MEMBER}`);
        await dbAdapter.execute(
          `REVOKE readonly_role FROM ${RECIPIENT_OF_MEMBER}`,
        );
        await dbAdapter.execute(
          `GRANT SELECT ON TABLE incoming_webhooks TO readonly_role WITH GRANT OPTION`,
        );
        await dbAdapter.execute(
          `GRANT SELECT ON TABLE incoming_webhooks TO ${MEMBER} WITH GRANT OPTION`,
        );
        await dbAdapter.withTransaction(async (query: any) => {
          await query([`SET LOCAL ROLE ${MEMBER}`]);
          await query([
            `GRANT SELECT ON TABLE incoming_webhooks TO ${RECIPIENT_OF_MEMBER}`,
          ]);
        });
        let before = await tableGrants();

        await runMigration('up');
        await runMigration('down');

        assert.deepEqual(
          await tableGrants(),
          before,
          "the recipient's grant comes back from the member, not the role",
        );
      });

      test("leaves the owner's own privileges when the owner administers the read-only role", async function (assert) {
        // As Postgres 16 makes a role with CREATEROLE that creates the
        // read-only role: a member with ADMIN alone, neither inheriting nor
        // able to SET ROLE to it. Here that role owns the table.
        const OWNER = 'admin_owner_for_incoming_webhooks_test';
        await createRole(OWNER);
        await dbAdapter.execute(
          `ALTER TABLE incoming_webhooks OWNER TO ${OWNER}`,
        );
        await dbAdapter.execute(
          `GRANT readonly_role TO ${OWNER} WITH ADMIN TRUE, INHERIT FALSE, SET FALSE`,
        );
        try {
          let ownerGrants = async () =>
            (await tableGrants()).filter(
              ({ grantee }: { grantee: string }) => grantee === OWNER,
            );
          let before = await ownerGrants();
          assert.ok(before.length > 0, 'the owner has its own ACL entry');

          await runMigration('up');
          assert.deepEqual(await ownerGrants(), before, 'up leaves them');

          await runMigration('down');
          assert.deepEqual(await ownerGrants(), before, 'down leaves them');
        } finally {
          await dbAdapter.execute(`REVOKE readonly_role FROM ${OWNER}`);
        }
      });

      test("leaves the owner's own privileges when the owner also reads through the read-only role", async function (assert) {
        const OWNER = 'reading_owner_for_incoming_webhooks_test';
        await createRole(OWNER);
        await dbAdapter.execute(
          `ALTER TABLE incoming_webhooks OWNER TO ${OWNER}`,
        );
        await dbAdapter.execute(`GRANT readonly_role TO ${OWNER}`);
        try {
          let ownerGrants = async () =>
            (await tableGrants()).filter(
              ({ grantee }: { grantee: string }) => grantee === OWNER,
            );
          let before = await ownerGrants();
          assert.ok(before.length > 0, 'the owner has its own ACL entry');

          await runMigration('up');
          assert.deepEqual(await ownerGrants(), before, 'up leaves them');

          await runMigration('down');
          assert.deepEqual(await ownerGrants(), before, 'down leaves them');
        } finally {
          await dbAdapter.execute(`REVOKE readonly_role FROM ${OWNER}`);
        }
      });

      test('leaves the grant of a role that only administers the read-only role', async function (assert) {
        const ADMINISTRATOR = 'administrator_for_incoming_webhooks_test';
        await createRole(ADMINISTRATOR);
        await dbAdapter.execute(
          `GRANT readonly_role TO ${ADMINISTRATOR} WITH ADMIN TRUE, INHERIT FALSE, SET FALSE`,
        );
        try {
          await dbAdapter.execute(
            `GRANT SELECT ON TABLE incoming_webhooks TO ${ADMINISTRATOR}`,
          );

          await runMigration('up');

          assert.deepEqual(
            await selectAs(
              ADMINISTRATOR,
              'SELECT COUNT(*) >= 0 AS readable FROM incoming_webhooks',
            ),
            [{ readable: true }],
            'the administrator keeps its own grant',
          );
        } finally {
          await dbAdapter.execute(`REVOKE readonly_role FROM ${ADMINISTRATOR}`);
        }
      });

      test('revokes a grant to a role that reaches the read-only role through another role, and down restores it', async function (assert) {
        const GROUP = 'readonly_group_for_incoming_webhooks_test';
        const GROUP_MEMBER = 'readonly_group_member_for_incoming_webhooks_test';
        await createRole(GROUP);
        await createRole(GROUP_MEMBER);
        await dbAdapter.execute(`GRANT readonly_role TO ${GROUP}`);
        await dbAdapter.execute(`GRANT ${GROUP} TO ${GROUP_MEMBER}`);
        await dbAdapter.execute(
          `GRANT SELECT ON TABLE incoming_webhooks TO ${GROUP_MEMBER}`,
        );
        let before = await tableGrants();

        await runMigration('up');
        await assert.rejects(
          selectAs(
            GROUP_MEMBER,
            'SELECT signing_secret_ciphertext FROM incoming_webhooks',
          ),
          /permission denied for table incoming_webhooks/,
          'the role reading through the group is denied',
        );

        await runMigration('down');
        assert.deepEqual(await tableGrants(), before);
      });

      test('restores a record that names no grantors as grants from the owner', async function (assert) {
        let before = await tableGrants();

        await runMigration('up');
        await dbAdapter.execute(
          `UPDATE readonly_role_revoked_select_grants
             SET grants = (
               SELECT jsonb_agg(revoked - 'grantor')
               FROM jsonb_array_elements(grants) revoked
             )
           WHERE table_name = 'incoming_webhooks'`,
        );
        await runMigration('down');

        assert.deepEqual(await tableGrants(), before);
      });

      test('skips a recorded role that was dropped before down', async function (assert) {
        await createRole(DROPPED_MEMBER);
        await dbAdapter.execute(`GRANT readonly_role TO ${DROPPED_MEMBER}`);
        await dbAdapter.execute(
          `GRANT SELECT ON TABLE incoming_webhooks TO ${DROPPED_MEMBER}`,
        );
        let before = (await tableGrants()).filter(
          ({ grantee }: { grantee: string }) => grantee !== DROPPED_MEMBER,
        );

        await runMigration('up');
        await dbAdapter.execute(`DROP OWNED BY ${DROPPED_MEMBER}`);
        await dbAdapter.execute(`DROP ROLE ${DROPPED_MEMBER}`);
        await runMigration('down');

        assert.deepEqual(await tableGrants(), before);
      });

      test("leaves the other sealing migration's record in place", async function (assert) {
        await runMigration('up');
        await dbAdapter.execute(
          `INSERT INTO readonly_role_revoked_select_grants (table_name, grants)
           VALUES ('proxy_endpoints', '[]'::jsonb)`,
        );

        await runMigration('down');

        assert.deepEqual(
          await dbAdapter.execute(
            `SELECT table_name FROM readonly_role_revoked_select_grants`,
          ),
          [{ table_name: 'proxy_endpoints' }],
        );
      });
    });
  });
});
