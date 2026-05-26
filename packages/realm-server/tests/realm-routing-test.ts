import { module, test } from 'qunit';
import { basename } from 'path';
import { rri } from '@cardstack/runtime-common';
import type { LooseSingleCardDocument, Realm } from '@cardstack/runtime-common';
import type { PgAdapter } from '@cardstack/postgres';
import { setupDB, setupPermissionedRealmCached } from './helpers';
import {
  RealmRegistryReconciler,
  type RealmRegistryRow,
} from '../lib/realm-registry-reconciler';
import { resolveRealmsForFederatedRequest } from '../lib/realm-routing';

// CS-10054: fixture for Realm.getHostRoutingMap coverage. One rule uses
// a relative reference (the recommended form, portable across realm URL
// changes) and one is cross-realm — the latter must be dropped by the
// same-realm guard.
function makeRoutingFixture(): Record<
  string,
  string | LooseSingleCardDocument
> {
  return {
    'white-paper.gts': `
      import { CardDef, Component } from "https://cardstack.com/base/card-api";
      export class WhitePaper extends CardDef {
        static displayName = 'White Paper';
        static isolated = class Isolated extends Component<typeof this> {
          <template>
            <article data-test-white-paper>White paper content</article>
          </template>
        }
      }
    `,
    'white-paper.json': {
      data: {
        type: 'card',
        attributes: {},
        meta: {
          adoptsFrom: { module: rri('./white-paper'), name: 'WhitePaper' },
        },
      },
    },
    'realm.json': {
      data: {
        type: 'card',
        attributes: {
          cardInfo: { name: 'Routing Test Realm' },
          // `instance` is a linksTo on RoutingRuleField, so the link
          // target lives in `relationships` keyed by the field path
          // (`hostRoutingRules.<i>.instance`), not inline in attributes.
          hostRoutingRules: [{ path: '/rel' }, { path: '/foreign' }],
        },
        relationships: {
          'hostRoutingRules.0.instance': {
            links: { self: './white-paper' },
          },
          // Cross-realm: must be filtered out by the same-realm
          // guard. The project spec restricts routing rules to cards
          // within the same realm; this verifies the read path
          // enforces that even when the UI guard is bypassed by
          // hand-editing realm.json.
          'hostRoutingRules.1.instance': {
            links: { self: 'http://otherrealm.test/x' },
          },
        },
        meta: {
          adoptsFrom: {
            module: rri('https://cardstack.com/base/realm-config'),
            name: 'RealmConfig',
          },
        },
      },
    },
  };
}

