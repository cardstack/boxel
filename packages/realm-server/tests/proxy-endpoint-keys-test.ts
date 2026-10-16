import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename, dirname, join } from 'path';
import { createRequire } from 'module';
import { inspect } from 'util';
import { loggableBindings } from '@cardstack/runtime-common';
import { setupDB } from './helpers/index.ts';
import { logLinesDuring } from './helpers/log-capture.ts';
import {
  installSecretsKeyring,
  LocalKeyProvider,
  PLATFORM_SECRET_OWNER,
  reportPlaintextCensus,
  resetSecretsAtRest,
  SecretsKeyring,
  type SealedSecret,
} from '../lib/secrets-at-rest/index.ts';
import {
  PROXY_ENDPOINT_KEY_COLUMNS,
  PROXY_ENDPOINT_KEY_FIELD,
  proxyEndpointKeyBinding,
  saveProxyEndpoint,
  sealProxyEndpointKeys,
  type ProxyEndpointKeyRow,
} from '../lib/proxy-endpoint-keys.ts';
import { AllowedProxyDestinations } from '../lib/allowed-proxy-destinations.ts';

const require = createRequire(import.meta.url);
const SEAL_MIGRATION = join(
  dirname(require.resolve('@cardstack/postgres/package.json')),
  'migrations',
  '1791993196828_seal-proxy-endpoint-api-keys.js',
);

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_KEY = 'sk-or-v1-proxy-endpoint-keys-test';
const EXAMPLE_URL = 'https://api.example.com';
const EXAMPLE_KEY = 'example-api-key';

