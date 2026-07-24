import { module, test } from 'qunit';

import { VirtualNetwork } from '@cardstack/runtime-common';
import {
  shouldRetryFetch,
  shouldTimeoutRetryableFetch,
} from '@cardstack/runtime-common/virtual-network';

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

// `shouldTimeoutRetryableFetch` gates the header-arrival timeout that turns the
// second shape of the CI "vanish" — headers that never arrive, so the fetch
// hangs instead of throwing — into the same retryable failure the throw path
// already recovers from. It bounds only fetches that are already retryable, and
// only in the browser test suite: a slow response in node / worker / env-mode
// (e.g. a heavy `_search`) must never be aborted and retried.
module('Unit | virtual-network shouldTimeoutRetryableFetch', function () {
  test('bounds a retryable base-realm fetch in the test environment', function (assert) {
    withEnvironment('test', () => {
      assert.true(
        shouldTimeoutRetryableFetch(
          new URL('https://realm-server.ci.localhost/base/_info'),
        ),
        'the base _info fetch that hung in CI is bounded',
      );
      assert.true(
        shouldTimeoutRetryableFetch(
          new URL('https://cardstack.com/base/card-api'),
        ),
        'a virtual base-realm artifact is bounded',
      );
    });
  });

  test('does not bound a non-retryable fetch even in the test environment', function (assert) {
    withEnvironment('test', () => {
      assert.false(
        shouldTimeoutRetryableFetch(
          new URL(
            'https://realm-server.ci.localhost/testuser/personal/Author/1',
          ),
        ),
        'a user realm on the same host is not bounded',
      );
      assert.false(
        shouldTimeoutRetryableFetch(
          new URL('http://test-realm/test/SystemCard/default'),
        ),
        'the in-browser test realm host is not bounded',
      );
    });
  });

  test('does not bound anything outside the test environment', function (assert) {
    withEnvironment(undefined, () => {
      assert.false(
        shouldTimeoutRetryableFetch(
          new URL('https://cardstack.com/base/card-api'),
        ),
        'production / env-mode fetch flow keeps no header-timeout',
      );
    });
  });
});

// A native fetch whose first attempt stalls at the header stage (never
// resolves; rejects only when its request signal aborts, exactly as a real
// fetch does), then succeeds. Mirrors the CI failure where base/_info headers
// never arrived and the unbounded fetch hung until QUnit's global timeout.
function stallingThenOkFetch(): {
  fetch: typeof globalThis.fetch;
  attempts: () => number;
  signalSeen: () => boolean;
} {
  let attempt = 0;
  let sawAbort = false;
  let fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    attempt++;
    let signal =
      input instanceof Request ? input.signal : (init?.signal ?? undefined);
    if (attempt === 1) {
      return new Promise<Response>((_resolve, reject) => {
        if (!signal) {
          return; // no signal wired => hang (fix broken); QUnit will time out
        }
        let onAbort = () => {
          sawAbort = true;
          reject(signal.reason);
        };
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
      });
    }
    return Promise.resolve(
      new Response('{"ok":true}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as typeof globalThis.fetch;
  return { fetch, attempts: () => attempt, signalSeen: () => sawAbort };
}

module('Unit | virtual-network header-stall recovery', function () {
  test('aborts a stalled retryable base fetch and recovers on the retry', async function (assert) {
    let g = globalThis as { __environment?: string };
    let had = '__environment' in g;
    let prev = g.__environment;
    g.__environment = 'test';
    try {
      let { fetch, attempts, signalSeen } = stallingThenOkFetch();
      // Tiny header timeout so the stalled first attempt is aborted promptly;
      // the second attempt then succeeds.
      let vn = new VirtualNetwork(fetch, { fetchHeaderTimeoutMs: 20 });
      // The host reaches the base realm through a virtual-to-real URL mapping,
      // so exercise that path: the per-attempt timeout signal is attached
      // before the mapping runs and must survive the request being rebuilt at
      // the mapped URL, or the native fetch never sees the abort.
      vn.addURLMapping(
        new URL('https://cardstack.com/base/'),
        new URL('https://realm-server.ci.localhost/base/'),
      );
      let response = await vn.fetch('https://cardstack.com/base/card-api');
      assert.strictEqual(
        response.status,
        200,
        'recovered with a 200 after the stalled attempt was aborted',
      );
      assert.true(
        attempts() >= 2,
        'the stalled first attempt was retried on a fresh fetch',
      );
      assert.true(
        signalSeen(),
        'the native fetch received an abort signal through the URL mapping',
      );
    } finally {
      if (had) {
        g.__environment = prev;
      } else {
        delete g.__environment;
      }
    }
  });
});
