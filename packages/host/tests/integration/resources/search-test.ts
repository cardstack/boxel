import { getOwner } from '@ember/owner';
import { RenderingTestContext } from '@ember/test-helpers';

import { module, test } from 'qunit';

import {
  Loader,
  Query,
  baseRealm,
  type Realm,
  type LooseSingleCardDocument,
} from '@cardstack/runtime-common';

import { Search } from '@cardstack/host/resources/search';

import LoaderService from '@cardstack/host/services/loader-service';

import RealmService from '@cardstack/host/services/realm';

import {
  CardDocFiles,
  lookupLoaderService,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
  setupServerSentEvents,
  type TestContextWithSSE,
} from '../../helpers';
import { setupBaseRealm } from '../../helpers/base-realm';
import { setupRenderingTest } from '../../helpers/setup';

class StubRealmService extends RealmService {
  realmOfURL(_url: URL) {
    return new URL(testRealmURL);
  }
}

module(`Integration | search resource`, function (hooks) {
  let loader: Loader;
  let loaderService: LoaderService;
  let realm: Realm;
  let cardApi: typeof import('https://cardstack.com/base/card-api');
  let string: typeof import('https://cardstack.com/base/string');

  setupRenderingTest(hooks);
  hooks.beforeEach(function () {
    getOwner(this)!.register('service:realm', StubRealmService);
    loaderService = lookupLoaderService();
    loader = loaderService.loader;
  });

  setupLocalIndexing(hooks);
  setupServerSentEvents(hooks);
  setupBaseRealm(hooks);
  hooks.beforeEach(async function (this: RenderingTestContext) {
    cardApi = await loader.import(`${baseRealm.url}card-api`);
    string = await loader.import(`${baseRealm.url}string`);

    let { contains, field, CardDef, FieldDef, linksTo } = cardApi;
    let { default: StringField } = string;

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

    class Book extends CardDef {
      static displayName = 'Book';
      @field author = contains(PersonField);
    }

    const sampleCards: CardDocFiles = {
      'card-1.json': {
        data: {
          type: 'card',
          attributes: {
            title: 'Card 1',
            description: 'Sample post',
            author: {
              firstName: 'Cardy',
              lastName: 'Stackington Jr. III',
            },
            views: 0,
          },
          meta: {
            adoptsFrom: {
              module: `${testRealmURL}article`,
              name: 'Article',
            },
          },
        },
      },
      'card-2.json': {
        data: {
          type: 'card',
          attributes: {
            author: { firstName: 'Cardy', lastName: 'Jones' },
            editions: 1,
            pubDate: '2023-09-01',
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
      'boxel-spec-1.json': {
        data: {
          type: 'card',
          attributes: {
            title: 'Post',
            description: 'A card that represents a blog post',
            specType: 'card',
            ref: {
              module: `${testRealmURL}post`,
              name: 'Post',
            },
          },
          meta: {
            adoptsFrom: {
              module: `${baseRealm.url}boxel-spec`,
              name: 'BoxelSpec',
            },
          },
        },
      },
      'boxel-spec-2.json': {
        data: {
          type: 'card',
          attributes: {
            title: 'Article',
            description: 'A card that represents an online article ',
            specType: 'card',
            ref: {
              module: `${testRealmURL}article`,
              name: 'Article',
            },
          },
          meta: {
            adoptsFrom: {
              module: `${baseRealm.url}boxel-spec`,
              name: 'BoxelSpec',
            },
          },
        },
      },
    };

    ({ realm } = await setupIntegrationTestRealm({
      loader,
      contents: {
        'article.gts': { Article },
        'blog-post.gts': { BlogPost },
        'book.gts': { Book },
        'post.gts': { Post },
        ...sampleCards,
      },
    }));
  });

  test(`can search for card instances by using the 'eq' filter`, async function (assert) {
    let query: Query = {
      filter: {
        on: {
          module: `${testRealmURL}book`,
          name: 'Book',
        },
        eq: {
          'author.lastName': 'Jones',
        },
      },
    };
    let search = Search.from(loaderService, () => ({
      named: {
        query,
        realms: [testRealmURL],
      },
    })) as Search;
    await search.loaded;
    assert.strictEqual(search.instances[0].id, `${testRealmURL}card-2`);
    assert.strictEqual(search.instances[0].constructor.name, 'Book');
  });

  test<TestContextWithSSE>(`can perform a live search for cards`, async function (assert) {
    let query: Query = {
      filter: {
        on: {
          module: `${testRealmURL}book`,
          name: 'Book',
        },
        eq: {
          'author.lastName': 'Abdel-Rahman',
        },
      },
    };
    let search = Search.from(loaderService, () => ({
      named: {
        query,
        realms: [testRealmURL],
        isLive: true,
      },
    })) as Search;
    await search.loaded;
    assert.strictEqual(search.instances.length, 2);
    assert.strictEqual(search.instances[0].id, `${testRealmURL}books/1`);
    assert.strictEqual(search.instances[1].id, `${testRealmURL}books/2`);

    let expectedEvents = [
      {
        type: 'index',
        data: {
          type: 'incremental-index-initiation',
          realmURL: testRealmURL,
          updatedFile: `${testRealmURL}book/3`,
        },
      },
      {
        type: 'index',
        data: {
          type: 'incremental',
          invalidations: [`${testRealmURL}book/3`],
        },
      },
    ];
    await this.expectEvents({
      assert,
      realm,
      expectedEvents,
      callback: async () => {
        await realm.write(
          'books/3.json',
          JSON.stringify({
            data: {
              type: 'card',
              attributes: {
                author: {
                  firstName: 'Paper',
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
          } as LooseSingleCardDocument),
        );
      },
    });

    await search.loaded;
    assert.strictEqual(search.instances.length, 3);
    assert.strictEqual(search.instances[0].id, `${testRealmURL}books/1`);
    assert.strictEqual(search.instances[1].id, `${testRealmURL}books/2`);
    assert.strictEqual(search.instances[2].id, `${testRealmURL}books/3`);
  });

  test<TestContextWithSSE>(`cards in search results live update`, async function (assert) {
    let query: Query = {
      filter: {
        on: {
          module: `${testRealmURL}book`,
          name: 'Book',
        },
        eq: {
          'author.lastName': 'Abdel-Rahman',
        },
      },
    };
    let search = Search.from(loaderService, () => ({
      named: {
        query,
        realms: [testRealmURL],
        isLive: true,
      },
    })) as Search;
    await search.loaded;
    assert.strictEqual(search.instances.length, 2);
    assert.strictEqual((search.instances[0] as any).author.firstName, `Mango`);

    let expectedEvents = [
      {
        type: 'index',
        data: {
          type: 'incremental-index-initiation',
          realmURL: testRealmURL,
          updatedFile: `${testRealmURL}book/1`,
        },
      },
      {
        type: 'index',
        data: {
          type: 'incremental',
          invalidations: [`${testRealmURL}book/1`],
        },
      },
    ];

    await this.expectEvents({
      assert,
      realm,
      expectedEvents,
      callback: async () => {
        await realm.write(
          'books/1.json',
          JSON.stringify({
            data: {
              type: 'card',
              attributes: {
                author: {
                  firstName: 'Mang Mang',
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
          } as LooseSingleCardDocument),
        );
      },
    });
    await search.loaded;
    assert.strictEqual(search.instances.length, 2);
    assert.strictEqual(
      (search.instances[0] as any).author.firstName,
      `Mang Mang`,
    );
  });
});
