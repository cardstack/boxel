import { click, triggerEvent, waitFor, waitUntil } from '@ember/test-helpers';

import { module, test } from 'qunit';

import type RealmServerService from '@cardstack/host/services/realm-server';

import {
  setupAcceptanceTestRealm,
  setupLocalIndexing,
  setupRealmCacheTeardown,
  setupUserSubscription,
  visitOperatorMode,
  realmConfigCardJSON,
} from '../helpers';
import { setupMockMatrix } from '../helpers/mock-matrix';
import {
  getRealmServerRoute,
  registerRealmServerRoute,
} from '../helpers/realm-server-mock/routes';
import { setupApplicationTest } from '../helpers/setup';

// Workspace A is owned by the test user; Workspace C is read/write only (the
// test user is not its owner), so archive affordances must never appear on it.
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

async function archiveOwnedWorkspace() {
  await click(`[data-test-workspace-menu-trigger="${ownedRealmURL}"]`);
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
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupRealmCacheTeardown(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [ownedRealmURL, readOnlyRealmURL],
  });

  hooks.beforeEach(async function () {
    setupUserSubscription();

    await setupAcceptanceTestRealm({
      realmURL: ownedRealmURL,
      mockMatrixUtils,
      permissions: {
        '@testuser:localhost': ['read', 'write', 'realm-owner'],
      },
      contents: {
        'realm.json': realmConfigCardJSON({ name: 'Workspace A' }),
        'index.json': cardsGridIndex,
      },
    });

    await setupAcceptanceTestRealm({
      realmURL: readOnlyRealmURL,
      mockMatrixUtils,
      permissions: {
        '@testuser:localhost': ['read', 'write'],
      },
      contents: {
        'realm.json': realmConfigCardJSON({ name: 'Workspace C' }),
        'index.json': cardsGridIndex,
      },
    });
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

  test('a workspace the user does not own has no Archive action', async function (assert) {
    await visitOperatorMode({ workspaceChooserOpened: true });

    await click(`[data-test-workspace-menu-trigger="${readOnlyRealmURL}"]`);

    assert
      .dom('[data-test-boxel-menu-item-text="Archive Workspace"]')
      .doesNotExist('Archive is absent on a workspace the user does not own');
    assert
      .dom('[data-test-boxel-menu-item-text="Realm Settings"]')
      .exists('the rest of the menu still renders for non-owners');
  });
});
