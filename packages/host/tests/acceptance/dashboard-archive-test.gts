import {
  click,
  find,
  findAll,
  focus,
  settled,
  triggerEvent,
  waitFor,
  waitUntil,
} from '@ember/test-helpers';

import { module, test } from 'qunit';

import { isOffScreen } from '@cardstack/host/lib/workspace-list';
import type RealmServerService from '@cardstack/host/services/realm-server';

import { visitOperatorMode } from '../helpers';
import {
  assertList,
  clickScopeOption,
  operatorModeState,
  overrideRealmInfo,
  pressKey,
  setupDashboardTest,
} from '../helpers/dashboard';

import {
  getRealmServerRoute,
  registerRealmServerRoute,
} from '../helpers/realm-server-mock/routes';

// The test user administers Workspace A and may only read Workspace C, so
// archive affordances must never appear on Workspace C.
const ownedRealmURL = 'http://test-realm/testuser/workspace-a/';
const readOnlyRealmURL = 'http://test-realm/otheruser/workspace-c/';

const ARCHIVED_TOGGLE =
  '[data-test-archived-section] [data-test-pretui-collapsible-trigger]';
// The fold is always rendered; closed, it is only hidden.
const ARCHIVED_FOLD =
  '[data-test-archived-section] [data-test-pretui-collapsible-content]';

const cardsGridIndex = {
  data: {
    type: 'card',
    meta: {
      adoptsFrom: {
        module: '@cardstack/base/cards-grid',
        name: 'CardsGrid',
      },
    },
  },
};

async function archiveOwnedWorkspace(realmURL = ownedRealmURL) {
  await click(`[data-test-workspace-menu-trigger="${realmURL}"]`);
  await click('[data-test-boxel-menu-item-text="Archive Workspace"]');
  await click('[data-test-confirm-archive-button]');
}

async function expandArchived() {
  await click(ARCHIVED_TOGGLE);
  await waitFor(
    '[data-test-archived-list] [data-test-archived-workspace="Workspace A"]',
  );
}

