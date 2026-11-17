import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename, dirname, join, relative } from 'path';
import { randomBytes } from 'crypto';
import { readdirSync, readFileSync } from 'fs';
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
import { logLinesDuring, withLogDefinition } from './helpers/log-capture.ts';
import { startStubVendor, type StubVendor } from './helpers/stub-vendor.ts';
import { createJWT as createRealmServerJWT } from '../utils/jwt.ts';
import { AllowedProxyDestinations } from '../lib/allowed-proxy-destinations.ts';
import { configureOutbound, resetOutbound } from '../lib/outbound/client.ts';
import {
  deletePlatformSecret,
  PLATFORM_SECRET_FIELD,
  platformSecretBinding,
  readPlatformSecret,
  setPlatformSecret,
  UnreadablePlatformSecretError,
} from '../lib/platform-secrets.ts';
import {
  dataKeyStatus,
  installSecretsKeyring,
  LocalKeyProvider,
  resealUnderCurrentKey,
  resetSecretsAtRest,
  SEALED_COLUMNS,
  sealedCensus,
  sealedColumnsSelect,
  sealedFromColumns,
  SecretsKeyring,
  secretsKeyring,
  setSecretOpenFailureSink,
  type DataKey,
} from '../lib/secrets-at-rest/index.ts';

const NAME = 'openrouter-batch-webhook-signing';
const VALUE = 'whsec-platform-secret-value-7d1c2e';
const REPLACED_VALUE = 'whsec-platform-secret-value-a90f44';
const SERVER_ORIGIN = 'http://127.0.0.1:4445';

function dataKey(keyId: string): DataKey {
  return { keyId, key: randomBytes(32) };
}

async function storedRow(dbAdapter: PgAdapter, name = NAME) {
  let [row] = await dbAdapter.execute(
    `SELECT id, name, note, ${sealedColumnsSelect('value')} FROM platform_secrets WHERE name = $1`,
    { bind: [name] },
  );
  return row;
}

async function historyRows(dbAdapter: PgAdapter) {
  return await dbAdapter.execute(
    `SELECT secret_id, name, action, note, key_id, client_address, token_issued_at
     FROM platform_secret_history ORDER BY id`,
  );
}

// Every file under `root`, relative to it, that isn't a dependency, a build
// output or a test.
function sourceFiles(root: string, dir = root): string[] {
  let files: string[] = [];
  for (let entry of readdirSync(dir, { withFileTypes: true })) {
    if (
      entry.name.startsWith('.') ||
      ['node_modules', 'dist', 'tests'].includes(entry.name)
    ) {
      continue;
    }
    let path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...sourceFiles(root, path));
    } else if (/\.(ts|gts|js|mjs|cjs)$/.test(entry.name)) {
      files.push(relative(root, path));
    }
  }
  return files;
}

