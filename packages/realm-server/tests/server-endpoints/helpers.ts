import type { Test, SuperTest } from 'supertest';
import { type DirResult } from 'tmp';
import type {
  QueuePublisher,
  QueueRunner,
  Realm,
  VirtualNetwork,
} from '@cardstack/runtime-common';
import type { Server } from 'http';
import type { PgAdapter } from '@cardstack/postgres';
import type { RealmServer } from '../../server';
import { setupPermissionedRealmCached } from '../helpers';
import type { MatrixClient } from '@cardstack/runtime-common/matrix-client';

export type ServerEndpointsTestContext = {
  testRealm: Realm;
  request: SuperTest<Test>;
  dir: DirResult;
  dbAdapter: PgAdapter;
  testRealmServer: RealmServer;
  testRealmHttpServer: Server;
  publisher: QueuePublisher;
  runner: QueueRunner;
  testRealmDir: string;
  virtualNetwork: VirtualNetwork;
  startRealmServer: () => Promise<void>;
};

export type ServerEndpointsTestOptions = {
  beforeStartRealmServer?: (
    context: ServerEndpointsTestContext,
  ) => void | Promise<void>;
};

export function setupServerEndpointsTest(hooks: NestedHooks) {
  let context = {} as ServerEndpointsTestContext;

  function onRealmSetup(args: {
    testRealm: Realm;
    request: SuperTest<Test>;
    dir: DirResult;
    dbAdapter: PgAdapter;
    runner: QueueRunner;
    publisher: QueuePublisher;
    virtualNetwork: VirtualNetwork;
  }) {
    context.testRealm = args.testRealm;
    context.request = args.request;
    context.dir = args.dir;
    context.dbAdapter = args.dbAdapter;
    context.runner = args.runner;
    context.publisher = args.publisher;
    context.virtualNetwork = args.virtualNetwork;
  }

  setupPermissionedRealmCached(hooks, {
    permissions: {
      '*': ['read', 'write'],
      '@node-test_realm:localhost': ['read', 'realm-owner'],
    },
    onRealmSetup,
  });

  return context;
}

export async function createRealmServerSession(
  matrixClient: MatrixClient,
  request: SuperTest<Test>,
  options?: { registrationToken?: string },
) {
  let openIdToken = await matrixClient.getOpenIdToken();
  if (!openIdToken) {
    throw new Error('matrixClient did not return an OpenID token');
  }
  let body: Record<string, unknown> = { ...openIdToken };
  if (options?.registrationToken) {
    body.registration_token = options.registrationToken;
  }
  let response = await request
    .post('/_server-session')
    .send(JSON.stringify(body))
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
