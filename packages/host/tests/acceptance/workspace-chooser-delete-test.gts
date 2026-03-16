import { click, waitUntil } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';

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
import { assertRecentFileURLs } from '../helpers/recent-files-cards';
import { setupApplicationTest } from '../helpers/setup';
import { SessionLocalStorageKey } from '@cardstack/host/utils/local-storage-keys';

const ownedRealmURL = 'http://test-realm/testuser/owned-workspace/';
const sharedRealmURL = 'http://test-realm/otheruser/shared-workspace/';

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

    let realmService = getService('realm');
    let recentFilesService = getService('recent-files-service');
    await realmService.login(ownedRealmURL);
    await realmService.login(sharedRealmURL);

    let sessionsBeforeDelete = JSON.parse(
      window.localStorage.getItem(SessionLocalStorageKey) ?? '{}',
    ) as Record<string, string>;
    assert.ok(
      sessionsBeforeDelete[ownedRealmURL],
      'owned realm session token exists before deletion',
    );
    assert.ok(
      sessionsBeforeDelete[sharedRealmURL],
      'shared realm session token exists before deletion',
    );

    recentFilesService.recentFiles.push(
      {
        realmURL: new URL(ownedRealmURL),
        filePath: 'Person/1.json',
        cursorPosition: null,
        timestamp: 3,
      },
      {
        realmURL: new URL(ownedRealmURL),
        filePath: 'person.gts',
        cursorPosition: null,
        timestamp: 2,
      },
      {
        realmURL: new URL(sharedRealmURL),
        filePath: 'index.json',
        cursorPosition: null,
        timestamp: 1,
      },
    );

    assert.dom('[data-test-workspace="Owned Workspace"]').exists();
    assertRecentFileURLs(assert, recentFilesService.recentFiles, [
      `${ownedRealmURL}Person/1.json`,
      `${ownedRealmURL}person.gts`,
      `${sharedRealmURL}index.json`,
    ]);

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
    let sessionsAfterDelete = JSON.parse(
      window.localStorage.getItem(SessionLocalStorageKey) ?? '{}',
    ) as Record<string, string>;
    assert.notOk(
      sessionsAfterDelete[ownedRealmURL],
      'deleted realm session token is removed',
    );
    assert.ok(
      sessionsAfterDelete[sharedRealmURL],
      'other realm session token remains',
    );
    assertRecentFileURLs(
      assert,
      recentFilesService.recentFiles,
      [`${sharedRealmURL}index.json`],
      'deleting a workspace removes its files from recent files',
    );
  });
});
