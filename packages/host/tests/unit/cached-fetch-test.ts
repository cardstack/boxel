import { module, test } from 'qunit';

import {
  baseRealm,
  cachedFetch,
  clearFetchCache,
  type MaybeCachedResponse,
} from '@cardstack/runtime-common';

type FetchCall = {
  accept: string | null;
  ifNoneMatch: string | null;
};

function createFetchStub() {
  let calls: FetchCall[] = [];
  let impl: typeof fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    let request = input instanceof Request ? input : new Request(input, init);
    let accept = request.headers.get('Accept');
    let ifNoneMatch = request.headers.get('If-None-Match');
    calls.push({ accept, ifNoneMatch });

    if (accept === 'application/vnd.card+source') {
      return new Response('card source body', {
        status: 200,
        headers: {
          ETag: 'etag-source',
          'X-boxel-realm-url': 'http://example.com/',
        },
      });
    }

    if (accept === '*/*' || accept === null) {
      if (ifNoneMatch === 'etag-module') {
        return new Response(null, { status: 304 });
      }

      if (ifNoneMatch) {
        return new Response(null, { status: 304 });
      }

      return new Response('transpiled module body', {
        status: 200,
        headers: {
          ETag: 'etag-module',
          'X-boxel-realm-url': 'http://example.com/',
        },
      });
    }

    throw new Error(`unexpected Accept header: ${accept ?? '<none>'}`);
  };

  return { calls, impl };
}

const TEST_URL = 'http://example.com/modules/example.js';

// Trusted base-realm entries deliberately outlive the between-test clear, so
// each test needs its own URL — and one nothing else in the suite requests, so
// what this module leaves behind can't affect other tests.
const canonicalPath = './__cached-fetch-canonical__';
const source = 'export const x = 1;';

function realmResponse(moduleHref: string): Response {
  let response = new Response(source, {
    headers: {
      ETag: 'etag-1',
      'X-boxel-realm-url': baseRealm.url,
      'X-Boxel-Canonical-Path': canonicalPath,
      'content-type': 'text/javascript',
    },
  });
  // A constructed Response has an empty url; a fetched one doesn't, and the
  // loader reads it, so the stand-in has to have one too.
  Object.defineProperty(response, 'url', {
    value: moduleHref,
    configurable: true,
  });
  return response;
}

// Populates the cache the way Loader#fetchModule does: read the body, then hand
// it back through cacheResponse.
async function primeCache(
  fetchImplementation: typeof globalThis.fetch,
  moduleHref: string,
) {
  let response = (await cachedFetch(
    fetchImplementation,
    moduleHref,
  )) as MaybeCachedResponse;
  response.cacheResponse?.(await response.text());
}

