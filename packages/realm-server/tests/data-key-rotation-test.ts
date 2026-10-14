import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename, join } from 'path';
import { randomBytes } from 'node:crypto';
import sinon from 'sinon';
import supertest from 'supertest';
import type { SuperTest, Test } from 'supertest';
import { dirSync } from 'tmp';
import fsExtra from 'fs-extra';
const { copySync, ensureDirSync } = fsExtra;
import jsonwebtoken from 'jsonwebtoken';
import type { DBAdapter } from '@cardstack/runtime-common';
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
import {
  createJWT as createRealmServerJWT,
  retrieveTokenClaim,
} from '../utils/jwt.ts';
import { verifyJWT } from '../jwt.ts';
import { verifyOperatorToken } from '../utils/operator-token.ts';
import { AllowedProxyDestinations } from '../lib/allowed-proxy-destinations.ts';
import { configureOutbound, resetOutbound } from '../lib/outbound/client.ts';
import { startStubVendor, type StubVendor } from './helpers/stub-vendor.ts';
import {
  dataKeyStatus,
  installSecretsKeyring,
  resealUnderCurrentKey,
  resetSecretsAtRest,
  SEALED_COLUMNS,
  SecretsKeyring,
  type DataKey,
  type SealedColumn,
  type SecretBinding,
} from '../lib/secrets-at-rest/index.ts';
import {
  configureResealPass,
  currentResealPass,
  resetResealPass,
} from '../handlers/handle-data-keys.ts';

const TABLE = 'rotation_test_secrets';
const FIELD = `${TABLE}.secret`;
const OWNER = '@secret-owner:example.test';

// A table that seals one secret per row with the helper, bound to its field,
// owner, row id and destination, the way an adopting table does.
const COLUMN: SealedColumn = {
  field: FIELD,
  table: TABLE,
  idColumn: 'id',
  keyIdColumn: 'secret_key_id',
  nonceColumn: 'secret_nonce',
  ciphertextColumn: 'secret_ciphertext',
  tagColumn: 'secret_tag',
  bindingColumns: ['destination'],
  binding: (row) => bindingFor(String(row.id), String(row.destination)),
};

function bindingFor(id: string, destination: string): SecretBinding {
  return { field: FIELD, owner: OWNER, id, destination };
}

function destinationFor(id: string): string {
  return `https://api.vendor.example/${id}/`;
}

function secretFor(id: string): string {
  return `sk-live-${id}`;
}

function rowId(i: number): string {
  return `row-${String(i).padStart(3, '0')}`;
}

async function createTable(dbAdapter: DBAdapter): Promise<void> {
  await dbAdapter.execute(
    `CREATE TABLE ${TABLE} (
       id text PRIMARY KEY,
       destination text NOT NULL,
       secret_key_id text,
       secret_nonce bytea,
       secret_ciphertext bytea,
       secret_tag bytea
     )`,
  );
}

async function writeSecret(
  dbAdapter: DBAdapter,
  ring: SecretsKeyring,
  id: string,
  secret = secretFor(id),
): Promise<void> {
  let destination = destinationFor(id);
  let sealed = ring.seal(secret, bindingFor(id, destination));
  await dbAdapter.execute(
    `INSERT INTO ${TABLE} (id, destination, secret_key_id, secret_nonce, secret_ciphertext, secret_tag)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (id) DO UPDATE SET
       secret_key_id = EXCLUDED.secret_key_id,
       secret_nonce = EXCLUDED.secret_nonce,
       secret_ciphertext = EXCLUDED.secret_ciphertext,
       secret_tag = EXCLUDED.secret_tag`,
    {
      bind: [
        id,
        destination,
        sealed.keyId,
        sealed.nonce,
        sealed.ciphertext,
        sealed.tag,
      ] as any,
    },
  );
}

async function readSecret(
  dbAdapter: DBAdapter,
  ring: SecretsKeyring,
  id: string,
): Promise<{ keyId: string; secret: string }> {
  let [row] = await dbAdapter.execute(`SELECT * FROM ${TABLE} WHERE id = $1`, {
    bind: [id],
  });
  let keyId = String(row.secret_key_id);
  let secret = ring.open(
    {
      keyId,
      nonce: row.secret_nonce as unknown as Buffer,
      ciphertext: row.secret_ciphertext as unknown as Buffer,
      tag: row.secret_tag as unknown as Buffer,
    },
    bindingFor(id, String(row.destination)),
  );
  return { keyId, secret };
}

