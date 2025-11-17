import {
  waitFor,
  click,
  triggerKeyEvent,
  focus,
  doubleClick,
} from '@ember/test-helpers';
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

module('Integration | card-catalog', function (hooks) {
  setupRenderingTest(hooks);
  setupOperatorModeStateCleanup(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [baseRealm.url, testRealmURL],
    autostart: true,
  });

  const noop = () => {};

  hooks.beforeEach(async function () {
    let loader = getService('loader-service').loader;
    let cardApi: typeof import('https://cardstack.com/base/card-api');
    let string: typeof import('https://cardstack.com/base/string');
    let textArea: typeof import('https://cardstack.com/base/text-area');
    let cardsGrid: typeof import('https://cardstack.com/base/cards-grid');
    let spec: typeof import('https://cardstack.com/base/spec');
    cardApi = await loader.import(`${baseRealm.url}card-api`);
    string = await loader.import(`${baseRealm.url}string`);
    textArea = await loader.import(`${baseRealm.url}text-area`);
    cardsGrid = await loader.import(`${baseRealm.url}cards-grid`);
    spec = await loader.import(`${baseRealm.url}spec`);

    let { field, contains, linksTo, CardDef, FieldDef } = cardApi;
    let { default: StringField } = string;
    let { default: TextAreaField } = textArea;
    let { CardsGrid } = cardsGrid;
    let { Spec } = spec;

    class Author extends CardDef {
      static displayName = 'Author';
      @field firstName = contains(StringField);
      @field lastName = contains(StringField);
    }

    class Person extends CardDef {
      static displayName = 'Person';
      @field firstName = contains(StringField);
      @field lastName = contains(StringField);
    }

    class Pet extends CardDef {
      static displayName = 'Pet';
      @field firstName = contains(StringField);
    }

    class Tree extends CardDef {
      static displayName = 'Tree';
      @field species = contains(StringField);
    }

    class BlogPost extends CardDef {
      static displayName = 'Blog Post';
      @field title = contains(StringField);
      @field body = contains(TextAreaField);
      @field authorBio = linksTo(Author);
    }

    class Address extends FieldDef {
      static displayName = 'Address';
      @field street = contains(StringField);
      @field city = contains(StringField);
      @field state = contains(StringField);
      @field zip = contains(StringField);
    }

    class PublishingPacket extends CardDef {
      static displayName = 'Publishing Packet';
      @field blogPost = linksTo(BlogPost);
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'blog-post.gts': { BlogPost },
        'address.gts': { Address },
        'author.gts': { Author },
        'person.gts': { Person },
        'pet.gts': { Pet },
        'tree.gts': { Tree },
        'publishing-packet.gts': { PublishingPacket },
        '.realm.json': `{ "name": "${realmName}", "iconURL": "https://example-icon.test" }`,
        'index.json': new CardsGrid(),
        'Spec/publishing-packet.json': new Spec({
          title: 'Publishing Packet',
          description: 'Spec for PublishingPacket',
          specType: 'card',
          ref: {
            module: `${testRealmURL}publishing-packet`,
            name: 'PublishingPacket',
          },
        }),
        'Spec/author.json': new Spec({
          title: 'Author',
          description: 'Spec for Author',
          specType: 'card',
          ref: {
            module: `${testRealmURL}author`,
            name: 'Author',
          },
        }),
        'Spec/person.json': new Spec({
          title: 'Person',
          description: 'Spec for Person',
          specType: 'card',
          ref: {
            module: `${testRealmURL}person`,
            name: 'Person',
          },
        }),
        'Spec/pet.json': new Spec({
          title: 'Pet',
          description: 'Spec for Pet',
          specType: 'card',
          ref: {
            module: `${testRealmURL}pet`,
            name: 'Pet',
          },
        }),
        'Spec/tree.json': new Spec({
          title: 'Tree',
          description: 'Spec for Tree',
          specType: 'card',
          ref: {
            module: `${testRealmURL}tree`,
            name: 'Tree',
          },
        }),
        'Spec/blog-post.json': new Spec({
          title: 'BlogPost',
          description: 'Spec for BlogPost',
          specType: 'card',
          ref: {
            module: `${testRealmURL}blog-post`,
            name: 'BlogPost',
          },
        }),
        'Spec/address.json': new Spec({
          title: 'Address',
          description: 'Spec for Address field',
          specType: 'field',
          ref: {
            module: `${testRealmURL}address`,
            name: 'Address',
          },
        }),
      },
    });

    let operatorModeStateService = getService('operator-mode-state-service');

    operatorModeStateService.restore({
      stacks: [
        [
          {
            id: `${testRealmURL}index`,
            format: 'isolated',
          },
        ],
      ],
    });
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}index"]`);
    await click('[data-test-boxel-filter-list-button="All Cards"]');
    await click('[data-test-create-new-card-button]');
    await waitFor('[data-test-realm="Local Workspace"]');
    await waitFor('[data-test-realm="Base Workspace"]');
  });

  module('realm filters', function () {
    test('displays all realms by default', async function (assert) {
      assert.dom('[data-test-realm]').exists({ count: 3 });
      assert
        .dom(`[data-test-realm="${realmName}"] [data-test-results-count]`)
        .hasText('6 results');
      assert
        .dom(`[data-test-realm="${realmName}"] [data-test-card-catalog-item]`)
        .exists({ count: 5 });
      assert
        .dom('[data-test-realm="Base Workspace"] [data-test-card-catalog-item]')
        .exists();
      assert.dom('[data-test-realm-filter-button]').hasText('Workspace: All');

      let localResults = [
        ...document.querySelectorAll(
          '[data-test-realm="Local Workspace"] [data-test-card-catalog-item]',
        ),
      ].map((n) => n.getAttribute('data-test-card-catalog-item'));

      // note that Address field is not in the results
      assert.deepEqual(localResults, [
        'http://test-realm/test/Spec/author',
        'http://test-realm/test/Spec/blog-post',
        'http://test-realm/test/Spec/person',
        'http://test-realm/test/Spec/pet',
        'http://test-realm/test/Spec/publishing-packet',
      ]);
    });

    test('can filter cards by selecting a realm', async function (assert) {
      await click('[data-test-realm-filter-button]');
      assert.dom('[data-test-boxel-menu-item]').exists({ count: 4 });
      assert.dom('[data-test-boxel-menu-item-selected]').exists({ count: 4 }); // All realms are selected by default
      assert
        .dom('[data-test-realm-filter-button]')
        .includesText('Workspace: All');

      await click(`[data-test-boxel-menu-item-text="Local Workspace"]`); // Unselect Local Workspace
      assert
        .dom('[data-test-realm-filter-button]')
        .hasText(`Workspace: Base Workspace, Cardstack Catalog, Boxel Skills`);
      assert
        .dom(`[data-test-realm="Base Workspace"] [data-test-card-catalog-item]`)
        .exists();

      assert.dom(`[data-test-realm="${realmName}"]`).doesNotExist();

      await click('[data-test-realm-filter-button]');
      assert.dom('[data-test-boxel-menu-item-selected]').exists({ count: 3 });
      assert
        .dom('[data-test-boxel-menu-item-selected]')
        .hasText('Base Workspace');
    });

    test('can paginate results from a realm', async function (assert) {
      assert
        .dom(`[data-test-realm="Base Workspace"] [data-test-show-more-cards]`)
        .exists('show pagination button for base realm');
      assert
        .dom(`[data-test-realm="${realmName}"] [data-test-show-more-cards]`)
        .exists('show pagination button for test realm');
      assert
        .dom(`[data-test-realm="${realmName}"] [data-test-show-more-cards]`)
        .containsText('Show 1 more card (1 not shown)');

      await click(
        `[data-test-realm="${realmName}"] [data-test-show-more-cards]`,
      );
      assert
        .dom(`[data-test-realm="${realmName}"] [data-test-show-more-cards]`)
        .doesNotExist("don't show pagination button for test realm");
      assert
        .dom(`[data-test-realm="${realmName}"] [data-test-card-catalog-item]`)
        .exists({ count: 6 });
      let localResults = [
        ...document.querySelectorAll(
          '[data-test-realm="Local Workspace"] [data-test-card-catalog-item]',
        ),
      ].map((n) => n.getAttribute('data-test-card-catalog-item'));
      assert.deepEqual(localResults, [
        'http://test-realm/test/Spec/author',
        'http://test-realm/test/Spec/blog-post',
        'http://test-realm/test/Spec/person',
        'http://test-realm/test/Spec/pet',
        'http://test-realm/test/Spec/publishing-packet',
        'http://test-realm/test/Spec/tree',
      ]);
    });
  });

  module('mouse and key events', function () {
    test(`pressing enter on a card selects it and submits the selection`, async function (assert) {
      const card = `${testRealmURL}Spec/publishing-packet`;
      assert
        .dom(
          `[data-test-stack-card-index="0"] [data-test-boxel-card-header-title]`,
        )
        .hasText('Workspace - Local Workspace');
      assert.dom('[data-test-stack-card-index="1"]').doesNotExist();

      await waitFor('[data-test-card-catalog-modal]');
      await waitFor(`[data-test-select="${card}"]`);
      assert.dom(`[data-test-card-catalog-item-selected]`).doesNotExist();

      await triggerKeyEvent(`[data-test-select="${card}"]`, 'keydown', 'Enter');
      await waitFor('[data-test-card-catalog]', { count: 0 });
      await waitFor(`[data-test-stack-card-index="1"]`);
      assert
        .dom(
          `[data-test-stack-card-index="1"] [data-test-boxel-card-header-title]`,
        )
        .hasText('Publishing Packet - Untitled Publishing Packet');
    });

    test(`can select card using mouse click and then submit selection using enter key`, async function (assert) {
      const card = `${testRealmURL}Spec/blog-post`;
      assert
        .dom(
          `[data-test-stack-card-index="0"] [data-test-boxel-card-header-title]`,
        )
        .hasText('Workspace - Local Workspace');
      assert.dom('[data-test-stack-card-index="1"]').doesNotExist();

      await waitFor('[data-test-card-catalog-modal]');
      await waitFor(`[data-test-select="${card}"]`);
      assert.dom(`[data-test-card-catalog-item-selected]`).doesNotExist();

      await click(`[data-test-select="${card}"`);
      assert
        .dom(`[data-test-card-catalog-item="${card}"]`)
        .hasAttribute('data-test-card-catalog-item-selected');

      await triggerKeyEvent(`[data-test-select="${card}"]`, 'keydown', 'Enter');
      await waitFor('[data-test-card-catalog]', { count: 0 });
      await waitFor(`[data-test-stack-card-index="1"]`);
      assert
        .dom(
          `[data-test-stack-card-index="1"] [data-test-boxel-card-header-title]`,
        )
        .hasText('Blog Post');
    });

    test(`selecting a card, then focusing on another card and pressing enter submits the focused card`, async function (assert) {
      const card1 = `${testRealmURL}Spec/blog-post`;
      const card2 = `${testRealmURL}Spec/author`;
      assert
        .dom(
          `[data-test-stack-card-index="0"] [data-test-boxel-card-header-title]`,
        )
        .hasText('Workspace - Local Workspace');
      assert.dom('[data-test-stack-card-index="1"]').doesNotExist();

      await waitFor('[data-test-card-catalog-modal]');
      await waitFor(`[data-test-select="${card1}"]`);
      await waitFor(`[data-test-select="${card2}"]`);
      assert.dom(`[data-test-card-catalog-item-selected]`).doesNotExist();

      await click(`[data-test-select="${card1}"`);
      assert
        .dom(`[data-test-card-catalog-item="${card1}"]`)
        .hasAttribute('data-test-card-catalog-item-selected');

      await focus(`[data-test-select="${card2}"]`);
      await triggerKeyEvent(
        `[data-test-select="${card2}"]`,
        'keydown',
        'Enter',
      );
      await waitFor('[data-test-card-catalog]', { count: 0 });
      await waitFor(`[data-test-stack-card-index="1"]`);
      assert
        .dom(
          `[data-test-stack-card-index="1"] [data-test-boxel-card-header-title]`,
        )
        .hasText('Author - Untitled Author');
    });

    test(`double-clicking on a card selects the card and submits the selection`, async function (assert) {
      const card = `${testRealmURL}Spec/blog-post`;
      assert
        .dom(
          `[data-test-stack-card-index="0"] [data-test-boxel-card-header-title]`,
        )
        .hasText('Workspace - Local Workspace');
      assert.dom('[data-test-stack-card-index="1"]').doesNotExist();

      await waitFor('[data-test-card-catalog-modal]');
      await waitFor(`[data-test-select="${card}"]`);
      assert.dom(`[data-test-card-catalog-item-selected]`).doesNotExist();

      await doubleClick(`[data-test-select="${card}"`);
      await waitFor('[data-test-card-catalog]', { count: 0 });
      await waitFor(`[data-test-stack-card-index="1"]`);
      assert
        .dom(
          `[data-test-stack-card-index="1"] [data-test-boxel-card-header-title]`,
        )
        .hasText('Blog Post');
    });

    test(`pressing escape key closes the modal`, async function (assert) {
      assert
        .dom(
          `[data-test-stack-card-index="0"] [data-test-boxel-card-header-title]`,
        )
        .hasText('Workspace - Local Workspace');
      assert.dom('[data-test-stack-card-index="1"]').doesNotExist();

      await waitFor('[data-test-card-catalog-modal]');
      await waitFor(`[data-test-select]`);

      await triggerKeyEvent(
        `[data-test-card-catalog-modal]`,
        'keydown',
        'Escape',
      );
      await waitFor('[data-test-card-catalog]', { count: 0 });
      assert.dom(`[data-test-stack-card-index="0"]`).exists();
      assert.dom('[data-test-stack-card-index="1"]').doesNotExist();
    });
  });
});
