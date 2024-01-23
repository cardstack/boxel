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
  createRoom,
  assertMessages,
  openRoom,
  setObjective,
  sendMessage,
  registerRealmUsers,
} from '../helpers';

test.describe('Room objectives', () => {
  let synapse: SynapseInstance;
  test.beforeEach(async () => {
    synapse = await synapseStart();
    await registerRealmUsers(synapse);
    await registerUser(synapse, 'user1', 'pass');
  });
  test.afterEach(async () => {
    await synapseStop(synapse.synapseId);
  });
  test('room objective updates milestones as they are completed', async ({
    page,
  }) => {
    await login(page, 'user1', 'pass');
    let roomName = await createRoom(page);
    await setObjective(
      page,
      'https://cardstack.com/base/fields/room-objective-field',
    );

    await sendMessage(page, roomName, `I'm not saying Hello yet...`);

    await expect(page.locator(`[data-test-objective-progress]`)).toContainText(
      `Completed 0 of 1 (0%)`,
    );
    await expect(page.locator(`[data-test-objective-remaining]`)).toContainText(
      `user1`,
    );

    await sendMessage(page, roomName, `_Hello_`);
    await expect(page.locator(`[data-test-objective-progress]`)).toContainText(
      `Completed 1 of 1 (100%)`,
    );
    await expect(page.locator(`[data-test-objective-is-complete]`)).toHaveCount(
      1,
    );

    await logout(page);
    await login(page, 'user1', 'pass');
    await openRoom(page, roomName);
    await expect(page.locator(`[data-test-objective-progress]`)).toContainText(
      `Completed 1 of 1 (100%)`,
    );
    await expect(page.locator(`[data-test-objective-is-complete]`)).toHaveCount(
      1,
    );
  });

  test('room creator can set a room objective', async ({ page }) => {
    await login(page, 'user1', 'pass');
    await createRoom(page);

    await setObjective(
      page,
      'https://cardstack.com/base/fields/room-objective-field',
    );
    await expect(page.locator(`[data-test-objective]`)).toContainText(
      'Objective: Make sure that all room members greet each other by saying "Hello"',
    );
    await assertMessages(page, [
      { from: 'user1', message: 'user1 has set the room objectives' },
    ]);
    await expect(
      page.locator(`[data-test-set-objective-btn]`),
      'The set objective button does not appear after an objective has been set',
    ).toHaveCount(0);
  });

  test('room objective can be completed', async ({ page }) => {
    await login(page, 'user1', 'pass');
    let roomName = await createRoom(page);

    await setObjective(
      page,
      'https://cardstack.com/base/fields/room-objective-field',
    );
    await sendMessage(page, roomName, `hello!`);

    await expect(page.locator(`[data-test-objective-progress]`)).toContainText(
      `Completed 1 of 1 (100%)`,
    );
    await expect(
      page.locator(`[data-test-objective-is-complete]`),
    ).toContainText('The objective is completed');
  });
});
