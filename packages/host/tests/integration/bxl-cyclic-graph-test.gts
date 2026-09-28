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
// that contract through the real indexing path: the fixture's cycle-walking
// formulas run to completion during indexing without wedging or recursing
// unbounded, so the card indexes as a clean instance entry. Those formulas
// read the query-backed claims inverse, so their values are omitted from the
// search doc (the index has no invalidation edge to that inverse); a
// non-terminating clip would surface here as an instance-error rather than a
// clean entry, which is what these assertions turn on.
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

  test('walking the back-edge terminates and its result is omitted', async function (assert) {
    // `.claims[] | .policy.id` walks each claim's policy back-edge, which
    // re-enters the policy the walk started from; the cycle-guard clips it to
    // a bounded { id } so the walk terminates. `indexedSearchDoc` throwing on
    // an instance-error is what would catch a non-terminating clip. The value
    // reads the query-backed inverse, so it is omitted from the search doc.
    let searchDoc = await indexedSearchDoc(`${testRealmURL}Policy/pol-100`);
    assert.strictEqual(searchDoc.claimPolicyIds, undefined);
  });

  test('structural operations across the cycle terminate and their result is omitted', async function (assert) {
    // `[.claims[]] | unique | length` compares the claims by their
    // materialized field values across the cycle; an unguarded comparison
    // would never return, wedging the index. It terminates, so the policy
    // indexes cleanly — and because the formula reduces over the query-backed
    // inverse, its value is omitted from the search doc.
    let searchDoc = await indexedSearchDoc(`${testRealmURL}Policy/pol-100`);
    assert.strictEqual(searchDoc.distinctClaimCount, undefined);
  });

  test('the cyclic fixture indexes cleanly end to end', async function (assert) {
    // The cycle-walking formulas ride on the same policy card as the rest of
    // the tracking formulas — a wedged or crashed materialization would
    // surface as an instance-error entry (which `indexedSearchDoc` throws on)
    // for the policy and each claim. The claim's `customerName` reaches the
    // customer through `linksTo`, not the query inverse, so it is a
    // self-derived value that stays in the index and confirms the pass
    // produced real search-doc content rather than an empty shell.
    await indexedSearchDoc(`${testRealmURL}Policy/pol-100`);
    let claimDoc = await indexedSearchDoc(`${testRealmURL}Claim/clm-1`);
    assert.strictEqual(claimDoc.customerName, 'Acme Freight');
  });
});