async function keyIdsByRow(dbAdapter: DBAdapter): Promise<string[]> {
  let rows = await dbAdapter.execute(
    `SELECT secret_key_id FROM ${TABLE} ORDER BY id`,
  );
  return rows.map((row) => String(row.secret_key_id));
}

// Every stored row, with its byte columns as hex so rows compare by value.
async function storedRows(dbAdapter: DBAdapter): Promise<unknown[]> {
  let rows = await dbAdapter.execute(`SELECT * FROM ${TABLE} ORDER BY id`);
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([column, value]) => [
        column,
        Buffer.isBuffer(value) ? value.toString('hex') : value,
      ]),
    ),
  );
}

function dataKey(keyId: string): DataKey {
  return { keyId, key: randomBytes(32) };
}

// The keyrings the steps of a rotation from `old` to `new` load: `old` alone,
// both with `new` current, and `new` alone once `old` is retired.
function rotationKeyrings() {
  let oldKey = dataKey('old');
  let newKey = dataKey('new');
  return {
    before: new SecretsKeyring([oldKey], 'old'),
    during: new SecretsKeyring([newKey, oldKey], 'new'),
    after: new SecretsKeyring([newKey], 'new'),
    oldKey,
    newKey,
  };
}

module(basename(import.meta.filename), function () {
  module('the re-seal pass', function (hooks) {
    let dbAdapter: DBAdapter;

    setupDB(hooks, {
      beforeEach: async (_dbAdapter) => {
        dbAdapter = _dbAdapter;
        await createTable(dbAdapter);
      },
    });

    test('with two data keys loaded, rows sealed under either open, and new writes use the current one', async function (assert) {
      let { before, during } = rotationKeyrings();
      await writeSecret(dbAdapter, before, rowId(1));
      await writeSecret(dbAdapter, during, rowId(2));
      await writeSecret(dbAdapter, during, rowId(1), 'sk-live-replaced');

      assert.deepEqual(await readSecret(dbAdapter, during, rowId(1)), {
        keyId: 'new',
        secret: 'sk-live-replaced',
      });
      assert.deepEqual(await readSecret(dbAdapter, during, rowId(2)), {
        keyId: 'new',
        secret: secretFor(rowId(2)),
      });

      await writeSecret(dbAdapter, before, rowId(3));
      assert.deepEqual(await readSecret(dbAdapter, during, rowId(3)), {
        keyId: 'old',
        secret: secretFor(rowId(3)),
      });
    });

    test('the pass re-seals every row under the current data key, and a second pass changes nothing', async function (assert) {
      let { before, during, after } = rotationKeyrings();
      for (let i = 1; i <= 7; i++) {
        await writeSecret(dbAdapter, before, rowId(i));
      }
      await writeSecret(dbAdapter, during, rowId(8));
      let [{ secret_nonce: untouchedNonce }] = await dbAdapter.execute(
        `SELECT secret_nonce FROM ${TABLE} WHERE id = $1`,
        { bind: [rowId(8)] },
      );

      let first = await resealUnderCurrentKey(dbAdapter, during, {
        columns: [COLUMN],
        batchSize: 3,
      });
      assert.deepEqual(first, {
        currentKeyId: 'new',
        interrupted: false,
        columns: [
          { field: FIELD, resealed: 7, changedConcurrently: 0, unopenable: 0 },
        ],
      });
      assert.deepEqual(
        await keyIdsByRow(dbAdapter),
        Array(8).fill('new'),
        'every row is sealed under the current data key',
      );
      for (let i = 1; i <= 8; i++) {
        assert.strictEqual(
          (await readSecret(dbAdapter, after, rowId(i))).secret,
          secretFor(rowId(i)),
          `${rowId(i)} opens with the old data key retired`,
        );
      }
      let [{ secret_nonce: nonceAfter }] = await dbAdapter.execute(
        `SELECT secret_nonce FROM ${TABLE} WHERE id = $1`,
        { bind: [rowId(8)] },
      );
      assert.true(
        (nonceAfter as unknown as Buffer).equals(
          untouchedNonce as unknown as Buffer,
        ),
        'a row already under the current data key is left as it is',
      );

      let rowsBefore = await storedRows(dbAdapter);
      let second = await resealUnderCurrentKey(dbAdapter, during, {
        columns: [COLUMN],
        batchSize: 3,
      });
      assert.deepEqual(second.columns, [
        { field: FIELD, resealed: 0, changedConcurrently: 0, unopenable: 0 },
      ]);
      assert.deepEqual(
        await storedRows(dbAdapter),
        rowsBefore,
        'a second pass changes no row',
      );
    });

    test('a pass that is interrupted resumes where it stopped', async function (assert) {
      let { before, during } = rotationKeyrings();
      for (let i = 1; i <= 10; i++) {
        await writeSecret(dbAdapter, before, rowId(i));
      }

      let abort = new AbortController();
      let interrupted = await resealUnderCurrentKey(dbAdapter, during, {
        columns: [COLUMN],
        batchSize: 4,
        signal: abort.signal,
        onBatch: () => abort.abort(),
      });
      assert.true(interrupted.interrupted);
      assert.strictEqual(interrupted.columns[0].resealed, 4);
      assert.strictEqual(
        (await dataKeyStatus(dbAdapter, during, [COLUMN])).rowsToReseal,
        6,
        'the rows the pass had not reached are still to do',
      );

      let resumed = await resealUnderCurrentKey(dbAdapter, during, {
        columns: [COLUMN],
        batchSize: 4,
      });
      assert.false(resumed.interrupted);
      assert.strictEqual(resumed.columns[0].resealed, 6);
      assert.deepEqual(await keyIdsByRow(dbAdapter), Array(10).fill('new'));
      for (let i = 1; i <= 10; i++) {
        assert.strictEqual(
          (await readSecret(dbAdapter, during, rowId(i))).secret,
          secretFor(rowId(i)),
        );
      }
    });

    test('a write that lands while the pass holds a row is kept, not overwritten', async function (assert) {
      let { before, during } = rotationKeyrings();
      await writeSecret(dbAdapter, before, rowId(1));
      await writeSecret(dbAdapter, before, rowId(2));

      // A write to row 1 lands between the pass reading it and writing it
      // back: just before the pass's first UPDATE.
      let raced = false;
      let originalExecute = dbAdapter.execute.bind(dbAdapter);
      let execute = sinon
        .stub(dbAdapter, 'execute')
        .callsFake(async (sql, opts) => {
          if (!raced && sql.trimStart().startsWith('UPDATE')) {
            raced = true;
            await writeSecret(dbAdapter, during, rowId(1), 'sk-rotated');
          }
          return originalExecute(sql, opts);
        });
      try {
        let report = await resealUnderCurrentKey(dbAdapter, during, {
          columns: [COLUMN],
        });
        assert.deepEqual(report.columns, [
          { field: FIELD, resealed: 1, changedConcurrently: 1, unopenable: 0 },
        ]);
      } finally {
        execute.restore();
      }
      assert.deepEqual(await readSecret(dbAdapter, during, rowId(1)), {
        keyId: 'new',
        secret: 'sk-rotated',
      });
      assert.deepEqual(await readSecret(dbAdapter, during, rowId(2)), {
        keyId: 'new',
        secret: secretFor(rowId(2)),
      });
    });

    test('a row that does not open is left as it is and reported, and the pass carries on', async function (assert) {
      let { before, during } = rotationKeyrings();
      let stray = new SecretsKeyring([dataKey('stray')], 'stray');
      await writeSecret(dbAdapter, before, rowId(1));
      await writeSecret(dbAdapter, stray, rowId(2));
      await writeSecret(dbAdapter, before, rowId(3));

      let report = await resealUnderCurrentKey(dbAdapter, during, {
        columns: [COLUMN],
        batchSize: 1,
      });
      assert.deepEqual(report.columns, [
        { field: FIELD, resealed: 2, changedConcurrently: 0, unopenable: 1 },
      ]);
      assert.deepEqual(await keyIdsByRow(dbAdapter), ['new', 'stray', 'new']);

      let status = await dataKeyStatus(dbAdapter, during, [COLUMN]);
      assert.deepEqual(status.unloadedKeyIds, ['stray']);
      assert.deepEqual(status.retirableKeyIds, ['old']);
    });

    test('status reports the rows under each data key, and an old data key becomes retirable once no row references it', async function (assert) {
      let { before, during } = rotationKeyrings();
      for (let i = 1; i <= 3; i++) {
        await writeSecret(dbAdapter, before, rowId(i));
      }
      await writeSecret(dbAdapter, during, rowId(4));

      let status = await dataKeyStatus(dbAdapter, during, [COLUMN]);
      assert.deepEqual(status, {
        currentKeyId: 'new',
        loadedKeyIds: ['new', 'old'],
        columns: [{ field: FIELD, rowsByKeyId: { old: 3, new: 1 } }],
        rowsToReseal: 3,
        retirableKeyIds: [],
        unloadedKeyIds: [],
      });

      await resealUnderCurrentKey(dbAdapter, during, { columns: [COLUMN] });
      status = await dataKeyStatus(dbAdapter, during, [COLUMN]);
      assert.deepEqual(status.columns, [
        { field: FIELD, rowsByKeyId: { new: 4 } },
      ]);
      assert.strictEqual(status.rowsToReseal, 0);
      assert.deepEqual(status.retirableKeyIds, ['old']);
    });
  });

  module('operator tokens', function () {
    test('neither the realm token verifier nor the realm-server session verifier accepts an operator token', function (assert) {
      let token = jsonwebtoken.sign(
        { operator: 'data-keys' },
        realmSecretSeed,
        {
          expiresIn: '5m',
        },
      );
      assert.throws(
        () => verifyJWT(token, realmSecretSeed),
        /an operator token is not a realm session/,
      );
      assert.throws(
        () => retrieveTokenClaim(`Bearer ${token}`, realmSecretSeed),
        /Token invalid/,
      );
      assert.strictEqual(
        verifyOperatorToken(`Bearer ${token}`, realmSecretSeed, 'data-keys')
          .operator,
        'data-keys',
        'the same token is good on its own endpoints',
      );
    });
  });

  module('the data-keys operator endpoints', function (hooks) {
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

    let keyrings: ReturnType<typeof rotationKeyrings>;
    // The registered columns while a test runs are this module's own, so
    // what the endpoints report is the test table alone.
    let registeredColumns: SealedColumn[] = [];

    // The forward reaches a real socket, the stub vendor on loopback, so it
    // passes through the outbound guard as a deployed forward does.
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
           VALUES (gen_random_uuid(), '${vendor.url}/', 'stub-vendor-key', 'no-credit', false, NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        );
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

        await createTable(dbAdapter);
        registeredColumns = SEALED_COLUMNS.splice(
          0,
          SEALED_COLUMNS.length,
          COLUMN,
        );
        keyrings = rotationKeyrings();
        for (let i = 1; i <= 6; i++) {
          await writeSecret(dbAdapter, keyrings.before, rowId(i));
        }
        installSecretsKeyring({
          keys: [
            { keyId: 'new', key: Buffer.from(keyrings.newKey.key) },
            { keyId: 'old', key: Buffer.from(keyrings.oldKey.key) },
          ],
          currentKeyId: 'new',
        });
      },
      afterEach: async () => {
        await resetResealPass();
        SEALED_COLUMNS.splice(0, SEALED_COLUMNS.length, ...registeredColumns);
        resetSecretsAtRest();
        resetOutbound();
        await stopRealmServer();
      },
    });

    function operatorToken(
      claims: Record<string, unknown> = { operator: 'data-keys' },
      expiresIn: jsonwebtoken.SignOptions['expiresIn'] = '5m',
    ): string {
      return jsonwebtoken.sign(claims, realmSecretSeed, { expiresIn });
    }

    test('status reports the loaded data keys and the rows each one sealed', async function (assert) {
      let response = await request
        .get('/_data-keys')
        .set('Authorization', `Bearer ${operatorToken()}`);
      assert.strictEqual(response.status, 200);
      assert.deepEqual(response.body, {
        currentKeyId: 'new',
        loadedKeyIds: ['new', 'old'],
        columns: [{ field: FIELD, rowsByKeyId: { old: 6 } }],
        rowsToReseal: 6,
        retirableKeyIds: [],
        unloadedKeyIds: [],
        pass: { running: false },
      });
      assert.false(
        JSON.stringify(response.body).includes('sk-live'),
        'no value is reported',
      );
    });

    test('only an operator token for data-keys reaches the endpoints', async function (assert) {
      let session = createRealmServerJWT(
        { user: '@testuser:localhost', sessionRoom: 'session-room' },
        realmSecretSeed,
      );
      let refused: [string, string | undefined][] = [
        ['no token', undefined],
        ['a user session', session],
        ['another operator family', operatorToken({ operator: 'system-keys' })],
        [
          'an operator token that names a user',
          operatorToken({ operator: 'data-keys', user: '@testuser:localhost' }),
        ],
        [
          'an operator token that lives for more than 15 minutes',
          operatorToken({ operator: 'data-keys' }, '1h'),
        ],
        [
          'an operator token dated in the future',
          (() => {
            let iat = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
            return jsonwebtoken.sign(
              { operator: 'data-keys', iat, exp: iat + 5 * 60 },
              realmSecretSeed,
            );
          })(),
        ],
        [
          'an operator token signed with another seed',
          jsonwebtoken.sign({ operator: 'data-keys' }, 'another seed', {
            expiresIn: '5m',
          }),
        ],
      ];
      for (let [label, token] of refused) {
        for (let call of [
          request.get('/_data-keys'),
          request.post('/_data-keys/reseal?currentKeyId=new'),
        ]) {
          let response = await (token
            ? call.set('Authorization', `Bearer ${token}`)
            : call);
          assert.strictEqual(response.status, 401, `${label} is refused`);
        }
      }
      assert.strictEqual(
        (await dataKeyStatus(dbAdapter, keyrings.during, [COLUMN]))
          .rowsToReseal,
        6,
        'no refused call started a pass',
      );
    });

    test('an operator token is not a user session', async function (assert) {
      let response = await request
        .get('/_user')
        .set('Accept', 'application/vnd.api+json')
        .set('Authorization', `Bearer ${operatorToken()}`);
      assert.strictEqual(response.status, 401);
    });

    test('a server whose current data key is not the one the operator names refuses to start a pass', async function (assert) {
      let mismatched = await request
        .post('/_data-keys/reseal?currentKeyId=old')
        .set('Authorization', `Bearer ${operatorToken()}`);
      assert.strictEqual(mismatched.status, 409);
      assert.strictEqual(mismatched.body.currentKeyId, 'new');

      let unnamed = await request
        .post('/_data-keys/reseal')
        .set('Authorization', `Bearer ${operatorToken()}`);
      assert.strictEqual(unnamed.status, 400);

      assert.false(currentResealPass().state.running);
      assert.strictEqual(
        (await dataKeyStatus(dbAdapter, keyrings.during, [COLUMN]))
          .rowsToReseal,
        6,
        'no row was re-sealed',
      );
    });

    test('a pass started through the endpoint re-seals every row, and _request-forward keeps working while it runs', async function (assert) {
      let release!: () => void;
      let gate = new Promise<void>((resolve) => (release = resolve));
      let held!: () => void;
      let holding = new Promise<void>((resolve) => (held = resolve));
      let batches = 0;
      configureResealPass({
        batchSize: 2,
        onBatch: async () => {
          if (++batches === 1) {
            held();
            await gate;
          }
        },
      });

      let response = await request
        .post('/_data-keys/reseal?currentKeyId=new')
        .set('Authorization', `Bearer ${operatorToken()}`);
      assert.strictEqual(response.status, 202);
      assert.true(response.body.started);
      await holding;

      let again = await request
        .post('/_data-keys/reseal?currentKeyId=new')
        .set('Authorization', `Bearer ${operatorToken()}`);
      assert.strictEqual(again.status, 202);
      assert.false(again.body.started, 'one pass runs at a time');
      assert.true(again.body.pass.running);

      let jwt = createRealmServerJWT(
        { user: '@testuser:localhost', sessionRoom: 'session-room' },
        realmSecretSeed,
      );
      let forwarded = await request
        .post('/_request-forward')
        .set('Accept', 'application/json')
        .set('Content-Type', 'application/json')
        .set('Authorization', `Bearer ${jwt}`)
        .send({
          url: `${vendor.url}/echo`,
          method: 'POST',
          requestBody: JSON.stringify({}),
        });
      assert.strictEqual(
        forwarded.status,
        200,
        '_request-forward answers while the pass is part way through',
      );
      assert.strictEqual(
        vendor.requests[0]?.headers.authorization,
        'Bearer stub-vendor-key',
        'the vendor received the system key',
      );

      let midway = await dataKeyStatus(dbAdapter, keyrings.during, [COLUMN]);
      assert.strictEqual(midway.rowsToReseal, 4, 'the pass is held part way');

      release();
      await currentResealPass().done;

      let status = await request
        .get('/_data-keys')
        .set('Authorization', `Bearer ${operatorToken()}`);
      assert.strictEqual(status.body.rowsToReseal, 0);
      assert.deepEqual(status.body.columns, [
        { field: FIELD, rowsByKeyId: { new: 6 } },
      ]);
      assert.deepEqual(status.body.retirableKeyIds, ['old']);
      assert.false(status.body.pass.running);
      assert.deepEqual(status.body.pass.report.columns, [
        { field: FIELD, resealed: 6, changedConcurrently: 0, unopenable: 0 },
      ]);
      for (let i = 1; i <= 6; i++) {
        assert.strictEqual(
          (await readSecret(dbAdapter, keyrings.after, rowId(i))).secret,
          secretFor(rowId(i)),
        );
      }
    });
  });
});
