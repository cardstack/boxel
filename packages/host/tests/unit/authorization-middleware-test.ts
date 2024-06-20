import { module, test } from 'qunit';

import { authorizationMiddleware, fetcher } from '@cardstack/runtime-common';

module('Unit | AuthorizationMiddleware', function (hooks) {
  hooks.beforeEach(function () {});

  function assertRequest(req: any): asserts req is Request {
    if (!(req instanceof Request)) {
      throw new Error('Expected a Request');
    }
  }
  test('a successful request is left alone', async function (assert) {
    let req = new Request('https://example.com');
    let fetchImplementation: typeof globalThis.fetch = async function (req) {
      assertRequest(req);
      assert.strictEqual(req.headers.get('Authorization'), null);
      return new Response('OK', { status: 200 });
    };
    let fetch = fetcher(fetchImplementation, [authorizationMiddleware()]);
    let response = await fetch(req);
    assert.strictEqual(response.status, 200);
  });

  test('a 403 request is left alone', async function (assert) {
    let req = new Request('https://example.com');
    let fetchImplementation: typeof globalThis.fetch = async function (req) {
      assertRequest(req);
      assert.strictEqual(req.headers.get('Authorization'), null);
      return new Response('Forbidden', { status: 403 });
    };
    let fetch = fetcher(fetchImplementation, [authorizationMiddleware()]);
    let response = await fetch(req);
    assert.strictEqual(response.status, 403);
  });

  test('an existing token is applied to a realm request', function (assert) {
    let handler = authorizationMiddleware();
  });

  // test('a 401 response from a non-realm site is left untouched', function (assert) {});

  // test('a 401 response from a realm site results in the request being retried with token, if available', function (assert) {});

  // test('a 401 response from a realm site does not result in the request being retried if no token can be retrieved', function (assert) {});

  // test('a 401 request when a token was provided results in informing the realm auth source of token failure and possibly retrying', function (assert) {});
});