module(basename(__filename), function () {
  module('Realm.getHostRoutingMap', function (hooks) {
    let realmURL = new URL('http://127.0.0.1:4444/routing-unit/');
    let testRealm: Realm;

    setupPermissionedRealmCached(hooks, {
      realmURL,
      permissions: { '*': ['read'] },
      fileSystem: makeRoutingFixture(),
      onRealmSetup({ testRealm: realm }) {
        testRealm = realm;
      },
    });

    hooks.beforeEach(async function () {
      await testRealm.indexing();
    });

    test('resolves relative references and drops cross-realm rules', async function (assert) {
      let map = await testRealm.getHostRoutingMap();

      assert.deepEqual(
        map,
        [{ path: '/rel', id: `${realmURL.href}white-paper` }],
        'relative reference resolved against the realm root; cross-realm rule filtered',
      );
    });
  });

  module('resolveRealmsForFederatedRequest', function (hooks) {
    let dbAdapter: PgAdapter;
    setupDB(hooks, {
      beforeEach: async (adapter) => {
        dbAdapter = adapter;
      },
    });

    // Shared fixture: a reconciler whose mounts await a manually-
    // controlled `startPromise`. The test seeds an in-flight mount
    // by calling `ensureMounted(row)` and not awaiting; the fixture
    // exposes both maps + a resolveStart() hook so cleanup can let
    // start() settle before afterEach tears the DB adapter down.
    function makeInFlightMountFixture() {
      let resolveStart: (() => void) | undefined;
      const startPromise = new Promise<void>((r) => {
        resolveStart = r;
      });
      const slowStartingRealm = (url: string): Realm =>
        ({
          url,
          start: async () => {
            await startPromise;
          },
          unsubscribe() {},
          handle: null,
        }) as unknown as Realm;
      const reconciler = new RealmRegistryReconciler({
        dbAdapter,
        prepareRealmFromRow: (row) => slowStartingRealm(row.url),
        unmount: async () => {},
      });
      const row: RealmRegistryRow = {
        id: 'cs-11259-fixture',
        url: 'http://localhost:4444/cs-11259-deadlock/',
        kind: 'source',
        disk_id: 'cs-11259-deadlock',
        owner_username: 'cs-11259-fixture',
        source_url: null,
        last_published_at: null,
        pinned: false,
      };
      const mountPromise = reconciler.ensureMounted(row);
      return {
        reconciler,
        row,
        mountPromise,
        async settle() {
          resolveStart!();
          await mountPromise;
        },
      };
    }

    // CS-11259 regression guard, self-mount path.
    //
    // /_create-realm calls reconciler.ensureMounted() for the new
    // realm. ensureMounted publishes the Realm into reconciler.mounted
    // synchronously and then awaits realm.start(). For a brand-new
    // realm, start() awaits the first full index, which prerenders
    // index.json. The CardsGrid in index.json fires _federated-search
    // against the new realm. If resolveRealmsForFederatedRequest were
    // to re-enter lookupOrMount() for the same URL, it would find the
    // URL in pendingMounts and await the very start() it is nested
    // inside — deadlocking until the prerender's 90s render timeout
    // breaks the cycle.
    //
    // The self-mount fast-path takes a tightly scoped exception:
    // when the request carries `x-boxel-consuming-realm === url`
    // (the federated-search originated from a prerender for THIS
    // realm) AND the URL is already published into
    // `reconciler.mounted`, the resolver returns that Realm
    // directly without awaiting start(). Searches against the
    // mid-index `boxel_index` return empty for a brand-new realm,
    // which is the correct answer for the cards-grid query that
    // triggered this chain.
    test('self-mount: consumingRealm === url returns the published Realm without awaiting start()', async function (assert) {
      const fixture = makeInFlightMountFixture();

      assert.true(
        fixture.reconciler.pendingMounts.has(fixture.row.url),
        'mount is in-flight (pendingMounts has the URL)',
      );
      assert.true(
        fixture.reconciler.mounted.has(fixture.row.url),
        'mounted has the URL (published synchronously before start())',
      );

      // If the fix is broken (e.g. the fast-path doesn't honor
      // `consumingRealm`), this call awaits the in-flight start() —
      // which never resolves in this test — and the race below
      // surfaces the regression as a timeout. A 250ms budget is
      // orders of magnitude shorter than the 90s production
      // deadlock and still generous enough to avoid CI-environment
      // flake.
      const result = await Promise.race([
        resolveRealmsForFederatedRequest(
          fixture.reconciler,
          [fixture.row.url],
          { consumingRealm: fixture.row.url },
        ),
        new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 250)),
      ]);

      assert.notStrictEqual(
        result,
        'timeout',
        'fast-path fired: resolver did not self-await in-flight start()',
      );
      if (result !== 'timeout') {
        assert.strictEqual(result.length, 1, 'one realm in result');
        assert.strictEqual(
          result[0]?.url,
          fixture.row.url,
          'returned the published Realm (mounted fast-path)',
        );
      }

      await fixture.settle();
    });

    // Scoping guard for the codex review concern on PR #4947: the
    // fast-path must NOT fire for callers that lack a matching
    // consumingRealm. A normal multi-replica federated-search
    // hitting a realm whose mount is in flight (rare race window
    // between `ensureMounted` publishing into `mounted` and
    // `start()` resolving) must still wait on start() to preserve
    // read-after-mount consistency.
    test('non-self-mount: omitted consumingRealm makes resolver await in-flight start()', async function (assert) {
      const fixture = makeInFlightMountFixture();

      // No `consumingRealm` opt → fast-path predicate fails → resolver
      // routes through lookupOrMount → awaits pendingMounts. The
      // start() never resolves in this test, so the race below
      // returns the timeout sentinel — that's the expected/passing
      // outcome here.
      const result = await Promise.race([
        resolveRealmsForFederatedRequest(fixture.reconciler, [
          fixture.row.url,
        ]),
        new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 250)),
      ]);

      assert.strictEqual(
        result,
        'timeout',
        'no consumingRealm: resolver awaited in-flight start() (did not return early via the fast-path)',
      );

      await fixture.settle();
    });

    // Cross-realm scoping: a federated-search fired from inside a
    // prerender for realm A that also queries realm B should only
    // fast-path realm A. Realm B is a normal lookup and must still
    // await its own start() if mid-mount.
    test('cross-realm: consumingRealm only fast-paths the matching URL', async function (assert) {
      const fixture = makeInFlightMountFixture();
      const otherUrl = 'http://localhost:4444/cs-11259-other/';
      const otherRow: RealmRegistryRow = {
        ...fixture.row,
        id: 'cs-11259-other',
        url: otherUrl,
        disk_id: 'cs-11259-other',
      };
      // Seed a second in-flight mount via the same reconciler.
      const otherMountPromise = fixture.reconciler.ensureMounted(otherRow);

      // Pass the FIRST realm as consumingRealm; the SECOND must
      // route through lookupOrMount → await the in-flight start().
      const result = await Promise.race([
        resolveRealmsForFederatedRequest(
          fixture.reconciler,
          [fixture.row.url, otherUrl],
          { consumingRealm: fixture.row.url },
        ),
        new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 250)),
      ]);

      assert.strictEqual(
        result,
        'timeout',
        'cross-realm slot still awaited start(): only the consumingRealm match takes the fast-path',
      );

      await fixture.settle();
      await otherMountPromise;
    });
  });
});
