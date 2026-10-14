import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename, join } from 'path';
import supertest from 'supertest';
import type { SuperTest, Test } from 'supertest';
import { dirSync } from 'tmp';
import fsExtra from 'fs-extra';
const { copySync, ensureDirSync } = fsExtra;
import jsonwebtoken from 'jsonwebtoken';
import type { PgAdapter } from '@cardstack/postgres';
import {
  addToCreditsLedger,
  getUserByMatrixUserId,
} from '@cardstack/billing/billing-queries';
import type { RealmHttpServer as Server } from '../server.ts';
import {
  closeServer,
  createVirtualNetwork,
  fixtureDir,
  insertPlan,
  insertUser,
  realmSecretSeed,
  runTestRealmServer,
  setupDB,
  setupTestDatabaseTemplate,
} from './helpers/index.ts';
import { createJWT as createRealmServerJWT } from '../utils/jwt.ts';
import { AllowedProxyDestinations } from '../lib/allowed-proxy-destinations.ts';
import { configureOutbound, resetOutbound } from '../lib/outbound/client.ts';
import {
  PROXY_ENDPOINT_KEY_COLUMNS,
  readProxyEndpointKey,
  type ProxyEndpointKeyRow,
} from '../lib/proxy-endpoint-keys.ts';
import {
  installSecretsKeyring,
  LocalKeyProvider,
  resetSecretsAtRest,
} from '../lib/secrets-at-rest/index.ts';
import { startStubVendor, type StubVendor } from './helpers/stub-vendor.ts';

const SEEDED_KEY = 'sk-seeded-system-key';
const ADDED_KEY = 'sk-added-system-key-0001';
const REPLACED_KEY = 'sk-replaced-system-key-0002';

