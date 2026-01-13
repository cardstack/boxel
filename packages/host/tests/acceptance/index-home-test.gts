import { getOwner } from '@ember/owner';
import { click, visit, waitFor, waitUntil } from '@ember/test-helpers';

import { fillIn } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';
import {
  testHostModeRealmURL,
  testRealmURL,
} from '@cardstack/runtime-common/helpers/const';

import HostModeService from '@cardstack/host/services/host-mode-service';

import {
  setupAcceptanceTestRealm,
  setupAuthEndpoints,
  setupLocalIndexing,
  setupOnSave,
  setupUserSubscription,
  SYSTEM_CARD_FIXTURE_CONTENTS,
} from '../helpers';
import { setupBaseRealm } from '../helpers/base-realm';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';
import visitOperatorMode from '../helpers/visit-operator-mode';

let testHostModeRealmURLWithoutRealm = testHostModeRealmURL.replace(
  '/user/test/',
  '',
);

class StubHostModeService extends HostModeService {
  get isActive() {
    return true;
  }

  get hostModeOrigin() {
    return removeTrailingSlash(testHostModeRealmURLWithoutRealm);
  }
}

function removeTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

module('Acceptance | index card home resolution', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupOnSave(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [baseRealm.url, testRealmURL],
  });

  setupBaseRealm(hooks);
  let realmContents: any;

  hooks.beforeEach(async function () {
    let loader = getService('loader-service').loader;
    let { field, contains, CardDef, Component } = await loader.import<
      typeof import('https://cardstack.com/base/card-api')
    >(`${baseRealm.url}card-api`);
    let { default: StringField } = await loader.import<
      typeof import('https://cardstack.com/base/string')
    >(`${baseRealm.url}string`);

    class Pet extends CardDef {
      static displayName = 'Pet';
      @field name = contains(StringField);
      @field cardTitle = contains(StringField, {
        computeVia(this: Pet) {
          return this.name;
        },
      });
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <div data-test-pet-isolated={{@model.name}}>
            <@fields.name />
          </div>
        </template>
      };
    }

    realmContents = {
      ...SYSTEM_CARD_FIXTURE_CONTENTS,
      'pet.gts': { Pet },
      'cards-grid.json': {
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
      'Pet/mango.json': {
        data: {
          attributes: {
            name: 'Mango',
          },
          meta: {
            adoptsFrom: {
              module: `../pet`,
              name: 'Pet',
            },
          },
        },
      },
      'Pet/peanut.json': {
        data: {
          attributes: {
            name: 'Peanut',
          },
          meta: {
            adoptsFrom: {
              module: `../pet`,
              name: 'Pet',
            },
          },
        },
      },
      'index.json': {
        data: {
          type: 'card',
          meta: {
            adoptsFrom: {
              module: 'https://cardstack.com/base/index',
              name: 'IndexCard',
            },
          },
          relationships: {
            cardsGrid: {
              links: {
                self: './cards-grid',
              },
            },
            interactHome: {
              links: {
                self: './Pet/mango',
              },
            },
            hostHome: {
              links: {
                self: './Pet/peanut',
              },
            },
          },
        },
      },
      '.realm.json': {
        publishable: true,
        name: 'Index Home Workspace',
        hostHome: `${testRealmURL}site`,
      },
    };
  });

  module('host mode', function (hooks) {
    let { setActiveRealms, setExpiresInSec, createAndJoinRoom } =
      mockMatrixUtils;

    hooks.beforeEach(async function () {
      createAndJoinRoom({
        sender: '@testuser:localhost',
        name: 'room-test',
      });
      setupUserSubscription();
      setupAuthEndpoints();

      let contents = {
        ...realmContents,
        '.realm.json': {
          ...(realmContents['.realm.json'] as any),
        },
      };
      setExpiresInSec(60 * 60);
      await setupAcceptanceTestRealm({
        realmURL: testHostModeRealmURL,
        mockMatrixUtils,
        contents,
        permissions: {
          '*': ['read'],
        },
      });

      setActiveRealms([testHostModeRealmURL]);
    });

    hooks.beforeEach(function (this) {
      getOwner(this)!.register(
        'service:host-mode-service',
        StubHostModeService,
      );
    });

    test('host mode renders hostHome', async function (assert) {
      await visit(`/user/test/`);

      assert
        .dom(`[data-test-host-mode-card="${testHostModeRealmURL}index"]`)
        .exists();
      assert
        .dom(`[data-test-card="${testHostModeRealmURL}Pet/peanut"]`)
        .exists();
    });
  });

  module('operator submodes', function (hooks) {
    hooks.beforeEach(async function () {
      await setupAcceptanceTestRealm({
        mockMatrixUtils,
        contents: realmContents,
      });
    });

    test('interact submode uses interactHome', async function (assert) {
      await visitOperatorMode({
        submode: 'interact',
        stacks: [
          [
            {
              id: `${testRealmURL}index`,
              format: 'isolated',
            },
          ],
        ],
      });

      assert.dom(`[data-test-stack-card="${testRealmURL}index"]`).exists();
      assert
        .dom(`[data-test-card="http://test-realm/test/Pet/mango"]`)
        .exists();

      // default to cardsGrid if interactHome is not set
      await click(
        `[data-test-stack-card="${testRealmURL}index"] [data-test-edit-button]`,
      );
      await click(
        `[data-test-links-to-editor="interactHome"] [data-test-remove-card]`,
      );
      await click(
        `[data-test-stack-card="${testRealmURL}index"] [data-test-edit-button]`,
      );
      assert.dom(`[data-test-card="${testRealmURL}cards-grid"]`).exists();
      assert
        .dom(`[data-cards-grid-item="${testRealmURL}index"]`)
        .doesNotExist();
      assert
        .dom(`[data-cards-grid-item="${testRealmURL}cards-grid"]`)
        .doesNotExist();
    });

    test('host submode uses hostHome and updates after edit', async function (assert) {
      await visitOperatorMode({
        submode: 'host',
        trail: [`${testRealmURL}index`],
        stacks: [
          [
            {
              id: `${testRealmURL}index`,
              format: 'isolated',
            },
          ],
        ],
      });

      assert.dom(`[data-test-host-mode-card="${testRealmURL}index"]`).exists();
      assert.dom(`[data-test-card="${testRealmURL}Pet/peanut"]`).exists();

      // Switch to interact to edit index card
      await click('[data-test-submode-switcher] > [data-test-boxel-button]');
      await click('[data-test-boxel-menu-item-text="Interact"]');
      await waitFor(`[data-test-stack-card="${testRealmURL}index"]`);
      await click(
        `[data-test-stack-card="${testRealmURL}index"] [data-test-edit-button]`,
      );

      await click(
        `[data-test-links-to-editor="hostHome"] [data-test-remove-card]`,
      );
      await waitFor(
        `[data-test-links-to-editor="hostHome"] [data-test-add-new]`,
      );

      await click(`[data-test-links-to-editor="hostHome"] [data-test-add-new]`);
      await waitFor('[data-test-card-catalog-modal]');
      await fillIn('[data-test-search-field]', 'Mango');
      await click(`[data-test-card-catalog-item="${testRealmURL}Pet/mango"]`);
      await click('[data-test-card-catalog-go-button]');
      await waitUntil(
        () => !document.querySelector('[data-test-card-catalog-modal]'),
      );
      await waitFor(
        `[data-test-links-to-editor="hostHome"] [data-test-card="${testRealmURL}Pet/mango"]`,
      );

      await click(
        `[data-test-stack-card="${testRealmURL}index"] [data-test-edit-button]`,
      );

      await click('[data-test-submode-switcher] > [data-test-boxel-button]');
      await click('[data-test-boxel-menu-item-text="Host"]');
      await waitFor('[data-test-submode-switcher="host"]');
      assert.dom(`[data-test-host-mode-card="${testRealmURL}index"]`).exists();
      assert.dom(`[data-test-card="${testRealmURL}Pet/mango"]`).exists();
    });
  });
});
