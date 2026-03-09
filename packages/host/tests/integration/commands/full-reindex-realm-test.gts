import { getOwner } from '@ember/owner';
import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import FullReindexRealmCommand from '@cardstack/host/commands/full-reindex-realm';
import RealmService from '@cardstack/host/services/realm';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setupRealmServerEndpoints,
  testRealmInfo,
  testRealmURL,
  setupRealmCacheTeardown,
  withCachedRealmSetup,
} from '../../helpers';
import { setupBaseRealm } from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

class StubRealmService extends RealmService {
  get defaultReadableRealm() {
    return {
      path: testRealmURL,
      info: testRealmInfo,
    };
  }
}

module('Integration | commands | full-reindex-realm', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  setupLocalIndexing(hooks);

  let receivedAuthorizationHeader: string | null = null;
  let receivedMethod: string | null = null;
  let receivedPathname: string | null = null;
  let responseStatus = 204;
  let responseBody: string | null = null;

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });

  setupRealmServerEndpoints(hooks, [
    {
      route: 'test/_full-reindex',
      getResponse: async (req: Request) => {
        receivedAuthorizationHeader = req.headers.get('Authorization');
        receivedMethod = req.method;
        receivedPathname = new URL(req.url).pathname;
        return new Response(responseBody, { status: responseStatus });
      },
    },
  ]);

  setupRealmCacheTeardown(hooks);

  hooks.beforeEach(async function (this: RenderingTestContext) {
    getOwner(this)!.register('service:realm', StubRealmService);
    receivedAuthorizationHeader = null;
    receivedMethod = null;
    receivedPathname = null;
    responseStatus = 204;
    responseBody = null;

    await withCachedRealmSetup(async () =>
      setupIntegrationTestRealm({
        mockMatrixUtils,
        realmURL: testRealmURL,
        contents: {},
      }),
    );
  });

  test('calls realm endpoint with expected auth header', async function (assert) {
    let commandService = getService('command-service');
    let realmServer = getService('realm-server');
    let command = new FullReindexRealmCommand(commandService.commandContext);
    let realmURL = new URL('test/', realmServer.url).href;

    let result = await command.execute({
      realmUrl: realmURL,
    });

    assert.strictEqual(result, undefined, 'command has no result card');
    assert.strictEqual(receivedMethod, 'POST', 'uses POST');
    assert.strictEqual(
      receivedPathname,
      '/test/_full-reindex',
      'calls endpoint',
    );
    assert.ok(receivedAuthorizationHeader, 'authorization header is present');
    assert.true(
      receivedAuthorizationHeader?.startsWith('Bearer '),
      'authorization header uses Bearer scheme',
    );

    let authToken = receivedAuthorizationHeader!.replace('Bearer ', '');
    let [_header, payload] = authToken.split('.');
    let tokenClaims = JSON.parse(atob(payload)) as {
      realm?: string;
      permissions?: string[];
    };

    assert.strictEqual(
      tokenClaims.realm,
      realmURL,
      'authorization token is realm-scoped',
    );
    assert.deepEqual(
      tokenClaims.permissions,
      ['read', 'write'],
      'authorization token contains realm permissions',
    );
    assert.notStrictEqual(
      receivedAuthorizationHeader,
      `Bearer ${realmServer.token}`,
      'authorization header does not use realm-server session token',
    );
  });

  test('throws when full reindex endpoint returns non-204', async function (assert) {
    let commandService = getService('command-service');
    let realmServer = getService('realm-server');
    let command = new FullReindexRealmCommand(commandService.commandContext);
    let realmURL = new URL('test/', realmServer.url).href;
    responseStatus = 500;
    responseBody = 'boom';

    await assert.rejects(
      command.execute({
        realmUrl: realmURL,
      }),
      /Full reindex realm failed: 500 - boom/,
      'propagates non-204 failure as an error',
    );
  });

  test('description explains forced full reindex semantics', async function (assert) {
    let commandService = getService('command-service');
    let command = new FullReindexRealmCommand(commandService.commandContext);

    assert.true(
      command.description.includes('every file in the realm is revisited'),
      'description identifies this as the forced full option',
    );
    assert.true(
      command.description.includes('stale cached results'),
      'description explains when to choose it',
    );
  });
});
