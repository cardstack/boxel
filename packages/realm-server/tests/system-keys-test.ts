import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename, join } from 'path';
import supertest from 'supertest';
import type { SuperTest, Test } from 'supertest';
import { dirSync } from 'tmp';
import fsExtra from 'fs-extra';
const { copySync, ensureDirSync } = fsExtra;
import jsonwebtoken from 'jsonwebtoken';
import sinon from 'sinon';
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
  insertProxyEndpoints,
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
import { replaceSystemKey } from '../lib/system-keys.ts';
import {
  installSecretsKeyring,
  LocalKeyProvider,
  resetSecretsAtRest,
} from '../lib/secrets-at-rest/index.ts';
import { startStubVendor, type StubVendor } from './helpers/stub-vendor.ts';

const SEEDED_KEY = 'sk-seeded-system-key';
const ADDED_KEY = 'sk-added-system-key-0001';
const REPLACED_KEY = 'sk-replaced-system-key-0002';
const SERVER_ORIGIN = 'http://127.0.0.1:4445';

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
        realmURL: new URL(`${SERVER_ORIGIN}/test/`),
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
        installSecretsKeyring(await new LocalKeyProvider().loadDataKeys());
        await insertProxyEndpoints(dbAdapter, [
          {
            url: `${vendor.url}/`,
            apiKey: SEEDED_KEY,
            creditStrategy: 'no-credit',
            supportsStreaming: false,
          },
        ]);
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

    // Signed for the test realm server's origin, as the CLI signs one for
    // the server it calls.
    function operatorToken(
      claims: Record<string, unknown> = { operator: 'system-keys' },
      expiresIn: jsonwebtoken.SignOptions['expiresIn'] = '5m',
    ): string {
      return jsonwebtoken.sign(claims, realmSecretSeed, {
        expiresIn,
        ...('aud' in claims ? {} : { audience: SERVER_ORIGIN }),
      });
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

    test('each change records the caller the server observed next to the note', async function (assert) {
      let iat = Math.floor(Date.now() / 1000) - 30;
      let token = jsonwebtoken.sign(
        { operator: 'system-keys', iat, exp: iat + 5 * 60 },
        realmSecretSeed,
        { audience: SERVER_ORIGIN },
      );
      let added = await request
        .post('/_system-keys')
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({
          destination: addedDestination(),
          creditStrategy: 'none',
          value: ADDED_KEY,
          note: 'Pat adding the vendor key',
        });
      assert.strictEqual(added.status, 201);
      let [recorded] = await dbAdapter.execute(
        `SELECT client_address, token_issued_at FROM proxy_endpoint_history`,
      );
      assert.true(
        /127\.0\.0\.1|::1/.test(String(recorded.client_address)),
        `the caller's address is recorded (${recorded.client_address})`,
      );
      assert.strictEqual(
        Number(recorded.token_issued_at),
        iat,
        'the time the token was signed is recorded',
      );

      let shown = await request
        .get(`/_system-keys/${added.body.key.id}`)
        .set('Authorization', `Bearer ${operatorToken()}`);
      let [change] = shown.body.history;
      assert.strictEqual(change.note, 'Pat adding the vendor key');
      assert.strictEqual(change.clientAddress, recorded.client_address);
      assert.strictEqual(
        change.tokenIssuedAt,
        new Date(iat * 1000).toISOString(),
      );
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
      assert.strictEqual(
        (await forwardedCredential(vendor.alternateUrl)).authorization,
        `Bearer ${ADDED_KEY}`,
        'the key is attached, and the endpoints are cached',
      );
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
        [
          'a note with a line break',
          { note: 'added\n2026-01-01T00:00:00.000Z delete: forged' },
          400,
        ],
        ['a note with an escape sequence', { note: 'added \u001b[2K' }, 400],
        ['a note with a C1 control', { note: 'added \u009b2K' }, 400],
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
        [
          'a plain http destination off the development allowlist',
          { destination: 'http://vendor.example/' },
          400,
        ],
        ['an unknown credit strategy', { creditStrategy: 'free' }, 400],
        ['an unknown auth method', { authMethod: 'cookie' }, 400],
        [
          'a destination that already has a key',
          { destination: `${vendor.url}/` },
          409,
        ],
        [
          'a destination under one that already has a key',
          { destination: `${vendor.url}/v1/` },
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

    test('a replace or delete whose note contains the current value is refused', async function (assert) {
      let { key } = (await addKey()).body;
      let replaced = await request
        .patch(`/_system-keys/${key.id}`)
        .set('Authorization', `Bearer ${operatorToken()}`)
        .send({ value: REPLACED_KEY, note: `was ${ADDED_KEY}` });
      assert.strictEqual(replaced.status, 400);
      let deleted = await request
        .delete(`/_system-keys/${key.id}`)
        .set('Authorization', `Bearer ${operatorToken()}`)
        .send({ note: `was ${ADDED_KEY}` });
      assert.strictEqual(deleted.status, 400);
      assert.strictEqual(
        readProxyEndpointKey(await storedRow(key.id)),
        ADDED_KEY,
        'the key is unchanged',
      );
      assert.deepEqual(
        (await historyRows()).map(({ action }) => action),
        ['add'],
      );
    });

    test('a reload that read the endpoints before a change does not put the old key back', async function (assert) {
      let { key } = (await addKey()).body;
      let destinations = AllowedProxyDestinations.getInstance(dbAdapter);
      AllowedProxyDestinations.invalidate();

      // Hold the next endpoint reload after it has read the table, so the
      // replace lands while it is in flight.
      let release!: () => void;
      let gate = new Promise<void>((resolve) => (release = resolve));
      let held!: () => void;
      let holding = new Promise<void>((resolve) => (held = resolve));
      let execute = dbAdapter.execute.bind(dbAdapter);
      let hold = true;
      let stub = sinon
        .stub(dbAdapter, 'execute')
        .callsFake(async (sql: any, opts?: any) => {
          let result = await execute(sql, opts);
          if (
            hold &&
            typeof sql === 'string' &&
            sql.includes('auth_parameter_name, encode(api_key_ciphertext')
          ) {
            hold = false;
            held();
            await gate;
          }
          return result;
        });
      try {
        let inFlight = destinations.getDestinationConfig(
          `${vendor.alternateUrl}/echo`,
        );
        await holding;
        await replaceSystemKey(dbAdapter, key.id, {
          value: REPLACED_KEY,
          note: 'rotating the vendor key',
        });
        release();
        assert.strictEqual(
          (await inFlight)?.apiKey,
          REPLACED_KEY,
          'the reload in flight reads the table again',
        );
        assert.strictEqual(
          (
            await destinations.getDestinationConfig(
              `${vendor.alternateUrl}/echo`,
            )
          )?.apiKey,
          REPLACED_KEY,
          'the cache holds the new key',
        );
      } finally {
        stub.restore();
      }
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
            audience: SERVER_ORIGIN,
            expiresIn: '5m',
          }),
        ],
        [
          'an operator token for another realm server',
          operatorToken({
            operator: 'system-keys',
            aud: 'https://realms.another.example',
          }),
        ],
        [
          'an operator token that names no realm server',
          jsonwebtoken.sign({ operator: 'system-keys' }, realmSecretSeed, {
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
        `SELECT id, url, ${PROXY_ENDPOINT_KEY_COLUMNS} FROM proxy_endpoints`,
      );
      assert.deepEqual(
        (rows as unknown as ProxyEndpointKeyRow[]).map((row) => ({
          url: row.url,
          key: readProxyEndpointKey(row),
        })),
        [{ url: `${vendor.url}/`, key: SEEDED_KEY }],
      );
      assert.deepEqual(await historyRows(), []);
    });

    test('a system-keys operator token is not a user session', async function (assert) {
      let response = await request
        .get('/_user')
        .set('Accept', 'application/vnd.api+json')
        .set('Authorization', `Bearer ${operatorToken()}`);
      assert.strictEqual(response.status, 401);
    });

    const CLIENT_SECRET = 'platform-client-secret-0001';
    const ROTATED_CLIENT_SECRET = 'platform-client-secret-0002';

    async function addPlatformClient(overrides: Record<string, unknown> = {}) {
      return await request
        .post('/_platform-oauth-clients')
        .set('Authorization', `Bearer ${operatorToken()}`)
        .set('Content-Type', 'application/json')
        .send({
          name: 'github',
          label: 'Boxel (read-only)',
          secret: CLIENT_SECRET,
          oauth: {
            clientId: 'Iv1.platform-client',
            authorizeUrl: 'https://github.com/login/oauth/authorize',
            tokenUrl: 'https://github.com/login/oauth/access_token',
            apiHosts: ['https://api.github.com/'],
          },
          note: 'registering the GitHub App',
          ...overrides,
        });
    }

    async function platformClientHistory() {
      return await dbAdapter.execute(
        `SELECT platform_client_id, name, client_id, action, note, key_id FROM platform_oauth_client_history ORDER BY id`,
      );
    }

    test('each change to a platform client is recorded with its note and the caller the server observed, never its secret', async function (assert) {
      let iat = Math.floor(Date.now() / 1000) - 30;
      let token = jsonwebtoken.sign(
        { operator: 'system-keys', iat, exp: iat + 5 * 60 },
        realmSecretSeed,
        { audience: SERVER_ORIGIN },
      );
      let added = await addPlatformClient();
      assert.strictEqual(added.status, 201);
      let id = added.body.client.id;
      let replaced = await request
        .patch('/_platform-oauth-clients/github')
        .set('Authorization', `Bearer ${token}`)
        .send({
          secret: ROTATED_CLIENT_SECRET,
          note: 'rotating the GitHub App secret',
        });
      assert.strictEqual(replaced.status, 200);

      let shown = await request
        .get('/_platform-oauth-clients/github')
        .set('Authorization', `Bearer ${operatorToken()}`);
      assert.strictEqual(shown.status, 200);
      assert.strictEqual(shown.body.client.id, id);
      assert.deepEqual(
        shown.body.history.map((change: any) => [change.action, change.note]),
        [
          ['replace', 'rotating the GitHub App secret'],
          ['add', 'registering the GitHub App'],
        ],
        'the history is newest first',
      );
      let [rotation] = shown.body.history;
      assert.strictEqual(rotation.clientId, 'Iv1.platform-client');
      assert.strictEqual(rotation.keyId, 'local-development');
      assert.true(
        /127\.0\.0\.1|::1/.test(String(rotation.clientAddress)),
        `the caller's address is recorded (${rotation.clientAddress})`,
      );
      assert.strictEqual(
        rotation.tokenIssuedAt,
        new Date(iat * 1000).toISOString(),
        'the time the token was signed is recorded',
      );

      let deleted = await request
        .delete('/_platform-oauth-clients/github')
        .set('Authorization', `Bearer ${operatorToken()}`)
        .send({ note: 'retiring the GitHub App' });
      assert.strictEqual(deleted.status, 200);
      let history = await platformClientHistory();
      assert.deepEqual(
        history,
        [
          ['add', 'registering the GitHub App'],
          ['replace', 'rotating the GitHub App secret'],
          ['delete', 'retiring the GitHub App'],
        ].map(([action, note]) => ({
          platform_client_id: id,
          name: 'github',
          client_id: 'Iv1.platform-client',
          action,
          note,
          key_id: 'local-development',
        })),
        'a deleted client keeps its history',
      );

      let readded = await addPlatformClient({
        oauth: {
          clientId: 'Iv1.another-app',
          authorizeUrl: 'https://github.com/login/oauth/authorize',
          tokenUrl: 'https://github.com/login/oauth/access_token',
          apiHosts: ['https://api.github.com/'],
        },
        note: 'registering a new GitHub App under the same name',
      });
      assert.strictEqual(readded.status, 201);
      assert.notStrictEqual(readded.body.client.id, id, 'it has a new id');
      let reshown = await request
        .get('/_platform-oauth-clients/github')
        .set('Authorization', `Bearer ${operatorToken()}`);
      assert.deepEqual(
        reshown.body.history.map((change: any) => [
          change.action,
          change.clientId,
        ]),
        [
          ['add', 'Iv1.another-app'],
          ['delete', 'Iv1.platform-client'],
          ['replace', 'Iv1.platform-client'],
          ['add', 'Iv1.platform-client'],
        ],
        'a client added again under a name shows the earlier client’s history too',
      );
      let everything = JSON.stringify([
        added.body,
        replaced.body,
        shown.body,
        await dbAdapter.execute(`SELECT * FROM platform_oauth_client_history`),
      ]);
      assert.false(everything.includes(CLIENT_SECRET), 'no secret is shown');
      assert.false(
        everything.includes(ROTATED_CLIENT_SECRET),
        'no rotated secret is shown',
      );
    });

    test('a platform client change with no note, or a note holding a secret, is refused and changes nothing', async function (assert) {
      assert.strictEqual(
        (await addPlatformClient({ note: undefined })).status,
        400,
      );
      assert.strictEqual(
        (await addPlatformClient({ note: `secret ${CLIENT_SECRET}` })).status,
        400,
      );
      assert.strictEqual(
        (await addPlatformClient({ note: 'one\ntwo' })).status,
        400,
        'a note with a line break is refused',
      );
      assert.deepEqual(await platformClientHistory(), []);

      assert.strictEqual((await addPlatformClient()).status, 201);
      let refusals = [
        { secret: ROTATED_CLIENT_SECRET },
        { secret: ROTATED_CLIENT_SECRET, note: `to ${ROTATED_CLIENT_SECRET}` },
        { secret: ROTATED_CLIENT_SECRET, note: `was ${CLIENT_SECRET}` },
      ];
      for (let body of refusals) {
        let response = await request
          .patch('/_platform-oauth-clients/github')
          .set('Authorization', `Bearer ${operatorToken()}`)
          .send(body);
        assert.strictEqual(response.status, 400, JSON.stringify(body.note));
      }
      for (let body of [{}, { note: `was ${CLIENT_SECRET}` }]) {
        let response = await request
          .delete('/_platform-oauth-clients/github')
          .set('Authorization', `Bearer ${operatorToken()}`)
          .send(body);
        assert.strictEqual(response.status, 400, JSON.stringify(body));
      }
      assert.deepEqual(
        (await platformClientHistory()).map(({ action }) => action),
        ['add'],
      );
      let [stored] = await dbAdapter.execute(
        `SELECT updated_at = created_at AS untouched FROM platform_oauth_clients WHERE name = 'github'`,
      );
      assert.true(Boolean(stored.untouched), 'the client is unchanged');
    });

    test('show answers 404 for a platform client that does not exist', async function (assert) {
      let response = await request
        .get('/_platform-oauth-clients/nothing-here')
        .set('Authorization', `Bearer ${operatorToken()}`);
      assert.strictEqual(response.status, 404);
    });
  });
});
