import type { SharedTests } from '../helpers';
import {
  PackageShimHandler,
  PACKAGES_FAKE_ORIGIN,
  ALLOW_MISSING_NAMED_EXPORTS,
  wrapWithStrictNamespace,
} from '../package-shim-handler';

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
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        let _missing = ns.markdownToHtml;
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
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        let _missing = shimmed.notExported;
        assert.ok(false, 'should have thrown on missing-key access');
      } catch (err: any) {
        assert.true(
          err instanceof ReferenceError,
          'served module is wrapped with the strict Proxy',
        );
      }
    },

  'PackageShimHandler error message names the requested URL — useful for cards that import from a typo URL':
    async (assert) => {
      let handler = new PackageShimHandler(
        (id) => `${PACKAGES_FAKE_ORIGIN}${id}`,
      );
      handler.shimModule('@cardstack/runtime-common', {
        Loader: class {},
        baseRealm: 'https://cardstack.com/base/',
      });
      let response = await handler.handle(
        new Request(`${PACKAGES_FAKE_ORIGIN}@cardstack/runtime-common`),
      );
      let shimmed = (response as any)?.[Symbol.for('shimmed-module')];
      try {
        // Re-create the deterministic whitepaper bug shape: a card
        // imports `markdownToHtml` from `@cardstack/runtime-common`,
        // which doesn't actually export that name.
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        let _ = shimmed.markdownToHtml;
        assert.ok(false, 'should have thrown');
      } catch (err: any) {
        assert.ok(
          /has no exported member 'markdownToHtml'/.test(err?.message ?? ''),
          `error names the missing export, got: ${err?.message}`,
        );
        assert.ok(
          /(@cardstack\/runtime-common)/.test(err?.message ?? ''),
          `error names the source module, got: ${err?.message}`,
        );
      }
    },
});

export default tests;
