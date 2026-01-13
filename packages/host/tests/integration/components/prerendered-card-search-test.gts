import type { RenderingTestContext } from '@ember/test-helpers';
import { render, waitFor } from '@ember/test-helpers';

import { waitUntil } from '@ember/test-helpers';

import GlimmerComponent from '@glimmer/component';

import { getService } from '@universal-ember/test-support';
import Modifier from 'ember-modifier';
import { provide } from 'ember-provide-consume-context';
import { module, test } from 'qunit';

import type { Query } from '@cardstack/runtime-common';
import {
  baseRealm,
  type Realm,
  type LooseSingleCardDocument,
  CardContextName,
} from '@cardstack/runtime-common';

import PrerenderedCardSearch from '@cardstack/host/components/prerendered-card-search';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
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
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

import type { CardDocFiles } from '../../helpers';

interface CardContextWithModifierSignature {
  Blocks: { default: [] };
}

class TestTrackingModifier extends Modifier<{
  Args: { Named: { cardId?: string } };
}> {
  modify(element: HTMLElement, _pos: unknown[], named: { cardId?: string }) {
    if (named.cardId) {
      element.setAttribute('data-test-tracked-card-id', named.cardId);
    }
  }
}

class CardContextWithModifier extends GlimmerComponent<CardContextWithModifierSignature> {
  @provide(CardContextName)
  get context() {
    return {
      cardComponentModifier: TestTrackingModifier,
    };
  }

  <template>
    {{! template-lint-disable no-yield-only }}
    {{yield}}
  </template>
}

