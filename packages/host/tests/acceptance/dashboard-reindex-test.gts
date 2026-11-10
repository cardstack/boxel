import { click, settled, waitFor } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import { testRealmInfo } from '@cardstack/runtime-common';
import { APP_BOXEL_REALM_EVENT_TYPE } from '@cardstack/runtime-common/matrix-constants';

import { setupRealmServerEndpoints, visitOperatorMode } from '../helpers';
import { setupDashboardTest } from '../helpers/dashboard';

// Workspace A is owned by the test user; Workspace C is read/write only (the
// test user is not its owner), so the Re-index action must never appear on it.
const ownedRealmURL = 'http://test-realm/testuser/workspace-a/';
const readOnlyRealmURL = 'http://test-realm/otheruser/workspace-c/';

const OWNED_TILE =
  '[data-test-workspace-list] [data-test-workspace="Workspace A"]';

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

// A workspace stops its indexing animation only when it hears an `index`
// event for the realm, as the realm server sends one.
function simulateIndexDone(mockMatrixUtils: any, realmURL: string) {
  mockMatrixUtils.simulateRemoteMessage(
    mockMatrixUtils.getRoomIdForRealmAndUser(realmURL, '@testuser:localhost'),
    testRealmInfo.realmUserId!,
    {
      eventName: 'index',
      indexType: 'full',
      realmURL,
    },
    { type: APP_BOXEL_REALM_EVENT_TYPE },
  );
}

module('Acceptance | dashboard re-index', function (hooks) {
  let receivedMethod: string | null = null;
  let receivedPathname: string | null = null;
  let responseStatus = 204;
  let responseBody: string | null = null;

  let mockMatrixUtils = setupDashboardTest(hooks, {
    matrix: {
      loggedInAs: '@testuser:localhost',
      activeRealms: [ownedRealmURL, readOnlyRealmURL],
    },
    authEndpoints: false,
    beforeRealms(hooks) {
      setupRealmServerEndpoints(hooks, [
        {
          route: 'testuser/workspace-a/_full-reindex',
          getResponse: async (req: Request) => {
            receivedMethod = req.method;
            receivedPathname = new URL(req.url).pathname;
            return new Response(responseBody, { status: responseStatus });
          },
        },
      ]);
      hooks.beforeEach(function () {
        receivedMethod = null;
        receivedPathname = null;
        responseStatus = 204;
        responseBody = null;
      });
    },
    realms: [
      {
        url: ownedRealmURL,
        name: 'Workspace A',
        contents: { 'index.json': cardsGridIndex },
      },
      {
        url: readOnlyRealmURL,
        name: 'Workspace C',
        permissions: { '@testuser:localhost': ['read', 'write'] },
        contents: { 'index.json': cardsGridIndex },
      },
    ],
  });

  test('Re-index is offered only on workspaces the user owns', async function (assert) {
    await visitOperatorMode({ workspaceChooserOpened: true });
    assert.dom('[data-test-dashboard]').exists();

    await click(`[data-test-workspace-menu-trigger="${ownedRealmURL}"]`);
    assert
      .dom('[data-test-boxel-menu-item-text="Re-index"]')
      .exists('Re-index appears on a workspace the user owns');

    await click(`[data-test-workspace-menu-trigger="${readOnlyRealmURL}"]`);
    assert
      .dom('[data-test-boxel-menu-item-text="Re-index"]')
      .doesNotExist('Re-index is absent on a workspace the user does not own');
    assert
      .dom('[data-test-boxel-menu-item-text="Realm Settings"]')
      .exists('the rest of the menu still renders for non-owners');
  });

  test('Re-index POSTs to the realm endpoint and animates the workspace until the index event', async function (assert) {
    let realmService = getService('realm');

    await visitOperatorMode({ workspaceChooserOpened: true });

    assert.false(
      realmService.info(ownedRealmURL).isIndexing,
      'the realm is not indexing before Re-index runs',
    );

    await click(`[data-test-workspace-menu-trigger="${ownedRealmURL}"]`);
    await click('[data-test-boxel-menu-item-text="Re-index"]');

    assert.strictEqual(receivedMethod, 'POST', 'Re-index uses POST');
    assert.strictEqual(
      receivedPathname,
      '/testuser/workspace-a/_full-reindex',
      "Re-index calls the realm's _full-reindex endpoint",
    );
    assert.true(
      realmService.info(ownedRealmURL).isIndexing,
      'the workspace starts its indexing animation at once',
    );
    assert
      .dom(`${OWNED_TILE} [data-test-realm-indexing-indicator]`)
      .exists('the workspace icon shows the indexing pulse');

    simulateIndexDone(mockMatrixUtils, ownedRealmURL);
    await settled();

    assert.false(
      realmService.info(ownedRealmURL).isIndexing,
      'the index event stops the animation',
    );
    assert
      .dom(`${OWNED_TILE} [data-test-realm-indexing-indicator]`)
      .doesNotExist('the indexing pulse stops');
  });

  test('Re-index is disabled while indexing and enabled again when it finishes', async function (assert) {
    await visitOperatorMode({ workspaceChooserOpened: true });

    await click(`[data-test-workspace-menu-trigger="${ownedRealmURL}"]`);
    await click('[data-test-boxel-menu-item-text="Re-index"]');

    await click(`[data-test-workspace-menu-trigger="${ownedRealmURL}"]`);
    assert
      .dom('[data-test-boxel-menu-item-text="Re-index"]')
      .isDisabled('Re-index is disabled while the realm is indexing');

    // The menu stays open: the item follows the live indexing flag, so the
    // index event enables it in place.
    simulateIndexDone(mockMatrixUtils, ownedRealmURL);
    await settled();

    assert
      .dom('[data-test-boxel-menu-item-text="Re-index"]')
      .isNotDisabled('Re-index is enabled again once indexing finishes');
  });

  test('a failed Re-index shows its error on the workspace until dismissed, and stops the animation', async function (assert) {
    responseStatus = 500;
    responseBody = 'boom';

    let realmService = getService('realm');

    await visitOperatorMode({ workspaceChooserOpened: true });

    await click(`[data-test-workspace-menu-trigger="${ownedRealmURL}"]`);
    await click('[data-test-boxel-menu-item-text="Re-index"]');

    await waitFor(`${OWNED_TILE} [data-test-reindex-error]`);
    assert
      .dom(`${OWNED_TILE} [data-test-reindex-error-message]`)
      .hasText('Full reindex realm failed: 500 - boom');
    assert.false(
      realmService.info(ownedRealmURL).isIndexing,
      'the indexing animation stops after a failed Re-index',
    );

    await settled();
    assert
      .dom(`${OWNED_TILE} [data-test-reindex-error]`)
      .exists('the error stays until it is dismissed');

    await click(`${OWNED_TILE} [data-test-reindex-error-dismiss]`);
    assert
      .dom(`${OWNED_TILE} [data-test-reindex-error]`)
      .doesNotExist('dismissing removes the error');
  });
});
