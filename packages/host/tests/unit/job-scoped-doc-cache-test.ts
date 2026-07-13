import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { isCardError } from '@cardstack/runtime-common';

import CardStore, {
  type ReferenceCount,
} from '@cardstack/host/lib/gc-card-store';

import { setupRenderingTest } from '../helpers/setup';

// Exercises the store's job-scoped wire-document cache: inside an indexing
// render (render context + job id present) a successful card-source /
// file-meta document is cached by URL for the job's lifetime, so a link
// target shared by many cards fetches once per job. The cache is inert
// outside that gate, drops on a job-id change and on store reset, never
// holds error results, and hands out isolated copies. Also covers the
// `untracked` load option the searchable generator's targeted loads use to
// stay out of the store's load-generation settle signal.
module('Unit | job-scoped wire-document cache', function (hooks) {
  setupRenderingTest(hooks);

  let fetchCount = 0;
  let fetchStatus = 200;

  hooks.beforeEach(function () {
    fetchCount = 0;
    fetchStatus = 200;
    (globalThis as any).__boxelRenderContext = true;
    (globalThis as any).__boxelJobId = '17.23';
  });

  hooks.afterEach(function () {
    delete (globalThis as any).__boxelRenderContext;
    delete (globalThis as any).__boxelJobId;
  });

  function cardDocFor(url: string) {
    return {
      data: {
        id: url,
        type: 'card',
        attributes: { name: 'Test' },
        meta: {
          adoptsFrom: {
            module: 'https://cardstack.com/base/card-api',
            name: 'CardDef',
          },
        },
      },
    };
  }

  function fileMetaDocFor(url: string) {
    return {
      data: {
        id: url,
        type: 'file-meta',
        attributes: {},
        meta: {
          adoptsFrom: {
            module: 'https://cardstack.com/base/file-api',
            name: 'FileDef',
          },
        },
      },
    };
  }

  function makeStore(): CardStore {
    let referenceCount: ReferenceCount = new Map();
    let network = getService('network');
    let stubFetch = async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      fetchCount++;
      if (fetchStatus !== 200) {
        return new Response('not found', { status: fetchStatus });
      }
      let href =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      let requested = new URL(href);
      requested.search = '';
      // Card-source and file-meta requests both target `.json` URLs; the
      // Accept header is what distinguishes the document kind requested.
      let accept = new Headers(init?.headers).get('accept');
      let doc = accept?.includes('file-meta')
        ? fileMetaDocFor(requested.href)
        : cardDocFor(requested.href.replace(/\.json$/, ''));
      return new Response(JSON.stringify(doc), {
        status: 200,
        headers: { 'content-type': 'application/vnd.card+source' },
      });
    };
    return new CardStore(
      referenceCount,
      stubFetch as typeof globalThis.fetch,
      network.virtualNetwork,
    );
  }

  test('a repeated card-document load within one job fetches once', async function (assert) {
    let store = makeStore();
    let url = 'http://localhost:4201/test/hassan';
    let first = await store.loadCardDocument(url);
    let second = await store.loadCardDocument(url);
    assert.strictEqual(fetchCount, 1, 'only the first load fetched');
    assert.deepEqual(second, first, 'the cached document is equivalent');
    assert.notStrictEqual(second, first, 'each consumer receives its own copy');
  });

  test('a cache hit hands out a copy isolated from prior consumers', async function (assert) {
    let store = makeStore();
    let url = 'http://localhost:4201/test/hassan';
    let first = (await store.loadCardDocument(url)) as any;
    first.data.attributes.name = 'mutated by consumer';
    let second = (await store.loadCardDocument(url)) as any;
    assert.strictEqual(
      second.data.attributes.name,
      'Test',
      'a consumer mutation does not leak into later cache hits',
    );
  });

  test('observing a different job id drops the previous job entries', async function (assert) {
    let store = makeStore();
    let url = 'http://localhost:4201/test/hassan';
    await store.loadCardDocument(url);
    (globalThis as any).__boxelJobId = '18.24';
    await store.loadCardDocument(url);
    assert.strictEqual(fetchCount, 2, 'the new job re-fetches');
  });

  test('no caching outside a render context', async function (assert) {
    delete (globalThis as any).__boxelRenderContext;
    let store = makeStore();
    let url = 'http://localhost:4201/test/hassan';
    await store.loadCardDocument(url);
    await store.loadCardDocument(url);
    assert.strictEqual(fetchCount, 2, 'every load fetches');
  });

  test('no caching without a job id', async function (assert) {
    delete (globalThis as any).__boxelJobId;
    let store = makeStore();
    let url = 'http://localhost:4201/test/hassan';
    await store.loadCardDocument(url);
    await store.loadCardDocument(url);
    assert.strictEqual(fetchCount, 2, 'every load fetches');
  });

  test('error results are not cached', async function (assert) {
    fetchStatus = 404;
    let store = makeStore();
    let url = 'http://localhost:4201/test/missing';
    let first = await store.loadCardDocument(url);
    assert.true(isCardError(first), 'the load surfaces a card error');
    let second = await store.loadCardDocument(url);
    assert.true(isCardError(second), 'the retry surfaces a card error too');
    assert.strictEqual(fetchCount, 2, 'the error result was not pinned');
  });

  test('reset() drops the cache', async function (assert) {
    let store = makeStore();
    let url = 'http://localhost:4201/test/hassan';
    await store.loadCardDocument(url);
    store.reset();
    await store.loadCardDocument(url);
    assert.strictEqual(fetchCount, 2, 'a reset store re-fetches');
  });

  test('an untracked load does not move the load generation', async function (assert) {
    let store = makeStore();
    let before = store.loadGeneration;
    await store.loadCardDocument('http://localhost:4201/test/untracked', {
      untracked: true,
    });
    assert.strictEqual(
      store.loadGeneration,
      before,
      'an untracked fetch leaves the settle signal unmoved',
    );
    await store.loadCardDocument('http://localhost:4201/test/tracked');
    assert.notStrictEqual(
      store.loadGeneration,
      before,
      'a tracked fetch moves the settle signal',
    );
  });

  test('a repeated file-meta document load within one job fetches once', async function (assert) {
    let store = makeStore();
    let url = 'http://localhost:4201/test/notes.json';
    let first = await store.loadFileMetaDocument(url);
    let second = await store.loadFileMetaDocument(url);
    assert.strictEqual(fetchCount, 1, 'only the first load fetched');
    assert.deepEqual(second, first, 'the cached document is equivalent');
  });
});
