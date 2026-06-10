import {
  click,
  focus,
  settled,
  triggerKeyEvent,
  waitFor,
  waitUntil,
} from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import { TrackedObject } from 'tracked-built-ins';

import { testRealmInfo } from '@cardstack/runtime-common';

import type MatrixService from '@cardstack/host/services/matrix-service';

import {
  setupAcceptanceTestRealm,
  setupAuthEndpoints,
  setupLocalIndexing,
  setupRealmCacheTeardown,
  setupUserSubscription,
  visitOperatorMode,
  realmConfigCardJSON,
} from '../helpers';
import { setupBaseRealm } from '../helpers/base-realm';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';

const realmAURL = 'http://test-realm/testuser/workspace-a/';
const realmBURL = 'http://test-realm/testuser/workspace-b/';

function withUpdatedRealmInfo(
  realmURL: string,
  updates: Partial<typeof testRealmInfo>,
): () => void {
  let realmService = getService('realm') as any;
  let realmResource = realmService.realms.get(realmURL);
  if (!realmResource) {
    throw new Error(`Realm resource for ${realmURL} is not registered`);
  }

  let previousInfo = realmResource.info;
  let baseInfo = previousInfo ? { ...previousInfo } : { ...testRealmInfo };

  realmResource.info = new TrackedObject({
    ...baseInfo,
    ...updates,
  });

  return () => {
    realmResource.info = previousInfo;
  };
}

