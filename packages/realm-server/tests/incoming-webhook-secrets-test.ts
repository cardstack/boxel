import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename, dirname, join } from 'path';
import { createRequire } from 'module';
import { inspect } from 'util';
import { setupDB } from './helpers/index.ts';
import { logLinesDuring } from './helpers/log-capture.ts';
import {
  installSecretsKeyring,
  LocalKeyProvider,
  reportPlaintextCensus,
  resetSecretsAtRest,
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
  sealIncomingWebhookSecrets,
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

    // A row as a server running the previous revision writes it: plain text
    // only, with no record of when the secret was issued.
    async function insertPlainTextRow(id: string, signingSecret: string) {
      await dbAdapter.execute(
        `INSERT INTO incoming_webhooks (id, username, webhook_path, verification_type, verification_config, signing_secret, created_at, updated_at)
         VALUES ($1, $2, $3, 'HMAC_SHA256_HEADER', '{"header": "X-Hub-Signature-256", "encoding": "hex"}'::jsonb, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        { bind: [id, OWNER, `whk_${id}`, signingSecret] },
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

    async function censusLine(): Promise<string | undefined> {
      let lines = await logLinesDuring(['secrets-at-rest'], () =>
        reportPlaintextCensus(dbAdapter),
      );
      return lines
        .map(({ message }) => message)
        .find((message) =>
          message.startsWith('plaintext census: incoming_webhooks'),
        );
    }

    test('the backfill seals a plain-text row under its binding, and the census reaches zero', async function (assert) {
      await insertPlainTextRow(FIRST_ID, FIRST_SECRET);
      await insertPlainTextRow(SECOND_ID, SECOND_SECRET);
      assert.strictEqual(
        await censusLine(),
        'plaintext census: incoming_webhooks.signing_secret plaintextRows=2',
      );

      let result = await sealIncomingWebhookSecrets(dbAdapter);

      assert.deepEqual(result, {
        sealed: 2,
        unchanged: 0,
        unloadedKey: 0,
        skipped: 0,
      });
      let row = await secretRow(FIRST_ID);
      assert.strictEqual(row.signing_secret_key_id, keyring.currentKeyId);
      assert.strictEqual(
        keyring.open(sealedFromColumns({ ...row }, 'signing_secret')!, {
          field: INCOMING_WEBHOOK_SECRET_FIELD,
          owner: OWNER,
          id: FIRST_ID,
        }),
        FIRST_SECRET,
        'the sealed value opens to the secret under its field, its owner and its id',
      );
      assert.strictEqual(
        row.signing_secret,
        FIRST_SECRET,
        'the plain-text column is kept',
      );
      assert.strictEqual(
        await censusLine(),
        'plaintext census: incoming_webhooks.signing_secret plaintextRows=0',
      );
      assert.strictEqual(readIncomingWebhookSecret(row), FIRST_SECRET);
    });

    test('a second backfill changes nothing', async function (assert) {
      await insertPlainTextRow(FIRST_ID, FIRST_SECRET);
      await sealIncomingWebhookSecrets(dbAdapter);
      let before = await secretRow(FIRST_ID);

      let result = await sealIncomingWebhookSecrets(dbAdapter);

      assert.deepEqual(result, {
        sealed: 0,
        unchanged: 1,
        unloadedKey: 0,
        skipped: 0,
      });
      assert.deepEqual(
        await secretRow(FIRST_ID),
        before,
        'the sealed columns are untouched',
      );
    });

    test('a row the backfill has not sealed is read from its plain-text secret', async function (assert) {
      await insertPlainTextRow(FIRST_ID, FIRST_SECRET);

      let row = await secretRow(FIRST_ID);
      assert.strictEqual(readIncomingWebhookSecret(row), FIRST_SECRET);
      assert.strictEqual(
        (await secretRow(FIRST_ID)).signing_secret_ciphertext,
        null,
        'reading does not seal',
      );
    });

    test('a sealed secret that does not open is reported and read from plain text, and the backfill seals it again', async function (assert) {
      await insertPlainTextRow(FIRST_ID, FIRST_SECRET);
      await sealIncomingWebhookSecrets(dbAdapter);
      let newOwner = '@new-owner:localhost';
      await dbAdapter.execute(
        `UPDATE incoming_webhooks SET username = $1 WHERE id = $2`,
        { bind: [newOwner, FIRST_ID] },
      );

      let read: string[] = [];
      let lines = await logLinesDuring(
        ['incoming-webhook-secrets'],
        async () => {
          read.push(readIncomingWebhookSecret(await secretRow(FIRST_ID)));
          read.push(readIncomingWebhookSecret(await secretRow(FIRST_ID)));
        },
      );

      assert.deepEqual(read, [FIRST_SECRET, FIRST_SECRET]);
      let warnings = lines.filter(({ level }) => level === 'warn');
      assert.strictEqual(
        warnings.length,
        1,
        'the failure is reported once, not on every delivery',
      );
      assert.true(warnings[0].message.includes(FIRST_ID));
      assert.false(
        warnings[0].message.includes(FIRST_SECRET),
        'the report never carries the secret',
      );

      let result = await sealIncomingWebhookSecrets(dbAdapter);
      assert.strictEqual(result.sealed, 1);
      let row = await secretRow(FIRST_ID);
      assert.strictEqual(row.username, newOwner);
      assert.strictEqual(
        openedFrom(row),
        FIRST_SECRET,
        'the secret is sealed to its new owner',
      );
    });

    test('a secret whose plain text was edited outside the application is read at once, and the backfill seals it again', async function (assert) {
      await insertPlainTextRow(FIRST_ID, FIRST_SECRET);
      await sealIncomingWebhookSecrets(dbAdapter);
      await dbAdapter.execute(
        `UPDATE incoming_webhooks SET signing_secret = 'edited-by-hand' WHERE id = $1`,
        { bind: [FIRST_ID] },
      );

      let read: string | undefined;
      let lines = await logLinesDuring(
        ['incoming-webhook-secrets'],
        async () => {
          read = readIncomingWebhookSecret(await secretRow(FIRST_ID));
        },
      );
      assert.strictEqual(read, 'edited-by-hand');
      let warnings = lines.filter(({ level }) => level === 'warn');
      assert.strictEqual(warnings.length, 1, 'the disagreement is reported');
      assert.false(warnings[0].message.includes('edited-by-hand'));
      assert.false(warnings[0].message.includes(FIRST_SECRET));

      let result = await sealIncomingWebhookSecrets(dbAdapter);

      assert.strictEqual(result.sealed, 1);
      assert.strictEqual(
        openedFrom(await secretRow(FIRST_ID)),
        'edited-by-hand',
      );
    });

    test('the backfill leaves a secret sealed under a data key this process has not loaded', async function (assert) {
      // Another task, further into a data-key rotation, sealed the row under
      // a key this one doesn't hold.
      let newer = new SecretsKeyring(
        [{ keyId: 'kms-newer', key: Buffer.alloc(32, 7) }],
        'kms-newer',
      );
      await insertPlainTextRow(FIRST_ID, FIRST_SECRET);
      await sealIncomingWebhookSecrets(dbAdapter, newer);
      let before = await secretRow(FIRST_ID);

      let result = await sealIncomingWebhookSecrets(dbAdapter);

      assert.strictEqual(result.unloadedKey, 1);
      assert.strictEqual(result.sealed, 0);
      assert.deepEqual(await secretRow(FIRST_ID), before);
      assert.strictEqual(
        readIncomingWebhookSecret(before),
        FIRST_SECRET,
        'this process reads the plain-text secret meanwhile',
      );
    });

    test('a process sealing with another data key seals again a secret sealed under the public local development key', async function (assert) {
      await insertPlainTextRow(FIRST_ID, FIRST_SECRET);
      await sealIncomingWebhookSecrets(dbAdapter);
      assert.strictEqual(
        (await secretRow(FIRST_ID)).signing_secret_key_id,
        'local-development',
      );
      let deployed = new SecretsKeyring(
        [{ keyId: 'kms-deployed', key: Buffer.alloc(32, 9) }],
        'kms-deployed',
      );

      let result = await sealIncomingWebhookSecrets(dbAdapter, deployed);

      assert.strictEqual(result.sealed, 1);
      assert.strictEqual(result.unloadedKey, 0);
      let row = await secretRow(FIRST_ID);
      assert.strictEqual(row.signing_secret_key_id, 'kms-deployed');
      assert.strictEqual(openedFrom(row, deployed), FIRST_SECRET);
    });

    test('the backfill leaves a row whose secret was rotated after it was read', async function (assert) {
      await insertPlainTextRow(FIRST_ID, FIRST_SECRET);
      let execute = dbAdapter.execute.bind(dbAdapter);
      let rotatedSecret: string | undefined;
      let racing = Object.create(dbAdapter);
      racing.execute = async (sql: string, opts?: any) => {
        if (!rotatedSecret && sql.trimStart().startsWith('UPDATE')) {
          rotatedSecret = (
            await rotateIncomingWebhookSecret(dbAdapter, {
              id: FIRST_ID,
              username: OWNER,
            })
          )?.signingSecret;
        }
        return execute(sql, opts);
      };

      let result = await sealIncomingWebhookSecrets(racing);

      assert.strictEqual(result.skipped, 1);
      let row = await secretRow(FIRST_ID);
      assert.strictEqual(row.signing_secret, rotatedSecret);
      assert.strictEqual(
        openedFrom(row),
        rotatedSecret,
        "the rotation's sealed secret stands",
      );
    });

    test('registering and rotating write the sealed secret and the plain-text secret together', async function (assert) {
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
      assert.strictEqual(row.signing_secret, signingSecret);
      assert.strictEqual(openedFrom(row), signingSecret);

      let rotated = await rotateIncomingWebhookSecret(dbAdapter, {
        id: FIRST_ID,
        username: OWNER,
      });

      assert.ok(rotated);
      assert.notStrictEqual(rotated!.signingSecret, signingSecret);
      let rotatedRow = await secretRow(FIRST_ID);
      assert.strictEqual(rotatedRow.signing_secret, rotated!.signingSecret);
      assert.strictEqual(openedFrom(rotatedRow), rotated!.signingSecret);
      assert.strictEqual(
        (await sealIncomingWebhookSecrets(dbAdapter)).unchanged,
        1,
        'a written row needs no backfill',
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

    test('a secret in a statement that fails never reaches the error or its log', async function (assert) {
      await insertPlainTextRow(FIRST_ID, FIRST_SECRET);
      let logged: string[] = [];
      let originalConsoleError = console.error;
      console.error = (...args: unknown[]) => {
        logged.push(args.map((arg) => inspect(arg, { depth: 10 })).join(' '));
      };
      let thrown: unknown;
      let issued: string[] = [];
      let recording = Object.create(dbAdapter);
      recording.execute = async (sql: string, opts?: any) => {
        issued.push(...(opts?.bind ?? []).map(String));
        return dbAdapter.execute(sql, opts);
      };
      try {
        // The webhook path is unique, and Postgres quotes the failing key in
        // the error.
        await insertIncomingWebhook(
          recording,
          {
            username: OWNER,
            webhookPath: `whk_${FIRST_ID}`,
            verificationType: 'HMAC_SHA256_HEADER',
            verificationConfig: {},
          },
          { id: SECOND_ID },
        );
      } catch (e) {
        thrown = e;
      } finally {
        console.error = originalConsoleError;
      }

      assert.ok(thrown, 'the statement fails');
      let secret = issued[5];
      assert.ok(secret, 'the statement carried a secret');
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
      await insertPlainTextRow(FIRST_ID, FIRST_SECRET);

      async function selectAsReadOnly(sql: string, role = 'readonly_role') {
        return await dbAdapter.withTransaction(async (query: any) => {
          await query([`SET LOCAL ROLE ${role}`]);
          return await query([sql]);
        });
      }

      await assert.rejects(
        selectAsReadOnly('SELECT signing_secret FROM incoming_webhooks'),
        /permission denied for table incoming_webhooks/,
      );
      await assert.rejects(
        selectAsReadOnly('SELECT webhook_path FROM incoming_webhooks'),
        /permission denied for table incoming_webhooks/,
      );
      await assert.rejects(
        selectAsReadOnly(
          'SELECT signing_secret FROM incoming_webhooks',
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
      await insertPlainTextRow(FIRST_ID, FIRST_SECRET);
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
  });
});
