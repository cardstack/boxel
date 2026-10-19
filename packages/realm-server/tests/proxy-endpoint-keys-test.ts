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

    module('the migration down', function (hooks) {
      const DIRECT_MEMBER = 'readonly_direct_member_for_proxy_endpoints_test';
      const INHERITING_MEMBER =
        'readonly_inheriting_member_for_proxy_endpoints_test';
      const OUTSIDER = 'outsider_for_proxy_endpoints_test';
      const COLUMN_MEMBER = 'readonly_column_member_for_proxy_endpoints_test';
      const DELEGATOR = 'delegator_for_proxy_endpoints_test';
      const DELEGATED_MEMBER =
        'readonly_delegated_member_for_proxy_endpoints_test';
      // Sorts ahead of the member that grants to it, so down() reaches its
      // grant before the member holds the grant option again.
      const RECIPIENT = 'a_recipient_for_proxy_endpoints_test';
      const DROPPED_MEMBER = 'readonly_dropped_member_for_proxy_endpoints_test';

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
           WHERE tbl.oid = 'proxy_endpoints'::regclass
           UNION ALL
           SELECT col.attname::text, grantee_role.rolname, grantor_role.rolname,
             acl.privilege_type, acl.is_grantable
           FROM pg_attribute col
           CROSS JOIN LATERAL aclexplode(col.attacl) acl
           JOIN pg_roles grantee_role ON grantee_role.oid = acl.grantee
           JOIN pg_roles grantor_role ON grantor_role.oid = acl.grantor
           WHERE col.attrelid = 'proxy_endpoints'::regclass
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
          `GRANT SELECT ON TABLE proxy_endpoints TO ${DIRECT_MEMBER} WITH GRANT OPTION`,
        );
        await dbAdapter.execute(
          `REVOKE SELECT ON TABLE proxy_endpoints FROM ${INHERITING_MEMBER}`,
        );
        await dbAdapter.execute(
          `GRANT SELECT ON TABLE proxy_endpoints TO ${OUTSIDER}`,
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
          `REVOKE SELECT ON TABLE proxy_endpoints FROM readonly_role`,
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
          `GRANT SELECT (id) ON TABLE proxy_endpoints TO ${COLUMN_MEMBER} WITH GRANT OPTION`,
        );
        await dbAdapter.execute(
          `GRANT SELECT (url) ON TABLE proxy_endpoints TO ${COLUMN_MEMBER}`,
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
          `GRANT SELECT ON TABLE proxy_endpoints TO ${DELEGATOR} WITH GRANT OPTION`,
        );
        await dbAdapter.withTransaction(async (query: any) => {
          await query([`SET LOCAL ROLE ${DELEGATOR}`]);
          await query([
            `GRANT SELECT ON TABLE proxy_endpoints TO ${DELEGATED_MEMBER}`,
          ]);
        });
        let before = await tableGrants();

        await runMigration('up');
        await assert.rejects(
          selectAs(DELEGATED_MEMBER, 'SELECT api_key FROM proxy_endpoints'),
          /permission denied for table proxy_endpoints/,
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
            `GRANT SELECT ON TABLE proxy_endpoints TO ${RECIPIENT}`,
          ]);
        });
        let before = await tableGrants();

        await runMigration('up');
        await assert.rejects(
          selectAs(DIRECT_MEMBER, 'SELECT api_key FROM proxy_endpoints'),
          /permission denied for table proxy_endpoints/,
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
          'readonly_column_recipient_for_proxy_endpoints_test';
        await createRole(COLUMN_RECIPIENT);
        await dbAdapter.execute(`GRANT readonly_role TO ${COLUMN_RECIPIENT}`);
        await dbAdapter.withTransaction(async (query: any) => {
          await query([`SET LOCAL ROLE ${DIRECT_MEMBER}`]);
          await query([
            `GRANT SELECT (id) ON TABLE proxy_endpoints TO ${COLUMN_RECIPIENT}`,
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
        const MEMBER = 'zz_inheriting_grantor_for_proxy_endpoints_test';
        const RECIPIENT_OF_MEMBER = 'x_recipient_for_proxy_endpoints_test';
        await createRole(MEMBER);
        await createRole(RECIPIENT_OF_MEMBER);
        await dbAdapter.execute(`GRANT readonly_role TO ${MEMBER}`);
        await dbAdapter.execute(
          `REVOKE readonly_role FROM ${RECIPIENT_OF_MEMBER}`,
        );
        await dbAdapter.execute(
          `GRANT SELECT ON TABLE proxy_endpoints TO readonly_role WITH GRANT OPTION`,
        );
        await dbAdapter.execute(
          `GRANT SELECT ON TABLE proxy_endpoints TO ${MEMBER} WITH GRANT OPTION`,
        );
        await dbAdapter.withTransaction(async (query: any) => {
          await query([`SET LOCAL ROLE ${MEMBER}`]);
          await query([
            `GRANT SELECT ON TABLE proxy_endpoints TO ${RECIPIENT_OF_MEMBER}`,
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
        const OWNER = 'admin_owner_for_proxy_endpoints_test';
        await createRole(OWNER);
        await dbAdapter.execute(
          `ALTER TABLE proxy_endpoints OWNER TO ${OWNER}`,
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
        const OWNER = 'reading_owner_for_proxy_endpoints_test';
        await createRole(OWNER);
        await dbAdapter.execute(
          `ALTER TABLE proxy_endpoints OWNER TO ${OWNER}`,
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
        const ADMINISTRATOR = 'administrator_for_proxy_endpoints_test';
        await createRole(ADMINISTRATOR);
        await dbAdapter.execute(
          `GRANT readonly_role TO ${ADMINISTRATOR} WITH ADMIN TRUE, INHERIT FALSE, SET FALSE`,
        );
        try {
          await dbAdapter.execute(
            `GRANT SELECT ON TABLE proxy_endpoints TO ${ADMINISTRATOR}`,
          );

          await runMigration('up');

          assert.deepEqual(
            await selectAs(
              ADMINISTRATOR,
              'SELECT COUNT(*) >= 0 AS readable FROM proxy_endpoints',
            ),
            [{ readable: true }],
            'the administrator keeps its own grant',
          );
        } finally {
          await dbAdapter.execute(`REVOKE readonly_role FROM ${ADMINISTRATOR}`);
        }
      });

      test('revokes a grant to a role that reaches the read-only role through another role, and down restores it', async function (assert) {
        const GROUP = 'readonly_group_for_proxy_endpoints_test';
        const GROUP_MEMBER = 'readonly_group_member_for_proxy_endpoints_test';
        await createRole(GROUP);
        await createRole(GROUP_MEMBER);
        await dbAdapter.execute(`GRANT readonly_role TO ${GROUP}`);
        await dbAdapter.execute(`GRANT ${GROUP} TO ${GROUP_MEMBER}`);
        await dbAdapter.execute(
          `GRANT SELECT ON TABLE proxy_endpoints TO ${GROUP_MEMBER}`,
        );
        let before = await tableGrants();

        await runMigration('up');
        await assert.rejects(
          selectAs(GROUP_MEMBER, 'SELECT api_key FROM proxy_endpoints'),
          /permission denied for table proxy_endpoints/,
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
           WHERE table_name = 'proxy_endpoints'`,
        );
        await runMigration('down');

        assert.deepEqual(await tableGrants(), before);
      });

      test('skips a recorded role that was dropped before down', async function (assert) {
        await createRole(DROPPED_MEMBER);
        await dbAdapter.execute(`GRANT readonly_role TO ${DROPPED_MEMBER}`);
        await dbAdapter.execute(
          `GRANT SELECT ON TABLE proxy_endpoints TO ${DROPPED_MEMBER}`,
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
           VALUES ('incoming_webhooks', '[]'::jsonb)`,
        );

        await runMigration('down');

        assert.deepEqual(
          await dbAdapter.execute(
            `SELECT table_name FROM readonly_role_revoked_select_grants`,
          ),
          [{ table_name: 'incoming_webhooks' }],
        );
      });
    });
  });
});
