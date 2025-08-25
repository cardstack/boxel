import { expect, test } from '@playwright/test';
import {
  registerUser,
  getJoinedRooms,
  getRoomMembers,
  getRoomRetentionPolicy,
} from '../docker/synapse';
import {
  login,
  setupUserSubscribed,
  startUniqueTestEnvironment,
  stopTestEnvironment,
  type TestEnvironment,
} from '../helpers';

test.describe('Auth rooms', () => {
  let testEnv: TestEnvironment;
  let user: { accessToken: string };

  test.beforeEach(async () => {
    // synapse defaults to 30s for beforeEach to finish, we need a bit more time
    // to safely start the realm
    test.setTimeout(120_000);
    testEnv = await startUniqueTestEnvironment();

    user = await registerUser(
      testEnv.synapse!,
      'user1',
      'pass',
      false,
      undefined,
      testEnv.config.testHost,
    );
    await setupUserSubscribed('@user1:localhost', testEnv.realmServer!);
  });

  test.afterEach(async () => {
    await stopTestEnvironment(testEnv);
  });

  // CS-8988 - this test is flaky and needs to be fixed
  // By delaying await getJoinedRooms(user.accessToken); the test is passing more
  // reliably but that makes the test take too long to run (several seconds)
  test.skip('auth rooms have a retention policy', async ({ page }) => {
    await login(page, 'user1', 'pass', { url: testEnv.config.testHost });

    let roomIds = await getJoinedRooms(testEnv.synapse!, user.accessToken);

    let roomIdToMembers = new Map<string, any>();

    for (let room of roomIds) {
      let members = await getRoomMembers(
        testEnv.synapse!,
        room,
        user.accessToken,
      );
      roomIdToMembers.set(room, members);
    }

    let realmUsers = ['@base_realm:localhost', '@test_realm:localhost'];

    let realmRoomIds = roomIds.filter((room) =>
      realmUsers.some((user) => roomIdToMembers.get(room)?.joined[user]),
    );

    expect(realmRoomIds.length).toBe(realmUsers.length);

    for (let room of realmRoomIds) {
      let retentionPolicy = await getRoomRetentionPolicy(
        testEnv.synapse!,
        user.accessToken,
        room,
      );

      expect(retentionPolicy).toMatchObject({
        max_lifetime: 60 * 60 * 1000,
      });
    }
  });
});
