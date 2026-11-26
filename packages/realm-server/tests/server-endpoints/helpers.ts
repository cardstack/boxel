import type { Test, SuperTest } from 'supertest';
import type { DirResult } from 'tmp';
import type {
  LooseSingleCardDocument,
  QueuePublisher,
  RealmPermissions,
  QueueRunner,
  Realm,
  VirtualNetwork,
} from '@cardstack/runtime-common';
import type { RealmHttpServer as Server } from '../../server.ts';
import type { PgAdapter } from '@cardstack/postgres';
import type { RealmServer } from '../../server.ts';
import {
  setupPermissionedRealmCached,
  testPort,
  type RealmFixtureName,
} from '../helpers/index.ts';
import type { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import { randomBytes } from 'node:crypto';
import { sha256Hex } from '../../lib/oauth-provider/objects.ts';
import { oauthIssuer } from '../../lib/oauth-provider/registry.ts';
import {
  testOAuthProviderConfig,
  testOAuthSecureOriginURL,
} from '../helpers/oauth-provider.ts';

export const testRealmURL = new URL(`http://127.0.0.1:${testPort(4445)}/test/`);

// A Boxel API access token for `user`, as the OAuth provider stores one, on a
// grant of its own (for a suite started with `oauthProvider: true`).
export async function insertBoxelApiAccessToken(
  dbAdapter: PgAdapter,
  user: string,
  scope = 'boxel:read boxel:write',
): Promise<{ token: string; grantId: string }> {
  let boxelApi = oauthIssuer(testRealmURL.origin);
  let [{ id: userId }] = (await dbAdapter.execute(
    `INSERT INTO users (matrix_user_id) VALUES ($1)
       ON CONFLICT (matrix_user_id)
       DO UPDATE SET matrix_user_id = EXCLUDED.matrix_user_id
       RETURNING id`,
    { bind: [user] },
  )) as { id: string }[];
  let grantId = randomBytes(16).toString('base64url');
  let token = randomBytes(32).toString('base64url');
  await dbAdapter.execute(
    `INSERT INTO oauth_provider_grants
       (id, user_id, client_id, resources, renewing, expires_at)
       VALUES ($1, $2::uuid, 'boxel-cli', $3::jsonb, false,
               now() + interval '1 hour')`,
    {
      bind: [grantId, userId, JSON.stringify({ [boxelApi]: scope.split(' ') })],
    },
  );
  await dbAdapter.execute(
    `INSERT INTO oauth_provider_tokens
       (id_hash, kind, grant_id, resource, scope, payload, expires_at)
       VALUES (decode($1, 'hex'), 'AccessToken', $2, $3, $4, '{}'::jsonb,
               now() + interval '10 minutes')`,
    { bind: [sha256Hex(token), grantId, boxelApi, scope] },
  );
  return { token, grantId };
}

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
};

type ServerEndpointsTestOptions = {
  // CS-10009: pick the realm fixture that backs this test's testRealm.
  // Default is 'blank' — most server-level endpoint tests
  // (bot-commands, webhooks, realm lifecycle, etc.) don't read card
  // content out of the testRealm and want the lightest possible
  // template build. Tests that DO read the kitchen sink (e.g.
  // capture referencing Person/fadhlan) pass `'realistic'`.
  fixture?: RealmFixtureName;
  // Author the testRealm's contents outright, for a test whose subject is a
  // module it needs to write itself (a realm-defined command, say). Mutually
  // exclusive with `fixture`.
  fileSystem?: Record<string, string | LooseSingleCardDocument>;
  // Replaces the testRealm's permission map outright, realm-owner grant
  // included — a caller that still wants one restates it.
  //
  // The default makes the realm world-writable, which is what keeps most
  // endpoint tests from needing to mint anything. It also means a write
  // short-circuits before the Authorization header is read (see
  // `Realm#checkPermission`), so a test whose subject is an authenticated
  // write has to narrow `'*'` to `['read']` and grant the writing user
  // explicitly, or it proves nothing about auth.
  permissions?: RealmPermissions;
  // Turns Boxel's OAuth provider on, with the secure origin it needs, so the
  // server's routes and the realm accept Boxel API OAuth tokens.
  oauthProvider?: boolean;
};

export function setupServerEndpointsTest(
  hooks: NestedHooks,
  options: ServerEndpointsTestOptions = {},
) {
  let context = {} as ServerEndpointsTestContext;

  function onRealmSetup(args: {
    testRealmServer: {
      testRealmServer: RealmServer;
      testRealmHttpServer: Server;
    };
    testRealm: Realm;
    testRealmPath: string;
    request: SuperTest<Test>;
    dir: DirResult;
    dbAdapter: PgAdapter;
    runner: QueueRunner;
    publisher: QueuePublisher;
    virtualNetwork: VirtualNetwork;
  }) {
    context.testRealmServer = args.testRealmServer.testRealmServer;
    context.testRealmHttpServer = args.testRealmServer.testRealmHttpServer;
    context.testRealm = args.testRealm;
    context.request = args.request;
    context.dir = args.dir;
    context.dbAdapter = args.dbAdapter;
    context.runner = args.runner;
    context.publisher = args.publisher;
    context.testRealmDir = args.testRealmPath;
    context.virtualNetwork = args.virtualNetwork;
  }

  setupPermissionedRealmCached(hooks, {
    ...(options.fileSystem
      ? { fileSystem: options.fileSystem }
      : { fixture: options.fixture ?? 'blank' }),
    realmURL: testRealmURL,
    permissions: options.permissions ?? {
      '*': ['read', 'write'],
      '@node-test_realm:localhost': ['read', 'realm-owner'],
    },
    ...(options.oauthProvider
      ? {
          oauthProvider: testOAuthProviderConfig(),
          secureOriginURL: testOAuthSecureOriginURL,
        }
      : {}),
    onRealmSetup,
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
