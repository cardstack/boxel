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
import type { CachingDefinitionLookup } from '@cardstack/runtime-common';
import { RealmIndexQueryEngine } from '@cardstack/runtime-common/realm-index-query-engine';
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

// Field-match routes whose types have no usable cached definition: one
// module doesn't exist, so the definition cache never holds it, and one
// fails when it runs, so the cache holds an error row for it.
function makeUnavailableTypeFixture(): Record<
  string,
  string | LooseSingleCardDocument
> {
  return {
    'broken.gts': `
      import { CardDef } from "@cardstack/base/card-api";
      throw new Error('this module fails on purpose');
      export class Broken extends CardDef {}
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
          cardInfo: { name: 'Unavailable Type Realm' },
          hostRoutingRules: [
            { path: '/' },
            {
              path: '/later/:slug',
              type: { module: './not-indexed', name: 'NotIndexed' },
              match: { slug: ':slug' },
            },
            {
              path: '/broken/:slug',
              type: { module: './broken', name: 'Broken' },
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

// A field-match route over a type from another realm, the base realm's
// CardDef, whose definition this realm's indexing reads through home.json.
function makeOtherRealmTypeFixture(): Record<
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
          cardInfo: { name: 'Other Realm Type Realm' },
          hostRoutingRules: [
            {
              path: '/cards/:name',
              type: { module: '@cardstack/base/card-api', name: 'CardDef' },
              match: { 'cardInfo.name': ':name' },
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

// Field-match routes whose cards share values: posts with the same slug,
// one of them failing the route's `where`, and cards nested in a parent,
// where a slug only has to be unique within its parent. A product links to
// its category; a shelf links to its items.
function makeDuplicatesFixture(): Record<
  string,
  string | LooseSingleCardDocument
> {
  let card = (
    name: string,
    attributes: Record<string, unknown>,
    relationships?: Record<string, { links: { self: string } }>,
  ): LooseSingleCardDocument => ({
    data: {
      type: 'card',
      attributes,
      ...(relationships ? { relationships } : {}),
      meta: { adoptsFrom: { module: rri('./shop'), name } },
    },
  });
  return {
    'shop.gts': `
      import { CardDef, field, contains, linksTo, linksToMany } from "@cardstack/base/card-api";
      import StringField from "@cardstack/base/string";
      export class Post extends CardDef {
        static displayName = 'Post';
        @field slug = contains(StringField);
        @field status = contains(StringField);
      }
      export class Category extends CardDef {
        static displayName = 'Category';
        @field slug = contains(StringField);
      }
      export class Product extends CardDef {
        static displayName = 'Product';
        @field slug = contains(StringField);
        @field category = linksTo(Category);
      }
      export class Item extends CardDef {
        static displayName = 'Item';
        @field slug = contains(StringField);
      }
      export class Shelf extends CardDef {
        static displayName = 'Shelf';
        @field slug = contains(StringField);
        @field items = linksToMany(Item);
      }
    `,
    'post-a.json': card('Post', { slug: 'hello', status: 'published' }),
    'post-b.json': card('Post', { slug: 'hello', status: 'published' }),
    'post-c.json': card('Post', { slug: 'hello', status: 'draft' }),
    'post-d.json': card('Post', { slug: 'draft-twin', status: 'published' }),
    'post-e.json': card('Post', { slug: 'draft-twin', status: 'draft' }),
    'post-f.json': card('Post', { slug: 'unique', status: 'published' }),
    'shoes.json': card('Category', { slug: 'shoes' }),
    'hats.json': card('Category', { slug: 'hats' }),
    'shoe-classic.json': card(
      'Product',
      { slug: 'classic' },
      { category: { links: { self: './shoes' } } },
    ),
    'hat-classic.json': card(
      'Product',
      { slug: 'classic' },
      { category: { links: { self: './hats' } } },
    ),
    'trail-1.json': card(
      'Product',
      { slug: 'trail' },
      { category: { links: { self: './shoes' } } },
    ),
    'trail-2.json': card(
      'Product',
      { slug: 'trail' },
      { category: { links: { self: './shoes' } } },
    ),
    'lamp-1.json': card('Item', { slug: 'lamp' }),
    'lamp-2.json': card('Item', { slug: 'lamp' }),
    'cup-1.json': card('Item', { slug: 'cup' }),
    'cup-2.json': card('Item', { slug: 'cup' }),
    'shelf-a.json': card(
      'Shelf',
      { slug: 'a' },
      {
        'items.0': { links: { self: './lamp-1' } },
        'items.1': { links: { self: './lamp-2' } },
        'items.2': { links: { self: './cup-1' } },
      },
    ),
    'shelf-b.json': card(
      'Shelf',
      { slug: 'b' },
      { 'items.0': { links: { self: './cup-2' } } },
    ),
    'realm.json': {
      data: {
        type: 'card',
        attributes: {
          cardInfo: { name: 'Duplicates Realm' },
          hostRoutingRules: [
            {
              path: '/posts/:slug',
              type: { module: './shop', name: 'Post' },
              where: { eq: { status: 'published' } },
              match: { slug: ':slug' },
            },
            {
              path: '/c/:category',
              type: { module: './shop', name: 'Category' },
              match: { slug: ':category' },
              routes: [
                {
                  path: '/:product',
                  type: { module: './shop', name: 'Product' },
                  match: { slug: ':product' },
                },
              ],
            },
            {
              path: '/s/:shelf',
              type: { module: './shop', name: 'Shelf' },
              match: { slug: ':shelf' },
              routes: [
                {
                  path: '/:item',
                  type: { module: './shop', name: 'Item' },
                  match: { slug: ':item' },
                },
              ],
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

// A field-match route under a card id template, whose `parent` names a
// field the child's type doesn't have: the link is on the parent's card,
// whose type the route doesn't say.
function makeUnknownParentSideFixture(): Record<
  string,
  string | LooseSingleCardDocument
> {
  let thing = (slug: string): LooseSingleCardDocument => ({
    data: {
      type: 'card',
      attributes: { slug },
      meta: { adoptsFrom: { module: rri('./things'), name: 'Thing' } },
    },
  });
  return {
    'things.gts': `
      import { CardDef, field, contains } from "@cardstack/base/card-api";
      import StringField from "@cardstack/base/string";
      export class Thing extends CardDef {
        static displayName = 'Thing';
        @field slug = contains(StringField);
      }
    `,
    'thing-1.json': thing('same'),
    'thing-2.json': thing('same'),
    'realm.json': {
      data: {
        type: 'card',
        attributes: {
          cardInfo: { name: 'Unknown Parent Side Realm' },
          hostRoutingRules: [
            {
              path: '/groups/:group',
              card: './Group/:group',
              routes: [
                {
                  path: '/:thing',
                  type: { module: './things', name: 'Thing' },
                  parent: 'things',
                  match: { slug: ':thing' },
                },
              ],
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

// The definition lookup the test realm server and its realm read through.
// The server keeps it private; tests need it to fill the definition cache and
// to record a definition change.
function serverDefinitionLookup(testRealmServer: {
  testRealmServer: unknown;
}): CachingDefinitionLookup {
  return (
    testRealmServer.testRealmServer as {
      definitionLookup: CachingDefinitionLookup;
    }
  ).definitionLookup;
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
      let dbAdapter: PgAdapter;
      let definitionLookup: CachingDefinitionLookup;

      setupPermissionedRealmCached(hooks, {
        realmURL,
        permissions: { '*': ['read'] },
        fileSystem: makeUnavailableTypeFixture(),
        onRealmSetup({
          testRealm: realm,
          dbAdapter: adapter,
          testRealmServer,
        }) {
          testRealm = realm;
          dbAdapter = adapter;
          definitionLookup = serverDefinitionLookup(testRealmServer);
        },
      });

      hooks.beforeEach(async function () {
        await testRealm.indexing();
      });

      test('drops the route for now, and keeps the validation until a type may be available', async function (assert) {
        let first = await testRealm.getHostRoutes();
        assert.false(first.complete, 'the validation is incomplete');
        assert.deepEqual(
          first.warnings.map((w) => [w.code, w.path, w.dropped]),
          [
            ['type-unavailable', '/later/:slug', true],
            ['type-unavailable', '/broken/:slug', true],
          ],
        );
        assert.strictEqual(
          await testRealm.getHostRoutes(),
          first,
          'the next call answers from the cache',
        );
        let map = await testRealm.getHostRoutingMap();
        assert.deepEqual(map, [{ path: '/', id: `${realmURL.href}home` }]);
        assert.strictEqual(
          await testRealm.getHostRoutingMap(),
          map,
          'the fixed routing map is cached with it',
        );

        // Neither type can be read: one module doesn't exist and the other
        // fails to render. A failed background read leaves the cache as it is.
        await testRealm.__testOnlyHostRouteTypeWarmups();
        assert.strictEqual(await testRealm.getHostRoutes(), first);

        // Once the retry time passes, the routes and their types are read again.
        testRealm.__testOnlyRetryHostRoutesNow();
        let retried = await testRealm.getHostRoutes();
        assert.notStrictEqual(retried, first, 'the routes are read again');
        assert.false(retried.complete);
        await testRealm.__testOnlyHostRouteTypeWarmups();
      });

      test('a module whose cached render failed is not final', async function (assert) {
        // Read the type the way a request may not: rendering the module,
        // which fails and leaves an error row in the definition cache.
        let ref = {
          module: rri(`${realmURL.href}broken`),
          name: 'Broken',
        };
        let scoped = definitionLookup.forRealm(testRealm);
        try {
          await scoped.lookupDefinition(ref);
          assert.ok(false, 'the module was expected to fail');
        } catch {
          assert.ok(true, 'the module fails to render');
        }
        assert.deepEqual(
          await scoped.lookupCachedDefinitionEntry(ref),
          { status: 'module-error' },
          'the cache-only read reports the failed render',
        );
        let rows = (await dbAdapter.execute(
          `SELECT error_doc IS NOT NULL AS has_error FROM modules WHERE url = ANY($1) OR file_alias = ANY($1)`,
          { bind: [[`${realmURL.href}broken`, `${realmURL.href}broken.gts`]] },
        )) as { has_error: boolean }[];
        assert.ok(rows.length > 0, 'the definition cache holds the module');
        assert.true(
          rows.every((row) => row.has_error),
          'its row is an error row',
        );
        let { complete, warnings } = await testRealm.getHostRoutes();
        assert.false(
          complete,
          'an error row does not make the validation final',
        );
        assert.deepEqual(
          warnings
            .filter((w) => w.path === '/broken/:slug')
            .map((w) => [w.code, w.dropped]),
          [['type-unavailable', true]],
          'the route is dropped for now, not as a missing export',
        );
        await testRealm.__testOnlyHostRouteTypeWarmups();
      });
    },
  );

  module('Realm.getHostRoutes with cached type definitions', function (hooks) {
    let realmURL = new URL('http://127.0.0.1:4444/routing-cached-types/');
    let testRealm: Realm;
    let dbAdapter: PgAdapter;
    let definitionLookup: CachingDefinitionLookup;

    setupPermissionedRealmCached(hooks, {
      realmURL,
      permissions: { '*': ['read'] },
      fileSystem: makeCachedTypesFixture(),
      onRealmSetup({ testRealm: realm, testRealmServer, dbAdapter: adapter }) {
        testRealm = realm;
        dbAdapter = adapter;
        definitionLookup = serverDefinitionLookup(testRealmServer);
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

    test('concurrent calls share one validation', async function (assert) {
      let [a, b] = await Promise.all([
        testRealm.getHostRoutes(),
        testRealm.getHostRoutes(),
      ]);
      assert.strictEqual(a, b);
    });

    test('a validation that an index overtakes is not cached', async function (assert) {
      let inFlight = testRealm.getHostRoutes();
      // What an index does when it lands while the rules are being read.
      testRealm.clearRealmIndexCaches();
      let overtaken = await inFlight;
      assert.true(overtaken.complete);
      let next = await testRealm.getHostRoutes();
      assert.notStrictEqual(next, overtaken, 'the next call validates again');
      assert.strictEqual(
        await testRealm.getHostRoutes(),
        next,
        'and caches its own result',
      );
    });

    test('a cached definition is found when its row also has an error', async function (assert) {
      // A row can hold the module's definitions and an error_doc together.
      let rows = (await dbAdapter.execute(
        `UPDATE modules
            SET error_doc = $1::jsonb
          WHERE url LIKE $2
         RETURNING url`,
        {
          bind: [
            JSON.stringify({
              type: 'module-error',
              error: {
                message: 'a dependency failed',
                status: 500,
                additionalErrors: null,
              },
            }),
            `${realmURL.href}places%`,
          ],
        },
      )) as { url: string }[];
      assert.ok(rows.length > 0, 'the definitions cache holds the module');
      let ref = { module: rri(`${realmURL.href}places`), name: 'City' };
      let scoped = definitionLookup.forRealm(testRealm);
      let definition = await scoped.lookupCachedDefinition(ref);
      assert.strictEqual(
        definition?.type,
        'card-def',
        'lookupCachedDefinition answers with the definition',
      );
      let entry = await scoped.lookupCachedDefinitionEntry(ref);
      assert.strictEqual(entry.status, 'found');
      let missing = await scoped.lookupCachedDefinitionEntry({
        module: rri(`${realmURL.href}places`),
        name: 'Nope',
      });
      assert.strictEqual(
        missing.status,
        'module-error',
        'the error may explain an export the row lacks',
      );
      testRealm.clearRealmIndexCaches();
      let { routes, warnings } = await testRealm.getHostRoutes();
      assert.ok(
        routes.some((route) => route.fullPath === '/cities/:city'),
        'the route uses the definition',
      );
      assert.deepEqual(
        warnings.map((w) => [w.code, w.path, w.dropped]),
        [['type-unavailable', '/nope/:slug', true]],
        'the missing export is dropped for now, not as final',
      );
      await testRealm.__testOnlyHostRouteTypeWarmups();
    });

    test('a type whose cached render failed is rendered again in the background', async function (assert) {
      // A failed render of the module, as the definitions cache holds it
      // (no definitions), old enough that its error row has expired.
      let rows = (await dbAdapter.execute(
        `UPDATE modules
            SET error_doc = $1::jsonb, created_at = $2::bigint,
                definitions = '{}'::jsonb
          WHERE url LIKE $3
         RETURNING url`,
        {
          bind: [
            JSON.stringify({
              type: 'module-error',
              error: {
                message: 'the render failed',
                status: 500,
                additionalErrors: null,
              },
            }),
            String(Date.now() - 10 * 60 * 1000),
            `${realmURL.href}places%`,
          ],
        },
      )) as { url: string }[];
      assert.ok(rows.length > 0, 'the definitions cache holds the module');

      let first = await testRealm.getHostRoutes();
      assert.false(first.complete, 'the failed render is not final');
      assert.ok(
        first.warnings.some(
          (w) => w.code === 'type-unavailable' && w.path === '/cities/:city',
        ),
        'the route is dropped for now',
      );

      await testRealm.__testOnlyHostRouteTypeWarmups();

      let second = await testRealm.getHostRoutes();
      assert.true(second.complete, 'the module rendered again');
      assert.deepEqual(
        second.routes.map((route) => route.fullPath),
        ['/cities/:city'],
      );
    });

    test('reads a type that is not cached into the cache in the background', async function (assert) {
      // The server clears the definitions cache when it starts, and a realm
      // that boots on its existing index doesn't render its modules again.
      await definitionLookup.clearRealmDefinitions(realmURL.href);

      let first = await testRealm.getHostRoutes();
      assert.false(first.complete, 'the types are not cached yet');
      let unavailable = first.warnings
        .filter((w) => w.code === 'type-unavailable')
        .map((w) => w.path);
      assert.ok(
        unavailable.includes('/cities/:city'),
        'the route is dropped for now',
      );
      assert.ok(
        unavailable.includes('/nope/:slug'),
        'the route with the missing export is dropped for now',
      );

      await testRealm.__testOnlyHostRouteTypeWarmups();

      let second = await testRealm.getHostRoutes();
      assert.true(second.complete, 'the types are cached now');
      assert.deepEqual(
        second.warnings.map((w) => [w.code, w.path, w.dropped]),
        [['not-card-type', '/nope/:slug', true]],
      );
      assert.deepEqual(
        second.routes.map((route) => route.fullPath),
        ['/cities/:city'],
      );
      assert.strictEqual(
        second.routes[0]?.routes[0]?.fullPath,
        '/cities/:city/:venue',
      );
    });
  });

  module('Realm.getHostRouteDuplicates', function (hooks) {
    let realmURL = new URL('http://127.0.0.1:4444/routing-duplicates/');
    let testRealm: Realm;
    let definitionLookup: CachingDefinitionLookup;

    setupPermissionedRealmCached(hooks, {
      realmURL,
      permissions: { '*': ['read'] },
      fileSystem: makeDuplicatesFixture(),
      onRealmSetup({ testRealm: realm, testRealmServer }) {
        testRealm = realm;
        definitionLookup = serverDefinitionLookup(testRealmServer);
      },
    });

    hooks.beforeEach(async function () {
      await testRealm.indexing();
      // A host route reads only cached definitions, so cache the route
      // types first, then check again as after an index.
      let scoped = definitionLookup.forRealm(testRealm);
      for (let name of ['Post', 'Category', 'Product', 'Item', 'Shelf']) {
        await scoped.lookupDefinition({
          module: rri(`${realmURL.href}shop`),
          name,
        });
      }
      testRealm.clearRealmIndexCaches();
      expectCompleteRoutes(await testRealm.getHostRoutes());
    });

    function expectCompleteRoutes(validation: { complete: boolean }) {
      if (!validation.complete) {
        throw new Error('the host routes were expected to be validated');
      }
    }

    function summary(
      duplicates: Awaited<
        ReturnType<Realm['getHostRouteDuplicates']>
      >['duplicates'],
    ) {
      return duplicates.map((d) => ({
        fullPath: d.fullPath,
        values: d.values,
        parentCardId: d.parentCardId,
        cardIds: d.cardIds,
        servedCardId: d.servedCardId,
      }));
    }

    test('reports cards that share a value, and the one that is served', async function (assert) {
      let result = await testRealm.getHostRouteDuplicates();
      assert.true(result.complete);
      assert.deepEqual(
        summary(result.duplicates.filter((d) => d.fullPath === '/posts/:slug')),
        [
          {
            fullPath: '/posts/:slug',
            values: { slug: 'hello' },
            parentCardId: undefined,
            cardIds: [`${realmURL.href}post-a`, `${realmURL.href}post-b`],
            servedCardId: `${realmURL.href}post-a`,
          },
        ],
        'the draft post fails the where, so it is not counted, and a value only a draft shares is not reported',
      );
    });

    test('compares nested cards only within their parent', async function (assert) {
      let result = await testRealm.getHostRouteDuplicates();
      assert.deepEqual(
        summary(
          result.duplicates.filter(
            (d) => d.fullPath === '/c/:category/:product',
          ),
        ),
        [
          {
            fullPath: '/c/:category/:product',
            values: { product: 'trail' },
            parentCardId: `${realmURL.href}shoes`,
            cardIds: [`${realmURL.href}trail-1`, `${realmURL.href}trail-2`],
            servedCardId: `${realmURL.href}trail-1`,
          },
        ],
        'the same slug in two categories is not reported',
      );
    });

    test('finds the parent of a card through a link the parent holds', async function (assert) {
      let { routes } = await testRealm.getHostRoutes();
      let item = routes.find((r) => r.fullPath === '/s/:shelf')?.routes[0];
      assert.deepEqual(
        item?.kind === 'field-match' ? item.parentLink : undefined,
        { field: 'items', side: 'parent', kind: 'linksToMany', inferred: true },
        'the shelf holds the link',
      );
      let result = await testRealm.getHostRouteDuplicates();
      assert.deepEqual(
        summary(
          result.duplicates.filter((d) => d.fullPath === '/s/:shelf/:item'),
        ),
        [
          {
            fullPath: '/s/:shelf/:item',
            values: { item: 'lamp' },
            parentCardId: `${realmURL.href}shelf-a`,
            cardIds: [`${realmURL.href}lamp-1`, `${realmURL.href}lamp-2`],
            servedCardId: `${realmURL.href}lamp-1`,
          },
        ],
        'the same slug on two shelves is not reported',
      );
    });

    test('the result is cached until the next index, which finds them again', async function (assert) {
      let first = await testRealm.getHostRouteDuplicates();
      assert.strictEqual(
        testRealm.getHostRouteDuplicates(),
        testRealm.getHostRouteDuplicates(),
        'concurrent calls share one check',
      );
      assert.deepEqual(await testRealm.getHostRouteDuplicates(), first);

      await testRealm.delete('post-b.json');
      await testRealm.indexing();

      let after = await testRealm.getHostRouteDuplicates();
      assert.notStrictEqual(after, first, 'checked again after the index');
      assert.deepEqual(
        summary(after.duplicates).map((d) => d.fullPath),
        ['/c/:category/:product', '/s/:shelf/:item'],
        'the removed duplicate is no longer reported',
      );
    });

    test('runs one check at a time, and an index during a check leaves its result uncached', async function (assert) {
      let original = RealmIndexQueryEngine.prototype.findSharedFieldValues;
      let calls = 0;
      let active = 0;
      let mostActive = 0;
      let firstCall: () => void;
      let started = new Promise<void>((resolve) => (firstCall = resolve));
      let release: () => void;
      let gate = new Promise<void>((resolve) => (release = resolve));
      RealmIndexQueryEngine.prototype.findSharedFieldValues = async function (
        this: RealmIndexQueryEngine,
        ...args: Parameters<typeof original>
      ) {
        calls++;
        active++;
        mostActive = Math.max(mostActive, active);
        firstCall();
        try {
          await gate;
          return await original.apply(this, args);
        } finally {
          active--;
        }
      };
      try {
        testRealm.clearRealmIndexCaches();
        let first = testRealm.getHostRouteDuplicates();
        assert.strictEqual(
          testRealm.getHostRouteDuplicates(),
          first,
          'concurrent readers share one check',
        );
        await started;

        // What an index does when it lands while the check runs.
        testRealm.clearRealmIndexCaches();
        let second = testRealm.getHostRouteDuplicates();
        assert.notStrictEqual(second, first, 'the index drops the check');
        await new Promise((resolve) => setTimeout(resolve, 50));
        assert.strictEqual(
          calls,
          1,
          'the new check waits for the dropped one to finish',
        );

        release!();
        await first;
        let result = await second;
        assert.strictEqual(mostActive, 1, 'one query ran at a time');
        assert.strictEqual(
          calls,
          10,
          'each check queried each of the five field-match routes once',
        );
        assert.strictEqual(
          testRealm.getHostRouteDuplicates(),
          second,
          "the dropped check's result is not cached",
        );
        assert.true(result.complete);
      } finally {
        RealmIndexQueryEngine.prototype.findSharedFieldValues = original;
      }
    });
  });

  module(
    'Realm.getHostRouteDuplicates with a parent link of unknown side',
    function (hooks) {
      let realmURL = new URL(
        'http://127.0.0.1:4444/routing-unknown-parent-side/',
      );
      let testRealm: Realm;
      let definitionLookup: CachingDefinitionLookup;

      setupPermissionedRealmCached(hooks, {
        realmURL,
        permissions: { '*': ['read'] },
        fileSystem: makeUnknownParentSideFixture(),
        onRealmSetup({ testRealm: realm, testRealmServer }) {
          testRealm = realm;
          definitionLookup = serverDefinitionLookup(testRealmServer);
        },
      });

      hooks.beforeEach(async function () {
        await testRealm.indexing();
        await definitionLookup.forRealm(testRealm).lookupDefinition({
          module: rri(`${realmURL.href}things`),
          name: 'Thing',
        });
        testRealm.clearRealmIndexCaches();
      });

      test('reports the check as not complete, and does not cache it', async function (assert) {
        let { routes, complete } = await testRealm.getHostRoutes();
        assert.true(complete, 'the routes are all validated');
        let thing = routes[0]?.routes[0];
        assert.deepEqual(
          thing?.kind === 'field-match' ? thing.parentLink : undefined,
          { field: 'things', side: 'unverified', inferred: false },
          "the link is not on the child's card",
        );
        let first = await testRealm.getHostRouteDuplicates();
        assert.deepEqual(first, { duplicates: [], complete: false });
        assert.notStrictEqual(
          testRealm.getHostRouteDuplicates(),
          first,
          'the next read checks again',
        );
      });
    },
  );

  module(
    'Realm.getHostRoutes with a type from another realm',
    function (hooks) {
      let realmURL = new URL('http://127.0.0.1:4444/routing-other-realm-type/');
      let testRealm: Realm;
      let definitionLookup: CachingDefinitionLookup;

      setupPermissionedRealmCached(hooks, {
        realmURL,
        permissions: { '*': ['read'] },
        fileSystem: makeOtherRealmTypeFixture(),
        onRealmSetup({ testRealm: realm, testRealmServer }) {
          testRealm = realm;
          definitionLookup = serverDefinitionLookup(testRealmServer);
        },
      });

      hooks.beforeEach(async function () {
        await testRealm.indexing();
      });

      test('reuses the validation only while the definition generation holds', async function (assert) {
        // Cache the base type's definition for this realm first: a host
        // route reads only cached definitions, and indexing this realm
        // doesn't have to leave this one in its cache.
        await definitionLookup.forRealm(testRealm).lookupDefinition({
          module: rri('@cardstack/base/card-api'),
          name: 'CardDef',
        });
        let first = await testRealm.getHostRoutes();
        assert.true(first.complete, 'the base type definition is cached');
        assert.deepEqual(
          first.routes.map((route) => [route.kind, route.fullPath]),
          [['field-match', '/cards/:name']],
        );
        assert.strictEqual(
          await testRealm.getHostRoutes(),
          first,
          'reused while no definition changed',
        );

        // A change to another realm's module doesn't reindex this realm; it
        // only moves the definition generation.
        definitionLookup.bumpGlobalGeneration();

        let second = await testRealm.getHostRoutes();
        assert.notStrictEqual(second, first, 'validated again');
        assert.deepEqual(second.routes, first.routes);
        assert.strictEqual(
          await testRealm.getHostRoutes(),
          second,
          'the new validation is reused in turn',
        );
      });
    },
  );

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