module('Acceptance | dashboard archive', function (hooks) {
  setupDashboardTest(hooks, {
    matrix: {
      loggedInAs: '@testuser:localhost',
      activeRealms: [ownedRealmURL, readOnlyRealmURL],
    },
    authEndpoints: false,
    realms: [
      {
        url: ownedRealmURL,
        name: 'Workspace A',
        contents: { 'index.json': cardsGridIndex },
      },
      {
        url: readOnlyRealmURL,
        name: 'Workspace C',
        permissions: { '@testuser:localhost': ['read'] },
        contents: { 'index.json': cardsGridIndex },
      },
    ],
  });

  test('the Archived section loads its list only once expanded, and says when it is empty', async function (assert) {
    let archivedRoute = getRealmServerRoute(
      new URL('http://test-realm/_archived-realms'),
    );
    if (!archivedRoute) {
      throw new Error('no default archived-realms route');
    }
    let archivedListRequests = 0;
    registerRealmServerRoute({
      path: '/_archived-realms',
      handler: async (req, url, state) => {
        archivedListRequests++;
        return archivedRoute.handler(req, url, state);
      },
    });
    try {
      await visitOperatorMode({ workspaceChooserOpened: true });

      assert.dom('[data-test-dashboard]').exists();
      assert.dom(ARCHIVED_TOGGLE).hasAttribute('aria-expanded', 'false');
      assert.dom(ARCHIVED_FOLD).hasAttribute('data-state', 'closed');
      assert.strictEqual(
        archivedListRequests,
        0,
        'archived realms are not requested until the section is expanded',
      );

      await click(ARCHIVED_TOGGLE);

      assert.dom(ARCHIVED_TOGGLE).hasAttribute('aria-expanded', 'true');
      assert.dom(ARCHIVED_FOLD).hasAttribute('data-state', 'open');
      assert.strictEqual(
        archivedListRequests,
        1,
        'expanding requests the archived realms once',
      );
    } finally {
      registerRealmServerRoute(archivedRoute);
    }

    await waitFor('[data-test-archived-empty]');
    assert
      .dom('[data-test-archived-empty]')
      .exists('expanding with nothing archived shows the empty state');
  });

  test('archiving opens a confirmation, and the Archived section stays collapsed after it', async function (assert) {
    await visitOperatorMode({ workspaceChooserOpened: true });

    await click(`[data-test-workspace-menu-trigger="${ownedRealmURL}"]`);
    await click('[data-test-boxel-menu-item-text="Archive Workspace"]');

    assert
      .dom(`[data-test-archive-modal="${ownedRealmURL}"]`)
      .exists('the archive confirmation modal opens');

    await click('[data-test-confirm-archive-button]');

    assert
      .dom('[data-test-workspace-list] [data-test-workspace="Workspace A"]')
      .doesNotExist('the workspace leaves Your Workspaces once archived');
    assert
      .dom(ARCHIVED_TOGGLE)
      .hasAttribute(
        'aria-expanded',
        'false',
        'the Archived section stays collapsed after archiving',
      );
    assert.dom(ARCHIVED_FOLD).hasAttribute('data-state', 'closed');
  });

  test('the archived workspaces are a list, with an item for each', async function (assert) {
    await visitOperatorMode({ workspaceChooserOpened: true });

    await archiveOwnedWorkspace();
    await expandArchived();

    let [item] = assertList(assert, '[data-test-archived-list]', 1);
    assert
      .dom('[data-test-archived-workspace="Workspace A"]', item)
      .exists('the archived workspace is the item');
  });

  test('hovering an archived workspace icon shows its realm URL', async function (assert) {
    await visitOperatorMode({ workspaceChooserOpened: true });

    await archiveOwnedWorkspace();
    await expandArchived();

    await triggerEvent(
      `[data-test-archived-list] [data-test-realm-url-tooltip-trigger="${ownedRealmURL}"]`,
      'mouseenter',
    );
    assert
      .dom('[data-test-realm-url-tooltip]')
      .hasText('test-realm/testuser/workspace-a');
  });

  test('a failed restore surfaces an error and keeps the workspace archived', async function (assert) {
    await visitOperatorMode({ workspaceChooserOpened: true });

    await archiveOwnedWorkspace();
    await expandArchived();

    let realmServer = this.owner.lookup(
      'service:realm-server',
    ) as RealmServerService;
    realmServer.unarchiveRealm = () =>
      Promise.reject(new Error("Could not restore realm 'Workspace A': 403"));

    await click(`[data-test-restore-workspace-btn="${ownedRealmURL}"]`);

    await waitFor('[data-test-restore-workspace-error]');
    assert
      .dom('[data-test-restore-workspace-error]')
      .hasText(
        "Could not restore realm 'Workspace A': 403",
        'the restore failure is shown on the archived workspace',
      );
    assert
      .dom(
        '[data-test-archived-list] [data-test-archived-workspace="Workspace A"]',
      )
      .exists('the workspace stays in the Archived section');
    assert
      .dom('[data-test-workspace-list] [data-test-workspace="Workspace A"]')
      .doesNotExist('the failed restore does not return it to Your Workspaces');
  });

  test('canceling the archive confirmation archives nothing', async function (assert) {
    await visitOperatorMode({ workspaceChooserOpened: true });

    await click(`[data-test-workspace-menu-trigger="${ownedRealmURL}"]`);
    await click('[data-test-boxel-menu-item-text="Archive Workspace"]');
    await click('[data-test-cancel-archive-button]');

    assert
      .dom(`[data-test-archive-modal="${ownedRealmURL}"]`)
      .doesNotExist('canceling closes the modal');
    assert
      .dom('[data-test-workspace-list] [data-test-workspace="Workspace A"]')
      .exists('the workspace stays in Your Workspaces');

    await click(ARCHIVED_TOGGLE);
    await waitFor('[data-test-archived-empty]');
    assert
      .dom('[data-test-archived-list]')
      .doesNotExist('nothing was archived');
  });

  // The archived workspace is gone by the time its modal returns focus, so
  // focus goes to the workspace that took its place. The focus trap returns
  // focus after a timeout that settled() doesn't track, so this waits for it.
  test('archiving a workspace moves focus to the workspace left in the list', async function (assert) {
    await visitOperatorMode({ workspaceChooserOpened: true });
    assert.dom('[data-test-dashboard]').exists();

    await archiveOwnedWorkspace();

    await waitUntil(
      () => document.activeElement?.closest('[data-test-workspace-list]'),
      { timeoutMessage: 'focus never returned to a workspace' },
    );
    assert
      .dom('[data-test-workspace-list] [data-test-workspace="Workspace A"]')
      .doesNotExist('the archived workspace has left the list');
    assert
      .dom('[data-test-workspace-button="Workspace C"]')
      .isFocused('focus moves to the workspace left in the list');
  });

  test('a workspace the user may only read has no Archive action', async function (assert) {
    await visitOperatorMode({ workspaceChooserOpened: true });

    await click(`[data-test-workspace-menu-trigger="${readOnlyRealmURL}"]`);

    assert
      .dom('[data-test-boxel-menu-item-text="Archive Workspace"]')
      .doesNotExist('Archive is absent on a workspace the user may only read');
    assert
      .dom('[data-test-boxel-menu-item-text="Realm Settings"]')
      .exists('the rest of the menu still renders for readers');
  });
});

