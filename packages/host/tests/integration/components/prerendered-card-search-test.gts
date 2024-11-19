import {
  RenderingTestContext,
  type TestContext,
  getContext,
  render,
  waitFor,
} from '@ember/test-helpers';

import { waitUntil } from '@ember/test-helpers';

import { module, test } from 'qunit';

import {
  Loader,
  Query,
  type Realm,
  baseRealm,
} from '@cardstack/runtime-common';

import CardPrerender from '@cardstack/host/components/card-prerender';
import PrerenderedCardSearch from '@cardstack/host/components/prerendered-card-search';

import type CardService from '@cardstack/host/services/card-service';
import LoaderService from '@cardstack/host/services/loader-service';

import {
  CardDocFiles,
  TestContextWithSSE,
  lookupLoaderService,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setupServerSentEvents,
  testRealmURL,
} from '../../helpers';
import {
  CardDef,
  FieldDef,
  StringField,
  contains,
  field,
  linksTo,
  setupBaseRealm,
} from '../../helpers/base-realm';
import { setupRenderingTest } from '../../helpers/setup';

module(`Integration | prerendered-card-search`, function (hooks) {
  let loader: Loader;
  let loaderService: LoaderService;
  let testRealm: Realm;

  setupRenderingTest(hooks);
  hooks.beforeEach(function () {
    loaderService = lookupLoaderService();
    loader = loaderService.loader;
  });

  setupLocalIndexing(hooks);
  setupServerSentEvents(hooks);
  setupBaseRealm(hooks);
  hooks.beforeEach(async function (this: RenderingTestContext) {
    class PersonField extends FieldDef {
      @field firstName = contains(StringField);
      @field lastName = contains(StringField);
    }

    class Article extends CardDef {
      static displayName = 'Article';
      @field author = contains(PersonField);
    }

    class Post extends CardDef {
      static displayName = 'Post';
      @field article = linksTo(Article);
      @field title = contains(StringField);
    }

    class BlogPost extends Post {
      static displayName = 'BlogPost';
      @field article = linksTo(Article);
    }

    const BookGtsImpl = `
    import { Component, field, contains, CardDef } from 'https://cardstack.com/base/card-api';
    import { PersonField } from './person';
    export class Book extends CardDef {
      static displayName = 'Book';
      @field author = contains(PersonField);
      static fitted = class Fitted extends Component<typeof this> {
        <template>
          <div class='book'>
            {{@model.title}}
            by
            <span class="author">
              {{@model.author.firstName}}
              {{@model.author.lastName}}
            </span>
          </div>
          <style scoped>
            .book {
              background: yellow;
            }
            .author {
              color: blue;
            }
          </style>
        </template>
      };
    }
    `;

    const sampleCards: CardDocFiles = {
      'card-1.json': {
        data: {
          type: 'card',
          attributes: {
            title: 'Card 1',
            description: 'Sample book',
            author: {
              firstName: 'Cardy',
              lastName: 'Stackington Jr. III',
            },
            views: 0,
          },
          meta: {
            adoptsFrom: {
              module: `${testRealmURL}book`,
              name: 'Book',
            },
          },
        },
      },
      'card-2.json': {
        data: {
          type: 'card',
          attributes: {
            title: 'Card 2',
            author: { firstName: 'Cardy', lastName: 'Jones' },
          },
          meta: {
            adoptsFrom: {
              module: `${testRealmURL}book`,
              name: 'Book',
            },
          },
        },
      },
      'cards/1.json': {
        data: {
          type: 'card',
          attributes: {
            title: 'Card 1',
            description: 'Sample post',
            author: {
              firstName: 'Carl',
              lastName: 'Stack',
              posts: 1,
            },
            createdAt: new Date(2022, 7, 1),
            views: 10,
          },
          meta: {
            adoptsFrom: {
              module: `${testRealmURL}post`,
              name: 'Post',
            },
          },
        },
      },
      'cards/2.json': {
        data: {
          type: 'card',
          attributes: {
            title: 'Card 2',
            description: 'Sample post',
            author: {
              firstName: 'Carl',
              lastName: 'Deck',
              posts: 3,
            },
            createdAt: new Date(2022, 7, 22),
            views: 5,
          },
          meta: {
            adoptsFrom: {
              module: `${testRealmURL}article`,
              name: 'Article',
            },
          },
        },
      },
      'books/1.json': {
        data: {
          type: 'card',
          attributes: {
            author: {
              firstName: 'Mango',
              lastName: 'Abdel-Rahman',
            },
            editions: 1,
            pubDate: '2022-07-01',
          },
          meta: {
            adoptsFrom: {
              module: `${testRealmURL}book`,
              name: 'Book',
            },
          },
        },
      },
      'books/2.json': {
        data: {
          type: 'card',
          attributes: {
            author: {
              firstName: 'Van Gogh',
              lastName: 'Abdel-Rahman',
            },
            editions: 0,
            pubDate: '2023-08-01',
          },
          meta: {
            adoptsFrom: {
              module: `${testRealmURL}book`,
              name: 'Book',
            },
          },
        },
      },
      'books/3.json': {
        data: {
          type: 'card',
          attributes: {
            author: {
              firstName: 'Jackie',
              lastName: 'Aguilar',
            },
            editions: 2,
            pubDate: '2022-08-01',
          },
          meta: {
            adoptsFrom: {
              module: `${testRealmURL}book`,
              name: 'Book',
            },
          },
        },
      },
      'catalog-entry-1.json': {
        data: {
          type: 'card',
          attributes: {
            title: 'Post',
            description: 'A card that represents a blog post',
            isField: false,
            ref: {
              module: `${testRealmURL}post`,
              name: 'Post',
            },
          },
          meta: {
            adoptsFrom: {
              module: `${baseRealm.url}catalog-entry`,
              name: 'CatalogEntry',
            },
          },
        },
      },
      'catalog-entry-2.json': {
        data: {
          type: 'card',
          attributes: {
            title: 'Article',
            description: 'A card that represents an online article ',
            isField: false,
            ref: {
              module: `${testRealmURL}article`,
              name: 'Article',
            },
          },
          meta: {
            adoptsFrom: {
              module: `${baseRealm.url}catalog-entry`,
              name: 'CatalogEntry',
            },
          },
        },
      },
    };

    ({ realm: testRealm } = await setupIntegrationTestRealm({
      loader,
      contents: {
        'article.gts': { Article },
        'blog-post.gts': { BlogPost },
        'book.gts': BookGtsImpl,
        'person.gts': { PersonField },
        'post.gts': { Post },
        ...sampleCards,
      },
    }));
  });

  test(`can search for cards by using the 'eq' filter`, async function (assert) {
    let query: Query = {
      filter: {
        on: {
          module: `${testRealmURL}book`,
          name: 'Book',
        },
        eq: {
          'author.firstName': 'Cardy',
        },
      },
      sort: [
        {
          by: 'author.lastName',
          on: { module: `${testRealmURL}book`, name: 'Book' },
        },
      ],
    };
    let realms = [testRealmURL];

    await render(<template>
      <PrerenderedCardSearch
        @query={{query}}
        @format='fitted'
        @realms={{realms}}
      >
        <:loading>
          Loading...
        </:loading>
        <:response as |cards|>
          {{#each cards as |card|}}
            <div class='card-container'>
              <card.component />
            </div>
          {{/each}}
        </:response>
      </PrerenderedCardSearch>
    </template>);
    await waitFor('.card-container');
    assert.dom('.card-container').exists({ count: 2 });
    assert
      .dom('.card-container:nth-child(1)')
      .containsText('Card 2 by Cardy Jones');
    assert
      .dom('.card-container:nth-child(2)')
      .containsText('Cardy Stackington Jr. III');
    assert
      .dom('.card-container .book')
      .hasStyle({ backgroundColor: 'rgb(255, 255, 0)' });
    assert.dom('.card-container .author').hasStyle({ color: 'rgb(0, 0, 255)' });
  });

  test<TestContextWithSSE>(`refreshes when a queried realm changes`, async function (assert) {
    let query: Query = {
      filter: {
        on: {
          module: `${testRealmURL}book`,
          name: 'Book',
        },
        eq: {
          'author.firstName': 'Cardy',
        },
      },
      sort: [
        {
          by: 'author.lastName',
          on: { module: `${testRealmURL}book`, name: 'Book' },
        },
      ],
    };
    let realms = [testRealmURL];
    await render(<template>
      <PrerenderedCardSearch
        @query={{query}}
        @format='fitted'
        @realms={{realms}}
      >
        <:loading>
          Loading...
        </:loading>
        <:response as |cards|>
          {{#each cards as |card|}}
            <div class='card-container'>
              <card.component />
            </div>
          {{/each}}
        </:response>
      </PrerenderedCardSearch>

      {{! to support incremental indexing }}
      <CardPrerender />
    </template>);
    await waitFor('.card-container');
    assert.dom('.card-container').exists({ count: 2 });

    await this.expectEvents({
      assert,
      realm: testRealm,
      expectedNumberOfEvents: 2,
      callback: async () => {
        let owner = (getContext() as TestContext).owner;
        let cardService = owner.lookup('service:card-service') as CardService;
        await cardService.deleteSource(new URL(`${testRealmURL}card-2.json`));
      },
    });
    await waitUntil(() => {
      return document.querySelectorAll('.card-container').length === 1;
    });
    assert.dom('.card-container').exists({ count: 1 });
    assert
      .dom('.card-container:nth-child(1)')
      .containsText('Cardy Stackington Jr. III');
  });
});
