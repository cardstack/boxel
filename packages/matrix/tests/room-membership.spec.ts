import { expect, test } from '@playwright/test';
import { registerUser } from '../docker/synapse';
import { synapseStop, type SynapseInstance } from '../docker/synapse';
import {
  login,
  logout,
  assertRooms,
  createRoom,
  joinRoom,
  leaveRoom,
  openRoom,
  inviteToRoom,
  reloadAndOpenAiAssistant,
  registerRealmUsers,
  startTestingSynapse,
} from '../helpers';

test.describe('Room membership', () => {
  let synapse: SynapseInstance;
  test.beforeEach(async () => {
    synapse = await startTestingSynapse();
    await registerRealmUsers(synapse);
    await registerUser(synapse, 'user1', 'pass');
    await registerUser(synapse, 'user2', 'pass');
    await registerUser(synapse, 'user3', 'pass');
  });
  test.afterEach(async () => {
    await synapseStop(synapse.synapseId);
  });
  test('it can decline an invite', async ({ page }) => {
    await login(page, 'user1', 'pass');
    await createRoom(page, {
      name: 'Room 1',
      invites: ['user2'],
    });
    await logout(page);
    await login(page, 'user2', 'pass');

    await assertRooms(page, {
      invitedRooms: [{ name: 'Room 1', sender: 'user1' }],
    });
    await page.locator('[data-test-decline-room-btn="Room 1"]').click();
    await assertRooms(page, {});

    await reloadAndOpenAiAssistant(page);
    await assertRooms(page, {});
  });

  test('it can accept an invite', async ({ page }) => {
    await login(page, 'user1', 'pass');
    await createRoom(page, {
      name: 'Room 1',
      invites: ['user2'],
    });
    await logout(page);
    await login(page, 'user2', 'pass');

    await assertRooms(page, {
      invitedRooms: [{ name: 'Room 1', sender: 'user1' }],
    });
    await joinRoom(page, 'Room 1');
    await assertRooms(page, {
      joinedRooms: [{ name: 'Room 1' }],
    });

    await reloadAndOpenAiAssistant(page);
    await assertRooms(page, {
      joinedRooms: [{ name: 'Room 1' }],
    });
  });

  test('it can leave a joined room', async ({ page }) => {
    await login(page, 'user1', 'pass');
    await createRoom(page, { name: 'Room 1' });

    await assertRooms(page, {
      joinedRooms: [{ name: 'Room 1' }],
    });
    await leaveRoom(page, 'Room 1');
    await assertRooms(page, {});

    await reloadAndOpenAiAssistant(page);
    await assertRooms(page, {});
  });

  test('it can show the members of a room', async ({ page }) => {
    await login(page, 'user1', 'pass');
    await createRoom(page, {
      name: 'Room 1',
      invites: ['user2', 'user3'],
    });
    await expect(page.locator('[data-test-room-members]')).toHaveText(
      `Members: user1, user2 (invited), user3 (invited)`,
    );
    await logout(page);

    await login(page, 'user2', 'pass');
    await joinRoom(page, 'Room 1');
    await openRoom(page, 'Room 1');
    await expect(page.locator('[data-test-room-members]')).toHaveText(
      `Members: user1, user2, user3 (invited)`,
    );

    await leaveRoom(page, 'Room 1');
    await logout(page);

    await login(page, 'user3', 'pass');
    await page.locator('[data-test-decline-room-btn="Room 1"]').click();
    await logout(page);

    await login(page, 'user1', 'pass');
    await openRoom(page, 'Room 1');
    await expect(page.locator('[data-test-room-members]')).toHaveText(
      `Members: user1`,
    );
  });

  test('it can invite members to a room that has already been created', async ({
    page,
  }) => {
    await login(page, 'user1', 'pass');
    await createRoom(page, {
      name: 'Room 1',
    });
    await expect(page.locator('[data-test-room-members]')).toHaveText(
      `Members: user1`,
    );
    await expect(
      page.locator('[data-test-room-invite-field]'),
      'the invite dialog is not displayed',
    ).toHaveCount(0);
    await inviteToRoom(page, ['user2']);
    await expect(
      page.locator('[data-test-room-invite-field]'),
      'the invite dialog is not displayed',
    ).toHaveCount(0);
    await expect(page.locator('[data-test-room-members]')).toHaveText(
      `Members: user1, user2 (invited)`,
    );
    await logout(page);

    await login(page, 'user2', 'pass');
    await joinRoom(page, 'Room 1');
    await openRoom(page, 'Room 1');
    await expect(page.locator('[data-test-room-members]')).toHaveText(
      `Members: user1, user2`,
    );
  });

  test('it can cancel the invite dialog for a room', async ({ page }) => {
    await login(page, 'user1', 'pass');
    await createRoom(page, {
      name: 'Room 1',
    });
    await expect(
      page.locator('[data-test-room-invite-field]'),
      'the invite dialog is not displayed',
    ).toHaveCount(0);
    await page.locator(`[data-test-invite-mode-btn]`).click();
    await expect(
      page.locator('[data-test-room-invite-field]'),
      'the invite dialog is displayed',
    ).toHaveCount(1);
    await page.locator(`[data-test-room-invite-cancel-btn]`).click();
    await expect(
      page.locator('[data-test-room-invite-field]'),
      'the invite dialog is not displayed',
    ).toHaveCount(0);
  });
});
