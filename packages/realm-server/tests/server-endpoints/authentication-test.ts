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
import {
  getUserByMatrixUserId,
  sumUpCreditsLedger,
} from '@cardstack/billing/billing-queries';
import type { PgAdapter } from '@cardstack/postgres';
import '@cardstack/runtime-common/helpers/code-equality-assertion';

module(`server-endpoints/${basename(__filename)}`, function () {
  module('Realm server authentication', function (hooks) {
    let testRealmServer: Server;
    let request: SuperTest<Test>;
    let dir: DirResult;
    let dbAdapter: PgAdapter;
    let originalLowCreditThreshold: string | undefined;

    hooks.beforeEach(async function () {
      originalLowCreditThreshold = process.env.LOW_CREDIT_THRESHOLD;
      process.env.LOW_CREDIT_THRESHOLD = '2000';
      dir = dirSync();
    });

    hooks.afterEach(async function () {
      if (originalLowCreditThreshold == null) {
        delete process.env.LOW_CREDIT_THRESHOLD;
      } else {
        process.env.LOW_CREDIT_THRESHOLD = originalLowCreditThreshold;
      }
    });

    setupDB(hooks, {
      beforeEach: async (_dbAdapter, publisher, runner) => {
        dbAdapter = _dbAdapter;
        let testRealmDir = join(dir.name, 'realm_server_5', 'test');
        ensureDirSync(testRealmDir);
        copySync(join(__dirname, '..', 'cards'), testRealmDir);
        testRealmServer = (
          await runTestRealmServer({
            virtualNetwork: createVirtualNetwork(),
            testRealmDir,
            realmsRootPath: join(dir.name, 'realm_server_5'),
            realmURL: testRealmURL,
            permissions: {
              '@test_realm:localhost': ['read', 'realm-owner'],
            },
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

    test('authenticates user and lazy-creates them in DB', async function (assert) {
      let matrixClient = new MatrixClient({
        matrixURL: realmServerTestMatrix.url,
        // it's a little awkward that we are hijacking a realm user to pretend to
        // act like a normal user, but that's what's happening here
        username: 'test_realm',
        seed: realmSecretSeed,
      });
      await matrixClient.login();
      let userId = matrixClient.getUserId()!;

      // User should not exist before session creation
      let userBefore = await getUserByMatrixUserId(dbAdapter, userId);
      assert.notOk(userBefore, 'User does not exist before session creation');

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

      // User should now exist in DB (lazy-created during session creation)
      let user = await getUserByMatrixUserId(dbAdapter, userId);
      assert.ok(user, 'User was lazy-created during session creation');

      // Initial daily credits should have been granted
      let dailyCredits = await sumUpCreditsLedger(dbAdapter, {
        userId: user!.id,
        creditType: 'daily_credit',
      });
      assert.strictEqual(
        dailyCredits,
        2000,
        'Daily credits were granted to lazy-created user',
      );

      // Creating another session should not duplicate the user or credits
      let { status: status2 } = await createRealmServerSession(
        matrixClient,
        request,
      );
      assert.strictEqual(status2, 201, 'Second session creation succeeds');

      let dailyCreditsAfter = await sumUpCreditsLedger(dbAdapter, {
        userId: user!.id,
        creditType: 'daily_credit',
      });
      assert.strictEqual(
        dailyCreditsAfter,
        2000,
        'Daily credits were not doubled on second session',
      );
    });
  });
});
