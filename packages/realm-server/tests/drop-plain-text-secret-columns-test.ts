import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename, dirname, join } from 'path';
import { createRequire } from 'module';
import { insertIncomingWebhookRow, setupDB } from './helpers/index.ts';
import {
  installSecretsKeyring,
  LocalKeyProvider,
  resetSecretsAtRest,
} from '../lib/secrets-at-rest/index.ts';
import {
  PROXY_ENDPOINT_KEY_COLUMNS,
  readProxyEndpointKey,
  saveProxyEndpoint,
  type ProxyEndpointKeyRow,
} from '../lib/proxy-endpoint-keys.ts';
import {
  INCOMING_WEBHOOK_SECRET_COLUMNS,
  readIncomingWebhookSecret,
  type IncomingWebhookSecretRow,
} from '../lib/incoming-webhook-secrets.ts';

const require = createRequire(import.meta.url);
const DROP_MIGRATION = join(
  dirname(require.resolve('@cardstack/postgres/package.json')),
  'migrations-removal',
  '1792425967224_drop-plain-text-secret-columns.js',
);

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OWNER = '@webhook-owner:localhost';

module(basename(import.meta.filename), function () {
  module('dropping the plain-text secret columns', function (hooks) {
    let dbAdapter: any;

    setupDB(hooks, {
      beforeEach: async (_dbAdapter) => {
        dbAdapter = _dbAdapter;
        installSecretsKeyring(await new LocalKeyProvider().loadDataKeys());
      },
      afterEach: async () => {
        resetSecretsAtRest();
      },
    });

    async function runMigration(direction: 'up' | 'down') {
      let statements: string[] = [];
      require(DROP_MIGRATION)[direction]({
        sql: (statement: string) => statements.push(statement),
      });
      for (let statement of statements) {
        await dbAdapter.execute(statement);
      }
    }

    async function plainTextColumns(): Promise<string[]> {
      let rows = await dbAdapter.execute(
        `SELECT table_name || '.' || column_name AS name
         FROM information_schema.columns
         WHERE (table_name = 'proxy_endpoints' AND column_name = 'api_key')
            OR (table_name = 'incoming_webhooks'
                AND column_name = 'signing_secret')
         ORDER BY name`,
      );
      return rows.map((row: { name: string }) => row.name);
    }

    test('drops both columns, and down restores them empty', async function (assert) {
      assert.deepEqual(await plainTextColumns(), [], 'the schema has neither');

      await runMigration('down');
      assert.deepEqual(await plainTextColumns(), [
        'incoming_webhooks.signing_secret',
        'proxy_endpoints.api_key',
      ]);

      await runMigration('up');
      assert.deepEqual(await plainTextColumns(), []);

      await runMigration('up');
      assert.deepEqual(await plainTextColumns(), [], 'a second up is a no-op');
    });

    test('a sealed key and secret survive the drop, with their plain-text copies alongside', async function (assert) {
      await runMigration('down');
      await saveProxyEndpoint(dbAdapter, {
        url: OPENROUTER_URL,
        apiKey: 'sk-or-v1-survives-the-drop',
        creditStrategy: 'openrouter',
        supportsStreaming: true,
      });
      await insertIncomingWebhookRow(dbAdapter, {
        username: OWNER,
        webhookPath: 'whk_survives',
        signingSecret: 'survives-the-drop',
      });
      // The rows as deployed databases hold them when the drop runs: the
      // plain-text copy kept in step beside the sealed value.
      await dbAdapter.execute(
        `UPDATE proxy_endpoints SET api_key = 'sk-or-v1-survives-the-drop'`,
      );
      await dbAdapter.execute(
        `UPDATE incoming_webhooks SET signing_secret = 'survives-the-drop'`,
      );

      await runMigration('up');

      assert.deepEqual(
        await plainTextColumns(),
        [],
        'both columns are dropped',
      );

      let [row] = await dbAdapter.execute(
        `SELECT id, url, ${PROXY_ENDPOINT_KEY_COLUMNS} FROM proxy_endpoints`,
      );
      assert.strictEqual(
        readProxyEndpointKey(row as unknown as ProxyEndpointKeyRow),
        'sk-or-v1-survives-the-drop',
      );
      let [webhook] = await dbAdapter.execute(
        `SELECT id, username, ${INCOMING_WEBHOOK_SECRET_COLUMNS} FROM incoming_webhooks`,
      );
      assert.strictEqual(
        readIncomingWebhookSecret(
          webhook as unknown as IncomingWebhookSecretRow,
        ),
        'survives-the-drop',
      );
    });

    test('stops rather than drop a key held only in plain text', async function (assert) {
      await runMigration('down');
      await dbAdapter.execute(
        `INSERT INTO proxy_endpoints (id, url, api_key, credit_strategy, supports_streaming, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, 'sk-or-v1-unsealed', 'openrouter', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        { bind: [OPENROUTER_URL] },
      );

      await assert.rejects(
        runMigration('up'),
        /proxy_endpoints has 1 row\(s\) whose api_key is not sealed/,
      );
      assert.deepEqual(
        await plainTextColumns(),
        ['incoming_webhooks.signing_secret', 'proxy_endpoints.api_key'],
        'nothing is dropped',
      );

      // Replacing the key seals it, and the drop goes ahead.
      await saveProxyEndpoint(dbAdapter, {
        url: OPENROUTER_URL,
        apiKey: 'sk-or-v1-unsealed',
        creditStrategy: 'openrouter',
        supportsStreaming: true,
      });
      await runMigration('up');
      assert.deepEqual(await plainTextColumns(), []);
    });

    test('stops rather than drop a key whose sealed value is missing a part', async function (assert) {
      await runMigration('down');
      await saveProxyEndpoint(dbAdapter, {
        url: OPENROUTER_URL,
        apiKey: 'sk-or-v1-partly-sealed',
        creditStrategy: 'openrouter',
        supportsStreaming: true,
      });
      await dbAdapter.execute(
        `UPDATE proxy_endpoints SET api_key = 'sk-or-v1-partly-sealed', api_key_nonce = NULL`,
      );

      await assert.rejects(
        runMigration('up'),
        /proxy_endpoints has 1 row\(s\) whose api_key is not sealed/,
      );
    });

    test('stops rather than drop a signing secret held only in plain text', async function (assert) {
      await runMigration('down');
      await dbAdapter.execute(
        `INSERT INTO incoming_webhooks (id, username, webhook_path, verification_type, verification_config, signing_secret, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, 'whk_unsealed', 'HMAC_SHA256_HEADER', '{}'::jsonb, 'unsealed-secret', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        { bind: [OWNER] },
      );

      await assert.rejects(
        runMigration('up'),
        /incoming_webhooks has 1 row\(s\) whose signing_secret is not sealed/,
      );
      assert.deepEqual(
        await plainTextColumns(),
        ['incoming_webhooks.signing_secret', 'proxy_endpoints.api_key'],
        'nothing is dropped',
      );
    });
  });
});
