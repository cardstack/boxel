import { test } from '@playwright/test';
import { registerUser } from '../docker/synapse';
import {
  synapseStart,
  synapseStop,
  type SynapseInstance,
} from '../docker/synapse';
import { login, assertRooms, deleteRoom, registerRealmUsers } from '../helpers';

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
    let room = (await page
      .locator(`[data-test-room]`)
      .getAttribute('data-test-room')) as string;

    await assertRooms(page, [room]);

    await deleteRoom(page, room);
    await assertRooms(page, []);
  });

  test('it can cancel deleting a room from past sessions list', async ({
    page,
  }) => {
    await login(page, 'user1', 'pass');
    let room = (await page
      .locator(`[data-test-room]`)
      .getAttribute('data-test-room')) as string;

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
    await page.locator(`[data-test-close-past-sessions]`).click();
    await assertRooms(page, [room]);
  });
});
