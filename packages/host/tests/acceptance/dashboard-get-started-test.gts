import {
  click,
  fillIn,
  find,
  findAll,
  settled,
  waitFor,
  waitUntil,
} from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import { APP_BOXEL_MESSAGE_MSGTYPE } from '@cardstack/runtime-common/matrix-constants';

import type LocalPersistenceService from '@cardstack/host/services/local-persistence-service';
import type MatrixService from '@cardstack/host/services/matrix-service';

import {
  percySnapshot,
  realmConfigCardJSON,
  setupAcceptanceTestRealm,
  visitOperatorMode,
} from '../helpers';
import {
  realmURL,
  markHosted,
  markPublishable,
  markUpdated,
  nameFromTip,
  operatorModeState,
  overrideRealmInfo,
  ownedRealmURL,
  setupDashboardTest,
  setupMoreWorkspaces,
  sharedRealmURL,
} from '../helpers/dashboard';
import { setRecentCards } from '../helpers/recent-files-cards';

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
    // The snapshots are of the whole dashboard, so its workspaces and the
    // publish step's note must have loaded too.
    await waitFor('[data-test-workspace="Workspace A"]');
    assert.dom('[data-test-workspace-loading-indicator]').doesNotExist();
    await waitFor('[data-test-get-started-publish-unavailable]');
    await percySnapshot('Acceptance | dashboard get started | open steps');
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
    // At 800px the card is narrower than 48rem, so the folded row stacks.
    await percySnapshot('Acceptance | dashboard get started | folded steps', {
      widths: [1280, 800],
    });

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
    assert
      .dom('[data-test-get-started-publish-unavailable]')
      .doesNotExist('a done step does not say what publishing needs');
  });

  test('administering only workspaces that cannot be published, the publish step says so instead of offering a button', async function (assert) {
    await visitAsNewUser();
    await openSteps();

    assert.dom('[data-test-get-started-action="publish"]').doesNotExist();
    assert
      .dom('[data-test-get-started-publish-unavailable]')
      .hasText(
        'None of your workspaces can be published. Create a new one to publish it.',
      );
  });

  test('able to edit no workspace, the publish step says publishing needs one', async function (assert) {
    mockMatrixUtils.setRealmPermissions({
      [realmURL]: ['read'],
    });
    await visitAsNewUser();
    await openSteps();

    assert.dom('[data-test-get-started-action="publish"]').doesNotExist();
    assert
      .dom('[data-test-get-started-publish-unavailable]')
      .hasText(
        'Publishing needs a workspace you can edit. Create one to publish it.',
      );
  });

  test("the publish step's note waits for the info of the workspaces the user administers", async function (assert) {
    await visitAsNewUser();
    // Holds Workspace A's info back, as a slow load does.
    let resource = (getService('realm') as any).realms.get(realmURL);
    let info = resource.info;
    resource.fetchInfo = () => new Promise(() => {});
    resource.info = undefined;
    await openSteps();

    assert.dom('[data-test-get-started-step="publish"]').exists();
    assert
      .dom('[data-test-get-started-publish-unavailable]')
      .doesNotExist('no note while the info loads');

    delete resource.fetchInfo;
    resource.info = info;
    await settled();

    assert
      .dom('[data-test-get-started-publish-unavailable]')
      .exists('the note shows once the info has loaded');
  });

  module('with workspaces to publish', function (hooks) {
    setupMoreWorkspaces(hooks, mockMatrixUtils);

    const PUBLISH_ACTION = '[data-test-get-started-action="publish"]';
    const PUBLISH_MODAL = '[data-test-publish-realm-modal]';
    const MENU_ITEMS = '[data-test-pretui-menu-panel] [role="menuitem"]';

    test('with one workspace to publish, the publish step opens it in host mode with the publish dialog', async function (assert) {
      await visitAsNewUser();
      markPublishable(ownedRealmURL);
      // Publishable, but shared with the user to read only.
      markPublishable(sharedRealmURL);
      await settled();
      await openSteps();
      await waitFor(PUBLISH_ACTION);

      await click(PUBLISH_ACTION);
      await waitFor(PUBLISH_MODAL);

      assert.dom('[data-test-host-submode]').exists();
      assert.dom(PUBLISH_MODAL).containsText('workspace-b/');
    });

    test('the publish step keeps its button once a workspace is published', async function (assert) {
      await visitAsNewUser();
      markPublishable(ownedRealmURL);
      markHosted(ownedRealmURL);
      await settled();
      await openSteps();
      await waitFor(PUBLISH_ACTION);

      assert.strictEqual(stepDone('publish'), 'true');

      await click(PUBLISH_ACTION);
      await waitFor(PUBLISH_MODAL);

      assert.dom('[data-test-host-submode]').exists();
      assert.dom(PUBLISH_MODAL).containsText('workspace-b/');
    });

    test('workspaces that share a name are told apart by their address in the menu', async function (assert) {
      await visitAsNewUser();
      markPublishable(realmURL);
      markPublishable(ownedRealmURL);
      overrideRealmInfo(realmURL, { name: 'Workspace B' });
      let now = Date.now();
      markUpdated(realmURL, new Date(now - 60_000));
      markUpdated(ownedRealmURL, new Date(now));
      await settled();
      await openSteps();
      await waitFor(PUBLISH_ACTION);

      await click(PUBLISH_ACTION);

      assert.deepEqual(
        findAll(MENU_ITEMS).map((item) => item.textContent?.trim()),
        ['Workspace B (workspace-b)', 'Workspace B (workspace-a)'],
      );
    });

    test('workspaces that share a name and the last part of their address are told apart by the whole address', async function (assert) {
      const otherRealmURL = 'http://test-realm/otheruser/workspace-b/';
      const permissions = ['read', 'write', 'realm-owner'] as const;
      await setupAcceptanceTestRealm({
        realmURL: otherRealmURL,
        mockMatrixUtils,
        permissions: { '@testuser:localhost': [...permissions] },
        contents: {
          'realm.json': realmConfigCardJSON({ name: 'Workspace B' }),
        },
      });
      mockMatrixUtils.setRealmSessionPermissions(otherRealmURL, [
        ...permissions,
      ]);
      mockMatrixUtils.setActiveRealms([
        realmURL,
        ownedRealmURL,
        sharedRealmURL,
        otherRealmURL,
      ]);
      await visitAsNewUser();
      markPublishable(ownedRealmURL);
      markPublishable(otherRealmURL);
      let now = Date.now();
      markUpdated(otherRealmURL, new Date(now - 60_000));
      markUpdated(ownedRealmURL, new Date(now));
      await settled();
      await openSteps();
      await waitFor(PUBLISH_ACTION);

      await click(PUBLISH_ACTION);

      assert.deepEqual(
        findAll(MENU_ITEMS).map((item) => item.textContent?.trim()),
        [
          'Workspace B (test-realm/testuser/workspace-b)',
          'Workspace B (test-realm/otheruser/workspace-b)',
        ],
      );
    });

    test('with several workspaces to publish, the publish step asks which, most recently updated first', async function (assert) {
      await visitAsNewUser();
      let now = Date.now();
      for (let url of [realmURL, ownedRealmURL, sharedRealmURL]) {
        markPublishable(url);
      }
      markUpdated(realmURL, new Date(now - 60_000));
      markUpdated(ownedRealmURL, new Date(now - 30_000));
      // The newest, but shared with the user to read only.
      markUpdated(sharedRealmURL, new Date(now));
      await settled();
      await openSteps();
      await waitFor(PUBLISH_ACTION);

      assert
        .dom(`${PUBLISH_ACTION} [data-test-get-started-publish-chevron]`)
        .hasAttribute('data-test-get-started-publish-chevron', 'down');

      await click(PUBLISH_ACTION);

      assert
        .dom(`${PUBLISH_ACTION} [data-test-get-started-publish-chevron]`)
        .hasAttribute(
          'data-test-get-started-publish-chevron',
          'up',
          'the chevron turns up while the menu is open',
        );
      assert.deepEqual(
        findAll(MENU_ITEMS).map((item) => item.textContent?.trim()),
        ['Workspace B', 'Workspace A'],
      );

      await click(findAll(MENU_ITEMS)[1]);
      await waitFor(PUBLISH_MODAL);

      assert.dom('[data-test-host-submode]').exists();
      assert.dom(PUBLISH_MODAL).containsText('workspace-a/');
    });
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

  test('asking Boxel AI Assistant starts a session with a prompt to send', async function (assert) {
    await visitAsNewUser();
    await openSteps();

    let roomId = await openBoxelAiSession();
    let field = `[data-test-message-field="${roomId}"]`;

    assert
      .dom(field)
      .hasValue(
        'Build me a card to track my reading list, with a title, author, status and rating for each book.',
      )
      .isFocused();
    let input = find(field) as HTMLTextAreaElement;
    assert.strictEqual(
      input.selectionStart,
      input.value.length,
      'the cursor is after the prompt',
    );
    assert.dom('[data-test-message-idx]').doesNotExist('nothing is sent');
    assert.strictEqual(stepDone('ask-ai'), 'false');
  });

  test('the prompt names the workspace the user was last in', async function (assert) {
    await visitOperatorMode({
      stacks: [[{ id: `${realmURL}index`, format: 'isolated' }]],
      workspaceChooserOpened: true,
    });
    await mockMatrixUtils.setDashboardStateFromAnotherDevice({});
    await settled();
    await reopenDashboard();
    await openSteps();

    let roomId = await openBoxelAiSession();

    assert
      .dom(`[data-test-message-field="${roomId}"]`)
      .hasValue(
        'In Workspace A, build me a card to track my reading list, with a title, author, status and rating for each book.',
      );
  });

  test('asking again keeps what the user typed in the empty session, and focuses it', async function (assert) {
    await visitAsNewUser();
    await openSteps();

    let roomId = await openBoxelAiSession();
    let field = `[data-test-message-field="${roomId}"]`;
    await fillIn(field, 'A card for my recipes');

    await click('[data-test-get-started-action="ask-ai"]');

    let matrixService = getService('matrix-service') as MatrixService;
    assert.strictEqual(
      matrixService.currentRoomId,
      roomId,
      'the empty session is reused',
    );
    assert.dom(field).hasValue('A card for my recipes').isFocused();
  });

  test("the prompt is saved as the draft and marked as the panel's, and an edit is saved", async function (assert) {
    await visitAsNewUser();
    await openSteps();

    let roomId = await openBoxelAiSession();
    let field = `[data-test-message-field="${roomId}"]`;
    let localPersistence = getService(
      'local-persistence-service',
    ) as LocalPersistenceService;
    let prompt = (find(field) as HTMLTextAreaElement).value;

    assert.strictEqual(
      localPersistence.getMessageDraft(roomId),
      prompt,
      'the prompt is saved',
    );
    assert.strictEqual(
      localPersistence.getFilledPrompt(roomId),
      prompt,
      "it is marked as the panel's",
    );

    await fillIn(field, 'A card for my recipes');

    assert.strictEqual(
      localPersistence.getMessageDraft(roomId),
      'A card for my recipes',
      'the edit is saved',
    );
  });

  test('asking again shows and keeps a draft another tab saved for the same session', async function (assert) {
    await visitAsNewUser();
    await openSteps();

    let roomId = await openBoxelAiSession();
    let localPersistence = getService(
      'local-persistence-service',
    ) as LocalPersistenceService;
    // Another tab reuses the same empty session and types into it.
    localPersistence.setMessageDraft(roomId, 'A card for my recipes');

    await click('[data-test-get-started-action="ask-ai"]');

    assert
      .dom(`[data-test-message-field="${roomId}"]`)
      .hasValue('A card for my recipes');
    assert.strictEqual(
      localPersistence.getMessageDraft(roomId),
      'A card for my recipes',
      "the other tab's draft is kept",
    );
  });

  test('asking again shows a draft another tab typed into a session this tab showed empty', async function (assert) {
    await visitAsNewUser();
    await openSteps();

    let roomId = await openBoxelAiSession();
    let field = `[data-test-message-field="${roomId}"]`;
    let localPersistence = getService(
      'local-persistence-service',
    ) as LocalPersistenceService;
    await fillIn(field, '');
    // Another tab types into the same empty session.
    localPersistence.setMessageDraft(roomId, 'A card for my recipes');

    await click('[data-test-get-started-action="ask-ai"]');

    assert.dom(field).hasValue('A card for my recipes');
    assert.strictEqual(
      localPersistence.getMessageDraft(roomId),
      'A card for my recipes',
      "the other tab's draft is kept",
    );
  });

  test('asking again from another workspace after another tab cleared the prompt fills it for that workspace', async function (assert) {
    await visitAsNewUser();
    await openSteps();

    let roomId = await openBoxelAiSession();
    let field = `[data-test-message-field="${roomId}"]`;
    let localPersistence = getService(
      'local-persistence-service',
    ) as LocalPersistenceService;
    // Another tab reuses the same empty session and clears the prompt.
    localPersistence.setMessageDraft(roomId, undefined);

    await operatorModeState().openWorkspace(realmURL);
    await settled();
    operatorModeState().workspaceChooserOpened = true;
    await waitFor('[data-test-dashboard-greeting]');
    await openSteps();
    await click('[data-test-get-started-action="ask-ai"]');

    assert
      .dom(field)
      .hasValue(
        'In Workspace A, build me a card to track my reading list, with a title, author, status and rating for each book.',
      );
  });

  test('asking again from another workspace renames the workspace in a prompt edited back to what the panel filled in', async function (assert) {
    await visitAsNewUser();
    await openSteps();

    let roomId = await openBoxelAiSession();
    let field = `[data-test-message-field="${roomId}"]`;
    let prompt = (find(field) as HTMLTextAreaElement).value;
    await fillIn(field, `${prompt} More`);
    await fillIn(field, prompt);

    await operatorModeState().openWorkspace(realmURL);
    await settled();
    operatorModeState().workspaceChooserOpened = true;
    await waitFor('[data-test-dashboard-greeting]');
    await openSteps();
    await click('[data-test-get-started-action="ask-ai"]');

    assert
      .dom(field)
      .hasValue(
        'In Workspace A, build me a card to track my reading list, with a title, author, status and rating for each book.',
      );
  });

  test('asking again from another workspace renames the workspace in a prompt left unchanged', async function (assert) {
    await visitAsNewUser();
    await openSteps();

    let roomId = await openBoxelAiSession();
    let field = `[data-test-message-field="${roomId}"]`;

    await operatorModeState().openWorkspace(realmURL);
    await settled();
    operatorModeState().workspaceChooserOpened = true;
    await waitFor('[data-test-dashboard-greeting]');
    await openSteps();
    await click('[data-test-get-started-action="ask-ai"]');

    let matrixService = getService('matrix-service') as MatrixService;
    assert.strictEqual(
      matrixService.currentRoomId,
      roomId,
      'the empty session is reused',
    );
    assert
      .dom(field)
      .hasValue(
        'In Workspace A, build me a card to track my reading list, with a title, author, status and rating for each book.',
      );
  });

  test('a session that fails to open leaves the prompt out of the older session', async function (assert) {
    await visitAsNewUser();
    await openSteps();

    let roomId = await openBoxelAiSession();
    await fillIn(`[data-test-message-field="${roomId}"]`, '');
    sendMessage(roomId);
    await waitUntil(() => countText() === '1 of 3 done');

    // The mock server fails room creation while this element is on the page.
    let failRoomCreation = document.createElement('div');
    failRoomCreation.setAttribute('data-test-throw-room-error', '');
    document.body.append(failRoomCreation);
    try {
      await click('[data-test-get-started-action="ask-ai"]');
      await waitFor('[data-test-room-error]');
    } finally {
      failRoomCreation.remove();
    }

    let matrixService = getService('matrix-service') as MatrixService;
    assert.notOk(
      matrixService.getMessageToSend(roomId),
      'the older session gets no prompt',
    );
  });

  test('with every step done, the steps stay, each with its action, until dismissed', async function (assert) {
    await visitAsNewUser();
    assert.dom(BUTTON).hasAttribute('data-tone', 'primary');
    await openSteps();
    assert
      .dom('[data-test-get-started-action="ask-ai"]')
      .hasAttribute('data-appearance', 'outlined', 'an undone step stands out');

    await mockMatrixUtils.setDashboardStateFromAnotherDevice({
      agent: 'claude',
      agentSetup: { claude: 1 },
    });
    (getService('recent-cards-service') as any).add(`${realmURL}index`);
    markPublishable(realmURL);
    markHosted(realmURL);
    await settled();

    assert.dom('[data-test-get-started-count]').hasText('3 of 3 done');
    for (let id of ['open-card', 'agent', 'publish']) {
      assert.strictEqual(stepDone(id), 'true', `${id} is done`);
      assert
        .dom(`[data-test-get-started-action="${id}"]`)
        .hasAttribute(
          'data-appearance',
          'plain',
          `${id} keeps a quieter action`,
        );
    }

    assert.notOk(
      (mockMatrixUtils.getDashboardState() as any).onboardingDismissed,
      'finishing does not dismiss it',
    );

    await click(BUTTON);
    assert.dom(BUTTON).hasAttribute('aria-expanded', 'false');
    assert
      .dom(BUTTON)
      .hasAttribute('data-appearance', 'outlined', 'closed, it steps back');
    assert.dom(BUTTON).doesNotHaveAttribute('data-theme');

    await click(BUTTON);
    assert.dom(BUTTON).hasAttribute('data-appearance', 'accent');
    assert.dom(BUTTON).hasAttribute('data-theme', 'light');
    await click(BUTTON);

    // Replacing the stored state also clears the openedCard the card
    // opened above recorded.
    (getService('recent-cards-service') as any).resetState();
    await mockMatrixUtils.setDashboardStateFromAnotherDevice({
      agent: 'claude',
      agentSetup: {},
    });
    await settled();
    assert
      .dom(BUTTON)
      .hasAttribute(
        'data-appearance',
        'accent',
        'a step that reads as undone again calls for attention',
      );
    assert.dom(BUTTON).hasAttribute('data-tone', 'primary');
    assert.dom(BUTTON).hasAttribute('data-theme', 'light');
    await openSteps();
    assert.strictEqual(stepDone('open-card'), 'false');
    assert.strictEqual(stepDone('agent'), 'false');
    await click(BUTTON);

    await reopenDashboard();
    assert.dom(BUTTON).exists('still there after reopening');

    await openSteps();
    await click('[data-test-get-started-dismiss]');
    assert.dom(GET_STARTED).doesNotExist('only Dismiss hides it');
    assert.dom(BUTTON).doesNotExist();
    assert.dom('[data-test-get-started-undo-dismiss]').exists();
  });

  test('a Dismiss that fails to save keeps the list and says so', async function (assert) {
    await visitAsNewUser();
    await openSteps();

    mockMatrixUtils.setDashboardStateWriteError(new Error('offline'));
    await click('[data-test-get-started-dismiss]');
    await waitFor('[data-test-get-started-dismiss-error]');
    mockMatrixUtils.setDashboardStateWriteError();

    assert.dom(GET_STARTED).exists('the list stays');
    assert
      .dom('[data-test-get-started-dismiss-error]')
      .hasText('Couldn’t dismiss. Try again.');
    assert
      .dom('[data-test-get-started-error-announcement]')
      .hasText('Couldn’t dismiss. Try again.', 'screen readers hear it');
    assert.dom('[data-test-get-started-dismissed]').doesNotExist();

    await click(BUTTON);
    await openSteps();
    assert
      .dom('[data-test-get-started-dismiss-error]')
      .doesNotExist('the error clears once the list closes');

    await click('[data-test-get-started-dismiss]');
    assert.dom('[data-test-get-started-dismiss-error]').doesNotExist();
    assert.dom('[data-test-get-started-dismissed]').exists('the retry saves');
    assert.dom('[data-test-get-started-error-announcement]').hasNoText();
  });

  test('a card opened in another browser ticks the open-card step', async function (assert) {
    await visitAsNewUser();
    await openSteps();
    assert.strictEqual(stepDone('open-card'), 'false');

    await mockMatrixUtils.setDashboardStateFromAnotherDevice({
      openedCard: true,
    });
    await settled();

    assert.strictEqual(stepDone('open-card'), 'true');
  });

  test('opening a card records it on the account', async function (assert) {
    await visitAsNewUser();

    (getService('recent-cards-service') as any).add(`${realmURL}index`);
    await settled();

    assert.true(
      (mockMatrixUtils.getDashboardState() as any).openedCard,
      'other browsers read it from there',
    );
  });

  test('a card opened after a failed recording records it', async function (assert) {
    await visitAsNewUser();
    let recentCards = getService('recent-cards-service') as any;

    mockMatrixUtils.setDashboardStateWriteError(new Error('offline'));
    recentCards.add(`${realmURL}index`);
    await settled();
    mockMatrixUtils.setDashboardStateWriteError();
    recentCards.add(`${realmURL}index`);
    await settled();

    assert.true((mockMatrixUtils.getDashboardState() as any).openedCard);
  });

  test('recording an opened card stops after two failed writes in a session', async function (assert) {
    await visitAsNewUser();
    let recentCards = getService('recent-cards-service') as any;

    mockMatrixUtils.setDashboardStateWriteError(new Error('offline'));
    recentCards.add(`${realmURL}index`);
    await settled();
    recentCards.add(`${realmURL}index`);
    await settled();
    mockMatrixUtils.setDashboardStateWriteError();
    recentCards.add(`${realmURL}index`);
    await settled();

    assert.notOk(
      (mockMatrixUtils.getDashboardState() as any)?.openedCard,
      'a homeserver rejecting writes is not asked again on every card opened',
    );
  });

  test('cards this browser opened before login tick the step here but are not recorded on the account', async function (assert) {
    setRecentCards([[`${realmURL}index`, Date.now()]]);
    await visitOperatorMode({ workspaceChooserOpened: true });
    await click(BUTTON);

    assert.strictEqual(stepDone('open-card'), 'true');
    assert.notOk(
      (mockMatrixUtils.getDashboardState() as any)?.openedCard,
      'the list may be another account’s',
    );
  });

  test('connecting an agent and publishing do not tick the open-card step', async function (assert) {
    await visitAsNewUser();
    await openSteps();

    await mockMatrixUtils.setDashboardStateFromAnotherDevice({
      agent: 'claude',
      agentSetup: { claude: 1 },
    });
    markHosted(realmURL);
    await settled();

    assert.dom('[data-test-get-started-count]').hasText('2 of 3 done');
    assert.strictEqual(stepDone('open-card'), 'false');
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

  test('an Undo that fails to save keeps the note and says so', async function (assert) {
    await visitAsNewUser();
    await openSteps();
    await click('[data-test-get-started-dismiss]');

    mockMatrixUtils.setDashboardStateWriteError(new Error('offline'));
    await click('[data-test-get-started-undo-dismiss]');
    await waitFor('[data-test-get-started-undo-error]');
    mockMatrixUtils.setDashboardStateWriteError();

    assert.dom('[data-test-get-started-dismissed]').exists('the note stays');
    assert
      .dom('[data-test-get-started-undo-error]')
      .hasText('Couldn’t undo. Try again.');
    assert
      .dom('[data-test-get-started-error-announcement]')
      .hasText('Couldn’t undo. Try again.', 'screen readers hear it');
    assert.dom(GET_STARTED).doesNotExist();

    await click('[data-test-get-started-undo-dismiss]');
    assert.dom('[data-test-get-started-undo-error]').doesNotExist();
    assert.dom(GET_STARTED).exists('the retry brings the list back');
    assert.dom('[data-test-get-started-error-announcement]').hasNoText();
  });

  test('a failed Dismiss leaves no error behind once another device dismisses and undoes', async function (assert) {
    await visitAsNewUser();
    await openSteps();

    mockMatrixUtils.setDashboardStateWriteError(new Error('offline'));
    await click('[data-test-get-started-dismiss]');
    await waitFor('[data-test-get-started-dismiss-error]');
    mockMatrixUtils.setDashboardStateWriteError();
    assert.dom('[data-test-get-started-dismiss-error]').exists();

    await mockMatrixUtils.setDashboardStateFromAnotherDevice({
      onboardingDismissed: true,
    });
    await settled();
    await mockMatrixUtils.setDashboardStateFromAnotherDevice({
      onboardingDismissed: false,
    });
    await settled();
    await openSteps();

    assert.dom(GET_STARTED).exists();
    assert.dom('[data-test-get-started-dismiss-error]').doesNotExist();
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
