import { expect, test } from '@playwright/test';
import {
  synapseStart,
  synapseStop,
  type SynapseInstance,
  registerUser,
  getJoinedRooms,
  getRoomMembers,
  getRoomRetentionPolicy,
} from '../docker/synapse';
import { smtpStart, smtpStop } from '../docker/smtp4dev';
import { login, registerRealmUsers, setupUserSubscribed } from '../helpers';

import {
  appURL,
  startServer as startRealmServer,
  type IsolatedRealmServer,
} from '../helpers/isolated-realm-server';

test.describe('Auth rooms', () => {
  let synapse: SynapseInstance;
  let realmServer: IsolatedRealmServer;
  let user: { accessToken: string };

  test.beforeEach(async () => {
    // synapse defaults to 30s for beforeEach to finish, we need a bit more time
    // to safely start the realm
    test.setTimeout(120_000);
    synapse = await synapseStart({
      template: 'test',
    });
    await smtpStart();

    await registerRealmUsers(synapse);
    realmServer = await startRealmServer();

    user = await registerUser(synapse, 'user1', 'pass');
    await setupUserSubscribed('@user1:localhost', realmServer);
  });

  test.afterEach(async () => {
    await synapseStop(synapse.synapseId);
    await smtpStop();
    await realmServer.stop();
  });

  // CS-8988 - this test is flaky and needs to be fixed
  // By delaying await getJoinedRooms(user.accessToken); the test is passing more
  // reliably but that makes the test take too long to run (several seconds)
  test.skip('auth rooms have a retention policy', async ({ page }) => {
    await login(page, 'user1', 'pass', { url: appURL });

    let roomIds = await getJoinedRooms(synapse, user.accessToken);

    let roomIdToMembers = new Map<string, any>();

    for (let room of roomIds) {
      let members = await getRoomMembers(synapse, room, user.accessToken);
      roomIdToMembers.set(room, members);
    }

    let realmUsers = ['@base_realm:localhost', '@test_realm:localhost'];

    let realmRoomIds = roomIds.filter((room) =>
      realmUsers.some((user) => roomIdToMembers.get(room)?.joined[user]),
    );

    expect(realmRoomIds.length).toBe(realmUsers.length);

    for (let room of realmRoomIds) {
      let retentionPolicy = await getRoomRetentionPolicy(
        synapse,
        user.accessToken,
        room,
      );

      expect(retentionPolicy).toMatchObject({
        max_lifetime: 60 * 60 * 1000,
      });
    }
  });
});
