import { module, test } from 'qunit';
import { basename } from 'path';
import {
  Loader,
  beginRuntimeDependencyTrackingSession,
  endRuntimeDependencyTrackingSession,
  resetRuntimeDependencyTracker,
  shouldTrackRuntimeModuleGraph,
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

  test('explicit dependency contexts remain isolated across overlapping async work', async function (assert) {
    beginRuntimeDependencyTrackingSession({
      sessionKey: 'explicit-overlap-contexts',
      rootURL: 'https://example.com/root.json',
      rootKind: 'instance',
    });

    let releaseQuery: (() => void) | undefined;
    let releaseNonQuery: (() => void) | undefined;
    let queryGate = new Promise<void>((resolve) => (releaseQuery = resolve));
    let nonQueryGate = new Promise<void>(
      (resolve) => (releaseNonQuery = resolve),
    );

    let queryContext = {
      mode: 'query' as const,
      queryField: 'matches',
      source: 'test:explicit-query-overlap',
      consumer: 'https://example.com/query-consumer.json',
      consumerKind: 'instance' as const,
    };
    let nonQueryContext = {
      mode: 'non-query' as const,
      source: 'test:explicit-non-query-overlap',
      consumer: 'https://example.com/non-query-consumer.json',
      consumerKind: 'instance' as const,
    };

    let queryPromise = (async () => {
      await queryGate;
      trackRuntimeInstanceDependency(
        'https://example.com/query-target',
        queryContext,
      );
    })();
    let nonQueryPromise = (async () => {
      await nonQueryGate;
      trackRuntimeInstanceDependency(
        'https://example.com/non-query-target',
        nonQueryContext,
      );
    })();

    releaseQuery!();
    await Promise.resolve();
    releaseNonQuery!();
    await Promise.all([queryPromise, nonQueryPromise]);

    let snapshot = snapshotRuntimeDependencies({ excludeQueryOnly: true });
    assert.notOk(
      snapshot.deps.includes('https://example.com/query-target.json'),
      'query dep is excluded when tracked with explicit query context',
    );
    assert.true(
      snapshot.excludedQueryOnlyDeps.includes(
        'https://example.com/query-target.json',
      ),
      'query dep is classified as query-only with explicit context',
    );
    assert.true(
      snapshot.deps.includes('https://example.com/non-query-target.json'),
      'non-query dep is retained when tracked with explicit non-query context',
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

  test('captures and dedups repeated tracking with no active context', async function (assert) {
    beginRuntimeDependencyTrackingSession({
      sessionKey: 'no-context-dedup',
      rootURL: 'https://example.com/root.json',
      rootKind: 'instance',
    });

    // Outside any withContext scope — the relationship walk a template render
    // drives — the same dependency is tracked once per linked element. The dep
    // must still be captured, and repeats must not drop it.
    for (let i = 0; i < 5; i++) {
      trackRuntimeInstanceDependency('https://example.com/repeated-dep');
      trackRuntimeModuleDependency('https://example.com/cards/repeated.gts');
    }

    let snapshot = snapshotRuntimeDependencies({ excludeQueryOnly: true });
    assert.deepEqual(
      snapshot.deps.filter((d) => d.includes('repeated')),
      [
        'https://example.com/cards/repeated',
        'https://example.com/repeated-dep.json',
      ],
      'each repeated dependency is captured exactly once with no active context',
    );
  });

  test('captures dep under a real context even after no-context tracking', async function (assert) {
    beginRuntimeDependencyTrackingSession({
      sessionKey: 'no-context-then-context',
      rootURL: 'https://example.com/root.json',
      rootKind: 'instance',
    });

    // First tracked with no active context (unscoped, non-query), then under an
    // explicit context with a consumer. Dedup is per-context, so the second
    // recording must still land rather than being skipped as a repeat.
    trackRuntimeInstanceDependency('https://example.com/shared');
    await withRuntimeDependencyTrackingContext(
      {
        mode: 'non-query',
        source: 'test:no-context-then-context',
        consumer: 'https://example.com/root.json',
        consumerKind: 'instance',
      },
      async () => {
        trackRuntimeInstanceDependency('https://example.com/shared');
      },
    );

    let snapshot = snapshotRuntimeDependencies({ excludeQueryOnly: true });
    assert.true(
      snapshot.deps.includes('https://example.com/shared.json'),
      'dependency is captured across the no-context and explicit-context reads',
    );
  });

  test('does not dedup a mutated explicit context', async function (assert) {
    beginRuntimeDependencyTrackingSession({
      sessionKey: 'mutated-explicit-context',
      rootURL: 'https://example.com/root.json',
      rootKind: 'instance',
    });

    // Explicit contexts are public API and structurally mutable. The same
    // object, tracked first as a query and then mutated to non-query, must
    // record under both modes — identity must never short-circuit the second
    // call into dropping the non-query context (which would wrongly exclude the
    // dep as query-only).
    let context = {
      mode: 'query' as 'query' | 'non-query',
      queryField: 'matches',
      source: 'test:mutated-explicit',
      consumer: 'https://example.com/root.json',
      consumerKind: 'instance' as const,
    };
    trackRuntimeInstanceDependency('https://example.com/mutating-dep', context);
    context.mode = 'non-query';
    trackRuntimeInstanceDependency('https://example.com/mutating-dep', context);

    let snapshot = snapshotRuntimeDependencies({ excludeQueryOnly: true });
    assert.true(
      snapshot.deps.includes('https://example.com/mutating-dep.json'),
      'dep tracked under a mutated explicit context is retained as non-query',
    );
    assert.notOk(
      snapshot.excludedQueryOnlyDeps.includes(
        'https://example.com/mutating-dep.json',
      ),
      'dep is not misclassified as query-only after the context mutated',
    );
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

  test('module-graph probe permits a walk exactly once per context per session', function (assert) {
    let moduleURL = 'https://example.com/cards/aggregate.gts';
    let queryContext = {
      mode: 'query' as const,
      queryField: 'members',
      source: 'test:graph-probe',
      consumer: 'https://example.com/root.json',
      consumerKind: 'instance' as const,
    };

    assert.false(
      shouldTrackRuntimeModuleGraph('relationship', moduleURL, queryContext),
      'inactive tracker permits no walk (nothing would record)',
    );

    beginRuntimeDependencyTrackingSession({
      sessionKey: 'graph-probe',
      rootURL: 'https://example.com/root.json',
      rootKind: 'instance',
    });

    assert.true(
      shouldTrackRuntimeModuleGraph('relationship', moduleURL, queryContext),
      'first probe under an active session permits the walk',
    );
    assert.false(
      shouldTrackRuntimeModuleGraph('relationship', moduleURL, queryContext),
      'repeat probe with an equivalent context is collapsed',
    );
    assert.false(
      shouldTrackRuntimeModuleGraph('relationship', moduleURL, {
        ...queryContext,
      }),
      'equivalence is by value, not object identity',
    );
    assert.false(
      shouldTrackRuntimeModuleGraph('relationship', moduleURL, {
        ...queryContext,
        consumerKind: undefined,
      }),
      "an omitted consumerKind dedups against the recorded default ('instance')",
    );

    assert.true(
      shouldTrackRuntimeModuleGraph('import', moduleURL, queryContext),
      'a different scope walks again (sites record different node sets)',
    );
    assert.true(
      shouldTrackRuntimeModuleGraph('relationship', moduleURL, {
        ...queryContext,
        mode: 'non-query',
      }),
      'a different mode walks again (query-only classification must not stick)',
    );
    assert.true(
      shouldTrackRuntimeModuleGraph('relationship', moduleURL, {
        ...queryContext,
        consumer: 'https://example.com/other-consumer.json',
      }),
      'a different consumer walks again',
    );
    assert.true(
      shouldTrackRuntimeModuleGraph(
        'relationship',
        'https://example.com/cards/other-type.gts',
        queryContext,
      ),
      'a different root module walks again',
    );

    resetRuntimeDependencyTracker();
    beginRuntimeDependencyTrackingSession({
      sessionKey: 'graph-probe',
      rootURL: 'https://example.com/root.json',
      rootKind: 'instance',
    });
    assert.true(
      shouldTrackRuntimeModuleGraph('relationship', moduleURL, queryContext),
      'reset clears walk markers so a fresh session re-walks',
    );
  });

  test('module-graph probe with no explicit context dedups via the active context', async function (assert) {
    let moduleURL = 'https://example.com/cards/aggregate.gts';
    beginRuntimeDependencyTrackingSession({
      sessionKey: 'graph-probe-stack-context',
      rootURL: 'https://example.com/root.json',
      rootKind: 'instance',
    });

    await withRuntimeDependencyTrackingContext(
      {
        mode: 'non-query',
        source: 'test:stack-context',
        consumer: 'https://example.com/root.json',
        consumerKind: 'instance',
      },
      async () => {
        assert.true(
          shouldTrackRuntimeModuleGraph('relationship', moduleURL),
          'first probe inside a context scope permits the walk',
        );
        assert.false(
          shouldTrackRuntimeModuleGraph('relationship', moduleURL),
          'repeat probe inside the same scope is collapsed',
        );
      },
    );
    // A fresh withContext scope builds a new context object, but its
    // recording-relevant fields are identical — the walk must stay collapsed
    // (this is the repeat-getter-invocation case object-identity dedup misses).
    await withRuntimeDependencyTrackingContext(
      {
        mode: 'non-query',
        source: 'test:stack-context',
        consumer: 'https://example.com/root.json',
        consumerKind: 'instance',
      },
      async () => {
        assert.false(
          shouldTrackRuntimeModuleGraph('relationship', moduleURL),
          'an equivalent later scope is still collapsed (value equivalence)',
        );
      },
    );
  });

  test('imports under query then non-query contexts leave module deps non-query', async function (assert) {
    // The import-time module-graph walk is skipped on repeats; mode is part of
    // the walk identity, so a graph first walked under a query context must
    // still re-walk under a later non-query context — otherwise its modules
    // would be misclassified query-only and excluded from deps.
    let loader = new Loader(
      async () => new Response('export const value = 1;', { status: 200 }),
    );
    let moduleURL = 'https://example.com/cards/query-then-non-query.gts';

    beginRuntimeDependencyTrackingSession({
      sessionKey: 'import-mode-transition',
      rootURL: 'https://example.com/root.json',
      rootKind: 'instance',
    });
    let queryContext = {
      mode: 'query' as const,
      queryField: 'matches',
      source: 'test:import-query',
      consumer: 'https://example.com/root.json',
      consumerKind: 'instance' as const,
    };
    let nonQueryContext = {
      mode: 'non-query' as const,
      source: 'test:import-non-query',
      consumer: 'https://example.com/root.json',
      consumerKind: 'instance' as const,
    };
    await loader.import(moduleURL, queryContext);
    await loader.import(moduleURL, nonQueryContext);

    let snapshot = snapshotRuntimeDependencies({ excludeQueryOnly: true });
    assert.true(
      snapshot.deps.includes('https://example.com/cards/query-then-non-query'),
      'module imported under both modes is retained in deps',
    );
    assert.notOk(
      snapshot.excludedQueryOnlyDeps.includes(
        'https://example.com/cards/query-then-non-query',
      ),
      'module is not misclassified as query-only',
    );
  });

  test('repeat imports in one session still record module deps', async function (assert) {
    let loader = new Loader(
      async () => new Response('export const value = 1;', { status: 200 }),
    );
    let moduleURL = 'https://example.com/cards/repeat-import.gts';

    beginRuntimeDependencyTrackingSession({
      sessionKey: 'repeat-import',
      rootURL: 'https://example.com/root.json',
      rootKind: 'instance',
    });
    let context = {
      mode: 'non-query' as const,
      source: 'test:repeat-import',
      consumer: 'https://example.com/root.json',
      consumerKind: 'instance' as const,
    };
    // Models deserializing many cards of one type: each deserialization
    // imports the same module. The collapsed repeats must not lose the dep.
    for (let i = 0; i < 3; i++) {
      await loader.import(moduleURL, context);
    }

    let snapshot = snapshotRuntimeDependencies({ excludeQueryOnly: true });
    assert.true(
      snapshot.deps.includes('https://example.com/cards/repeat-import'),
      'module dep is recorded once across repeated imports',
    );
  });
});
