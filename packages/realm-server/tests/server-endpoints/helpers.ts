import { join } from 'path';
import supertest from 'supertest';
import type { Test, SuperTest } from 'supertest';
import { dirSync, type DirResult } from 'tmp';
import { copySync, ensureDirSync } from 'fs-extra';
import type {
  QueuePublisher,
  QueueRunner,
  Realm,
  VirtualNetwork,
} from '@cardstack/runtime-common';
import { DEFAULT_PERMISSIONS } from '@cardstack/runtime-common';
import type { Server } from 'http';
import type { PgAdapter } from '@cardstack/postgres';
import type { RealmServer } from '../../server';
import {
  closeServer,
  createVirtualNetwork,
  matrixURL,
  runTestRealmServer,
  setupDB,
  setupPermissionedRealm,
} from '../helpers';
import { MatrixClient } from '@cardstack/runtime-common/matrix-client';

export const testRealm2URL = new URL('http://127.0.0.1:4445/test/');

export type ServerEndpointsTestContext = {
  testRealm: Realm;
  request: SuperTest<Test>;
  dir: DirResult;
  dbAdapter: PgAdapter;
  testRealmServer2: RealmServer;
  testRealmHttpServer2: Server;
  publisher: QueuePublisher;
  runner: QueueRunner;
  request2: SuperTest<Test>;
  testRealmDir: string;
  virtualNetwork: VirtualNetwork;
  startRealmServer: () => Promise<void>;
};

export function setupServerEndpointsTest(hooks: NestedHooks) {
  let context = {} as ServerEndpointsTestContext;
  let ownerUserId = '@mango:localhost';

  function onRealmSetup(args: {
    testRealm: Realm;
    request: SuperTest<Test>;
    dir: DirResult;
    dbAdapter: PgAdapter;
  }) {
    context.testRealm = args.testRealm;
    context.request = args.request;
    context.dir = args.dir;
    context.dbAdapter = args.dbAdapter;
  }

  hooks.beforeEach(async function () {
    context.dir = dirSync();
    copySync(join(__dirname, '..', 'cards'), context.dir.name);
  });

  setupPermissionedRealm(hooks, {
    permissions: {
      '*': ['read', 'write'],
    },
    onRealmSetup,
  });

  async function startRealmServer(
    dbAdapter: PgAdapter,
    publisher: QueuePublisher,
    runner: QueueRunner,
  ) {
    context.virtualNetwork = createVirtualNetwork();
    ({
      testRealmServer: context.testRealmServer2,
      testRealmHttpServer: context.testRealmHttpServer2,
    } = await runTestRealmServer({
      virtualNetwork: context.virtualNetwork,
      testRealmDir: context.testRealmDir,
      realmsRootPath: join(context.dir.name, 'realm_server_2'),
      realmURL: testRealm2URL,
      dbAdapter,
      publisher,
      runner,
      matrixURL,
      permissions: {
        '*': ['read', 'write'],
        [ownerUserId]: DEFAULT_PERMISSIONS,
      },
    }));
    context.request2 = supertest(context.testRealmHttpServer2);
  }

  context.startRealmServer = async () => {
    await startRealmServer(context.dbAdapter, context.publisher, context.runner);
  };

  setupDB(hooks, {
    beforeEach: async (_dbAdapter, _publisher, _runner) => {
      context.dbAdapter = _dbAdapter;
      context.publisher = _publisher;
      context.runner = _runner;
      context.testRealmDir = join(context.dir.name, 'realm_server_2', 'test');
      ensureDirSync(context.testRealmDir);
      copySync(join(__dirname, '..', 'cards'), context.testRealmDir);
      await startRealmServer(_dbAdapter, _publisher, _runner);
    },
    afterEach: async () => {
      await closeServer(context.testRealmHttpServer2);
    },
  });

  return context;
}

export async function createRealmServerSession(
  matrixClient: MatrixClient,
  request: SuperTest<Test>,
) {
  let openIdToken = await matrixClient.getOpenIdToken();
  if (!openIdToken) {
    throw new Error('matrixClient did not return an OpenID token');
  }
  let response = await request
    .post('/_server-session')
    .send(JSON.stringify(openIdToken))
    .set('Accept', 'application/json')
    .set('Content-Type', 'application/json');

  let jwt = response.header['authorization'];
  if (!jwt) {
    throw new Error('Realm server did not send Authorization header');
  }
  let payload = JSON.parse(
    Buffer.from(jwt.split('.')[1], 'base64').toString('utf8'),
  ) as { sessionRoom: string };

  return {
    sessionRoom: payload.sessionRoom,
    jwt,
    status: response.status,
  };
}
