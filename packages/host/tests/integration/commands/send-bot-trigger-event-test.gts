import { getOwner } from '@ember/owner';
import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { isBotTriggerEvent } from '@cardstack/runtime-common';

import SendBotTriggerEventCommand from '@cardstack/host/commands/bot-requests/send-bot-trigger-event';

import RealmService from '@cardstack/host/services/realm';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
  testRealmInfo,
  setupRealmCacheTeardown,
  withCachedRealmSetup,
} from '../../helpers';
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

module('Integration | commands | send-bot-trigger-event', function (hooks) {
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
  });

  let { createAndJoinRoom, getRoomEvents } = mockMatrixUtils;

  hooks.beforeEach(function (this: RenderingTestContext) {
    getOwner(this)!.register('service:realm', StubRealmService);
  });

  setupRealmCacheTeardown(hooks);

  hooks.beforeEach(async function () {
    await withCachedRealmSetup(async () =>
      setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {},
      }),
    );
  });

  test('sends a bot trigger event', async function (assert) {
    let roomId = createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'room-test',
    });
    let commandService = getService('command-service');

    let command = new SendBotTriggerEventCommand(commandService.commandContext);
    await command.execute({
      roomId,
      type: 'pr-listing-create',
      realm: testRealmURL,
      input: { listingId: 'catalog/listing-1' },
    });

    let event = getRoomEvents(roomId).pop()!;
    assert.ok(isBotTriggerEvent(event));
    assert.strictEqual(event.content.type, 'pr-listing-create');
    assert.strictEqual(event.content.realm, testRealmURL);
    assert.deepEqual(event.content.input, { listingId: 'catalog/listing-1' });
  });
});
