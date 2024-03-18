import { RenderingTestContext } from '@ember/test-helpers';

import { setupRenderingTest } from 'ember-qunit';
import { module, test } from 'qunit';

import { baseRealm, Loader } from '@cardstack/runtime-common';

import type LoaderService from '@cardstack/host/services/loader-service';

import {
  suggestCardChooserTitle,
  getSuggestionWithLowestDepth,
} from '@cardstack/host/utils/text-suggestion';

import {
  testRealmURL,
  setupIntegrationTestRealm,
  setupLocalIndexing,
} from '../../helpers';

let cardApi: typeof import('https://cardstack.com/base/card-api');
let string: typeof import('https://cardstack.com/base/string');
let loader: Loader;

module('Integration | text-suggestion | card-chooser-title', function (hooks) {
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);

  hooks.beforeEach(function (this: RenderingTestContext) {
    loader = (this.owner.lookup('service:loader-service') as LoaderService)
      .loader;
  });

  hooks.beforeEach(async function () {
    cardApi = await loader.import(`${baseRealm.url}card-api`);
    string = await loader.import(`${baseRealm.url}string`);

    let { contains, field, CardDef, linksTo } = cardApi;
    let { default: StringField } = string;

    class Article extends CardDef {
      static displayName = 'Article';
      @field author = contains(StringField);
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

    class Book extends CardDef {
      static displayName = 'Book';
      @field author = contains(StringField);
    }

    class Booking extends CardDef {
      static displayName = 'Booking';
      @field booker = contains(StringField);
    }

    await setupIntegrationTestRealm({
      loader,
      contents: {
        'article.gts': { Article },
        'blog-post.gts': { BlogPost },
        'book.gts': { Book },
        'booking.gts': { Booking },
        'post.gts': { Post },
      },
    });
  });

  test('filter on', async function (assert) {
    let filter = {
      on: { module: `${testRealmURL}booking`, name: 'Booking' },
      eq: { booker: 'Arthur' },
    };
    let suggestions = await suggestCardChooserTitle(filter, 0, { loader });
    assert.deepEqual(suggestions, [
      {
        depth: 0,
        suggestion: 'Choose a Booking card',
      },
    ]);
  });

  test('filter by type', async function (assert) {
    let filter = {
      type: { module: `${testRealmURL}booking`, name: 'Booking' },
    };
    let suggestions = await suggestCardChooserTitle(filter, 0, { loader });
    assert.deepEqual(suggestions, [
      {
        depth: 0,
        suggestion: 'Choose a Booking card',
      },
    ]);
  });

  test('filter by every', async function (assert) {
    let filter = {
      every: [
        {
          on: { module: `${testRealmURL}article`, name: 'Article' },
          eq: { author: 'Kafka' },
        },
        {
          on: { module: `${testRealmURL}book`, name: 'Book' },
          eq: { author: 'Kafka' },
        },
      ],
    };
    let suggestions = await suggestCardChooserTitle(filter, 0, { loader });
    assert.deepEqual(suggestions, [
      {
        depth: 1,
        suggestion: 'Choose an Article card',
      },
      {
        depth: 1,
        suggestion: 'Choose a Book card',
      },
    ]);
  });

  test('filter by any', async function (assert) {
    let filter = {
      any: [
        {
          on: { module: `${testRealmURL}article`, name: 'Article' },
          eq: { author: 'Kafka' },
        },
        {
          on: { module: `${testRealmURL}book`, name: 'Book' },
          eq: { author: 'Kafka' },
        },
      ],
    };
    let suggestions = await suggestCardChooserTitle(filter, 0, { loader });
    assert.deepEqual(suggestions, []);
  });

  test('filter with every with type and on', async function (assert) {
    let filter = {
      every: [
        { type: { module: `${testRealmURL}booking`, name: 'Booking' } },
        {
          on: { module: `${testRealmURL}article`, name: 'Article' },
          eq: { author: 'Kafka' },
        },
        {
          on: { module: `${testRealmURL}book`, name: 'Book' },
          eq: { author: 'Kafka' },
        },
      ],
    };
    let suggestions = await suggestCardChooserTitle(filter, 0, { loader });
    assert.deepEqual(suggestions, [
      {
        depth: 1,
        suggestion: 'Choose a Booking card',
      },
      {
        depth: 1,
        suggestion: 'Choose an Article card',
      },
      {
        depth: 1,
        suggestion: 'Choose a Book card',
      },
    ]);
  });

  test('filter by not', async function (assert) {
    let filter = {
      on: { module: `${testRealmURL}article`, name: 'Article' },
      not: { eq: { author: 'Carl' } },
    };
    let suggestions = await suggestCardChooserTitle(filter, 0, { loader });
    assert.deepEqual(suggestions, [
      {
        depth: 0,
        suggestion: 'Choose an Article card',
      },
    ]);
  });

  test('filter by range', async function (assert) {
    let filter = {
      on: { module: `${testRealmURL}post`, name: 'Post' },
      range: { views: { lte: 10, gt: 5 }, 'author.posts': { gte: 1 } },
    };
    let suggestions = await suggestCardChooserTitle(filter, 0, { loader });
    assert.deepEqual(suggestions, [
      {
        depth: 0,
        suggestion: 'Choose a Post card',
      },
    ]);
  });

  test('filter by card instance', async function (assert) {
    let filter = {
      type: { module: `${baseRealm.url}card-api`, name: 'CardDef' },
    };
    let suggestions = await suggestCardChooserTitle(filter, 0, { loader });
    assert.deepEqual(suggestions, [
      {
        depth: 0,
        suggestion: 'Choose a Card instance',
      },
    ]);
  });

  test('filter -- a complex one', async function (assert) {
    let filter = {
      every: [
        {
          on: {
            module: `${testRealmURL}post`,
            name: 'Post',
          },
        },
        { eq: { title: 'Card 1' } },
        { not: { eq: { 'author.firstName': 'Cardy' } } },
      ],
      type: { module: `${baseRealm.url}card-api`, name: 'CardDef' },
    };
    let suggestions = await suggestCardChooserTitle(filter, 0, { loader });
    assert.deepEqual(suggestions, [
      {
        depth: 0,
        suggestion: 'Choose a Card instance',
      },
      {
        depth: 1,
        suggestion: 'Choose a Post card',
      },
    ]);
    assert.strictEqual(
      getSuggestionWithLowestDepth(suggestions),
      'Choose a Card instance',
    );
  });

  test('filter -- nested one that exceeds recursion depth', async function (assert) {
    let filter = {
      every: [
        {
          type: { module: `${baseRealm.url}card-api`, name: 'CardDef' },
        },
        {
          on: {
            module: `${testRealmURL}post`,
            name: 'Post',
          },
          every: [
            {
              type: {
                module: `${testRealmURL}article`,
                name: 'Article',
              },
            },
          ],
        },
      ],
    };
    let suggestions = await suggestCardChooserTitle(filter, 0, { loader });
    assert.deepEqual(suggestions, [
      {
        depth: 1,
        suggestion: 'Choose a Card instance',
      },
      {
        depth: 1,
        suggestion: 'Choose a Post card',
      },
    ]);
    assert.strictEqual(
      getSuggestionWithLowestDepth(suggestions),
      'Choose a Card instance',
    );
  });

  test('filter with on specifying multiSelect option', async function (assert) {
    let filter = {
      on: { module: `${testRealmURL}booking`, name: 'Booking' },
      eq: { booker: 'Arthur' },
    };
    let suggestions = await suggestCardChooserTitle(filter, 0, {
      loader,
      multiSelect: true,
    });
    assert.deepEqual(suggestions, [
      {
        depth: 0,
        suggestion: 'Select 1 or more Booking cards',
      },
    ]);
  });

  test('filter with on but checking for "an"', async function (assert) {
    let filter = {
      on: { module: `${testRealmURL}article`, name: 'Article' },
      eq: { author: 'Kafka' },
    };
    let suggestions = await suggestCardChooserTitle(filter, 0, { loader });
    assert.deepEqual(suggestions, [
      {
        depth: 0,
        suggestion: 'Choose an Article card',
      },
    ]);
  });

  test(`displays the right title even CodeRef is 'fieldOf' codeRef`, async function (assert) {
    let filter = {
      type: {
        card: { module: `${testRealmURL}post`, name: 'Post' },
        type: 'fieldOf',
        field: 'article',
      },
      eq: { 'post.title': 'Kafka' },
    };
    let suggestions = await suggestCardChooserTitle(filter, 0, { loader });
    assert.deepEqual(suggestions, [
      {
        depth: 0,
        suggestion: 'Choose an Article card',
      },
    ]);
  });

  test(`displays the right title even CodeRef is 'ancestorOf' codeRef`, async function (assert) {
    let filter = {
      type: {
        card: { module: `${testRealmURL}blog-post`, name: 'BlogPost' },
        type: 'ancestorOf',
      },
      eq: { 'post.title': 'Kafka' },
    };
    let suggestions = await suggestCardChooserTitle(filter, 0, { loader });
    assert.deepEqual(suggestions, [
      {
        depth: 0,
        suggestion: 'Choose a Post card',
      },
    ]);
  });
});
