import { module, test } from 'qunit';

import {
  fetcher,
  VirtualNetwork,
  type FetcherMiddlewareHandler,
} from '@cardstack/runtime-common';

module('Unit | fetcher', function () {
  test('without middleware, simply wraps fetch implementation', async function (assert) {
    assert.expect(2);
    let fetch = fetcher(async function (request) {
      assert.strictEqual((request as Request).url, 'http://example.com/');
      return new Response('OK', { status: 200 });
    }, []);
    let response = await fetch('http://example.com');
    assert.strictEqual(response.status, 200);
  });

  test('response from middleware handler follows redirects', async function (assert) {
    assert.expect(5);
    let handler: FetcherMiddlewareHandler = async function (req, next) {
      if (req.url === 'http://example.com/') {
        return new Response('moved', {
          status: 301,
          headers: { location: 'http://example.com/redirected' },
        });
      }
      return next(req);
    };
    let fetch = fetcher(
      async function (request) {
        let requestUrl = (request as Request).url;
        assert.strictEqual(
          requestUrl,
          'http://example.com/redirected',
          'redirection request makes its way to fetch implementation',
        );
        let response = new Response('destination', { status: 200 });
        Object.defineProperty(response, 'url', { value: requestUrl });
        return response;
      },
      [handler],
    );
    let response = await fetch('http://example.com/');
    assert.strictEqual(
      await response.text(),
      'destination',
      'body text is correct',
    );
    assert.strictEqual(response.status, 200, 'status is 200');
    assert.strictEqual(
      response.url,
      'http://example.com/redirected',
      'url is correct',
    );
    assert.true(response.redirected, 'labeled as redirected');
  });

  test('can reuse a Request after a failed attempt', async function (assert) {
    assert.expect(5);
    let attempts = 0;
    let fetch = fetcher(async function (input) {
      attempts++;
      let request = input as Request;
      if (request.bodyUsed) {
        throw new TypeError('Request already used');
      }
      await request.text(); // mark the body as read like a real fetch would
      if (attempts === 1) {
        throw new TypeError('network failed');
      }
      return new Response('OK', { status: 200 });
    }, []);

    let request = new Request('http://example.com/', {
      method: 'POST',
      body: 'hello',
    });

    await assert.rejects(fetch(request), /network failed/);
    assert.false(request.bodyUsed, 'original request is still reusable');

    let response = await fetch(request);
    assert.strictEqual(attempts, 2, 'second attempt reached fetch impl');
    assert.strictEqual(response.status, 200);
    assert.strictEqual(await response.text(), 'OK');
  });

  test('resolves a registered scoped prefix before constructing the Request', async function (assert) {
    assert.expect(1);
    let vn = new VirtualNetwork(globalThis.fetch);
    vn.addRealmMapping(
      '@cardstack/catalog/',
      'https://app.example.com/catalog/',
    );
    try {
      let fetch = fetcher(
        async function (request) {
          assert.strictEqual(
            (request as Request).url,
            'https://app.example.com/catalog/Foo/abc',
            'scoped id is resolved to its real URL, not joined onto document.baseURI',
          );
          return new Response('OK', { status: 200 });
        },
        [],
        vn,
      );
      await fetch('@cardstack/catalog/Foo/abc');
    } finally {
      vn.removeRealmMapping('@cardstack/catalog/');
    }
  });

  test('handler can call next more than once if needed', async function (assert) {
    assert.expect(2);
    let handler: FetcherMiddlewareHandler = async function (req, next) {
      let response = await next(req);
      if (response.status === 401) {
        req = new Request(req.url, {
          headers: { Authorization: 'Bearer 123' },
        });
      }
      return next(req);
    };
    let fetch = fetcher(
      async function (request) {
        let authHeader = (request as Request).headers.get('Authorization');
        if (authHeader === 'Bearer 123') {
          return new Response('OK', { status: 200 });
        } else {
          return new Response('Unauthorized', { status: 401 });
        }
      },
      [handler],
    );
    let response = await fetch('http://example.com/');
    assert.strictEqual(response.status, 200, 'status is 200');
    assert.strictEqual(await response.text(), 'OK', 'body text is correct');
  });
});

module('Unit | VirtualNetwork fetch retries', function (hooks) {
  let priorEnvironment: unknown;
  let priorTimeout: unknown;

  hooks.beforeEach(function () {
    // The per-attempt timeout is armed only in the test environment; pin it
    // and shrink the deadline so the retry path runs in milliseconds.
    priorEnvironment = (globalThis as any).__environment;
    priorTimeout = (globalThis as any).__fetchAttemptTimeoutMs;
    (globalThis as any).__environment = 'test';
    (globalThis as any).__fetchAttemptTimeoutMs = 50;
  });

  hooks.afterEach(function () {
    (globalThis as any).__environment = priorEnvironment;
    if (priorTimeout === undefined) {
      delete (globalThis as any).__fetchAttemptTimeoutMs;
    } else {
      (globalThis as any).__fetchAttemptTimeoutMs = priorTimeout;
    }
  });

  test('a wedged (never-settling) attempt to a retryable host times out and retries on a fresh stream', async function (assert) {
    assert.expect(3);
    let attempts = 0;
    // Mirror a wedged HTTP/2 stream: the first attempt never resolves on its
    // own and only settles when its abort signal fires; the retry succeeds.
    let vn = new VirtualNetwork(async function (input) {
      attempts++;
      let request = input as Request;
      if (attempts === 1) {
        return await new Promise<Response>((_resolve, reject) => {
          request.signal.addEventListener('abort', () =>
            reject(
              new DOMException('The operation was aborted.', 'AbortError'),
            ),
          );
        });
      }
      return new Response('OK', { status: 200 });
    });

    // localhost is a retryable host, so withRetries arms the timeout.
    let response = await vn.fetch('http://localhost:4201/base/_info');
    assert.strictEqual(
      attempts,
      2,
      'first attempt was aborted by the timeout and the request was retried',
    );
    assert.strictEqual(response.status, 200, 'retry resolved successfully');
    assert.strictEqual(
      await response.text(),
      'OK',
      'body comes from the retry',
    );
  });
});
