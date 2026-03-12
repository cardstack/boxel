import { click, waitUntil } from '@ember/test-helpers';

import { module, test } from 'qunit';

import {
  setupAcceptanceTestRealm,
  setupAuthEndpoints,
  setupLocalIndexing,
  setupRealmCacheTeardown,
  setupUserSubscription,
  visitOperatorMode,
} from '../helpers';
import { setupBaseRealm } from '../helpers/base-realm';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';

const ownedRealmURL = 'http://test-realm/testuser/owned-workspace/';
const sharedRealmURL = 'http://test-realm/otheruser/shared-workspace/';
const publishedOwnedRealmURL =
  'http://testuser.localhost:4201/owned-workspace/';
const customPublishedOwnedRealmURL =
  'https://published.boxel.site/owned-workspace/';

module('Acceptance | workspace-chooser-delete', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupRealmCacheTeardown(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [ownedRealmURL, sharedRealmURL],
  });

  setupBaseRealm(hooks);

  hooks.beforeEach(async function () {
    setupUserSubscription();
    setupAuthEndpoints();

    await setupAcceptanceTestRealm({
      realmURL: ownedRealmURL,
      mockMatrixUtils,
      permissions: {
        '@testuser:localhost': ['read', 'write', 'realm-owner'],
      },
      contents: {
        '.realm.json': {
          name: 'Owned Workspace',
          backgroundURL: null,
          iconURL: null,
          lastPublishedAt: {
            [publishedOwnedRealmURL]: '1735689600000',
            [customPublishedOwnedRealmURL]: '1735603200000',
          },
        },
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
        'Person/1.json': {
          data: {
            type: 'card',
            meta: {
              adoptsFrom: {
                module: 'https://cardstack.com/base/card-api',
                name: 'CardDef',
              },
            },
          },
        },
        'person.gts': `import { CardDef } from "https://cardstack.com/base/card-api";

export class Person extends CardDef {}
`,
      },
    });

    await setupAcceptanceTestRealm({
      realmURL: sharedRealmURL,
      mockMatrixUtils,
      permissions: {
        '@testuser:localhost': ['read', 'write'],
        '@otheruser:localhost': ['read', 'write', 'realm-owner'],
      },
      contents: {
        '.realm.json': {
          name: 'Shared Workspace',
          backgroundURL: null,
          iconURL: null,
        },
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

  test('delete workspace is enabled only for a workspace created by the current user', async function (assert) {
    await visitOperatorMode({ workspaceChooserOpened: true });

    await click(`[data-test-workspace-menu-trigger="${ownedRealmURL}"]`);
    assert
      .dom('[data-test-boxel-menu-item-text="Delete workspace"]')
      .doesNotHaveAttribute('disabled');

    await click(`[data-test-workspace-menu-trigger="${sharedRealmURL}"]`);
    assert
      .dom('[data-test-boxel-menu-item-text="Delete workspace"]')
      .hasAttribute('disabled');
  });

  test('can delete a workspace created by the current user from the chooser', async function (assert) {
    await visitOperatorMode({
      workspaceChooserOpened: true,
      stacks: [[{ id: `${ownedRealmURL}index`, format: 'isolated' }]],
    });

    assert.dom('[data-test-workspace="Owned Workspace"]').exists();

    await click(`[data-test-workspace-menu-trigger="${ownedRealmURL}"]`);
    await click('[data-test-boxel-menu-item-text="Delete workspace"]');

    assert.dom(`[data-test-delete-modal="${ownedRealmURL}"]`).exists();

    await click('[data-test-confirm-delete-button]');

    await waitUntil(
      () => !document.querySelector('[data-test-workspace="Owned Workspace"]'),
    );

    assert.dom('[data-test-workspace="Owned Workspace"]').doesNotExist();
    assert.dom('[data-test-workspace="Shared Workspace"]').exists();
    assert.dom('[data-test-workspace-chooser]').exists();
  });

  test('delete confirmation summarizes contents without zero-count items and lists published realms', async function (assert) {
    await visitOperatorMode({ workspaceChooserOpened: true });

    await click(`[data-test-workspace-menu-trigger="${ownedRealmURL}"]`);
    await click('[data-test-boxel-menu-item-text="Delete workspace"]');

    await waitUntil(() =>
      document
        .querySelector('[data-test-delete-msg]')
        ?.textContent?.includes('Contains 2 cards and 1 definition.'),
    );

    assert
      .dom('[data-test-delete-msg]')
      .includesText('Delete workspace Owned Workspace');
    assert
      .dom('[data-test-delete-msg]')
      .includesText('Contains 2 cards and 1 definition.');
    assert.dom('[data-test-delete-msg]').doesNotIncludeText('0 files');
    assert
      .dom('[data-test-delete-msg]')
      .includesText('Published realms that will also be removed');
    assert
      .dom(
        `[data-test-delete-modal="${ownedRealmURL}"] a[href="${publishedOwnedRealmURL}"]`,
      )
      .exists();
    assert
      .dom(
        `[data-test-delete-modal="${ownedRealmURL}"] a[href="${customPublishedOwnedRealmURL}"]`,
      )
      .exists();
  });
});
