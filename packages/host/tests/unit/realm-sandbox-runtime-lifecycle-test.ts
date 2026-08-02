import { getService } from '@universal-ember/test-support';
import { setupTest } from 'ember-qunit';
import { module, test } from 'qunit';

import { opaqueRealmCardState } from '@cardstack/host/lib/realm-sandbox-boundary';

import type { BaseDef } from '@cardstack/base/card-api';
interface InspectableRealmSandbox {
  compartmentRuntimeFor(principal: string): unknown;
  retainRealmCard(card: BaseDef): () => void;
  evictIdleRealmRuntimes(): void;
  metricsSnapshot(): { activeCompartments: number };
  prewarmCodePreviewSource(sourceURL: string, source: string): void;
}

function opaqueCard(principal: string): BaseDef {
  let card = {} as BaseDef;
  Object.defineProperty(card, opaqueRealmCardState, {
    value: {
      typeRef: { module: `${principal}card`, name: 'Card' },
      principal,
      document: { data: { type: 'card' } },
      snapshot: {},
      presentation: {
        headerColor: null,
        prefersWideFormat: false,
      },
    },
  });
  return card;
}

module('Unit | Service | realm sandbox runtime lifecycle', function (hooks) {
  setupTest(hooks);

  test('cross-realm navigation evicts only runtimes without mounted consumers', function (assert) {
    let service = getService(
      'realm-sandbox',
    ) as unknown as InspectableRealmSandbox;
    let firstRealm = 'https://first-realm.example/';
    let secondRealm = 'https://second-realm.example/';
    service.compartmentRuntimeFor(firstRealm);
    service.compartmentRuntimeFor(secondRealm);
    let releaseFirst = service.retainRealmCard(opaqueCard(firstRealm));
    let releaseSecond = service.retainRealmCard(opaqueCard(secondRealm));

    releaseFirst();
    service.evictIdleRealmRuntimes();
    assert.strictEqual(
      service.metricsSnapshot().activeCompartments,
      1,
      'the departed realm is evicted while the mounted realm stays warm',
    );

    releaseSecond();
    service.evictIdleRealmRuntimes();
    assert.strictEqual(
      service.metricsSnapshot().activeCompartments,
      0,
      'the final runtime is released after its last mounted card leaves',
    );
  });

  test('[CACHE-01] reuses classification and transpilation work by source hash', function (assert) {
    let service = getService(
      'realm-sandbox',
    ) as unknown as InspectableRealmSandbox;
    let sourceURL = 'https://realm.example/preview.gts';
    let source = 'export const preview = "same source";';
    let before = service.metricsSnapshot() as unknown as {
      codePreviewAnalysisCacheHits: number;
      codePreviewAnalysisCacheMisses: number;
    };

    service.prewarmCodePreviewSource(sourceURL, source);
    service.prewarmCodePreviewSource(sourceURL, source);

    let after = service.metricsSnapshot() as unknown as {
      codePreviewAnalysisCacheHits: number;
      codePreviewAnalysisCacheMisses: number;
    };
    assert.strictEqual(
      after.codePreviewAnalysisCacheMisses,
      before.codePreviewAnalysisCacheMisses + 1,
      'one source generation creates one analysis entry',
    );
    assert.ok(
      after.codePreviewAnalysisCacheHits >=
        before.codePreviewAnalysisCacheHits + 3,
      'classification and transpilation share the warmed entry',
    );
  });
});
