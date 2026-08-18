import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { rri } from '@cardstack/runtime-common';
import type { IndexedInstance, Realm, Query } from '@cardstack/runtime-common';
import type { Loader } from '@cardstack/runtime-common/loader';

import {
  testRealmURL,
  setupCardLogs,
  setupLocalIndexing,
  setupIntegrationTestRealm,
} from '../helpers';
import { setupBaseRealm } from '../helpers/base-realm';
import {
  bxlTrackingCardSource,
  bxlTrackingPol100Doc,
  bxlTrackingPol100Renewal,
  bxlTrackingRealmContents,
} from '../helpers/cards/bxl-tracking';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { searchCardsForTest } from '../helpers/search-cards';
import { setupRenderingTest } from '../helpers/setup';

// A BXL `computeVia` runs whenever the field is read, and indexing is the
// read that persists: the search doc is what queries filter and sort on,
// and it is regenerated on every pass that touches the card. This suite
// covers that indexing dimension — BXL computeds land in the search doc in
// a shape the query engine can match on, and they recompute whenever an
// edit invalidates the card, whether the edit lands on the card itself, on
// a card it reaches through a link, or on the module that declares the
// formula.
//
// Recomputation is the part with real teeth. `expression()` memoizes each
// compute per card instance, so a memo that outlived its cycle would show
// up as a computed that quietly keeps a superseded value across an
// incremental pass — indistinguishable, from the outside, from an
// invalidation that never fired.
//
// The value each formula returns is pinned by the expression suite and the
// cycle contract by the cyclic-graph suite; all three read the same
// tracking-realm fixture.
module('Integration | bxl indexing', function (hooks) {
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
    // and the from-scratch pass above ran with an empty live index — the
    // claims aggregations baked in their empty-set values. Re-visiting the
    // policy converges them; every assertion below starts from that
    // converged state.
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

  async function matchingIds(query: Query) {
    let { data } = await searchCardsForTest(realm.realmIndexQueryEngine, query);
    return data.map((resource) => String(resource.id));
  }

  const policyRef = { module: rri(`${testRealmURL}tracking`), name: 'Policy' };
  const claimRef = { module: rri(`${testRealmURL}tracking`), name: 'Claim' };

  async function writeClaim(path: string, attributes: Record<string, unknown>) {
    await realm.write(
      path,
      JSON.stringify({
        data: {
          type: 'card',
          attributes,
          relationships: {
            policy: { links: { self: '../Policy/pol-100' } },
          },
          meta: { adoptsFrom: { module: '../tracking', name: 'Claim' } },
        },
      }),
    );
  }

  // Query-backed aggregations converge when the policy is next visited, and
  // a write of byte-identical content is skipped — so each revisit has to
  // carry a status no earlier one used. No formula reads policyStatus; the
  // counter exists only to make the write land.
  let revisitCount = 0;
  async function revisitPolicy() {
    await realm.write(
      'Policy/pol-100.json',
      JSON.stringify(bxlTrackingPol100Doc(`Reviewed ${++revisitCount}`)),
    );
  }

  // ===========================================================================
  // The search doc the query engine sees
  // ===========================================================================

  test('BXL computeds are matchable by the query engine', async function (assert) {
    // A computed that only rendered correctly would still be invisible to
    // search. Matching on one proves the indexer wrote the computed value
    // into the search doc under its field name, typed the way the field
    // declares it — a string field matched by equality, a number field by
    // range.
    assert.deepEqual(
      await matchingIds({
        filter: { on: claimRef, eq: { severityBand: 'Standard' } },
      }),
      [`${testRealmURL}Claim/clm-1`],
      'a string computed matches by equality',
    );
    assert.deepEqual(
      await matchingIds({
        filter: { on: claimRef, range: { incurredAmount: { gt: 1000 } } },
      }),
      [`${testRealmURL}Claim/clm-1`],
      'a number computed matches by range, so it indexed as a number',
    );
    // POL-200 has no claims, so its loss ratio is 0 and it stays out.
    assert.deepEqual(
      await matchingIds({
        filter: { on: policyRef, range: { lossRatio: { gt: 0.4 } } },
      }),
      [`${testRealmURL}Policy/pol-100`],
      'a computed chained off other computeds is matchable too',
    );
  });

  test('{ as: FieldDef } computeds are matchable on their nested paths', async function (assert) {
    // The materialized field instance has to survive serialization into the
    // search doc as a nested object, not as an opaque blob, or the dotted
    // path has nothing to match against. Both policies band as Low — POL-200
    // has no claims at all, so its loss ratio is 0 — and the score field
    // separates them.
    assert.deepEqual(
      await matchingIds({
        filter: { on: policyRef, eq: { 'riskBand.label': 'Low' } },
        sort: [{ on: policyRef, by: 'policyId', direction: 'asc' }],
      }),
      [`${testRealmURL}Policy/pol-100`, `${testRealmURL}Policy/pol-200`],
      'the nested label of a single materialized instance',
    );
    assert.deepEqual(
      await matchingIds({
        filter: { on: policyRef, range: { 'riskBand.score': { gt: 1 } } },
      }),
      [`${testRealmURL}Policy/pol-100`],
      'a nested number keeps its type through materialization',
    );
    assert.deepEqual(
      await matchingIds({
        filter: { on: policyRef, eq: { 'claimBands.label': 'Minor' } },
      }),
      [`${testRealmURL}Policy/pol-100`],
      'an element of a materialized array',
    );
  });

  test('BXL computeds are sortable', async function (assert) {
    assert.deepEqual(
      await matchingIds({
        filter: { type: policyRef },
        sort: [{ on: policyRef, by: 'premiumWithTax', direction: 'desc' }],
      }),
      [`${testRealmURL}Policy/pol-100`, `${testRealmURL}Policy/pol-200`],
      'descending by a computed premium',
    );
    assert.deepEqual(
      await matchingIds({
        filter: { type: policyRef },
        sort: [{ on: policyRef, by: 'premiumWithTax', direction: 'asc' }],
      }),
      [`${testRealmURL}Policy/pol-200`, `${testRealmURL}Policy/pol-100`],
      'and ascending, so the order tracks the values rather than the ids',
    );
  });

  // ===========================================================================
  // Incremental reindex
  // ===========================================================================

  test("editing a card's own input recomputes its computeds", async function (assert) {
    await writeClaim('Claim/clm-1.json', {
      claimId: 'CLM-1',
      claimStatus: 'Open',
      paidAmount: 20000,
      reserveAmount: 1500,
    });

    let searchDoc = await indexedSearchDoc(`${testRealmURL}Claim/clm-1`);
    assert.strictEqual(searchDoc.incurredAmount, 21500, 'the sum recomputes');
    assert.strictEqual(
      searchDoc.severityBand,
      'Large',
      'the band follows the new amount across its threshold',
    );
    // The index moved the claim from one band to the other, rather than
    // dropping it or keeping both: a memo surviving the pass would leave it
    // matching Standard, and a lost row would match neither.
    assert.deepEqual(
      await matchingIds({
        filter: { on: claimRef, eq: { severityBand: 'Standard' } },
      }),
      [],
      'the superseded value is out of the search doc',
    );
    assert.deepEqual(
      await matchingIds({
        filter: { on: claimRef, eq: { severityBand: 'Large' } },
      }),
      [`${testRealmURL}Claim/clm-1`],
      'and the fresh value is in it',
    );
  });

  test('editing a linked card recomputes the cards that traverse to it', async function (assert) {
    await realm.write(
      'Customer/acme.json',
      JSON.stringify({
        data: {
          type: 'card',
          attributes: { name: 'Acme Logistics', tier: 'Platinum' },
          meta: { adoptsFrom: { module: '../tracking', name: 'Customer' } },
        },
      }),
    );

    let customerDoc = await indexedSearchDoc(`${testRealmURL}Customer/acme`);
    assert.strictEqual(
      customerDoc.displayLabel,
      'Acme Logistics (Platinum)',
      "the edited card's own computed recomputes",
    );
    let policyDoc = await indexedSearchDoc(`${testRealmURL}Policy/pol-100`);
    assert.strictEqual(
      policyDoc.customerName,
      'Acme Logistics',
      'the policy reads the renamed customer one hop away',
    );
    let claimDoc = await indexedSearchDoc(`${testRealmURL}Claim/clm-1`);
    assert.strictEqual(
      claimDoc.customerName,
      'Acme Logistics',
      'and the claim reads it two hops away, through the policy',
    );
  });

  test("an edit to a claim converges into the aggregate on the policy's next visit", async function (assert) {
    await writeClaim('Claim/clm-2.json', {
      claimId: 'CLM-2',
      claimStatus: 'Open',
      paidAmount: 1000,
      reserveAmount: 500,
    });

    // The only stored edge runs claim → policy; the policy's `claims` side
    // is a query resolved against the live index when the policy is
    // visited. A dependency read through a query context is not recorded as
    // an invalidation edge, so writing the claim reindexes the claim alone
    // and the policy keeps the aggregate from its last visit. These two
    // assert that staleness deliberately — they are the contract as it
    // stands, not the behavior anyone would want.
    let searchDoc = await indexedSearchDoc(`${testRealmURL}Policy/pol-100`);
    assert.strictEqual(
      searchDoc.paidClaimsTotal,
      3980.75,
      'the claim edit does not reach the policy through the query inverse',
    );
    assert.strictEqual(
      searchDoc.openClaimCount,
      1,
      'nor does the status change it would have counted',
    );

    // That next visit recomputes against the now-current claims.
    await revisitPolicy();

    searchDoc = await indexedSearchDoc(`${testRealmURL}Policy/pol-100`);
    assert.strictEqual(
      searchDoc.paidClaimsTotal,
      4200.5,
      'the aggregate picks up the edited claim',
    );
    assert.strictEqual(searchDoc.reservedClaimsTotal, 2000, 'and its reserve');
    assert.strictEqual(
      searchDoc.openClaimCount,
      2,
      'the reopened claim counts toward the open tally',
    );
    assert.strictEqual(
      searchDoc.lossRatio,
      0.5167,
      'the chained computed follows the aggregate it reads',
    );
  });

  test('a claim joining or leaving the realm converges into the aggregate', async function (assert) {
    await writeClaim('Claim/clm-4.json', {
      claimId: 'CLM-4',
      claimStatus: 'Open',
      paidAmount: 19.25,
      reserveAmount: 0,
    });
    await revisitPolicy();

    let policyId = `${testRealmURL}Policy/pol-100`;
    let searchDoc = await indexedSearchDoc(policyId);
    assert.strictEqual(searchDoc.paidClaimsTotal, 4000, 'the total grows');
    assert.strictEqual(searchDoc.openClaimCount, 2, 'and so does the tally');
    assert.deepEqual(
      searchDoc.claimPolicyIds,
      [policyId, policyId, policyId],
      'the new claim joins the inverse the cycle-walking formula reads',
    );

    await realm.delete('Claim/clm-4.json');
    await revisitPolicy();

    assert.strictEqual(
      await realm.realmIndexQueryEngine.instance(
        new URL(`${testRealmURL}Claim/clm-4`),
      ),
      undefined,
      'the deleted claim leaves the index entirely',
    );
    searchDoc = await indexedSearchDoc(policyId);
    assert.strictEqual(searchDoc.paidClaimsTotal, 3980.75, 'the total shrinks');
    assert.strictEqual(searchDoc.openClaimCount, 1, 'and so does the tally');
    assert.deepEqual(
      searchDoc.claimPolicyIds,
      [policyId, policyId],
      'and the claim leaves the inverse when it is deleted',
    );
  });

  test('editing the formula in the module recomputes every instance', async function (assert) {
    // Formulas live in card source, so a formula change arrives as a module
    // edit. Every instance of the card has to be revisited, not just the one
    // that happens to be open.
    await realm.write(
      'tracking.gts',
      bxlTrackingCardSource.replace(
        '.annualPremium * 1.07',
        '.annualPremium * 1.1',
      ),
    );

    assert.strictEqual(
      (await indexedSearchDoc(`${testRealmURL}Policy/pol-100`)).premiumWithTax,
      13200,
      'the new multiplier reaches the instance in hand',
    );
    assert.strictEqual(
      (await indexedSearchDoc(`${testRealmURL}Policy/pol-200`)).premiumWithTax,
      8800,
      'the instance nothing else touched is reindexed too',
    );
  });

  test("an edit that strips a card's inputs still yields a clean index entry", async function (assert) {
    // Every computed on the policy now reads a missing link or a blank
    // number. Two distinct tolerances keep the card indexable, and a gap in
    // either one turns it into an instance-error entry that strands the
    // computeds still perfectly well defined: arithmetic on a null or a
    // zero divisor yields null inside the engine, while a function that
    // raises an Excel sentinel — NA() — throws, and the factory catches
    // that at the boundary.
    await realm.write(
      'Policy/pol-100.json',
      JSON.stringify({
        data: {
          type: 'card',
          attributes: { policyId: 'POL-100', policyStatus: 'Lapsed' },
          meta: { adoptsFrom: { module: '../tracking', name: 'Policy' } },
        },
      }),
    );

    let entry = await realm.realmIndexQueryEngine.instance(
      new URL(`${testRealmURL}Policy/pol-100`),
    );
    assert.strictEqual(
      entry?.type,
      'instance',
      'a clean instance entry, not an instance-error',
    );
    let searchDoc = (entry as IndexedInstance).searchDoc ?? {};
    let customerName = searchDoc.customerName ?? null;
    assert.strictEqual(
      customerName,
      null,
      'the dropped link recomputes to null rather than keeping a stale name',
    );
    let divByZero = searchDoc.divByZero ?? null;
    assert.strictEqual(
      divByZero,
      null,
      'dividing a blank premium by zero yields null inside the engine',
    );
    let notApplicable = searchDoc.notApplicable ?? null;
    assert.strictEqual(
      notApplicable,
      null,
      'and the sentinel NA() throws is caught at the factory boundary',
    );
    assert.strictEqual(
      searchDoc.premiumWithTax,
      0,
      'the blank premium reads as 0 under Excel blank semantics',
    );

    // The degraded card also leaves the result sets it used to match, so a
    // query never serves the values it computed before the edit.
    assert.deepEqual(
      await matchingIds({
        filter: { on: policyRef, range: { 'riskBand.score': { gt: 1 } } },
      }),
      [],
      'the pre-edit risk score is out of the index',
    );
  });
});
