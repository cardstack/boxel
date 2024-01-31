import { expect } from '@playwright/test';
import { registerUser } from '../docker/synapse';
import { synapseStop, type SynapseInstance } from '../docker/synapse';
import {
  login,
  logout,
  createRoom,
  assertMessages,
  openRoom,
  setObjective,
  sendMessage,
  joinRoom,
  registerRealmUsers,
  startTestingSynapse,
  test,
} from '../helpers';

test.describe('Room objectives', () => {
  let synapse: SynapseInstance;
  test.beforeEach(async () => {
    synapse = await startTestingSynapse();
    await registerRealmUsers(synapse);
    await registerUser(synapse, 'user1', 'pass');
    await registerUser(synapse, 'user2', 'pass');
  });
  test.afterEach(async () => {
    await synapseStop(synapse.synapseId);
  });
  test('room objective updates milestones as they are completed', async ({
    page,
  }) => {
    await login(page, 'user1', 'pass');
    await createRoom(page, { name: 'Room 1', invites: ['user2'] });
    await setObjective(
      page,
      'https://cardstack.com/base/fields/room-objective-field',
    );

    await logout(page);
    await login(page, 'user2', 'pass');
    await joinRoom(page, 'Room 1');
    await openRoom(page, 'Room 1');

    await sendMessage(page, 'Room 1', `I'm not saying Hello yet...`);

    await expect(page.locator(`[data-test-objective-progress]`)).toContainText(
      `Completed 0 of 2 (0%)`,
    );
    await expect(page.locator(`[data-test-objective-remaining]`)).toContainText(
      `user1, user2`,
    );

    await sendMessage(page, 'Room 1', `_Hello_`);
    await expect(page.locator(`[data-test-objective-progress]`)).toContainText(
      `Completed 1 of 2 (50%)`,
    );
    await expect(page.locator(`[data-test-objective-remaining]`)).toContainText(
      `user1`,
    );
  });

  test('room creator can set a room objective', async ({ page }) => {
    await login(page, 'user1', 'pass');
    await createRoom(page, { name: 'Room 1' });

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

  test('non-room creator cannot set a room objective', async ({ page }) => {
    await login(page, 'user1', 'pass');
    await createRoom(page, { name: 'Room 1', invites: ['user2'] });
    await logout(page);
    await login(page, 'user2', 'pass');
    await joinRoom(page, 'Room 1');
    await openRoom(page, 'Room 1');

    await expect(
      page.locator(`[data-test-set-objective-btn]`),
      'The set objective button does not appear',
    ).toHaveCount(0);
  });

  test('room objective updates milestones as members join the room', async ({
    page,
  }) => {
    await login(page, 'user1', 'pass');
    await createRoom(page, { name: 'Room 1', invites: ['user2'] });

    await setObjective(
      page,
      'https://cardstack.com/base/fields/room-objective-field',
    );
    await expect(page.locator(`[data-test-objective-progress]`)).toContainText(
      `Completed 0 of 1 (0%)`,
    );
    await expect(page.locator(`[data-test-objective-remaining]`)).toContainText(
      `user1`,
    );

    await logout(page);
    await login(page, 'user2', 'pass');
    await joinRoom(page, 'Room 1');
    await openRoom(page, 'Room 1');

    await expect(page.locator(`[data-test-objective-progress]`)).toContainText(
      `Completed 0 of 2 (0%)`,
    );
    await expect(page.locator(`[data-test-objective-remaining]`)).toContainText(
      `user1, user2`,
    );
  });

  test('room objective can be completed', async ({ page }) => {
    await login(page, 'user1', 'pass');
    await createRoom(page, { name: 'Room 1' });

    await setObjective(
      page,
      'https://cardstack.com/base/fields/room-objective-field',
    );
    await sendMessage(page, 'Room 1', `hello!`);

    await expect(page.locator(`[data-test-objective-progress]`)).toContainText(
      `Completed 1 of 1 (100%)`,
    );
    await expect(
      page.locator(`[data-test-objective-is-complete]`),
    ).toContainText('The objective is completed');
  });

  test('completed room objective can be uncompleted if a new member joins the room', async ({
    page,
  }) => {
    await login(page, 'user1', 'pass');
    await createRoom(page, { name: 'Room 1', invites: ['user2'] });

    await setObjective(
      page,
      'https://cardstack.com/base/fields/room-objective-field',
    );
    await sendMessage(page, 'Room 1', `hello`);
    await expect(
      page.locator(`[data-test-objective-is-complete]`),
    ).toContainText('The objective is completed');

    await logout(page);
    await login(page, 'user2', 'pass');
    await joinRoom(page, 'Room 1');
    await openRoom(page, 'Room 1');

    await expect(page.locator(`[data-test-objective-progress]`)).toContainText(
      `Completed 1 of 2 (50%)`,
    );
    await expect(page.locator(`[data-test-objective-remaining]`)).toContainText(
      `user2`,
    );
    await expect(page.locator(`[data-test-objective-is-complete]`)).toHaveCount(
      0,
    );

    await sendMessage(page, 'Room 1', `Hello`);
    await expect(page.locator(`[data-test-objective-progress]`)).toContainText(
      `Completed 2 of 2 (100%)`,
    );
    await expect(
      page.locator(`[data-test-objective-is-complete]`),
    ).toContainText('The objective is completed');
  });
});
