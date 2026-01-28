import { module, test } from 'qunit';
import { basename, join } from 'path';
import type { Test, SuperTest } from 'supertest';
import supertest from 'supertest';
import { dirSync, type DirResult } from 'tmp';
import { copySync, ensureDirSync } from 'fs-extra';
import type { Server } from 'http';
import jwt from 'jsonwebtoken';
import { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import type { RealmServerTokenClaim } from '../../utils/jwt';
import {
  closeServer,
  createVirtualNetwork,
  matrixURL,
  realmSecretSeed,
  realmServerTestMatrix,
  runTestRealmServer,
  setupDB,
  testRealmURL,
} from '../helpers';
import { createRealmServerSession } from './helpers';
import '@cardstack/runtime-common/helpers/code-equality-assertion';

module(`server-endpoints/${basename(__filename)}`, function () {
  module('Realm server authentication', function (hooks) {
    let testRealmServer: Server;
    let request: SuperTest<Test>;
    let dir: DirResult;

    hooks.beforeEach(async function () {
      dir = dirSync();
    });

    setupDB(hooks, {
      beforeEach: async (dbAdapter, publisher, runner) => {
        let testRealmDir = join(dir.name, 'realm_server_5', 'test');
        ensureDirSync(testRealmDir);
        copySync(join(__dirname, '..', 'cards'), testRealmDir);
        testRealmServer = (
          await runTestRealmServer({
            virtualNetwork: createVirtualNetwork(),
            testRealmDir,
            realmsRootPath: join(dir.name, 'realm_server_5'),
            realmURL: testRealmURL,
            dbAdapter,
            publisher,
            runner,
            matrixURL,
          })
        ).testRealmHttpServer;
        request = supertest(testRealmServer);
      },
      afterEach: async () => {
        await closeServer(testRealmServer);
      },
    });

    test('authenticates user', async function (assert) {
      let matrixClient = new MatrixClient({
        matrixURL: realmServerTestMatrix.url,
        // it's a little awkward that we are hijacking a realm user to pretend to
        // act like a normal user, but that's what's happening here
        username: 'test_realm',
        seed: realmSecretSeed,
      });
      await matrixClient.login();
      let userId = matrixClient.getUserId();

      let { jwt: token, status } = await createRealmServerSession(
        matrixClient,
        request,
      );

      assert.strictEqual(status, 201, 'HTTP 201 status');
      let decoded = jwt.verify(token, realmSecretSeed) as RealmServerTokenClaim;
      assert.strictEqual(decoded.user, userId);
      assert.notStrictEqual(
        decoded.sessionRoom,
        undefined,
        'sessionRoom should be defined',
      );
    });
  });
});
