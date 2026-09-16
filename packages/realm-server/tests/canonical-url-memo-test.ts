import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { VirtualNetwork } from '@cardstack/runtime-common/virtual-network';
import {
  canonicalURL,
  type CanonicalURLMemo,
} from '@cardstack/runtime-common/index-runner/dependency-url';

// A minimal VirtualNetwork stand-in that resolves relative references with the
// platform URL parser and counts how often `resolveURL` runs, so a test can
// observe when a memo hit skips resolution. `isRegisteredPrefix` returns false
// to force every input through the resolve path.
function makeStubNetwork(): {
  network: VirtualNetwork;
  resolveCount: () => number;
} {
  let resolveCalls = 0;
  let network = {
    isRegisteredPrefix(_reference: string) {
      return false;
    },
    resolveURL(reference: string, relativeTo: URL | string | undefined) {
      resolveCalls++;
      return new URL(reference, relativeTo ?? undefined);
    },
    unresolveURL(url: string) {
      return url;
    },
  } as unknown as VirtualNetwork;
  return { network, resolveCount: () => resolveCalls };
}

module(basename(import.meta.filename), function () {
  module('canonicalURL pass-scoped memo', function () {
    test('returns the same result with and without a memo', function (assert) {
      let { network } = makeStubNetwork();
      let memo: CanonicalURLMemo = new Map();
      let withoutMemo = canonicalURL(
        './b.gts',
        'http://test/dir/a.gts',
        network,
      );
      let withMemo = canonicalURL(
        './b.gts',
        'http://test/dir/a.gts',
        network,
        memo,
      );
      assert.strictEqual(withMemo, withoutMemo);
      assert.strictEqual(withMemo, 'http://test/dir/b.gts');
    });

    test('skips resolveURL on a memo hit', function (assert) {
      let { network, resolveCount } = makeStubNetwork();
      let memo: CanonicalURLMemo = new Map();
      let first = canonicalURL(
        './b.gts',
        'http://test/dir/a.gts',
        network,
        memo,
      );
      let second = canonicalURL(
        './b.gts',
        'http://test/dir/a.gts',
        network,
        memo,
      );
      assert.strictEqual(first, second);
      assert.strictEqual(
        resolveCount(),
        1,
        'resolveURL runs once for a repeated (relativeTo, url) pair',
      );
    });

    test('keys the memo on relativeTo', function (assert) {
      let { network, resolveCount } = makeStubNetwork();
      let memo: CanonicalURLMemo = new Map();
      let underA = canonicalURL(
        './b.gts',
        'http://test/dir-a/a.gts',
        network,
        memo,
      );
      let underB = canonicalURL(
        './b.gts',
        'http://test/dir-b/a.gts',
        network,
        memo,
      );
      assert.strictEqual(underA, 'http://test/dir-a/b.gts');
      assert.strictEqual(underB, 'http://test/dir-b/b.gts');
      assert.strictEqual(
        resolveCount(),
        2,
        'the same url under a different relativeTo resolves separately',
      );
    });

    test('recomputes after the memo is cleared', function (assert) {
      let { network, resolveCount } = makeStubNetwork();
      let memo: CanonicalURLMemo = new Map();
      canonicalURL('./b.gts', 'http://test/dir/a.gts', network, memo);
      memo.clear();
      canonicalURL('./b.gts', 'http://test/dir/a.gts', network, memo);
      assert.strictEqual(
        resolveCount(),
        2,
        'a cleared memo recomputes on the next call',
      );
    });

    test('Lattice: absolute and prefix dependencies are shared across card bases', function (assert) {
      let network = new VirtualNetwork();
      network.addRealmMapping('@lattice/test/', 'http://test/realm/');
      let memo: CanonicalURLMemo = new Map();
      let dependencies = [
        'http://test/realm/person.gts?version=1#export',
        '@lattice/test/person.gts?version=1#export',
        `@lattice/test/person.gts.${'YQ'.repeat(500)}.glimmer-scoped.css`,
      ];
      let expected = dependencies.map((dep) =>
        canonicalURL(dep, 'http://test/realm/first.json', network),
      );
      let correct = true;
      for (let i = 0; i < 10_000; i++) {
        for (let [j, dep] of dependencies.entries()) {
          correct &&=
            canonicalURL(
              dep,
              `http://test/realm/card-${i}.json`,
              network,
              memo,
            ) === expected[j];
        }
      }
      assert.true(correct, 'all canonical dependency identities are preserved');
      assert.strictEqual(
        memo.size,
        dependencies.length,
        'one key per dependency',
      );
    });

    test('Lattice: root-relative and protocol-relative references still depend on their base', function (assert) {
      let network = new VirtualNetwork();
      let memo: CanonicalURLMemo = new Map();
      for (let base of ['http://one.test/a/', 'https://two.test/b/']) {
        for (let dep of [
          './card',
          '/card',
          '//cdn.test/style.css',
          'https:card',
        ]) {
          assert.strictEqual(
            canonicalURL(dep, base, network, memo),
            canonicalURL(dep, base, network),
            `${dep} under ${base}`,
          );
        }
      }
    });

    test('Lattice: unique inputs and oversized CSS do not grow the memo without bound', function (assert) {
      let network = new VirtualNetwork();
      let memo: CanonicalURLMemo = new Map();
      for (let i = 0; i < 25_000; i++) {
        canonicalURL(
          './card',
          `http://test/dir-${i}/source.json`,
          network,
          memo,
        );
      }
      assert.true(
        memo.size <= 20_000,
        'unique relative inputs have a fixed cap',
      );
      assert.strictEqual(
        canonicalURL('./card', 'http://test/dir-0/source.json', network, memo),
        'http://test/dir-0/card',
        'an evicted entry is recomputed correctly',
      );
      let size = memo.size;
      let css = `http://test/view.gts.${'YQ'.repeat(10_000)}.glimmer-scoped.css`;
      assert.strictEqual(
        canonicalURL(css, 'http://test/source.json', network, memo),
        css,
        'oversized CSS remains a dependency',
      );
      assert.strictEqual(
        memo.size,
        size,
        'oversized identifiers bypass the cache',
      );
    });
  });
});
