import { module, test } from 'qunit';
import { basename } from 'path';
import {
  Loader,
  beginRuntimeDependencyTrackingSession,
  endRuntimeDependencyTrackingSession,
  resetRuntimeDependencyTracker,
  snapshotRuntimeDependencies,
  trackRuntimeFileDependency,
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
      snapshot.excludedQueryOnlyDeps.includes(
        'https://example.com/query-module',
      ),
      'unscoped query module is not treated as query-only excluded',
    );
  });

  test('retains dep seen in both query and non-query contexts', async function (assert) {
    beginRuntimeDependencyTrackingSession({
      sessionKey: 'query-non-query-overlap',
      rootURL: 'https://example.com/root.json',
      rootKind: 'instance',
    });

    await withRuntimeDependencyTrackingContext(
      {
        mode: 'query',
        queryField: 'matches',
        source: 'test:query-overlap',
        consumer: 'https://example.com/root.json',
        consumerKind: 'instance',
      },
      async () => {
        trackRuntimeInstanceDependency('https://example.com/shared-target');
      },
    );
    await withRuntimeDependencyTrackingContext(
      {
        mode: 'non-query',
        source: 'test:non-query-overlap',
        consumer: 'https://example.com/root.json',
        consumerKind: 'instance',
      },
      async () => {
        trackRuntimeInstanceDependency('https://example.com/shared-target');
      },
    );

    let snapshot = snapshotRuntimeDependencies({ excludeQueryOnly: true });
    assert.true(
      snapshot.deps.includes('https://example.com/shared-target.json'),
      'shared dep is retained when also seen in non-query context',
    );
    assert.notOk(
      snapshot.excludedQueryOnlyDeps.includes(
        'https://example.com/shared-target.json',
      ),
      'shared dep is not marked query-only',
    );
  });

  test('excludes root from deps even when tracked directly', async function (assert) {
    beginRuntimeDependencyTrackingSession({
      sessionKey: 'root-exclusion',
      rootURL: 'https://example.com/root.json',
      rootKind: 'instance',
    });

    await withRuntimeDependencyTrackingContext(
      {
        mode: 'non-query',
        source: 'test:root-exclusion',
        consumer: 'https://example.com/root.json',
        consumerKind: 'instance',
      },
      async () => {
        trackRuntimeInstanceDependency('https://example.com/root.json');
        trackRuntimeInstanceDependency('https://example.com/other-dep');
      },
    );

    let snapshot = snapshotRuntimeDependencies({ excludeQueryOnly: true });
    assert.notOk(
      snapshot.deps.includes('https://example.com/root.json'),
      'root resource is excluded from deps',
    );
    assert.true(
      snapshot.deps.includes('https://example.com/other-dep.json'),
      'non-root dep is still included',
    );
  });

  test('excludes file root across extensionless and .json aliases', async function (assert) {
    beginRuntimeDependencyTrackingSession({
      sessionKey: 'file-root-alias-exclusion',
      rootURL: 'https://example.com/file-root',
      rootKind: 'file',
    });

    await withRuntimeDependencyTrackingContext(
      {
        mode: 'non-query',
        source: 'test:file-root-alias-exclusion',
        consumer: 'https://example.com/file-root',
        consumerKind: 'file',
      },
      async () => {
        trackRuntimeFileDependency('https://example.com/file-root');
        trackRuntimeInstanceDependency('https://example.com/file-root');
        trackRuntimeInstanceDependency('https://example.com/other-instance');
      },
    );

    let snapshot = snapshotRuntimeDependencies({ excludeQueryOnly: true });
    assert.notOk(
      snapshot.deps.includes('https://example.com/file-root'),
      'file root is excluded from deps',
    );
    assert.notOk(
      snapshot.deps.includes('https://example.com/file-root.json'),
      'file root .json alias is excluded from deps',
    );
    assert.true(
      snapshot.deps.includes('https://example.com/other-instance.json'),
      'non-root deps are retained',
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

  test('getter-level attribution tracks only accessed relationship targets', async function (assert) {
    beginRuntimeDependencyTrackingSession({
      sessionKey: 'getter-level-attribution',
      rootURL: 'https://example.com/root.json',
      rootKind: 'instance',
    });

    // This models relationship getter-level attribution: we only track the link
    // whose getter was actually consumed during render.
    await withRuntimeDependencyTrackingContext(
      {
        mode: 'non-query',
        source: 'test:getter-level-attribution',
        consumer: 'https://example.com/root.json',
        consumerKind: 'instance',
      },
      async () => {
        trackRuntimeInstanceDependency('https://example.com/rendered-link');
        // intentionally do not track hidden-link because its getter was not read
      },
    );

    let snapshot = snapshotRuntimeDependencies({ excludeQueryOnly: true });
    assert.true(
      snapshot.deps.includes('https://example.com/rendered-link.json'),
      'rendered relationship target is captured',
    );
    assert.notOk(
      snapshot.deps.includes('https://example.com/hidden-link.json'),
      'non-rendered relationship target is not captured',
    );
  });
});
