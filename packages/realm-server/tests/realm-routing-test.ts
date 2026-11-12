import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { rri } from '@cardstack/runtime-common';
import type {
  HostFieldMatchRoute,
  LooseSingleCardDocument,
  Realm,
} from '@cardstack/runtime-common';
import type { PgAdapter } from '@cardstack/postgres';
import { setupDB, setupPermissionedRealmCached } from './helpers/index.ts';
import {
  RealmRegistryReconciler,
  type RealmRegistryRow,
} from '../lib/realm-registry-reconciler.ts';
import {
  knownRealmURL,
  resolveRealmsForFederatedRequest,
} from '../lib/realm-routing.ts';

// CS-10054: fixture for Realm.getHostRoutingMap coverage. One rule uses
// a relative reference (the recommended form, portable across realm URL
// changes), one is cross-realm — dropped by the same-realm guard — and
// one is authored with a trailing slash, which must be normalized to its
// slash-free form so it matches request paths. The redirect rules
// cover: a realm-relative target with the default status, an external
// target with an explicit status, an invalid (non-http) target —
// dropped — and a rule carrying both a redirect and an instance, where
// the redirect wins.
function makeRoutingFixture(): Record<
  string,
  string | LooseSingleCardDocument
> {
  return {
    'white-paper.gts': `
      import { CardDef, Component } from "@cardstack/base/card-api";
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
          hostRoutingRules: [
            { path: '/rel' },
            { path: '/foreign' },
            { path: '/trailing/' },
            { path: '/tos', redirectTo: '/terms' },
            {
              path: '/blog',
              redirectTo: 'https://blog.example.com/',
              statusCode: 301,
            },
            { path: '/bad-redirect', redirectTo: 'javascript:alert(1)' },
            { path: '/ambiguous', redirectTo: '/elsewhere' },
            // Loops — dropped so they can't bounce a client until it
            // gives up: a self-redirect and a two-rule ring.
            { path: '/self', redirectTo: '/self' },
            { path: '/ring-a', redirectTo: '/ring-b' },
            { path: '/ring-b', redirectTo: '/ring-a' },
            // An unusable redirect target on a rule that also has a
            // card: the route keeps serving the card rather than going
            // down with the typo.
            { path: '/salvaged', redirectTo: 'terms' },
          ],
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
          // Authored with a trailing slash: the map must normalize the
          // path to '/trailing' so it matches slash-stripped request paths.
          'hostRoutingRules.2.instance': {
            links: { self: './white-paper' },
          },
          // Carries BOTH a redirect and an instance (only reachable by
          // hand-editing realm.json): the redirect must win.
          'hostRoutingRules.6.instance': {
            links: { self: './white-paper' },
          },
          // Also carries both, but the redirect target is malformed —
          // the rule must fall back to serving this card.
          'hostRoutingRules.10.instance': {
            links: { self: './white-paper' },
          },
        },
        meta: {
          adoptsFrom: {
            module: rri('@cardstack/base/realm-config'),
            name: 'RealmConfig',
          },
        },
      },
    },
  };
}

// Every route form a rule can take, with child routes two levels deep: a
// fixed card, a redirect, a card id template and a field match. The `where`
// filter nests `every`, `any`, `not` and `eq`, so the read must return it
// exactly as authored, arrays in order.
const POST_WHERE = {
  every: [
    { eq: { published: true } },
    { not: { eq: { title: 'Draft' } } },
    { any: [{ eq: { tag: 'news' } }, { eq: { tag: 'events' } }] },
  ],
};

function makeRouteFormsFixture(): Record<
  string,
  string | LooseSingleCardDocument
> {
  return {
    'person.gts': `
      import { CardDef, field, contains, linksTo } from "@cardstack/base/card-api";
      import StringField from "@cardstack/base/string";
      export class Person extends CardDef {
        static displayName = 'Person';
        @field slug = contains(StringField);
        @field friendOf = linksTo(() => Person);
      }
    `,
    'post.gts': `
      import { CardDef, field, contains, linksTo } from "@cardstack/base/card-api";
      import StringField from "@cardstack/base/string";
      import { Person } from "./person";
      export class Post extends CardDef {
        static displayName = 'Post';
        @field slug = contains(StringField);
        @field author = linksTo(Person);
      }
    `,
    'home.json': {
      data: {
        type: 'card',
        attributes: { cardInfo: { name: 'Home' } },
        meta: {
          adoptsFrom: {
            module: rri('@cardstack/base/card-api'),
            name: 'CardDef',
          },
        },
      },
    },
    'realm.json': {
      data: {
        type: 'card',
        attributes: {
          cardInfo: { name: 'Route Forms Realm' },
          hostRoutingRules: [
            { path: '/', name: 'home' },
            { path: '/old', redirectTo: '/', statusCode: 301 },
            {
              path: '/people/:person_id',
              name: 'person',
              card: './Person/:person_id',
            },
            {
              path: '/:person_slug',
              name: 'profile',
              type: { module: './person', name: 'Person' },
              match: { slug: ':person_slug' },
              where: POST_WHERE,
              routes: [
                {
                  path: '/friends/:friend_slug',
                  name: 'friend',
                  type: { module: './person', name: 'Person' },
                  parent: 'friendOf',
                  match: { slug: ':friend_slug' },
                  routes: [{ path: '/about', name: 'about' }],
                },
                {
                  path: '/posts/:post_slug',
                  name: 'post',
                  type: { module: './post', name: 'Post' },
                  match: { slug: ':post_slug' },
                },
                { path: '/card', name: 'profile-card' },
              ],
            },
          ],
        },
        relationships: {
          'hostRoutingRules.0.instance': { links: { self: './home' } },
          'hostRoutingRules.3.routes.0.routes.0.instance': {
            links: { self: './home' },
          },
        },
        meta: {
          adoptsFrom: {
            module: rri('@cardstack/base/realm-config'),
            name: 'RealmConfig',
          },
        },
      },
    },
  };
}

// A field-match route whose type has no cached definition: its module
// doesn't exist, so the definition cache never holds it.
function makeUnavailableTypeFixture(): Record<
  string,
  string | LooseSingleCardDocument
> {
  return {
    'home.json': {
      data: {
        type: 'card',
        attributes: { cardInfo: { name: 'Home' } },
        meta: {
          adoptsFrom: {
            module: rri('@cardstack/base/card-api'),
            name: 'CardDef',
          },
        },
      },
    },
    'realm.json': {
      data: {
        type: 'card',
        attributes: {
          cardInfo: { name: 'Unavailable Type Realm' },
          hostRoutingRules: [
            { path: '/' },
            {
              path: '/later/:slug',
              type: { module: './not-indexed', name: 'NotIndexed' },
              match: { slug: ':slug' },
            },
          ],
        },
        relationships: {
          'hostRoutingRules.0.instance': { links: { self: './home' } },
        },
        meta: {
          adoptsFrom: {
            module: rri('@cardstack/base/realm-config'),
            name: 'RealmConfig',
          },
        },
      },
    },
  };
}

// Field-match routes over types whose definitions the index caches: a
// venue linking to a type its parent route's type descends from, and a
// route naming an export its module doesn't have.
function makeCachedTypesFixture(): Record<
  string,
  string | LooseSingleCardDocument
> {
  return {
    'places.gts': `
      import { CardDef, field, contains, linksTo } from "@cardstack/base/card-api";
      import StringField from "@cardstack/base/string";
      export class Place extends CardDef {
        static displayName = 'Place';
        @field slug = contains(StringField);
      }
      export class City extends Place {
        static displayName = 'City';
      }
      export class Venue extends CardDef {
        static displayName = 'Venue';
        @field slug = contains(StringField);
        @field place = linksTo(Place);
      }
    `,
    'realm.json': {
      data: {
        type: 'card',
        attributes: {
          cardInfo: { name: 'Cached Types Realm' },
          hostRoutingRules: [
            {
              path: '/cities/:city',
              type: { module: './places', name: 'City' },
              match: { slug: ':city' },
              routes: [
                {
                  path: '/:venue',
                  type: { module: './places', name: 'Venue' },
                  match: { slug: ':venue' },
                },
              ],
            },
            {
              path: '/nope/:slug',
              type: { module: './places', name: 'Nope' },
              match: { slug: ':slug' },
            },
          ],
        },
        meta: {
          adoptsFrom: {
            module: rri('@cardstack/base/realm-config'),
            name: 'RealmConfig',
          },
        },
      },
    },
  };
}

module(basename(import.meta.filename), function () {
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

    test('resolves relative references, drops cross-realm rules, and normalizes trailing slashes', async function (assert) {
      let map = await testRealm.getHostRoutingMap();

      assert.deepEqual(
        map,
        [
          { path: '/rel', id: `${realmURL.href}white-paper` },
          { path: '/trailing', id: `${realmURL.href}white-paper` },
          { path: '/tos', redirectTo: '/terms', statusCode: 302 },
          {
            path: '/blog',
            redirectTo: 'https://blog.example.com/',
            statusCode: 301,
          },
          { path: '/ambiguous', redirectTo: '/elsewhere', statusCode: 302 },
          { path: '/salvaged', id: `${realmURL.href}white-paper` },
        ],
        'relative reference resolved against the realm root; cross-realm rule filtered; trailing-slash rule normalized to /trailing; redirect rules surface with their (default) status; the invalid javascript: target is dropped; a rule with both targets resolves as a redirect; self-redirect and ring rules dropped; a rule whose redirect target is malformed falls back to its card',
      );
    });

    test('an unusable redirect target falls back to the rule’s card instead of dropping the route', async function (assert) {
      let map = await testRealm.getHostRoutingMap();

      assert.deepEqual(
        map.find((rule) => rule.path === '/salvaged'),
        { path: '/salvaged', id: `${realmURL.href}white-paper` },
        'the route still serves its card despite the malformed redirect target',
      );
      assert.strictEqual(
        map.find((rule) => rule.path === '/bad-redirect'),
        undefined,
        'with no card to fall back to, the rule is dropped',
      );
    });

    test('drops redirect rules that loop, keeping the rest of the map', async function (assert) {
      let map = await testRealm.getHostRoutingMap();
      let paths = map.map((rule) => rule.path);

      assert.false(paths.includes('/self'), 'the self-redirect is dropped');
      assert.false(
        paths.includes('/ring-a'),
        'the first half of the two-rule ring is dropped',
      );
      assert.false(
        paths.includes('/ring-b'),
        'the second half of the two-rule ring is dropped',
      );
      assert.true(
        paths.includes('/tos'),
        'a terminating redirect rule is unaffected',
      );
    });

    test('caches the computed map and drops it on index-cache clear', async function (assert) {
      let first = await testRealm.getHostRoutingMap();
      let second = await testRealm.getHostRoutingMap();
      assert.strictEqual(
        first,
        second,
        'a cache hit returns the same array reference without re-querying the index',
      );

      testRealm.clearRealmIndexCaches();

      let third = await testRealm.getHostRoutingMap();
      assert.notStrictEqual(
        third,
        first,
        'clearRealmIndexCaches drops the cache so the next call recomputes',
      );
      assert.deepEqual(
        third,
        first,
        'recomputed map matches the previously cached value',
      );
    });
  });

  module('Realm.getHostRoutes', function (hooks) {
    let realmURL = new URL('http://127.0.0.1:4444/routing-forms/');
    let testRealm: Realm;

    setupPermissionedRealmCached(hooks, {
      realmURL,
      permissions: { '*': ['read'] },
      fileSystem: makeRouteFormsFixture(),
      onRealmSetup({ testRealm: realm }) {
        testRealm = realm;
      },
    });

    hooks.beforeEach(async function () {
      await testRealm.indexing();
    });

    test('validates every route form and its child routes from the search document', async function (assert) {
      let { routes, warnings } = await testRealm.getHostRoutes();
      let personType = { module: `${realmURL.href}person`, name: 'Person' };

      assert.deepEqual(
        routes.map((route) => [route.kind, route.fullPath, route.name]),
        [
          ['fixed-card', '/', 'home'],
          ['redirect', '/old', undefined],
          ['card-id', '/people/:person_id', 'person'],
          ['field-match', '/:person_slug', 'profile'],
        ],
      );
      let [home, , person, profileRoute] = routes;
      let profile = profileRoute as HostFieldMatchRoute;
      assert.strictEqual(
        home?.kind === 'fixed-card' ? home.cardHref : undefined,
        `${realmURL.href}home`,
      );
      assert.deepEqual(
        person?.kind === 'card-id' ? person.card.paramNames : undefined,
        ['person_id'],
      );
      assert.deepEqual(profile.type, personType);
      assert.deepEqual(profile.where, POST_WHERE, 'where is kept as authored');
      assert.deepEqual(profile.match, [
        { field: 'slug', param: 'person_slug' },
      ]);

      let [friend, post] = profile.routes;
      assert.strictEqual(
        friend?.fullPath,
        '/:person_slug/friends/:friend_slug',
      );
      assert.deepEqual(
        friend?.kind === 'field-match' ? friend.parentLink : undefined,
        { field: 'friendOf', side: 'child', kind: 'linksTo', inferred: false },
        'the named parent link is checked against the indexed definition',
      );
      assert.deepEqual(
        post?.kind === 'field-match' ? post.parentLink : undefined,
        { field: 'author', side: 'child', kind: 'linksTo', inferred: true },
        'the parent link is inferred from the indexed definitions',
      );
      assert.deepEqual(
        warnings.map((w) => [w.code, w.path, w.dropped]),
        [
          [
            'fixed-route-with-params',
            '/:person_slug/friends/:friend_slug/about',
            true,
          ],
          ['missing-form', '/:person_slug/card', true],
        ],
        'a fixed route under a dynamic route is dropped, and so is a route with no form',
      );
    });

    test('caches the validated routes until the index caches clear', async function (assert) {
      let first = await testRealm.getHostRoutes();
      assert.strictEqual(await testRealm.getHostRoutes(), first);
      testRealm.clearRealmIndexCaches();
      let second = await testRealm.getHostRoutes();
      assert.notStrictEqual(second, first);
      assert.deepEqual(second, first);
    });

    test('the routing map still serves the fixed card and redirect rules', async function (assert) {
      let map = await testRealm.getHostRoutingMap();

      assert.deepEqual(map, [
        { path: '/', id: `${realmURL.href}home` },
        { path: '/old', redirectTo: '/', statusCode: 301 },
      ]);
    });
  });

  module(
    'Realm.getHostRoutes with a type that has no cached definition',
    function (hooks) {
      let realmURL = new URL('http://127.0.0.1:4444/routing-unavailable/');
      let testRealm: Realm;

      setupPermissionedRealmCached(hooks, {
        realmURL,
        permissions: { '*': ['read'] },
        fileSystem: makeUnavailableTypeFixture(),
        onRealmSetup({ testRealm: realm }) {
          testRealm = realm;
        },
      });

      hooks.beforeEach(async function () {
        await testRealm.indexing();
      });

      test('drops the route for now and does not cache the validation', async function (assert) {
        let first = await testRealm.getHostRoutes();
        assert.false(first.complete, 'the validation is incomplete');
        assert.deepEqual(
          first.warnings.map((w) => [w.code, w.path, w.dropped]),
          [['type-unavailable', '/later/:slug', true]],
        );
        let second = await testRealm.getHostRoutes();
        assert.notStrictEqual(second, first, 'the next call validates again');

        let map = await testRealm.getHostRoutingMap();
        assert.deepEqual(map, [{ path: '/', id: `${realmURL.href}home` }]);
        assert.notStrictEqual(
          await testRealm.getHostRoutingMap(),
          map,
          'the map built from it is not cached either',
        );
      });
    },
  );

  module('Realm.getHostRoutes with cached type definitions', function (hooks) {
    let realmURL = new URL('http://127.0.0.1:4444/routing-cached-types/');
    let testRealm: Realm;

    setupPermissionedRealmCached(hooks, {
      realmURL,
      permissions: { '*': ['read'] },
      fileSystem: makeCachedTypesFixture(),
      onRealmSetup({ testRealm: realm }) {
        testRealm = realm;
      },
    });

    hooks.beforeEach(async function () {
      await testRealm.indexing();
    });

    test('infers a parent link to a type the parent descends from', async function (assert) {
      let { routes } = await testRealm.getHostRoutes();
      let venue = routes[0]?.routes[0];
      assert.strictEqual(venue?.fullPath, '/cities/:city/:venue');
      assert.deepEqual(
        venue?.kind === 'field-match' ? venue.parentLink : undefined,
        { field: 'place', side: 'child', kind: 'linksTo', inferred: true },
      );
    });

    test('drops a route whose cached module has no such export, and caches the validation', async function (assert) {
      let first = await testRealm.getHostRoutes();
      assert.true(first.complete, 'the validation is final');
      assert.deepEqual(
        first.warnings.map((w) => [w.code, w.path, w.dropped]),
        [['not-card-type', '/nope/:slug', true]],
      );
      assert.strictEqual(
        await testRealm.getHostRoutes(),
        first,
        'the next call answers from the cache',
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
    // index.json. The Workspace index card in index.json fires
    // _federated-search against the new realm. If
    // resolveRealmsForFederatedRequest were
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
        resolveRealmsForFederatedRequest(fixture.reconciler, [fixture.row.url]),
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

  module('knownRealmURL', function () {
    // Only what the resolver reads: the reconciler's mounted realms and its
    // known registry rows.
    function deps(mounted: string[], known: string[]) {
      return {
        reconciler: {
          mounted: new Map(mounted.map((url) => [url, {}])),
          knownByUrl: new Map(known.map((url) => [url, {}])),
        } as unknown as RealmRegistryReconciler,
      };
    }

    test('resolves a request to the most specific realm that contains it, mounted or only known', function (assert) {
      let d = deps(
        ['https://realms.example.test/'],
        [
          'https://realms.example.test/buck/site/',
          'https://site.example.test/',
        ],
      );
      assert.strictEqual(
        knownRealmURL(
          new URL('https://realms.example.test/buck/site/Person/1.json'),
          d,
        ),
        'https://realms.example.test/buck/site/',
        'the nested realm, not the root realm around it',
      );
      assert.strictEqual(
        knownRealmURL(new URL('https://realms.example.test/other/x'), d),
        'https://realms.example.test/',
      );
      assert.strictEqual(
        knownRealmURL(new URL('https://site.example.test/'), d),
        'https://site.example.test/',
        'a published site’s page load',
      );
    });

    test('matches whatever protocol the request arrived under, and the realm root without its slash', function (assert) {
      let d = deps([], ['https://site.example.test/buck/realm/']);
      assert.strictEqual(
        knownRealmURL(new URL('http://site.example.test/buck/realm/index'), d),
        'https://site.example.test/buck/realm/',
      );
      assert.strictEqual(
        knownRealmURL(new URL('https://site.example.test/buck/realm'), d),
        'https://site.example.test/buck/realm/',
      );
    });

    test('a registry key that is not a URL does not stop a later realm from matching', function (assert) {
      let d = deps(
        ['@cardstack/base/'],
        ['@cardstack/catalog/', 'https://site.example.test/'],
      );
      assert.strictEqual(
        knownRealmURL(new URL('https://site.example.test/index'), d),
        'https://site.example.test/',
      );
    });

    test('a request no known realm contains resolves to nothing', function (assert) {
      let d = deps(
        ['https://realms.example.test/base/'],
        ['https://site.example.test/'],
      );
      assert.strictEqual(
        knownRealmURL(
          new URL('https://realms.example.test/_server-session'),
          d,
        ),
        undefined,
      );
      assert.strictEqual(
        knownRealmURL(new URL('https://elsewhere.example.test/'), d),
        undefined,
      );
    });
  });
});
