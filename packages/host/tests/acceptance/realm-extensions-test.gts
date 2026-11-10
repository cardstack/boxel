import { click, findAll, waitFor, waitUntil } from '@ember/test-helpers';

import { module, test } from 'qunit';

import type { LooseSingleCardDocument } from '@cardstack/runtime-common';

import {
  realmConfigCardJSON,
  setupAcceptanceTestRealm,
  setupAuthEndpoints,
  setupLocalIndexing,
  setupOnSave,
  setupRealmCacheTeardown,
  setupUserSubscription,
  SYSTEM_CARD_FIXTURE_CONTENTS,
  testRealmURL,
  visitOperatorMode,
  withCachedRealmSetup,
  type TestContextWithSave,
} from '../helpers';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';

module('Acceptance | realm extensions', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupOnSave(hooks);
  setupRealmCacheTeardown(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
  });

  const roadmapId = `${testRealmURL}roadmap`;
  const workspaceId = `${testRealmURL}index`;

  hooks.beforeEach(async function () {
    mockMatrixUtils.createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'room-test',
    });
    setupUserSubscription();
    setupAuthEndpoints();

    await withCachedRealmSetup(async () =>
      setupAcceptanceTestRealm({
        mockMatrixUtils,
        contents: {
          ...SYSTEM_CARD_FIXTURE_CONTENTS,
          'realm.json': realmConfigCardJSON({
            name: 'Extended Workspace',
            realmExtensionModules: [
              { module: '@cardstack/base/workspace', name: 'Workspace' },
              // Relative to realm.json, and not a card.
              { module: './menu-extension', name: 'MenuExtension' },
            ],
          }),
          'menu-extension.gts': `
            export class MenuExtension {
              static provideMenuItems(card, params) {
                if (params.menuContext !== 'interact') {
                  return [];
                }
                return [{ label: 'Realm Extension Item', action: () => {} }];
              }
            }
          `,
          'index.json': {
            data: {
              relationships: {
                // No such card: pinning another card must keep this link.
                'entryPoints.0': { links: { self: './missing' } },
              },
              meta: {
                adoptsFrom: {
                  module: '@cardstack/base/workspace',
                  name: 'Workspace',
                },
              },
            },
          },
          'roadmap.json': {
            data: {
              attributes: { cardInfo: { name: 'Roadmap' } },
              meta: {
                adoptsFrom: {
                  module: '@cardstack/base/card-api',
                  name: 'CardDef',
                },
              },
            },
          },
        },
      }),
    );
  });

  async function openRoadmapMenu() {
    await visitOperatorMode({
      stacks: [[{ id: roadmapId, format: 'isolated' }]],
    });
    await click(
      `[data-test-stack-card="${roadmapId}"] [data-test-more-options-button]`,
    );
    await waitFor('[data-test-boxel-menu-item-text="Pin to Workspace"]');
  }

  test("a card's menu has the items its realm's extensions provide, before Delete", async function (assert) {
    await openRoadmapMenu();

    let labels = findAll('[data-test-boxel-menu-item-text]').map((el) =>
      el.getAttribute('data-test-boxel-menu-item-text'),
    );
    assert.ok(labels.includes('Realm Extension Item'), labels.join(', '));
    assert.ok(
      labels.indexOf('Pin to Workspace') < labels.indexOf('Delete'),
      labels.join(', '),
    );
    assert.ok(
      labels.indexOf('Realm Extension Item') < labels.indexOf('Delete'),
      labels.join(', '),
    );
  });

  test("Pin to Workspace links the card from its realm's Workspace", async function (this: TestContextWithSave, assert) {
    let savedWorkspace: LooseSingleCardDocument | undefined;
    this.onSave((url, json) => {
      if (url.href === workspaceId && typeof json !== 'string') {
        savedWorkspace = json;
      }
    });

    await openRoadmapMenu();
    await click('[data-test-boxel-menu-item-text="Pin to Workspace"]');
    await waitUntil(() => savedWorkspace);

    assert.deepEqual(savedWorkspace?.data.relationships?.['entryPoints.0'], {
      links: { self: './missing' },
    });
    assert.deepEqual(savedWorkspace?.data.relationships?.['entryPoints.1'], {
      links: { self: './roadmap' },
    });
  });
});