module(basename(import.meta.filename), function () {
  module('proxy endpoint keys', function (hooks) {
    let dbAdapter: any;
    let keyring: SecretsKeyring;

    setupDB(hooks, {
      beforeEach: async (_dbAdapter) => {
        dbAdapter = _dbAdapter;
        keyring = installSecretsKeyring(
          await new LocalKeyProvider().loadDataKeys(),
        );
        AllowedProxyDestinations.reset();
      },
      afterEach: async () => {
        AllowedProxyDestinations.reset();
        resetSecretsAtRest();
      },
    });

    // A row as an operator's hand-typed INSERT leaves it: plain text only.
    async function insertPlainTextRow(url: string, apiKey: string | null) {
      await dbAdapter.execute(
        `INSERT INTO proxy_endpoints (id, url, api_key, credit_strategy, supports_streaming, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, 'no-credit', false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        { bind: [url, apiKey] },
      );
    }

    async function keyRow(url: string): Promise<ProxyEndpointKeyRow> {
      let [row] = await dbAdapter.execute(
        `SELECT id, url, ${PROXY_ENDPOINT_KEY_COLUMNS} FROM proxy_endpoints WHERE url = $1`,
        { bind: [url] },
      );
      return row as unknown as ProxyEndpointKeyRow;
    }

    function sealedOf(row: ProxyEndpointKeyRow): SealedSecret {
      return {
        keyId: row.api_key_key_id!,
        nonce: Buffer.from(row.api_key_nonce!, 'base64'),
        ciphertext: Buffer.from(row.api_key_ciphertext!, 'base64'),
        tag: Buffer.from(row.api_key_tag!, 'base64'),
      };
    }

    async function censusLines(): Promise<string[]> {
      let lines = await logLinesDuring(['secrets-at-rest'], () =>
        reportPlaintextCensus(dbAdapter),
      );
      return lines
        .map(({ message }) => message)
        .filter((message) =>
          message.startsWith('plaintext census: proxy_endpoints.'),
        );
    }

    async function apiKeyServedFor(url: string) {
      AllowedProxyDestinations.reset();
      let config =
        await AllowedProxyDestinations.getInstance(
          dbAdapter,
        ).getDestinationConfig(url);
      return config?.apiKey;
    }

    test('the backfill seals a plain-text row under its binding, and the census reaches zero', async function (assert) {
      await insertPlainTextRow(OPENROUTER_URL, OPENROUTER_KEY);
      await insertPlainTextRow(EXAMPLE_URL, EXAMPLE_KEY);
      assert.deepEqual(await censusLines(), [
        'plaintext census: proxy_endpoints.api_key plaintextRows=2',
      ]);

      let result = await sealProxyEndpointKeys(dbAdapter);

      assert.deepEqual(result, {
        sealed: 2,
        cleared: 0,
        unchanged: 0,
        unloadedKey: 0,
        tampered: 0,
        skipped: 0,
      });
      let row = await keyRow(OPENROUTER_URL);
      assert.strictEqual(row.api_key_key_id, keyring.currentKeyId);
      assert.strictEqual(
        keyring.open(sealedOf(row), {
          field: PROXY_ENDPOINT_KEY_FIELD,
          owner: PLATFORM_SECRET_OWNER,
          id: row.id,
          destination: OPENROUTER_URL,
        }),
        OPENROUTER_KEY,
        'the sealed value opens to the key under its field, the platform owner, its id and its url',
      );
      assert.strictEqual(
        row.api_key,
        OPENROUTER_KEY,
        'the plain-text column is kept',
      );
      assert.deepEqual(await censusLines(), [
        'plaintext census: proxy_endpoints.api_key plaintextRows=0',
      ]);
      assert.strictEqual(await apiKeyServedFor(OPENROUTER_URL), OPENROUTER_KEY);
    });

    test('a second backfill changes nothing', async function (assert) {
      await insertPlainTextRow(OPENROUTER_URL, OPENROUTER_KEY);
      await insertPlainTextRow(EXAMPLE_URL, null);
      await sealProxyEndpointKeys(dbAdapter);
      let before = await keyRow(OPENROUTER_URL);

      let result = await sealProxyEndpointKeys(dbAdapter);

      assert.deepEqual(result, {
        sealed: 0,
        cleared: 0,
        unchanged: 2,
        unloadedKey: 0,
        tampered: 0,
        skipped: 0,
      });
      assert.deepEqual(
        await keyRow(OPENROUTER_URL),
        before,
        'the sealed columns are untouched',
      );
    });

    test('a row the backfill has not sealed is served from its plain-text key', async function (assert) {
      await insertPlainTextRow(OPENROUTER_URL, OPENROUTER_KEY);

      assert.strictEqual(await apiKeyServedFor(OPENROUTER_URL), OPENROUTER_KEY);
      assert.strictEqual(
        (await keyRow(OPENROUTER_URL)).api_key_ciphertext,
        null,
        'reading does not seal',
      );
    });

    test('a sealed key whose url was edited outside the application is served from its plain-text key, and the backfill reports it and leaves it for an operator', async function (assert) {
      await insertPlainTextRow(OPENROUTER_URL, OPENROUTER_KEY);
      await sealProxyEndpointKeys(dbAdapter);
      let movedUrl = 'https://openrouter.ai/api/v1/moved';
      await dbAdapter.execute(
        `UPDATE proxy_endpoints SET url = $1 WHERE url = $2`,
        { bind: [movedUrl, OPENROUTER_URL] },
      );

      let served: (string | undefined)[] = [];
      let lines = await logLinesDuring(['proxy-endpoint-keys'], async () => {
        served.push(await apiKeyServedFor(movedUrl));
        served.push(await apiKeyServedFor(movedUrl));
      });

      assert.deepEqual(served, [OPENROUTER_KEY, OPENROUTER_KEY]);
      let warnings = lines.filter(({ level }) => level === 'warn');
      assert.strictEqual(
        warnings.length,
        1,
        'the failure is reported once, not on every reload',
      );
      assert.true(warnings[0].message.includes(movedUrl));
      assert.false(
        warnings[0].message.includes(OPENROUTER_KEY),
        'the report never carries the key',
      );

      let edited = await keyRow(movedUrl);
      let result: Awaited<ReturnType<typeof sealProxyEndpointKeys>>;
      let backfillLines = await logLinesDuring(
        ['proxy-endpoint-keys'],
        async () => {
          result = await sealProxyEndpointKeys(dbAdapter);
        },
      );
      assert.strictEqual(result!.tampered, 1);
      assert.strictEqual(result!.sealed, 0);
      assert.deepEqual(
        await keyRow(movedUrl),
        edited,
        'the backfill does not seal the key to its new url',
      );
      let errors = backfillLines.filter(({ level }) => level === 'error');
      assert.strictEqual(errors.length, 1, 'the backfill reports the row');
      assert.true(errors[0].message.includes(movedUrl));
      assert.false(
        errors[0].message.includes(OPENROUTER_KEY),
        'the report never carries the key',
      );

      result = await sealProxyEndpointKeys(dbAdapter, undefined, {
        resealTampered: true,
      });
      assert.strictEqual(result.sealed, 1);
      let row = await keyRow(movedUrl);
      assert.strictEqual(
        keyring.open(sealedOf(row), proxyEndpointKeyBinding(row)),
        OPENROUTER_KEY,
        'an operator re-seals the key to its new url',
      );
    });

    test('the backfill leaves a key sealed under a data key this process has not loaded', async function (assert) {
      // Another task, further into a data-key rotation, sealed the row under
      // a key this one doesn't hold.
      let newer = new SecretsKeyring(
        [{ keyId: 'kms-newer', key: Buffer.alloc(32, 7) }],
        'kms-newer',
      );
      await insertPlainTextRow(OPENROUTER_URL, OPENROUTER_KEY);
      await saveProxyEndpoint(
        dbAdapter,
        {
          url: OPENROUTER_URL,
          apiKey: OPENROUTER_KEY,
          creditStrategy: 'no-credit',
          supportsStreaming: false,
        },
        newer,
      );
      let before = await keyRow(OPENROUTER_URL);

      let result = await sealProxyEndpointKeys(dbAdapter);

      assert.strictEqual(result.unloadedKey, 1);
      assert.strictEqual(result.sealed, 0);
      assert.deepEqual(await keyRow(OPENROUTER_URL), before);
      assert.strictEqual(
        await apiKeyServedFor(OPENROUTER_URL),
        OPENROUTER_KEY,
        'this process serves the plain-text key meanwhile',
      );
    });

    test('a key whose plain text was edited outside the application is served at once, and the backfill reports it and leaves it for an operator', async function (assert) {
      await insertPlainTextRow(OPENROUTER_URL, OPENROUTER_KEY);
      await sealProxyEndpointKeys(dbAdapter);
      await dbAdapter.execute(
        `UPDATE proxy_endpoints SET api_key = 'sk-or-v1-edited-by-hand' WHERE url = $1`,
        { bind: [OPENROUTER_URL] },
      );

      let served: string | undefined;
      let lines = await logLinesDuring(['proxy-endpoint-keys'], async () => {
        served = await apiKeyServedFor(OPENROUTER_URL);
      });
      assert.strictEqual(
        served,
        'sk-or-v1-edited-by-hand',
        'the edit reaches the proxy without waiting for the backfill',
      );
      let warnings = lines.filter(({ level }) => level === 'warn');
      assert.strictEqual(warnings.length, 1, 'the disagreement is reported');
      assert.false(warnings[0].message.includes('sk-or-v1-edited-by-hand'));
      assert.false(warnings[0].message.includes(OPENROUTER_KEY));

      let edited = await keyRow(OPENROUTER_URL);
      let result = await sealProxyEndpointKeys(dbAdapter);

      assert.strictEqual(result.tampered, 1);
      assert.strictEqual(result.sealed, 0);
      assert.deepEqual(await keyRow(OPENROUTER_URL), edited);

      result = await sealProxyEndpointKeys(dbAdapter, undefined, {
        resealTampered: true,
      });
      assert.strictEqual(result.sealed, 1);
      let row = await keyRow(OPENROUTER_URL);
      assert.strictEqual(
        keyring.open(sealedOf(row), proxyEndpointKeyBinding(row)),
        'sk-or-v1-edited-by-hand',
      );
    });

    test('a process sealing with another data key reports a key sealed under the public local development key and leaves it for an operator', async function (assert) {
      await insertPlainTextRow(OPENROUTER_URL, OPENROUTER_KEY);
      await sealProxyEndpointKeys(dbAdapter);
      assert.strictEqual(
        (await keyRow(OPENROUTER_URL)).api_key_key_id,
        'local-development',
      );
      let deployed = new SecretsKeyring(
        [{ keyId: 'kms-deployed', key: Buffer.alloc(32, 9) }],
        'kms-deployed',
      );
      let before = await keyRow(OPENROUTER_URL);

      let result = await sealProxyEndpointKeys(dbAdapter, deployed);

      assert.strictEqual(result.tampered, 1);
      assert.strictEqual(result.sealed, 0);
      assert.deepEqual(await keyRow(OPENROUTER_URL), before);

      result = await sealProxyEndpointKeys(dbAdapter, deployed, {
        resealTampered: true,
      });
      assert.strictEqual(result.sealed, 1);
      assert.strictEqual(result.unloadedKey, 0);
      let row = await keyRow(OPENROUTER_URL);
      assert.strictEqual(row.api_key_key_id, 'kms-deployed');
      assert.strictEqual(
        deployed.open(sealedOf(row), proxyEndpointKeyBinding(row)),
        OPENROUTER_KEY,
      );
    });

    test('the backfill empties the sealed columns of a row with no plain-text key', async function (assert) {
      await insertPlainTextRow(OPENROUTER_URL, OPENROUTER_KEY);
      await sealProxyEndpointKeys(dbAdapter);
      await dbAdapter.execute(
        `UPDATE proxy_endpoints SET api_key = NULL WHERE url = $1`,
        { bind: [OPENROUTER_URL] },
      );

      let result = await sealProxyEndpointKeys(dbAdapter);

      assert.strictEqual(result.cleared, 1);
      let row = await keyRow(OPENROUTER_URL);
      assert.strictEqual(row.api_key_ciphertext, null);
      assert.strictEqual(row.api_key_nonce, null);
      assert.strictEqual(row.api_key_tag, null);
      assert.strictEqual(row.api_key_key_id, null);
    });

    test('the backfill leaves a row that changed after it was read', async function (assert) {
      await insertPlainTextRow(OPENROUTER_URL, OPENROUTER_KEY);
      // Another writer saves a new key between the backfill's read and its
      // update.
      let execute = dbAdapter.execute.bind(dbAdapter);
      let interleaved = false;
      let racing = Object.create(dbAdapter);
      racing.execute = async (sql: string, opts?: any) => {
        if (!interleaved && sql.trimStart().startsWith('UPDATE')) {
          interleaved = true;
          await saveProxyEndpoint(dbAdapter, {
            url: OPENROUTER_URL,
            apiKey: 'sk-or-v1-saved-concurrently',
            creditStrategy: 'no-credit',
            supportsStreaming: false,
          });
        }
        return execute(sql, opts);
      };

      let result = await sealProxyEndpointKeys(racing);

      assert.strictEqual(result.skipped, 1);
      assert.strictEqual(
        await apiKeyServedFor(OPENROUTER_URL),
        'sk-or-v1-saved-concurrently',
        "the concurrent write's sealed key stands",
      );
    });

    test('saving an endpoint writes its sealed key and its plain-text key together', async function (assert) {
      let id = await saveProxyEndpoint(dbAdapter, {
        url: OPENROUTER_URL,
        apiKey: OPENROUTER_KEY,
        creditStrategy: 'openrouter',
        supportsStreaming: true,
      });
      let row = await keyRow(OPENROUTER_URL);
      assert.strictEqual(row.id, id);
      assert.strictEqual(row.api_key, OPENROUTER_KEY);
      assert.strictEqual(
        keyring.open(sealedOf(row), proxyEndpointKeyBinding(row)),
        OPENROUTER_KEY,
      );

      let replacedId = await saveProxyEndpoint(dbAdapter, {
        url: OPENROUTER_URL,
        apiKey: 'sk-or-v1-replacement',
        creditStrategy: 'openrouter',
        supportsStreaming: true,
      });

      assert.strictEqual(replacedId, id, 'replacing keeps the row');
      let replaced = await keyRow(OPENROUTER_URL);
      assert.strictEqual(replaced.api_key, 'sk-or-v1-replacement');
      assert.strictEqual(
        keyring.open(sealedOf(replaced), proxyEndpointKeyBinding(replaced)),
        'sk-or-v1-replacement',
      );
      assert.strictEqual(
        (await sealProxyEndpointKeys(dbAdapter)).unchanged,
        1,
        'a saved row needs no backfill',
      );
      assert.strictEqual(
        await apiKeyServedFor(OPENROUTER_URL),
        'sk-or-v1-replacement',
      );
    });

    test('a key in a statement that fails never reaches the error or its log', async function (assert) {
      let secret = 'sk-or-v1-never-logged';
      let logged: string[] = [];
      let originalConsoleError = console.error;
      console.error = (...args: unknown[]) => {
        logged.push(args.map((arg) => inspect(arg, { depth: 10 })).join(' '));
      };
      let thrown: unknown;
      try {
        // A missing credit strategy violates its NOT NULL constraint, and
        // Postgres quotes the whole failing row in the error.
        await saveProxyEndpoint(dbAdapter, {
          url: OPENROUTER_URL,
          apiKey: secret,
          creditStrategy: null as unknown as string,
          supportsStreaming: false,
        });
      } catch (e) {
        thrown = e;
      } finally {
        console.error = originalConsoleError;
      }

      assert.ok(thrown, 'the statement fails');
      assert.true(
        /null value in column "credit_strategy"/.test(String(thrown)),
        String(thrown),
      );
      assert.false(
        inspect(thrown, { depth: 10 }).includes(secret),
        'the error carries no key',
      );
      assert.true(logged.length > 0, 'the failure is logged');
      assert.false(
        logged.some((line) => line.includes(secret)),
        'the log carries no key',
      );
    });

    test('a saved key never appears in the bindings a statement logs', function (assert) {
      assert.strictEqual(
        loggableBindings({ bind: ['sk-secret'], redactBindings: true }),
        '[redacted]',
      );
      assert.strictEqual(loggableBindings({ bind: ['a', 1] }), '["a",1]');
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
           CREATE ROLE readonly_member_for_proxy_endpoints_test;
         EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL;
         END
         $$`,
      );
      await dbAdapter.execute(
        `GRANT readonly_role TO readonly_member_for_proxy_endpoints_test`,
      );
      await dbAdapter.execute(
        `GRANT SELECT ON TABLE proxy_endpoints TO readonly_member_for_proxy_endpoints_test`,
      );
      let statements: string[] = [];
      require(SEAL_MIGRATION).up({
        sql: (statement: string) => statements.push(statement),
      });
      for (let statement of statements) {
        await dbAdapter.execute(statement);
      }
      await insertPlainTextRow(OPENROUTER_URL, OPENROUTER_KEY);

      async function selectAsReadOnly(sql: string, role = 'readonly_role') {
        return await dbAdapter.withTransaction(async (query: any) => {
          await query([`SET LOCAL ROLE ${role}`]);
          return await query([sql]);
        });
      }

      await assert.rejects(
        selectAsReadOnly('SELECT api_key FROM proxy_endpoints'),
        /permission denied for table proxy_endpoints/,
      );
      await assert.rejects(
        selectAsReadOnly('SELECT url FROM proxy_endpoints'),
        /permission denied for table proxy_endpoints/,
      );
      await assert.rejects(
        selectAsReadOnly(
          'SELECT api_key FROM proxy_endpoints',
          'readonly_member_for_proxy_endpoints_test',
        ),
        /permission denied for table proxy_endpoints/,
        'a member granted SELECT directly is denied too',
      );
      assert.deepEqual(
        await selectAsReadOnly('SELECT COUNT(*) >= 0 AS readable FROM plans'),
        [{ readable: true }],
        'the role keeps reading other tables',
      );
    });
  });
});
