import { click, waitFor } from '@ember/test-helpers';

import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';

import {
  setupAcceptanceTestRealm,
  setupLocalIndexing,
  SYSTEM_CARD_FIXTURE_CONTENTS,
  realmConfigCardJSON,
  testRealmURL,
  visitOperatorMode,
} from '../helpers';
import { CardsGrid, setupBaseRealm } from '../helpers/base-realm';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';

// A realm the user holds no permission on, as a user a realm's policy admits
// to its cards does, and one they may read and write.
const unreadableRealmURL = testRealmURL;
const readableRealmURL = 'http://test-realm/test2/';

const petSource = `
  import { contains, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";

  export class Pet extends CardDef {
    static displayName = 'Pet';
    @field name = contains(StringField);
    @field cardTitle = contains(StringField, {
      computeVia: function (this: Pet) {
        return this.name;
      },
    });
  }

  export class Exploding extends CardDef {
    static displayName = 'Exploding';
    @field cardTitle = contains(StringField, {
      computeVia: function () {
        throw new Error('Boom!');
      },
    });
  }
`;

function contents(name: string) {
  return {
    ...SYSTEM_CARD_FIXTURE_CONTENTS,
    'index.json': new CardsGrid(),
    'realm.json': realmConfigCardJSON({ name }),
    'pet.gts': petSource,
    'Pet/mango.json': {
      data: {
        type: 'card',
        attributes: { name: 'Mango' },
        meta: { adoptsFrom: { module: '../pet', name: 'Pet' } },
      },
    },
    'Exploding/boom.json': {
      data: {
        type: 'card',
        attributes: {},
        meta: { adoptsFrom: { module: '../pet', name: 'Exploding' } },
      },
    },
  };
}

module('Acceptance | code submode availability', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [baseRealm.url, unreadableRealmURL, readableRealmURL],
  });

  setupBaseRealm(hooks);

  hooks.beforeEach(async function () {
    await setupAcceptanceTestRealm({
      mockMatrixUtils,
      realmURL: unreadableRealmURL,
      permissions: { '@testuser:localhost': [] },
      contents: contents('Unreadable Workspace'),
    });
    await setupAcceptanceTestRealm({
      mockMatrixUtils,
      realmURL: readableRealmURL,
      permissions: { '@testuser:localhost': ['read', 'write'] },
      contents: contents('Readable Workspace'),
    });
    mockMatrixUtils.setRealmPermissions({
      [unreadableRealmURL]: [],
      [readableRealmURL]: ['read', 'write'],
    });
  });

  async function openSubmodeMenu() {
    await click('[data-test-submode-switcher] button');
    await waitFor('.submode-switcher-dropdown-menu');
  }

  test('code mode is offered on a card in a realm the user can read', async function (assert) {
    await visitOperatorMode({
      stacks: [[{ id: `${readableRealmURL}Pet/mango`, format: 'isolated' }]],
    });
    await openSubmodeMenu();
    assert.dom('[data-test-boxel-menu-item-text="Code"]').exists();
  });

  test('code mode is not offered on a card in a realm the user cannot read', async function (assert) {
    await visitOperatorMode({
      stacks: [[{ id: `${unreadableRealmURL}Pet/mango`, format: 'isolated' }]],
    });
    await waitFor(`[data-test-stack-card="${unreadableRealmURL}Pet/mango"]`);
    await openSubmodeMenu();
    assert.dom('[data-test-boxel-menu-item-text="Code"]').doesNotExist();
  });

  test('code mode is offered by the realm of the card it would open', async function (assert) {
    // Switching to code mode opens the last card of the right-most stack.
    await visitOperatorMode({
      stacks: [
        [{ id: `${readableRealmURL}Pet/mango`, format: 'isolated' }],
        [{ id: `${unreadableRealmURL}Pet/mango`, format: 'isolated' }],
      ],
    });
    await openSubmodeMenu();
    assert
      .dom('[data-test-boxel-menu-item-text="Code"]')
      .doesNotExist('not when that card is in a realm the user cannot read');

    await visitOperatorMode({
      stacks: [
        [{ id: `${unreadableRealmURL}Pet/mango`, format: 'isolated' }],
        [{ id: `${readableRealmURL}Pet/mango`, format: 'isolated' }],
      ],
    });
    await openSubmodeMenu();
    assert
      .dom('[data-test-boxel-menu-item-text="Code"]')
      .exists('but when it is in a realm the user can read');
  });

  test("a card's error offers code mode only in a realm the user can read", async function (assert) {
    await visitOperatorMode({
      stacks: [
        [{ id: `${readableRealmURL}Exploding/boom`, format: 'isolated' }],
      ],
    });
    await click('[data-test-toggle-details]');
    assert.dom('[data-test-error-details]').exists();
    assert.dom('[data-test-view-in-code-mode-button]').exists();

    await visitOperatorMode({
      stacks: [
        [{ id: `${unreadableRealmURL}Exploding/boom`, format: 'isolated' }],
      ],
    });
    await click('[data-test-toggle-details]');
    assert.dom('[data-test-error-details]').exists();
    assert.dom('[data-test-view-in-code-mode-button]').doesNotExist();
  });
});
