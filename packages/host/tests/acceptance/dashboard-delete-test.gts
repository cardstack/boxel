import { click, waitFor, waitUntil } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';

import window from 'ember-window-mock';
import { module, test } from 'qunit';

import { SessionLocalStorageKey } from '@cardstack/host/utils/local-storage-keys';

import { createJWT, testRealmSecretSeed, visitOperatorMode } from '../helpers';
import { setupDashboardTest } from '../helpers/dashboard';

import { assertRecentFileURLs } from '../helpers/recent-files-cards';

const ownedRealmURL = 'http://test-realm/testuser/owned-workspace/';
const sharedRealmURL = 'http://test-realm/otheruser/shared-workspace/';
const delegatedOwnerRealmURL =
  'http://test-realm/otheruser/delegated-owner-workspace/';

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

module('Acceptance | dashboard delete', function (hooks) {
  setupDashboardTest(hooks, {
    matrix: {
      loggedInAs: '@testuser:localhost',
      activeRealms: [ownedRealmURL, sharedRealmURL, delegatedOwnerRealmURL],
    },
    realms: [
      {
        url: ownedRealmURL,
        name: 'Owned Workspace',
        contents: {
          'index.json': cardsGridIndex,
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
      },
      {
        url: sharedRealmURL,
        name: 'Shared Workspace',
        permissions: {
          '@testuser:localhost': ['read', 'write'],
          '@otheruser:localhost': ['read', 'write', 'realm-owner'],
        },
        contents: { 'index.json': cardsGridIndex },
      },
      {
        url: delegatedOwnerRealmURL,
        name: 'Delegated Owner Workspace',
        permissions: {
          '@testuser:localhost': ['read', 'write', 'realm-owner'],
          '@otheruser:localhost': ['read', 'write', 'realm-owner'],
        },
        contents: { 'index.json': cardsGridIndex },
      },
    ],
  });

  hooks.afterEach(function () {
    window.localStorage.removeItem(SessionLocalStorageKey);
  });

  test('only workspaces the current user owns offer Delete Workspace', async function (assert) {
    await visitOperatorMode({ workspaceChooserOpened: true });
    assert.dom('[data-test-dashboard]').exists();

    await click(`[data-test-workspace-menu-trigger="${ownedRealmURL}"]`);
    assert
      .dom('[data-test-boxel-menu-item-text="Delete Workspace"]')
      .exists('an owned workspace offers Delete');

    await click(`[data-test-workspace-menu-trigger="${sharedRealmURL}"]`);
    assert
      .dom('[data-test-boxel-menu-item-text="Delete Workspace"]')
      .doesNotExist('a workspace the user does not own has no Delete');
    assert
      .dom('[data-test-boxel-menu-item-text="Realm Settings"]')
      .exists('the rest of the menu still renders for non-owners');

    await click(
      `[data-test-workspace-menu-trigger="${delegatedOwnerRealmURL}"]`,
    );
    assert
      .dom('[data-test-boxel-menu-item-text="Delete Workspace"]')
      .exists('a workspace the user co-owns offers Delete');
  });

  test('deleting an owned workspace removes it, its session and its recent files, and keeps the dashboard open', async function (assert) {
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

    assert
      .dom('[data-test-workspace-list] [data-test-workspace="Owned Workspace"]')
      .exists();
    assertRecentFileURLs(assert, recentFilesService.recentFiles, [
      `${ownedRealmURL}Person/1.json`,
      `${ownedRealmURL}person.gts`,
      `${sharedRealmURL}index.json`,
    ]);

    await click(`[data-test-workspace-menu-trigger="${ownedRealmURL}"]`);
    await click('[data-test-boxel-menu-item-text="Delete Workspace"]');

    await waitFor(`[data-test-delete-modal="${ownedRealmURL}"]`);
    assert.dom(`[data-test-delete-modal="${ownedRealmURL}"]`).exists();

    await click('[data-test-confirm-delete-button]');

    await waitUntil(
      () => !document.querySelector('[data-test-workspace="Owned Workspace"]'),
    );

    assert.dom('[data-test-workspace="Owned Workspace"]').doesNotExist();
    assert
      .dom(
        '[data-test-workspace-list] [data-test-workspace="Shared Workspace"]',
      )
      .exists();
    assert.dom('[data-test-dashboard]').exists('the dashboard stays open');
    let sessionsAfterDelete = JSON.parse(
      window.localStorage.getItem(SessionLocalStorageKey) ?? '{}',
    ) as Record<string, string>;
    assert.notOk(
      sessionsAfterDelete[ownedRealmURL],
      'the deleted realm session token is removed',
    );
    assert.ok(
      sessionsAfterDelete[sharedRealmURL],
      'the other realm session token remains',
    );
    assertRecentFileURLs(
      assert,
      recentFilesService.recentFiles,
      [`${sharedRealmURL}index.json`],
      'deleting a workspace removes its files from recent files',
    );
  });
});
