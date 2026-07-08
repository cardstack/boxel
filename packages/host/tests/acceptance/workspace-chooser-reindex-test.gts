import { click, settled, waitFor } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import { testRealmInfo } from '@cardstack/runtime-common';
import { APP_BOXEL_REALM_EVENT_TYPE } from '@cardstack/runtime-common/matrix-constants';

import {
  setupAcceptanceTestRealm,
  setupLocalIndexing,
  setupRealmCacheTeardown,
  setupRealmServerEndpoints,
  setupUserSubscription,
  visitOperatorMode,
  realmConfigCardJSON,
} from '../helpers';
import { setupBaseRealm } from '../helpers/base-realm';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';

// Workspace A is owned by the test user; Workspace C is read/write only (the
// test user is not its owner), so the Re-index action must never appear on it.
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

// The tile stops its indexing animation only when it hears an `index` event for
// the realm, mirroring the real server->host signal.
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

module('Acceptance | workspace-chooser re-index', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupRealmCacheTeardown(hooks);

  let receivedMethod: string | null = null;
  let receivedPathname: string | null = null;
  let responseStatus = 204;
  let responseBody: string | null = null;

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [ownedRealmURL, readOnlyRealmURL],
  });

  setupBaseRealm(hooks);

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

  hooks.beforeEach(async function () {
    setupUserSubscription();
    receivedMethod = null;
    receivedPathname = null;
    responseStatus = 204;
    responseBody = null;

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

  test('Re-index is owner-only', async function (assert) {
    await visitOperatorMode({ workspaceChooserOpened: true });

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
      .exists('the rest of the tile menu still renders for non-owners');
  });

  test('Re-index POSTs to the realm endpoint and animates the tile', async function (assert) {
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
      'Re-index calls the realm _full-reindex endpoint',
    );
    assert.true(
      realmService.info(ownedRealmURL).isIndexing,
      'the tile starts its indexing animation immediately',
    );
    // The indexing indicator only renders once @canAnimate is on and the realm
    // is indexing, so its presence proves the tile now animates for a reindex.
    assert
      .dom(
        `[data-test-workspace="Workspace A"] [data-test-realm-indexing-indicator]`,
      )
      .exists('the tile icon reflects the indexing pulse');

    simulateIndexDone(mockMatrixUtils, ownedRealmURL);
    await settled();

    assert.false(
      realmService.info(ownedRealmURL).isIndexing,
      'the index event stops the tile animation',
    );
  });

  test('Re-index is disabled while indexing and re-enabled when it finishes', async function (assert) {
    await visitOperatorMode({ workspaceChooserOpened: true });

    await click(`[data-test-workspace-menu-trigger="${ownedRealmURL}"]`);
    await click('[data-test-boxel-menu-item-text="Re-index"]');

    await click(`[data-test-workspace-menu-trigger="${ownedRealmURL}"]`);
    assert
      .dom('[data-test-boxel-menu-item-text="Re-index"]')
      .isDisabled('Re-index is disabled while the realm is indexing');

    // Leave the menu open: the item's disabled state is derived from the live
    // indexing flag, so the index event flips it back to enabled in place. (A
    // second trigger click here would just toggle the open menu shut.)
    simulateIndexDone(mockMatrixUtils, ownedRealmURL);
    await settled();

    assert
      .dom('[data-test-boxel-menu-item-text="Re-index"]')
      .isNotDisabled('Re-index is enabled again once indexing finishes');
  });

  test('a failed Re-index surfaces an inline error and restores the tile', async function (assert) {
    responseStatus = 500;
    responseBody = 'boom';

    let realmService = getService('realm');

    await visitOperatorMode({ workspaceChooserOpened: true });

    await click(`[data-test-workspace-menu-trigger="${ownedRealmURL}"]`);
    await click('[data-test-boxel-menu-item-text="Re-index"]');

    await waitFor('[data-test-reindex-error]');
    assert
      .dom('[data-test-reindex-error]')
      .hasText(
        'Full reindex realm failed: 500 - boom',
        'the failure is surfaced inline on the tile',
      );
    assert.false(
      realmService.info(ownedRealmURL).isIndexing,
      'the indexing animation is restored after a failed Re-index',
    );

    // The error does not auto-dismiss; it stays until the user clears it.
    await settled();
    assert
      .dom('[data-test-reindex-error]')
      .exists('the error persists until it is dismissed');

    await click('[data-test-reindex-error-dismiss]');
    assert
      .dom('[data-test-reindex-error]')
      .doesNotExist('dismissing the banner removes the error');
  });

  test('a long Re-index error is line-clamped but keeps the full text on hover', async function (assert) {
    responseStatus = 500;
    // A server body long enough to overflow the small tile banner.
    responseBody = 'stack trace: '.repeat(40).trim();
    let fullMessage = `Full reindex realm failed: 500 - ${responseBody}`;

    await visitOperatorMode({ workspaceChooserOpened: true });

    await click(`[data-test-workspace-menu-trigger="${ownedRealmURL}"]`);
    await click('[data-test-boxel-menu-item-text="Re-index"]');

    await waitFor('[data-test-reindex-error]');

    // The visible text is clamped by CSS, but the full message stays reachable
    // via the title attribute so nothing is lost.
    let message = document.querySelector(
      '[data-test-reindex-error] .reindex-error__message',
    ) as HTMLElement;
    assert.strictEqual(
      message.getAttribute('title'),
      fullMessage,
      'the full error is preserved in the title for hover',
    );
    assert.strictEqual(
      getComputedStyle(message).getPropertyValue('-webkit-line-clamp').trim(),
      '3',
      'the message is clamped to three lines so the banner cannot cover the tile',
    );
  });
});