module(basename(import.meta.filename), function () {
  module('platform secrets', function (hooks) {
    let dbAdapter: PgAdapter;

    setupDB(hooks, {
      beforeEach: async (_dbAdapter) => {
        dbAdapter = _dbAdapter;
        installSecretsKeyring(await new LocalKeyProvider().loadDataKeys());
      },
      afterEach: async () => {
        resetSecretsAtRest();
      },
    });

    test('a secret is sealed, bound to its row and its name, and read by name', async function (assert) {
      let { secret, added } = await setPlatformSecret(dbAdapter, {
        name: NAME,
        value: VALUE,
        note: 'setting the webhook secret',
      });
      assert.true(added);
      assert.deepEqual(Object.keys(secret).sort(), [
        'keyId',
        'name',
        'note',
        'setAt',
      ]);
      assert.strictEqual(secret.keyId, 'local-development');

      let row = await storedRow(dbAdapter);
      let sealed = sealedFromColumns(row, 'value')!;
      assert.notStrictEqual(sealed, undefined, 'the value is sealed');
      assert.false(
        JSON.stringify(row).includes(VALUE),
        'the row holds no plain-text copy',
      );
      assert.strictEqual(
        secretsKeyring().open(
          sealed,
          platformSecretBinding(String(row.id), NAME),
        ),
        VALUE,
      );
      assert.strictEqual(await readPlatformSecret(dbAdapter, NAME), VALUE);
      assert.strictEqual(
        await readPlatformSecret(dbAdapter, 'not-set'),
        undefined,
        'a name with no secret reads as none',
      );

      assert.throws(
        () =>
          secretsKeyring().open(sealed, {
            ...platformSecretBinding(String(row.id), 'another-name'),
          }),
        /could not be decrypted/,
        'the value does not open under another name',
      );
      assert.throws(
        () =>
          secretsKeyring().open(sealed, {
            field: PLATFORM_SECRET_FIELD,
            owner: 'boxel-platform',
            id: String(row.id),
          }),
        /could not be decrypted/,
        'nor without its name',
      );
    });

    test('setting a secret again replaces its value in its row', async function (assert) {
      await setPlatformSecret(dbAdapter, {
        name: NAME,
        value: VALUE,
        note: 'setting the webhook secret',
      });
      let before = await storedRow(dbAdapter);
      let { added, secret } = await setPlatformSecret(dbAdapter, {
        name: NAME,
        value: REPLACED_VALUE,
        note: 'rotating the webhook secret',
      });
      assert.false(added);
      assert.strictEqual(secret.note, 'rotating the webhook secret');
      let after = await storedRow(dbAdapter);
      assert.strictEqual(after.id, before.id, 'the row is kept');
      assert.strictEqual(
        await readPlatformSecret(dbAdapter, NAME),
        REPLACED_VALUE,
      );
      assert.deepEqual(
        (await historyRows(dbAdapter)).map((row) => [row.action, row.note]),
        [
          ['set', 'setting the webhook secret'],
          ['set', 'rotating the webhook secret'],
        ],
      );
    });

    test('a secret moved to another name, or edited outside the application, does not open, and its read refuses', async function (assert) {
      await setPlatformSecret(dbAdapter, {
        name: NAME,
        value: VALUE,
        note: 'setting the webhook secret',
      });
      await dbAdapter.execute(
        `UPDATE platform_secrets SET name = 'another-secret' WHERE name = $1`,
        { bind: [NAME] },
      );
      let failures: unknown[] = [];
      setSecretOpenFailureSink((event) => failures.push(event));
      try {
        let lines = await logLinesDuring(['platform-secrets'], async () => {
          await assert.rejects(
            readPlatformSecret(dbAdapter, 'another-secret'),
            UnreadablePlatformSecretError,
          );
        });
        assert.strictEqual(lines.length, 1, 'the refusal is logged once');
        assert.true(lines[0].message.includes('another-secret'));
        assert.false(lines[0].message.includes(VALUE));
      } finally {
        setSecretOpenFailureSink(undefined);
      }
      assert.deepEqual(
        failures.map((event: any) => [event.field, event.reason]),
        [[PLATFORM_SECRET_FIELD, 'not-authentic']],
      );
    });

    test('a value, a name and a note are checked, and a note may not repeat the value', async function (assert) {
      let refused: [string, Parameters<typeof setPlatformSecret>[1]][] = [
        [
          'a name with upper-case letters',
          { name: 'Webhook', value: VALUE, note: 'n' },
        ],
        ['an empty value', { name: NAME, value: '', note: 'n' }],
        [
          'a value with surrounding whitespace',
          { name: NAME, value: ` ${VALUE}`, note: 'n' },
        ],
        ['no note', { name: NAME, value: VALUE, note: '' }],
        [
          'a note with a line break',
          { name: NAME, value: VALUE, note: 'one\ntwo' },
        ],
        [
          'a note holding the value',
          { name: NAME, value: VALUE, note: `set to ${VALUE}` },
        ],
      ];
      for (let [label, change] of refused) {
        await assert.rejects(
          setPlatformSecret(dbAdapter, change),
          (e: any) => e.status === 400 && !String(e.message).includes(VALUE),
          `${label} is refused without repeating the value`,
        );
      }
      await setPlatformSecret(dbAdapter, {
        name: NAME,
        value: VALUE,
        note: 'setting the webhook secret',
      });
      await assert.rejects(
        setPlatformSecret(dbAdapter, {
          name: NAME,
          value: REPLACED_VALUE,
          note: `was ${VALUE}`,
        }),
        /the note must not contain the value/,
        'a set whose note holds the current value is refused',
      );
      await assert.rejects(
        deletePlatformSecret(dbAdapter, NAME, { note: `was ${VALUE}` }),
        /the note must not contain the value/,
        'a delete whose note holds the current value is refused',
      );
      assert.strictEqual(await readPlatformSecret(dbAdapter, NAME), VALUE);
      assert.strictEqual(
        (await historyRows(dbAdapter)).length,
        1,
        'no refused change is recorded',
      );
    });

    test('a deleted secret reads as none and keeps its history', async function (assert) {
      await setPlatformSecret(dbAdapter, {
        name: NAME,
        value: VALUE,
        note: 'setting the webhook secret',
      });
      let id = (await storedRow(dbAdapter)).id;
      await deletePlatformSecret(dbAdapter, NAME, {
        note: 'the webhook is retired',
      });
      assert.strictEqual(await readPlatformSecret(dbAdapter, NAME), undefined);
      assert.deepEqual(
        (await historyRows(dbAdapter)).map((row) => [
          row.secret_id,
          row.action,
          row.note,
        ]),
        [
          [id, 'set', 'setting the webhook secret'],
          [id, 'delete', 'the webhook is retired'],
        ],
      );
      await assert.rejects(
        deletePlatformSecret(dbAdapter, NAME, { note: 'again' }),
        (e: any) => e.status === 404,
      );
    });

    test('the census counts platform secrets, and the re-seal pass moves them to the current data key', async function (assert) {
      let oldKey = dataKey('old');
      let newKey = dataKey('new');
      let before = new SecretsKeyring([oldKey], 'old');
      let during = new SecretsKeyring([newKey, oldKey], 'new');
      let after = new SecretsKeyring([newKey], 'new');
      await setPlatformSecret(
        dbAdapter,
        { name: NAME, value: VALUE, note: 'setting the webhook secret' },
        before,
      );
      await setPlatformSecret(
        dbAdapter,
        { name: 'second-secret', value: REPLACED_VALUE, note: 'a second' },
        during,
      );

      let column = SEALED_COLUMNS.find(
        (sealedColumn) => sealedColumn.field === PLATFORM_SECRET_FIELD,
      );
      assert.ok(column, 'the column is registered for rotation');
      assert.deepEqual(await sealedCensus(dbAdapter, [column!]), [
        { field: PLATFORM_SECRET_FIELD, rowsByKeyId: { old: 1, new: 1 } },
      ]);

      let report = await resealUnderCurrentKey(dbAdapter, during);
      assert.deepEqual(
        report.columns.find((entry) => entry.field === PLATFORM_SECRET_FIELD),
        {
          field: PLATFORM_SECRET_FIELD,
          resealed: 1,
          changedConcurrently: 0,
          unopenable: 0,
        },
      );
      let status = await dataKeyStatus(dbAdapter, during);
      assert.deepEqual(status.retirableKeyIds, ['old']);
      assert.strictEqual(
        await readPlatformSecret(dbAdapter, NAME, after),
        VALUE,
      );
      assert.strictEqual(
        await readPlatformSecret(dbAdapter, 'second-secret', after),
        REPLACED_VALUE,
      );
    });

    test('nothing on the outbound or forwarding path reads the table', async function (assert) {
      let packages = join(dirname(import.meta.filename), '..', '..');
      let realmServer = join(packages, 'realm-server');
      let namingTable: string[] = [];
      let importingModule: string[] = [];
      for (let root of [realmServer, join(packages, 'runtime-common')]) {
        for (let file of sourceFiles(root)) {
          let source = readFileSync(join(root, file), 'utf8');
          let path = relative(packages, join(root, file));
          if (source.includes('platform_secrets')) {
            namingTable.push(path);
          }
          if (/from ['"][^'"]*\/platform-secrets(\.ts)?['"]/.test(source)) {
            importingModule.push(path);
          }
        }
      }
      // A module that comes to read a platform secret joins this list, and
      // with it the review that it is not on the outbound path.
      assert.deepEqual(
        namingTable.sort(),
        [
          'realm-server/lib/platform-secrets.ts',
          'realm-server/lib/secrets-at-rest/rotation.ts',
        ],
        'only the store and the rotation registry name the table',
      );
      assert.deepEqual(
        importingModule.sort(),
        ['realm-server/handlers/handle-platform-secrets.ts'],
        'only the operator endpoints use the store',
      );
      assert.false(
        importingModule.some((path) =>
          /outbound|forward|proxy|openrouter|request-telemetry/.test(path),
        ),
        'no outbound, forwarding or proxy module uses it',
      );

      await setPlatformSecret(dbAdapter, {
        name: NAME,
        value: VALUE,
        note: 'setting the webhook secret',
      });
      let execute = sinon.spy(dbAdapter, 'execute');
      try {
        AllowedProxyDestinations.reset();
        let destinations = AllowedProxyDestinations.getInstance(dbAdapter);
        assert.false(
          await destinations.isDestinationAllowed(
            `https://example.test/${NAME}`,
          ),
        );
        assert.true(
          execute.getCalls().length > 0,
          'the proxy loaded its endpoints',
        );
        assert.false(
          execute
            .getCalls()
            .some((call) => String(call.args[0]).includes('platform_secrets')),
          'loading the proxy destinations never reads the table',
        );
      } finally {
        execute.restore();
        AllowedProxyDestinations.reset();
      }
    });
  });

  module('the platform-secrets operator endpoints', function (hooks) {
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
            apiKey: 'sk-seeded-system-key',
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
      claims: Record<string, unknown> = { operator: 'platform-secrets' },
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

    async function setSecret(
      body: Record<string, unknown> = {
        value: VALUE,
        note: 'setting the webhook secret',
      },
      name = NAME,
    ) {
      return await request
        .put(`/_platform-secrets/${name}`)
        .set('Authorization', `Bearer ${operatorToken()}`)
        .set('Content-Type', 'application/json')
        .send(body);
    }

    test('set adds a secret and then replaces it; list and show give its name, data key and last note, and nothing else', async function (assert) {
      let added = await setSecret();
      assert.strictEqual(added.status, 201);
      assert.strictEqual(added.body.secret.name, NAME);
      assert.strictEqual(added.body.secret.keyId, 'local-development');
      assert.strictEqual(added.body.secret.note, 'setting the webhook secret');

      let replaced = await setSecret({
        value: REPLACED_VALUE,
        note: 'rotating the webhook secret',
      });
      assert.strictEqual(replaced.status, 200);
      assert.strictEqual(
        await readPlatformSecret(dbAdapter, NAME),
        REPLACED_VALUE,
      );

      let listed = await request
        .get('/_platform-secrets')
        .set('Authorization', `Bearer ${operatorToken()}`);
      assert.strictEqual(listed.status, 200);
      assert.deepEqual(listed.body.secrets, [
        {
          name: NAME,
          keyId: 'local-development',
          note: 'rotating the webhook secret',
          setAt: replaced.body.secret.setAt,
        },
      ]);
      let shown = await request
        .get(`/_platform-secrets/${NAME}`)
        .set('Authorization', `Bearer ${operatorToken()}`);
      assert.strictEqual(shown.status, 200);
      assert.deepEqual(shown.body, { secret: listed.body.secrets[0] });

      let history = await historyRows(dbAdapter);
      assert.deepEqual(
        history.map((row) => [row.action, row.note, row.key_id]),
        [
          ['set', 'setting the webhook secret', 'local-development'],
          ['set', 'rotating the webhook secret', 'local-development'],
        ],
      );
      assert.true(
        /127\.0\.0\.1|::1/.test(String(history[0].client_address)),
        `the caller's address is recorded (${history[0].client_address})`,
      );
      assert.notStrictEqual(history[0].token_issued_at, null);
    });

    test('a value is never returned, shown, logged or recorded by any endpoint once set', async function (assert) {
      let channels = [
        'platform-secrets',
        'realm:requests',
        'realm-server',
        'secrets-at-rest',
        'boxel:secrets-at-rest',
        'system-keys',
      ];
      let responses: string[] = [];
      let lines = await withLogDefinition('realm:requests', 'debug', () =>
        logLinesDuring(channels, async () => {
          let token = `Bearer ${operatorToken()}`;
          let calls = [
            () => setSecret(),
            () =>
              setSecret({
                value: REPLACED_VALUE,
                note: 'rotating the webhook secret',
              }),
            () => request.get('/_platform-secrets').set('Authorization', token),
            () =>
              request
                .get(`/_platform-secrets/${NAME}`)
                .set('Authorization', token),
            // Refusals answer without the value too.
            () =>
              setSecret({
                value: VALUE,
                note: `the value is ${REPLACED_VALUE}`,
              }),
            () => setSecret({ value: ` ${VALUE}`, note: 'whitespace' }),
            () => setSecret({ value: VALUE, note: `holding ${VALUE}` }),
            () =>
              request
                .delete(`/_platform-secrets/${NAME}`)
                .set('Authorization', token)
                .send({ note: `holding ${REPLACED_VALUE}` }),
            () =>
              request
                .delete(`/_platform-secrets/${NAME}`)
                .set('Authorization', token)
                .send({ note: 'the webhook is retired' }),
            () =>
              request
                .get(`/_platform-secrets/${NAME}`)
                .set('Authorization', token),
          ];
          for (let call of calls) {
            let response = await call();
            responses.push(JSON.stringify([response.headers, response.text]));
          }
        }),
      );
      let history = JSON.stringify(
        await dbAdapter.execute(`SELECT * FROM platform_secret_history`),
      );
      for (let value of [VALUE, REPLACED_VALUE]) {
        for (let fragment of [value, value.slice(-8), value.slice(0, 12)]) {
          assert.false(
            responses.some((response) => response.includes(fragment)),
            `no response carries ${fragment === value ? 'a value' : 'part of a value'}`,
          );
          assert.false(
            lines.some((line) => line.message.includes(fragment)),
            `no log line carries ${fragment === value ? 'a value' : 'part of a value'}`,
          );
          assert.false(
            history.includes(fragment),
            `no history row carries ${fragment === value ? 'a value' : 'part of a value'}`,
          );
        }
      }
      assert.true(
        lines.some((line) =>
          line.message.startsWith(`platform secret set: ${NAME}`),
        ),
        'the changes are logged',
      );
      assert.strictEqual(
        JSON.parse(history).length,
        3,
        'two sets and a delete are recorded',
      );
    });

    test('only an operator token for platform-secrets reaches the endpoints', async function (assert) {
      await setPlatformSecret(dbAdapter, {
        name: NAME,
        value: VALUE,
        note: 'setting the webhook secret',
      });
      let refused: [string, string | undefined][] = [
        ['no token', undefined],
        ['a user session', userSession()],
        [
          'a system-keys operator token',
          operatorToken({ operator: 'system-keys' }),
        ],
        [
          'a data-keys operator token',
          operatorToken({ operator: 'data-keys' }),
        ],
        [
          'an operator token that names a user',
          operatorToken({
            operator: 'platform-secrets',
            user: '@testuser:localhost',
          }),
        ],
        [
          'an operator token that lives for more than 15 minutes',
          operatorToken({ operator: 'platform-secrets' }, '1h'),
        ],
        [
          'an operator token signed with another seed',
          jsonwebtoken.sign({ operator: 'platform-secrets' }, 'another seed', {
            audience: SERVER_ORIGIN,
            expiresIn: '5m',
          }),
        ],
        [
          'an operator token for another realm server',
          operatorToken({
            operator: 'platform-secrets',
            aud: 'https://realms.another.example',
          }),
        ],
        [
          'an operator token that names no realm server',
          jsonwebtoken.sign({ operator: 'platform-secrets' }, realmSecretSeed, {
            expiresIn: '5m',
          }),
        ],
      ];
      for (let [label, token] of refused) {
        let calls = [
          () => request.get('/_platform-secrets'),
          () => request.get(`/_platform-secrets/${NAME}`),
          () =>
            request
              .put(`/_platform-secrets/${NAME}`)
              .send({ value: REPLACED_VALUE, note: 'refused' }),
          () =>
            request
              .delete(`/_platform-secrets/${NAME}`)
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
      assert.strictEqual(await readPlatformSecret(dbAdapter, NAME), VALUE);
      assert.strictEqual((await historyRows(dbAdapter)).length, 1);
    });

    test('a platform-secrets operator token is not a user session, and reaches no other operator endpoint', async function (assert) {
      let user = await request
        .get('/_user')
        .set('Accept', 'application/vnd.api+json')
        .set('Authorization', `Bearer ${operatorToken()}`);
      assert.strictEqual(user.status, 401);
      for (let path of [
        '/_system-keys',
        '/_platform-oauth-clients',
        '/_data-keys',
      ]) {
        let response = await request
          .get(path)
          .set('Authorization', `Bearer ${operatorToken()}`);
        assert.strictEqual(response.status, 401, `${path} refuses it`);
      }
    });

    test('a forward never reads the table, and a secret is no forwarding destination', async function (assert) {
      await setPlatformSecret(dbAdapter, {
        name: NAME,
        value: VALUE,
        note: 'setting the webhook secret',
      });
      let execute = sinon.spy(dbAdapter, 'execute');
      try {
        let response = await request
          .post('/_request-forward')
          .set('Accept', 'application/json')
          .set('Content-Type', 'application/json')
          .set('Authorization', `Bearer ${userSession()}`)
          .send({
            url: `${vendor.url}/echo`,
            method: 'POST',
            requestBody: JSON.stringify({}),
          });
        assert.strictEqual(response.status, 200, 'the forward is served');
        assert.false(
          execute
            .getCalls()
            .some((call) => String(call.args[0]).includes('platform_secrets')),
          'serving the forward never reads the table',
        );
      } finally {
        execute.restore();
      }
      assert.false(
        vendor.requests.some((request) =>
          JSON.stringify(request).includes(VALUE),
        ),
        'the vendor never receives the secret',
      );
    });

    test('show and delete answer 404 for a name that has no secret', async function (assert) {
      let shown = await request
        .get('/_platform-secrets/not-set')
        .set('Authorization', `Bearer ${operatorToken()}`);
      assert.strictEqual(shown.status, 404);
      let deleted = await request
        .delete('/_platform-secrets/not-set')
        .set('Authorization', `Bearer ${operatorToken()}`)
        .send({ note: 'removing it' });
      assert.strictEqual(deleted.status, 404);
      assert.deepEqual(await historyRows(dbAdapter), []);
    });
  });
});
