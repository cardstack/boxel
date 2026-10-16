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
import {
  DIAGNOSTIC_SESSION_LIFETIME_SEC,
  DIAGNOSTIC_SESSION_LOG_CHANNEL,
  diagnosticSessionSecret,
  logger,
  SupportedMimeType,
} from '@cardstack/runtime-common';
import type { RealmHttpServer as Server } from '../server.ts';
import {
  closeServer,
  createJWT,
  createVirtualNetwork,
  fixtureDir,
  realmSecretSeed,
  runTestRealmServer,
  setupDB,
  setupTestDatabaseTemplate,
} from './helpers/index.ts';
import { createJWT as createRealmServerJWT } from '../utils/jwt.ts';

const SERVER_ORIGIN = 'http://127.0.0.1:4445';
const REALM_URL = `${SERVER_ORIGIN}/test/`;
const CARD_URL = `${REALM_URL}person-1`;
const OWNER = '@owner:localhost';
const NOTE = 'a staff engineer, profiling a slow render';

module(basename(import.meta.filename), function () {
  module('the diagnostic-render operator endpoint', function (hooks) {
    let testRealmHttpServer: Server;
    let testRealm: any;
    let request: SuperTest<Test>;
    let virtualNetwork = createVirtualNetwork();
    let diagnosticLog = logger(DIAGNOSTIC_SESSION_LOG_CHANNEL);
    let logged: string[];

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
        realmURL: new URL(REALM_URL),
        permissions: { [OWNER]: ['read', 'write', 'realm-owner'] },
        dbAdapter,
        publisher,
        runner,
        matrixURL: new URL('http://localhost:8008'),
      }));
      request = supertest(testRealmHttpServer);
    }

    async function stopRealmServer() {
      await closeServer(testRealmHttpServer);
    }

    let templateDatabase = setupTestDatabaseTemplate(hooks, {
      key: import.meta.filename,
      build: async ({ dbAdapter, publisher, runner }) => {
        await startRealmServer(dbAdapter, publisher, runner);
        return stopRealmServer;
      },
    });

    setupDB(hooks, {
      templateDatabase,
      beforeEach: async (dbAdapter, publisher, runner) => {
        await startRealmServer(dbAdapter, publisher, runner);
        logged = [];
        sinon.stub(diagnosticLog, 'info').callsFake((...args: unknown[]) => {
          logged.push(args.map(String).join(' '));
        });
      },
      afterEach: async () => {
        sinon.restore();
        await stopRealmServer();
      },
    });

    function operatorToken(
      claims: Record<string, unknown> = { operator: 'diagnostic-render' },
    ): string {
      return jsonwebtoken.sign(claims, realmSecretSeed, {
        expiresIn: '5m',
        audience: SERVER_ORIGIN,
      });
    }

    async function mint(body: Record<string, unknown> = {}) {
      return await request
        .post('/_diagnostic-render-token')
        .set('Authorization', `Bearer ${operatorToken()}`)
        .set('Content-Type', 'application/json')
        .send({ card: CARD_URL, note: NOTE, realmOnly: true, ...body });
    }

    async function mintedSession(): Promise<string> {
      let response = await mint();
      return JSON.parse(response.body.session)[REALM_URL];
    }

    // A diagnostic session signed as the endpoint signs one, with claims the
    // test chooses.
    function diagnosticSession(
      claims: Record<string, unknown> = {},
      expiresIn: number = DIAGNOSTIC_SESSION_LIFETIME_SEC,
    ): string {
      return jsonwebtoken.sign(
        {
          user: OWNER,
          realm: REALM_URL,
          permissions: ['read'],
          sessionRoom: '',
          realmServerURL: `${SERVER_ORIGIN}/`,
          realmAuthority: true,
          diagnostic: {
            id: 'a-mint',
            note: NOTE,
            card: CARD_URL,
            realms: [REALM_URL],
          },
          ...claims,
        },
        diagnosticSessionSecret(realmSecretSeed),
        { expiresIn },
      );
    }

    function readCard(session: string) {
      return request
        .get('/test/person-1')
        .set('Accept', SupportedMimeType.CardJson)
        .set('Authorization', `Bearer ${session}`);
    }

    test('issues a read-only session for the realm that holds the card, reading as its owner', async function (assert) {
      let response = await mint();
      assert.strictEqual(response.status, 201, 'the mint is created');
      let body = response.body;
      assert.strictEqual(body.card, CARD_URL);
      assert.strictEqual(body.realm, REALM_URL);
      assert.strictEqual(body.user, OWNER, 'it reads as the realm owner');
      assert.deepEqual(body.realms, [REALM_URL]);
      assert.strictEqual(
        body.hostURL,
        'http://example.com/notional-assets-host/',
        'it names the host app the render route is served from',
      );
      assert.strictEqual(
        Date.parse(body.expiresAt) - Date.parse(body.mintedAt),
        DIAGNOSTIC_SESSION_LIFETIME_SEC * 1000,
        'it lives for minutes',
      );
      let sessions = JSON.parse(body.session);
      assert.deepEqual(Object.keys(sessions), [REALM_URL]);
      let claims = jsonwebtoken.verify(
        sessions[REALM_URL],
        diagnosticSessionSecret(realmSecretSeed),
      ) as Record<string, any>;
      assert.deepEqual(claims.permissions, ['read']);
      assert.true(claims.realmAuthority);
      assert.deepEqual(claims.diagnostic, {
        id: body.id,
        note: NOTE,
        card: CARD_URL,
        realms: [REALM_URL],
      });
      assert.strictEqual(
        claims.exp - claims.iat,
        DIAGNOSTIC_SESSION_LIFETIME_SEC,
      );
      assert.true(
        logged.some(
          (line) =>
            line.includes(`diagnostic session ${body.id} minted`) &&
            line.includes(CARD_URL) &&
            line.includes(NOTE),
        ),
        'the mint is logged with the card and the operator note',
      );
    });

    test('without realmOnly, the session covers every realm the owner may read', async function (assert) {
      let response = await mint({ realmOnly: undefined });
      assert.strictEqual(response.status, 201);
      assert.true(response.body.realms.includes(REALM_URL));
      assert.true(
        response.body.realms.length > 1,
        'the public realms the owner reads are covered too',
      );
      assert.deepEqual(
        Object.keys(JSON.parse(response.body.session)).length,
        response.body.realms.length,
        'one session per realm',
      );
    });

    test('only an operator token for diagnostic-render reaches the endpoint', async function (assert) {
      for (let authorization of [
        undefined,
        `Bearer ${operatorToken({ operator: 'system-keys' })}`,
        `Bearer ${createRealmServerJWT({ user: OWNER, sessionRoom: 'room' }, realmSecretSeed)}`,
        `Bearer ${createJWT(testRealm, OWNER, ['read', 'write', 'realm-owner'])}`,
        `Bearer ${diagnosticSession()}`,
      ]) {
        let pending = request
          .post('/_diagnostic-render-token')
          .set('Content-Type', 'application/json');
        if (authorization) {
          pending = pending.set('Authorization', authorization);
        }
        let response = await pending.send({ card: CARD_URL, note: NOTE });
        assert.strictEqual(response.status, 401, `${authorization} is refused`);
      }
    });

    test('a mint needs a note and a card on this server', async function (assert) {
      assert.strictEqual((await mint({ note: ' ' })).status, 400);
      assert.strictEqual((await mint({ note: undefined })).status, 400);
      assert.strictEqual((await mint({ card: 'not a url' })).status, 400);
      assert.strictEqual(
        (await mint({ card: 'http://127.0.0.1:4445/elsewhere/card' })).status,
        404,
      );
    });

    test('the session reads a card, and each use is logged with its mint', async function (assert) {
      let response = await mint();
      let session = JSON.parse(response.body.session)[REALM_URL];
      let read = await readCard(session);
      assert.strictEqual(read.status, 200, 'the card is read');
      assert.true(
        logged.some(
          (line) =>
            line.includes(`diagnostic session ${response.body.id} read GET`) &&
            line.includes('/test/person-1') &&
            line.includes(OWNER) &&
            line.includes(NOTE),
        ),
        'the read is logged with the mint id, the reader and the note',
      );
    });

    test('the session cannot write', async function (assert) {
      let session = await mintedSession();
      let write = await request
        .post('/test/written.gts')
        .set('Accept', 'application/vnd.card+source')
        .set('Authorization', `Bearer ${session}`)
        .send('export const written = true;');
      assert.strictEqual(write.status, 403, 'a source write is refused');
      let deletion = await request
        .delete('/test/person-1')
        .set('Accept', SupportedMimeType.CardJson)
        .set('Authorization', `Bearer ${session}`);
      assert.strictEqual(deletion.status, 403, 'a delete is refused');
      let stillThere = await readCard(session);
      assert.strictEqual(stillThere.status, 200, 'the card is still there');
    });

    test('the session reaches no realm-server route outside the federated reads', async function (assert) {
      let session = await mintedSession();
      for (let path of ['/_user', '/_user-keys']) {
        let response = await request
          .get(path)
          .set('Accept', SupportedMimeType.JSON)
          .set('Authorization', `Bearer ${session}`);
        assert.strictEqual(response.status, 401, `${path} refuses it`);
      }
      let realmAuth = await request
        .post('/_realm-auth')
        .set('Accept', SupportedMimeType.JSON)
        .set('Authorization', `Bearer ${session}`);
      assert.strictEqual(realmAuth.status, 401, '_realm-auth refuses it');
      let forward = await request
        .post('/_request-forward')
        .set('Content-Type', 'application/json')
        .set('Authorization', `Bearer ${session}`)
        .send({ url: 'https://example.com/', method: 'GET' });
      assert.strictEqual(forward.status, 401, '_request-forward refuses it');
    });

    test('the session reads through the federated endpoints only for the realms it was issued for', async function (assert) {
      let session = await mintedSession();
      let info = await request
        .post('/_federated-info')
        .set('Accept', SupportedMimeType.JSONAPI)
        .set('Content-Type', 'application/json')
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Authorization', `Bearer ${session}`)
        .send({ realms: [REALM_URL] });
      assert.strictEqual(info.status, 200, 'its own realm is answered');
      let elsewhere = await request
        .post('/_federated-info')
        .set('Accept', SupportedMimeType.JSONAPI)
        .set('Content-Type', 'application/json')
        .set('X-HTTP-Method-Override', 'QUERY')
        .set(
          'Authorization',
          `Bearer ${diagnosticSession({ diagnostic: { id: 'a-mint', note: NOTE, card: CARD_URL, realms: [`${SERVER_ORIGIN}/other/`] } })}`,
        )
        .send({ realms: [REALM_URL] });
      assert.strictEqual(
        elsewhere.status,
        401,
        'a session not issued for the realm is refused',
      );
    });

    test('a realm refuses a session not issued for it', async function (assert) {
      let response = await readCard(
        diagnosticSession({
          diagnostic: {
            id: 'a-mint',
            note: NOTE,
            card: CARD_URL,
            realms: [`${SERVER_ORIGIN}/other/`],
          },
        }),
      );
      assert.strictEqual(response.status, 401);
    });

    test('a session expires on time, and one claiming a longer life is refused', async function (assert) {
      let clock = sinon.useFakeTimers({
        now: Date.now(),
        shouldAdvanceTime: true,
        toFake: ['Date'],
      });
      try {
        let session = await mintedSession();
        assert.strictEqual((await readCard(session)).status, 200);
        clock.tick((DIAGNOSTIC_SESSION_LIFETIME_SEC + 1) * 1000);
        assert.strictEqual(
          (await readCard(session)).status,
          401,
          'the session is refused once it has expired',
        );
      } finally {
        clock.restore();
      }
      assert.strictEqual(
        (await readCard(diagnosticSession({}, 24 * 60 * 60))).status,
        401,
        'a day-long diagnostic session is refused',
      );
    });

    test('a session signed with the bare realm seed is not a diagnostic session', async function (assert) {
      let forged = jsonwebtoken.sign(
        {
          user: OWNER,
          realm: REALM_URL,
          permissions: ['read'],
          sessionRoom: '',
          realmServerURL: `${SERVER_ORIGIN}/`,
          diagnostic: {
            id: 'a-mint',
            note: NOTE,
            card: CARD_URL,
            realms: [REALM_URL],
          },
        },
        realmSecretSeed,
        { expiresIn: DIAGNOSTIC_SESSION_LIFETIME_SEC },
      );
      assert.strictEqual((await readCard(forged)).status, 401);
    });
  });
});
