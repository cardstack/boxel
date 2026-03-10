import { getOwner } from '@ember/owner';
import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import InvalidateRealmUrlsCommand from '@cardstack/host/commands/invalidate-realm-urls';
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

module('Integration | commands | invalidate-realm-urls', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  setupLocalIndexing(hooks);

  let receivedAuthorizationHeader: string | null = null;
  let receivedMethod: string | null = null;
  let receivedPathname: string | null = null;
  let responseStatus = 204;
  let responseBody: string | null = null;
  let receivedBody: {
    data?: {
      type?: string;
      attributes?: {
        urls?: string[];
      };
    };
  } | null = null;

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });

  setupRealmServerEndpoints(hooks, [
    {
      route: 'test/_invalidate',
      getResponse: async (req: Request) => {
        receivedAuthorizationHeader = req.headers.get('Authorization');
        receivedMethod = req.method;
        receivedPathname = new URL(req.url).pathname;
        receivedBody = (await req.json()) as typeof receivedBody;
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
    receivedBody = null;
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

  test('calls realm endpoint with expected auth header and payload', async function (assert) {
    let commandService = getService('command-service');
    let realmServer = getService('realm-server');
    let command = new InvalidateRealmUrlsCommand(commandService.commandContext);
    let realmURL = new URL('test/', realmServer.url).href;

    let result = await command.execute({
      realmUrl: realmURL,
      urls: [`${realmURL}mango`, `${realmURL}mango`, `${realmURL}person.gts`],
    });

    assert.strictEqual(result, undefined, 'command has no result card');
    assert.strictEqual(receivedMethod, 'POST', 'uses POST');
    assert.strictEqual(receivedPathname, '/test/_invalidate', 'calls endpoint');
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

    assert.deepEqual(
      receivedBody,
      {
        data: {
          type: 'invalidation-request',
          attributes: {
            urls: [`${realmURL}mango`, `${realmURL}person.gts`],
          },
        },
      },
      'sends JSON:API payload with deduped urls',
    );
  });

  test('throws when realm invalidation endpoint returns non-204', async function (assert) {
    let commandService = getService('command-service');
    let realmServer = getService('realm-server');
    let command = new InvalidateRealmUrlsCommand(commandService.commandContext);
    let realmURL = new URL('test/', realmServer.url).href;
    responseStatus = 500;
    responseBody = 'boom';

    await assert.rejects(
      command.execute({
        realmUrl: realmURL,
        urls: [`${realmURL}mango`],
      }),
      /Invalidate urls failed: 500 - boom/,
      'propagates non-204 failure as an error',
    );
  });
});
