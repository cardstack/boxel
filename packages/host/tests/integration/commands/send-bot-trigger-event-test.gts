import { getOwner } from '@ember/owner';
import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import SendBotTriggerEventCommand from '@cardstack/host/commands/send-bot-trigger-event';
import { BOT_TRIGGER_EVENT_TYPE } from 'https://cardstack.com/base/matrix-event';
import RealmService from '@cardstack/host/services/realm';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
  testRealmInfo,
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

  hooks.beforeEach(async function () {
    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {},
    });
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
      type: 'create-listing-pr',
      input: { listingId: 'catalog/listing-1' },
    });

    let event = getRoomEvents(roomId).pop()!;
    assert.strictEqual(event.type, BOT_TRIGGER_EVENT_TYPE);
    assert.strictEqual(event.content.type, 'create-listing-pr');
    assert.deepEqual(event.content.input, { listingId: 'catalog/listing-1' });
  });

  test('rejects unknown trigger types', async function (assert) {
    let roomId = createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'room-test',
    });
    let commandService = getService('command-service');

    let command = new SendBotTriggerEventCommand(commandService.commandContext);
    await assert.rejects(
      command.execute({
        roomId,
        type: 'not-a-real-command',
        input: {},
      }),
      /Unsupported bot trigger event type/,
    );
  });
});
