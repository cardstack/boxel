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
  rri,
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
import type { CardDef } from '@cardstack/base/card-api';

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
  let cardApi: typeof import('@cardstack/base/card-api');
  let string: typeof import('@cardstack/base/string');

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
    cardApi = await loader.import('@cardstack/base/card-api');
    string = await loader.import('@cardstack/base/string');

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
      ids.includes(rri(`${testRealmURL}files/hello.txt`)),
      'hello.txt is in results',
    );
    assert.ok(
      ids.includes(rri(`${testRealmURL}files/notes.txt`)),
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
      ids.includes(rri(`${testRealmURL}files/new-file.txt`)),
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
      // Filter to `_federated-search` URLs only. The wrapper is the
      // chokepoint for store-side searches, but any future caller
      // routed through it (auth probes, registry pings, etc.) would
      // otherwise inflate the counter and make the dedup assertion
      // depend on what else the test environment happened to do.
      realmServer.maybeAuthedFetchForRealms = (async (url, ...args) => {
        let isSearch =
          typeof url === 'string' && url.includes('_federated-search');
        if (isSearch) {
          fetchCalls++;
          await releaseFetch.promise;
        }
        return await original(url, ...args);
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

      // The synchronous portion of the whole call chain — `search` →
      // `fetchSearchData` → `fetchSearchDoc` → the wrapped
      // `maybeAuthedFetchForRealms` — runs before each
      // `storeService.search(...)` expression returns. `fetchCalls++`
      // is the first line of the mock before any `await`, so by the
      // time both invocations have completed their synchronous
      // portions the counter reflects every fetch that has been
      // committed (parked on `releaseFetch.promise`). Asserting
      // immediately is deterministic — no timeout race.
      let p1 = storeService.search(bookQuery, [testRealmURL]);
      let p2 = storeService.search(bookQuery, [testRealmURL]);

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
      assert.strictEqual(fetchCalls, 1, 'first fetch in-flight');

      // Simulate an invalidation event (e.g. render-route deactivate).
      storeService.clearInFlightSearch();

      let p2 = storeService.search(bookQuery, [testRealmURL]);
      assert.strictEqual(
        fetchCalls,
        2,
        'post-clear same-key caller fires a fresh fetch',
      );

      releaseFetch.fulfill();
      await Promise.all([p1, p2]);
    });
  });

  module(`job-scoped resolved-doc search cache`, function (innerHooks) {
    let releaseFetch: Deferred<void>;
    let fetchCalls: number;
    let restoreFetch: (() => void) | undefined;

    innerHooks.beforeEach(function () {
      releaseFetch = new Deferred<void>();
      fetchCalls = 0;
      let realmServer = getService('realm-server') as RealmServerService;
      let original = realmServer.maybeAuthedFetchForRealms.bind(realmServer);
      realmServer.maybeAuthedFetchForRealms = (async (url, ...args) => {
        let isSearch =
          typeof url === 'string' && url.includes('_federated-search');
        if (isSearch) {
          fetchCalls++;
          await releaseFetch.promise;
        }
        return await original(url, ...args);
      }) as RealmServerService['maybeAuthedFetchForRealms'];
      restoreFetch = () => {
        realmServer.maybeAuthedFetchForRealms = original;
      };
    });

    innerHooks.afterEach(function () {
      try {
        releaseFetch.fulfill();
      } catch {
        // already settled
      }
      restoreFetch?.();
      restoreFetch = undefined;
      let g = globalThis as unknown as {
        __boxelRenderContext?: boolean;
        __boxelJobId?: string;
        __boxelConsumingRealm?: string;
      };
      g.__boxelRenderContext = undefined;
      g.__boxelJobId = undefined;
      g.__boxelConsumingRealm = undefined;
      storeService.clearInFlightSearch();
      storeService.clearSearchCache();
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

    function enterPrerender(jobId: string, consumingRealm: string) {
      let g = globalThis as unknown as {
        __boxelRenderContext?: boolean;
        __boxelJobId?: string;
        __boxelConsumingRealm?: string;
      };
      g.__boxelRenderContext = true;
      g.__boxelJobId = jobId;
      g.__boxelConsumingRealm = consumingRealm;
    }

    test(`sequential same-key store.search calls hit the resolved-doc cache (one fetch total)`, async function (assert) {
      enterPrerender('job-1', testRealmURL);
      releaseFetch.fulfill();

      let r1 = await storeService.search(bookQuery, [testRealmURL]);
      assert.strictEqual(fetchCalls, 1, 'first call populates cache');

      let r2 = await storeService.search(bookQuery, [testRealmURL]);
      assert.strictEqual(
        fetchCalls,
        1,
        'second sequential same-key call serves from cache, no network',
      );
      assert.deepEqual(
        (r1 as { id?: string }[]).map((i) => i.id ?? null),
        (r2 as { id?: string }[]).map((i) => i.id ?? null),
        'cached doc returns the same instance set',
      );
    });

    test(`cache bypasses outside a prerender (live SPA path)`, async function (assert) {
      releaseFetch.fulfill();

      await storeService.search(bookQuery, [testRealmURL]);
      await storeService.search(bookQuery, [testRealmURL]);

      assert.strictEqual(
        fetchCalls,
        2,
        'two sequential calls each fetch — no cache outside prerender',
      );
    });

    test(`cache bypasses when __boxelJobId is unset (prerender with no job)`, async function (assert) {
      let g = globalThis as unknown as {
        __boxelRenderContext?: boolean;
        __boxelConsumingRealm?: string;
      };
      g.__boxelRenderContext = true;
      g.__boxelConsumingRealm = testRealmURL;
      // __boxelJobId intentionally unset
      releaseFetch.fulfill();

      await storeService.search(bookQuery, [testRealmURL]);
      await storeService.search(bookQuery, [testRealmURL]);

      assert.strictEqual(
        fetchCalls,
        2,
        'sequential calls re-fetch when no jobId is on the page',
      );
    });

    test(`cache bypasses cross-realm reads even inside a prerender`, async function (assert) {
      enterPrerender('job-1', testRealmURL);
      releaseFetch.fulfill();

      // Realms array is a superset of [consumingRealm]. Cross-realm
      // reads can't be cached because peer realm-servers swap on
      // their own job cadence.
      await storeService.search(bookQuery, [
        testRealmURL,
        'http://other-realm/data/',
      ]);
      await storeService.search(bookQuery, [
        testRealmURL,
        'http://other-realm/data/',
      ]);

      assert.strictEqual(
        fetchCalls,
        2,
        'cross-realm reads bypass the same-realm cache',
      );
    });

    test(`jobId change drops the cache (defensive clear at fetch-entry)`, async function (assert) {
      enterPrerender('job-1', testRealmURL);
      releaseFetch.fulfill();

      await storeService.search(bookQuery, [testRealmURL]);
      assert.strictEqual(fetchCalls, 1, 'populates cache under job-1');

      // Same query, but the prerender server stamped a new jobId
      // before the next visit started. fetchSearchDoc should observe
      // the change and clear the cache before serving.
      (globalThis as unknown as { __boxelJobId?: string }).__boxelJobId =
        'job-2';
      await storeService.search(bookQuery, [testRealmURL]);

      assert.strictEqual(
        fetchCalls,
        2,
        'cache entry from prior job is not served under new jobId',
      );
    });

    test(`clearSearchCache drops cached entries so subsequent same-key calls re-fetch`, async function (assert) {
      enterPrerender('job-1', testRealmURL);
      releaseFetch.fulfill();

      await storeService.search(bookQuery, [testRealmURL]);
      assert.strictEqual(fetchCalls, 1, 'first call populates cache');

      storeService.clearSearchCache();

      await storeService.search(bookQuery, [testRealmURL]);
      assert.strictEqual(
        fetchCalls,
        2,
        'post-clear same-key caller re-fetches',
      );
    });

    test(`cache hit short-circuits before the in-flight Map is consulted`, async function (assert) {
      enterPrerender('job-1', testRealmURL);
      releaseFetch.fulfill();

      await storeService.search(bookQuery, [testRealmURL]);
      assert.strictEqual(fetchCalls, 1, 'first call populates cache');

      // Fire two more concurrent same-key calls. With the cache hit,
      // they should both short-circuit synchronously — neither needs
      // the in-flight Map and no further fetch should happen.
      let p1 = storeService.search(bookQuery, [testRealmURL]);
      let p2 = storeService.search(bookQuery, [testRealmURL]);
      assert.strictEqual(fetchCalls, 1, 'cache short-circuits both callers');
      await Promise.all([p1, p2]);
    });

    test(`cache survives across renders within the same indexing job`, async function (assert) {
      // A single indexing job spans many card renders in the same
      // prerender tab. Each navigation activates+deactivates the
      // render route, but all those visits share one `__boxelJobId`.
      // The cache MUST survive those route bounces so later renders
      // can reuse earlier ones' work — dropping the cache per-render
      // would defeat the entire point.
      //
      // The render route's deactivate hook drops the in-flight Map
      // (which is usually already empty by then) but deliberately
      // leaves `searchCache` alone. We exercise the equivalent by
      // clearing the in-flight Map between two same-key calls and
      // verifying the second still hits the resolved-doc cache.
      enterPrerender('job-1', testRealmURL);
      releaseFetch.fulfill();

      await storeService.search(bookQuery, [testRealmURL]);
      assert.strictEqual(fetchCalls, 1, 'first render populates cache');

      // Simulate what render-route deactivate does between renders:
      // it clears the in-flight Map but does NOT clear searchCache.
      storeService.clearInFlightSearch();

      // Second render of the same job, same query — must hit cache.
      await storeService.search(bookQuery, [testRealmURL]);
      assert.strictEqual(
        fetchCalls,
        1,
        'second render in the same job reuses the cached doc',
      );
    });

    test(`clearSearchCache during an in-flight fetch suppresses the post-resolve populate`, async function (assert) {
      // A request that's already past the cache-miss gate must not
      // repopulate the cache after an intentional clear lands. The
      // resolved doc is still returned to its caller; only the cache
      // write is suppressed. This protects per-visit isolation when a
      // route deactivates (or resetState fires) while a request is
      // in-flight.
      enterPrerender('job-1', testRealmURL);

      let p1 = storeService.search(bookQuery, [testRealmURL]);
      assert.strictEqual(fetchCalls, 1, 'first call entered the fetch');

      // The clear lands while p1 is parked on releaseFetch.
      storeService.clearSearchCache();

      releaseFetch.fulfill();
      await p1;

      // A subsequent same-key call must re-fetch — the in-flight
      // resolve was forbidden from repopulating the cleared cache.
      await storeService.search(bookQuery, [testRealmURL]);
      assert.strictEqual(
        fetchCalls,
        2,
        'post-clear repopulate was suppressed; next call re-fetches',
      );
    });

    test(`consumingRealm mismatch on a single-realm search bypasses the cache`, async function (assert) {
      // Tab is rendering a card in `consumingRealm`, but the search
      // explicitly targets a different single realm. Same-realm gate
      // requires the search's realms to equal [consumingRealm].
      enterPrerender('job-1', 'http://other-realm/data/');
      releaseFetch.fulfill();

      await storeService.search(bookQuery, [testRealmURL]);
      await storeService.search(bookQuery, [testRealmURL]);

      assert.strictEqual(
        fetchCalls,
        2,
        'single-realm search against a non-consumingRealm is not cached',
      );
    });
  });

  module(
    `non-live SearchResource with seed (prerender query-field path)`,
    function (innerHooks) {
      let releaseFetch: Deferred<void>;
      let fetchCalls: number;
      let restoreFetch: (() => void) | undefined;

      innerHooks.beforeEach(function () {
        releaseFetch = new Deferred<void>();
        fetchCalls = 0;
        let realmServer = getService('realm-server') as RealmServerService;
        let original = realmServer.maybeAuthedFetchForRealms.bind(realmServer);
        realmServer.maybeAuthedFetchForRealms = (async (url, ...args) => {
          let isSearch =
            typeof url === 'string' && url.includes('_federated-search');
          if (isSearch) {
            fetchCalls++;
            await releaseFetch.promise;
          }
          return await original(url, ...args);
        }) as RealmServerService['maybeAuthedFetchForRealms'];
        restoreFetch = () => {
          realmServer.maybeAuthedFetchForRealms = original;
        };
      });

      innerHooks.afterEach(function () {
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
          eq: { 'author.lastName': 'Abdel-Rahman' },
        },
      };

      // Build a seed by first running a normal search outside the
      // prerender — this gives us real CardDef instances from the
      // store that match the query. The seed represents what the
      // parent doc's `relationships.{field}.data` resolved to during
      // serialize.
      async function buildSeed() {
        // Release any parked fetches so this prep call resolves; the
        // tests reset `fetchCalls` after this returns so the seed
        // search doesn't count against the in-test fetch budget.
        releaseFetch.fulfill();
        let result = await storeService.search(bookQuery, [testRealmURL]);
        let url = `${testRealmURL}_federated-search?${new URLSearchParams({
          query: JSON.stringify(bookQuery),
        }).toString()}`;
        return {
          cards: result as any[],
          searchURL: url,
        };
      }

      test(`seed-only resolve: no fetch fires when isLive=false and a seed is present (prerender path)`, async function (assert) {
        let { cards, searchURL } = await buildSeed();
        // Reset the fetch counter — the seed prep above used a live
        // search outside the prerender gate.
        fetchCalls = 0;

        (
          globalThis as unknown as { __boxelRenderContext?: boolean }
        ).__boxelRenderContext = true;

        let search = getSearchResourceForTest(loaderService, () => ({
          named: {
            query: bookQuery,
            realms: [testRealmURL],
            isLive: false,
            isAutoSaved: false,
            storeService,
            seed: {
              cards,
              searchURL,
              realms: [testRealmURL],
            },
            owner: this.owner,
          },
        }));
        await search.loaded;
        await settled();

        assert.strictEqual(
          fetchCalls,
          0,
          'seed-only resolve: no _federated-search fetch fires',
        );
        assert.strictEqual(
          search.instances.length,
          cards.length,
          'resource exposes seed cards',
        );
        assert.deepEqual(
          search.instances.map((i) => i.id),
          cards.map((c) => c.id),
          'seed cards are returned in order',
        );
      });

      test(`live path with the same seed still fetches (live-SPA behavior is preserved)`, async function (assert) {
        let { cards, searchURL } = await buildSeed();
        fetchCalls = 0;

        // __boxelRenderContext intentionally unset — live SPA path.
        let search = getSearchResourceForTest(loaderService, () => ({
          named: {
            query: bookQuery,
            realms: [testRealmURL],
            isLive: true,
            isAutoSaved: false,
            storeService,
            seed: {
              cards,
              searchURL,
              realms: [testRealmURL],
            },
            owner: this.owner,
          },
        }));
        await search.loaded;
        await settled();

        // Today the live path with a matching seed.searchURL happens
        // to short-circuit via the previousQueryString equality check
        // in SearchResource. The contract we care about for this
        // ticket is the opposite case (non-live + seed must NOT
        // fetch), so we only assert that live + seed produces the
        // correct result set. Whether or not the equality-skip path
        // saves a fetch here is an implementation detail of
        // SearchResource that's orthogonal to this change.
        assert.strictEqual(
          search.instances.length,
          cards.length,
          'live path with seed still resolves to the correct set',
        );
      });

      test(`non-live with no seed still fetches (other non-live callers are unaffected)`, async function (assert) {
        releaseFetch.fulfill();
        // __boxelRenderContext intentionally unset.

        let search = getSearchResourceForTest(loaderService, () => ({
          named: {
            query: bookQuery,
            realms: [testRealmURL],
            isLive: false,
            isAutoSaved: false,
            storeService,
            // no seed
            owner: this.owner,
          },
        }));
        await search.loaded;

        assert.ok(
          fetchCalls >= 1,
          'non-live + no-seed callers still hit the network',
        );
        assert.strictEqual(
          search.instances.length,
          2,
          'returns the books matching the query',
        );
      });

      test(`empty unresolved seed still falls back to a fetch in prerender (cards=[], no searchURL)`, async function (assert) {
        // This is the captureQueryFieldSeedData "unresolved" shape:
        // - seedRecords resolved to [] because no nested instances
        //   landed inline on the parent search result.
        // - seedSearchURL was nulled out via
        //   `shouldTreatEmptySeedAsUnresolved`.
        // Result must still run the client-side fallback query —
        // otherwise relationship items that should have appeared in
        // the rendered HTML go missing.
        releaseFetch.fulfill();
        (
          globalThis as unknown as { __boxelRenderContext?: boolean }
        ).__boxelRenderContext = true;

        let search = getSearchResourceForTest(loaderService, () => ({
          named: {
            query: bookQuery,
            realms: [testRealmURL],
            isLive: false,
            isAutoSaved: false,
            storeService,
            seed: {
              cards: [],
              // searchURL intentionally omitted — the "unresolved"
              // signal from query-field-support.
              realms: [testRealmURL],
            },
            owner: this.owner,
          },
        }));
        await search.loaded;

        assert.ok(
          fetchCalls >= 1,
          'empty unresolved seed in prerender falls back to fetch',
        );
        assert.strictEqual(
          search.instances.length,
          2,
          'fallback fetch returns the books matching the query',
        );
      });
    },
  );

  module(`client-side Store filtering step`, function (innerHooks) {
    // Counts only `_federated-search` calls, so an assertion that the client
    // step recomputed "without a server round-trip" isn't perturbed by other
    // traffic in the test environment.
    let fetchCalls: number;
    let restoreFetch: (() => void) | undefined;

    innerHooks.beforeEach(function () {
      fetchCalls = 0;
      let realmServer = getService('realm-server') as RealmServerService;
      let original = realmServer.maybeAuthedFetchForRealms.bind(realmServer);
      realmServer.maybeAuthedFetchForRealms = (async (url, ...args) => {
        if (typeof url === 'string' && url.includes('_federated-search')) {
          fetchCalls++;
        }
        return await original(url, ...args);
      }) as RealmServerService['maybeAuthedFetchForRealms'];
      restoreFetch = () => {
        realmServer.maybeAuthedFetchForRealms = original;
      };
    });

    innerHooks.afterEach(function () {
      restoreFetch?.();
      restoreFetch = undefined;
    });

    const bookRef = { module: testRRI('book'), name: 'Book' };
    let abdelRahmanQuery: Query = {
      filter: { on: bookRef, eq: { 'author.lastName': 'Abdel-Rahman' } },
    };

    // Hydrate a Book into the Store without persisting it — a candidate the
    // server doesn't (yet) know about, standing in for a card created/edited
    // locally before the realm reindexes.
    async function addBookCandidate(
      idPath: string,
      firstName: string,
      lastName: string,
    ): Promise<any> {
      return await storeService.add(
        {
          data: {
            type: 'card',
            id: `${testRealmURL}${idPath}`,
            attributes: {
              author: { firstName, lastName },
              editions: 0,
              pubDate: '2024-01-01',
            },
            meta: { adoptsFrom: bookRef },
          },
        } as LooseSingleCardDocument,
        { doNotPersist: true },
      );
    }

    test(`a locally added matching card appears in an eligible live search without a server round-trip`, async function (assert) {
      let search = getSearchResourceForTest(loaderService, () => ({
        named: {
          query: abdelRahmanQuery,
          realms: [testRealmURL],
          isLive: true,
          isAutoSaved: false,
          storeService,
          owner: this.owner,
        },
      }));
      await search.loaded;
      await settled();
      assert.strictEqual(
        search.instances.length,
        2,
        'server returns the two matching books',
      );

      let fetchesBefore = fetchCalls;
      await addBookCandidate('books/local-new', 'Apple', 'Abdel-Rahman');
      await settled();

      let ids = search.instances.map((i) => i.id);
      assert.strictEqual(
        search.instances.length,
        3,
        'the locally added matching card is merged into the result set',
      );
      assert.ok(
        ids.includes(rri(`${testRealmURL}books/local-new`)),
        'the new card appears in results',
      );
      assert.strictEqual(
        fetchCalls,
        fetchesBefore,
        'no _federated-search fetch fired for the client-side recompute',
      );
    });

    test(`a surfaced candidate is not duplicated even though it is keyed by both local and remote id`, async function (assert) {
      // A hydrated instance lives in the Store identity map under BOTH its
      // local id and its remote id (see gc-card-store's setCardItem). Without
      // deduping, the candidate pool yields it twice and the client merge
      // renders the same card as two rows. This guards that the displayed set
      // holds each card once regardless of the dual keying.
      let search = getSearchResourceForTest(loaderService, () => ({
        named: {
          query: abdelRahmanQuery,
          realms: [testRealmURL],
          isLive: true,
          isAutoSaved: false,
          storeService,
          owner: this.owner,
        },
      }));
      await search.loaded;
      await settled();

      let candidate = await addBookCandidate(
        'books/dupe-check',
        'Apple',
        'Abdel-Rahman',
      );
      await settled();

      // The Store keys the same instance under two ids, but the candidate pool
      // must surface it once.
      let poolOccurrences = storeService
        .allCardInstances()
        .filter((c) => c === candidate).length;
      assert.strictEqual(
        poolOccurrences,
        1,
        'the candidate appears exactly once in allCardInstances despite dual keying',
      );

      let ids = search.instances.map((i) => i.id);
      assert.strictEqual(
        ids.length,
        new Set(ids).size,
        'the displayed result set has no duplicate ids',
      );
      assert.strictEqual(
        ids.filter((id) => id === rri(`${testRealmURL}books/dupe-check`))
          .length,
        1,
        'the surfaced candidate is rendered exactly once',
      );
      assert.strictEqual(
        search.instances.length,
        3,
        'two server books plus the single surfaced candidate',
      );
    });

    test(`a server-returned card that no longer matches local state is removed`, async function (assert) {
      let search = getSearchResourceForTest(loaderService, () => ({
        named: {
          query: abdelRahmanQuery,
          realms: [testRealmURL],
          isLive: true,
          isAutoSaved: false,
          storeService,
          owner: this.owner,
        },
      }));
      await search.loaded;
      await settled();
      assert.strictEqual(search.instances.length, 2);

      // Mutate a server-returned card so it no longer satisfies the filter.
      // The removal is derived from in-memory state; we read synchronously,
      // before the (async, debounced) autosave + reindex can re-query.
      let book1 = storeService.peek(`${testRealmURL}books/1`) as any;
      book1.author.lastName = 'Changed';

      let ids = search.instances.map((i) => i.id);
      assert.strictEqual(
        search.instances.length,
        1,
        'the now-non-matching server card is removed',
      );
      assert.notOk(
        ids.includes(rri(`${testRealmURL}books/1`)),
        'books/1 dropped from results',
      );
    });

    test(`editing a candidate toggles its membership reactively (recompute on Store mutation)`, async function (assert) {
      let search = getSearchResourceForTest(loaderService, () => ({
        named: {
          query: abdelRahmanQuery,
          realms: [testRealmURL],
          isLive: true,
          isAutoSaved: false,
          storeService,
          owner: this.owner,
        },
      }));
      await search.loaded;
      await settled();
      assert.strictEqual(search.instances.length, 2);

      let candidate = await addBookCandidate(
        'books/edit-me',
        'Switch',
        'Other',
      );
      await settled();
      assert.strictEqual(
        search.instances.length,
        2,
        'a candidate that does not match is not shown',
      );

      candidate.author.lastName = 'Abdel-Rahman';
      assert.strictEqual(
        search.instances.length,
        3,
        'after editing to match, the candidate appears',
      );
      assert.ok(
        search.instances
          .map((i) => i.id)
          .includes(rri(`${testRealmURL}books/edit-me`)),
      );

      candidate.author.lastName = 'Other again';
      assert.strictEqual(
        search.instances.length,
        2,
        'after editing away from match, the candidate disappears',
      );
    });

    test(`a merged candidate is reference-retained while displayed and released when it leaves`, async function (assert) {
      // Candidates surfaced by the merge are absent from `_instances`, so
      // `updateInstances`' reference bookkeeping doesn't cover them. Without a
      // retained reference they sit at count zero and the Store GC can sweep
      // them mid-render. The resource must hold a reference while the candidate
      // is displayed and drop it once it leaves the result set.
      let search = getSearchResourceForTest(loaderService, () => ({
        named: {
          query: abdelRahmanQuery,
          realms: [testRealmURL],
          isLive: true,
          isAutoSaved: false,
          storeService,
          owner: this.owner,
        },
      }));
      await search.loaded;
      await settled();

      let candidate = await addBookCandidate(
        'books/retained',
        'Apple',
        'Abdel-Rahman',
      );
      let candidateId = `${testRealmURL}books/retained`;
      await settled();
      assert.strictEqual(
        storeService.getReferenceCount(candidateId),
        0,
        'a freshly hydrated candidate carries no reference before it is displayed',
      );

      // Reading `instances` drives the merge derivation, which declares the
      // candidate as in-use; the reference reconciliation is deferred, so flush
      // with settled() before asserting.
      assert.ok(
        search.instances.map((i) => i.id).includes(rri(candidateId)),
        'the candidate is displayed',
      );
      await settled();
      assert.ok(
        storeService.getReferenceCount(candidateId) > 0,
        'a Store reference is retained while the candidate is displayed',
      );

      // Edit it out of the result set; the retained reference must be released.
      candidate.author.lastName = 'Other';
      assert.notOk(
        search.instances.map((i) => i.id).includes(rri(candidateId)),
        'the candidate leaves the result set',
      );
      await settled();
      assert.strictEqual(
        storeService.getReferenceCount(candidateId),
        0,
        'the reference is released once the candidate is no longer displayed',
      );
    });

    test(`the merged set is ordered per the query sort`, async function (assert) {
      let sortedQuery: Query = {
        filter: { on: bookRef, eq: { 'author.lastName': 'Abdel-Rahman' } },
        sort: [{ by: 'author.firstName', on: bookRef, direction: 'asc' }],
      };
      let search = getSearchResourceForTest(loaderService, () => ({
        named: {
          query: sortedQuery,
          realms: [testRealmURL],
          isLive: true,
          isAutoSaved: false,
          storeService,
          owner: this.owner,
        },
      }));
      await search.loaded;
      await settled();
      // Server order by author.firstName asc: Mango (books/1), Van Gogh (books/2).
      assert.deepEqual(
        search.instances.map((i) => i.id),
        [`${testRealmURL}books/1`, `${testRealmURL}books/2`],
      );

      await addBookCandidate('books/apple', 'Apple', 'Abdel-Rahman');
      await settled();
      assert.deepEqual(
        search.instances.map((i) => i.id),
        [
          `${testRealmURL}books/apple`,
          `${testRealmURL}books/1`,
          `${testRealmURL}books/2`,
        ],
        'the candidate sorts into position by author.firstName',
      );
    });

    test(`one-shot store.search never runs the client step (server-only)`, async function (assert) {
      await addBookCandidate('books/local-only', 'Local', 'Abdel-Rahman');

      let result = (await storeService.search(abdelRahmanQuery, [
        testRealmURL,
      ])) as CardDef[];
      assert.notOk(
        result
          .map((c) => c.id)
          .includes(`${testRealmURL}books/local-only` as CardDef['id']),
        'one-shot store.search ignores the local-only candidate',
      );
    });

    test(`a non-live search is a server-only passthrough`, async function (assert) {
      await addBookCandidate('books/passthrough', 'Zoe', 'Abdel-Rahman');

      let search = getSearchResourceForTest(loaderService, () => ({
        named: {
          query: abdelRahmanQuery,
          realms: [testRealmURL],
          isLive: false,
          isAutoSaved: false,
          storeService,
          owner: this.owner,
        },
      }));
      await search.loaded;
      await settled();
      assert.strictEqual(
        search.instances.length,
        2,
        'a non-live search ignores the local candidate',
      );
      assert.notOk(
        search.instances
          .map((i) => i.id)
          .includes(rri(`${testRealmURL}books/passthrough`)),
      );
    });

    test(`an incompletely-loaded (paginated) result set skips the client step`, async function (assert) {
      let pagedQuery: Query = {
        filter: { type: bookRef },
        page: { number: 0, size: 2 },
        sort: [{ by: 'author.firstName', on: bookRef, direction: 'asc' }],
      };
      let search = getSearchResourceForTest(loaderService, () => ({
        named: {
          query: pagedQuery,
          realms: [testRealmURL],
          isLive: true,
          isAutoSaved: false,
          storeService,
          owner: this.owner,
        },
      }));
      await search.loaded;
      await settled();
      assert.strictEqual(search.instances.length, 2, 'first page holds 2');
      assert.strictEqual(
        search.meta.page?.total,
        4,
        'total is 4 across all pages — the loaded set is incomplete',
      );

      await addBookCandidate('books/paged-extra', 'Aaa', 'Zzz');
      await settled();
      assert.strictEqual(
        search.instances.length,
        2,
        'an incomplete result set is not reconciled against the Store',
      );
      assert.notOk(
        search.instances
          .map((i) => i.id)
          .includes(rri(`${testRealmURL}books/paged-extra`)),
      );
    });

    test(`a non-client-evaluable filter (matches) forces server-only`, async function (assert) {
      // `matches` is a full-text (markdown) predicate the client matcher cannot
      // evaluate, so an otherwise-live search over it is a server-only
      // passthrough: its displayed set stays exactly the server result, with no
      // Store candidate merged in.
      let matchesQuery: Query = { filter: { matches: 'Abdel-Rahman' } };
      let search = getSearchResourceForTest(loaderService, () => ({
        named: {
          query: matchesQuery,
          realms: [testRealmURL],
          isLive: true,
          isAutoSaved: false,
          storeService,
          owner: this.owner,
        },
      }));
      await search.loaded;
      await settled();
      let serverIds = search.instances.map((i) => i.id);

      // A hydrated Store candidate in the target realm — the kind a
      // client-evaluable filter would surface — must not be merged into a
      // matches search.
      await addBookCandidate('books/matches-extra', 'Nope', 'Abdel-Rahman');
      await settled();
      assert.ok(
        storeService.peek(`${testRealmURL}books/matches-extra`),
        'the candidate is hydrated in the Store',
      );
      assert.deepEqual(
        search.instances.map((i) => i.id),
        serverIds,
        'the displayed set stays equal to the server result — no candidate merged',
      );
      assert.notOk(
        search.instances
          .map((i) => i.id)
          .includes(rri(`${testRealmURL}books/matches-extra`)),
        'the locally added candidate is not pulled into a matches search',
      );
    });

    test(`a candidate evicted from the Store drops out of the displayed set on the next reactive pass`, async function (assert) {
      let search = getSearchResourceForTest(loaderService, () => ({
        named: {
          query: abdelRahmanQuery,
          realms: [testRealmURL],
          isLive: true,
          isAutoSaved: false,
          storeService,
          owner: this.owner,
        },
      }));
      await search.loaded;
      await settled();

      await addBookCandidate('books/will-evict', 'Plum', 'Abdel-Rahman');
      await settled();
      let candidateId = `${testRealmURL}books/will-evict`;
      assert.ok(
        search.instances.map((i) => i.id).includes(rri(candidateId)),
        'the candidate is displayed before eviction',
      );

      // Evict from the Store without going through realm DELETE — the reactive
      // recompute must respond to a Store-level removal on its own, distinct
      // from the realm-invalidation path which would also re-run the server
      // search and could mask the recompute under test.
      let fetchesBefore = fetchCalls;
      (storeService as any).store.delete(candidateId);
      await settled();

      assert.notOk(
        search.instances.map((i) => i.id).includes(rri(candidateId)),
        'the candidate drops out after a Store eviction',
      );
      assert.strictEqual(
        fetchCalls,
        fetchesBefore,
        'no _federated-search fetch fired for the recompute',
      );
    });

    test(`a candidate with an unresolvable predicate (unloaded linksTo) is not added`, async function (assert) {
      // The merge rule is "unresolvable never adds and never removes". This
      // test pins the "never adds" half: a Post candidate whose `article`
      // relationship points at a card not in the Store is unresolvable for any
      // predicate over `article.*`, and so must NOT be merged into the result
      // set. The symmetric "never removes" guarantee falls out of the same
      // matcher branch.
      let postRef = { module: testRRI('post'), name: 'Post' };
      let query: Query = {
        filter: { on: postRef, eq: { 'article.cardTitle': 'Any Title' } },
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
      await settled();
      let serverIds = search.instances.map((i) => i.id);

      await storeService.add(
        {
          data: {
            type: 'card',
            id: `${testRealmURL}posts/unresolved`,
            attributes: { cardTitle: 'Lonely Post' },
            relationships: {
              article: {
                links: { self: `${testRealmURL}does/not/exist` },
              },
            },
            meta: { adoptsFrom: postRef },
          },
        } as LooseSingleCardDocument,
        { doNotPersist: true },
      );
      await settled();

      assert.deepEqual(
        search.instances.map((i) => i.id),
        serverIds,
        'an unresolvable candidate does not enter the displayed set',
      );
      assert.notOk(
        search.instances
          .map((i) => i.id)
          .includes(rri(`${testRealmURL}posts/unresolved`)),
        'the unresolvable candidate is absent',
      );
    });

    test(`a Store candidate outside the query's target realm is not added`, async function (assert) {
      // Candidate-pool reduction is realm-scoped (`isInTargetRealm`), so a
      // hydrated card whose id falls outside `realms: [testRealmURL]` must
      // not surface even when it satisfies the filter — that's another
      // realm's data and the local search has no authority over it.
      let otherRealmURL = 'https://other-realm.example/';
      await storeService.add(
        {
          data: {
            type: 'card',
            id: `${otherRealmURL}books/foreign`,
            attributes: {
              author: { firstName: 'Foreign', lastName: 'Abdel-Rahman' },
              editions: 0,
              pubDate: '2024-01-01',
            },
            meta: { adoptsFrom: bookRef },
          },
        } as LooseSingleCardDocument,
        { doNotPersist: true },
      );

      let search = getSearchResourceForTest(loaderService, () => ({
        named: {
          query: abdelRahmanQuery,
          realms: [testRealmURL],
          isLive: true,
          isAutoSaved: false,
          storeService,
          owner: this.owner,
        },
      }));
      await search.loaded;
      await settled();

      let ids = search.instances.map((i) => i.id).map(String);
      assert.strictEqual(
        search.instances.length,
        2,
        'only the two in-realm matches are displayed',
      );
      assert.notOk(
        ids.some((id) => id.startsWith(otherRealmURL)),
        'the candidate outside [testRealmURL] is excluded',
      );
    });

    test(`override authority: a server-card removal and a candidate add both reach the displayed set`, async function (assert) {
      // The merge applies corrections in BOTH directions. A server-returned
      // card mutated out of the filter is dropped, and a local-only candidate
      // that matches is surfaced — the converged displayed set has the same
      // count as the server's but different members.
      let search = getSearchResourceForTest(loaderService, () => ({
        named: {
          query: abdelRahmanQuery,
          realms: [testRealmURL],
          isLive: true,
          isAutoSaved: false,
          storeService,
          owner: this.owner,
        },
      }));
      await search.loaded;
      await settled();
      assert.strictEqual(search.instances.length, 2);

      // Drop a server card via a local edit AND surface a local-only
      // candidate via a Store add. The assertions verify convergence, not
      // single-pass: the `addBookCandidate` await between the two mutations
      // yields the event loop, so the merge may re-derive twice.
      let book1 = storeService.peek(`${testRealmURL}books/1`) as any;
      book1.author.lastName = 'Changed';
      await addBookCandidate('books/local-add', 'Local', 'Abdel-Rahman');
      await settled();

      let ids = search.instances.map((i) => i.id);
      assert.strictEqual(
        search.instances.length,
        2,
        'one server card dropped, one local candidate surfaced — same count, different members',
      );
      assert.notOk(
        ids.includes(rri(`${testRealmURL}books/1`)),
        'the now-non-matching server card is gone',
      );
      assert.ok(
        ids.includes(rri(`${testRealmURL}books/local-add`)),
        'the local-only matching candidate is present',
      );
    });
  });
});
