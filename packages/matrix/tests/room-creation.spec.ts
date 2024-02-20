import { expect, test } from '@playwright/test';
import { registerUser } from '../docker/synapse';
import {
  synapseStart,
  synapseStop,
  type SynapseInstance,
} from '../docker/synapse';
import {
  login,
  logout,
  assertRooms,
  createRoom,
  openRoom,
  openRenameMenu,
  reloadAndOpenAiAssistant,
  registerRealmUsers,
  clearLocalStorage,
} from '../helpers';

test.describe('Room creation', () => {
  let synapse: SynapseInstance;

  test.beforeEach(async ({ page }) => {
    synapse = await synapseStart();
    await registerRealmUsers(synapse);
    await registerUser(synapse, 'user1', 'pass');
    await registerUser(synapse, 'user2', 'pass');
    await clearLocalStorage(page);
  });
  test.afterEach(async () => {
    await synapseStop(synapse.synapseId);
  });

  test('it can create a room', async ({ page }) => {
    await login(page, 'user1', 'pass');

    let room1 = (await page
      .locator(`[data-test-room]`)
      .getAttribute('data-test-room')) as string;

    await assertRooms(page, [room1]);

    let room2 = await createRoom(page);
    await assertRooms(page, [room1, room2]);

    await reloadAndOpenAiAssistant(page);
    await assertRooms(page, [room1, room2]);

    await logout(page);
    await login(page, 'user1', 'pass');
    await assertRooms(page, [room1, room2]);

    // user2 should not be able to see user1's room
    await logout(page);
    await login(page, 'user2', 'pass');

    let room1New = (await page
      .locator(`[data-test-room]`)
      .getAttribute('data-test-room')) as string; // Automatically created room

    await assertRooms(page, [room1New]);
  });

  test('it can rename a room', async ({ page }) => {
    await login(page, 'user1', 'pass');

    let room1 = (await page
      .locator(`[data-test-room]`)
      .getAttribute('data-test-room')) as string;

    await assertRooms(page, [room1]);

    let room2 = await createRoom(page);
    let room3 = await createRoom(page);
    await assertRooms(page, [room1, room2, room3]);

    await openRenameMenu(page, room1);
    await expect(page.locator('[data-test-rename-session]')).toHaveCount(1);
    await expect(page.locator('[data-test-past-sessions]')).toHaveCount(0);
    let name = await page.locator(`[data-test-name-field]`).inputValue();
    expect(name).toEqual(room1);
    await expect(page.locator(`[data-test-save-name-button]`)).toBeDisabled();
    await expect(page.locator(`[data-test-cancel-name-button]`)).toBeEnabled();

    const newRoom1 = 'Room 1';
    await page.locator(`[data-test-name-field]`).fill(newRoom1);
    name = await page.locator(`[data-test-name-field]`).inputValue();
    expect(name).toEqual(newRoom1);
    await expect(page.locator(`[data-test-save-name-button]`)).toBeEnabled();
    await page.locator('[data-test-save-name-button]').click();

    await expect(page.locator('[data-test-rename-session]')).toHaveCount(0);
    await expect(page.locator('[data-test-past-sessions]')).toHaveCount(0);
    await assertRooms(page, [newRoom1, room2, room3]);

    await openRoom(page, newRoom1);
    await expect(page.locator(`[data-test-room-name]`)).toHaveText(newRoom1);

    await reloadAndOpenAiAssistant(page);
    await assertRooms(page, [newRoom1, room2, room3]);

    await logout(page);
    await login(page, 'user1', 'pass');
    await assertRooms(page, [newRoom1, room2, room3]);
  });

  test('it can cancel renaming a room', async ({ page }) => {
    await login(page, 'user1', 'pass');

    let room1 = (await page
      .locator(`[data-test-room]`)
      .getAttribute('data-test-room')) as string;

    await assertRooms(page, [room1]);

    let room2 = await createRoom(page);
    let room3 = await createRoom(page);
    await assertRooms(page, [room1, room2, room3]);

    await openRenameMenu(page, room1);
    const newName = 'Room 1';
    await page.locator(`[data-test-name-field]`).fill(newName);
    expect(await page.locator(`[data-test-name-field]`).inputValue()).toEqual(
      newName,
    );
    await page.locator('[data-test-cancel-name-button]').click();
    await expect(page.locator(`[data-test-past-sessions]`)).toHaveCount(0);
    await expect(page.locator(`[data-test-rename-session]`)).toHaveCount(0);
    await assertRooms(page, [room1, room2, room3]);

    await openRenameMenu(page, room1);
    let name = await page.locator('[data-test-name-field]').inputValue();
    expect(name).not.toEqual(newName);
    expect(name).toEqual(room1);
    await expect(page.locator('[data-test-save-name-button]')).toBeDisabled();
    await page.locator('[data-test-cancel-name-button]').click();
    expect(await page.locator(`[data-test-rename-session]`)).toHaveCount(0);
  });
});
