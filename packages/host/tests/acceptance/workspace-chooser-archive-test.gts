import { click, waitFor } from '@ember/test-helpers';

import { module, test } from 'qunit';

import {
  setupAcceptanceTestRealm,
  setupLocalIndexing,
  setupRealmCacheTeardown,
  setupUserSubscription,
  visitOperatorMode,
  realmConfigCardJSON,
} from '../helpers';
import { setupBaseRealm } from '../helpers/base-realm';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';

// Workspace A is owned by the test user; Workspace C is read/write only (the
// test user is not its owner), so archive affordances must never appear on it.
const ownedRealmURL = 'http://test-realm/testuser/workspace-a/';
const readOnlyRealmURL = 'http://test-realm/otheruser/workspace-c/';

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

module('Acceptance | workspace-chooser archive', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupRealmCacheTeardown(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [ownedRealmURL, readOnlyRealmURL],
  });

  setupBaseRealm(hooks);

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

  test('owner can archive a workspace, moving it to the Archived section', async function (assert) {
    await visitOperatorMode({ workspaceChooserOpened: true });

    assert
      .dom('[data-test-workspace-list] [data-test-workspace="Workspace A"]')
      .exists('the owned workspace starts in the active list');
    assert
      .dom('[data-test-archived-section]')
      .exists('the Archived disclosure is always present');
    assert
      .dom('[data-test-archived-list]')
      .doesNotExist('archived realms are not loaded until the row is expanded');

    await click(`[data-test-workspace-menu-trigger="${ownedRealmURL}"]`);
    await click('[data-test-boxel-menu-item-text="Archive Workspace"]');

    assert
      .dom(`[data-test-archive-modal="${ownedRealmURL}"]`)
      .exists('the archive confirmation modal opens');

    await click('[data-test-confirm-archive-button]');

    assert
      .dom('[data-test-workspace-list] [data-test-workspace="Workspace A"]')
      .doesNotExist('the workspace leaves the active list once archived');
    assert
      .dom('[data-test-archived-list]')
      .doesNotExist('the Archived section stays collapsed after archiving');

    await click('[data-test-archived-toggle]');

    await waitFor(
      '[data-test-archived-list] [data-test-archived-workspace="Workspace A"]',
    );
    assert
      .dom(
        '[data-test-archived-list] [data-test-archived-workspace="Workspace A"]',
      )
      .exists('expanding the disclosure reveals the archived workspace');
  });

  test('owner can restore an archived workspace back to active', async function (assert) {
    await visitOperatorMode({ workspaceChooserOpened: true });

    await click(`[data-test-workspace-menu-trigger="${ownedRealmURL}"]`);
    await click('[data-test-boxel-menu-item-text="Archive Workspace"]');
    await click('[data-test-confirm-archive-button]');
    await click('[data-test-archived-toggle]');
    await waitFor(
      '[data-test-archived-list] [data-test-archived-workspace="Workspace A"]',
    );

    await click(`[data-test-restore-workspace-btn="${ownedRealmURL}"]`);

    await waitFor(
      '[data-test-workspace-list] [data-test-workspace="Workspace A"]',
    );
    assert
      .dom('[data-test-workspace-list] [data-test-workspace="Workspace A"]')
      .exists('the restored workspace returns to the active list');
    assert
      .dom(
        '[data-test-archived-list] [data-test-archived-workspace="Workspace A"]',
      )
      .doesNotExist('the restored workspace leaves the Archived section');
  });

  test('the archive confirmation modal can be cancelled', async function (assert) {
    await visitOperatorMode({ workspaceChooserOpened: true });

    await click(`[data-test-workspace-menu-trigger="${ownedRealmURL}"]`);
    await click('[data-test-boxel-menu-item-text="Archive Workspace"]');
    await click('[data-test-cancel-archive-button]');

    assert
      .dom(`[data-test-archive-modal="${ownedRealmURL}"]`)
      .doesNotExist('cancelling closes the modal');
    assert
      .dom('[data-test-workspace-list] [data-test-workspace="Workspace A"]')
      .exists('the workspace remains active when archive is cancelled');

    await click('[data-test-archived-toggle]');
    await waitFor('[data-test-archived-empty]');
    assert
      .dom('[data-test-archived-list]')
      .doesNotExist('nothing was archived');
  });

  test('the Archived disclosure lazy-loads and shows an empty state', async function (assert) {
    await visitOperatorMode({ workspaceChooserOpened: true });

    assert
      .dom('[data-test-archived-section]')
      .exists('the Archived disclosure is shown');
    assert
      .dom('[data-test-archived-list]')
      .doesNotExist('archived realms are not loaded until the row is expanded');
    assert
      .dom('[data-test-archived-empty]')
      .doesNotExist('no empty state is shown until the row is expanded');

    await click('[data-test-archived-toggle]');

    await waitFor('[data-test-archived-empty]');
    assert
      .dom('[data-test-archived-empty]')
      .exists('expanding with nothing archived shows the empty state');
  });

  test('non-owned workspaces have no Archive action', async function (assert) {
    await visitOperatorMode({ workspaceChooserOpened: true });

    await click(`[data-test-workspace-menu-trigger="${readOnlyRealmURL}"]`);

    assert
      .dom('[data-test-boxel-menu-item-text="Archive Workspace"]')
      .doesNotExist('Archive is absent on a workspace the user does not own');
    assert
      .dom('[data-test-boxel-menu-item-text="Realm Settings"]')
      .exists('the rest of the tile menu still renders for non-owners');
  });
});
