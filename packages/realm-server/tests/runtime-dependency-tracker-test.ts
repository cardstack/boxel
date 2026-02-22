import { module, test } from 'qunit';
import { basename } from 'path';
import {
  Loader,
  beginRuntimeDependencyTrackingSession,
  endRuntimeDependencyTrackingSession,
  resetRuntimeDependencyTracker,
  snapshotRuntimeDependencies,
  trackRuntimeInstanceDependency,
  trackRuntimeModuleDependency,
  withRuntimeDependencyTrackingContext,
} from '@cardstack/runtime-common';

module(basename(__filename), function (hooks) {
  hooks.afterEach(() => {
    endRuntimeDependencyTrackingSession();
    resetRuntimeDependencyTracker();
  });

  test('resets tracked deps between sessions', async function (assert) {
    beginRuntimeDependencyTrackingSession({
      sessionKey: 'session-a',
      rootURL: 'https://example.com/root-a.json',
      rootKind: 'instance',
    });

    await withRuntimeDependencyTrackingContext(
      {
        mode: 'non-query',
        source: 'test:session-a',
        consumer: 'https://example.com/root-a.json',
        consumerKind: 'instance',
      },
      async () => {
        trackRuntimeInstanceDependency('https://example.com/first-dep');
      },
    );

    let firstSnapshot = snapshotRuntimeDependencies({ excludeQueryOnly: true });
    assert.true(
      firstSnapshot.deps.includes('https://example.com/first-dep.json'),
      'first session captures its dependency',
    );

    beginRuntimeDependencyTrackingSession({
      sessionKey: 'session-b',
      rootURL: 'https://example.com/root-b.json',
      rootKind: 'instance',
    });

    let secondSnapshot = snapshotRuntimeDependencies({
      excludeQueryOnly: true,
    });
    assert.deepEqual(
      secondSnapshot.deps,
      [],
      'new session does not inherit prior session deps',
    );
  });

  test('classifies async query-context deps as query-only', async function (assert) {
    beginRuntimeDependencyTrackingSession({
      sessionKey: 'async-query',
      rootURL: 'https://example.com/root.json',
      rootKind: 'instance',
    });

    await withRuntimeDependencyTrackingContext(
      {
        mode: 'query',
        queryField: 'matches',
        source: 'test:async-query',
        consumer: 'https://example.com/root.json',
        consumerKind: 'instance',
      },
      async () => {
        await Promise.resolve();
        trackRuntimeInstanceDependency('https://example.com/query-target');
      },
    );

    let snapshot = snapshotRuntimeDependencies({ excludeQueryOnly: true });
    assert.notOk(
      snapshot.deps.includes('https://example.com/query-target.json'),
      'query-only dep is excluded from deps',
    );
    assert.true(
      snapshot.excludedQueryOnlyDeps.includes(
        'https://example.com/query-target.json',
      ),
      'query-only dep is tracked in excludedQueryOnlyDeps',
    );
  });

  test('keeps unscoped module accesses and reports them as unscoped', async function (assert) {
    beginRuntimeDependencyTrackingSession({
      sessionKey: 'unscoped-query',
      rootURL: 'https://example.com/root.json',
      rootKind: 'instance',
    });

    await withRuntimeDependencyTrackingContext(
      {
        mode: 'query',
        queryField: 'matches',
        source: 'test:unscoped-query',
      },
      async () => {
        await Promise.resolve();
        trackRuntimeModuleDependency('https://example.com/query-module.gts');
      },
    );

    let snapshot = snapshotRuntimeDependencies({ excludeQueryOnly: true });
    assert.true(
      snapshot.deps.includes('https://example.com/query-module'),
      'unscoped query module remains in deps',
    );
    assert.true(
      snapshot.unscopedDeps.includes('https://example.com/query-module'),
      'unscoped query module is reported as unscoped',
    );
    assert.notOk(
      snapshot.excludedQueryOnlyDeps.includes('https://example.com/query-module'),
      'unscoped query module is not treated as query-only excluded',
    );
  });

  test('tracks module deps on loader cache hits without refetch', async function (assert) {
    let fetchCount = 0;
    let loader = new Loader(async () => {
      fetchCount++;
      return new Response('export const value = 1;', { status: 200 });
    });
    let moduleURL = 'https://example.com/cards/cached-module.gts';

    beginRuntimeDependencyTrackingSession({
      sessionKey: 'loader-cache-first',
      rootURL: 'https://example.com/root-a.json',
      rootKind: 'instance',
    });
    await withRuntimeDependencyTrackingContext(
      {
        mode: 'non-query',
        source: 'test:loader-cache-first',
        consumer: 'https://example.com/root-a.json',
        consumerKind: 'instance',
      },
      async () => {
        await loader.import(moduleURL);
      },
    );
    let firstSnapshot = snapshotRuntimeDependencies({ excludeQueryOnly: true });
    assert.true(
      firstSnapshot.deps.includes('https://example.com/cards/cached-module'),
      'first import records module dependency',
    );
    assert.strictEqual(fetchCount, 1, 'first import fetches once');

    beginRuntimeDependencyTrackingSession({
      sessionKey: 'loader-cache-second',
      rootURL: 'https://example.com/root-b.json',
      rootKind: 'instance',
    });
    await withRuntimeDependencyTrackingContext(
      {
        mode: 'non-query',
        source: 'test:loader-cache-second',
        consumer: 'https://example.com/root-b.json',
        consumerKind: 'instance',
      },
      async () => {
        await loader.import(moduleURL);
      },
    );
    let secondSnapshot = snapshotRuntimeDependencies({
      excludeQueryOnly: true,
    });
    assert.true(
      secondSnapshot.deps.includes('https://example.com/cards/cached-module'),
      'cache-hit import still records module dependency',
    );
    assert.strictEqual(fetchCount, 1, 'cache-hit import does not refetch');
  });

});
