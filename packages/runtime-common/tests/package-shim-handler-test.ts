import type { SharedTests } from '../helpers/index.ts';
import {
  PackageShimHandler,
  PACKAGES_FAKE_ORIGIN,
  ALLOW_MISSING_NAMED_EXPORTS,
  wrapWithStrictNamespace,
  isRetryableShimResolveError,
  withResolveRetry,
  describeShimError,
  type ShimRetryLogger,
} from '../package-shim-handler.ts';

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
  'wrapWithStrictNamespace returns existing exports unchanged': async (
    assert,
  ) => {
    let ns = wrapWithStrictNamespace('@cardstack/runtime-common', {
      foo: 1,
      bar: 'hello',
    });
    assert.strictEqual(ns.foo, 1, 'numeric export passes through');
    assert.strictEqual(ns.bar, 'hello', 'string export passes through');
  },

  'wrapWithStrictNamespace throws ReferenceError on missing string-key access':
    async (assert) => {
      let ns = wrapWithStrictNamespace('@cardstack/runtime-common', {
        existing: 'value',
      });
      try {
        // `void` to invoke the property access for its side effect
        // (the Proxy throws) without binding the result. `let _ = …`
        // would trip TS's noUnusedLocals despite the eslint-disable.
        void ns.markdownToHtml;
        assert.ok(false, 'should have thrown on missing-key access');
      } catch (err: any) {
        assert.true(
          err instanceof ReferenceError,
          'throws ReferenceError (matches the JS spec for unresolved bindings)',
        );
        assert.ok(
          /has no exported member 'markdownToHtml'/.test(err?.message ?? ''),
          `error message names the missing export, got: ${err?.message}`,
        );
        assert.ok(
          /'@cardstack\/runtime-common'/.test(err?.message ?? ''),
          `error message names the source module, got: ${err?.message}`,
        );
      }
    },

  'wrapWithStrictNamespace allows `in` checks without throwing': async (
    assert,
  ) => {
    let ns = wrapWithStrictNamespace('@cardstack/runtime-common', {
      foo: 1,
    });
    assert.true('foo' in ns, 'present key reports as in');
    assert.false('bar' in ns, 'missing key reports as not in (no throw)');
  },

  'wrapWithStrictNamespace allows Object.keys to enumerate present exports':
    async (assert) => {
      let ns = wrapWithStrictNamespace('@cardstack/runtime-common', {
        a: 1,
        b: 2,
      });
      assert.deepEqual(
        Object.keys(ns).sort(),
        ['a', 'b'],
        'Object.keys works without triggering the strict get trap',
      );
    },

  'wrapWithStrictNamespace passes Symbol gets through without throwing': async (
    assert,
  ) => {
    let ns = wrapWithStrictNamespace('@cardstack/runtime-common', {
      foo: 1,
    });
    // Random symbol access — common in framework internals (e.g.
    // Glimmer's tagged values). The Proxy must not throw on these.
    let testSymbol = Symbol.for('boxel-test:does-not-exist');
    assert.strictEqual(
      (ns as any)[testSymbol],
      undefined,
      'symbol access passes through and returns the underlying value',
    );
  },

  'wrapWithStrictNamespace allows runtime-probe `then` (await thenable detection)':
    async (assert) => {
      let ns = wrapWithStrictNamespace('@cardstack/runtime-common', {
        someExport: 1,
      });
      // `await ns` does `Reflect.get(value, 'then')`. The Proxy must
      // not throw on this — otherwise every awaited shimmed module
      // breaks (we hit exactly this regression in CI: cascading
      // `ReferenceError: Module '...' has no exported member 'then'`
      // across host / matrix / realm-server suites).
      let resolved = await Promise.resolve(ns);
      assert.strictEqual(
        resolved,
        ns,
        'await on a shimmed namespace returns the namespace (treated as non-thenable)',
      );
      assert.strictEqual(
        (ns as any).then,
        undefined,
        '`.then` access returns undefined without throwing',
      );
    },

  'wrapWithStrictNamespace allows runtime-probe `__esModule`, `toJSON`, and Object.prototype methods':
    async (assert) => {
      let ns = wrapWithStrictNamespace('@cardstack/runtime-common', {
        someExport: 1,
      });
      // `__esModule` is what CJS/ESM interop bridges probe to decide
      // how to import the default. Should be undefined, not a throw.
      assert.strictEqual(
        (ns as any).__esModule,
        undefined,
        '__esModule probe returns undefined without throwing',
      );
      // `toJSON` is what `JSON.stringify(ns)` probes for.
      assert.strictEqual(
        (ns as any).toJSON,
        undefined,
        'toJSON probe returns undefined without throwing',
      );
      // Object.prototype methods inherited via the prototype chain.
      assert.strictEqual(
        typeof (ns as any).toString,
        'function',
        'toString returns the inherited Object.prototype method',
      );
      assert.strictEqual(
        typeof (ns as any).hasOwnProperty,
        'function',
        'hasOwnProperty returns the inherited Object.prototype method',
      );
    },

  'wrapWithStrictNamespace honors the ALLOW_MISSING_NAMED_EXPORTS escape hatch':
    async (assert) => {
      let opted: any = { foo: 1 };
      opted[ALLOW_MISSING_NAMED_EXPORTS] = true;
      let ns = wrapWithStrictNamespace('@cardstack/runtime-common', opted);
      // Module that opts out of strict checking gets pre-Proxy
      // behavior — missing-key access returns undefined, no throw.
      assert.strictEqual(
        ns.somethingMissing,
        undefined,
        'opted-out module returns undefined for missing keys',
      );
      assert.strictEqual(ns.foo, 1, 'present keys still pass through');
    },

  'wrapWithStrictNamespace returns null/undefined namespaces unchanged': async (
    assert,
  ) => {
    assert.strictEqual(
      wrapWithStrictNamespace('x', null as any),
      null,
      'null passes through',
    );
    assert.strictEqual(
      wrapWithStrictNamespace('x', undefined as any),
      undefined,
      'undefined passes through',
    );
  },

  'PackageShimHandler#handle wraps the served module with the strict Proxy':
    async (assert) => {
      let handler = new PackageShimHandler(
        (id) => `${PACKAGES_FAKE_ORIGIN}${id}`,
      );
      handler.shimModule('test-module', { existing: 1 });
      let response = await handler.handle(
        new Request(`${PACKAGES_FAKE_ORIGIN}test-module`),
      );
      assert.ok(response, 'handler returned a Response');
      let shimmed = (response as any)?.[Symbol.for('shimmed-module')];
      assert.strictEqual(shimmed.existing, 1, 'present export readable');
      try {
        void shimmed.notExported;
        assert.ok(false, 'should have thrown on missing-key access');
      } catch (err: any) {
        assert.true(
          err instanceof ReferenceError,
          'served module is wrapped with the strict Proxy',
        );
      }
    },

  'PackageShimHandler error message names the full requested URL — useful for cards that import from a typo URL':
    async (assert) => {
      let handler = new PackageShimHandler(
        (id) => `${PACKAGES_FAKE_ORIGIN}${id}`,
      );
      handler.shimModule('@cardstack/runtime-common', {
        Loader: class {},
        baseRealm: '@cardstack/base/',
      });
      let requestUrl = `${PACKAGES_FAKE_ORIGIN}@cardstack/runtime-common`;
      let response = await handler.handle(new Request(requestUrl));
      let shimmed = (response as any)?.[Symbol.for('shimmed-module')];
      try {
        // Re-create the deterministic whitepaper bug shape: a card
        // imports `markdownToHtml` from `@cardstack/runtime-common`,
        // which doesn't actually export that name.
        void shimmed.markdownToHtml;
        assert.ok(false, 'should have thrown');
      } catch (err: any) {
        assert.ok(
          /has no exported member 'markdownToHtml'/.test(err?.message ?? ''),
          `error names the missing export, got: ${err?.message}`,
        );
        // Lock in that the FULL request URL is in the error — not
        // just the short module-id fragment. The
        // `https://packages/...` origin is what the loader's logs
        // and stack traces use, so an operator searching for it
        // should be able to find this error.
        assert.ok(
          (err?.message ?? '').includes(requestUrl),
          `error names the full request URL '${requestUrl}', got: ${err?.message}`,
        );
      }
    },

  'PackageShimHandler error message names the correct subpath when the symbol is exported from another shim':
    async (assert) => {
      let handler = new PackageShimHandler(
        (id) => `${PACKAGES_FAKE_ORIGIN}${id}`,
      );
      // The canonical footgun: `markdownToHtml` lives on the
      // `/marked-sync` subpath, not on the main runtime-common barrel.
      handler.shimModule('@cardstack/runtime-common', {
        Loader: class {},
        baseRealm: '@cardstack/base/',
      });
      handler.shimModule('@cardstack/runtime-common/marked-sync', {
        markdownToHtml: () => '',
      });
      let response = await handler.handle(
        new Request(`${PACKAGES_FAKE_ORIGIN}@cardstack/runtime-common`),
      );
      let shimmed = (response as any)?.[Symbol.for('shimmed-module')];
      try {
        void shimmed.markdownToHtml;
        assert.ok(false, 'should have thrown');
      } catch (err: any) {
        let message = err?.message ?? '';
        assert.ok(
          /has no exported member 'markdownToHtml'/.test(message),
          `error still names the missing export, got: ${message}`,
        );
        assert.ok(
          message.includes(
            'It is exported from `@cardstack/runtime-common/marked-sync`',
          ),
          `error names the correct source subpath, got: ${message}`,
        );
        assert.ok(
          message.includes(
            "try `import { markdownToHtml } from '@cardstack/runtime-common/marked-sync'`",
          ),
          `error shows a copy-pasteable corrected import, got: ${message}`,
        );
        // The suggestion replaces the generic "wrong module ID" advice.
        assert.notOk(
          /you may be importing from the wrong module ID/.test(message),
          `generic fallback advice is dropped when we have a concrete suggestion, got: ${message}`,
        );
        // The JS-undefined rationale is also dropped — the concrete fix
        // speaks for itself.
        assert.notOk(
          /silently produces `undefined`/.test(message),
          `generic JS-undefined rationale is dropped when we have a concrete suggestion, got: ${message}`,
        );
      }
    },

  'PackageShimHandler error message lists every shim that owns the symbol when more than one matches':
    async (assert) => {
      let handler = new PackageShimHandler(
        (id) => `${PACKAGES_FAKE_ORIGIN}${id}`,
      );
      handler.shimModule('@cardstack/runtime-common', { Loader: class {} });
      handler.shimModule('mod-a', { sharedHelper: () => 1 });
      handler.shimModule('mod-b', { sharedHelper: () => 2 });
      let response = await handler.handle(
        new Request(`${PACKAGES_FAKE_ORIGIN}@cardstack/runtime-common`),
      );
      let shimmed = (response as any)?.[Symbol.for('shimmed-module')];
      try {
        void shimmed.sharedHelper;
        assert.ok(false, 'should have thrown');
      } catch (err: any) {
        let message = err?.message ?? '';
        assert.ok(
          message.includes('`mod-a`') && message.includes('`mod-b`'),
          `error lists every shim that owns the symbol, got: ${message}`,
        );
        assert.ok(
          /It is exported from `mod-a` and `mod-b`/.test(message),
          `error joins multiple sources readably, got: ${message}`,
        );
      }
    },

  'PackageShimHandler error message falls back to the verbatim message for a typo no shim owns':
    async (assert) => {
      let handler = new PackageShimHandler(
        (id) => `${PACKAGES_FAKE_ORIGIN}${id}`,
      );
      handler.shimModule('@cardstack/runtime-common', { Loader: class {} });
      handler.shimModule('@cardstack/runtime-common/marked-sync', {
        markdownToHtml: () => '',
      });
      let response = await handler.handle(
        new Request(`${PACKAGES_FAKE_ORIGIN}@cardstack/runtime-common`),
      );
      let shimmed = (response as any)?.[Symbol.for('shimmed-module')];
      try {
        // Misspelled — no shim owns `markdownToHtm`, so we can't
        // suggest a subpath and keep today's generic guidance.
        void shimmed.markdownToHtm;
        assert.ok(false, 'should have thrown');
      } catch (err: any) {
        let message = err?.message ?? '';
        assert.ok(
          /has no exported member 'markdownToHtm'/.test(message),
          `error names the missing export, got: ${message}`,
        );
        assert.ok(
          /you may be importing from the wrong module ID/.test(message),
          `error keeps the verbatim fallback advice, got: ${message}`,
        );
        assert.notOk(
          /It is exported from/.test(message),
          `error does not fabricate a source when none matches, got: ${message}`,
        );
        // With no concrete fix to offer, the JS-undefined rationale is
        // kept — it justifies why this surfaces as an error at all.
        assert.ok(
          /silently produces `undefined`/.test(message),
          `JS-undefined rationale is kept in the fallback message, got: ${message}`,
        );
      }
    },

  'PackageShimHandler suggests an async-shimmed module once it has been served':
    async (assert) => {
      let handler = new PackageShimHandler(
        (id) => `${PACKAGES_FAKE_ORIGIN}${id}`,
      );
      handler.shimModule('@cardstack/runtime-common', { Loader: class {} });
      handler.shimAsyncModule({
        id: '@cardstack/runtime-common/marked-sync',
        resolve: async () => ({ markdownToHtml: () => '' }),
      });
      // Serve the async module so its exports get cached for lookup.
      await handler.handle(
        new Request(
          `${PACKAGES_FAKE_ORIGIN}@cardstack/runtime-common/marked-sync`,
        ),
      );
      let response = await handler.handle(
        new Request(`${PACKAGES_FAKE_ORIGIN}@cardstack/runtime-common`),
      );
      let shimmed = (response as any)?.[Symbol.for('shimmed-module')];
      try {
        void shimmed.markdownToHtml;
        assert.ok(false, 'should have thrown');
      } catch (err: any) {
        let message = err?.message ?? '';
        assert.ok(
          message.includes(
            'It is exported from `@cardstack/runtime-common/marked-sync`',
          ),
          `async shim is searchable after being served, got: ${message}`,
        );
      }
    },

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

  'describeShimError surfaces the transient signature from an Error message':
    async (assert) => {
      let described = describeShimError(
        new TypeError(
          'Failed to fetch dynamically imported module: https://packages/yaml',
        ),
      );
      assert.true(
        described.includes('Failed to fetch dynamically imported module'),
        'the chunk-fetch signature is interpolated into the string (not hidden as "[object Object]")',
      );
      assert.true(
        described.includes('TypeError'),
        'the error name is included',
      );
    },

  'describeShimError appends a Node socket error code when present': async (
    assert,
  ) => {
    let err = Object.assign(new Error('connect failed'), {
      code: 'ECONNRESET',
    });
    assert.strictEqual(
      describeShimError(err),
      'Error: connect failed (code ECONNRESET)',
      'err.code is appended so socket/DNS failures are identifiable',
    );
  },

  'describeShimError handles non-Error values without throwing': async (
    assert,
  ) => {
    assert.strictEqual(
      describeShimError('plain string failure'),
      'plain string failure',
      'a thrown string is returned verbatim',
    );
    assert.strictEqual(
      describeShimError({ status: 503 }),
      '{"status":503}',
      'a plain object is JSON-serialized',
    );
    // Values where `JSON.stringify` returns `undefined` (or throws) must
    // still produce a string, since the return type is `string`.
    assert.strictEqual(
      typeof describeShimError(undefined),
      'string',
      'a thrown `undefined` still yields a string, not `undefined`',
    );
    assert.strictEqual(
      typeof describeShimError(() => {}),
      'string',
      'a thrown function still yields a string',
    );
    assert.strictEqual(
      typeof describeShimError(10n),
      'string',
      'a bigint (which JSON.stringify throws on) still yields a string',
    );
  },
});

export default tests;
