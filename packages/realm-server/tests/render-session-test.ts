import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename, join } from 'path';
import supertest from 'supertest';
import type { SuperTest, Test } from 'supertest';
import { dirSync } from 'tmp';
import fsExtra from 'fs-extra';
const { copySync, ensureDirSync } = fsExtra;
import jsonwebtoken from 'jsonwebtoken';
import {
  renderSessionSecret,
  SupportedMimeType,
} from '@cardstack/runtime-common';
import type { RealmHttpServer as Server } from '../server.ts';
import {
  closeServer,
  createVirtualNetwork,
  fixtureDir,
  matrixURL,
  realmSecretSeed,
  runTestRealmServer,
  setupDB,
  setupTestDatabaseTemplate,
  testRealmServerMatrixUserId,
} from './helpers/index.ts';
import {
  buildCreatePrerenderAuth,
  renderSessionLifetimeSeconds,
} from '../prerender/auth.ts';
import { revokeUserSessions } from '@cardstack/runtime-common/db-queries/user-queries';
import type { PgAdapter } from '@cardstack/postgres';

// The render session: what a render tab holds when a realm renders its own
// cards, whose output is kept and served to others. The tab runs code anyone
// who may write the realm can put there, an OAuth app among them, so the
// session only reads, and is good nowhere but a realm's reads and the
// federated read endpoints.

const SERVER_ORIGIN = 'http://127.0.0.1:4445';
const REALM_URL = `${SERVER_ORIGIN}/test/`;
const OWNER = '@owner:localhost';

const createPrerenderAuth = buildCreatePrerenderAuth(
  realmSecretSeed,
  SERVER_ORIGIN,
);

// The session the indexer's render of this realm holds for it.
function renderSession(user = OWNER): string {
  return JSON.parse(
    createPrerenderAuth(
      user,
      { [REALM_URL]: ['read', 'write', 'realm-owner'] },
      { realmAuthority: true },
    ),
  )[REALM_URL];
}

