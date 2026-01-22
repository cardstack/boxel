import { getOwner } from '@ember/owner';
import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import RegisterBotCommand from '@cardstack/host/commands/register-bot';
import UnregisterBotCommand from '@cardstack/host/commands/unregister-bot';
import RealmService from '@cardstack/host/services/realm';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setupRealmServerEndpoints,
  testRealmInfo,
  testRealmURL,
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

module('Integration | commands | bot-registration', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  setupLocalIndexing(hooks);

  let botRegistrations: Array<{
    id: string;
    userId: string;
    matrixUserId: string;
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
            userId: 'user-1',
            matrixUserId: body.data.attributes.matrixUserId,
            createdAt: '2025-01-01T00:00:00Z',
          },
        ];
        return new Response(
          JSON.stringify({
            data: {
              type: 'bot-registration',
              id: 'bot-reg-1',
              attributes: {
                userId: 'user-1',
                matrixUserId: body.data.attributes.matrixUserId,
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
                userId: registration.userId,
                matrixUserId: registration.matrixUserId,
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

  hooks.beforeEach(async function (this: RenderingTestContext) {
    getOwner(this)!.register('service:realm', StubRealmService);
    botRegistrations = [];
    // we are setting this up to get the matrixClient started
    await setupIntegrationTestRealm({
      mockMatrixUtils,
      realmURL: testRealmURL,
      contents: {},
    });
  });

  test('register-bot returns botRegistrationId', async function (assert) {
    let commandService = getService('command-service');
    let registerBotCommand = new RegisterBotCommand(
      commandService.commandContext,
    );

    let result = await registerBotCommand.execute({
      matrixUserId: '@testuser:localhost',
    });

    assert.strictEqual(result.botRegistrationId, 'bot-reg-1');
  });

  test('unregister-bot removes the bot registration', async function (assert) {
    let commandService = getService('command-service');
    let realmServer = getService('realm-server');
    let registerBotCommand = new RegisterBotCommand(
      commandService.commandContext,
    );
    let unregisterBotCommand = new UnregisterBotCommand(
      commandService.commandContext,
    );

    let registerResult = await registerBotCommand.execute({
      matrixUserId: '@testuser:localhost',
    });
    await unregisterBotCommand.execute({
      botRegistrationId: registerResult.botRegistrationId,
    });

    let registrations = await realmServer.getBotRegistrations();
    assert.strictEqual(registrations.length, 0, 'bot registration removed');
  });
});