module(basename(import.meta.filename), function () {
  module('the system-keys operator endpoints', function (hooks) {
    let testRealmHttpServer: Server;
    let testRealm: any;
    let dbAdapter: PgAdapter;
    let request: SuperTest<Test>;
    let virtualNetwork = createVirtualNetwork();

    async function startRealmServer(
      dbAdapter: any,
      publisher: any,
      runner: any,
    ) {
      if (testRealm) {
        virtualNetwork.unmount(testRealm.handle);
      }
      let dir = dirSync();
      let testRealmDir = join(dir.name, 'realm_server_1', 'test');
      ensureDirSync(testRealmDir);
      copySync(fixtureDir('simple'), testRealmDir);
      ({ testRealm, testRealmHttpServer } = await runTestRealmServer({
        virtualNetwork,
        testRealmDir,
        realmsRootPath: join(dir.name, 'realm_server_1'),
        realmURL: new URL('http://127.0.0.1:4445/test/'),
        dbAdapter,
        publisher,
        runner,
        matrixURL: new URL('http://localhost:8008'),
      }));
      request = supertest(testRealmHttpServer);
    }

    async function stopRealmServer() {
      AllowedProxyDestinations.reset();
      await closeServer(testRealmHttpServer);
    }

    let templateDatabase = setupTestDatabaseTemplate(hooks, {
      key: import.meta.filename,
      build: async ({ dbAdapter, publisher, runner }) => {
        await startRealmServer(dbAdapter, publisher, runner);
        return stopRealmServer;
      },
    });

    // The forward reaches a real socket, the stub vendor on loopback, so it
    // passes through the outbound guard as a deployed forward does. The
    // seeded key is for the vendor's `url`; keys the tests add are for its
    // `alternateUrl`, a different origin.
    let vendor: StubVendor;
    hooks.before(async function () {
      vendor = await startStubVendor();
    });
    hooks.after(async function () {
      await vendor.close();
    });

    setupDB(hooks, {
      templateDatabase,
      beforeEach: async (_dbAdapter, publisher, runner) => {
        dbAdapter = _dbAdapter;
        await dbAdapter.execute(
          `INSERT INTO proxy_endpoints (id, url, api_key, credit_strategy, supports_streaming, auth_method, auth_parameter_name, created_at, updated_at)
           VALUES (gen_random_uuid(), '${vendor.url}/', '${SEEDED_KEY}', 'no-credit', false, NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        );
        installSecretsKeyring(await new LocalKeyProvider().loadDataKeys());
        configureOutbound({ devAllowlist: ['127.0.0.1', 'localhost'] });
        vendor.requests.length = 0;
        await startRealmServer(dbAdapter, publisher, runner);
        await insertUser(
          dbAdapter,
          '@testuser:localhost',
          'cus_test123',
          'test@example.com',
        );
        await insertPlan(dbAdapter, 'Test Plan', 1000, 100, 'price_test123');
        let user = await getUserByMatrixUserId(
          dbAdapter,
          '@testuser:localhost',
        );
        await addToCreditsLedger(dbAdapter, {
          userId: user!.id,
          creditAmount: 50,
          creditType: 'extra_credit',
          subscriptionCycleId: null,
        });
      },
      afterEach: async () => {
        resetSecretsAtRest();
        resetOutbound();
        await stopRealmServer();
      },
    });

    function operatorToken(
      claims: Record<string, unknown> = { operator: 'system-keys' },
      expiresIn: jsonwebtoken.SignOptions['expiresIn'] = '5m',
    ): string {
      return jsonwebtoken.sign(claims, realmSecretSeed, { expiresIn });
    }

    function userSession(): string {
      return createRealmServerJWT(
        { user: '@testuser:localhost', sessionRoom: 'session-room' },
        realmSecretSeed,
      );
    }

    function addedDestination(): string {
      return `${vendor.alternateUrl}/`;
    }

    async function addKey(overrides: Record<string, unknown> = {}) {
      return await request
        .post('/_system-keys')
        .set('Authorization', `Bearer ${operatorToken()}`)
        .set('Content-Type', 'application/json')
        .send({
          destination: addedDestination(),
          creditStrategy: 'none',
          value: ADDED_KEY,
          note: 'adding the vendor key for tests',
          ...overrides,
        });
    }

    // The credential the vendor received on a forward to `origin`.
    async function forwardedCredential(origin: string) {
      vendor.requests.length = 0;
      let response = await request
        .post('/_request-forward')
        .set('Accept', 'application/json')
        .set('Content-Type', 'application/json')
        .set('Authorization', `Bearer ${userSession()}`)
        .send({
          url: `${origin}/echo`,
          method: 'POST',
          requestBody: JSON.stringify({}),
        });
      return {
        status: response.status,
        authorization: vendor.requests[0]?.headers.authorization,
      };
    }

    async function storedRow(id: string): Promise<ProxyEndpointKeyRow> {
      let [row] = await dbAdapter.execute(
        `SELECT id, url, ${PROXY_ENDPOINT_KEY_COLUMNS} FROM proxy_endpoints WHERE id = $1`,
        { bind: [id] },
      );
      return row as unknown as ProxyEndpointKeyRow;
    }

    async function historyRows() {
      return await dbAdapter.execute(
        `SELECT endpoint_id, url, action, note, key_id FROM proxy_endpoint_history ORDER BY id`,
      );
    }

    test('a key added through the endpoint is sealed, recorded without its value, and attached by the proxy', async function (assert) {
      let response = await addKey({ supportsStreaming: true });
      assert.strictEqual(response.status, 201);
      let { key } = response.body;
      assert.strictEqual(key.destination, addedDestination());
      assert.strictEqual(key.creditStrategy, 'none');
      assert.strictEqual(key.authMethod, 'header');
      assert.true(key.supportsStreaming);
      assert.true(key.hasValue);
      assert.strictEqual(key.keyId, 'local-development');
      assert.false(
        JSON.stringify(response.body).includes(ADDED_KEY),
        'the response carries no value',
      );

      let row = await storedRow(key.id);
      assert.strictEqual(
        readProxyEndpointKey(row),
        ADDED_KEY,
        'the sealed key opens to the value',
      );
      assert.notStrictEqual(row.api_key_ciphertext, null);

      let forwarded = await forwardedCredential(vendor.alternateUrl);
      assert.strictEqual(forwarded.status, 200);
      assert.strictEqual(
        forwarded.authorization,
        `Bearer ${ADDED_KEY}`,
        'the proxy attaches the new key at once',
      );

      let history = await historyRows();
      assert.deepEqual(history, [
        {
          endpoint_id: key.id,
          url: addedDestination(),
          action: 'add',
          note: 'adding the vendor key for tests',
          key_id: 'local-development',
        },
      ]);
    });

    test('a key replaced through the endpoint is attached by the proxy in place of the old one', async function (assert) {
      let { key } = (await addKey()).body;
      assert.strictEqual(
        (await forwardedCredential(vendor.alternateUrl)).authorization,
        `Bearer ${ADDED_KEY}`,
      );

      let response = await request
        .patch(`/_system-keys/${key.id}`)
        .set('Authorization', `Bearer ${operatorToken()}`)
        .send({ value: REPLACED_KEY, note: 'rotating the vendor key' });
      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.body.key.id, key.id);
      assert.strictEqual(response.body.key.destination, addedDestination());
      assert.false(JSON.stringify(response.body).includes(REPLACED_KEY));

      assert.strictEqual(
        readProxyEndpointKey(await storedRow(key.id)),
        REPLACED_KEY,
      );
      assert.strictEqual(
        (await forwardedCredential(vendor.alternateUrl)).authorization,
        `Bearer ${REPLACED_KEY}`,
      );
      assert.deepEqual(
        (await historyRows()).map(({ action, note }) => ({ action, note })),
        [
          { action: 'add', note: 'adding the vendor key for tests' },
          { action: 'replace', note: 'rotating the vendor key' },
        ],
      );
    });

    test('a key deleted through the endpoint stops being attached, and keeps its history', async function (assert) {
      let { key } = (await addKey()).body;
      let response = await request
        .delete(`/_system-keys/${key.id}`)
        .set('Authorization', `Bearer ${operatorToken()}`)
        .send({ note: 'the vendor account is closed' });
      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.body.deleted.id, key.id);

      let forwarded = await forwardedCredential(vendor.alternateUrl);
      assert.notStrictEqual(forwarded.status, 200, 'the forward is refused');
      assert.strictEqual(
        forwarded.authorization,
        undefined,
        'nothing reached the vendor',
      );
      assert.deepEqual(
        (await historyRows()).map(({ endpoint_id, action, note }) => ({
          endpoint_id,
          action,
          note,
        })),
        [
          {
            endpoint_id: key.id,
            action: 'add',
            note: 'adding the vendor key for tests',
          },
          {
            endpoint_id: key.id,
            action: 'delete',
            note: 'the vendor account is closed',
          },
        ],
      );

      let again = await request
        .delete(`/_system-keys/${key.id}`)
        .set('Authorization', `Bearer ${operatorToken()}`)
        .send({ note: 'again' });
      assert.strictEqual(again.status, 404);
    });

    test('list and show report every key and its history, never a value', async function (assert) {
      let { key } = (await addKey()).body;
      await request
        .patch(`/_system-keys/${key.id}`)
        .set('Authorization', `Bearer ${operatorToken()}`)
        .send({ value: REPLACED_KEY, note: 'rotating the vendor key' });

      let list = await request
        .get('/_system-keys')
        .set('Authorization', `Bearer ${operatorToken()}`);
      assert.strictEqual(list.status, 200);
      assert.deepEqual(
        list.body.keys.map((k: any) => k.destination).sort(),
        [`${vendor.url}/`, addedDestination()].sort(),
        'the seeded key is listed alongside the added one',
      );
      let seeded = list.body.keys.find(
        (k: any) => k.destination === `${vendor.url}/`,
      );
      assert.strictEqual(seeded.creditStrategy, 'none');
      assert.true(seeded.hasValue);

      let show = await request
        .get(`/_system-keys/${key.id}`)
        .set('Authorization', `Bearer ${operatorToken()}`);
      assert.strictEqual(show.status, 200);
      assert.strictEqual(show.body.key.id, key.id);
      assert.deepEqual(
        show.body.history.map((h: any) => h.action),
        ['replace', 'add'],
        'history is newest first',
      );

      for (let body of [list.body, show.body]) {
        let text = JSON.stringify(body);
        for (let value of [SEEDED_KEY, ADDED_KEY, REPLACED_KEY]) {
          assert.false(text.includes(value), 'no value is reported');
        }
      }

      let missing = await request
        .get('/_system-keys/not-an-id')
        .set('Authorization', `Bearer ${operatorToken()}`);
      assert.strictEqual(missing.status, 404);
    });

    test('a write that is refused changes nothing', async function (assert) {
      let cases: [string, Record<string, unknown>, number][] = [
        ['no note', { note: undefined }, 400],
        ['a blank note', { note: '   ' }, 400],
        ['a note that repeats the value', { note: `key is ${ADDED_KEY}` }, 400],
        ['no value', { value: undefined }, 400],
        ['a value with a newline', { value: `${ADDED_KEY}\n` }, 400],
        [
          'a destination with a query',
          { destination: `${vendor.alternateUrl}/?a=b` },
          400,
        ],
        [
          'a destination that is not http(s)',
          { destination: 'ftp://vendor.example/' },
          400,
        ],
        ['an unknown credit strategy', { creditStrategy: 'free' }, 400],
        ['an unknown auth method', { authMethod: 'cookie' }, 400],
        [
          'a destination that already has a key',
          { destination: `${vendor.url}/` },
          409,
        ],
      ];
      for (let [label, overrides, status] of cases) {
        let response = await addKey(overrides);
        assert.strictEqual(response.status, status, `${label} is refused`);
      }
      let oversized = await addKey({ note: 'x'.repeat(70 * 1024) });
      assert.strictEqual(oversized.status, 413, 'an oversized body is refused');

      let [seeded] = await dbAdapter.execute(
        `SELECT id FROM proxy_endpoints WHERE url = $1`,
        { bind: [`${vendor.url}/`] },
      );
      let replaced = await request
        .patch(`/_system-keys/${seeded.id}`)
        .set('Authorization', `Bearer ${operatorToken()}`)
        .send({ value: REPLACED_KEY });
      assert.strictEqual(replaced.status, 400, 'a replace needs a note');

      let rows = await dbAdapter.execute(`SELECT url FROM proxy_endpoints`);
      assert.deepEqual(
        rows.map((r) => r.url),
        [`${vendor.url}/`],
      );
      assert.deepEqual(await historyRows(), []);
      assert.strictEqual(
        (await forwardedCredential(vendor.url)).authorization,
        `Bearer ${SEEDED_KEY}`,
        'the existing system key is attached as it was',
      );
    });

    test('only an operator token for system-keys reaches the endpoints', async function (assert) {
      let [seeded] = await dbAdapter.execute(
        `SELECT id FROM proxy_endpoints WHERE url = $1`,
        { bind: [`${vendor.url}/`] },
      );
      let refused: [string, string | undefined][] = [
        ['no token', undefined],
        ['a user session', userSession()],
        ['another operator family', operatorToken({ operator: 'data-keys' })],
        [
          'an operator token that names a user',
          operatorToken({
            operator: 'system-keys',
            user: '@testuser:localhost',
          }),
        ],
        [
          'an operator token that lives for more than 15 minutes',
          operatorToken({ operator: 'system-keys' }, '1h'),
        ],
        [
          'an operator token signed with another seed',
          jsonwebtoken.sign({ operator: 'system-keys' }, 'another seed', {
            expiresIn: '5m',
          }),
        ],
      ];
      for (let [label, token] of refused) {
        let calls = [
          () => request.get('/_system-keys'),
          () => request.get(`/_system-keys/${seeded.id}`),
          () =>
            request.post('/_system-keys').send({
              destination: addedDestination(),
              creditStrategy: 'none',
              value: ADDED_KEY,
              note: 'refused',
            }),
          () =>
            request
              .patch(`/_system-keys/${seeded.id}`)
              .send({ value: REPLACED_KEY, note: 'refused' }),
          () =>
            request
              .delete(`/_system-keys/${seeded.id}`)
              .send({ note: 'refused' }),
        ];
        for (let call of calls) {
          let pending = call();
          let response = await (token
            ? pending.set('Authorization', `Bearer ${token}`)
            : pending);
          assert.strictEqual(response.status, 401, `${label} is refused`);
        }
      }
      let rows = await dbAdapter.execute(
        `SELECT url, api_key FROM proxy_endpoints`,
      );
      assert.deepEqual(rows, [{ url: `${vendor.url}/`, api_key: SEEDED_KEY }]);
      assert.deepEqual(await historyRows(), []);
    });

    test('a system-keys operator token is not a user session', async function (assert) {
      let response = await request
        .get('/_user')
        .set('Accept', 'application/vnd.api+json')
        .set('Authorization', `Bearer ${operatorToken()}`);
      assert.strictEqual(response.status, 401);
    });
  });
});
