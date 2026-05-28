import { waitFor, click } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';

import OperatorMode from '@cardstack/host/components/operator-mode/container';

import {
  testRealmURL,
  setupLocalIndexing,
  setupIntegrationTestRealm,
  setupOperatorModeStateCleanup,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { renderComponent } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

const realmName = 'Local Workspace';
const noop = () => {};

module(
  'Integration | realm-config | routing rule instance editor',
  function (hooks) {
    setupRenderingTest(hooks);
    setupOperatorModeStateCleanup(hooks);
    setupLocalIndexing(hooks);

    let mockMatrixUtils = setupMockMatrix(hooks, {
      loggedInAs: '@testuser:localhost',
      activeRealms: [baseRealm.url, testRealmURL],
      autostart: true,
    });

    hooks.beforeEach(async function () {
      let loader = getService('loader-service').loader;
      let cardApi: typeof import('https://cardstack.com/base/card-api') =
        await loader.import(`${baseRealm.url}card-api`);
      let string: typeof import('https://cardstack.com/base/string') =
        await loader.import(`${baseRealm.url}string`);
      let cardsGrid: typeof import('https://cardstack.com/base/cards-grid') =
        await loader.import(`${baseRealm.url}cards-grid`);

      let { field, contains, CardDef } = cardApi;
      let { default: StringField } = string;
      let { CardsGrid } = cardsGrid;

      class Pet extends CardDef {
        static displayName = 'Pet';
        @field name = contains(StringField);
      }

      await setupIntegrationTestRealm({
        mockMatrixUtils,
        permissions: {
          '@testuser:localhost': ['read', 'write', 'realm-owner'],
        },
        contents: {
          'pet.gts': { Pet },
          '.realm.json': `{ "name": "${realmName}" }`,
          'Pet/mango.json': new Pet({ name: 'Mango' }),
          'index.json': new CardsGrid(),
          // RealmConfig card with one routing rule whose `instance`
          // (a linksTo) is unset, so the instance editor shows its
          // "Link" button and we can open the chooser from it.
          'realm.json': {
            data: {
              type: 'card',
              attributes: {
                hostRoutingRules: [{ path: '/docs' }],
              },
              meta: {
                adoptsFrom: {
                  module: 'https://cardstack.com/base/realm-config',
                  name: 'RealmConfig',
                },
              },
            },
          },
        },
      });

      let operatorModeStateService = getService(
        'operator-mode-state-service',
      );
      operatorModeStateService.restore({
        stacks: [[{ id: `${testRealmURL}realm`, format: 'edit' }]],
      });

      await renderComponent(
        class TestDriver extends GlimmerComponent {
          <template><OperatorMode @onClose={{noop}} /></template>
        },
      );
      await waitFor(`[data-test-stack-card="${testRealmURL}realm"]`);
    });

    test('the card chooser is locked to the consuming realm', async function (assert) {
      await click('[data-test-add-new="instance"]');
      await waitFor('[data-test-card-catalog-modal]');
      await waitFor(`[data-test-realm="${realmName}"]`);

      assert
        .dom('[data-test-realm-picker-locked="true"]')
        .exists('the realm picker is locked');
      assert
        .dom(`[data-test-realm="${realmName}"]`)
        .exists('candidates from the consuming realm are shown');
      assert
        .dom('[data-test-realm="Base Workspace"]')
        .doesNotExist('cross-realm candidates are excluded by the lock');
    });
  },
);
