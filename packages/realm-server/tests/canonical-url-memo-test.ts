import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { VirtualNetwork } from '@cardstack/runtime-common/virtual-network';
import {
  canonicalURL,
  CANONICAL_URL_MEMO_MAX_ENTRIES,
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

    test('every kind of reference resolves as it does without a memo', function (assert) {
      let { network } = makeStubNetwork();
      let memo: CanonicalURLMemo = new Map();
      let bases = [
        'http://test/dir/a.gts',
        'http://test/dir/b.json',
        'http://test/other/c.json?x=1#y',
        'http://test/a.json',
        'http://elsewhere/dir/a.gts',
      ];
      let refs = [
        './b.gts',
        '../up.gts',
        'sibling',
        '/root.gts',
        'http://test/abs.gts',
        'http://test/abs.gts?q=1#h',
        '?only-query',
        '#only-hash',
        '',
      ];
      for (let i = 0; i < 2; i++) {
        for (let base of bases) {
          for (let ref of refs) {
            assert.strictEqual(
              canonicalURL(ref, base, network, memo),
              canonicalURL(ref, base, network),
              `${JSON.stringify(ref)} against ${base}`,
            );
          }
        }
      }
    });

    test('an absolute reference resolves once for every card that has it', function (assert) {
      let { network, resolveCount } = makeStubNetwork();
      let memo: CanonicalURLMemo = new Map();
      for (let i = 0; i < 100; i++) {
        canonicalURL(
          'http://test/person.gts',
          `http://test/Person/${i}.json`,
          network,
          memo,
        );
      }
      assert.strictEqual(resolveCount(), 1);
      assert.strictEqual(memo.size, 1);
    });

    test('a relative reference resolves once per directory', function (assert) {
      let { network, resolveCount } = makeStubNetwork();
      let memo: CanonicalURLMemo = new Map();
      for (let i = 0; i < 100; i++) {
        canonicalURL('../person', `http://test/Person/${i}.json`, network, memo);
        canonicalURL('../person', `http://test/Pet/${i}.json`, network, memo);
      }
      assert.strictEqual(resolveCount(), 2, 'one per directory');
      assert.strictEqual(
        canonicalURL('../person', 'http://test/Pet/7.json', network, memo),
        'http://test/person',
      );
    });

    test("a realm-sized pass keeps the memo to its references, not its cards", function (assert) {
      let { network } = makeStubNetwork();
      let memo: CanonicalURLMemo = new Map();
      let deps = [
        'http://test/person.gts',
        'https://cardstack.com/base/card-api',
        '../person',
        './friend',
        '/shared.gts',
      ];
      for (let i = 0; i < 10_000; i++) {
        for (let dep of deps) {
          canonicalURL(dep, `http://test/Person/${i}.json`, network, memo);
        }
      }
      assert.strictEqual(memo.size, deps.length);
    });

    test('the memo starts over past its ceiling', function (assert) {
      let { network } = makeStubNetwork();
      let memo: CanonicalURLMemo = new Map();
      for (let i = 0; i <= CANONICAL_URL_MEMO_MAX_ENTRIES; i++) {
        canonicalURL(`http://test/${i}.gts`, undefined, network, memo);
      }
      assert.ok(memo.size <= CANONICAL_URL_MEMO_MAX_ENTRIES);
      assert.strictEqual(
        canonicalURL('http://test/after.gts', undefined, network, memo),
        'http://test/after.gts',
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
  });
});