module(`Integration | prerendered-card-search`, function (hooks) {
  let testRealm: Realm;

  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [baseRealm.url, testRealmURL],
    autostart: true,
  });

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

    class Publisher extends CardDef {
      static displayName = 'Publisher';
      @field name = contains(StringField);
    }

    class Post extends CardDef {
      static displayName = 'Post';
      @field article = linksTo(Article);
      @field cardTitle = contains(StringField);
    }

    class BlogPost extends Post {
      static displayName = 'BlogPost';
      @field article = linksTo(Article);
    }

    const BookGtsImpl = `
    import { Component, field, contains, linksTo, CardDef, StringField } from 'https://cardstack.com/base/card-api';
    import { PersonField } from './person';
    import { Publisher } from './publisher';
    export class Book extends CardDef {
      static displayName = 'Book';
      @field cardTitle = contains(StringField);
      @field cardDescription = contains(StringField);
      @field author = contains(PersonField);
      @field publisher = linksTo(Publisher);
      static fitted = class Fitted extends Component<typeof this> {
        <template>
          <div class='book'>
            {{@model.cardTitle}}
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
            cardTitle: 'Card 1',
            cardDescription: 'Sample book',
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
            cardTitle: 'Card 2',
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
            cardTitle: 'Card 1',
            cardDescription: 'Sample post',
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
            cardTitle: 'Card 2',
            cardDescription: 'Sample post',
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
      'spec-1.json': {
        data: {
          type: 'card',
          attributes: {
            cardTitle: 'Post',
            cardDescription: 'A card that represents a blog post',
            specType: 'card',
            ref: {
              module: `${testRealmURL}post`,
              name: 'Post',
            },
          },
          meta: {
            adoptsFrom: {
              module: `${baseRealm.url}spec`,
              name: 'Spec',
            },
          },
        },
      },
      'spec-2.json': {
        data: {
          type: 'card',
          attributes: {
            cardTitle: 'Article',
            cardDescription: 'A card that represents an online article ',
            specType: 'card',
            ref: {
              module: `${testRealmURL}article`,
              name: 'Article',
            },
          },
          meta: {
            adoptsFrom: {
              module: `${baseRealm.url}spec`,
              name: 'Spec',
            },
          },
        },
      },
    };

    ({ realm: testRealm } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'article.gts': { Article },
        'blog-post.gts': { BlogPost },
        'book.gts': BookGtsImpl,
        'person.gts': { PersonField },
        'post.gts': { Post },
        'publisher.gts': { Publisher },
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
            <card.component />
          {{/each}}
        </:response>
        <:meta as |meta|>
          <div data-test-meta-page-total={{meta.page.total}}></div>
        </:meta>
      </PrerenderedCardSearch>
    </template>);
    await waitFor('#ember-testing > [data-test-boxel-card-container]');
    assert
      .dom('#ember-testing > [data-test-boxel-card-container]')
      .exists({ count: 2 });
    assert
      .dom('#ember-testing > [data-test-boxel-card-container]:nth-child(1)')
      .containsText('Card 2 by Cardy Jones');
    assert
      .dom('#ember-testing > [data-test-boxel-card-container]:nth-child(2)')
      .containsText('Cardy Stackington Jr. III');
    assert
      .dom('#ember-testing > [data-test-boxel-card-container] .book')
      .hasStyle({ backgroundColor: 'rgb(255, 255, 0)' });
    assert
      .dom('#ember-testing > [data-test-boxel-card-container] .author')
      .hasStyle({ color: 'rgb(0, 0, 255)' });
    assert
      .dom('[data-test-meta-page-total="2"]')
      .exists('meta.page.total is correct');
  });

  test('applies cardComponentModifier from card context to prerendered results', async function (this: RenderingTestContext, assert) {
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
      <CardContextWithModifier>
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
              <card.component />
            {{/each}}
          </:response>
        </PrerenderedCardSearch>
      </CardContextWithModifier>
    </template>);

    await waitUntil(
      () =>
        this.element.querySelectorAll('[data-test-tracked-card-id]').length ===
        2,
    );

    let trackedElements = Array.from(
      this.element.querySelectorAll('[data-test-tracked-card-id]'),
    ) as HTMLElement[];

    assert.strictEqual(
      trackedElements.length,
      2,
      'tracks both prerendered cards via the modifier',
    );

    let trackedIds = trackedElements.map((el) =>
      el.getAttribute('data-test-tracked-card-id'),
    );

    trackedIds.forEach((cardId) => {
      assert.ok(
        cardId?.startsWith(testRealmURL),
        'tracked card id comes from the prerendered result',
      );
    });

    assert.strictEqual(
      new Set(trackedIds).size,
      trackedIds.length,
      'tracked card ids remain unique',
    );
  });

  test(`can include last known good state for instances in error state`, async function (assert) {
    await testRealm.write(
      'card-1.json',
      JSON.stringify({
        data: {
          type: 'card',
          attributes: {
            cardTitle: 'Card 1',
            cardDescription: 'Sample book',
            author: {
              firstName: 'Cardy',
              lastName: 'Stackington Jr. III',
            },
            views: 0,
          },
          relationships: {
            publisher: {
              links: {
                self: './missing-instance',
              },
            },
          },
          meta: {
            adoptsFrom: {
              module: `${testRealmURL}book`,
              name: 'Book',
            },
          },
        },
      } as LooseSingleCardDocument),
    );

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
            <card.component />
          {{/each}}
        </:response>
        <:meta as |meta|>
          <div data-test-meta-page-total={{meta.page.total}}></div>
        </:meta>
      </PrerenderedCardSearch>
    </template>);
    await waitFor('#ember-testing > [data-test-boxel-card-container]');
    assert
      .dom('#ember-testing > [data-test-boxel-card-container]')
      .exists({ count: 2 });
    assert
      .dom('#ember-testing > [data-test-boxel-card-container]:nth-child(1)')
      .containsText('Card 2 by Cardy Jones');
    assert
      .dom(
        '#ember-testing > [data-test-boxel-card-container]:nth-child(1)[data-test-is-error]',
      )
      .doesNotExist('the result is not an instance in an error state');
    assert
      .dom('#ember-testing > [data-test-boxel-card-container]:nth-child(2)')
      .containsText('Cardy Stackington Jr. III');
    assert
      .dom(
        '#ember-testing > [data-test-boxel-card-container]:nth-child(2)[data-is-error]',
      )
      .exists('the result is an instance in an error state');
    assert
      .dom('#ember-testing > [data-test-boxel-card-container] .book')
      .hasStyle({ backgroundColor: 'rgb(255, 255, 0)' });
    assert
      .dom('#ember-testing > [data-test-boxel-card-container] .author')
      .hasStyle({ color: 'rgb(0, 0, 255)' });
    assert
      .dom('[data-test-meta-page-total="2"]')
      .exists('meta.page.total is correct even with error state');
  });

  test(`refreshes when a queried realm changes when configured to perform live search`, async function (assert) {
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
        @isLive={{true}}
      >
        <:loading>
          Loading...
        </:loading>
        <:response as |cards|>
          {{#each cards as |card|}}
            <card.component />
          {{/each}}
        </:response>
        <:meta as |meta|>
          <div data-test-meta-page-total={{meta.page.total}}></div>
        </:meta>
      </PrerenderedCardSearch>
    </template>);
    await waitFor('#ember-testing > [data-test-boxel-card-container]');
    assert
      .dom('#ember-testing > [data-test-boxel-card-container]')
      .exists({ count: 2 });
    assert
      .dom('[data-test-meta-page-total="2"]')
      .exists('initial meta.page.total is correct');

    let cardService = getService('card-service');
    await cardService.deleteSource(new URL(`${testRealmURL}card-2.json`));

    await waitUntil(() => {
      return (
        document.querySelectorAll(
          '#ember-testing > [data-test-boxel-card-container]',
        ).length === 1
      );
    });
    assert
      .dom('#ember-testing > [data-test-boxel-card-container]')
      .exists({ count: 1 });
    assert
      .dom('#ember-testing > [data-test-boxel-card-container]:nth-child(1)')
      .containsText('Cardy Stackington Jr. III');
    assert
      .dom('[data-test-meta-page-total="1"]')
      .exists('meta.page.total updated after deletion');
  });

  test(`normalizes realm URLs that are provided with a missing trailing slash`, async function (assert) {
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
    let realms = [testRealmURL.replace(/\/$/, '')];

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
            <card.component />
          {{/each}}
        </:response>
        <:meta as |meta|>
          <div data-test-meta-page-total={{meta.page.total}}></div>
        </:meta>
      </PrerenderedCardSearch>
    </template>);
    await waitFor('#ember-testing > [data-test-boxel-card-container]');
    assert
      .dom('#ember-testing > [data-test-boxel-card-container]')
      .exists({ count: 2 });
    assert
      .dom('#ember-testing > [data-test-boxel-card-container]:nth-child(1)')
      .containsText('Card 2 by Cardy Jones');
    assert
      .dom('#ember-testing > [data-test-boxel-card-container]:nth-child(2)')
      .containsText('Cardy Stackington Jr. III');
    assert
      .dom('#ember-testing > [data-test-boxel-card-container] .book')
      .hasStyle({ backgroundColor: 'rgb(255, 255, 0)' });
    assert
      .dom('#ember-testing > [data-test-boxel-card-container] .author')
      .hasStyle({ color: 'rgb(0, 0, 255)' });
    assert
      .dom('[data-test-meta-page-total="2"]')
      .exists('meta.page.total works with normalized realm URLs');
  });

  test(`can paginate search results and returns correct meta.page.total`, async function (assert) {
    let query: Query = {
      filter: {
        type: {
          module: `${testRealmURL}book`,
          name: 'Book',
        },
      },
      page: {
        number: 0,
        size: 2,
      },
      sort: [
        {
          by: 'author.firstName',
          on: { module: `${testRealmURL}book`, name: 'Book' },
          direction: 'asc',
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
            <card.component />
          {{/each}}
        </:response>
        <:meta as |meta|>
          <div data-test-meta-page-total={{meta.page.total}}></div>
        </:meta>
      </PrerenderedCardSearch>
    </template>);

    await waitFor('#ember-testing > [data-test-boxel-card-container]');

    // First page should have 2 results
    assert
      .dom('#ember-testing > [data-test-boxel-card-container]')
      .exists({ count: 2 });

    // Total should be 5 (all books: card-1, card-2, books/1, books/2, books/3)
    assert
      .dom('[data-test-meta-page-total="5"]')
      .exists('meta.page.total shows total count across all pages');

    // Test second page
    query.page = { number: 1, size: 2 };

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
            <card.component />
          {{/each}}
        </:response>
        <:meta as |meta|>
          <div data-test-meta-page-total={{meta.page.total}}></div>
        </:meta>
      </PrerenderedCardSearch>
    </template>);

    await waitFor('#ember-testing > [data-test-boxel-card-container]');

    // Second page should also have 2 results
    assert
      .dom('#ember-testing > [data-test-boxel-card-container]')
      .exists({ count: 2 });

    // Total should still be 5
    assert
      .dom('[data-test-meta-page-total="5"]')
      .exists('meta.page.total consistent across pages');

    // Test third page (should have 1 result)
    query.page = { number: 2, size: 2 };

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
            <card.component />
          {{/each}}
        </:response>
        <:meta as |meta|>
          <div data-test-meta-page-total={{meta.page.total}}></div>
        </:meta>
      </PrerenderedCardSearch>
    </template>);

    await waitFor('#ember-testing > [data-test-boxel-card-container]');

    // Third page should have 1 result (the remaining book)
    assert
      .dom('#ember-testing > [data-test-boxel-card-container]')
      .exists({ count: 1 });

    // Total should still be 5
    assert
      .dom('[data-test-meta-page-total="5"]')
      .exists('meta.page.total remains correct on last page');
  });
});
