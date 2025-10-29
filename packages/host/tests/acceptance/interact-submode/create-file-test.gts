import { click } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm, specRef } from '@cardstack/runtime-common';

import {
  setupLocalIndexing,
  testRealmURL,
  setupOnSave,
  setupAcceptanceTestRealm,
  SYSTEM_CARD_FIXTURE_CONTENTS,
  visitOperatorMode,
  setupAuthEndpoints,
  setupUserSubscription,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import {
  setRecentCards,
  removeRecentCards,
} from '../../helpers/recent-files-cards';
import { setupApplicationTest } from '../../helpers/setup';

const userRealm = 'http://test-realm/user/apple-grove/';

const testRealmFiles: Record<string, any> = {
  '.realm.json': {
    name: 'Test Workspace',
    iconURL: 'https://boxel-images.boxel.ai/icons/Letter-t.png',
  },
  'pet.gts': `
    import { CardDef, Component } from "https://cardstack.com/base/card-api";
    export default class Pet extends CardDef {
      static displayName = 'Pet';
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          <span data-test-pet><@fields.title /></span>
        </template>
      }
    }
  `,
  'person.gts': `
    import { linksTo, field, CardDef } from "https://cardstack.com/base/card-api";
    import Pet from "./pet";
    export class Person extends CardDef {
      static displayName = 'Person';
      @field pet = linksTo(Pet);
    }
  `,
  'author.gts': `
    import { Component, field, contains, StringField } from 'https://cardstack.com/base/card-api';
    import { Person } from './person';
    export class Author extends Person {
      static displayName = "Author";
      @field bio = contains(StringField);
    }
  `,
  'spec/person.json': {
    data: {
      type: 'card',
      attributes: {
        title: 'Person',
        description: 'Spec for Person',
        specType: 'card',
        ref: { module: `../person`, name: 'Person' },
      },
      meta: { adoptsFrom: specRef },
    },
  },
  'Pet/mango.json': {
    data: {
      attributes: { title: 'Mango' },
      meta: {
        adoptsFrom: {
          module: `../pet`,
          name: 'default',
        },
      },
    },
  },
  'Pet/van-gogh.json': {
    data: {
      attributes: { title: 'Van Gogh' },
      meta: {
        adoptsFrom: {
          module: `../pet`,
          name: 'default',
        },
      },
    },
  },
  'Person/hassan.json': {
    data: {
      attributes: { title: 'Hassan' },
      relationships: {
        pet: {
          links: {
            self: '../Pet/mango',
          },
        },
      },
      meta: {
        adoptsFrom: {
          module: `../person`,
          name: 'Person',
        },
      },
    },
  },
  'Author/hassan.json': {
    data: {
      attributes: { title: 'Hassan' },
      relationships: {
        pet: {
          links: {
            self: '../Pet/mango',
          },
        },
      },
      meta: {
        adoptsFrom: {
          module: `../author`,
          name: 'Author',
        },
      },
    },
  },
  'Author/tom.json': {
    data: {
      attributes: { title: 'Tom' },
      relationships: {
        pet: {
          links: {
            self: '../Pet/van-gogh',
          },
        },
      },
      meta: {
        adoptsFrom: {
          module: `../author`,
          name: 'Author',
        },
      },
    },
  },
};

const userRealmFiles: Record<string, any> = {
  '.realm.json': {
    name: 'Apple Grove',
    iconURL: 'https://boxel-images.boxel.ai/icons/Letter-a.png',
  },
  'plant.gts': `
    import { CardDef, field, contains, StringField } from 'https://cardstack.com/base/card-api';
    export class Plant extends CardDef {
      static displayName = "Plant";
      @field commonName = contains(StringField);
    }
  `,
  'garden.gts': `
    import { CardDef, field, linksToMany } from 'https://cardstack.com/base/card-api';
    import { Plant } from './plant';
    export class Garden extends CardDef {
      static displayName = "Garden";
      @field plants = linksToMany(Plant);
    }
  `,

  'Garden/edible-garden.json': {
    data: {
      attributes: {
        title: 'Edible Plant Garden',
      },
      relationships: {
        'plants.0': {
          links: {
            self: '../Plant/highbush-blueberry',
          },
        },
      },
      meta: {
        adoptsFrom: {
          module: `../garden`,
          name: 'Garden',
        },
      },
    },
  },
  'Plant/highbush-blueberry.json': {
    data: {
      attributes: {
        commonName: 'Highbush Blueberry',
      },
      meta: {
        adoptsFrom: {
          module: `../plant`,
          name: 'Plant',
        },
      },
    },
  },
};

module('Acceptance | interact submode | create-file tests', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupOnSave(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [baseRealm.url, testRealmURL, userRealm],
  });
  let { setRealmPermissions, createAndJoinRoom } = mockMatrixUtils;

  hooks.beforeEach(async function () {
    let loader = getService('loader-service').loader;
    let cardsGrid: typeof import('https://cardstack.com/base/cards-grid');
    cardsGrid = await loader.import(`${baseRealm.url}cards-grid`);
    let { CardsGrid } = cardsGrid;

    await Promise.all([
      setupAcceptanceTestRealm({
        mockMatrixUtils,
        realmURL: testRealmURL,
        contents: {
          ...SYSTEM_CARD_FIXTURE_CONTENTS,
          'index.json': new CardsGrid(),
          ...testRealmFiles,
        },
      }),
      setupAcceptanceTestRealm({
        mockMatrixUtils,
        realmURL: userRealm,
        contents: {
          ...SYSTEM_CARD_FIXTURE_CONTENTS,
          'index.json': new CardsGrid(),
          ...userRealmFiles,
        },
      }),
    ]);

    createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'room-test',
    });
    setupUserSubscription();
    setupAuthEndpoints();

    getService('network').mount(
      async (req: Request) => {
        // Some tests need a simulated creation failure
        if (req.url.includes('fetch-failure')) {
          throw new Error('A deliberate fetch error');
        }
        return null;
      },
      { prepend: true },
    );
  });

  hooks.beforeEach(async function () {
    setRealmPermissions({
      [baseRealm.url]: ['read'],
      [testRealmURL]: ['read', 'write'],
      [userRealm]: ['read', 'write'],
    });
  });

  const cardDataAttr = (
    cardId: string,
    operatorModeStackIndex: number,
    cardIndexInStack: number,
  ) =>
    `[data-test-operator-mode-stack="${operatorModeStackIndex}"] [data-test-stack-card-index="${cardIndexInStack}"][data-test-stack-card="${cardId}"]`;

  async function assertCardCreated(
    assert: Assert,
    cardTypeDisplayName: string,
    expectedRealmURL: string,
    operatorModeStackIndex: number,
    cardIndexInStack: number,
  ) {
    await click('[data-test-edit-button]'); // save card to see if it will error
    const card = `[data-test-operator-mode-stack="${operatorModeStackIndex}"] [data-test-stack-card-index="${cardIndexInStack}"]`;
    assert
      .dom(`${card} [data-test-boxel-card-header-title]`)
      .containsText(cardTypeDisplayName);

    let el = document.querySelector(card);
    if (!el) {
      throw new Error('Could not find stack item');
    }
    const cardId = el.getAttribute('data-test-stack-card');
    assert.ok(
      cardId?.startsWith(expectedRealmURL),
      'new card realm is correct',
    );
  }

  test('can trigger card catalog modal to create new instance', async function (assert) {
    await visitOperatorMode({
      submode: 'interact',
      stacks: [[{ id: `${testRealmURL}index`, format: 'isolated' }]],
    });
    assert.dom(`[data-test-stack-card="${testRealmURL}index"]`).exists();
    assert.dom(`[data-test-stack-card-index]`).exists({ count: 1 });

    await click('[data-test-new-file-button]');
    await click('[data-test-boxel-menu-item-text="Choose a card type..."]');
    await click(`[data-test-select="${testRealmURL}spec/person"]`);
    await click('[data-test-card-catalog-go-button]');
    await assertCardCreated(assert, 'Person', testRealmURL, 0, 1);
    assert.dom(`[data-test-stack-card-index]`).exists({ count: 2 });
  });

  test('can trigger card catalog modal to create new instance (multiple stacks)', async function (assert) {
    await visitOperatorMode({
      submode: 'interact',
      stacks: [
        [
          { id: `${userRealm}index`, format: 'isolated' },
          { id: `${userRealm}Plant/highbush-blueberry`, format: 'isolated' },
        ],
        [
          { id: `${testRealmURL}index`, format: 'isolated' },
          { id: `${userRealm}Garden/edible-garden`, format: 'isolated' },
        ],
      ],
    });
    assert.dom(cardDataAttr(`${userRealm}index`, 0, 0)).exists();
    assert
      .dom(cardDataAttr(`${userRealm}Plant/highbush-blueberry`, 0, 1))
      .exists();
    assert.dom(cardDataAttr(`${testRealmURL}index`, 1, 0)).exists();
    assert.dom(cardDataAttr(`${userRealm}Garden/edible-garden`, 1, 1)).exists();
    assert
      .dom('[data-test-operator-mode-stack="1"] [data-test-stack-card-index]')
      .exists({ count: 2 });

    await click('[data-test-new-file-button]');
    await click('[data-test-boxel-menu-item-text="Choose a card type..."]');
    await click(`[data-test-select="${testRealmURL}spec/person"]`);
    await click('[data-test-card-catalog-go-button]');
    await assertCardCreated(assert, 'Person', testRealmURL, 1, 2);
    assert
      .dom('[data-test-operator-mode-stack="1"] [data-test-stack-card-index]')
      .exists({ count: 3 });
  });

  test('can switch to code-submode with new-file dropdown open', async function (assert) {
    await visitOperatorMode({
      submode: 'interact',
      stacks: [[{ id: `${testRealmURL}index`, format: 'isolated' }]],
    });
    assert.dom('[data-test-interact-submode]').exists();

    await click('[data-test-new-file-button]');
    await click('[data-test-boxel-menu-item-text="Open Code Mode"]');
    assert.dom('[data-test-code-submode]').exists();
    assert.dom('[data-test-interact-submode]').doesNotExist();
    assert
      .dom('[data-test-new-file-dropdown-menu]')
      .exists('New File dropdown menu is open');
  });

  test('can create instance from available recent card types', async function (assert) {
    removeRecentCards();
    setRecentCards([
      [`${testRealmURL}Pet/mango`],
      [`${testRealmURL}Pet/van-gogh`],
      [`${testRealmURL}Person/hassan`],
      [`${testRealmURL}Author/tom`],
      [`${testRealmURL}Author/hassan`],
      [`${testRealmURL}index`],
      [`${baseRealm.url}index`],
      [`${userRealm}index`],
    ]);
    await visitOperatorMode({
      submode: 'interact',
      stacks: [[{ id: `${testRealmURL}index`, format: 'isolated' }]],
    });
    await click('[data-test-new-file-button]');
    assert.dom('[data-test-boxel-menu-item]').exists({ count: 4 });
    assert
      .dom(
        '[data-test-boxel-menu-item]:nth-of-type(1) [data-test-boxel-menu-item-text="Author"]',
      )
      .exists();
    assert
      .dom(
        '[data-test-boxel-menu-item]:nth-of-type(2) [data-test-boxel-menu-item-text="Person"]',
      )
      .exists();
    assert
      .dom('[data-test-boxel-menu-item-text="Pet"]')
      .doesNotExist('Only showing last 2 card types, skipping index cards');

    // new cards will be created in current realm (has write-permission)
    await click(`[data-test-boxel-menu-item-text="Author"]`);
    await assertCardCreated(assert, 'Author', testRealmURL, 0, 1);
    assert.dom(`[data-test-stack-card-index]`).exists({ count: 2 });

    await click('[data-test-new-file-button]');
    await click(`[data-test-boxel-menu-item-text="Author"]`); // create another Author card
    await assertCardCreated(assert, 'Author', testRealmURL, 0, 2);
    assert.dom(`[data-test-stack-card-index]`).exists({ count: 3 });
  });

  test('can create instance (with recent-card type from different realm - has permissions to both)', async function (assert) {
    removeRecentCards();
    setRecentCards([
      [`${userRealm}Plant/highbush-blueberry`],
      [`${userRealm}Garden/edible-garden`],
    ]);
    await visitOperatorMode({
      submode: 'interact',
      stacks: [[{ id: `${testRealmURL}index`, format: 'isolated' }]],
    });
    await click('[data-test-new-file-button]');
    // new cards will be created in test realm (has write-permission)
    assert.dom('[data-test-boxel-menu-item]').exists({ count: 4 });
    assert
      .dom(
        '[data-test-boxel-menu-item]:nth-of-type(1) [data-test-boxel-menu-item-text="Garden"]',
      )
      .exists();
    assert
      .dom(
        '[data-test-boxel-menu-item]:nth-of-type(2) [data-test-boxel-menu-item-text="Plant"]',
      )
      .exists();

    // new cards will be created in current realm (has write-permission)
    await click(`[data-test-boxel-menu-item-text="Garden"]`);
    await assertCardCreated(assert, 'Garden', testRealmURL, 0, 1);
    assert.dom(`[data-test-stack-card-index]`).exists({ count: 2 });

    await click('[data-test-new-file-button]');
    await click(`[data-test-boxel-menu-item-text="Plant"]`);
    await assertCardCreated(assert, 'Plant', testRealmURL, 0, 2);
    assert.dom(`[data-test-stack-card-index]`).exists({ count: 3 });
  });

  test('can create local instance in stack (in readonly remote realm, card-def from readonly realm)', async function (assert) {
    removeRecentCards();
    setRecentCards([
      [`${baseRealm.url}Skill/catalog-listing`],
      [`${baseRealm.url}cards/skill`], // spec instance
      [`${baseRealm.url}index`],
    ]);
    await visitOperatorMode({
      submode: 'interact',
      stacks: [[{ id: `${baseRealm.url}index`, format: 'isolated' }]],
    });
    await click('[data-test-new-file-button]');
    assert.dom('[data-test-boxel-menu-item]').exists({ count: 4 });
    assert
      .dom(
        '[data-test-boxel-menu-item]:nth-of-type(1) [data-test-boxel-menu-item-text="Spec"]',
      )
      .exists();
    assert
      .dom(
        '[data-test-boxel-menu-item]:nth-of-type(2) [data-test-boxel-menu-item-text="Skill"]',
      )
      .exists();

    // new cards will be created in default writable user realm (does not have write-permission to base)
    await click(`[data-test-boxel-menu-item-text="Spec"]`);
    await assertCardCreated(assert, 'Spec', userRealm, 0, 1);
    assert.dom(`[data-test-stack-card-index]`).exists({ count: 2 });

    await click('[data-test-new-file-button]');
    await click(`[data-test-boxel-menu-item-text="Skill"]`);
    await assertCardCreated(assert, 'Skill', userRealm, 0, 2);
    assert.dom(`[data-test-stack-card-index]`).exists({ count: 3 });
  });

  test('can create local instance in stack (in readonly remote realm, card-def from local realm)', async function (assert) {
    removeRecentCards();
    setRecentCards([
      [`${testRealmURL}Author/tom`],
      [`${userRealm}Garden/edible-garden`],
    ]);
    await visitOperatorMode({
      submode: 'interact',
      stacks: [
        [
          { id: `${testRealmURL}index`, format: 'isolated' },
          { id: `${userRealm}Garden/edible-garden`, format: 'isolated' },
        ],
        [
          { id: `${baseRealm.url}index`, format: 'isolated' },
          { id: `${testRealmURL}Author/tom`, format: 'isolated' },
        ],
      ],
    });
    await click('[data-test-new-file-button]');
    assert.dom('[data-test-boxel-menu-item]').exists({ count: 4 });
    assert
      .dom(
        '[data-test-boxel-menu-item]:nth-of-type(1) [data-test-boxel-menu-item-text="Garden"]',
      )
      .exists();
    assert
      .dom(
        '[data-test-boxel-menu-item]:nth-of-type(2) [data-test-boxel-menu-item-text="Author"]',
      )
      .exists();

    // expecting new cards to be created in default user writable realm, in the right-most stack
    await click(`[data-test-boxel-menu-item-text="Garden"]`);
    await assertCardCreated(assert, 'Garden', userRealm, 1, 2);
    assert
      .dom(`[data-test-operator-mode-stack="1"] [data-test-stack-card-index]`)
      .exists({ count: 3 });

    await click('[data-test-new-file-button]');
    await click(`[data-test-boxel-menu-item-text="Author"]`);
    await assertCardCreated(assert, 'Author', userRealm, 1, 3);
    assert
      .dom(`[data-test-operator-mode-stack="1"] [data-test-stack-card-index]`)
      .exists({ count: 4 });
    assert
      .dom(`[data-test-operator-mode-stack="0"] [data-test-stack-card-index]`)
      .exists({ count: 2 });
  });
});