module('Unit | cached-fetch', function (hooks) {
  hooks.afterEach(function () {
    clearFetchCache();
  });

  test('card source requests cache their body under their accept header', async function (assert) {
    assert.expect(2);
    let { calls, impl } = createFetchStub();

    let request = new Request(TEST_URL, {
      headers: { Accept: 'application/vnd.card+source' },
    });
    let response = await cachedFetch(impl, request);
    let body = await response.text();
    response.cacheResponse?.(body);

    assert.strictEqual(body, 'card source body');
    assert.deepEqual(calls, [
      { accept: 'application/vnd.card+source', ifNoneMatch: null },
    ]);
  });

  test('module requests with */* do not reuse card source etag', async function (assert) {
    assert.expect(3);
    let { calls, impl } = createFetchStub();

    let cardSourceRequest = new Request(TEST_URL, {
      headers: { Accept: 'application/vnd.card+source' },
    });
    let cardSourceResponse = await cachedFetch(impl, cardSourceRequest);
    let cardSourceBody = await cardSourceResponse.text();
    cardSourceResponse.cacheResponse?.(cardSourceBody);

    let moduleRequest = new Request(TEST_URL, {
      headers: { Accept: '*/*' },
    });
    let moduleResponse = await cachedFetch(impl, moduleRequest);
    let moduleBody = await moduleResponse.text();
    moduleResponse.cacheResponse?.(moduleBody);

    assert.strictEqual(moduleBody, 'transpiled module body');
    assert.strictEqual(calls.length, 2);
    assert.deepEqual(calls[1], { accept: '*/*', ifNoneMatch: null });
  });

  test('module request without accept header reuses cached module body', async function (assert) {
    assert.expect(4);
    let { calls, impl } = createFetchStub();

    let primingRequest = new Request(TEST_URL, {
      headers: { Accept: '*/*' },
    });
    let primingResponse = await cachedFetch(impl, primingRequest);
    let primingBody = await primingResponse.text();
    primingResponse.cacheResponse?.(primingBody);

    let cachedResponse = await cachedFetch(impl, new Request(TEST_URL));

    assert.strictEqual(primingBody, 'transpiled module body');
    assert.strictEqual(await cachedResponse.text(), 'transpiled module body');
    assert.strictEqual(calls.length, 2);
    assert.deepEqual(calls, [
      { accept: '*/*', ifNoneMatch: null },
      { accept: null, ifNoneMatch: 'etag-module' },
    ]);
  });

  test('a replayed base-realm response keeps the headers and url the realm sent', async function (assert) {
    let moduleHref = `${baseRealm.url}__cached-fetch-replay-test__`;
    let requests = 0;
    let fetchImplementation = (async () => {
      requests++;
      return realmResponse(moduleHref);
    }) as unknown as typeof globalThis.fetch;

    await primeCache(fetchImplementation, moduleHref);
    assert.strictEqual(requests, 1, 'the first fetch reaches the realm');

    // Test suites mark the base realm trusted (see test-helper.js), which is
    // what lets a hit skip revalidation — and so return a response the caller
    // did not receive from the realm.
    let replayed = await cachedFetch(fetchImplementation, moduleHref);
    assert.strictEqual(requests, 1, 'a trusted hit makes no request');

    // Loader#fetchModule derives a module's canonical identity from this
    // header, falling back to response.url. Losing either registers the module
    // under a second identity, which breaks instanceof and def lookup.
    assert.strictEqual(
      replayed.headers.get('X-Boxel-Canonical-Path'),
      canonicalPath,
      'the canonical-path header survives the replay',
    );
    assert.strictEqual(
      replayed.url,
      moduleHref,
      'the response url survives the replay',
    );
    assert.strictEqual(
      replayed.headers.get('X-boxel-realm-url'),
      baseRealm.url,
      'the realm-url header survives the replay',
    );
    assert.strictEqual(
      replayed.headers.get('content-type'),
      'text/javascript',
      'the content type survives the replay',
    );
    assert.strictEqual(await replayed.text(), source, 'the body is the source');
  });

  test('clearFetchCache keeps trusted base-realm entries', async function (assert) {
    let moduleHref = `${baseRealm.url}__cached-fetch-clear-test__`;
    let requests = 0;
    let fetchImplementation = (async () => {
      requests++;
      return realmResponse(moduleHref);
    }) as unknown as typeof globalThis.fetch;

    await primeCache(fetchImplementation, moduleHref);
    clearFetchCache();

    let replayed = await cachedFetch(fetchImplementation, moduleHref);
    assert.strictEqual(
      requests,
      1,
      'the entry outlives the between-test clear, so no second request',
    );
    assert.strictEqual(
      replayed.headers.get('X-Boxel-Canonical-Path'),
      canonicalPath,
      'and it still carries its headers afterwards',
    );
  });

  test('a 304 revalidation keeps the content type and takes the canonical path from the realm', async function (assert) {
    // Not a base-realm URL, so it revalidates rather than being served from
    // cache outright — the path every non-base realm still takes.
    let moduleHref = 'http://test-realm/test/__cached-fetch-304-test__';
    let movedCanonicalPath = './__cached-fetch-moved__';
    let responses = [
      () => {
        let response = new Response(source, {
          headers: {
            ETag: 'etag-1',
            'X-boxel-realm-url': 'http://test-realm/test/',
            'X-Boxel-Canonical-Path': canonicalPath,
            'content-type': 'text/javascript',
          },
        });
        Object.defineProperty(response, 'url', {
          value: moduleHref,
          configurable: true,
        });
        return response;
      },
      // The realm sends the canonical path on a 304 but no content-type, so a
      // faithful replay needs both sources.
      () =>
        new Response(null, {
          status: 304,
          headers: {
            ETag: 'etag-1',
            'X-Boxel-Canonical-Path': movedCanonicalPath,
          },
        }),
    ];
    let fetchImplementation = (async () =>
      responses.shift()!()) as unknown as typeof globalThis.fetch;

    await primeCache(fetchImplementation, moduleHref);
    let replayed = await cachedFetch(fetchImplementation, moduleHref);

    assert.strictEqual(
      replayed.headers.get('X-Boxel-Canonical-Path'),
      movedCanonicalPath,
      "the 304's canonical path wins over the cached one",
    );
    assert.strictEqual(
      replayed.headers.get('content-type'),
      'text/javascript',
      'while the content type comes from the cached entry',
    );
    assert.strictEqual(await replayed.text(), source, 'the body is the source');
  });
});
