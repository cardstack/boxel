import type { RenderingTestContext } from '@ember/test-helpers';
import { waitUntil, settled } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import { baseRealm, Loader, clearFetchCache } from '@cardstack/runtime-common';

import {
  testRealmURL,
  setupCardLogs,
  setupLocalIndexing,
  setupIntegrationTestRealm,
} from '../helpers';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupRenderingTest } from '../helpers/setup';

// --- local test utils -------------------------------------------------------

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  let promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// --- tests ------------------------------------------------------------------

module('Unit | loader prefetch', function (hooks) {
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);
  let mockMatrixUtils = setupMockMatrix(hooks);

  let loader: Loader;

  hooks.beforeEach(async function (this: RenderingTestContext) {
    loader = getService('loader-service').loader;

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        // Base prefetch fixtures
        'prefetch/main.js': `
          import { slowValue } from './slow-dep';
          export function mainValue() { return slowValue; }
        `,
        'prefetch/slow-dep.js': `
          export const slowValue = 'slow';
        `,

        // Broken dependency fixtures
        'prefetch/broken-main.js': `
          import './broken-dep';
          export function usesBroken() { return true; }
        `,
        'prefetch/broken-dep.js': `
          export const shouldNotLoad = true;
        `,

        // Shared dep fixtures
        'prefetch/shared-parent.js': `
          import { shared } from './shared-dep';
          export function parent() { return shared; }
        `,
        'prefetch/shared-dep.js': `
          export const shared = 'shared';
        `,

        // Two-parents race fixtures
        'prefetch/parent-a.js': `
          import { shared } from './shared-dep';
          export const a = shared;
        `,
        'prefetch/parent-b.js': `
          import { shared } from './shared-dep';
          export const b = shared;
        `,

        // Transitive prefetch fixtures
        'prefetch/deep-main.js': `
          import './mid';
          export const ok = true;
        `,
        'prefetch/mid.js': `
          import { leaf } from './leaf';
          export const mid = leaf;
        `,
        'prefetch/leaf.js': `
          export const leaf = 'leaf';
        `,

        // Shim fixture (no file for './shimmed' on purpose; it's shimmed)
        'prefetch/uses-shim.js': `
          import { x } from './shimmed';
          export const y = x;
        `,
      },
    });
  });

  setupCardLogs(
    hooks,
    async () => await loader.import(`${baseRealm.url}card-api`),
  );

  test('prefetch kicks off dependency fetch without waiting for completion', async function (assert) {
    assert.expect(4);

    let mainURL = `${testRealmURL}prefetch/main.js`;
    let depURL = `${testRealmURL}prefetch/slow-dep.js`;
    let trimmedDepURL = depURL.replace(/\.js$/, '');

    clearFetchCache();

    let testLoader = Loader.cloneLoader(loader);

    let depGate = createDeferred<void>();
    let depFetchStarted = false;
    let originalFetch = (testLoader as any).fetchImplementation;

    (testLoader as any).fetchImplementation = async (
      input: Request,
      init?: RequestInit,
    ) => {
      let url = input.url;
      if (url === depURL || url === trimmedDepURL) {
        depFetchStarted = true;
        await depGate.promise; // hold the dependency fetch open
      }
      return originalFetch.call(testLoader, input, init);
    };

    try {
      // Only fetch the parent module; this triggers prefetch for its dep
      await (testLoader as any).fetchModule(new URL(mainURL));

      // Wait until prefetch has actually attempted the dependency
      await waitUntil(() => depFetchStarted, { timeout: 1500 });

      assert.true(depFetchStarted, 'dependency fetch started during prefetch');

      // @ts-expect-error TS2341: getModule is private, but this test exercises loader internals directly.
      let depModule = testLoader.getModule(depURL);
      assert.ok(depModule, 'dependency module entry exists');
      assert.strictEqual(
        (depModule as any).state,
        'fetching',
        'dependency is marked fetching',
      );

      // Let the dependency fetch finish, then it should register
      depGate.resolve();
      await (depModule as any).deferred.promise;

      // @ts-expect-error TS2341: accessing private loader internals lets us assert intermediate prefetch state.
      let depAfter = testLoader.getModule(depURL);
      assert.strictEqual(
        (depAfter as any).state,
        'registered',
        'dependency finishes registration after fetch completes',
      );
    } finally {
      depGate.resolve();
      (testLoader as any).fetchImplementation = originalFetch;
    }
  });

  test('prefetch surfaces dependency failures when dependency import is requested', async function (assert) {
    assert.expect(5);

    let mainURL = `${testRealmURL}prefetch/broken-main.js`;
    let depURL = `${testRealmURL}prefetch/broken-dep.js`;
    let trimmedDepURL = depURL.replace(/\.js$/, '');

    clearFetchCache();

    let testLoader = Loader.cloneLoader(loader);

    let depFetchAttempted = false;
    let originalFetch = (testLoader as any).fetchImplementation;

    (testLoader as any).fetchImplementation = async (
      input: Request,
      init?: RequestInit,
    ) => {
      let url = input.url;

      if (url === depURL || url === trimmedDepURL) {
        depFetchAttempted = true;
        // Simulate network failure for the dependency. Loader._fetch will catch and
        // convert this into a failing Response, which becomes a CardError.
        throw new Error('boom from dep');
      }
      return originalFetch.call(testLoader, input, init);
    };

    try {
      // Fetch the parent to trigger prefetch; the dep fetch fails under the hood
      await (testLoader as any).fetchModule(new URL(mainURL));
      await waitUntil(() => depFetchAttempted, { timeout: 1500 });

      assert.true(depFetchAttempted, 'prefetch attempted dependency fetch');

      await assert.rejects(
        testLoader.import(mainURL),
        (e: any) => e.id === trimmedDepURL,
        'importing parent surfaces dependency failure with correct URL',
      );

      // @ts-expect-error TS2341: we explicitly reach into the loader to confirm the broken dependency bookkeeping.
      let depModule = testLoader.getModule(depURL);
      assert.strictEqual(
        (depModule as any)?.state,
        'broken',
        'broken dependency recorded',
      );
      assert.ok(
        (depModule as any)?.exception.id === trimmedDepURL,
        'broken dependency error corresponds to dependency URL',
      );

      await assert.rejects(
        testLoader.import(depURL),
        (e: any) => e.id === trimmedDepURL,
        'importing dependency directly surfaces failure',
      );
    } finally {
      (testLoader as any).fetchImplementation = originalFetch;
    }
  });

  test('prefetch avoids duplicate network requests for dependencies', async function (assert) {
    assert.expect(4);

    let mainURL = `${testRealmURL}prefetch/shared-parent.js`;
    let depURL = `${testRealmURL}prefetch/shared-dep.js`;
    let trimmedDepURL = depURL.replace(/\.js$/, '');

    clearFetchCache();

    let testLoader = Loader.cloneLoader(loader);
    let fetchCount = new Map<string, number>();
    let originalFetch = (testLoader as any).fetchImplementation;

    (testLoader as any).fetchImplementation = async (
      input: Request,
      init?: RequestInit,
    ) => {
      let url = input.url;
      fetchCount.set(url, (fetchCount.get(url) ?? 0) + 1);
      return originalFetch.call(testLoader, input, init);
    };

    try {
      // Import the parent (which will prefetch child), then allow async to settle
      await testLoader.import(mainURL);
      await settled();

      let rawCount = fetchCount.get(depURL) ?? 0;
      let trimmedCount = fetchCount.get(trimmedDepURL) ?? 0;
      assert.strictEqual(
        rawCount,
        0,
        'prefetch tracks requests under trimmed identifier',
      );
      assert.strictEqual(
        trimmedCount,
        1,
        'dependency fetched once during parent import',
      );

      // Later explicit import of the dependency should not refetch
      await testLoader.import(depURL);
      await settled();

      rawCount = fetchCount.get(depURL) ?? 0;
      trimmedCount = fetchCount.get(trimmedDepURL) ?? 0;
      assert.strictEqual(rawCount, 0, 'raw module id remained unfetched');
      assert.strictEqual(
        trimmedCount,
        1,
        'prefetched dependency reused without refetch',
      );
    } finally {
      (testLoader as any).fetchImplementation = originalFetch;
    }
  });

  test('prefetch dedupes when two parents race on the same dependency', async function (assert) {
    assert.expect(3);

    let parentA = `${testRealmURL}prefetch/parent-a.js`;
    let parentB = `${testRealmURL}prefetch/parent-b.js`;
    let depURL = `${testRealmURL}prefetch/shared-dep.js`;
    let trimmedDepURL = depURL.replace(/\.js$/, '');

    clearFetchCache();

    let testLoader = Loader.cloneLoader(loader);

    // Gate the shared dependency so both parents try to prefetch it before it resolves
    let gate = createDeferred<void>();
    let fetchCount = 0;

    let originalFetch = (testLoader as any).fetchImplementation;
    (testLoader as any).fetchImplementation = async (
      input: Request,
      init?: RequestInit,
    ) => {
      let url = input.url;
      if (url === depURL || url === trimmedDepURL) {
        fetchCount++;
        await gate.promise;
      }
      return originalFetch.call(testLoader, input, init);
    };

    try {
      await Promise.all([
        (testLoader as any).fetchModule(new URL(parentA)),
        (testLoader as any).fetchModule(new URL(parentB)),
      ]);

      // Wait until one fetch attempt for the shared child is in flight
      await waitUntil(() => fetchCount >= 1, { timeout: 1500 });

      assert.strictEqual(
        fetchCount,
        1,
        'only one network fetch issued for shared dependency',
      );

      // Unblock and ensure the dependency registers once
      gate.resolve();
      // @ts-expect-error TS2341: intentional access to private loader state to observe the shared dependency.
      let child = testLoader.getModule(depURL)!;
      await (child as any).deferred.promise;

      // @ts-expect-error TS2341: intentional access to private loader state to observe the shared dependency.
      let after = testLoader.getModule(depURL)!;
      assert.ok(after, 'child module present after resolve');
      assert.strictEqual(
        (after as any).state,
        'registered',
        'child registered once',
      );
    } finally {
      gate.resolve();
      (testLoader as any).fetchImplementation = originalFetch;
    }
  });

  test('prefetch cascades to transitive dependencies and avoids refetch', async function (assert) {
    assert.expect(3);

    let main = `${testRealmURL}prefetch/deep-main.js`;
    let mid = `${testRealmURL}prefetch/mid.js`;
    let leaf = `${testRealmURL}prefetch/leaf.js`;
    let leafTrim = leaf.replace(/\.js$/, '');

    clearFetchCache();

    let testLoader = Loader.cloneLoader(loader);

    let counts = new Map<string, number>();
    let originalFetch = (testLoader as any).fetchImplementation;
    (testLoader as any).fetchImplementation = async (
      input: Request,
      init?: RequestInit,
    ) => {
      let url = input.url;
      counts.set(url, (counts.get(url) ?? 0) + 1);
      return originalFetch.call(testLoader, input, init);
    };

    try {
      // Only fetch the top-level parent; this should cascade prefetch to mid and leaf
      await (testLoader as any).fetchModule(new URL(main));
      await settled();

      assert.strictEqual(
        counts.get(leafTrim),
        1,
        'leaf fetched once via prefetch (under trimmed id)',
      );

      // Later explicit import of leaf should not refetch
      await testLoader.import(leaf);
      await settled();
      assert.strictEqual(
        counts.get(leafTrim),
        1,
        'leaf not refetched on direct import',
      );

      // Import of mid should also not induce additional fetches
      await testLoader.import(mid);
      await settled();
      assert.ok(true, 'mid imported without additional network fetches');
    } finally {
      (testLoader as any).fetchImplementation = originalFetch;
    }
  });

  test('prefetch skips shimmed modules', async function (assert) {
    assert.expect(1);

    let testLoader = Loader.cloneLoader(loader);
    let shimmedId = `${testRealmURL}prefetch/shimmed`;
    testLoader.shimModule(shimmedId, { x: 1 });

    // Parent that depends on shimmed child
    let main = `${testRealmURL}prefetch/uses-shim.js`;

    let called = false;
    let originalFetch = (testLoader as any).fetchImplementation;
    (testLoader as any).fetchImplementation = async (
      input: Request,
      init?: RequestInit,
    ) => {
      let url = input.url;
      if (url.includes('/prefetch/shimmed')) {
        called = true;
      }
      return originalFetch.call(testLoader, input, init);
    };

    try {
      await (testLoader as any).fetchModule(new URL(main));
      await settled();
      assert.false(called, 'no network fetch attempted for shimmed dependency');
    } finally {
      (testLoader as any).fetchImplementation = originalFetch;
    }
  });
});
