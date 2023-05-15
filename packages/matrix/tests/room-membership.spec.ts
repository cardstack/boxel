import { test } from '@playwright/test';
import {
  synapseStart,
  synapseStop,
  registerUser,
  type SynapseInstance,
} from '../docker/synapse';
import { login, logout, assertRooms, createRoom } from '../helpers';

test.describe('Room membership', () => {
  let synapse: SynapseInstance;
  test.beforeEach(async () => {
    synapse = await synapseStart();
    await registerUser(synapse, 'user1', 'pass');
    await registerUser(synapse, 'user2', 'pass');
  });

  test.afterEach(async () => {
    await synapseStop(synapse.synapseId);
  });

  test('it can decline an invite', async ({ page }) => {
    await login(page, 'user1', 'pass');
    await createRoom(page, { name: 'Room 1', invites: ['user2'] });
    await logout(page);
    await login(page, 'user2', 'pass');

    await assertRooms(page, {
      invitedRooms: [{ name: 'Room 1', sender: '@user1:localhost' }],
    });
    await page.locator('[data-test-decline-room-btn="Room 1"]').click();
    await assertRooms(page, {});

    await page.reload();
    await assertRooms(page, {});
  });

  test('it can accept an invite', async ({ page }) => {
    await login(page, 'user1', 'pass');
    await createRoom(page, { name: 'Room 1', invites: ['user2'] });
    await logout(page);
    await login(page, 'user2', 'pass');

    await assertRooms(page, {
      invitedRooms: [{ name: 'Room 1', sender: '@user1:localhost' }],
    });
    await page.locator('[data-test-join-room-btn="Room 1"]').click();
    await assertRooms(page, { joinedRooms: ['Room 1'] });

    await page.reload();
    await assertRooms(page, { joinedRooms: ['Room 1'] });
  });

  test('it can leave a joined room', async ({ page }) => {
    await login(page, 'user1', 'pass');
    await createRoom(page, { name: 'Room 1' });

    await assertRooms(page, { joinedRooms: ['Room 1'] });
    await page.locator('[data-test-leave-room-btn="Room 1"]').click();
    await assertRooms(page, {});

    await page.reload();
    await assertRooms(page, {});
  });
});