module(basename(import.meta.filename), function () {
  module('a render session', function (hooks) {
    let testRealmHttpServer: Server;
    let testRealm: any;
    let request: SuperTest<Test>;
    let dbAdapter: PgAdapter;
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
        realmURL: new URL(REALM_URL),
        permissions: { [OWNER]: ['read', 'write', 'realm-owner'] },
        dbAdapter,
        publisher,
        runner,
        matrixURL,
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
      beforeEach: async (_dbAdapter, publisher, runner) => {
        dbAdapter = _dbAdapter;
        await startRealmServer(dbAdapter, publisher, runner);
      },
      afterEach: stopRealmServer,
    });

    function readCard(session: string) {
      return request
        .get('/test/person-1')
        .set('Accept', SupportedMimeType.CardJson)
        .set('Authorization', `Bearer ${session}`);
    }

    function searchRealm(session: string) {
      return request
        .post('/test/_search')
        .set('Accept', SupportedMimeType.CardJson)
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Authorization', `Bearer ${session}`)
        .send({});
    }

    function writeSource(session: string, assumeUser?: string) {
      let pending = request
        .post('/test/written.gts')
        .set('Accept', 'application/vnd.card+source')
        .set('Authorization', `Bearer ${session}`);
      if (assumeUser) {
        pending = pending.set('X-Boxel-Assume-User', assumeUser);
      }
      return pending.send('export const written = true;');
    }

    function federatedInfo(session: string) {
      return request
        .post('/_federated-info')
        .set('Accept', SupportedMimeType.JSONAPI)
        .set('Content-Type', 'application/json')
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Authorization', `Bearer ${session}`)
        .send({ realms: [REALM_URL] });
    }

    test('it is signed under its own key and lasts as long as the longest job that renders under it', function (assert) {
      let session = renderSession();
      assert.throws(
        () => jsonwebtoken.verify(session, realmSecretSeed),
        'the bare realm seed does not verify it',
      );
      let claims = jsonwebtoken.verify(
        session,
        renderSessionSecret(realmSecretSeed),
      ) as jsonwebtoken.JwtPayload;
      assert.deepEqual(claims.renderSession, { scope: 'owner-read-set' });
      assert.true(claims.realmAuthority);
      assert.strictEqual(
        claims.exp! - claims.iat!,
        renderSessionLifetimeSeconds(),
      );
      assert.true(
        renderSessionLifetimeSeconds() < 24 * 60 * 60,
        'it lasts less than a day',
      );
    });

    test('it reads, as the user it names', async function (assert) {
      let session = renderSession();
      assert.strictEqual((await readCard(session)).status, 200, 'a card');
      assert.strictEqual(
        (await searchRealm(session)).status,
        200,
        'a search sent as a QUERY',
      );
      assert.strictEqual(
        (await federatedInfo(session)).status,
        200,
        'a federated read',
      );
    });

    test('it writes nothing, whatever the user it names may do, and assumes no other user', async function (assert) {
      let session = renderSession();
      assert.strictEqual(
        (await writeSource(session)).status,
        403,
        'a source write is refused',
      );
      assert.strictEqual(
        (await writeSource(session, OWNER)).status,
        403,
        'a source write naming a user to assume is refused',
      );
      let operations = await request
        .post('/test/_operations')
        .set('Accept', SupportedMimeType.BoxelOperations)
        .set('Content-Type', SupportedMimeType.BoxelOperations)
        .set('Authorization', `Bearer ${session}`)
        .send(
          JSON.stringify({
            'atomic:operations': [
              {
                op: 'remove',
                href: `${REALM_URL}person-1.json`,
              },
            ],
          }),
        );
      assert.strictEqual(operations.status, 403, 'a write batch is refused');
      let deletion = await request
        .delete('/test/person-1')
        .set('Accept', SupportedMimeType.CardJson)
        .set('Authorization', `Bearer ${session}`);
      assert.strictEqual(deletion.status, 403, 'a delete is refused');
      assert.strictEqual(
        (await readCard(session)).status,
        200,
        'the card is still there',
      );
      let written = await request
        .get('/test/written.gts')
        .set('Accept', 'application/vnd.card+source')
        .set('Authorization', `Bearer ${session}`);
      assert.strictEqual(written.status, 404, 'no module was written');
    });

    test('it is good at no realm-server route that acts as its user', async function (assert) {
      let session = renderSession();
      let realmAuth = await request
        .post('/_realm-auth')
        .set('Accept', SupportedMimeType.JSON)
        .set('Authorization', `Bearer ${session}`);
      assert.strictEqual(
        realmAuth.status,
        401,
        'it is not exchanged for sessions at _realm-auth',
      );
      for (let path of ['/_user', '/_user-keys']) {
        let response = await request
          .get(path)
          .set('Accept', SupportedMimeType.JSON)
          .set('Authorization', `Bearer ${session}`);
        assert.strictEqual(response.status, 401, `${path} refuses it`);
      }
      let forward = await request
        .post('/_request-forward')
        .set('Content-Type', 'application/json')
        .set('Authorization', `Bearer ${session}`)
        .send({ url: 'https://example.com/', method: 'GET' });
      assert.strictEqual(forward.status, 401, '_request-forward refuses it');
    });

    test('it reads only while the user it names may', async function (assert) {
      let stranger = renderSession('@stranger:localhost');
      assert.strictEqual(
        (await readCard(stranger)).status,
        403,
        'a realm refuses one for a user who may not read it',
      );
      assert.strictEqual(
        (await federatedInfo(stranger)).status,
        403,
        'the federated endpoints refuse it too',
      );
    });

    test("the realm's own Matrix account's session reads, as a realm with no human owner renders", async function (assert) {
      let session = renderSession(testRealmServerMatrixUserId);
      assert.strictEqual((await readCard(session)).status, 200);
      assert.strictEqual((await writeSource(session)).status, 403);
    });

    test('a token claiming to be a render session under the bare realm seed is refused', async function (assert) {
      let forged = jsonwebtoken.sign(
        {
          user: OWNER,
          realm: REALM_URL,
          permissions: ['read'],
          sessionRoom: '',
          realmServerURL: `${SERVER_ORIGIN}/`,
          realmAuthority: true,
          renderSession: { scope: 'owner-read-set' },
        },
        realmSecretSeed,
        { expiresIn: '1h' },
      );
      assert.strictEqual((await readCard(forged)).status, 401, 'a realm');
      assert.strictEqual(
        (await federatedInfo(forged)).status,
        401,
        'the federated endpoints',
      );
    });

    test('an expired render session is refused', async function (assert) {
      let now = Math.floor(Date.now() / 1000);
      let expired = jsonwebtoken.sign(
        {
          user: OWNER,
          realm: REALM_URL,
          permissions: ['read'],
          sessionRoom: '',
          realmServerURL: `${SERVER_ORIGIN}/`,
          realmAuthority: true,
          renderSession: { scope: 'owner-read-set' },
          iat: now - 120,
          exp: now - 60,
        },
        renderSessionSecret(realmSecretSeed),
      );
      assert.strictEqual((await readCard(expired)).status, 401);
    });

    test("revoking the user's sessions refuses a render session minted before it", async function (assert) {
      let now = Math.floor(Date.now() / 1000);
      let session = jsonwebtoken.sign(
        {
          user: OWNER,
          realm: REALM_URL,
          permissions: ['read'],
          sessionRoom: '',
          realmServerURL: `${SERVER_ORIGIN}/`,
          realmAuthority: true,
          renderSession: { scope: 'owner-read-set' },
          iat: now - 60,
          exp: now + 600,
        },
        renderSessionSecret(realmSecretSeed),
      );
      assert.strictEqual((await readCard(session)).status, 200);
      await revokeUserSessions(dbAdapter, OWNER);
      assert.strictEqual((await readCard(session)).status, 401, 'a realm');
      assert.strictEqual(
        (await federatedInfo(session)).status,
        401,
        'the federated endpoints',
      );
    });

    module('on a realm anyone may read and write', function (hooks) {
      hooks.beforeEach(async function () {
        await dbAdapter.execute(
          `INSERT INTO realm_user_permissions (realm_url, username, read, write, realm_owner) VALUES ($1, '*', true, true, false)`,
          { bind: [REALM_URL] },
        );
      });

      test('a write presented with a render session is refused rather than taken as anonymous', async function (assert) {
        let session = renderSession();
        assert.strictEqual((await readCard(session)).status, 200);
        assert.strictEqual(
          (await writeSource(session)).status,
          403,
          'a source write is refused',
        );
        let now = Math.floor(Date.now() / 1000);
        let expired = jsonwebtoken.sign(
          {
            user: OWNER,
            realm: REALM_URL,
            permissions: ['read'],
            sessionRoom: '',
            realmServerURL: `${SERVER_ORIGIN}/`,
            realmAuthority: true,
            renderSession: { scope: 'owner-read-set' },
            iat: now - 120,
            exp: now - 60,
          },
          renderSessionSecret(realmSecretSeed),
        );
        assert.strictEqual(
          (await writeSource(expired)).status,
          403,
          'one that has expired too',
        );
      });
    });
  });
});
