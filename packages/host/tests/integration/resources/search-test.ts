import { getOwner } from '@ember/owner';
import type { RenderingTestContext } from '@ember/test-helpers';
import { settled, waitUntil } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import type { Loader, Query } from '@cardstack/runtime-common';
import {
  baseRealm,
  baseRRI,
  Deferred,
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
  testRRI,
} from '../../helpers';
import { setupBaseRealm } from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

import type { CardDocFiles } from '../../helpers';

class StubRealmService extends RealmService {
  realmOf(_input: URL | string) {
    return testRealmURL;
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
              module: testRRI('article'),
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
              module: testRRI('book'),
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
              module: testRRI('post'),
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
              module: testRRI('article'),
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
              module: testRRI('book'),
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
              module: testRRI('book'),
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
              module: testRRI('book'),
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
              module: testRRI('post'),
              name: 'Post',
            },
          },
          meta: {
            adoptsFrom: {
              module: baseRRI('spec'),
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
              module: testRRI('article'),
              name: 'Article',
            },
          },
          meta: {
            adoptsFrom: {
              module: baseRRI('spec'),
              name: 'Spec',
            },
          },
        },
      },
    };

    ({ realm } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        // PersonField is referenced as the `author` type by Article and
        // Book; expose it in its own module shim so lookupDefinition
        // can resolve nested paths like `author.firstName` when
        // traversing the new top-level-only Definition.fields shape.
        'person-field.gts': { PersonField },
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
          module: testRRI('book'),
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
    let originalMaybeAuthedFetchForRealms =
      realmServer.maybeAuthedFetchForRealms.bind(realmServer);
    realmServer.maybeAuthedFetchForRealms = (async (...args) => {
      fetchCalls++;
      return await originalMaybeAuthedFetchForRealms(...args);
    }) as RealmServerService['maybeAuthedFetchForRealms'];

    try {
      let query: Query = {
        filter: {
          on: {
            module: testRRI('book'),
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
      realmServer.maybeAuthedFetchForRealms = originalMaybeAuthedFetchForRealms;
    }
  });

  test(`can perform a live search for cards`, async function (assert) {
    let query: Query = {
      filter: {
        on: {
          module: testRRI('book'),
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
              module: testRRI('book'),
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
          module: testRRI('book'),
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
              module: testRRI('book'),
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
          module: testRRI('book'),
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
          on: {
            module: testRRI('book'),
            name: 'Book',
          },
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
          module: baseRRI('card-api'),
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
          module: baseRRI('card-api'),
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

  module(`in-flight search dedup`, function (innerHooks) {
    // Holds outbound `maybeAuthedFetchForRealms` calls until the test
    // releases them, so we can deterministically assert that both
    // concurrent callers entered the dedup before either fetch
    // settled.
    let releaseFetch: Deferred<void>;
    let fetchCalls: number;
    let restoreFetch: (() => void) | undefined;

    innerHooks.beforeEach(function () {
      releaseFetch = new Deferred<void>();
      fetchCalls = 0;
      let realmServer = getService('realm-server') as RealmServerService;
      let original = realmServer.maybeAuthedFetchForRealms.bind(realmServer);
      realmServer.maybeAuthedFetchForRealms = (async (...args) => {
        fetchCalls++;
        await releaseFetch.promise;
        return await original(...args);
      }) as RealmServerService['maybeAuthedFetchForRealms'];
      restoreFetch = () => {
        realmServer.maybeAuthedFetchForRealms = original;
      };
    });

    innerHooks.afterEach(function () {
      // Always release any held fetches so a failing test doesn't
      // leak pending promises into the next test.
      try {
        releaseFetch.fulfill();
      } catch {
        // already settled
      }
      restoreFetch?.();
      restoreFetch = undefined;
      (
        globalThis as unknown as { __boxelRenderContext?: boolean }
      ).__boxelRenderContext = undefined;
      storeService.clearInFlightSearch();
    });

    let bookQuery: Query = {
      filter: {
        on: {
          module: testRRI('book'),
          name: 'Book',
        },
        eq: { 'author.lastName': 'Jones' },
      },
    };

    test(`concurrent same-key store.search calls share a single fetch when inside a prerender`, async function (assert) {
      (
        globalThis as unknown as { __boxelRenderContext?: boolean }
      ).__boxelRenderContext = true;

      let p1 = storeService.search(bookQuery, [testRealmURL]);
      let p2 = storeService.search(bookQuery, [testRealmURL]);

      // Yield long enough for both calls to enter `fetchSearchDoc`
      // and consult the in-flight map; both fetches (if any) are
      // still parked on `releaseFetch.promise`.
      await new Promise((r) => setTimeout(r, 10));

      assert.strictEqual(
        fetchCalls,
        1,
        'second caller coalesces onto first in-flight fetch',
      );

      releaseFetch.fulfill();
      let [r1, r2] = await Promise.all([p1, p2]);
      assert.deepEqual(
        (r1 as { id?: string }[]).map((i) => i.id ?? null),
        (r2 as { id?: string }[]).map((i) => i.id ?? null),
        'both callers receive the same resolved instances',
      );
    });

    test(`concurrent same-key store.search calls do NOT coalesce outside a prerender`, async function (assert) {
      // __boxelRenderContext stays unset — this is the live-SPA path
      let p1 = storeService.search(bookQuery, [testRealmURL]);
      let p2 = storeService.search(bookQuery, [testRealmURL]);

      await new Promise((r) => setTimeout(r, 10));

      assert.strictEqual(
        fetchCalls,
        2,
        'both callers fire their own fetch outside the prerender gate',
      );

      releaseFetch.fulfill();
      await Promise.all([p1, p2]);
    });

    test(`different queries produce different keys and run independently inside a prerender`, async function (assert) {
      (
        globalThis as unknown as { __boxelRenderContext?: boolean }
      ).__boxelRenderContext = true;

      let otherQuery: Query = {
        filter: {
          on: {
            module: testRRI('book'),
            name: 'Book',
          },
          eq: { 'author.lastName': 'Abdel-Rahman' },
        },
      };

      let p1 = storeService.search(bookQuery, [testRealmURL]);
      let p2 = storeService.search(otherQuery, [testRealmURL]);

      await new Promise((r) => setTimeout(r, 10));

      assert.strictEqual(
        fetchCalls,
        2,
        'different filters do not coalesce even inside a prerender',
      );

      releaseFetch.fulfill();
      await Promise.all([p1, p2]);
    });

    test(`sequential same-key calls fall through after the first resolves (in-flight only, no resolved-doc cache)`, async function (assert) {
      (
        globalThis as unknown as { __boxelRenderContext?: boolean }
      ).__boxelRenderContext = true;

      // First call: release immediately so the map self-clears.
      releaseFetch.fulfill();
      await storeService.search(bookQuery, [testRealmURL]);
      assert.strictEqual(fetchCalls, 1, 'first call fetches once');

      // Second call after the in-flight slot is empty: must re-fetch
      // because this layer only dedups concurrent calls. The
      // resolved-doc cache (sibling ticket) is what closes the
      // sequential-repeat window.
      await storeService.search(bookQuery, [testRealmURL]);
      assert.strictEqual(
        fetchCalls,
        2,
        'sequential same-key call re-fetches after the first resolves',
      );
    });

    test(`clearInFlightSearch drops pending entries so new same-key callers re-fetch`, async function (assert) {
      (
        globalThis as unknown as { __boxelRenderContext?: boolean }
      ).__boxelRenderContext = true;

      let p1 = storeService.search(bookQuery, [testRealmURL]);
      await new Promise((r) => setTimeout(r, 10));
      assert.strictEqual(fetchCalls, 1, 'first fetch in-flight');

      // Simulate an invalidation event (e.g. render-route deactivate).
      storeService.clearInFlightSearch();

      let p2 = storeService.search(bookQuery, [testRealmURL]);
      await new Promise((r) => setTimeout(r, 10));
      assert.strictEqual(
        fetchCalls,
        2,
        'post-clear same-key caller fires a fresh fetch',
      );

      releaseFetch.fulfill();
      await Promise.all([p1, p2]);
    });
  });
});
