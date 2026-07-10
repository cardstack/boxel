import { getOwner } from '@ember/owner';
import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import RealmService from '@cardstack/host/services/realm';
import RegisterBotTool from '@cardstack/host/tools/register-bot';
import UnregisterBotTool from '@cardstack/host/tools/unregister-bot';

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

module('Integration | tools | bot-registration', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  setupLocalIndexing(hooks);

  let botRegistrations: Array<{
    id: string;
    username: string;
    createdAt: string;
  }>;

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });

  setupRealmServerEndpoints(hooks, [
    {
      route: '_bot-registration',
      getResponse: async (req: Request) => {
        if (req.method === 'DELETE') {
          let body = await req.json();
          let index = botRegistrations.findIndex(
            (registration) => registration.id === body?.data?.id,
          );
          if (index === -1) {
            return new Response('invalid bot registration id', { status: 400 });
          }
          botRegistrations.splice(index, 1);
          return new Response(null, { status: 204 });
        }
        let body = await req.json();
        botRegistrations = [
          {
            id: 'bot-reg-1',
            username: body.data.attributes.username,
            createdAt: '2025-01-01T00:00:00Z',
          },
        ];
        return new Response(
          JSON.stringify({
            data: {
              type: 'bot-registration',
              id: 'bot-reg-1',
              attributes: {
                username: body.data.attributes.username,
                createdAt: '2025-01-01T00:00:00Z',
              },
            },
          }),
          {
            status: 201,
            headers: { 'Content-Type': 'application/vnd.api+json' },
          },
        );
      },
    },
    {
      route: '_bot-registrations',
      getResponse: async () => {
        return new Response(
          JSON.stringify({
            data: botRegistrations.map((registration) => ({
              type: 'bot-registration',
              id: registration.id,
              attributes: {
                username: registration.username,
                createdAt: registration.createdAt,
              },
            })),
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/vnd.api+json' },
          },
        );
      },
    },
  ]);

  setupRealmCacheTeardown(hooks);

  hooks.beforeEach(async function (this: RenderingTestContext) {
    getOwner(this)!.register('service:realm', StubRealmService);
    botRegistrations = [];
    // we are setting this up to get the matrixClient started
    await withCachedRealmSetup(async () =>
      setupIntegrationTestRealm({
        mockMatrixUtils,
        realmURL: testRealmURL,
        contents: {},
      }),
    );
  });

  test('register-bot returns botRegistrationId', async function (assert) {
    let toolService = getService('tool-service');
    let registerBotCommand = new RegisterBotTool(toolService.toolContext);

    let result = await registerBotCommand.execute({
      username: '@testuser:localhost',
    });

    assert.strictEqual(result.botRegistrationId, 'bot-reg-1');
  });

  test('unregister-bot removes the bot registration', async function (assert) {
    let toolService = getService('tool-service');
    let realmServer = getService('realm-server');
    let registerBotCommand = new RegisterBotTool(toolService.toolContext);
    let unregisterBotCommand = new UnregisterBotTool(toolService.toolContext);

    let registerResult = await registerBotCommand.execute({
      username: '@testuser:localhost',
    });
    await unregisterBotCommand.execute({
      botRegistrationId: registerResult.botRegistrationId,
    });

    let registrations = await realmServer.getBotRegistrations();
    assert.strictEqual(registrations.length, 0, 'bot registration removed');
  });
});
