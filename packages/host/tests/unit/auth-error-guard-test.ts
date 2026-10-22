import { module, test } from 'qunit';

import { fetcher, CardError } from '@cardstack/runtime-common';

import {
  authErrorEventMiddleware,
  createAuthErrorGuard,
} from '@cardstack/host/utils/auth-error-guard';

module('Unit | auth-error-guard', function () {
  test('middleware emits auth error events that cancel in-flight requests', async function (assert) {
    assert.expect(2);

    let guard = createAuthErrorGuard(window);
    guard.register();

    try {
      let fetch = fetcher(
        async () => new Response('Unauthorized', { status: 401 }),
        [authErrorEventMiddleware(window)],
      );

      let error: unknown;
      await assert.rejects(
        guard
          .race(() => fetch('http://example.com/'))
          .catch((err) => {
            error = err;
            throw err;
          }),
        /Unauthorized/,
      );

      assert.true(
        guard.isAuthError(error),
        'auth guard recognizes middleware-dispatched auth errors',
      );
    } finally {
      guard.unregister();
    }
  });

  test('a refused stylesheet emits no auth error, so a render in flight carries on', async function (assert) {
    let guard = createAuthErrorGuard(window);
    guard.register();

    try {
      let fetch = fetcher(
        async () => new Response('Unauthorized', { status: 401 }),
        [authErrorEventMiddleware(window)],
      );

      let response = await fetch(
        'http://example.com/realm/_scoped-css/card-api.gts.md5-9f2a6167417f22c4ff73303301a5b99a.glimmer-scoped.css',
      );
      assert.strictEqual(
        response.status,
        401,
        'the stylesheet request answers its refusal to its own caller',
      );

      let next = await guard.race(async () => 'rendered');
      assert.strictEqual(
        next,
        'rendered',
        'and nothing is latched to fail the next step of the render',
      );
    } finally {
      guard.unregister();
    }
  });

  test('card errors with auth statuses are recognized without event flag', function (assert) {
    let guard = createAuthErrorGuard(window);
    let error = new CardError('Forbidden', { status: 403 });

    assert.true(
      guard.isAuthError(error),
      'auth guard treats 401/403 card errors as auth errors',
    );
  });
});
