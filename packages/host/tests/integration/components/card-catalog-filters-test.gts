import { waitFor, click } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { setupRenderingTest } from 'ember-qunit';
import { module, test } from 'qunit';

import CardPrerender from '@cardstack/host/components/card-prerender';
import OperatorMode from '@cardstack/host/components/operator-mode/container';

import type LoaderService from '@cardstack/host/services/loader-service';
import OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import {
  testRealmURL,
  setupLocalIndexing,
  TestRealmAdapter,
  TestRealm,
} from '../../helpers';
import { renderComponent } from '../../helpers/render-component';

const realmName = 'Local Workspace';

module('Integration | card-catalog filters', function (hooks) {
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);

  let adapter = new TestRealmAdapter({
    '.realm.json': `{ "name": "${realmName}", "iconURL": "https://example-icon.test" }`,
    'index.json': {
      data: {
        type: 'card',
        attributes: {},
        meta: {
          adoptsFrom: {
            module: 'https://cardstack.com/base/cards-grid',
            name: 'CardsGrid',
          },
        },
      },
    },
    'blog-post.gts': `
      import StringCard from 'https://cardstack.com/base/string';
      import TextAreaCard from 'https://cardstack.com/base/text-area';
      import { CardDef, field, contains, linksTo } from 'https://cardstack.com/base/card-api';
      import { Author } from './author';
      export class BlogPost extends CardDef {
        @field title = contains(StringCard);
        @field body = contains(TextAreaCard);
        @field authorBio = linksTo(Author);
      }
    `,
    'author.gts': `
      import StringCard from 'https://cardstack.com/base/string';
      import { CardDef, field, contains } from 'https://cardstack.com/base/card-api';
      export class Author extends CardDef {
        @field firstName = contains(StringCard);
        @field lastName = contains(StringCard);
      }
    `,
    'publishing-packet.gts': `
      import { CardDef, field, linksTo } from 'https://cardstack.com/base/card-api';
      import { BlogPost } from './blog-post';
      export class PublishingPacket extends CardDef {
        @field blogPost = linksTo(BlogPost);
      }
    `,
    'CatalogEntry/publishing-packet.json': {
      data: {
        type: 'card',
        attributes: {
          title: 'Publishing Packet',
          description: 'Catalog entry for PublishingPacket',
          ref: {
            module: `../publishing-packet`,
            name: 'PublishingPacket',
          },
        },
        meta: {
          adoptsFrom: {
            module: 'https://cardstack.com/base/catalog-entry',
            name: 'CatalogEntry',
          },
        },
      },
    },
    'CatalogEntry/author.json': {
      data: {
        type: 'card',
        attributes: {
          title: 'Author',
          description: 'Catalog entry for Author',
          ref: {
            module: `${testRealmURL}author`,
            name: 'Author',
          },
        },
        meta: {
          adoptsFrom: {
            module: 'https://cardstack.com/base/catalog-entry',
            name: 'CatalogEntry',
          },
        },
      },
    },
    'CatalogEntry/blog-post.json': {
      data: {
        type: 'card',
        attributes: {
          title: 'BlogPost',
          description: 'Catalog entry for BlogPost',
          ref: {
            module: `${testRealmURL}blog-post`,
            name: 'BlogPost',
          },
        },
        meta: {
          adoptsFrom: {
            module: 'https://cardstack.com/base/catalog-entry',
            name: 'CatalogEntry',
          },
        },
      },
    },
  });

  let noop = () => {};

  hooks.beforeEach(async function () {
    let loader = (this.owner.lookup('service:loader-service') as LoaderService)
      .loader;
    let realm = await TestRealm.createWithAdapter(adapter, loader, this.owner);
    await realm.ready;

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
      .exists({ count: 2 }, 'All realms are shown when filters are unselected');
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
