import { click, findAll, waitFor } from '@ember/test-helpers';

import { module, test } from 'qunit';

import {
  realmConfigCardJSON,
  setupAcceptanceTestRealm,
  setupAuthEndpoints,
  setupLocalIndexing,
  setupRealmCacheTeardown,
  setupUserSubscription,
  SYSTEM_CARD_FIXTURE_CONTENTS,
  testRealmURL,
  visitOperatorMode,
  withCachedRealmSetup,
} from '../helpers';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';

module('Acceptance | realm extensions', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupRealmCacheTeardown(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
  });

  const roadmapId = `${testRealmURL}roadmap`;

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
            name: 'Extended Realm',
            realmExtensionModules: [
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

  test("a card's menu has its realm's extension items, after the card's own items and before Delete", async function (assert) {
    await visitOperatorMode({
      stacks: [[{ id: roadmapId, format: 'isolated' }]],
    });
    await click(
      `[data-test-stack-card="${roadmapId}"] [data-test-more-options-button]`,
    );
    await waitFor('[data-test-boxel-menu-item-text="Realm Extension Item"]');

    let labels = findAll('[data-test-boxel-menu-item-text]').map((el) =>
      el.getAttribute('data-test-boxel-menu-item-text'),
    );
    assert.strictEqual(
      labels[labels.indexOf('Delete') - 1],
      'Realm Extension Item',
      labels.join(', '),
    );
  });
});
