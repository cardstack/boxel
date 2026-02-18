import { getOwner } from '@ember/owner';
import type { RenderingTestContext } from '@ember/test-helpers';
import { settled, waitUntil } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import type { Loader, Query } from '@cardstack/runtime-common';
import {
  baseRealm,
  isFileDefInstance,
  type Realm,
  type LooseSingleCardDocument,
} from '@cardstack/runtime-common';

import type { Args as SearchResourceArgs } from '@cardstack/host/resources/search';
import { SearchResource } from '@cardstack/host/resources/search';

import type LoaderService from '@cardstack/host/services/loader-service';
import RealmService from '@cardstack/host/services/realm';
import type RealmServerService from '@cardstack/host/services/realm-server';
import type StoreService from '@cardstack/host/services/store';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
} from '../../helpers';
import { setupBaseRealm } from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

import type { CardDocFiles } from '../../helpers';

class StubRealmService extends RealmService {
  realmOfURL(_url: URL) {
    return new URL(testRealmURL);
  }
}

function getSearchResourceForTest(
  owner: object,
  args: () => SearchResourceArgs,
) {
  return SearchResource.from(owner, args) as unknown as Omit<
    SearchResource,
    'loaded'
  > & {
    // we expose the private loaded promise just for our tests
    loaded: Promise<void>;
  };
}

