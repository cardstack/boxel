import { expect, test } from '@playwright/test';
import { registerUser } from '../docker/synapse';
import {
  synapseStart,
  synapseStop,
  type SynapseInstance,
} from '../docker/synapse';
import {
  appURL,
  startServer as startRealmServer,
  type IsolatedRealmServer,
} from '../helpers/isolated-realm-server';
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
  getRoomId,
  createRoomWithMessage,
  deleteRoom,
  isInRoom,
  getRoomsFromSync,
  initialRoomName,
  setupUserSubscribed,
  setSkillsRedirect,
  waitUntil,
  createSubscribedUser,
} from '../helpers';

test.describe('Room creation', () => {
  let firstUser: { username: string; password: string; credentials: any };
  let secondUser: { username: string; password: string; credentials: any };
  let xUser: { username: string; password: string; credentials: any };

  test.beforeEach(async ({ page }) => {
    test.setTimeout(120_000);
    await setSkillsRedirect(page);
    await clearLocalStorage(page, appURL);

    firstUser = await createSubscribedUser('user-1');
    secondUser = await createSubscribedUser('user-2');
    xUser = await createSubscribedUser('xuser');
  });

  test('it can create a room', async ({ page }) => {
    await login(page, firstUser.username, firstUser.password, { url: appURL });

    let room1 = await getRoomId(page); // Automatically created room
    await assertRooms(page, [room1]);
    await sendMessage(page, room1, 'Hello');

    let room2 = await createRoom(page);
    await assertRooms(page, [room1, room2]);

    // Assert that the room selection persists for each tab separately after reload
    const context = page.context();
    const page2 = await context.newPage();
    await page2.goto(appURL);
    await openRoom(page, room1);
    await openRoom(page2, room2);
    await page.reload();
    await page2.reload();
    await expect(page.locator(`[data-test-room="${room1}"]`)).toHaveCount(1);
    await expect(page2.locator(`[data-test-room="${room2}"]`)).toHaveCount(1);

    await assertRooms(page, [room1, room2]);

    await logout(page);
    await login(page, firstUser.username, firstUser.password, { url: appURL });
    await assertRooms(page, [room1, room2]);

    // user2 should not be able to see user1's room
    await logout(page);
    await login(page, secondUser.username, secondUser.password, {
      url: appURL,
    });

    let room1New = await getRoomId(page); // Automatically created room
    await assertRooms(page, [room1New]);
  });

  // SKIPPING FLAKY TEST! Re-enabled while we work on the fix.
  // https://linear.app/cardstack/issue/CS-6640/flaky-matrix-test-room-creation-spec-does-not-create-a-new-room-when
  test('it does not create a new room when another new room is available [CS-6640]', async ({
    page,
  }) => {
    await login(page, firstUser.username, firstUser.password, { url: appURL });

    let room = await getRoomId(page); // Automatically created room
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
    expect(await getRoomId(page)).toEqual(newRoom);
    await assertRooms(page, [room, newRoom]);

    await reloadAndOpenAiAssistant(page);
    await assertRooms(page, [room, newRoom]);

    await logout(page);
    await login(page, firstUser.username, firstUser.password, { url: appURL });
    await assertRooms(page, [room, newRoom]);

    // user2 should not be able to see user1's room
    await logout(page);
    await login(page, secondUser.username, secondUser.password, {
      url: appURL,
    });
    let user2Room = await getRoomId(page);
    await assertRooms(page, [user2Room]);
    expect(user2Room).not.toEqual(room);
    expect(user2Room).not.toEqual(newRoom);
  });

  // skipping flaky test: re-enabled while we work on the fix.
  // https://linear.app/cardstack/issue/CS-7637/flaky-test-room-creationspects1217-%E2%80%BA-room-creation-%E2%80%BA-it-can-rename-a
  test('it can rename a room [CS-7637]', async ({ page }) => {
    await login(page, firstUser.username, firstUser.password, { url: appURL });

    let room1 = await getRoomId(page);
    await assertRooms(page, [room1]);
    await sendMessage(page, room1, 'Hello');
    await expect(page.locator(`[data-test-chat-title]`)).toHaveText(
      initialRoomName,
    );

    let room2 = await createRoomWithMessage(page);
    await expect(page.locator(`[data-test-chat-title]`)).toHaveText(
      initialRoomName,
    );

    let room3 = await createRoom(page);
    await assertRooms(page, [room1, room2, room3]);

    await openRenameMenu(page, room1);
    await expect(page.locator('[data-test-rename-session]')).toHaveCount(1);
    await expect(page.locator('[data-test-past-sessions]')).toHaveCount(0);
    let name = await page.locator(`[data-test-name-field]`).inputValue();
    expect(name).toEqual(initialRoomName);
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
      page.locator(`[data-test-joined-room="${room1}"]`),
    ).toContainText(newRoom1);
    await page.locator('[data-test-ai-assistant-panel]').click();
    await assertRooms(page, [room1, room2, room3]);

    await openRoom(page, room1);
    await expect(page.locator(`[data-test-room="${room1}"]`)).toHaveCount(1);
    await expect(page.locator(`[data-test-chat-title]`)).toHaveText(newRoom1);

    await reloadAndOpenAiAssistant(page);
    await assertRooms(page, [room1, room2, room3]);

    await logout(page);
    await login(page, firstUser.username, firstUser.password, { url: appURL });
    await assertRooms(page, [room1, room2, room3]);
  });

  test('it can cancel renaming a room', async ({ page }) => {
    await login(page, firstUser.username, firstUser.password, { url: appURL });

    let room1 = await getRoomId(page);
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
      page.locator(`[data-test-joined-room="${room1}"]`),
    ).toContainText(initialRoomName);
    await page.locator('[data-test-ai-assistant-panel]').click();
    await assertRooms(page, [room1, room2, room3]);

    await openRenameMenu(page, room1);
    let name = await page.locator('[data-test-name-field]').inputValue();
    expect(name).not.toEqual(newName);
    expect(name).toEqual(initialRoomName);
    await expect(page.locator('[data-test-save-name-button]')).toBeDisabled();
    await page.locator('[data-test-cancel-name-button]').click();
    await expect(page.locator(`[data-test-rename-session]`)).toHaveCount(0);
    await page.locator('[data-test-ai-assistant-panel]').click();
  });

  test('room names do not persist across different user sessions', async ({
    page,
  }) => {
    await login(page, firstUser.username, firstUser.password, { url: appURL });

    let room = await getRoomId(page);
    await sendMessage(page, room, 'Hello');
    await openRenameMenu(page, room);

    const newRoomName = 'Room 1';
    await page.locator(`[data-test-name-field]`).fill(newRoomName);
    await page.locator('[data-test-save-name-button]').click();
    await waitUntil(
      async () =>
        (await page.locator('[data-test-rename-session]').count()) === 0,
    );
    await page.locator('[data-test-ai-assistant-panel]').click();

    await openRoom(page, room);
    await expect(page.locator(`[data-test-chat-title]`)).toHaveText(
      newRoomName,
    );

    await logout(page);
    await login(page, xUser.username, xUser.password, {
      url: appURL,
    });

    await expect(page.locator(`[data-test-close-ai-assistant]`)).toHaveCount(1);
    await expect(page.locator(`[data-test-chat-title]`)).not.toHaveText(
      newRoomName,
    );
  });

  test('it can delete a room', async ({ page }) => {
    await login(page, firstUser.username, firstUser.password, { url: appURL });
    await page.locator(`[data-test-room-settled]`).waitFor();
    let roomsBeforeDeletion = await getRoomsFromSync(
      firstUser.username,
      firstUser.password,
    );

    let room1 = await getRoomId(page);
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
    await page.locator('[data-test-ai-assistant-panel]').click(); // close past sessions tab

    await deleteRoom(page, room2);
    await expect(
      page.locator(`[data-test-joined-room="${room2}"]`),
    ).toHaveCount(0);
    await expect(
      page.locator(`[data-test-joined-room="${room3}"]`),
    ).toHaveCount(1);
    await page.locator('[data-test-ai-assistant-panel]').click(); // close past sessions tab

    await deleteRoom(page, room3);
    await expect(page.locator(`[data-test-past-sessions]`)).toHaveCount(0);

    await page.waitForTimeout(500); // wait for new room to be created
    let newRoom = await getRoomId(page);
    expect(newRoom).not.toEqual(room1);
    expect(newRoom).not.toEqual(room2);
    expect(newRoom).not.toEqual(room3);
    await assertRooms(page, [newRoom]);
    await page.locator(`[data-test-room-settled]`).waitFor();

    // For asserting the result of the forget matrix API
    let roomsAfterDeletion = await getRoomsFromSync(
      firstUser.username,
      firstUser.password,
    );
    let roomsAfterDeletionKeys = Object.keys(roomsAfterDeletion.join);
    let roomsBeforeDeletionKeys = Object.keys(roomsBeforeDeletion.join);
    expect(roomsAfterDeletionKeys.length).toEqual(
      roomsBeforeDeletionKeys.length,
    );
    expect(roomsAfterDeletionKeys, 'room1 check').not.toContain(room1);
    expect(roomsAfterDeletionKeys, 'room2 check').not.toContain(room2);
    expect(roomsAfterDeletionKeys, 'room3 check').not.toContain(room3);
  });

  test('it can cancel deleting a room', async ({ page }) => {
    await login(page, firstUser.username, firstUser.password, { url: appURL });
    let room = await getRoomId(page);
    await assertRooms(page, [room]);

    await page.locator(`[data-test-past-sessions-button]`).click();

    // Here, past sessions could be rerendered because in one case we're creating a new room when opening an AI panel, so we need to wait for the past sessions to settle
    await page.waitForTimeout(500); // Wait for the sessions to settle after new room is created

    await page.locator(`[data-test-joined-room="${room}"]`).hover();
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
    await page.locator('[data-test-ai-assistant-panel]').click();
    await assertRooms(page, [room]);
  });

  test('it opens latest room available (or creates new) when current room is deleted', async ({
    page,
  }) => {
    await login(page, firstUser.username, firstUser.password, { url: appURL });
    let room1 = await getRoomId(page);
    await sendMessage(page, room1, 'Room 1');
    let room2 = await createRoomWithMessage(page, 'Room 2');
    let room3 = await createRoomWithMessage(page, 'Room 3'); // latest room
    await assertRooms(page, [room1, room2, room3]);

    await isInRoom(page, room3);
    await deleteRoom(page, room3); // current room is deleted
    await page.locator('[data-test-ai-assistant-panel]').click();
    await assertRooms(page, [room1, room2]);
    await isInRoom(page, room2); // is in latest available room

    await deleteRoom(page, room1); // a different room is deleted
    await page.locator('[data-test-ai-assistant-panel]').click();
    await assertRooms(page, [room2]);
    await isInRoom(page, room2); // remains in same room
    await deleteRoom(page, room2); // current room is deleted
    await page.locator('[data-test-ai-assistant-panel]').click();

    await page.waitForTimeout(500); // wait for new room to be created
    let newRoom = await getRoomId(page);
    await isInRoom(page, newRoom);
    await assertRooms(page, [newRoom]);
    await expect(page.locator('[data-test-room-is-empty]')).toHaveCount(1);
  });

  // skipping flaky test - re-enabled while we work on the fix.
  // https://linear.app/cardstack/issue/CS-7603/flaky-test-room-creation-%E2%80%BA-it-orders-past-sessions-list-items-based-on
  test('it orders past-sessions list items based on last activity in reverse chronological order [CS-7603]', async ({
    page,
  }) => {
    await login(page, firstUser.username, firstUser.password, { url: appURL });
    let room1 = await getRoomId(page);
    await sendMessage(page, room1, 'Room 1');
    let room2 = await createRoomWithMessage(page, 'Room 2');
    let room3 = await createRoomWithMessage(page, 'Room 3'); // latest room
    await assertRooms(page, [room1, room2, room3]);
    await isInRoom(page, room3);

    await page.locator(`[data-test-past-sessions-button]`).click();
    await expect(page.locator(`[data-test-joined-room]`)).toHaveCount(3);
    await expect(
      await page
        .locator(`[data-test-joined-room]:nth-of-type(1) .view-session-button`)
        .getAttribute('data-test-enter-room'),
    ).toEqual(room3);
    await expect(
      await page
        .locator(`[data-test-joined-room]:nth-of-type(2) .view-session-button`)
        .getAttribute('data-test-enter-room'),
    ).toEqual(room2);

    let lastActive1 = await page
      .locator(`[data-test-joined-room]:nth-of-type(1) [data-test-last-active]`)
      .getAttribute('data-test-last-active');
    let lastActive2 = await page
      .locator(`[data-test-joined-room]:nth-of-type(2) [data-test-last-active]`)
      .getAttribute('data-test-last-active');
    expect(Number(lastActive1)).toBeGreaterThan(Number(lastActive2));

    await page.locator(`[data-test-joined-room="${room2}"]`).click();
    await isInRoom(page, room2);
    await page.locator(`[data-test-past-sessions-button]`).click();
    await expect(
      await page
        .locator(`[data-test-joined-room]:nth-of-type(1) .view-session-button`)
        .getAttribute('data-test-enter-room'),
      'opening an existing room does not change the order',
    ).toEqual(room3);
    await expect(
      await page
        .locator(`[data-test-joined-room]:nth-of-type(2) .view-session-button`)
        .getAttribute('data-test-enter-room'),
    ).toEqual(room2);

    await sendMessage(page, room2, 'Hi');
    await page.locator(`[data-test-past-sessions-button]`).click();

    // Make sure we're waiting for the update
    await page.waitForFunction((roomId) => {
      const topRoomListItem = document.querySelector(
        `[data-test-joined-room]:nth-of-type(1) .view-session-button`,
      );
      return topRoomListItem?.getAttribute('data-test-enter-room') === roomId;
    }, room2);

    await expect(
      await page
        .locator(`[data-test-joined-room]:nth-of-type(1) .view-session-button`)
        .getAttribute('data-test-enter-room'),
      'sending a message changes the order',
    ).toEqual(room2);
    await expect(
      await page
        .locator(`[data-test-joined-room]:nth-of-type(2) .view-session-button`)
        .getAttribute('data-test-enter-room'),
    ).toEqual(room3);
    await page.locator('[data-test-ai-assistant-panel]').click();

    await openRenameMenu(page, room3);
    await page.locator('[data-test-cancel-name-button]').click();
    await page.locator(`[data-test-past-sessions]`).waitFor();
    await expect(
      await page
        .locator(`[data-test-joined-room]:nth-of-type(1) .view-session-button`)
        .getAttribute('data-test-enter-room'),
      'canceling rename does not change the order',
    ).toEqual(room2);
    await expect(
      await page
        .locator(`[data-test-joined-room]:nth-of-type(2) .view-session-button`)
        .getAttribute('data-test-enter-room'),
    ).toEqual(room3);
    await page.locator('[data-test-ai-assistant-panel]').click();

    await openRenameMenu(page, room3);
    await page.locator(`[data-test-name-field]`).fill('test room 3');
    await page.locator('[data-test-save-name-button]').click();
    await page.locator(`[data-test-past-sessions]`).waitFor();
    await expect(
      page.locator(`[data-test-joined-room]:nth-of-type(1) .name`),
      'renaming a room changes the order',
    ).toHaveText('test room 3');
    await expect(
      await page
        .locator(`[data-test-joined-room]:nth-of-type(2) .view-session-button`)
        .getAttribute('data-test-enter-room'),
    ).toEqual(room2);
    await isInRoom(page, room2);

    await reloadAndOpenAiAssistant(page);
    await isInRoom(page, room2);
    await page.locator(`[data-test-past-sessions-button]`).click();
    await expect(
      page.locator(`[data-test-joined-room]:nth-of-type(1) .name`),
      'updated order is preserved on reload',
    ).toHaveText('test room 3');
  });
});
