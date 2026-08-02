import { getService } from '@universal-ember/test-support';
import { setupTest } from 'ember-qunit';
import { module, test } from 'qunit';

import CodePreviewSandbox, {
  VolatileModuleRegistry,
} from '@cardstack/host/lib/code-preview-sandbox';

import type RealmSandboxService from '@cardstack/host/services/realm-sandbox';
import type StoreService from '@cardstack/host/services/store';

module('Unit | realm sandbox acknowledgement', function (hooks) {
  setupTest(hooks);

  test('an exact source acknowledgement does not swallow sibling invalidations', function (assert) {
    let service = getService('realm-sandbox') as RealmSandboxService;
    let sourceURL = 'https://realm.example/article.gts';
    let source = 'export class Article {}';
    let sandbox = new CodePreviewSandbox();
    service.publishCodePreviewSource(sandbox, sourceURL, source);
    let commit = service.prepareVolatileModuleCommit(
      sourceURL,
      source,
      'editor',
      'editor:mixed-event',
      new Set([sandbox]),
    );
    assert.ok(commit, 'the exact preview generation was registered');
    commit!.persisted();

    let sibling = 'https://realm.example/Article/one.json';
    let acknowledged = service.codePreviewCommitAcknowledgedInvalidations(
      commit!.clientRequestId,
      [sourceURL, sibling],
    );

    assert.deepEqual([...acknowledged], [sourceURL]);
    assert.false(
      service.isCodePreviewCommitAcknowledgement(commit!.clientRequestId, [
        sourceURL,
        sibling,
      ]),
      'the mixed event must continue through Store for its sibling resource',
    );
    let store = getService('store') as StoreService;
    assert.false(
      store.isCodePreviewCommitAcknowledgement({
        eventName: 'index',
        indexType: 'incremental',
        invalidations: [sourceURL, sibling],
        clientRequestId: commit!.clientRequestId,
        generation: 1,
        realmURL: 'https://realm.example/',
      }),
      'live projections process the sibling instead of swallowing the mixed event',
    );
    service.releaseCodePreviewSandbox(sandbox);
  });

  test('card JSON saves are never registered as module HMR acknowledgements', function (assert) {
    let service = getService('realm-sandbox') as RealmSandboxService;
    let sourceURL = 'https://realm.example/Article/one.json';
    let source = JSON.stringify({
      data: {
        attributes: { title: 'Edited' },
        meta: {
          adoptsFrom: {
            module: 'https://realm.example/article',
            name: 'Article',
          },
        },
      },
    });
    let sandbox = new CodePreviewSandbox();
    service.publishCodePreviewSource(sandbox, sourceURL, source);

    assert.strictEqual(
      service.prepareVolatileModuleCommit(
        sourceURL,
        source,
        'editor',
        'editor:card-data',
        new Set([sandbox]),
      ),
      undefined,
      'data acknowledgements continue through Store reload/type-change handling',
    );
    service.releaseCodePreviewSandbox(sandbox);
  });

  test('an external invalidation cannot overwrite an active local generation', function (assert) {
    let service = getService('realm-sandbox') as RealmSandboxService;
    let sourceURL = 'https://realm.example/article.gts';
    let canonicalSource = 'export class Article {}';
    let localSource = 'export class Article { static title = "local"; }';
    let sandbox = new CodePreviewSandbox();

    service.seedCodePreviewSource(sandbox, sourceURL, canonicalSource);
    service.beginVolatileModuleMutation(sourceURL, canonicalSource);
    service.publishVolatileModuleSource(sourceURL, localSource);

    let handled = service.handleExternalModuleInvalidationPartition([
      sourceURL,
    ]);

    assert.deepEqual([...handled], [sourceURL]);
    assert.false(
      service.isUsingExternalModuleHMR(sourceURL),
      'the local generation was not recaptured as an external one',
    );
    assert.strictEqual(
      service.beginVolatileModuleMutation(sourceURL, canonicalSource),
      localSource,
      'the server event did not replace the local source buffer',
    );
    service.releaseCodePreviewSandbox(sandbox);
  });

  test('saving an active draft renews an expired volatile lease', function (assert) {
    let service = getService('realm-sandbox') as RealmSandboxService;
    let now = 1_000;
    let volatileModules = new VolatileModuleRegistry(100, () => now);
    (
      service as unknown as {
        volatileModules: VolatileModuleRegistry;
      }
    ).volatileModules = volatileModules;
    let sourceURL = 'https://realm.example/article.gts';
    let source = 'export class Article { static title = "local"; }';
    let sandbox = new CodePreviewSandbox();
    service.publishCodePreviewSource(sandbox, sourceURL, source);
    now = 1_200;

    let commit = service.prepareVolatileModuleCommit(
      sourceURL,
      source,
      'editor',
      'editor:after-pause',
      new Set([sandbox]),
    );

    assert.ok(commit, 'the save still receives acknowledgement tracking');
    assert.strictEqual(
      volatileModules.current(sourceURL)?.source,
      source,
      'the exact locally rendered source receives a fresh lease',
    );
    service.releaseCodePreviewSandbox(sandbox);
  });
});
