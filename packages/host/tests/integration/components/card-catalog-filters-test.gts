import { module, test } from 'qunit';
import GlimmerComponent from '@glimmer/component';
import { setupRenderingTest } from 'ember-qunit';
import OperatorMode from '@cardstack/host/components/operator-mode/container';
import CardPrerender from '@cardstack/host/components/card-prerender';
import { renderComponent } from '../../helpers/render-component';
import {
  testRealmURL,
  setupLocalIndexing,
  TestRealmAdapter,
  TestRealm,
} from '../../helpers';
import { waitFor, click } from '@ember/test-helpers';
import type LoaderService from '@cardstack/host/services/loader-service';
import OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

const realmName = 'Local Workspace';
let setCardInOperatorModeState: (card: string) => Promise<void>;

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
      import { Card, field, contains, linksTo } from 'https://cardstack.com/base/card-api';
      import { Author } from './author';
      export class BlogPost extends Card {
        @field title = contains(StringCard);
        @field body = contains(TextAreaCard);
        @field authorBio = linksTo(Author);
      }
    `,
    'author.gts': `
      import StringCard from 'https://cardstack.com/base/string';
      import { Card, field, contains } from 'https://cardstack.com/base/card-api';
      export class Author extends Card {
        @field firstName = contains(StringCard);
        @field lastName = contains(StringCard);
      }
    `,
    'publishing-packet.gts': `
      import { Card, field, linksTo } from 'https://cardstack.com/base/card-api';
      import { BlogPost } from './blog-post';
      export class PublishingPacket extends Card {
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

    setCardInOperatorModeState = async (cardURL: string) => {
      let operatorModeStateService = this.owner.lookup(
        'service:operator-mode-state-service',
      ) as OperatorModeStateService;

      await operatorModeStateService.restore({
        stacks: [
          [
            {
              type: 'card',
              id: cardURL,
              format: 'isolated',
            },
          ],
        ],
      });
    };
  });

  test('displays cards on cards-grid', async function (assert) {
    await setCardInOperatorModeState(`${testRealmURL}index`);
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
    assert
      .dom('[data-test-realm="Local Workspace"] [data-test-results-count]')
      .hasText('3 results');
    assert
      .dom('[data-test-realm="Local Workspace"] [data-test-card-catalog-item]')
      .exists({ count: 3 });

    await waitFor('[data-test-realm="Base Workspace"]');
    assert
      .dom('[data-test-realm="Base Workspace"] [data-test-results-count]')
      .hasText('1 result');
    assert
      .dom('[data-test-realm="Base Workspace"] [data-test-card-catalog-item]')
      .exists({ count: 1 });
  });
});
