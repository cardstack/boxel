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

// BXL's `derive` profile runs at index time, so the search doc is where its
// correctness is load-bearing: it is what queries filter and sort on, and it
// is regenerated from scratch on every pass that touches the card. This
// suite covers that indexing dimension — BXL computeds land in the search
// doc in a shape the query engine can match on, and they recompute whenever
// an edit invalidates the card, whether the edit lands on the card itself,
// on a card it reaches through a link, or on the module that declares the
// formula.
//
// Per-function values are pinned by the expression suite and the cycle
// contract by the cyclic-graph suite; both read the same tracking-realm
// fixture, so an assertion here is about when a value is recomputed rather
// than what the formula returns.
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

  // A write of byte-identical content is skipped, so each revisit needs a
  // distinguishable policy status.
  async function revisitPolicy(policyStatus: string) {
    await realm.write(
      'Policy/pol-100.json',
      JSON.stringify(bxlTrackingPol100Doc(policyStatus)),
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
        sort: [{ on: claimRef, by: 'claimId', direction: 'asc' }],
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
    assert.strictEqual(searchDoc.incurredAmount, 21500);
    assert.strictEqual(
      searchDoc.severityBand,
      'Large',
      'the band follows the new amount across its threshold',
    );
    // The stale value is gone from the index, not merely shadowed by a
    // fresh one — the previous band no longer matches anything.
    assert.deepEqual(
      await matchingIds({
        filter: { on: claimRef, eq: { severityBand: 'Standard' } },
      }),
      [],
      'the superseded value is out of the search doc',
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
    // visited. Writing the claim invalidates the claim, so the policy still
    // carries the aggregate it computed on its last visit.
    let searchDoc = await indexedSearchDoc(`${testRealmURL}Policy/pol-100`);
    assert.strictEqual(searchDoc.paidClaimsTotal, 3980.75);
    assert.strictEqual(searchDoc.openClaimCount, 1);

    // That next visit recomputes against the now-current claims.
    await revisitPolicy('Reviewed');

    searchDoc = await indexedSearchDoc(`${testRealmURL}Policy/pol-100`);
    assert.strictEqual(searchDoc.paidClaimsTotal, 4200.5);
    assert.strictEqual(searchDoc.reservedClaimsTotal, 2000);
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
    await revisitPolicy('Reviewed');

    let searchDoc = await indexedSearchDoc(`${testRealmURL}Policy/pol-100`);
    assert.strictEqual(searchDoc.paidClaimsTotal, 4000);
    assert.strictEqual(searchDoc.openClaimCount, 2);
    assert.deepEqual(
      searchDoc.claimPolicyIds,
      Array(3).fill(`${testRealmURL}Policy/pol-100`),
      'the new claim joins the inverse the cycle-walking formula reads',
    );

    await realm.delete('Claim/clm-4.json');
    await revisitPolicy('Audited');

    searchDoc = await indexedSearchDoc(`${testRealmURL}Policy/pol-100`);
    assert.strictEqual(searchDoc.paidClaimsTotal, 3980.75);
    assert.strictEqual(searchDoc.openClaimCount, 1);
    assert.deepEqual(
      searchDoc.claimPolicyIds,
      Array(2).fill(`${testRealmURL}Policy/pol-100`),
      'and leaves it again when the claim is deleted',
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
    );
    assert.strictEqual(
      (await indexedSearchDoc(`${testRealmURL}Policy/pol-200`)).premiumWithTax,
      8800,
      'the instance nothing else touched is reindexed too',
    );
  });

  test("an edit that strips a card's inputs still yields a clean index entry", async function (assert) {
    // Every computed on the policy now reads a missing link or a blank
    // number, and one of them divides by a literal zero. An Excel error
    // escaping as a thrown exception would turn the whole card into an
    // instance-error entry and strand the computeds that are still
    // perfectly well defined.
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
    assert.strictEqual(divByZero, null, 'the #DIV/0! sentinel clips to null');
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
    );
  });
});
