import { waitUntil } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import type { Realm, IndexedInstance } from '@cardstack/runtime-common';
import type { Loader } from '@cardstack/runtime-common/loader';

import type StoreService from '@cardstack/host/services/store';

import {
  testRealmURL,
  setupCardLogs,
  setupLocalIndexing,
  setupIntegrationTestRealm,
} from '../helpers';
import { setupBaseRealm } from '../helpers/base-realm';
import { bxlTrackingRealmContents } from '../helpers/cards/bxl-tracking';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { renderCard } from '../helpers/render-component';
import { setupRenderingTest } from '../helpers/setup';

import type { CardDef as CardDefType } from '@cardstack/base/card-api';

// '@cardstack/bxl' is a platform-provided module: the host serves it to card
// code through the VirtualNetwork's async shim, which also folds the lazy
// formula chunks (statistical, Bessel, engineering/financial, validation)
// into the default library set before any card module body runs. These tests
// prove the exposure end to end on realm SOURCE — the card modules here are
// strings compiled by the realm, not classes handed in by the test — so
// `import { expression, fx, jq } from '@cardstack/bxl'` resolves through the
// same path a user realm exercises: rendering, indexing, and search-doc
// generation all evaluate the imported expressions.
module('Integration | bxl platform module', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  let loader: Loader;
  let realm: Realm;

  setupLocalIndexing(hooks, {
    reuseIndexAcrossTests: 'bxlPlatformModule',
  });
  setupCardLogs(
    hooks,
    async () => await loader.import('@cardstack/base/card-api'),
  );

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });

  hooks.beforeEach(async function () {
    loader = getService('loader-service').loader;
    ({ realm } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: bxlTrackingRealmContents,
    }));
  });

  async function indexedSearchDoc(id: string) {
    let entry = await realm.realmIndexQueryEngine.instance(new URL(id));
    if (!entry || entry.type === 'instance-error') {
      throw new Error(
        `expected ${id} to index cleanly, got ${JSON.stringify(entry?.error?.errorDetail?.message)}`,
      );
    }
    return (entry as IndexedInstance).searchDoc ?? {};
  }

  test('a card importing @cardstack/bxl indexes with correct computed search-doc values', async function (assert) {
    let searchDoc = await indexedSearchDoc(`${testRealmURL}Policy/pol-100`);

    // plain-string mode
    assert.strictEqual(searchDoc.premiumWithTax, 12840);
    // fx mode; PMT comes from the lazily-loaded financial formula chunk, so
    // this value also proves chunk loading works inside the indexing path
    assert.strictEqual(searchDoc.monthlyPayment, 1032.8);
    // jq mode over the query-backed claims
    assert.strictEqual(searchDoc.paidClaimsTotal, 3980.75);
    assert.strictEqual(searchDoc.openClaimCount, 1);
    // linksTo traversal
    assert.strictEqual(searchDoc.customerName, 'Acme Freight');
    // chained computeds
    assert.strictEqual(searchDoc.lossRatio, 0.4567);
  });

  test('the imported module is served to the realm module through the loader', async function (assert) {
    let mod: Record<string, unknown> = await loader.import(
      `${testRealmURL}tracking`,
    );
    assert.ok(mod.Policy, 'the realm module exposes the Policy card');
    assert.ok(
      mod.RiskBandField,
      'the realm module exposes the RiskBand field def',
    );
  });

  test('a card importing @cardstack/bxl renders with computed values', async function (assert) {
    let store = getService('store') as StoreService;
    let instance = (await store.get(
      `${testRealmURL}Policy/pol-100`,
    )) as CardDefType;
    await renderCard(loader, instance, 'embedded');

    // Query-backed links resolve asynchronously during render; the computed
    // spans settle once the claims are resident.
    await waitUntil(
      () =>
        document
          .querySelector('[data-test-paid-claims-total]')
          ?.textContent?.trim() === '3980.75',
    );

    assert.dom('[data-test-policy="POL-100"]').exists();
    assert.dom('[data-test-premium-with-tax]').hasText('12840');
    assert.dom('[data-test-monthly-payment]').hasText('1032.8');
    assert.dom('[data-test-customer-name]').hasText('Acme Freight');
    assert.dom('[data-test-loss-ratio]').hasText('0.4567');
    assert.dom('[data-test-risk-band]').hasText('Low');
  });
});