module(`Integration | search resource`, function (hooks) {
  let loader: Loader;
  let loaderService: LoaderService;
  let storeService: StoreService;
  let realm: Realm;
  let cardApi: typeof import('https://cardstack.com/base/card-api');
  let string: typeof import('https://cardstack.com/base/string');

  setupRenderingTest(hooks);
  hooks.beforeEach(function () {
    getOwner(this)!.register('service:realm', StubRealmService);
    loaderService = getService('loader-service');
    loader = loaderService.loader;
    storeService = getService('store');
  });

  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [baseRealm.url, testRealmURL],
    autostart: true,
  });
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
      @field cardTitle = contains(StringField);
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
            cardTitle: 'Card 1',
            cardDescription: 'Sample post',
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

    ({ realm } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'article.gts': { Article },
        'blog-post.gts': { BlogPost },
        'book.gts': { Book },
        'post.gts': { Post },
        ...sampleCards,
        'files/hello.txt': 'Hello world',
        'files/notes.txt': 'Some notes',
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
    let search = getSearchResourceForTest(loaderService, () => ({
      named: {
        query,
        realms: [testRealmURL],
        isLive: false,
        isAutoSaved: false,
        storeService,
        owner: this.owner,
      },
    }));
    await search.loaded;
    assert.strictEqual(search.instances[0].id, `${testRealmURL}card-2`);
    assert.strictEqual(search.instances[0].constructor.name, 'Book');
  });

  test(`search is not re-run when query and realms are unchanged`, async function (assert) {
    let realmServer = getService('realm-server') as RealmServerService;
    let fetchCalls = 0;
    let originalMaybeAuthedFetch =
      realmServer.maybeAuthedFetch.bind(realmServer);
    realmServer.maybeAuthedFetch = (async (...args) => {
      fetchCalls++;
      return await originalMaybeAuthedFetch(...args);
    }) as RealmServerService['maybeAuthedFetch'];

    try {
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
      let args = {
        query,
        realms: [testRealmURL],
        isLive: false,
        isAutoSaved: false,
        storeService,
        owner: this.owner,
      } satisfies SearchResourceArgs['named'];

      let search = getSearchResourceForTest(loaderService, () => ({
        named: args,
      }));

      await search.loaded;
      assert.strictEqual(fetchCalls, 1, 'initial search performed once');

      // Re-run modify with the same args; this should short-circuit and avoid another fetch
      search.modify([], args);
      await settled();

      assert.strictEqual(
        fetchCalls,
        1,
        'search is not invoked again when query/realms are unchanged',
      );
    } finally {
      realmServer.maybeAuthedFetch = originalMaybeAuthedFetch;
    }
  });

  test(`can perform a live search for cards`, async function (assert) {
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
    let search = getSearchResourceForTest(loaderService, () => ({
      named: {
        query,
        realms: [testRealmURL],
        isLive: true,
        isAutoSaved: false,
        storeService,
        owner: this.owner,
      },
    }));
    await search.loaded;
    assert.strictEqual(search.instances.length, 2);
    assert.strictEqual(search.instances[0].id, `${testRealmURL}books/1`);
    assert.strictEqual(search.instances[1].id, `${testRealmURL}books/2`);

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

    await waitUntil(() => search.instances.length === 3);

    assert.strictEqual(search.instances.length, 3);
    assert.strictEqual(search.instances[0].id, `${testRealmURL}books/1`);
    assert.strictEqual(search.instances[1].id, `${testRealmURL}books/2`);
    assert.strictEqual(search.instances[2].id, `${testRealmURL}books/3`);
  });

  test(`cards in search results live update`, async function (assert) {
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
    let search = getSearchResourceForTest(loaderService, () => ({
      named: {
        query,
        realms: [testRealmURL],
        isLive: true,
        isAutoSaved: false,
        storeService,
        owner: this.owner,
      },
    }));
    await search.loaded;
    assert.strictEqual(search.instances.length, 2);
    assert.strictEqual((search.instances[0] as any).author.firstName, `Mango`);

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

    await search.loaded;
    await settled();

    assert.strictEqual(search.instances.length, 2);
    assert.strictEqual(
      (search.instances[0] as any).author.firstName,
      `Mang Mang`,
    );
  });

  test(`can paginate search results and returns correct meta.page.total`, async function (assert) {
    // First page with size 2
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

    let search = getSearchResourceForTest(loaderService, () => ({
      named: {
        query,
        realms: [testRealmURL],
        isLive: false,
        isAutoSaved: false,
        storeService,
        owner: this.owner,
      },
    }));

    await search.loaded;

    // First page should have 2 results
    assert.strictEqual(search.instances.length, 2);
    // Total should be 4 (all books: card-2, books/1, books/2, books/3)
    assert.strictEqual(
      search.meta.page?.total,
      4,
      'meta.page.total shows total count across all pages',
    );

    // Test second page
    query.page = { number: 1, size: 2 };
    search = getSearchResourceForTest(loaderService, () => ({
      named: {
        query,
        realms: [testRealmURL],
        isLive: false,
        isAutoSaved: false,
        storeService,
        owner: this.owner,
      },
    }));

    await search.loaded;

    // Second page should have 2 results (the remaining books)
    assert.strictEqual(search.instances.length, 2);
    // Total should still be 4
    assert.strictEqual(
      search.meta.page?.total,
      4,
      'meta.page.total consistent across pages',
    );

    // Test empty page
    query.page = { number: 2, size: 2 };
    search = getSearchResourceForTest(loaderService, () => ({
      named: {
        query,
        realms: [testRealmURL],
        isLive: false,
        isAutoSaved: false,
        storeService,
        owner: this.owner,
      },
    }));

    await search.loaded;

    // Third page should have no results
    assert.strictEqual(search.instances.length, 0);
    // Total should still be 4
    assert.strictEqual(
      search.meta.page?.total,
      4,
      'meta.page.total remains correct on empty page',
    );
  });

  test(`can search for file-meta instances using SearchResource`, async function (assert) {
    let query: Query = {
      filter: {
        type: {
          module: `${baseRealm.url}file-api`,
          name: 'FileDef',
        },
      },
    };
    let search = getSearchResourceForTest(loaderService, () => ({
      named: {
        query,
        realms: [testRealmURL],
        isLive: false,
        isAutoSaved: false,
        storeService,
        owner: this.owner,
      },
    }));
    await search.loaded;

    assert.ok(search.instances.length >= 2, 'returns file-meta instances');
    let ids = search.instances.map((i) => i.id);
    assert.ok(
      ids.includes(`${testRealmURL}files/hello.txt`),
      'hello.txt is in results',
    );
    assert.ok(
      ids.includes(`${testRealmURL}files/notes.txt`),
      'notes.txt is in results',
    );
    for (let instance of search.instances) {
      assert.ok(
        isFileDefInstance(instance),
        `${instance.id} is a FileDef instance`,
      );
    }
  });

  test(`can perform a live search for file-meta instances`, async function (assert) {
    let query: Query = {
      filter: {
        type: {
          module: `${baseRealm.url}file-api`,
          name: 'FileDef',
        },
      },
    };
    let search = getSearchResourceForTest(loaderService, () => ({
      named: {
        query,
        realms: [testRealmURL],
        isLive: true,
        isAutoSaved: false,
        storeService,
        owner: this.owner,
      },
    }));
    await search.loaded;

    let initialCount = search.instances.length;
    assert.ok(initialCount >= 2, 'initial results include file-meta instances');

    // Write a new file to trigger a live update
    await realm.write('files/new-file.txt', 'New content');

    await waitUntil(() => search.instances.length > initialCount);

    let ids = search.instances.map((i) => i.id);
    assert.ok(
      ids.includes(`${testRealmURL}files/new-file.txt`),
      'new file appears in live search results',
    );
    assert.ok(
      isFileDefInstance(
        search.instances.find(
          (i) => i.id === `${testRealmURL}files/new-file.txt`,
        ),
      ),
      'new file is a FileDef instance',
    );
  });
});
