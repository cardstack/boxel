import { expression, fx, jq } from '@cardstack/bxl';
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
import {
  CardDef,
  FieldDef,
  StringField,
  NumberField,
  contains,
  containsMany,
  field,
  getFields,
  setupBaseRealm,
} from '../helpers/base-realm';
import {
  bxlTrackingPol100Renewal,
  bxlTrackingRealmContents,
} from '../helpers/cards/bxl-tracking';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupRenderingTest } from '../helpers/setup';

// The core BXL-on-real-cards suite: the `expression()` factory driving
// computeVia on actual CardDef instances through the real card-api — the
// field metadata (`getFields`) that `{ as: FieldDef }` materialization
// consults, the real link-loading machinery under jq path traversal, and the
// real indexer generating search docs from BXL computeds. Plain-JSON inputs
// are covered by the bxl package's own unit suite; everything here goes
// through cards.
//
// The realm fixtures live in helpers/cards/bxl-tracking.ts and are shared
// with the platform-module suite; the factory-level dimensions (metadata,
// memoization, materialization shapes) use a purpose-built card class so
// each assertion touches only its own dimension.
module('Integration | bxl expressions on real cards', function (hooks) {
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
    // Query-backed inverses resolve against the live index at visit time, and
    // the from-scratch pass above ran with an empty live index — POL-100's
    // claims aggregations baked in their empty-set values (that first-pass
    // contract is pinned by the platform-module suite). Re-visiting the
    // policy now that the claims are live converges them; the assertions in
    // this suite are all against the converged state.
    await realm.write(
      'Policy/pol-100.json',
      JSON.stringify(bxlTrackingPol100Renewal),
    );
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

  // ===========================================================================
  // The three syntax modes
  // ===========================================================================

  test('all three syntax modes drive computeVia on real fields', async function (assert) {
    let searchDoc = await indexedSearchDoc(`${testRealmURL}Policy/pol-100`);
    assert.strictEqual(
      searchDoc.premiumWithTax,
      12840,
      'plain string compiles as readable BXL',
    );
    assert.strictEqual(
      searchDoc.monthlyPayment,
      1032.8,
      'fx compiles Excel-like readable syntax (PascalCase labels)',
    );
    assert.strictEqual(
      searchDoc.paidClaimsTotal,
      3980.75,
      'jq is handed straight to the jq engine',
    );
  });

  // ===========================================================================
  // Linked-card traversal
  // ===========================================================================

  test('jq paths traverse linksTo targets', async function (assert) {
    let searchDoc = await indexedSearchDoc(`${testRealmURL}Policy/pol-100`);
    assert.strictEqual(searchDoc.customerName, 'Acme Freight');
    assert.strictEqual(searchDoc.underwriterName, 'Dana Reeve');
  });

  test('a dotted path crosses two links', async function (assert) {
    // claim → policy → customer
    let searchDoc = await indexedSearchDoc(`${testRealmURL}Claim/clm-1`);
    assert.strictEqual(searchDoc.customerName, 'Acme Freight');
  });

  test('aggregations run over the query-backed claims inverse', async function (assert) {
    let searchDoc = await indexedSearchDoc(`${testRealmURL}Policy/pol-100`);
    assert.strictEqual(searchDoc.paidClaimsTotal, 3980.75);
    assert.strictEqual(searchDoc.reservedClaimsTotal, 1500);
    assert.strictEqual(searchDoc.openClaimCount, 1);
    assert.strictEqual(
      searchDoc.lossRatio,
      0.4567,
      'chained computeds read other BXL computeds',
    );
  });

  // ===========================================================================
  // Null tolerance
  // ===========================================================================

  test('missing links propagate null through jq paths and the card still indexes', async function (assert) {
    let searchDoc = await indexedSearchDoc(`${testRealmURL}Policy/pol-200`);
    assert.strictEqual(searchDoc.customerName ?? null, null);
    assert.strictEqual(searchDoc.underwriterName ?? null, null);
    assert.strictEqual(
      searchDoc.paidClaimsTotal,
      0,
      'aggregation over an empty claims inverse falls back to 0',
    );
    assert.strictEqual(searchDoc.lossRatio, 0);
  });

  test('blank numeric fields read as 0 under Excel blank semantics', async function (assert) {
    // CLM-3 has no amounts and no policy link.
    let searchDoc = await indexedSearchDoc(`${testRealmURL}Claim/clm-3`);
    assert.strictEqual(searchDoc.incurredAmount, 0);
    assert.strictEqual(searchDoc.severityBand, 'Minor');
    assert.strictEqual(
      searchDoc.customerName ?? null,
      null,
      'the two-hop path yields null when the first hop is missing',
    );
  });

  // ===========================================================================
  // Excel error sentinels
  // ===========================================================================

  test('Excel error sentinels surface as null, never a crashed compute', async function (assert) {
    let searchDoc = await indexedSearchDoc(`${testRealmURL}Policy/pol-100`);
    assert.strictEqual(searchDoc.notApplicable ?? null, null, '#N/A → null');
    assert.strictEqual(searchDoc.divByZero ?? null, null, '#DIV/0! → null');
  });

  // ===========================================================================
  // { as: FieldDef } materialization
  // ===========================================================================

  test('{ as: FieldDef } output lands in the search doc as structured field values', async function (assert) {
    let searchDoc = await indexedSearchDoc(`${testRealmURL}Policy/pol-100`);
    assert.strictEqual(searchDoc.riskBand?.label, 'Low');
    assert.strictEqual(searchDoc.riskBand?.score, 46);
    // Query sort orders the claims by claimId, so the bands are stable.
    assert.deepEqual(
      (searchDoc.claimBands ?? []).map((band: any) => band?.label),
      ['Standard', 'Minor'],
    );
    assert.deepEqual(
      (searchDoc.claimBands ?? []).map((band: any) => band?.score),
      [3200.5, 780.25],
    );
  });

  test('{ as: FieldDef } materializes real instances through getFields', async function (assert) {
    class BadgeField extends FieldDef {
      static displayName = 'Badge';
      @field text = contains(StringField);
    }
    class PanelField extends FieldDef {
      static displayName = 'Panel';
      @field label = contains(StringField);
      @field score = contains(NumberField);
      @field flags = containsMany(StringField);
      @field badge = contains(BadgeField);
    }
    class Quote extends CardDef {
      static displayName = 'Quote';
      @field subtotal = contains(NumberField);
      @field statusPanel = contains(PanelField, {
        computeVia: expression(
          jq`{
            label: (if .subtotal > 50 then "big" else "small" end),
            score: .subtotal,
            flags: ["checked"],
            badge: { text: "hot" }
          }`,
          { as: PanelField },
        ),
      });
      @field panels = containsMany(PanelField, {
        computeVia: expression(
          jq`[{ label: "a", score: 1 }, { label: "b", score: 2 }]`,
          { as: PanelField },
        ),
      });
    }

    let quote = new Quote({ subtotal: 100 });
    let panel = quote.statusPanel;
    assert.true(
      panel instanceof PanelField,
      'the serializer-identifiable class, not an anonymous object',
    );
    assert.strictEqual(panel.label, 'big');
    assert.strictEqual(panel.score, 100);
    assert.deepEqual([...panel.flags], ['checked']);
    // The nested shape is the discriminator between field-metadata
    // materialization and BXL's plain-copy fallback (which it degrades to
    // when no getFields bridge is registered): only the getFields walk
    // rebuilds nested contains values as their own field-def instances.
    assert.true(
      panel.badge instanceof BadgeField,
      'nested contains values materialize through the real getFields',
    );
    assert.strictEqual(panel.badge.text, 'hot');

    let panels = quote.panels;
    assert.strictEqual(panels.length, 2);
    assert.true(
      panels.every((entry: unknown) => entry instanceof PanelField),
      'every array element is materialized',
    );
    assert.deepEqual(
      panels.map((entry: PanelField & { label: string }) => entry.label),
      ['a', 'b'],
    );
  });

  // ===========================================================================
  // Factory metadata + memoization
  // ===========================================================================

  test('factory metadata is reachable from the field definition', async function (assert) {
    class Quote extends CardDef {
      static displayName = 'Quote';
      @field subtotal = contains(NumberField);
      @field taxRate = contains(NumberField);
      @field total = contains(NumberField, {
        computeVia: expression('.subtotal * (1 + .taxRate)'),
      });
      @field rounded = contains(NumberField, {
        computeVia: expression(fx`ROUND(Subtotal, 0)`),
      });
    }

    let fields = getFields(Quote, { includeComputeds: true }) as Record<
      string,
      { computeVia?: unknown }
    >;
    let totalMeta = (fields.total.computeVia as any).bxl;
    assert.strictEqual(totalMeta.source, '.subtotal * (1 + .taxRate)');
    assert.deepEqual(totalMeta.deps.sort(), ['subtotal', 'taxRate']);
    assert.strictEqual(totalMeta.memoize, 'microtask');

    let roundedMeta = (fields.rounded.computeVia as any).bxl;
    assert.strictEqual(roundedMeta.source, 'ROUND(Subtotal, 0)');
    assert.strictEqual(
      roundedMeta.compiledSource,
      'ROUND(.subtotal; 0)',
      'the compiled canonical jq is exposed alongside the source',
    );
  });

  test('computeVia results are memoized per card instance within a microtask', async function (assert) {
    class PanelField extends FieldDef {
      static displayName = 'Panel';
      @field label = contains(StringField);
    }
    class Quote extends CardDef {
      static displayName = 'Quote';
      @field subtotal = contains(NumberField);
      @field panel = contains(PanelField, {
        computeVia: expression(jq`{ label: "memoized" }`, { as: PanelField }),
      });
      @field freshPanel = contains(PanelField, {
        computeVia: expression(jq`{ label: "fresh" }`, {
          as: PanelField,
          memoize: false,
        }),
      });
    }

    let quote = new Quote({ subtotal: 1 });
    let fields = getFields(Quote, { includeComputeds: true }) as Record<
      string,
      { computeVia?: (this: object) => unknown }
    >;
    let computePanel = fields.panel.computeVia!;
    let computeFresh = fields.freshPanel.computeVia!;

    let first = computePanel.call(quote);
    let second = computePanel.call(quote);
    assert.strictEqual(
      first,
      second,
      'synchronous re-reads within a microtask return the cached value',
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    let third = computePanel.call(quote);
    assert.notStrictEqual(
      third,
      first,
      'the cache expires with the microtask cycle',
    );
    assert.strictEqual((third as any).label, 'memoized');

    assert.notStrictEqual(
      computeFresh.call(quote),
      computeFresh.call(quote),
      'memoize: false disables the per-instance cache',
    );
  });
});
