import { click } from '@ember/test-helpers';

import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';

import {
  setupLocalIndexing,
  setupOnSave,
  testRealmURL,
  setupAcceptanceTestRealm,
  visitOperatorMode,
} from '../helpers';

import { CardsGrid, setupBaseRealm } from '../helpers/base-realm';

import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';

const personCardSource = `
  import { contains, containsMany, field, linksToMany, CardDef, Component } from "https://cardstack.com/base/card-api";
  import StringField from "https://cardstack.com/base/string";

  export class Person extends CardDef {
    static displayName = 'Person';
    @field firstName = contains(StringField);
    @field lastName = contains(StringField);
    @field title = contains(StringField, {
      computeVia: function (this: Person) {
        return [this.firstName, this.lastName].filter(Boolean).join(' ');
      },
    });
    static isolated = class Isolated extends Component<typeof this> {
      <template>
          <p>Title: <@fields.title /></p>
      </template>
    };
  }
`;

module('Acceptance | host submode', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupOnSave(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [baseRealm.url, testRealmURL],
  });

  setupBaseRealm(hooks);

  let realmContents: any;

  hooks.beforeEach(function () {
    realmContents = {
      'index.json': new CardsGrid(),
      '.realm.json': {
        name: 'Test Workspace B',
        backgroundURL:
          'https://i.postimg.cc/VNvHH93M/pawel-czerwinski-Ly-ZLa-A5jti-Y-unsplash.jpg',
        iconURL: 'https://i.postimg.cc/L8yXRvws/icon.png',
        publishable: false,
      },
      'person.gts': personCardSource,
      'Person/1.json': {
        data: {
          type: 'card',
          attributes: {
            firstName: 'A',
            lastName: 'B',
          },
          meta: {
            adoptsFrom: {
              module: '../person',
              name: 'Person',
            },
          },
        },
      },
    };
  });

  module('with a realm that is not publishable', function (hooks) {
    hooks.beforeEach(async function () {
      await setupAcceptanceTestRealm({
        mockMatrixUtils,
        contents: realmContents,
      });
    });

    test('host submode is not available', async function (assert) {
      await visitOperatorMode({
        submode: 'code',
        stacks: [[{ id: `${testRealmURL}index`, format: 'isolated' }]],
      });

      await click('[data-test-submode-switcher] button');
      assert.dom('[data-test-boxel-menu-item-text="Host"]').doesNotExist();
    });

    test('visiting host submode via query parameter shows a button to interact submode', async function (assert) {
      await visitOperatorMode({
        submode: 'host',
        stacks: [[{ id: `${testRealmURL}Person/1.json`, format: 'isolated' }]],
      });

      await click('[data-test-switch-to-interact]');

      assert.dom('[data-test-submode-switcher]').hasText('Interact');
      assert.dom(`[data-test-stack-card="${testRealmURL}Person/1"]`).exists();
    });
  });

  module('with a realm that is publishable', function (hooks) {
    hooks.beforeEach(async function () {
      let publishableRealmContents = { ...realmContents };
      publishableRealmContents['.realm.json'].publishable = true;

      await setupAcceptanceTestRealm({
        mockMatrixUtils,
        contents: publishableRealmContents,
      });
    });

    test('host submode is available', async function (assert) {
      await visitOperatorMode({
        submode: 'code',
        stacks: [[{ id: `${testRealmURL}index`, format: 'isolated' }]],
      });

      await click('[data-test-submode-switcher] button');
      assert.dom('[data-test-boxel-menu-item-text="Host"]').exists();
    });

    test('search is not present', async function (assert) {
      await visitOperatorMode({
        submode: 'host',
        trail: [`${testRealmURL}Person/1.json`],
      });

      assert.dom('[data-test-open-search-field]').doesNotExist();
    });

    test('entering from interact mode stays on the same card', async function (assert) {
      await visitOperatorMode({
        submode: 'interact',
        stacks: [[{ id: `${testRealmURL}Person/1.json`, format: 'isolated' }]],
      });

      await click('[data-test-submode-switcher] button');
      await click('[data-test-boxel-menu-item-text="Host"]');
      assert
        .dom('[data-test-host-submode-card]')
        .hasAttribute(
          'data-test-host-submode-card',
          `${testRealmURL}Person/1.json`,
        )
        .exists();
    });

    test('entering from code mode shows the index card', async function (assert) {
      await visitOperatorMode({
        submode: 'code',
        codePath: `${testRealmURL}Person/1.json`,
      });

      await click('[data-test-submode-switcher] button');
      await click('[data-test-boxel-menu-item-text="Host"]');
      assert
        .dom('[data-test-host-submode-card]')
        .hasAttribute(
          'data-test-host-submode-card',
          `${testRealmURL}index.json`,
        )
        .exists();
    });
  });
});
