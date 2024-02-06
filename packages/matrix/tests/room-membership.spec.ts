import { test } from '@playwright/test';
import { registerUser } from '../docker/synapse';
import {
  synapseStart,
  synapseStop,
  type SynapseInstance,
} from '../docker/synapse';
import {
  login,
  assertRooms,
  createRoom,
  deleteRoom,
  reloadAndOpenAiAssistant,
  registerRealmUsers,
} from '../helpers';

test.describe('Room membership', () => {
  let synapse: SynapseInstance;
  test.beforeEach(async () => {
    synapse = await synapseStart();
    await registerRealmUsers(synapse);
    await registerUser(synapse, 'user1', 'pass');
  });
  test.afterEach(async () => {
    await synapseStop(synapse.synapseId);
  });

  test('it can delete a room from past sessions list', async ({ page }) => {
    await login(page, 'user1', 'pass');
    let name = await createRoom(page);
    await assertRooms(page, [name]);

    await deleteRoom(page, name);
    await assertRooms(page, []);

    await reloadAndOpenAiAssistant(page);
    await assertRooms(page, []);
  });

  test('it can cancel deleting a room from past sessions list', async ({
    page,
  }) => {
    await login(page, 'user1', 'pass');
    let name = await createRoom(page);
    await assertRooms(page, [name]);

    await page.locator(`[data-test-past-sessions-button]`).click();
    await page
      .locator(`[data-test-past-session-options-button="${name}"]`)
      .click();
    await page.locator(`[data-test-boxel-menu-item-text="Delete"]`).click();
    await page
      .locator(
        `[data-test-delete-modal-container] [data-test-confirm-cancel-button]`,
      )
      .click();
    await page.locator(`[data-test-close-past-sessions]`).click();
    await assertRooms(page, [name]);

    await reloadAndOpenAiAssistant(page);
    await assertRooms(page, [name]);
  });
});
