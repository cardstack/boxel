import { module, test } from 'qunit';

import {
  fetcher,
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
