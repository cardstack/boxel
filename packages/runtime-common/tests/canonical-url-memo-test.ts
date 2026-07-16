import type { VirtualNetwork } from '../virtual-network.ts';
import {
  canonicalURL,
  type CanonicalURLMemo,
} from '../index-runner/dependency-url.ts';
import type { SharedTests } from '../helpers/index.ts';

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

const tests = Object.freeze({
  'canonicalURL returns the same result with and without a memo': async (
    assert,
  ) => {
    let { network } = makeStubNetwork();
    let memo: CanonicalURLMemo = new Map();
    let withoutMemo = canonicalURL('./b.gts', 'http://test/dir/a.gts', network);
    let withMemo = canonicalURL(
      './b.gts',
      'http://test/dir/a.gts',
      network,
      memo,
    );
    assert.strictEqual(withMemo, withoutMemo);
    assert.strictEqual(withMemo, 'http://test/dir/b.gts');
  },

  'canonicalURL skips resolveURL on a memo hit': async (assert) => {
    let { network, resolveCount } = makeStubNetwork();
    let memo: CanonicalURLMemo = new Map();
    let first = canonicalURL('./b.gts', 'http://test/dir/a.gts', network, memo);
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
  },

  'canonicalURL keys the memo on relativeTo': async (assert) => {
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
  },

  'clearing the memo forces recomputation': async (assert) => {
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
  },
} as SharedTests<{}>);

export default tests;
