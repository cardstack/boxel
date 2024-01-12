import { expect } from '@playwright/test';
import { registerUser } from '../docker/synapse';
import {
  login,
  logout,
  assertRooms,
  createRoom,
  reloadAndOpenAiAssistant,
  test,
  registerRealmUsers,
} from '../helpers';

test.describe('Room creation', () => {
  test.beforeEach(async ({ synapse }) => {
    await registerRealmUsers(synapse);
    await registerUser(synapse, 'user1', 'pass');
    await registerUser(synapse, 'user2', 'pass');
  });
  test('it can create a room', async ({ page }) => {
    await login(page, 'user1', 'pass');
    await expect(
      page.locator('[data-test-joined-room]'),
      'joined rooms not displayed',
    ).toHaveCount(0);
    await expect(
      page.locator('[data-test-invited-room]'),
      'invited rooms not displayed',
    ).toHaveCount(0);

    await page.locator('[data-test-create-room-mode-btn]').click();

    await expect(page.locator('[data-test-create-room-btn]')).toBeDisabled();
    await expect(
      page.locator('[data-test-create-room-cancel-btn]'),
    ).toBeEnabled();

    await page.locator('[data-test-room-name-field]').fill('Room 1');
    await expect(page.locator('[data-test-create-room-btn]')).toBeEnabled();
    await page.locator('[data-test-create-room-btn]').click();

    await assertRooms(page, {
      joinedRooms: [{ name: 'Room 1' }],
    });

    await reloadAndOpenAiAssistant(page);
    await assertRooms(page, {
      joinedRooms: [{ name: 'Room 1' }],
    });

    await logout(page);
    await login(page, 'user1', 'pass');
    await assertRooms(page, {
      joinedRooms: [{ name: 'Room 1' }],
    });

    // The room created is a private room, user2 was not invited to it
    await logout(page);
    await login(page, 'user2', 'pass');
    await assertRooms(page, {});
  });

  test('it can cancel a room creation', async ({ page }) => {
    await login(page, 'user1', 'pass');
    await page.locator('[data-test-create-room-mode-btn]').click();
    await page.locator('[data-test-room-name-field]').fill('Room 1');
    await page.locator('[data-test-create-room-cancel-btn]').click();

    await assertRooms(page, {});
    await expect(
      page.locator('[data-test-create-room-mode-btn]'),
    ).toBeEnabled();
    await page.locator('[data-test-create-room-mode-btn]').click();
    await expect(await page.locator('[data-test-room-name-field]')).toHaveValue(
      '',
    );
  });

  test('rooms are sorted by join date', async ({ page }) => {
    await login(page, 'user1', 'pass');
    await createRoom(page, { name: 'Room Z' });
    await createRoom(page, { name: 'Room A' });

    await assertRooms(page, {
      joinedRooms: [{ name: 'Room Z' }, { name: 'Room A' }],
    });
  });

  test('it can invite a user to a new room', async ({ page }) => {
    await login(page, 'user1', 'pass');
    await createRoom(page, {
      name: 'Room 1',
      invites: ['user2'],
    });

    await assertRooms(page, {
      joinedRooms: [{ name: 'Room 1' }],
    });

    await logout(page);
    await login(page, 'user2', 'pass');
    await assertRooms(page, {
      invitedRooms: [{ name: 'Room 1', sender: 'user1' }],
    });
  });

  test('invites are sorted by invitation date', async ({ page }) => {
    await login(page, 'user1', 'pass');
    await createRoom(page, {
      name: 'Room Z',
      invites: ['user2'],
    });
    await createRoom(page, {
      name: 'Room A',
      invites: ['user2'],
    });

    await logout(page);
    await login(page, 'user2', 'pass');
    await assertRooms(page, {
      invitedRooms: [
        { name: 'Room Z', sender: 'user1' },
        { name: 'Room A', sender: 'user1' },
      ],
    });
  });

  test('it shows an error when a duplicate room is created', async ({
    page,
  }) => {
    await login(page, 'user1', 'pass');
    await createRoom(page, { name: 'Room 1' });

    await page.locator('[data-test-create-room-mode-btn]').click();
    await page.locator('[data-test-room-name-field]').fill('Room 1');
    await expect(
      page.locator(
        '[data-test-room-name-field][data-test-boxel-input-validation-state="initial"]',
      ),
      'room name field displays initial validation state',
    ).toHaveCount(1);
    await expect(
      page.locator(
        '[data-test-room-name-field] ~ [data-test-boxel-input-error-message]',
      ),
      'no error message is displayed',
    ).toHaveCount(0);
    await page.locator('[data-test-create-room-btn]').click();

    await expect(
      page.locator(
        '[data-test-room-name-field][data-test-boxel-input-validation-state="invalid"]',
      ),
      'room name field displays invalid validation state',
    ).toHaveCount(1);
    await expect(
      page.locator(
        '[data-test-room-name-field] ~ [data-test-boxel-input-error-message]',
      ),
    ).toContainText('Room already exists');

    await page.locator('[data-test-room-name-field]').fill('Room 2');
    await expect(
      page.locator(
        '[data-test-room-name-field][data-test-boxel-input-validation-state="initial"]',
      ),
      'room name field displays initial validation state',
    ).toHaveCount(1);
    await expect(
      page.locator(
        '[data-test-room-name-field] ~ [data-test-boxel-input-error-message]',
      ),
      'no error message is displayed',
    ).toHaveCount(0);
    await page.locator('[data-test-create-room-btn]').click();

    await assertRooms(page, {
      joinedRooms: [{ name: 'Room 1' }, { name: 'Room 2' }],
    });
  });
});
