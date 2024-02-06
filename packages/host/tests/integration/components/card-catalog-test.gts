import {
  waitFor,
  click,
  triggerKeyEvent,
  focus,
  doubleClick,
} from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { setupRenderingTest } from 'ember-qunit';
import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';

import CardPrerender from '@cardstack/host/components/card-prerender';
import OperatorMode from '@cardstack/host/components/operator-mode/container';

import type LoaderService from '@cardstack/host/services/loader-service';
import OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import {
  testRealmURL,
  setupLocalIndexing,
  setupIntegrationTestRealm,
  setupServerSentEvents,
  setupSessionsServiceMock,
} from '../../helpers';
import { setupMatrixServiceMock } from '../../helpers/mock-matrix-service';
import { renderComponent } from '../../helpers/render-component';

const realmName = 'Local Workspace';

module('Integration | card-catalog', function (hooks) {
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);
  setupServerSentEvents(hooks);
  setupMatrixServiceMock(hooks);
  setupSessionsServiceMock(hooks);

  const noop = () => {};

  hooks.beforeEach(async function () {
    let loader = (this.owner.lookup('service:loader-service') as LoaderService)
      .loader;
    let cardApi: typeof import('https://cardstack.com/base/card-api');
    let string: typeof import('https://cardstack.com/base/string');
    let textArea: typeof import('https://cardstack.com/base/text-area');
    let cardsGrid: typeof import('https://cardstack.com/base/cards-grid');
    let catalogEntry: typeof import('https://cardstack.com/base/catalog-entry');
    cardApi = await loader.import(`${baseRealm.url}card-api`);
    string = await loader.import(`${baseRealm.url}string`);
    textArea = await loader.import(`${baseRealm.url}text-area`);
    cardsGrid = await loader.import(`${baseRealm.url}cards-grid`);
    catalogEntry = await loader.import(`${baseRealm.url}catalog-entry`);

    let { field, contains, linksTo, CardDef, FieldDef } = cardApi;
    let { default: StringField } = string;
    let { default: TextAreaField } = textArea;
    let { CardsGrid } = cardsGrid;
    let { CatalogEntry } = catalogEntry;

    class Author extends CardDef {
      static displayName = 'Author';
      @field firstName = contains(StringField);
      @field lastName = contains(StringField);
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
      loader,
      contents: {
        'blog-post.gts': { BlogPost },
        'address.gts': { Address },
        'author.gts': { Author },
        'publishing-packet.gts': { PublishingPacket },
        '.realm.json': `{ "name": "${realmName}", "iconURL": "https://example-icon.test" }`,
        'index.json': new CardsGrid(),
        'CatalogEntry/publishing-packet.json': new CatalogEntry({
          title: 'Publishing Packet',
          description: 'Catalog entry for PublishingPacket',
          ref: {
            module: `../publishing-packet`,
            name: 'PublishingPacket',
          },
        }),
        'CatalogEntry/author.json': new CatalogEntry({
          title: 'Author',
          description: 'Catalog entry for Author',
          ref: {
            module: `${testRealmURL}author`,
            name: 'Author',
          },
        }),
        'CatalogEntry/blog-post.json': new CatalogEntry({
          title: 'BlogPost',
          description: 'Catalog entry for BlogPost',
          ref: {
            module: `${testRealmURL}blog-post`,
            name: 'BlogPost',
          },
        }),
        'CatalogEntry/address.json': new CatalogEntry({
          title: 'Address',
          description: 'Catalog entry for Address field',
          ref: {
            module: `${testRealmURL}address`,
            name: 'Address',
          },
        }),
      },
    });

    let operatorModeStateService = this.owner.lookup(
      'service:operator-mode-state-service',
    ) as OperatorModeStateService;

    await operatorModeStateService.restore({
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
          <CardPrerender />
        </template>
      },
    );
    await waitFor(`[data-test-stack-card="${testRealmURL}index"]`);
    await click('[data-test-create-new-card-button]');
    await waitFor('[data-test-realm="Local Workspace"]');
    await waitFor('[data-test-realm="Base Workspace"]');
  });

  module('realm filters', function () {
    test('displays all realms by default', async function (assert) {
      assert.dom('[data-test-realm]').exists({ count: 2 });
      assert
        .dom(`[data-test-realm="${realmName}"] [data-test-results-count]`)
        .hasText('3 results');
      assert
        .dom(`[data-test-realm="${realmName}"] [data-test-card-catalog-item]`)
        .exists({ count: 3 });
      assert
        .dom(`[data-test-realm="Base Workspace"] [data-test-results-count]`)
        .hasText('1 result');
      assert
        .dom('[data-test-realm="Base Workspace"] [data-test-card-catalog-item]')
        .exists({ count: 1 });
      assert.dom('[data-test-realm-filter-button]').hasText('Realm: All');

      let localResults = [
        ...document.querySelectorAll(
          '[data-test-realm="Local Workspace"] [data-test-card-catalog-item]',
        ),
      ].map((n) => n.getAttribute('data-test-card-catalog-item'));

      // note that Address field is not in the results
      assert.deepEqual(localResults, [
        'http://test-realm/test/CatalogEntry/author',
        'http://test-realm/test/CatalogEntry/blog-post',
        'http://test-realm/test/CatalogEntry/publishing-packet',
      ]);
    });

    test('can filter cards by selecting a realm', async function (assert) {
      await click('[data-test-realm-filter-button]');
      assert.dom('[data-test-boxel-menu-item]').exists({ count: 2 });
      assert.dom('[data-test-boxel-menu-item-selected]').doesNotExist(); // no realms selected

      await click(`[data-test-boxel-menu-item-text="Base Workspace"]`); // base realm is selected
      assert
        .dom('[data-test-realm-filter-button]')
        .hasText(`Realm: Base Workspace`, 'Only base realm is selected');
      assert
        .dom(`[data-test-realm="Base Workspace"] [data-test-card-catalog-item]`)
        .exists({ count: 1 });

      assert.dom(`[data-test-realm="${realmName}"]`).doesNotExist();

      await click('[data-test-realm-filter-button]');
      assert.dom('[data-test-boxel-menu-item-selected]').exists({ count: 1 });
      assert
        .dom('[data-test-boxel-menu-item-selected]')
        .hasText('Base Workspace');
    });

    test('can filter cards by selecting all realms', async function (assert) {
      await click('[data-test-realm-filter-button]');
      await click(`[data-test-boxel-menu-item-text="${realmName}"]`);
      await click('[data-test-realm-filter-button]');
      await click(`[data-test-boxel-menu-item-text="Base Workspace"]`); // all realms selected

      assert
        .dom('[data-test-realm-filter-button]')
        .hasText(`Realm: ${realmName}, Base Workspace`);
      assert
        .dom('[data-test-realm]')
        .exists({ count: 2 }, 'Both realms are selected');
      assert
        .dom(`[data-test-realm="${realmName}"] [data-test-card-catalog-item]`)
        .exists({ count: 3 });
      assert
        .dom('[data-test-realm="Base Workspace"] [data-test-card-catalog-item]')
        .exists({ count: 1 });

      await click('[data-test-realm-filter-button]');
      assert.dom('[data-test-boxel-menu-item-selected]').exists({ count: 2 });
    });

    test('can filter cards by unselecting a realm', async function (assert) {
      await click('[data-test-realm-filter-button]');
      await click(`[data-test-boxel-menu-item-text="Base Workspace"]`);
      await click('[data-test-realm-filter-button]');
      await click(`[data-test-boxel-menu-item-text="${realmName}"]`); // all realms selected
      await click('[data-test-realm-filter-button]');
      await click(`[data-test-boxel-menu-item-text="${realmName}"]`); // local realm unselected

      assert
        .dom('[data-test-realm-filter-button]')
        .hasText(`Realm: Base Workspace`);
      assert.dom(`[data-test-realm="${realmName}"]`).doesNotExist();
      assert
        .dom('[data-test-realm="Base Workspace"] [data-test-card-catalog-item]')
        .exists({ count: 1 });

      await click('[data-test-realm-filter-button]');
      assert
        .dom('[data-test-boxel-menu-item-selected]')
        .hasText('Base Workspace');
    });

    test('unselecting all realm filters displays all realms', async function (assert) {
      await click('[data-test-realm-filter-button]');
      await click(`[data-test-boxel-menu-item-text="${realmName}"]`);
      await click('[data-test-realm-filter-button]');
      await click(`[data-test-boxel-menu-item-text="Base Workspace"]`);
      assert
        .dom('[data-test-realm-filter-button]')
        .hasText(`Realm: ${realmName}, Base Workspace`); // all realms selected
      await click('[data-test-realm-filter-button]');
      await click(`[data-test-boxel-menu-item-text="Base Workspace"]`);
      await click('[data-test-realm-filter-button]');
      await click(`[data-test-boxel-menu-item-text="${realmName}"]`); // all realms unselected

      assert.dom('[data-test-realm-filter-button]').hasText('Realm: All');
      assert
        .dom('[data-test-realm]')
        .exists(
          { count: 2 },
          'All realms are shown when filters are unselected',
        );
      assert
        .dom(`[data-test-realm="${realmName}"] [data-test-card-catalog-item]`)
        .exists({ count: 3 });
      assert
        .dom('[data-test-realm="Base Workspace"] [data-test-card-catalog-item]')
        .exists({ count: 1 });

      await click('[data-test-realm-filter-button]');
      assert
        .dom('[data-test-boxel-menu-item-selected]')
        .doesNotExist('No realms are selected');
    });
  });

  module('mouse and key events', function () {
    test(`pressing enter on a card selects it and submits the selection`, async function (assert) {
      const card = `${testRealmURL}CatalogEntry/publishing-packet`;
      assert
        .dom(`[data-test-stack-card-index="0"] [data-test-boxel-header-title]`)
        .hasText('Local Workspace');
      assert.dom('[data-test-stack-card-index="1"]').doesNotExist();

      await waitFor('[data-test-card-catalog-modal]');
      await waitFor(`[data-test-select="${card}"]`);
      assert.dom(`[data-test-card-catalog-item-selected]`).doesNotExist();

      await triggerKeyEvent(`[data-test-select="${card}"]`, 'keydown', 'Enter');
      await waitFor('[data-test-card-catalog]', { count: 0 });
      await waitFor(`[data-test-stack-card-index="1"]`);
      assert
        .dom(`[data-test-stack-card-index="1"] [data-test-boxel-header-title]`)
        .hasText('Publishing Packet');
    });

    test(`can select card using mouse click and then submit selection using enter key`, async function (assert) {
      const card = `${testRealmURL}CatalogEntry/blog-post`;
      assert
        .dom(`[data-test-stack-card-index="0"] [data-test-boxel-header-title]`)
        .hasText('Local Workspace');
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
        .dom(`[data-test-stack-card-index="1"] [data-test-boxel-header-title]`)
        .hasText('Blog Post');
    });

    test(`selecting a card, then focusing on another card and pressing enter submits the focused card`, async function (assert) {
      const card1 = `${testRealmURL}CatalogEntry/blog-post`;
      const card2 = `${testRealmURL}CatalogEntry/author`;
      assert
        .dom(`[data-test-stack-card-index="0"] [data-test-boxel-header-title]`)
        .hasText('Local Workspace');
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
        .dom(`[data-test-stack-card-index="1"] [data-test-boxel-header-title]`)
        .hasText('Author');
    });

    test(`double-clicking on a card selects the card and submits the selection`, async function (assert) {
      const card = `${testRealmURL}CatalogEntry/blog-post`;
      assert
        .dom(`[data-test-stack-card-index="0"] [data-test-boxel-header-title]`)
        .hasText('Local Workspace');
      assert.dom('[data-test-stack-card-index="1"]').doesNotExist();

      await waitFor('[data-test-card-catalog-modal]');
      await waitFor(`[data-test-select="${card}"]`);
      assert.dom(`[data-test-card-catalog-item-selected]`).doesNotExist();

      await doubleClick(`[data-test-select="${card}"`);
      await waitFor('[data-test-card-catalog]', { count: 0 });
      await waitFor(`[data-test-stack-card-index="1"]`);
      assert
        .dom(`[data-test-stack-card-index="1"] [data-test-boxel-header-title]`)
        .hasText('Blog Post');
    });

    test(`pressing escape key closes the modal`, async function (assert) {
      assert
        .dom(`[data-test-stack-card-index="0"] [data-test-boxel-header-title]`)
        .hasText('Local Workspace');
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
