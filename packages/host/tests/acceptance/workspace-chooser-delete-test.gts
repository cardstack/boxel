import { click, waitUntil } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';

import window from 'ember-window-mock';
import { module, test } from 'qunit';

import { SessionLocalStorageKey } from '@cardstack/host/utils/local-storage-keys';

import {
  createJWT,
  setupAcceptanceTestRealm,
  setupAuthEndpoints,
  setupLocalIndexing,
  setupRealmCacheTeardown,
  setupUserSubscription,
  testRealmSecretSeed,
  visitOperatorMode,
} from '../helpers';
import { setupBaseRealm } from '../helpers/base-realm';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { assertRecentFileURLs } from '../helpers/recent-files-cards';
import { setupApplicationTest } from '../helpers/setup';

const ownedRealmURL = 'http://test-realm/testuser/owned-workspace/';
const sharedRealmURL = 'http://test-realm/otheruser/shared-workspace/';
const delegatedOwnerRealmURL =
  'http://test-realm/otheruser/delegated-owner-workspace/';

module('Acceptance | workspace-chooser-delete', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupRealmCacheTeardown(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [ownedRealmURL, sharedRealmURL, delegatedOwnerRealmURL],
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
                module: '@cardstack/base/cards-grid',
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
                module: '@cardstack/base/card-api',
                name: 'CardDef',
              },
            },
          },
        },
        'person.gts': `import { CardDef } from "@cardstack/base/card-api";

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
                module: '@cardstack/base/cards-grid',
                name: 'CardsGrid',
              },
            },
          },
        },
      },
    });

    await setupAcceptanceTestRealm({
      realmURL: delegatedOwnerRealmURL,
      mockMatrixUtils,
      permissions: {
        '@testuser:localhost': ['read', 'write', 'realm-owner'],
        '@otheruser:localhost': ['read', 'write', 'realm-owner'],
      },
      contents: {
        '.realm.json': {
          name: 'Delegated Owner Workspace',
          backgroundURL: null,
          iconURL: null,
        },
        'index.json': {
          data: {
            type: 'card',
            meta: {
              adoptsFrom: {
                module: '@cardstack/base/cards-grid',
                name: 'CardsGrid',
              },
            },
          },
        },
      },
    });
  });

  hooks.afterEach(function () {
    window.localStorage.removeItem(SessionLocalStorageKey);
  });

  test('delete workspace is enabled only for a workspace the current user owns', async function (assert) {
    await visitOperatorMode({ workspaceChooserOpened: true });

    await click(`[data-test-workspace-menu-trigger="${ownedRealmURL}"]`);
    assert
      .dom('[data-test-boxel-menu-item-text="Delete workspace"]')
      .doesNotHaveAttribute('disabled');

    await click(`[data-test-workspace-menu-trigger="${sharedRealmURL}"]`);
    assert
      .dom('[data-test-boxel-menu-item-text="Delete workspace"]')
      .hasAttribute('disabled');

    await click(
      `[data-test-workspace-menu-trigger="${delegatedOwnerRealmURL}"]`,
    );
    assert
      .dom('[data-test-boxel-menu-item-text="Delete workspace"]')
      .doesNotHaveAttribute('disabled');
  });

  test('can delete a workspace the current user owns from the chooser', async function (assert) {
    await visitOperatorMode({
      workspaceChooserOpened: true,
      stacks: [[{ id: `${ownedRealmURL}index`, format: 'isolated' }]],
    });

    let recentFilesService = getService('recent-files-service');
    window.localStorage.setItem(
      SessionLocalStorageKey,
      JSON.stringify({
        [ownedRealmURL]: createJWT(
          {
            user: '@testuser:localhost',
            realm: ownedRealmURL,
            sessionRoom: 'owned-session-room',
            realmServerURL: new URL(ownedRealmURL).origin,
            permissions: ['read', 'write', 'realm-owner'],
          },
          '1 hour',
          testRealmSecretSeed,
        ),
        [sharedRealmURL]: createJWT(
          {
            user: '@testuser:localhost',
            realm: sharedRealmURL,
            sessionRoom: 'shared-session-room',
            realmServerURL: new URL(sharedRealmURL).origin,
            permissions: ['read', 'write'],
          },
          '1 hour',
          testRealmSecretSeed,
        ),
      }),
    );

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
