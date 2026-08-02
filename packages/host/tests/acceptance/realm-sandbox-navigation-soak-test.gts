import { settled, waitFor } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';

import config from '@cardstack/host/config/environment';

import type RealmSandboxService from '@cardstack/host/services/realm-sandbox';

import {
  realmConfigCardJSON,
  setupAcceptanceTestRealm,
  setupAuthEndpoints,
  setupLocalIndexing,
  setupOnSave,
  setupRealmCacheTeardown,
  setupUserSubscription,
  SYSTEM_CARD_FIXTURE_CONTENTS,
  testRealmURL,
  visitOperatorMode,
  withCachedRealmSetup,
} from '../helpers';
import { CardsGrid, setupBaseRealm } from '../helpers/base-realm';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';

const secondRealmURL = 'http://test-realm/sandbox-soak-iframe/';
const navigationCount = 32;

const sesCardSource = `
  import { CardDef, Component } from '@cardstack/base/card-api';

  export class SoakCard extends CardDef {
    static isolated = class Isolated extends Component<typeof this> {
      <template>
        <article data-test-route-soak-ses>SES route</article>
        <style scoped>article { color: rebeccapurple; }</style>
      </template>
    };
  }
`;

const iframeCardSource = `
  import { CardDef, Component } from '@cardstack/base/card-api';

  const sandboxDocument = document;
  export class IframeSoakCard extends CardDef {
    static isolated = class Isolated extends Component<typeof this> {
      <template><article>Iframe route</article></template>
    };
  }
  void sandboxDocument;
`;

function realmContents(sourceName: string, source: string, exportName: string) {
  return {
    ...SYSTEM_CARD_FIXTURE_CONTENTS,
    'index.json': new CardsGrid(),
    'realm.json': realmConfigCardJSON({ name: `Sandbox soak ${exportName}` }),
    [`${sourceName}.gts`]: source,
    [`${exportName}/sample.json`]: {
      data: {
        attributes: {},
        meta: {
          adoptsFrom: {
            module: `../${sourceName}`,
            name: exportName,
          },
        },
      },
    },
  };
}

module('Acceptance | realm sandbox route navigation soak', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupOnSave(hooks);
  setupRealmCacheTeardown(hooks);
  setupBaseRealm(hooks);

  let originalIframeOrigin: string | undefined;
  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [baseRealm.url, testRealmURL, secondRealmURL],
  });

  hooks.beforeEach(async function () {
    originalIframeOrigin = config.realmSandboxIframeOrigin;
    // Testem cannot autoboot a second app, but mounting the real iframe
    // renderer still exercises browsing-context and MessageChannel teardown.
    config.realmSandboxIframeOrigin = 'https://127.0.0.1:1';
    mockMatrixUtils.setRealmPermissions({
      [testRealmURL]: ['read', 'write'],
      [secondRealmURL]: ['read', 'write'],
    });
    await mockMatrixUtils.createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'realm-sandbox-navigation-soak',
    });
    setupUserSubscription();
    setupAuthEndpoints();

    await withCachedRealmSetup(async () => {
      await setupAcceptanceTestRealm({
        mockMatrixUtils,
        realmURL: secondRealmURL,
        contents: realmContents(
          'iframe-soak-card',
          iframeCardSource,
          'IframeSoakCard',
        ),
      });
      return await setupAcceptanceTestRealm({
        mockMatrixUtils,
        contents: realmContents('soak-card', sesCardSource, 'SoakCard'),
      });
    });
  });

  hooks.afterEach(function () {
    config.realmSandboxIframeOrigin = originalIframeOrigin;
  });

  test('[SOAK-04] repeated route navigation releases SES runtimes, styles, iframes, and channels', async function (assert) {
    let sandbox = getService('realm-sandbox') as RealmSandboxService;
    let warmHeap: number | undefined;
    let memory = (
      performance as Performance & { memory?: { usedJSHeapSize: number } }
    ).memory;
    let collectGarbage = (globalThis as typeof globalThis & { gc?: () => void })
      .gc;

    for (let navigation = 0; navigation < navigationCount; navigation++) {
      let useIframe = navigation % 2 === 1;
      let id = useIframe
        ? `${secondRealmURL}IframeSoakCard/sample`
        : `${testRealmURL}SoakCard/sample`;
      await visitOperatorMode({
        submode: 'interact',
        stacks: [[{ id, format: 'isolated' }]],
      });
      if (useIframe) {
        await waitFor('.realm-sandbox-iframe iframe');
      } else {
        await waitFor('[data-test-route-soak-ses]');
      }
      await settled();
      sandbox.evictIdleRealmRuntimes();

      let metrics = sandbox.metricsSnapshot();
      assert.true(
        metrics.activeCompartments <= 1,
        `navigation ${navigation} retains at most the active realm principal`,
      );
      assert.strictEqual(
        metrics.activeIframeConnections,
        useIframe ? 1 : 0,
        `navigation ${navigation} has exactly the mounted iframe connection`,
      );
      assert.true(
        document.querySelectorAll('[data-realm-sandbox-stylesheet]').length <=
          1,
        `navigation ${navigation} retains at most one authored stylesheet`,
      );
      assert.strictEqual(
        document.querySelectorAll('.realm-sandbox-iframe iframe').length,
        useIframe ? 1 : 0,
        `navigation ${navigation} has no detached iframe in the document`,
      );

      if (navigation === 7 && collectGarbage && memory) {
        collectGarbage();
        collectGarbage();
        warmHeap = memory.usedJSHeapSize;
      }
    }

    await visitOperatorMode({ submode: 'interact', stacks: [] });
    await settled();
    sandbox.evictIdleRealmRuntimes();
    let final = sandbox.metricsSnapshot();
    assert.strictEqual(final.activeCompartments, 0, 'all SES runtimes exit');
    assert.strictEqual(
      final.activeCompartmentLoads,
      0,
      'all SES module loads settle and exit',
    );
    assert.strictEqual(
      final.cachedCompartmentTemplates,
      0,
      'all departed-principal templates exit',
    );
    assert.strictEqual(
      final.activeIframeConnections,
      0,
      'every iframe MessageChannel is closed',
    );
    assert.strictEqual(
      document.querySelectorAll('.realm-sandbox-iframe iframe').length,
      0,
      'every iframe browsing context is removed',
    );
    assert.strictEqual(
      document.querySelectorAll('[data-realm-sandbox-stylesheet]').length,
      0,
      'every authored stylesheet is released',
    );

    if (warmHeap != null && collectGarbage && memory) {
      collectGarbage();
      collectGarbage();
      let growthMB = (memory.usedJSHeapSize - warmHeap) / 1024 / 1024;
      console.log(
        `REALM_SANDBOX_ROUTE_SOAK navigations=${navigationCount} heap_growth_mb=${growthMB.toFixed(2)} active_compartments=${final.activeCompartments} active_iframe_connections=${final.activeIframeConnections}`,
      );
      assert.true(
        growthMB <= 16,
        `route steady-state browser heap grows by at most 16 MiB (actual ${growthMB.toFixed(2)} MiB)`,
      );
    } else {
      assert.ok(
        true,
        'this browser did not expose forced GC and precise heap size; DOM, channel, stylesheet, and runtime bounds still ran',
      );
    }
  });
});
