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

      let error = await assert.rejects(
        guard.race(() => fetch('http://example.com/')),
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

  test('card errors with auth statuses are recognized without event flag', function (assert) {
    let guard = createAuthErrorGuard(window);
    let error = new CardError('Forbidden', { status: 403 });

    assert.true(
      guard.isAuthError(error),
      'auth guard treats 401/403 card errors as auth errors',
    );
  });
});
