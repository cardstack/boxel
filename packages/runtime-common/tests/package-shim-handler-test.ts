import type { SharedTests } from '../helpers';
import {
  PackageShimHandler,
  PACKAGES_FAKE_ORIGIN,
  isRetryableShimResolveError,
  withResolveRetry,
  type ShimRetryLogger,
} from '../package-shim-handler';

// No-op logger so the retry-focused tests don't print warn/debug
// noise to CI output. The realm-server harness defaults to
// `LOG_LEVELS='*=info'`, so a real `loglevel` instance would emit a
// warn line on every retry — these tests deliberately exercise the
// retry path many times. The shape matches the `ShimRetryLogger`
// interface (only warn/debug are called from `withResolveRetry`).
let testLog: ShimRetryLogger = { warn: () => {}, debug: () => {} };

// Sleep stub that records each delay synchronously instead of
// burning real wallclock time. Tests inject this via the
// `delay` knob on `withResolveRetry` / `shimAsyncModule`.
function makeRecordedDelay() {
  let recorded: number[] = [];
  return {
    delay: async (ms: number) => {
      recorded.push(ms);
    },
    recorded,
  };
}

const tests: SharedTests<Record<string, never>> = Object.freeze({
  'returns the resolved module on first attempt when there is no failure':
    async (assert) => {
      let calls = 0;
      let wrapped = withResolveRetry('test:happy-path', testLog, async () => {
        calls++;
        return { x: 1 };
      });
      let result = await wrapped();
      assert.deepEqual(result, { x: 1 }, 'module returned verbatim');
      assert.strictEqual(calls, 1, 'no extra attempts on success');
    },

  'retries a transient ChunkLoadError up to the configured budget': async (
    assert,
  ) => {
    let calls = 0;
    let { delay, recorded } = makeRecordedDelay();
    let wrapped = withResolveRetry(
      'test:chunk-load',
      testLog,
      async () => {
        calls++;
        if (calls < 3) {
          let err = new Error(`Loading chunk 42 failed (timeout)`);
          err.name = 'ChunkLoadError';
          throw err;
        }
        return { ok: true };
      },
      { delay, retryDelaysMs: [10, 50, 200] },
    );
    let result = await wrapped();
    assert.deepEqual(result, { ok: true }, 'eventually succeeded');
    assert.strictEqual(calls, 3, 'failed twice, succeeded on third attempt');
    assert.deepEqual(
      recorded,
      [10, 50],
      'two backoff delays observed before the success',
    );
  },

  'fails fast on a non-retryable error without burning the retry budget':
    async (assert) => {
      let calls = 0;
      let { delay, recorded } = makeRecordedDelay();
      let wrapped = withResolveRetry(
        'test:syntax-error',
        testLog,
        async () => {
          calls++;
          throw new SyntaxError(`Unexpected token '<'`);
        },
        { delay, retryDelaysMs: [10, 50, 200] },
      );
      try {
        await wrapped();
        assert.ok(false, 'should have thrown');
      } catch (err: any) {
        assert.strictEqual(
          err?.name,
          'SyntaxError',
          'original error surfaced verbatim',
        );
      }
      assert.strictEqual(calls, 1, 'only one attempt for non-retryable error');
      assert.deepEqual(
        recorded,
        [],
        'no backoff delays consumed for non-retryable error',
      );
    },

  'after exhausting all retries, throws the last error from the resolver':
    async (assert) => {
      let calls = 0;
      let wrapped = withResolveRetry(
        'test:all-retries-fail',
        testLog,
        async () => {
          calls++;
          throw new Error(`Failed to fetch dynamically imported module: x.js`);
        },
        { delay: async () => {}, retryDelaysMs: [10, 50, 200] },
      );
      try {
        await wrapped();
        assert.ok(false, 'should have thrown after all retries');
      } catch (err: any) {
        assert.ok(
          /Failed to fetch dynamically imported module/.test(err?.message),
          `surfaces the last error verbatim, got: ${err?.message}`,
        );
      }
      assert.strictEqual(
        calls,
        4,
        'three retries plus the original attempt = four total calls',
      );
    },

  'isRetryableShimResolveError matches webpack ChunkLoadError': async (
    assert,
  ) => {
    let err = new Error('Loading chunk 12 failed (network error)');
    err.name = 'ChunkLoadError';
    assert.true(isRetryableShimResolveError(err));
  },

  'isRetryableShimResolveError matches generic chunk-load message': async (
    assert,
  ) => {
    assert.true(
      isRetryableShimResolveError(
        new Error('Loading chunk 7 failed.\nReason: timeout'),
      ),
    );
  },

  'isRetryableShimResolveError matches native dynamic-import network failure':
    async (assert) => {
      assert.true(
        isRetryableShimResolveError(
          new Error('Failed to fetch dynamically imported module: foo.js'),
        ),
      );
    },

  'isRetryableShimResolveError matches Chrome ERR_CONNECTION_RESET': async (
    assert,
  ) => {
    assert.true(
      isRetryableShimResolveError(
        new Error('net::ERR_CONNECTION_RESET while fetching x.js'),
      ),
    );
  },

  'isRetryableShimResolveError matches Node ECONNRESET via err.code': async (
    assert,
  ) => {
    let err: any = new Error('socket hang up');
    err.code = 'ECONNRESET';
    assert.true(isRetryableShimResolveError(err));
  },

  'isRetryableShimResolveError matches HTTP 502/503/504 — aligned with loader.ts policy':
    async (assert) => {
      assert.true(
        isRetryableShimResolveError(
          new Error('upstream returned HTTP 503 Service Unavailable'),
        ),
        '503',
      );
      assert.true(
        isRetryableShimResolveError(
          new Error('upstream returned HTTP 502 Bad Gateway'),
        ),
        '502',
      );
      assert.true(
        isRetryableShimResolveError(
          new Error('upstream returned HTTP 504 Gateway Timeout'),
        ),
        '504',
      );
      // 500 is NOT in the retryable set — see loader.ts's
      // RETRYABLE_STATUS_CODES comment for why.
      assert.false(
        isRetryableShimResolveError(
          new Error('upstream returned HTTP 500 Internal Server Error'),
        ),
        '500 (deliberately excluded)',
      );
    },

  'isRetryableShimResolveError does NOT match SyntaxError': async (assert) => {
    assert.false(isRetryableShimResolveError(new SyntaxError('bad token')));
  },

  'isRetryableShimResolveError does NOT match TypeError from module evaluation':
    async (assert) => {
      assert.false(
        isRetryableShimResolveError(new TypeError('foo.bar is not a function')),
      );
    },

  'isRetryableShimResolveError handles non-error inputs without throwing':
    async (assert) => {
      assert.false(isRetryableShimResolveError(null));
      assert.false(isRetryableShimResolveError(undefined));
      assert.false(isRetryableShimResolveError('string error'));
      assert.false(isRetryableShimResolveError(42));
    },

  'shimAsyncModule retries on transient resolver failure and ultimately serves the module':
    async (assert) => {
      let attempts = 0;
      let handler = new PackageShimHandler(
        (id) => `${PACKAGES_FAKE_ORIGIN}${id}`,
      );
      handler.shimAsyncModule(
        {
          id: 'flaky-module',
          resolve: async () => {
            attempts++;
            if (attempts < 2) {
              throw new Error('Failed to fetch dynamically imported module');
            }
            return { isFlaky: true };
          },
        },
        { delay: async () => {}, retryDelaysMs: [5, 5, 5] },
      );
      let response = await handler.handle(
        new Request(`${PACKAGES_FAKE_ORIGIN}flaky-module`),
      );
      assert.ok(response, 'handler returned a Response after retry');
      let shimmed = (response as any)?.[Symbol.for('shimmed-module')];
      assert.deepEqual(
        shimmed,
        { isFlaky: true },
        'shimmed-module reflects the eventually-resolved exports',
      );
      assert.strictEqual(attempts, 2, 'one retry was sufficient');
    },

  'shimAsyncModule returns null from handle() when the resolver throws permanently':
    async (assert) => {
      let handler = new PackageShimHandler(
        (id) => `${PACKAGES_FAKE_ORIGIN}${id}`,
      );
      handler.shimAsyncModule(
        {
          id: 'always-fails',
          resolve: async () => {
            throw new Error(
              'Failed to fetch dynamically imported module: always-fails',
            );
          },
        },
        { delay: async () => {}, retryDelaysMs: [1, 1] },
      );
      let response = await handler.handle(
        new Request(`${PACKAGES_FAKE_ORIGIN}always-fails`),
      );
      assert.strictEqual(
        response,
        null,
        'handler returns null after all retries failed (existing contract preserved)',
      );
    },
});

export default tests;
