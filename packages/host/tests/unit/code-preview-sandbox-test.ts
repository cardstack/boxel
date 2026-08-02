import { module, test } from 'qunit';

import CodePreviewSandbox, {
  CodePreviewAnalysisCache,
  compileCodePreviewDraftSource,
  codePreviewSourceHash,
  DEFAULT_VOLATILE_MODULE_QUIET_PERIOD_MS,
  sameCodePreviewModuleURL,
  VolatileModuleRegistry,
} from '@cardstack/host/lib/code-preview-sandbox';

module('Unit | code preview sandbox', function () {
  test('[HMR-01] keeps edited modules volatile for at least ninety seconds', function (assert) {
    assert.true(
      DEFAULT_VOLATILE_MODULE_QUIET_PERIOD_MS >= 90_000,
      'the default HMR lease survives a natural editing pause',
    );
  });

  test('fingerprints identical source generations without using revision identity', function (assert) {
    assert.strictEqual(
      codePreviewSourceHash('export const version = 1;'),
      codePreviewSourceHash('export const version = 1;'),
      'equal source has one analysis-cache key',
    );
    assert.notStrictEqual(
      codePreviewSourceHash('export const version = 1;'),
      codePreviewSourceHash('export const version = 2;'),
      'a source change selects another compiled generation',
    );
  });

  test('[CACHE-01] shares classification and compilation by module source hash', async function (assert) {
    let hits = 0;
    let misses = 0;
    let cache = new CodePreviewAnalysisCache(
      () => hits++,
      () => misses++,
    );
    let draft = {
      sourceURL: 'https://realm.example/card.gts',
      source: 'export const version = 1;',
      revision: 1,
    };

    let firstClassification = cache.classificationFor(draft);
    let secondClassification = cache.classificationFor(draft);
    let firstCompilation = cache.compiledFor(draft);
    let secondCompilation = cache.compiledFor(draft);

    assert.strictEqual(
      secondClassification,
      firstClassification,
      'classification has one in-flight promise',
    );
    assert.strictEqual(
      secondCompilation,
      firstCompilation,
      'compilation has one in-flight promise',
    );
    assert.strictEqual(misses, 1, 'the source creates one cache entry');
    assert.strictEqual(hits, 3, 'every following consumer reuses the entry');

    await Promise.all([firstClassification, firstCompilation]);
    await cache.classificationFor({
      sourceURL: draft.sourceURL,
      source: 'export const version = 2;',
    });
    assert.strictEqual(misses, 2, 'changed source creates a new entry');
  });

  test('compiles one immutable GTS draft into the Loader boundary format', async function (assert) {
    let compiled = await compileCodePreviewDraftSource({
      sourceURL: 'https://realm.example/live-preview.gts',
      source: `
        import { CardDef, Component } from '@cardstack/base/card-api';
        export class LivePreview extends CardDef {
          static isolated = class Isolated extends Component<typeof this> {
            <template><strong>VERSION ONE</strong></template>
          };
        }
      `,
      revision: 1,
    });

    assert.true(compiled.includes('export class LivePreview'));
    assert.true(compiled.includes('VERSION ONE'));
    assert.false(compiled.includes('Component<typeof this>'));
    assert.false(compiled.includes('<template>'));
  });

  test('matches Monaco file URLs to the loader executable module identity', function (assert) {
    assert.true(
      sameCodePreviewModuleURL(
        'https://realm.example/card.gts?draft=2#source',
        'https://realm.example/card',
      ),
      'the concrete GTS file and extensionless loader import are one module',
    );
    assert.true(
      sameCodePreviewModuleURL(
        'https://realm.example/card.ts',
        'https://realm.example/card.js',
      ),
      'executable extension siblings share the Loader cache identity',
    );
    assert.false(
      sameCodePreviewModuleURL(
        'https://realm.example/card.gts',
        'https://other.example/card',
      ),
      'origin still participates in module identity',
    );
  });

  test('tracks one independent in-memory source revision per mounted preview', function (assert) {
    let first = new CodePreviewSandbox();
    let second = new CodePreviewSandbox();

    assert.notStrictEqual(first.id, second.id, 'preview identities are unique');

    first.update('https://realm.example/article.gts', 'first source');
    assert.strictEqual(first.revision, 1);
    assert.strictEqual(first.source, 'first source');
    assert.strictEqual(second.revision, 0, 'another preview is unaffected');

    first.update('https://realm.example/article.gts', 'first source');
    assert.strictEqual(
      first.revision,
      1,
      'an identical Monaco buffer is a no-op',
    );

    first.update('https://realm.example/article.gts', 'reverted source');
    assert.strictEqual(
      first.revision,
      2,
      'reverting is still a new preview revision',
    );

    assert.true(first.reload(), 'a populated preview can be reloaded');
    assert.strictEqual(first.revision, 3, 'reload advances its generation');
    assert.strictEqual(
      first.source,
      'reverted source',
      'reload preserves the current source exactly',
    );
    assert.false(second.reload(), 'an empty preview has nothing to reload');

    first.update('https://realm.example/recipe.gts', 'recipe source');
    assert.strictEqual(
      first.revision,
      4,
      'switching files replaces the exact draft URL',
    );
    assert.strictEqual(first.sourceURL, 'https://realm.example/recipe.gts');

    first.deactivate();
    assert.false(first.active, 'teardown revokes the preview source');
  });

  test('publishes source and revision as one immutable generation', function (assert) {
    let sandbox = new CodePreviewSandbox();

    sandbox.update('https://realm.example/card.gts', 'VERSION ONE');
    let first = sandbox.draft!;
    sandbox.update('https://realm.example/card.gts', 'VERSION TWO');
    let second = sandbox.draft!;

    assert.true(Object.isFrozen(first));
    assert.deepEqual(first, {
      sourceURL: 'https://realm.example/card.gts',
      source: 'VERSION ONE',
      revision: 1,
    });
    assert.deepEqual(second, {
      sourceURL: 'https://realm.example/card.gts',
      source: 'VERSION TWO',
      revision: 2,
    });
    assert.notStrictEqual(first, second);
  });

  test('[HMR-05] guards the render, persistence, acknowledgement, and last-known-good generation', function (assert) {
    let sandbox = new CodePreviewSandbox();
    sandbox.update('https://realm.example/card.gts', 'VERSION ONE');
    let first = sandbox.draft!;

    sandbox.markEvaluating(first);
    assert.strictEqual(sandbox.generationState.phase, 'evaluating');
    sandbox.markRendered(first);
    assert.deepEqual(sandbox.generationState, {
      phase: 'rendered',
      revision: 1,
      sourceURL: 'https://realm.example/card.gts',
      lastKnownGoodRevision: 1,
    });

    sandbox.markCommitPrepared(first, 'save-1');
    sandbox.markCommitPersisted(first, 'save-1');
    sandbox.markCommitAcknowledged(first, 'save-1');
    assert.strictEqual(sandbox.generationState.phase, 'acknowledged');

    sandbox.update('https://realm.example/card.gts', 'VERSION TWO');
    let second = sandbox.draft!;
    sandbox.markEvaluating(second);
    sandbox.reportError(second, new Error('broken render'), 'runtime');
    assert.strictEqual(sandbox.generationState.phase, 'failed');
    assert.strictEqual(
      sandbox.generationState.lastKnownGoodRevision,
      1,
      'a failed candidate retains the prior rendered generation',
    );

    sandbox.markRendered(first);
    assert.strictEqual(
      sandbox.generationState.revision,
      2,
      'a late callback from an older draft cannot roll the state backward',
    );
    sandbox.markRendered(second);
    assert.strictEqual(sandbox.generationState.phase, 'rendered');
    assert.strictEqual(sandbox.generationState.lastKnownGoodRevision, 2);
  });

  test('classifies each immutable source generation once', async function (assert) {
    let sandbox = new CodePreviewSandbox();
    sandbox.update(
      'https://realm.example/card.gts',
      "export const message = 'ordinary SES card';",
    );
    let firstDraft = sandbox.draft!;
    let first = sandbox.classificationFor(firstDraft)!;

    assert.strictEqual(
      sandbox.classificationFor(firstDraft),
      first,
      'all consumers share the draft classification promise',
    );
    assert.strictEqual((await first).tier, 'compartment');

    sandbox.update(
      'https://realm.example/card.gts',
      "const canvas = document.createElement('canvas');",
    );
    let second = sandbox.classificationFor()!;
    assert.notStrictEqual(second, first, 'a new draft gets a new analysis');
    assert.strictEqual((await second).tier, 'iframe');
  });

  test('code previews start in SES and source classification may promote them', function (assert) {
    let sandbox = new CodePreviewSandbox();

    sandbox.update(
      'https://realm.example/card.gts',
      "const canvas = document.createElement('canvas');",
    );
    sandbox.update(
      'https://realm.example/card.gts',
      "export const message = 'ordinary SES card';",
    );
    assert.strictEqual(sandbox.revision, 2);
    assert.strictEqual(sandbox.sandboxTier, 'compartment');
    assert.strictEqual(sandbox.sandboxReason, 'code-preview-ses');

    sandbox.applySandboxDecision('iframe', 'browser-runtime:three');
    assert.strictEqual(sandbox.sandboxTier, 'iframe');
    assert.strictEqual(sandbox.sandboxReason, 'browser-runtime:three');
  });

  test('defers one canonical refresh across a persisted preview revision', function (assert) {
    let sandbox = new CodePreviewSandbox();
    sandbox.update('https://realm.example/card.gts', 'VERSION ONE');

    assert.true(
      sandbox.matchesDraft('https://realm.example/card', 'VERSION ONE'),
      'the executable module identity matches its concrete Monaco URL',
    );
    assert.false(
      sandbox.matchesDraft('https://realm.example/card.gts', 'VERSION TWO'),
      'a different buffer is not the rendered revision',
    );

    sandbox.deferCanonicalRefresh();
    sandbox.deferCanonicalRefresh();
    assert.true(
      sandbox.consumeDeferredCanonicalRefresh(),
      'a burst of persisted revisions requests one canonical refresh',
    );
    assert.false(
      sandbox.consumeDeferredCanonicalRefresh(),
      'the deferred refresh is consumed exactly once',
    );
  });

  test('a source mutation opens a bounded volatile module generation', function (assert) {
    let now = 1_000;
    let registry = new VolatileModuleRegistry(500, () => now);

    let first = registry.begin(
      'https://realm.example/card.gts',
      'canonical source',
    );
    assert.deepEqual(first, {
      sourceURL: 'https://realm.example/card.gts',
      source: 'canonical source',
      revision: 1,
      expiresAt: 1_500,
    });

    now = 1_300;
    let second = registry.publish(
      'https://realm.example/card.gts',
      'first search/replace result',
    );
    assert.strictEqual(second.revision, 2);
    assert.strictEqual(
      second.expiresAt,
      1_800,
      'each mutation renews the lease',
    );
    assert.strictEqual(
      registry.begin('https://realm.example/card', 'stale server source')
        .source,
      'first search/replace result',
      'a following command composes against the volatile generation',
    );
    assert.strictEqual(
      registry.begin('https://realm.example/card', 'stale server source'),
      second,
      'reading the volatile base does not create a new mutation generation',
    );
    assert.true(
      registry.isLatestPublished(second),
      'the last published object is the async generation token',
    );

    now = 2_000;
    assert.false(
      registry.isVolatile('https://realm.example/card.ts'),
      'the executable module identity returns to canonical loading after quiet',
    );
    assert.true(
      registry.isLatestPublished(second),
      'quiet-period expiry alone does not make a slow async result stale',
    );
    registry.clear('https://realm.example/card');
    assert.false(
      registry.isLatestPublished(second),
      'explicit settlement invalidates pending async results',
    );
  });
});
