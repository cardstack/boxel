import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import type { Realm, IndexedInstance } from '@cardstack/runtime-common';
import type { Loader } from '@cardstack/runtime-common/loader';

import {
  testRealmURL,
  setupCardLogs,
  setupLocalIndexing,
  setupIntegrationTestRealm,
} from '../helpers';
import { setupBaseRealm } from '../helpers/base-realm';
import {
  bxlTrackingPol100Renewal,
  bxlTrackingRealmContents,
} from '../helpers/cards/bxl-tracking';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupRenderingTest } from '../helpers/setup';

// The tracking realm's Policy⇄Claim shape is a true in-memory reference
// cycle: Claim.policy links to a Policy whose query-backed claims inverse
// contains that same Claim. jq's data model is acyclic JSON, so BXL hands
// the graph to the engine through a cycle-guarded lazy view — re-entering
// a card on the traversal path clips to a bounded { id } reference, the
// same clip queryableValue applies in search docs. This suite exercises
// that contract through the real indexing path: the fixture's formulas
// walk the back-edge and run structural operations across the cycle, and
// the cards still index promptly with converged values.
module('Integration | bxl cyclic card graphs', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  let loader: Loader;
  let realm: Realm;

  setupLocalIndexing(hooks);
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
    // Query-backed inverses resolve against the live index at visit time,
    // and the from-scratch pass above ran with an empty live index. Re-visit
    // the policy so its claims-dependent formulas converge; every assertion
    // below is against the converged state.
    await realm.write(
      'Policy/pol-100.json',
      JSON.stringify(bxlTrackingPol100Renewal),
    );
  });

  async function indexedSearchDoc(id: string) {
    let entry = await realm.realmIndexQueryEngine.instance(new URL(id));
    if (!entry || entry.type === 'instance-error') {
      throw new Error(
        `expected ${id} to index cleanly, got ${JSON.stringify(entry?.error)}`,
      );
    }
    return (entry as IndexedInstance).searchDoc ?? {};
  }

  test('walking the back-edge reads the bounded { id } reference', async function (assert) {
    let searchDoc = await indexedSearchDoc(`${testRealmURL}Policy/pol-100`);
    // Each claim's policy re-enters the policy the walk started from, so
    // `.claims[] | .policy.id` reads one own-id per claim (query sort
    // orders them by claimId).
    assert.deepEqual(searchDoc.claimPolicyIds, [
      `${testRealmURL}Policy/pol-100`,
      `${testRealmURL}Policy/pol-100`,
    ]);
  });

  test('structural operations across the cycle terminate and stay field-aware', async function (assert) {
    let searchDoc = await indexedSearchDoc(`${testRealmURL}Policy/pol-100`);
    // unique compares the claims by their materialized field values; the
    // two claims differ, so both survive. An opaque comparison would
    // collapse them to one; an unguarded one would never return.
    assert.strictEqual(searchDoc.distinctClaimCount, 2);
  });

  test('the cyclic fixture indexes cleanly end to end', async function (assert) {
    // The cycle-walking formulas above ride on the same policy card as the
    // rest of the tracking formulas — a wedged or crashed materialization
    // would surface here as an instance-error entry for the policy or a
    // missing aggregation, and as an error entry for each claim.
    let policyDoc = await indexedSearchDoc(`${testRealmURL}Policy/pol-100`);
    assert.strictEqual(policyDoc.paidClaimsTotal, 3980.75);
    let claimDoc = await indexedSearchDoc(`${testRealmURL}Claim/clm-1`);
    assert.strictEqual(claimDoc.customerName, 'Acme Freight');
  });
});
