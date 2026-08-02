import { getService } from '@universal-ember/test-support';
import { setupTest } from 'ember-qunit';
import { module, test } from 'qunit';

import { opaqueRealmCardState } from '@cardstack/host/lib/realm-sandbox-boundary';

import type { BaseDef } from '@cardstack/base/card-api';
interface InspectableRealmSandbox {
  compartmentRuntimeFor(principal: string): unknown;
  retainRealmCard(card: BaseDef): () => void;
  evictIdleRealmRuntimes(): void;
  metricsSnapshot(): {
    activeCompartments: number;
    activeCompartmentLoads: number;
    cachedCompartmentTemplates: number;
    codePreviewAnalysisCacheEntries: number;
  };
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

  test('[SOAK-01] repeated cross-realm navigation leaves one mounted runtime and releases every departed realm', function (assert) {
    let service = getService(
      'realm-sandbox',
    ) as unknown as InspectableRealmSandbox;
    let styles = getService('realm-sandbox-styles');
    let releaseCard: () => void = () => undefined;
    let releaseStyles: () => void = () => undefined;
    let collectGarbage = (globalThis as typeof globalThis & { gc?: () => void })
      .gc;
    let memory = (
      performance as Performance & {
        memory?: { usedJSHeapSize: number };
      }
    ).memory;
    let warmHeap: number | undefined;

    for (let navigation = 0; navigation < 4096; navigation++) {
      releaseCard();
      releaseStyles();
      service.evictIdleRealmRuntimes();

      let principal = `https://realm-${navigation}.example/`;
      service.compartmentRuntimeFor(principal);
      releaseCard = service.retainRealmCard(opaqueCard(principal));
      releaseStyles = styles.acquire([
        `[data-scopedcss-soak-${navigation % 8}] { color: rgb(${navigation % 255} 0 0); }`,
      ]);

      if (navigation % 512 === 0) {
        assert.strictEqual(
          service.metricsSnapshot().activeCompartments,
          1,
          `navigation ${navigation} retains only its mounted realm runtime`,
        );
        assert.strictEqual(
          document.querySelectorAll('[data-realm-sandbox-stylesheet]').length,
          1,
          `navigation ${navigation} retains only its mounted stylesheet`,
        );
      }
      if (navigation === 255 && collectGarbage && memory) {
        releaseCard();
        releaseStyles();
        service.evictIdleRealmRuntimes();
        releaseCard = () => undefined;
        releaseStyles = () => undefined;
        collectGarbage();
        collectGarbage();
        warmHeap = memory.usedJSHeapSize;
      }
    }

    releaseCard();
    releaseStyles();
    service.evictIdleRealmRuntimes();
    let final = service.metricsSnapshot();
    assert.strictEqual(final.activeCompartments, 0, 'all realm runtimes exit');
    assert.strictEqual(
      final.activeCompartmentLoads,
      0,
      'no settled compartment-load promise remains registered',
    );
    assert.strictEqual(
      final.cachedCompartmentTemplates,
      0,
      'departed principal template caches are empty in this navigation run',
    );
    assert.strictEqual(
      document.querySelectorAll('[data-realm-sandbox-stylesheet]').length,
      0,
      'all sandbox stylesheets are released',
    );
    if (warmHeap != null && collectGarbage && memory) {
      collectGarbage();
      collectGarbage();
      let growth = memory.usedJSHeapSize - warmHeap;
      let growthMB = (growth / 1024 / 1024).toFixed(2);
      console.log(
        `REALM_SANDBOX_SOAK navigations=4096 heap_growth_mb=${growthMB} active_compartments=${final.activeCompartments} active_loads=${final.activeCompartmentLoads} cached_templates=${final.cachedCompartmentTemplates}`,
      );
      assert.true(
        growth <= 16 * 1024 * 1024,
        `steady-state browser heap grows by at most 16 MiB (actual ${growthMB} MiB)`,
      );
    } else {
      assert.ok(
        true,
        'this browser did not expose forced GC and precise heap size; bounded lifecycle assertions still ran',
      );
    }
  });
});
