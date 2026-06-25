import { module, test } from 'qunit';

import { shouldRetryFetch } from '@cardstack/runtime-common/virtual-network';

// `shouldRetryFetch` is the pure predicate that gates the in-app fetch-retry
// safety net (see virtual-network.ts). The net papers over a transient CI
// failure mode where base-realm artifact fetches occasionally vanish with
// `TypeError: Failed to fetch`. These tests pin exactly which URLs the net
// covers — and, just as importantly, which it deliberately does not.

function withEnvironment(value: string | undefined, fn: () => void) {
  let g = globalThis as { __environment?: string };
  let had = '__environment' in g;
  let prev = g.__environment;
  if (value === undefined) {
    delete g.__environment;
  } else {
    g.__environment = value;
  }
  try {
    fn();
  } finally {
    if (had) {
      g.__environment = prev;
    } else {
      delete g.__environment;
    }
  }
}

module('Unit | virtual-network shouldRetryFetch', function () {
  test('retries base-realm fetches addressed at the virtual cardstack.com host', function (assert) {
    withEnvironment('test', () => {
      assert.true(
        shouldRetryFetch(new URL('https://cardstack.com/base/style-reference')),
        'virtual base-realm URL is retryable',
      );
    });
  });

  test('retries base-realm fetches addressed at the real CI *.localhost host', function (assert) {
    withEnvironment('test', () => {
      // The exact shape that escaped as an uncaught `TypeError: Failed to
      // fetch` before the net covered it: a base-realm artifact requested at
      // the Traefik-fronted host rather than the virtual cardstack.com URL.
      assert.true(
        shouldRetryFetch(
          new URL('https://realm-server.ci.localhost/base/style-reference'),
        ),
        'base artifact at realm-server.ci.localhost is retryable',
      );
      assert.true(
        shouldRetryFetch(
          new URL('https://realm-server.ci.localhost/base/card-api'),
        ),
        'base module at the real host is retryable',
      );
    });
  });

  test('retries base-realm fetches on a bare localhost host', function (assert) {
    withEnvironment('test', () => {
      assert.true(
        shouldRetryFetch(
          new URL('https://localhost:4201/base/style-reference'),
        ),
        'base artifact on localhost is retryable',
      );
    });
  });

  test('does not retry non-base realms that share the real CI host', function (assert) {
    withEnvironment('test', () => {
      assert.false(
        shouldRetryFetch(
          new URL(
            'https://realm-server.ci.localhost/testuser/personal/Author/1',
          ),
        ),
        'a user realm on the same host keeps its no-retry behavior',
      );
      assert.false(
        shouldRetryFetch(new URL('http://test-realm/test/SystemCard/default')),
        'the in-browser test realm host is not retried',
      );
    });
  });

  test('does not retry anything outside the test environment', function (assert) {
    withEnvironment(undefined, () => {
      assert.false(
        shouldRetryFetch(new URL('https://cardstack.com/base/style-reference')),
        'production fetch flow is unaffected for the virtual URL',
      );
      assert.false(
        shouldRetryFetch(
          new URL('https://localhost:4201/base/style-reference'),
        ),
        'production fetch flow is unaffected for the localhost URL',
      );
    });
  });
});
