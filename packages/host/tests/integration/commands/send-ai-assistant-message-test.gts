import { getOwner } from '@ember/owner';
import { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { APP_BOXEL_MESSAGE_MSGTYPE } from '@cardstack/runtime-common/matrix-constants';

import SendAiAssistantMessageCommand from '@cardstack/host/commands/send-ai-assistant-message';

import RealmService from '@cardstack/host/services/realm';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
  testRealmInfo,
  setupSnapshotRealm,
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

module('Integration | commands | send-ai-assistant-message', function (hooks) {
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
  });
  let snapshot = setupSnapshotRealm(hooks, {
    mockMatrixUtils,
    async build({ loader }) {
      let loaderService = getService('loader-service');
      loaderService.loader = loader;
      await setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {},
        loader,
      });
      return {};
    },
  });

  let { createAndJoinRoom, getRoomEvents } = mockMatrixUtils;

  hooks.beforeEach(function (this: RenderingTestContext) {
    getOwner(this)!.register('service:realm', StubRealmService);
  });

  hooks.beforeEach(function () {
    snapshot.get();
  });

  test('send an ai assistant message', async function (assert) {
    let roomId = createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'room-test',
    });
    let commandService = getService('command-service');

    let sendAiAssistantMessageCommand = new SendAiAssistantMessageCommand(
      commandService.commandContext,
    );
    await sendAiAssistantMessageCommand.execute({
      roomId,
      prompt: 'Hello, world!',
    });
    let message = getRoomEvents(roomId).pop()!;
    assert.strictEqual(message.content.msgtype, APP_BOXEL_MESSAGE_MSGTYPE);
    let boxelMessageData = JSON.parse(message.content.data);
    assert.strictEqual(boxelMessageData.context.tools.length, 0);
  });
});
