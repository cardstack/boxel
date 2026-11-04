import { getOwner } from '@ember/owner';
import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import type MatrixService from '@cardstack/host/services/matrix-service';
import RealmService from '@cardstack/host/services/realm';
import InviteUserToRoomTool from '@cardstack/host/tools/invite-user-to-room';

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

module('Integration | tools | invite-user-to-room', function (hooks) {
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

  setupRealmCacheTeardown(hooks);

  hooks.beforeEach(async function () {
    await withCachedRealmSetup(async () =>
      setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {},
      }),
    );
  });

  test('invites a user to a room', async function (assert) {
    let roomId = createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'room-test',
    });
    let toolService = getService('tool-service');
    let matrixService = getService('matrix-service') as MatrixService;

    let command = new InviteUserToRoomTool(toolService.toolContext);
    await command.execute({
      roomId,
      userId: 'submissionbot',
    });

    let submissionBotUserId = matrixService.getFullUserId('submissionbot');
    let membershipEvent = getRoomState(
      roomId,
      'm.room.member',
      submissionBotUserId,
    );
    assert.strictEqual(
      membershipEvent.membership,
      'invite',
      'submissionbot invited to room',
    );
  });

  test('refuses to invite an end user', async function (assert) {
    let roomId = createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'room-test',
    });
    let toolService = getService('tool-service');

    let command = new InviteUserToRoomTool(toolService.toolContext);
    await assert.rejects(
      command.execute({
        roomId,
        userId: 'another-person',
      }),
      /not the AI bot or the submission bot/,
      'refuses an invite to a person',
    );

    assert.throws(
      () => getRoomState(roomId, 'm.room.member', '@another-person:localhost'),
      /does not exist/,
      'no membership event was written for the person',
    );
  });

  test('refuses a person whose username matches the writer-account convention', async function (assert) {
    let roomId = createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'room-test',
    });
    let toolService = getService('tool-service');

    let command = new InviteUserToRoomTool(toolService.toolContext);
    await assert.rejects(
      command.execute({
        roomId,
        userId: 'example_writer',
      }),
      /not the AI bot or the submission bot/,
      'refuses an invite to a name a person can register',
    );

    assert.throws(
      () => getRoomState(roomId, 'm.room.member', '@example_writer:localhost'),
      /does not exist/,
      'no membership event was written',
    );
  });

  test('refuses to invite a service user on another homeserver', async function (assert) {
    let roomId = createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'room-test',
    });
    let toolService = getService('tool-service');

    let command = new InviteUserToRoomTool(toolService.toolContext);
    await assert.rejects(
      command.execute({
        roomId,
        userId: '@submissionbot:other.example',
      }),
      /not on this homeserver/,
      'refuses an invite across homeservers',
    );

    assert.throws(
      () =>
        getRoomState(roomId, 'm.room.member', '@submissionbot:other.example'),
      /does not exist/,
      'no membership event was written',
    );
  });

  test('refuses an id without a leading @', async function (assert) {
    let roomId = createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'room-test',
    });
    let toolService = getService('tool-service');

    let command = new InviteUserToRoomTool(toolService.toolContext);
    await assert.rejects(
      command.execute({
        roomId,
        userId: 'submissionbot:localhost',
      }),
      /is not a full Matrix user id/,
      'refuses a malformed id before Matrix sees it',
    );
  });

  test('MatrixService.inviteUserToRoom refuses a person, whichever caller asks', async function (assert) {
    let roomId = createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'room-test',
    });
    let matrixService = getService('matrix-service') as MatrixService;
    await matrixService.ready;

    await assert.rejects(
      matrixService.inviteUserToRoom(roomId, '@another-person:localhost'),
      /not the AI bot or the submission bot/,
      'refuses an invite that does not come from the tool',
    );

    assert.throws(
      () => getRoomState(roomId, 'm.room.member', '@another-person:localhost'),
      /does not exist/,
      'no membership event was written',
    );
  });

  test('invites the submission bot on a homeserver whose name has a port', async function (assert) {
    let roomId = createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'room-test',
    });
    let toolService = getService('tool-service');
    let matrixService = getService('matrix-service') as MatrixService;
    Object.defineProperty(matrixService, 'userId', {
      configurable: true,
      get: () => '@testuser:localhost:8008',
    });

    assert.strictEqual(
      matrixService.getFullUserId('submissionbot'),
      '@submissionbot:localhost:8008',
      'a bare username takes the server of the signed-in user, port included',
    );

    let command = new InviteUserToRoomTool(toolService.toolContext);
    await command.execute({
      roomId,
      userId: 'submissionbot',
    });

    assert.strictEqual(
      getRoomState(roomId, 'm.room.member', '@submissionbot:localhost:8008')
        .membership,
      'invite',
      'submissionbot invited on the port-qualified homeserver',
    );
  });

  test('rejects inviting a user twice', async function (assert) {
    let roomId = createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'room-test',
    });
    let toolService = getService('tool-service');

    let command = new InviteUserToRoomTool(toolService.toolContext);
    await command.execute({
      roomId,
      userId: 'submissionbot',
    });

    await assert.rejects(
      command.execute({
        roomId,
        userId: 'submissionbot',
      }),
      /user already in room/,
      'rejects inviting a user that is already in the room',
    );
  });
});
