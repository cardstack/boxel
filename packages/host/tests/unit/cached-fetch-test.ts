import { module, test } from 'qunit';

import { cachedFetch, clearFetchCache } from '@cardstack/runtime-common';

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
});
