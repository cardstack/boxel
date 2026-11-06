import {
  click,
  find,
  findAll,
  settled,
  waitFor,
  waitUntil,
} from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import { APP_BOXEL_MESSAGE_MSGTYPE } from '@cardstack/runtime-common/matrix-constants';

import type MatrixService from '@cardstack/host/services/matrix-service';

import { visitOperatorMode } from '../helpers';
import {
  realmURL,
  markHosted,
  nameFromTip,
  operatorModeState,
  setupDashboardTest,
} from '../helpers/dashboard';

module('Acceptance | dashboard get started', function (hooks) {
  let mockMatrixUtils = setupDashboardTest(hooks);

  const GET_STARTED = '[data-test-get-started]';
  const BUTTON = '[data-test-get-started-button]';

  // As `hasText` reads it: the count's markup breaks across lines.
  function countText() {
    return (find('[data-test-get-started-count]')?.textContent ?? '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function stepDone(id: string) {
    return find(`[data-test-get-started-step="${id}"]`)?.getAttribute(
      'data-test-get-started-step-done',
    );
  }

  // Closes the dashboard and opens it again, where Get started starts
  // closed.
  // The chooser's toggle is disabled with no stack open, so this sets
  // the state it toggles.
  async function reopenDashboard() {
    operatorModeState().workspaceChooserOpened = false;
    await settled();
    operatorModeState().workspaceChooserOpened = true;
    await waitFor('[data-test-dashboard-greeting]');
  }

  // From no progress at all, as a new account starts.
  async function visitAsNewUser() {
    await visitOperatorMode({ workspaceChooserOpened: true });
    (getService('recent-cards-service') as any).resetState();
    await mockMatrixUtils.setDashboardStateFromAnotherDevice({});
    await settled();
    await reopenDashboard();
  }

  async function openSteps() {
    await click(BUTTON);
  }

  // Opens the AI panel from the ask step, which makes an empty session.
  async function openBoxelAiSession() {
    await click('[data-test-get-started-action="ask-ai"]');
    let matrixService = getService('matrix-service') as MatrixService;
    await waitUntil(() => matrixService.currentRoomId);
    await settled();
    return matrixService.currentRoomId!;
  }

  function sendMessage(roomId: string) {
    mockMatrixUtils.simulateRemoteMessage(roomId, '@testuser:localhost', {
      body: 'Make me a card for tracking tasks',
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
    });
  }

  test('a new account finds the steps closed, and the button opens them right after the header', async function (assert) {
    await visitAsNewUser();

    assert.dom(BUTTON).hasText('Get started');
    assert.dom(BUTTON).hasAttribute('aria-expanded', 'false');
    assert.dom(GET_STARTED).doesNotExist();

    await openSteps();
    assert.dom(BUTTON).hasAttribute('aria-expanded', 'true');
    assert.dom(GET_STARTED).exists();
    assert.dom('[data-test-get-started-count]').hasText('0 of 3 done');
    assert.deepEqual(
      findAll('[data-test-get-started-step]').map((el) =>
        el.getAttribute('data-test-get-started-step'),
      ),
      ['open-card', 'ask-ai', 'publish'],
    );
    assert.dom('[data-test-get-started-step-done="true"]').doesNotExist();
    assert.strictEqual(
      find('[data-test-dashboard-greeting]')!.closest('header')!
        .nextElementSibling,
      find(GET_STARTED),
      'the steps open right after the header',
    );
  });

  test('the button closes the steps it opened', async function (assert) {
    await visitAsNewUser();
    await openSteps();

    await click(BUTTON);
    assert.dom(GET_STARTED).doesNotExist();
    assert.dom(BUTTON).hasAttribute('aria-expanded', 'false');
  });

  test('the minimize button folds the list to its progress and next step, and expands it again', async function (assert) {
    const TOGGLE = '[data-test-get-started-toggle]';
    await visitAsNewUser();
    await openSteps();
    (getService('recent-cards-service') as any).add(`${realmURL}index`);
    await settled();

    assert.strictEqual(nameFromTip(TOGGLE), 'Minimize steps');
    await click(TOGGLE);

    assert.dom(GET_STARTED).exists('the list stays open, folded');
    assert.dom('[data-test-get-started-step]').doesNotExist();
    assert.strictEqual(
      countText(),
      '1 of 3 done · Next: Ask Boxel AI Assistant to build something',
    );
    assert.strictEqual(nameFromTip(TOGGLE), 'Expand steps');
    assert.dom(TOGGLE).hasAttribute('aria-expanded', 'false');
    assert.dom(BUTTON).hasAttribute('aria-expanded', 'true');

    await click(TOGGLE);
    assert.dom('[data-test-get-started-step]').exists({ count: 3 });
    assert.strictEqual(nameFromTip(TOGGLE), 'Minimize steps');
    assert.dom(TOGGLE).hasAttribute('aria-expanded', 'true');
  });

  test('reopened from the button, a folded list shows its steps again', async function (assert) {
    await visitAsNewUser();
    await openSteps();
    await click('[data-test-get-started-toggle]');

    await click(BUTTON);
    await click(BUTTON);

    assert.dom('[data-test-get-started-step]').exists({ count: 3 });
  });

  test('a step done while the steps are open keeps them open', async function (assert) {
    await visitAsNewUser();
    await openSteps();

    await mockMatrixUtils.setDashboardStateFromAnotherDevice({
      agentSetup: { claude: 1 },
    });
    await settled();

    assert.dom('[data-test-get-started-count]').hasText('1 of 3 done');
    assert.strictEqual(stepDone('agent'), 'true');
    assert.strictEqual(stepDone('open-card'), 'false');
  });

  test('opened steps are closed again when the dashboard reopens', async function (assert) {
    await visitAsNewUser();
    await openSteps();
    (getService('recent-cards-service') as any).add(`${realmURL}index`);
    await settled();

    await reopenDashboard();

    assert.dom(GET_STARTED).doesNotExist();
    assert.dom(BUTTON).hasAttribute('aria-expanded', 'false');

    await openSteps();
    assert.strictEqual(stepDone('open-card'), 'true');
  });

  test('opening a card and publishing a workspace tick their steps', async function (assert) {
    await visitAsNewUser();
    await openSteps();

    (getService('recent-cards-service') as any).add(`${realmURL}index`);
    markHosted(realmURL);
    await settled();

    assert.strictEqual(stepDone('open-card'), 'true');
    assert.strictEqual(stepDone('publish'), 'true');
    assert.strictEqual(stepDone('ask-ai'), 'false');
  });

  test('asking Boxel AI Assistant something ticks the ask step, and opening a session does not', async function (assert) {
    await visitAsNewUser();
    await openSteps();

    let roomId = await openBoxelAiSession();
    assert.strictEqual(
      stepDone('ask-ai'),
      'false',
      'an empty session has not been asked anything',
    );

    sendMessage(roomId);
    await waitUntil(() => countText() === '1 of 3 done');

    assert.strictEqual(stepDone('ask-ai'), 'true');
  });

  test('a session the bot has renamed ticks the ask step, before any message loads', async function (assert) {
    await visitAsNewUser();
    await openSteps();

    let roomId = await openBoxelAiSession();
    mockMatrixUtils.setRoomState(roomId, 'm.room.name', {
      name: 'Task tracker',
    });
    await waitUntil(() => countText() === '1 of 3 done');

    assert.strictEqual(stepDone('ask-ai'), 'true');
  });

  test('with every step done, neither the button nor the steps show', async function (assert) {
    await visitAsNewUser();
    await openSteps();
    assert.dom(GET_STARTED).exists();

    await mockMatrixUtils.setDashboardStateFromAnotherDevice({
      agent: 'claude',
      agentSetup: { claude: 1 },
    });
    (getService('recent-cards-service') as any).add(`${realmURL}index`);
    markHosted(realmURL);
    await settled();

    assert.dom(GET_STARTED).doesNotExist('nothing left to start');
    assert.dom(BUTTON).doesNotExist();

    let matrixService = getService('matrix-service') as MatrixService;
    await waitUntil(() => matrixService.dashboardState.onboardingDismissed);
    assert
      .dom('[data-test-get-started-dismissed]')
      .doesNotExist('finishing offers no undo');
    assert.true(
      (mockMatrixUtils.getDashboardState() as any).onboardingDismissed,
      'the dismissal is stored',
    );

    (getService('recent-cards-service') as any).resetState();
    await settled();
    assert
      .dom(BUTTON)
      .doesNotExist('a step that reads as undone later does not bring it back');

    await reopenDashboard();
    assert.dom(BUTTON).doesNotExist('still gone after reopening');
  });

  test('picking a coding agent puts the agent step in place of the ask step', async function (assert) {
    await visitAsNewUser();
    await openSteps();

    await mockMatrixUtils.setDashboardStateFromAnotherDevice({
      agent: 'codex',
    });
    await settled();

    assert.dom('[data-test-get-started-count]').hasText('0 of 3 done');
    assert.deepEqual(
      findAll('[data-test-get-started-step]').map((el) =>
        el.getAttribute('data-test-get-started-step'),
      ),
      ['open-card', 'agent', 'publish'],
    );
    assert.strictEqual(stepDone('agent'), 'false');
  });

  test("the agent step's action shows the Agents section", async function (assert) {
    await visitAsNewUser();
    await openSteps();
    await mockMatrixUtils.setDashboardStateFromAnotherDevice({
      agent: 'codex',
    });
    await settled();

    await click('[data-test-get-started-action="agent"]');

    assert
      .dom('[data-test-section-rail-entry="agents"]')
      .hasAttribute('aria-current', 'location');
  });

  test('Dismiss saves that and leaves a note whose Undo brings the list back', async function (assert) {
    await visitAsNewUser();
    await openSteps();

    await click('[data-test-get-started-dismiss]');

    let matrixService = getService('matrix-service') as MatrixService;
    assert.dom(GET_STARTED).doesNotExist();
    assert
      .dom('[data-test-get-started-dismissed]')
      .containsText('Get started won’t show again.');
    assert.true(matrixService.dashboardState.onboardingDismissed);
    assert
      .dom('[data-test-get-started-undo-dismiss]')
      .isFocused('focus moves to Undo, since Dismiss is gone');
    assert.dom(BUTTON).doesNotExist('dismissed, the button goes too');

    await click('[data-test-get-started-undo-dismiss]');

    assert.dom('[data-test-get-started-dismissed]').doesNotExist();
    assert.dom('[data-test-get-started-step]').exists({ count: 3 });
    assert.false(matrixService.dashboardState.onboardingDismissed);
    assert.dom(BUTTON).exists('Undo brings the button back');
    assert.dom('[data-test-get-started-dismiss]').isFocused();
  });

  test('an undo from another device clears the dismissed note', async function (assert) {
    await visitAsNewUser();
    await openSteps();
    await click('[data-test-get-started-dismiss]');
    assert.dom('[data-test-get-started-dismissed]').exists();

    await mockMatrixUtils.setDashboardStateFromAnotherDevice({
      onboardingDismissed: false,
    });
    await settled();

    assert.dom('[data-test-get-started-dismissed]').doesNotExist();
    assert.dom(BUTTON).hasAttribute('aria-expanded', 'false');

    await mockMatrixUtils.setDashboardStateFromAnotherDevice({
      onboardingDismissed: true,
    });
    await settled();

    assert
      .dom('[data-test-get-started-dismissed]')
      .doesNotExist('a dismissal made elsewhere brings no note here');
  });

  test('a dismissal from another device hides the open steps and the button', async function (assert) {
    await visitAsNewUser();
    await openSteps();
    assert.dom(GET_STARTED).exists();

    await mockMatrixUtils.setDashboardStateFromAnotherDevice({
      onboardingDismissed: true,
    });
    await settled();

    assert.dom(GET_STARTED).doesNotExist();
    assert.dom(BUTTON).doesNotExist();
    assert.dom('[data-test-get-started-dismissed]').doesNotExist();

    await mockMatrixUtils.setDashboardStateFromAnotherDevice({
      onboardingDismissed: false,
    });
    await settled();

    assert.dom(BUTTON).hasAttribute('aria-expanded', 'false');
    assert
      .dom(GET_STARTED)
      .doesNotExist('an undo made elsewhere leaves the steps closed');
  });

  test('once dismissed, neither the steps nor the button show on open', async function (assert) {
    await visitAsNewUser();
    await mockMatrixUtils.setDashboardStateFromAnotherDevice({
      onboardingDismissed: true,
    });
    await settled();

    await reopenDashboard();

    assert.dom(GET_STARTED).doesNotExist();
    assert.dom(BUTTON).doesNotExist();
    assert.dom('[data-test-get-started-dismissed]').doesNotExist();
  });
});
