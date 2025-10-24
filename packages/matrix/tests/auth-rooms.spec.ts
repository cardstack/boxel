import { expect, test } from '@playwright/test';
import {
  getJoinedRooms,
  getRoomMembers,
  getRoomRetentionPolicy,
} from '../docker/synapse';
import { createSubscribedUser } from '../helpers';
import { appURL } from '../helpers/isolated-realm-server';

test.describe('Auth rooms', () => {
  test.beforeEach(async () => {
    // synapse defaults to 30s for beforeEach to finish, we need a bit more time
    test.setTimeout(120_000);
  });

  // CS-8988 - was flaky before, making it a toPass to attempt to stabilize
  test('auth rooms have a retention policy', async ({ page }) => {
    const { username, password, credentials } =
      await createSubscribedUser('auth-rooms');
    await page.goto(appURL);

    await expect(page.locator('[data-test-login-btn]')).toBeDisabled();
    await page.locator('[data-test-username-field]').fill(username);
    await expect(page.locator('[data-test-login-btn]')).toBeDisabled();
    await page.locator('[data-test-password-field]').fill(password);
    await expect(page.locator('[data-test-login-btn]')).toBeEnabled();
    await page.locator('[data-test-login-btn]').click();

    await page.locator('[data-test-room-settled]').waitFor();
    let realmRoomsByUser = new Map<string, string>();
    expect(async () => {
      let roomIds = await getJoinedRooms(credentials.accessToken);

      let roomIdToMembers = new Map<string, any>();

      for (let room of roomIds) {
        let members = await getRoomMembers(room, credentials.accessToken);
        roomIdToMembers.set(room, members);
      }
      console.log(roomIdToMembers);
      // Only look at auth rooms that we know will be there for the isolated realm server
      let realmUsers = ['@realm_server:localhost', '@test_realm:localhost'];
      // make sure we reset it each time we test
      realmRoomsByUser = new Map<string, string>();

      for (let [roomId, members] of roomIdToMembers.entries()) {
        let joinedMembers = members?.joined ?? {};
        for (let realmUser of realmUsers) {
          if (!realmRoomsByUser.has(realmUser) && joinedMembers[realmUser]) {
            realmRoomsByUser.set(realmUser, roomId);
          }
        }
      }

      expect(realmRoomsByUser.size).toBe(realmUsers.length);
    }).toPass();

    for (let [realmUser, room] of realmRoomsByUser.entries()) {
      console.log(
        `checking retention for realm user ${realmUser} in room ${room}`,
      );
      let retentionPolicy = await getRoomRetentionPolicy(
        credentials.accessToken,
        room,
      );

      expect(retentionPolicy).toMatchObject({
        max_lifetime: 60 * 60 * 1000,
      });
    }
  });
});
