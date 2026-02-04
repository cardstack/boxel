import { getOwner } from '@ember/owner';
import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import InviteUserToRoomCommand from '@cardstack/host/commands/invite-user-to-room';

import type MatrixService from '@cardstack/host/services/matrix-service';
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

module('Integration | commands | invite-user-to-room', function (hooks) {
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
  });

  let { createAndJoinRoom, getRoomState } = mockMatrixUtils;

  hooks.beforeEach(function (this: RenderingTestContext) {
    getOwner(this)!.register('service:realm', StubRealmService);
  });

  hooks.beforeEach(async function () {
    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {},
    });
  });

  test('invites a user to a room', async function (assert) {
    let roomId = createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'room-test',
    });
    let commandService = getService('command-service');
    let matrixService = getService('matrix-service') as MatrixService;

    let command = new InviteUserToRoomCommand(commandService.commandContext);
    await command.execute({
      roomId,
      userId: 'bot-runner',
    });

    let botRunnerUserId = matrixService.getFullUserId('bot-runner');
    let membershipEvent = getRoomState(
      roomId,
      'm.room.member',
      botRunnerUserId,
    );
    assert.strictEqual(
      membershipEvent.membership,
      'invite',
      'bot-runner invited to room',
    );
  });

  test('rejects inviting a user twice', async function (assert) {
    let roomId = createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'room-test',
    });
    let commandService = getService('command-service');

    let command = new InviteUserToRoomCommand(commandService.commandContext);
    await command.execute({
      roomId,
      userId: 'bot-runner',
    });

    await assert.rejects(
      command.execute({
        roomId,
        userId: 'bot-runner',
      }),
      /user already in room/,
      'rejects inviting a user that is already in the room',
    );
  });
});