module('Acceptance | workspace-chooser', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupRealmCacheTeardown(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [realmAURL, realmBURL],
  });

  setupBaseRealm(hooks);

  hooks.beforeEach(async function () {
    setupUserSubscription();
    setupAuthEndpoints();

    await setupAcceptanceTestRealm({
      realmURL: realmAURL,
      mockMatrixUtils,
      permissions: {
        '@testuser:localhost': ['read', 'write', 'realm-owner'],
      },
      contents: {
        'realm.json': realmConfigCardJSON({ name: 'Workspace A' }),
        'index.json': {
          data: {
            type: 'card',
            meta: {
              adoptsFrom: {
                module: 'https://cardstack.com/base/cards-grid',
                name: 'CardsGrid',
              },
            },
          },
        },
      },
    });

    await setupAcceptanceTestRealm({
      realmURL: realmBURL,
      mockMatrixUtils,
      permissions: {
        '@testuser:localhost': ['read', 'write', 'realm-owner'],
      },
      contents: {
        'realm.json': realmConfigCardJSON({ name: 'Workspace B' }),
        'index.json': {
          data: {
            type: 'card',
            meta: {
              adoptsFrom: {
                module: 'https://cardstack.com/base/cards-grid',
                name: 'CardsGrid',
              },
            },
          },
        },
      },
    });
  });

  module('favorites', function () {
    test('shows empty favorites message when no favorites exist', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      assert
        .dom('[data-test-favorites-empty]')
        .hasText('You have no favorites yet');
    });

    test('can favorite a workspace by clicking the star button', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      assert
        .dom('[data-test-favorites-empty]')
        .hasText('You have no favorites yet');

      await click(`[data-test-workspace-favorite-btn="${realmAURL}"]`);

      assert.dom('[data-test-favorites-empty]').doesNotExist();
      assert
        .dom('[data-test-favorites-list] [data-test-workspace="Workspace A"]')
        .exists('favorited workspace appears in favorites section');

      let matrixService = getService('matrix-service') as MatrixService;
      assert.deepEqual(
        matrixService.workspaceFavorites,
        [realmAURL],
        'matrix service tracks the favorite',
      );
    });

    test('can unfavorite a workspace by clicking the star button again', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      let matrixService = getService('matrix-service') as MatrixService;
      matrixService.workspaceFavorites = [realmAURL];
      await settled();

      assert
        .dom('[data-test-favorites-list] [data-test-workspace="Workspace A"]')
        .exists('favorited workspace appears in favorites section');

      await click(`[data-test-workspace-favorite-btn="${realmAURL}"]`);

      assert
        .dom('[data-test-favorites-empty]')
        .hasText('You have no favorites yet');
      assert.deepEqual(
        matrixService.workspaceFavorites,
        [],
        'favorite was removed from matrix service',
      );
    });

    test('can favorite a workspace via the context menu', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      await click(`[data-test-workspace-menu-trigger="${realmAURL}"]`);
      await click('[data-test-boxel-menu-item-text="Favorite"]');

      assert
        .dom('[data-test-favorites-list] [data-test-workspace="Workspace A"]')
        .exists('favorited workspace appears in favorites section');
    });
  });

  module('realm settings', function () {
    test('opens the realm config card in edit mode and closes the chooser', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      await click(`[data-test-workspace-menu-trigger="${realmAURL}"]`);
      await click('[data-test-boxel-menu-item-text="Realm Settings"]');

      await waitFor(`[data-test-stack-card="${realmAURL}realm"]`);
      assert
        .dom('[data-test-workspace-chooser]')
        .doesNotExist('workspace chooser is dismissed');
      assert
        .dom(`[data-test-stack-card="${realmAURL}realm"]`)
        .exists('realm config card is opened on the stack');
    });
  });

  module('sort dropdown', function () {
    test('sort dropdown renders with View All as default', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      assert.dom('[data-test-sort-dropdown-trigger]').includesText('View All');
    });

    test('can switch to Hosted Only filter', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      await click('[data-test-sort-dropdown-trigger]');
      await click('[data-test-option="1"]');

      assert
        .dom('[data-test-sort-dropdown-trigger]')
        .includesText('Hosted Only');
    });

    test('can switch back to View All filter', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      await click('[data-test-sort-dropdown-trigger]');
      await click('[data-test-option="1"]');

      assert
        .dom('[data-test-sort-dropdown-trigger]')
        .includesText('Hosted Only');

      await click('[data-test-sort-dropdown-trigger]');
      await click('[data-test-option="0"]');

      assert.dom('[data-test-sort-dropdown-trigger]').includesText('View All');
    });
  });

  module('hosted-only filtering', function () {
    test('hosted-only filter hides non-hosted workspaces', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      assert
        .dom('[data-test-workspace-list] [data-test-workspace="Workspace A"]')
        .exists();
      assert
        .dom('[data-test-workspace-list] [data-test-workspace="Workspace B"]')
        .exists();

      // Make workspace A "hosted" by giving it lastPublishedAt
      let restoreA = withUpdatedRealmInfo(realmAURL, {
        lastPublishedAt: {
          'https://published.example.com/': String(Date.now()),
        },
      });

      // Switch to hosted-only
      await click('[data-test-sort-dropdown-trigger]');
      await click('[data-test-option="1"]');

      assert
        .dom('[data-test-workspace-list] [data-test-workspace="Workspace A"]')
        .exists('hosted workspace remains visible');
      assert
        .dom('[data-test-workspace-list] [data-test-workspace="Workspace B"]')
        .doesNotExist('non-hosted workspace is hidden');

      restoreA();
    });

    test('hosted-only filter also applies to favorites', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      let matrixService = getService('matrix-service') as MatrixService;
      matrixService.workspaceFavorites = [realmAURL, realmBURL];
      await settled();

      assert
        .dom('[data-test-favorites-list] [data-test-workspace="Workspace A"]')
        .exists();
      assert
        .dom('[data-test-favorites-list] [data-test-workspace="Workspace B"]')
        .exists();

      // Make only workspace A hosted
      let restoreA = withUpdatedRealmInfo(realmAURL, {
        lastPublishedAt: {
          'https://published.example.com/': String(Date.now()),
        },
      });

      await click('[data-test-sort-dropdown-trigger]');
      await click('[data-test-option="1"]');

      assert
        .dom('[data-test-favorites-list] [data-test-workspace="Workspace A"]')
        .exists('hosted favorite remains visible');
      assert
        .dom('[data-test-favorites-list] [data-test-workspace="Workspace B"]')
        .doesNotExist('non-hosted favorite is hidden');
      assert
        .dom('[data-test-favorites-empty]')
        .doesNotExist('empty message is not shown when some favorites match');

      restoreA();
    });

    test('shows "No matching results" when all favorites are filtered out', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      let matrixService = getService('matrix-service') as MatrixService;
      matrixService.workspaceFavorites = [realmAURL];
      await settled();

      assert
        .dom('[data-test-favorites-list] [data-test-workspace="Workspace A"]')
        .exists();

      // Switch to hosted-only — workspace A is not hosted
      await click('[data-test-sort-dropdown-trigger]');
      await click('[data-test-option="1"]');

      assert.dom('[data-test-favorites-empty]').hasText('No matching results');
    });
  });

  module('delete menu item', function () {
    test('delete menu item opens the delete modal', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      await click(`[data-test-workspace-menu-trigger="${realmAURL}"]`);
      await click('[data-test-boxel-menu-item-text="Delete Workspace"]');

      await waitFor(`[data-test-delete-modal="${realmAURL}"]`);
      assert.dom(`[data-test-delete-modal="${realmAURL}"]`).exists();
    });
  });

  module('long realm names', function () {
    test('workspace card stays constrained to icon-tile width when the name is long', async function (assert) {
      let longName =
        'A Workspace Name Long Enough To Wrap Onto Multiple Lines For Centering';

      let restoreA = withUpdatedRealmInfo(realmAURL, { name: longName });

      try {
        await visitOperatorMode({ workspaceChooserOpened: true });

        let cardSelector = `[data-test-workspace-list] [data-test-workspace="${longName}"]`;
        let nameSelector = `${cardSelector} [data-test-workspace-name]`;

        // Wait for the chooser to render the card with its full long name
        // text, rather than relying on `settled()` alone — measuring layout
        // before the name has rendered is a known source of flakiness.
        await waitUntil(
          () =>
            document.querySelector(nameSelector)?.textContent?.trim() ===
            longName,
          {
            timeoutMessage:
              'workspace-name element did not render the full long realm name',
          },
        );

        assert
          .dom(cardSelector)
          .exists('workspace card renders with the long realm name');
        assert
          .dom(nameSelector)
          .hasText(
            longName,
            'name element renders the full long name in the DOM',
          );

        let cardEl = document.querySelector(cardSelector) as HTMLElement | null;
        assert.ok(cardEl, 'workspace-card element is present in the DOM');

        // ItemContainer (.workspace button) is hard-pinned to
        // var(--boxel-xxs-container) (250px) in item-container.gts. With the
        // .info > .name 2-line clamp + text-wrap: wrap, the widest child of
        // .workspace-card is the tile, so the column's fit-content width
        // resolves to 250px. Reading the resolved CSS width (rather than
        // comparing two laid-out flex boxes via offsetWidth) is deterministic
        // and doesn't depend on subpixel/flex layout timing.
        let cardWidth = cardEl
          ? parseFloat(window.getComputedStyle(cardEl).width)
          : NaN;
        assert.strictEqual(
          cardWidth,
          250,
          `workspace-card resolves to the tile width (250px) regardless of name length; got ${cardWidth}px`,
        );
      } finally {
        restoreA();
      }
    });
  });

  module('keyboard navigation', function () {
    const urlByName: Record<string, string> = {
      'Workspace A': realmAURL,
      'Workspace B': realmBURL,
    };

    // Workspace names rendered as cards, in DOM (selection) order.
    function orderedWorkspaceNames(): string[] {
      return [
        ...document.querySelectorAll(
          '[data-test-workspace-chooser] [data-test-workspace]',
        ),
      ].map((el) => el.getAttribute('data-test-workspace') ?? '');
    }

    async function arrow(key: string) {
      await triggerKeyEvent(
        '[data-test-workspace-chooser]',
        'keydown',
        key as any,
      );
    }

    test('the first workspace is selected and focused when the chooser opens', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });
      await waitFor('[data-test-workspace-selected]');

      let [first] = orderedWorkspaceNames();
      assert
        .dom('[data-test-workspace-selected]')
        .exists({ count: 1 }, 'exactly one workspace is selected');
      assert
        .dom(`[data-test-workspace-selected="${first}"]`)
        .exists('the first workspace is the selected one');
      assert
        .dom(`[data-test-workspace-button="${first}"]`)
        .isFocused('the selected workspace button receives focus');
    });

    test('left/right arrows step through the sequence, including the New Workspace tile', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });
      await waitFor('[data-test-workspace-selected]');

      let [first, second] = orderedWorkspaceNames();

      await arrow('ArrowRight');
      assert
        .dom(`[data-test-workspace-selected="${second}"]`)
        .exists('ArrowRight selects the next workspace');
      assert.dom('[data-test-workspace-selected]').exists({ count: 1 });

      await arrow('ArrowRight');
      assert
        .dom('[data-test-add-workspace-selected]')
        .exists('ArrowRight reaches the New Workspace tile');
      assert
        .dom('[data-test-workspace-selected]')
        .doesNotExist('no workspace card is selected while New Workspace is');

      await arrow('ArrowRight');
      assert
        .dom('[data-test-add-workspace-selected]')
        .exists('ArrowRight at the end stays on the New Workspace tile');

      await arrow('ArrowLeft');
      assert
        .dom(`[data-test-workspace-selected="${second}"]`)
        .exists('ArrowLeft leaves the New Workspace tile');

      await arrow('ArrowLeft');
      assert
        .dom(`[data-test-workspace-selected="${first}"]`)
        .exists('ArrowLeft returns to the first workspace');

      await arrow('ArrowLeft');
      assert
        .dom(`[data-test-workspace-selected="${first}"]`)
        .exists('ArrowLeft at the start stays on the first workspace');
    });

    test('up/down arrows move vertically between rows', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      // Favoriting a workspace puts a Favorites row directly above the
      // Your Workspaces row, so up/down can cross between them.
      let matrixService = getService('matrix-service') as MatrixService;
      matrixService.workspaceFavorites = [realmAURL];
      await settled();
      await waitFor(
        '[data-test-favorites-list] [data-test-workspace-selected]',
      );

      assert
        .dom(
          '[data-test-favorites-list] [data-test-workspace-selected="Workspace A"]',
        )
        .exists('the favorited workspace (top row) starts selected');

      await arrow('ArrowDown');
      assert
        .dom(
          '[data-test-workspace-list] [data-test-workspace-selected="Workspace A"]',
        )
        .exists('ArrowDown moves down into the Your Workspaces row');
      assert.dom('[data-test-workspace-selected]').exists({ count: 1 });

      await arrow('ArrowUp');
      assert
        .dom(
          '[data-test-favorites-list] [data-test-workspace-selected="Workspace A"]',
        )
        .exists('ArrowUp moves back up into the Favorites row');
    });

    test('focusing a workspace selects it', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });
      await waitFor('[data-test-workspace-selected]');

      let [first, second] = orderedWorkspaceNames();
      assert
        .dom(`[data-test-workspace-selected="${first}"]`)
        .exists('first workspace selected initially');

      await focus(`[data-test-workspace-button="${second}"]`);
      assert
        .dom(`[data-test-workspace-selected="${second}"]`)
        .exists('focusing the second workspace selects it');
      assert.dom('[data-test-workspace-selected]').exists({ count: 1 });
    });

    test('Enter opens the selected workspace', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });
      await waitFor('[data-test-workspace-selected]');

      let [first] = orderedWorkspaceNames();
      let firstURL = urlByName[first];

      await triggerKeyEvent(
        '[data-test-workspace-chooser]',
        'keydown',
        'Enter',
      );

      await waitFor(`[data-test-stack-card="${firstURL}index"]`);
      assert
        .dom('[data-test-workspace-chooser]')
        .doesNotExist('chooser is dismissed after opening a workspace');
      assert
        .dom(`[data-test-stack-card="${firstURL}index"]`)
        .exists('the selected workspace is opened on the stack');
    });

    test('Enter on the New Workspace tile opens the create-workspace modal', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });
      await waitFor('[data-test-workspace-selected]');

      // Step right past the two user workspaces to the New Workspace tile.
      await arrow('ArrowRight');
      await arrow('ArrowRight');
      assert
        .dom('[data-test-add-workspace-selected]')
        .exists('the New Workspace tile is selected');

      await triggerKeyEvent(
        '[data-test-workspace-chooser]',
        'keydown',
        'Enter',
      );

      await waitFor('[data-test-create-workspace-modal]');
      assert
        .dom('[data-test-create-workspace-modal]')
        .exists('Enter opens the create-workspace modal');
    });
  });

  module('hosted overlay', function () {
    test('host trigger is not shown for non-hosted workspaces', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      assert
        .dom(`[data-test-host-trigger="${realmAURL}"]`)
        .doesNotExist('no host trigger for non-hosted workspace');
    });

    test('host trigger appears for hosted workspaces', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      let restoreA = withUpdatedRealmInfo(realmAURL, {
        lastPublishedAt: {
          'https://my-site.example.com/': String(Date.now()),
        },
      });

      await settled();

      assert
        .dom(`[data-test-host-trigger="${realmAURL}"]`)
        .exists('host trigger is rendered');
      assert
        .dom(`[data-test-host-trigger="${realmAURL}"] .trigger-url`)
        .hasText('my-site.example.com');

      restoreA();
    });

    test('clicking host trigger opens dropdown with published URLs', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      let restoreA = withUpdatedRealmInfo(realmAURL, {
        lastPublishedAt: {
          'https://site-one.example.com/': String(Date.now()),
          'https://site-two.example.com/': String(Date.now() - 1000),
        },
      });

      await settled();

      assert
        .dom(`[data-test-host-dropdown="${realmAURL}"]`)
        .doesNotExist('dropdown not visible initially');

      await click(`[data-test-host-trigger="${realmAURL}"]`);

      assert
        .dom(`[data-test-host-dropdown="${realmAURL}"]`)
        .exists('dropdown is open');
      assert
        .dom(
          `[data-test-host-dropdown="${realmAURL}"] [data-test-host-dropdown-option]`,
        )
        .exists({ count: 2 }, 'shows both published URLs');

      restoreA();
    });

    test('dropdown closes on mouseleave', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      let restoreA = withUpdatedRealmInfo(realmAURL, {
        lastPublishedAt: {
          'https://my-site.example.com/': String(Date.now()),
        },
      });

      await settled();

      await click(`[data-test-host-trigger="${realmAURL}"]`);
      assert
        .dom(`[data-test-host-dropdown="${realmAURL}"]`)
        .exists('dropdown is open');

      // Trigger mouseleave on the workspace card
      let card = document
        .querySelector(`[data-test-host-trigger="${realmAURL}"]`)
        ?.closest('.workspace-card');
      if (card) {
        card.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
      }
      await settled();

      assert
        .dom(`[data-test-host-dropdown="${realmAURL}"]`)
        .doesNotExist('dropdown closed on mouseleave');

      restoreA();
    });
  });
});