// Two owned workspaces, so the Archived section can hold two.
module('Acceptance | dashboard archive | restore focus', function (hooks) {
  const secondOwnedRealmURL = 'http://test-realm/testuser/workspace-b/';

  setupDashboardTest(hooks, {
    matrix: {
      loggedInAs: '@testuser:localhost',
      activeRealms: [ownedRealmURL, secondOwnedRealmURL, readOnlyRealmURL],
    },
    authEndpoints: false,
    realms: [
      {
        url: ownedRealmURL,
        name: 'Workspace A',
        contents: { 'index.json': cardsGridIndex },
      },
      {
        url: secondOwnedRealmURL,
        name: 'Workspace B',
        contents: { 'index.json': cardsGridIndex },
      },
      {
        url: readOnlyRealmURL,
        name: 'Workspace C',
        permissions: { '@testuser:localhost': ['read'] },
        contents: { 'index.json': cardsGridIndex },
      },
    ],
  });

  const RESTORE = '[data-test-archived-list] [data-test-restore-workspace-btn]';

  // Archives both owned workspaces, then reopens the dashboard, so its
  // keyboard cursor starts where it rests before the user moves it.
  async function archiveBothAndExpand() {
    await archiveOwnedWorkspace(ownedRealmURL);
    await archiveOwnedWorkspace(secondOwnedRealmURL);
    operatorModeState().workspaceChooserOpened = false;
    await settled();
    operatorModeState().workspaceChooserOpened = true;
    await waitFor('[data-test-dashboard]');
    await click(ARCHIVED_TOGGLE);
    await waitUntil(() => findAll(RESTORE).length === 2);
  }

  function restoreURLs() {
    return findAll(RESTORE).map((button) =>
      button.getAttribute('data-test-restore-workspace-btn'),
    );
  }

  const NAMES: Record<string, string> = {
    [ownedRealmURL]: 'Workspace A',
    [secondOwnedRealmURL]: 'Workspace B',
  };

  // The name of the workspace whose tile or row holds focus.
  function focusedWorkspace() {
    return document.activeElement
      ?.closest('[data-test-workspace]')
      ?.getAttribute('data-test-workspace');
  }

  // Restores each archived workspace in turn, checking that focus moves to it
  // among the workspaces.
  async function restoreBoth(assert: Assert) {
    for (let url of restoreURLs()) {
      let name = NAMES[url!];
      await click(`[data-test-restore-workspace-btn="${url}"]`);
      await waitUntil(() => focusedWorkspace() === name, {
        timeoutMessage: `focus never reached ${name}`,
      });
      await settled();
      assert.strictEqual(
        focusedWorkspace(),
        name,
        `focus moves to ${name} once it is restored`,
      );
    }
  }

  test('with the keyboard cursor never moved, restoring moves focus to the restored workspace', async function (assert) {
    await visitOperatorMode({ workspaceChooserOpened: true });
    await archiveBothAndExpand();

    await restoreBoth(assert);
  });

  test('with the keyboard cursor never moved, restoring a workspace scrolled out of view moves focus to it', async function (assert) {
    await visitOperatorMode({ workspaceChooserOpened: true });
    await archiveBothAndExpand();
    let scroller = find('[data-test-dashboard-scroller]') as HTMLElement;
    scroller.scrollTop = scroller.scrollHeight;
    await settled();
    assert.true(
      isOffScreen(find('[data-test-workspace="Workspace C"]') as HTMLElement),
      'the workspaces are scrolled out of view',
    );
    let [first] = restoreURLs();
    let name = NAMES[first!];

    await click(`[data-test-restore-workspace-btn="${first}"]`);
    await waitUntil(() => focusedWorkspace() === name, {
      timeoutMessage: `focus never reached ${name}`,
    });
    await settled();

    assert.strictEqual(
      focusedWorkspace(),
      name,
      'focus moves to the workspace',
    );
    assert.false(
      isOffScreen(document.activeElement as HTMLElement),
      'the workspace is scrolled into view',
    );
  });

  test('with the keyboard cursor moved, restoring moves focus to the restored workspace', async function (assert) {
    await visitOperatorMode({ workspaceChooserOpened: true });
    await archiveBothAndExpand();
    let start = find('[data-test-workspace-button="Workspace C"]')!;
    await focus(start);
    // The first arrow key only shows the cursor's ring; the second moves it.
    await pressKey('ArrowLeft');
    await pressKey('ArrowLeft');
    assert.notStrictEqual(
      document.activeElement,
      start,
      'the keyboard cursor has moved off its starting item',
    );

    await restoreBoth(assert);
  });

  test('focus the user moves during a restore stays where they put it', async function (assert) {
    await visitOperatorMode({ workspaceChooserOpened: true });
    await archiveBothAndExpand();
    let [first] = restoreURLs();

    // Holds the restore back until the user has moved on.
    let realmServer = this.owner.lookup(
      'service:realm-server',
    ) as RealmServerService;
    let unarchive = realmServer.unarchiveRealm.bind(realmServer);
    let release!: () => void;
    let held = new Promise<void>((resolve) => (release = resolve));
    realmServer.unarchiveRealm = async (url: string) => {
      await held;
      return unarchive(url);
    };

    await click(`[data-test-restore-workspace-btn="${first}"]`);
    await focus(ARCHIVED_TOGGLE);
    release();
    await waitUntil(() => !restoreURLs().includes(first!));
    await settled();

    assert
      .dom(`[data-test-workspace-menu-trigger="${first}"]`)
      .exists('the workspace is restored');
    assert.dom(ARCHIVED_TOGGLE).isFocused('focus stays on Archived');
  });

  const SCOPE_ALL =
    '[data-test-dashboard-filter] [data-test-pretui-segmented-option="all"]';
  const SCOPE_HOSTED =
    '[data-test-dashboard-filter] [data-test-pretui-segmented-option="hosted"]';

  // Set on the realm, since archiving drops the info the host loaded and
  // restoring loads it again.
  function markPublished(realmURL: string) {
    overrideRealmInfo(realmURL, {
      lastPublishedAt: { 'https://published.example.com/': String(Date.now()) },
    });
  }

  // Moves the keyboard cursor from Workspace C to New Workspace. Left on its
  // default, the cursor would focus the restored workspace's tile itself.
  async function parkCursorOnNewWorkspace(assert: Assert) {
    let start = find('[data-test-workspace-button="Workspace C"]')!;
    await focus(start);
    // The first arrow key only shows the cursor's ring; the second moves it.
    await pressKey('ArrowLeft');
    await pressKey('ArrowLeft');
    assert.notStrictEqual(
      document.activeElement,
      start,
      'the keyboard cursor has moved off its starting item',
    );
  }

  test('restoring a workspace the Hosted scope hides switches to All and moves focus to the workspace', async function (assert) {
    await visitOperatorMode({ workspaceChooserOpened: true });
    // So Hosted still lists Workspace C and New Workspace for the cursor.
    markPublished(readOnlyRealmURL);
    await archiveBothAndExpand();
    await clickScopeOption('hosted');
    await parkCursorOnNewWorkspace(assert);
    let [first] = restoreURLs();
    let name = NAMES[first!];

    await click(`[data-test-restore-workspace-btn="${first}"]`);
    await waitUntil(() => focusedWorkspace() === name, {
      timeoutMessage: `focus never reached ${name}`,
    });
    await settled();

    assert
      .dom(SCOPE_ALL)
      .isChecked('the scope widens to All, which shows the workspace');
    assert.strictEqual(
      focusedWorkspace(),
      name,
      'focus moves to the workspace',
    );
  });

  test('restoring a hosted workspace keeps the Hosted scope', async function (assert) {
    await visitOperatorMode({ workspaceChooserOpened: true });
    markPublished(ownedRealmURL);
    // So Hosted still lists Workspace C and New Workspace for the cursor.
    markPublished(readOnlyRealmURL);
    await archiveBothAndExpand();
    let name = NAMES[ownedRealmURL];
    await clickScopeOption('hosted');
    await parkCursorOnNewWorkspace(assert);

    await click(`[data-test-restore-workspace-btn="${ownedRealmURL}"]`);
    await waitUntil(() => focusedWorkspace() === name, {
      timeoutMessage: `focus never reached ${name}`,
    });
    await settled();

    assert.dom(SCOPE_HOSTED).isChecked('the scope stays Hosted');
    assert.strictEqual(
      focusedWorkspace(),
      name,
      'focus moves to the workspace',
    );
  });
});
