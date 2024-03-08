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
  sendMessage,
  getRoomName,
  createRoomWithMessage,
  deleteRoom,
  isInRoom,
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
  test.afterEach(async ({ page }) => {
    await clearLocalStorage(page);
    await synapseStop(synapse.synapseId);
  });

  test('it can create a room', async ({ page }) => {
    await login(page, 'user1', 'pass');

    let room1 = await getRoomName(page); // Automatically created room
    await assertRooms(page, [room1]);
    await sendMessage(page, room1, 'Hello');

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

    let room1New = await getRoomName(page); // Automatically created room
    await assertRooms(page, [room1New]);
  });

  test('it does not create a new room when another new room is available', async ({
    page,
  }) => {
    await login(page, 'user1', 'pass');

    let room = await getRoomName(page); // Automatically created room
    await expect(page.locator(`[data-test-create-room-btn]`)).toBeDisabled();
    await expect(page.locator(`[data-test-new-session]`)).toHaveCount(1);
    await sendMessage(page, room, 'Hello');
    await expect(page.locator(`[data-test-create-room-btn]`)).toBeEnabled();
    await expect(page.locator(`[data-test-new-session]`)).toHaveCount(0);

    let newRoom = await createRoom(page);
    await expect(page.locator(`[data-test-create-room-btn]`)).toBeDisabled();
    await expect(page.locator(`[data-test-new-session]`)).toHaveCount(1);

    await openRoom(page, room);
    await page.locator('[data-test-create-room-btn]').click();
    expect(await getRoomName(page)).toEqual(newRoom);
    await assertRooms(page, [room, newRoom]);

    await reloadAndOpenAiAssistant(page);
    await assertRooms(page, [room, newRoom]);

    await logout(page);
    await login(page, 'user1', 'pass');
    await assertRooms(page, [room, newRoom]);

    // user2 should not be able to see user1's room
    await logout(page);
    await login(page, 'user2', 'pass');
    let user2Room = await getRoomName(page);
    await assertRooms(page, [user2Room]);
    expect(user2Room).not.toEqual(room);
    expect(user2Room).not.toEqual(newRoom);
  });

  test('it can rename a room', async ({ page }) => {
    await login(page, 'user1', 'pass');

    let room1 = await getRoomName(page);
    await assertRooms(page, [room1]);
    await sendMessage(page, room1, 'Hello');

    let room2 = await createRoomWithMessage(page);
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
    await expect(page.locator('[data-test-past-sessions]')).toHaveCount(1);
    await expect(
      page.locator(`[data-test-joined-room="${newRoom1}"]`),
    ).toContainText(newRoom1);
    await page.locator(`[data-test-close-past-sessions]`).click();
    await assertRooms(page, [newRoom1, room2, room3]);

    await openRoom(page, newRoom1);
    await expect(page.locator(`[data-test-room="${newRoom1}"]`)).toHaveCount(1);

    await reloadAndOpenAiAssistant(page);
    await assertRooms(page, [newRoom1, room2, room3]);

    await logout(page);
    await login(page, 'user1', 'pass');
    await assertRooms(page, [newRoom1, room2, room3]);
  });

  test('it can cancel renaming a room', async ({ page }) => {
    await login(page, 'user1', 'pass');

    let room1 = await getRoomName(page);
    await assertRooms(page, [room1]);
    await sendMessage(page, room1, 'Hello');

    let room2 = await createRoomWithMessage(page);
    let room3 = await createRoom(page);
    await assertRooms(page, [room1, room2, room3]);

    await openRenameMenu(page, room1);
    const newName = 'Room 1';
    await page.locator(`[data-test-name-field]`).fill(newName);
    expect(await page.locator(`[data-test-name-field]`).inputValue()).toEqual(
      newName,
    );
    await page.locator('[data-test-cancel-name-button]').click();
    await expect(page.locator(`[data-test-rename-session]`)).toHaveCount(0);
    await expect(page.locator(`[data-test-past-sessions]`)).toHaveCount(1);
    await expect(
      page.locator(`[data-test-joined-room="${newName}"]`),
    ).toHaveCount(0);
    await expect(
      page.locator(`[data-test-joined-room="${room1}"]`),
    ).toContainText(room1);
    await page.locator(`[data-test-close-past-sessions]`).click();
    await assertRooms(page, [room1, room2, room3]);

    await openRenameMenu(page, room1);
    let name = await page.locator('[data-test-name-field]').inputValue();
    expect(name).not.toEqual(newName);
    expect(name).toEqual(room1);
    await expect(page.locator('[data-test-save-name-button]')).toBeDisabled();
    await page.locator('[data-test-cancel-name-button]').click();
    await expect(page.locator(`[data-test-rename-session]`)).toHaveCount(0);
    await page.locator(`[data-test-close-past-sessions]`).click();
  });

  test('it can delete a room', async ({ page }) => {
    await login(page, 'user1', 'pass');
    let room1 = await getRoomName(page);
    await sendMessage(page, room1, 'Room 1');
    let room2 = await createRoomWithMessage(page, 'Room 2');
    let room3 = await createRoomWithMessage(page, 'Room 3');
    await assertRooms(page, [room1, room2, room3]);

    await deleteRoom(page, room1);
    await expect(
      page.locator(`[data-test-joined-room="${room1}"]`),
    ).toHaveCount(0);
    await expect(
      page.locator(`[data-test-joined-room="${room2}"]`),
    ).toHaveCount(1);
    await expect(
      page.locator(`[data-test-joined-room="${room3}"]`),
    ).toHaveCount(1);

    await page
      .locator(`[data-test-past-session-options-button="${room2}"]`)
      .click();
    await page.locator(`[data-test-boxel-menu-item-text="Delete"]`).click();
    await page
      .locator(
        `[data-test-delete-modal-container] [data-test-confirm-delete-button]`,
      )
      .click();
    await expect(
      page.locator(`[data-test-joined-room="${room2}"]`),
    ).toHaveCount(0);
    await expect(
      page.locator(`[data-test-joined-room="${room3}"]`),
    ).toHaveCount(1);

    await page
      .locator(`[data-test-past-session-options-button="${room3}"]`)
      .click();
    await page.locator(`[data-test-boxel-menu-item-text="Delete"]`).click();
    await page
      .locator(
        `[data-test-delete-modal-container] [data-test-confirm-delete-button]`,
      )
      .click();
    await expect(page.locator(`[data-test-past-sessions]`)).toHaveCount(0);

    await page.waitForTimeout(500); // wait for new room to be created
    let newRoom = await getRoomName(page);
    expect(newRoom).not.toEqual(room1);
    expect(newRoom).not.toEqual(room2);
    expect(newRoom).not.toEqual(room3);
    await assertRooms(page, [newRoom]);
  });

  test('it can cancel deleting a room', async ({ page }) => {
    await login(page, 'user1', 'pass');
    let room = await getRoomName(page);
    await assertRooms(page, [room]);

    await page.locator(`[data-test-past-sessions-button]`).click();

    // Here, past sessions could be rerendered because in one case we're creating a new room when opening an AI panel, so we need to wait for the past sessions to settle
    await page.waitForTimeout(500); // Wait for the sessions to settle after new room is created

    await page
      .locator(`[data-test-past-session-options-button="${room}"]`)
      .click();
    await page.locator(`[data-test-boxel-menu-item-text="Delete"]`).click();
    await page
      .locator(
        `[data-test-delete-modal-container] [data-test-confirm-cancel-button]`,
      )
      .click();
    await expect(page.locator(`[data-test-joined-room="${room}"]`)).toHaveCount(
      1,
    );
    await page.locator(`[data-test-close-past-sessions]`).click();
    await assertRooms(page, [room]);
  });

  test('it opens latest room available (or creates new) when current room is deleted', async ({
    page,
  }) => {
    await login(page, 'user1', 'pass');
    let room1 = await getRoomName(page);
    await sendMessage(page, room1, 'Room 1');
    let room2 = await createRoomWithMessage(page, 'Room 2');
    let room3 = await createRoomWithMessage(page, 'Room 3'); // latest room
    await assertRooms(page, [room1, room2, room3]);

    await isInRoom(page, room3);
    await deleteRoom(page, room3); // current room is deleted
    await page.locator(`[data-test-close-past-sessions]`).click();
    await assertRooms(page, [room1, room2]);
    await isInRoom(page, room2); // is in latest available room

    await deleteRoom(page, room1); // a different room is deleted
    await page.locator(`[data-test-close-past-sessions]`).click();
    await assertRooms(page, [room2]);
    await isInRoom(page, room2); // remains in same room
    await deleteRoom(page, room2); // current room is deleted
    await page.locator(`[data-test-close-past-sessions]`).click();

    await page.waitForTimeout(500); // wait for new room to be created
    let newRoom = await getRoomName(page);
    await isInRoom(page, newRoom);
    await assertRooms(page, [newRoom]);
  });
});
