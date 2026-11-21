import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import {
  DEFAULT_PERMISSIONS,
  SupportedMimeType,
  rri,
} from '@cardstack/runtime-common';
import type {
  CachingDefinitionLookup,
  LooseSingleCardDocument,
  Realm,
  RealmPermissions,
} from '@cardstack/runtime-common';

import {
  createJWT,
  setupPermissionedRealmCached,
  testRealmURLFor,
  type RealmRequest,
  withRealmPath,
} from '../helpers/index.ts';

const ownerUserId = '@mango:localhost';
const strangerUserId = '@stranger:localhost';

function card(
  module: string,
  name: string,
  attributes: Record<string, unknown>,
): LooseSingleCardDocument {
  return {
    data: {
      type: 'card',
      attributes,
      meta: { adoptsFrom: { module: rri(module), name } },
    },
  };
}

// A realm with one route of each kind, and a child route.
function makeRoutedFixture(): Record<string, string | LooseSingleCardDocument> {
  return {
    'site.gts': `
      import { CardDef, field, contains, linksTo } from "@cardstack/base/card-api";
      import StringField from "@cardstack/base/string";
      export class Category extends CardDef {
        static displayName = 'Category';
        @field slug = contains(StringField);
      }
      export class Post extends CardDef {
        static displayName = 'Post';
        @field slug = contains(StringField);
        @field status = contains(StringField);
        @field category = linksTo(() => Category);
      }
    `,
    'home.json': card('@cardstack/base/card-api', 'CardDef', {
      cardInfo: { name: 'Home' },
    }),
    'Category/news.json': card('./site', 'Category', { slug: 'news' }),
    'realm.json': {
      data: {
        type: 'card',
        attributes: {
          cardInfo: { name: 'Routed Realm' },
          hostRoutingRules: [
            { path: '/', name: 'home' },
            { path: '/old', redirectTo: '/', statusCode: 301 },
            {
              path: '/categories/:id',
              name: 'category-by-id',
              card: './Category/:id',
            },
            {
              path: '/c/:category',
              name: 'category',
              type: { module: './site', name: 'Category' },
              match: { slug: ':category' },
              routes: [
                {
                  path: '/:post',
                  name: 'post',
                  type: { module: './site', name: 'Post' },
                  parent: 'category',
                  where: { eq: { status: 'published' } },
                  match: { slug: ':post' },
                },
              ],
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

// The definition lookup the test realm server and its realm read through,
// which the server keeps private.
function serverDefinitionLookup(testRealmServer: {
  testRealmServer: unknown;
}): CachingDefinitionLookup {
  return (
    testRealmServer.testRealmServer as {
      definitionLookup: CachingDefinitionLookup;
    }
  ).definitionLookup;
}

module(`realm-endpoints/${basename(import.meta.filename)}`, function () {
  module('a private realm with host routes', function (hooks) {
    let realmURL = testRealmURLFor('host-routes/');
    let request: RealmRequest;
    let testRealm: Realm;
    let definitionLookup: CachingDefinitionLookup;

    setupPermissionedRealmCached(hooks, {
      realmURL,
      permissions: {
        [ownerUserId]: ['read', 'write', 'realm-owner'],
      },
      fileSystem: makeRoutedFixture(),
      onRealmSetup(args) {
        testRealm = args.testRealm;
        request = withRealmPath(args.request, realmURL);
        definitionLookup = serverDefinitionLookup(args.testRealmServer);
      },
    });

    hooks.beforeEach(async function () {
      await testRealm.indexing();
      // The realm validates a field-match route against its type's
      // definition, so make both definitions available first.
      for (let name of ['Category', 'Post']) {
        await definitionLookup.forRealm(testRealm).lookupDefinition({
          module: rri(`${realmURL.href}site`),
          name,
        });
      }
    });

    function hostRoutes(
      userId?: string,
      permissions: RealmPermissions['user'] = DEFAULT_PERMISSIONS,
    ) {
      let get = request
        .get('/_host-routes')
        .set('Accept', SupportedMimeType.JSON);
      return userId
        ? get.set(
            'Authorization',
            `Bearer ${createJWT(testRealm, userId, permissions)}`,
          )
        : get;
    }

    test('answers the validated route tree to a caller who can read the realm', async function (assert) {
      let response = await hostRoutes(ownerUserId);

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      assert.strictEqual(
        response.headers['cache-control'],
        'no-store',
        'the answer is not stored',
      );
      assert.deepEqual(
        Object.keys(response.body),
        ['routes'],
        'the answer holds the routes and nothing else',
      );
      let { routes, complete } = await testRealm.getHostRoutes();
      assert.true(complete, 'the realm validated every route');
      assert.deepEqual(
        response.body.routes,
        JSON.parse(JSON.stringify(routes)),
        'the routes are exactly the ones the realm validated',
      );
      assert.deepEqual(
        response.body.routes.map(
          (route: { kind: string; fullPath: string }) => [
            route.kind,
            route.fullPath,
          ],
        ),
        [
          ['fixed-card', '/'],
          ['redirect', '/old'],
          ['card-id', '/categories/:id'],
          ['field-match', '/c/:category'],
        ],
        'every route form is there, in authored order',
      );
      assert.deepEqual(
        response.body.routes[3].routes.map(
          (route: { kind: string; fullPath: string }) => [
            route.kind,
            route.fullPath,
          ],
        ),
        [['field-match', '/c/:category/:post']],
        'with its child routes',
      );
    });

    test('refuses a caller who cannot read the realm', async function (assert) {
      let anonymous = await hostRoutes();
      assert.strictEqual(anonymous.status, 401, 'no token: 401');
      assert.strictEqual(anonymous.body.routes, undefined, 'and no routes');

      let stranger = await hostRoutes(strangerUserId, []);
      assert.strictEqual(stranger.status, 403, 'no read permission: 403');
      assert.strictEqual(stranger.body.routes, undefined, 'and no routes');
    });

    test('answers 503 with a time to ask again while a route is not available', async function (assert) {
      // The realm's own answer while a field-match route's type can't be
      // read yet: the route is dropped and the validation is incomplete.
      let getHostRoutes = testRealm.getHostRoutes;
      testRealm.getHostRoutes = async function (this: Realm) {
        let validation = await getHostRoutes.call(this);
        return {
          ...validation,
          routes: validation.routes.filter(
            (route) => route.kind !== 'field-match',
          ),
          complete: false,
        };
      };
      try {
        let response = await hostRoutes(ownerUserId);

        assert.strictEqual(response.status, 503, 'HTTP 503 status');
        assert.true(
          Number(response.headers['retry-after']) > 0,
          'it says when to ask again',
        );
        assert.strictEqual(
          response.body.routes,
          undefined,
          'it answers no routes, not the ones that are left',
        );
        assert.strictEqual(
          response.body.errors?.[0]?.status,
          503,
          'the body is an error document',
        );
      } finally {
        testRealm.getHostRoutes = getHostRoutes;
      }

      let recovered = await hostRoutes(ownerUserId);
      assert.strictEqual(recovered.status, 200, 'then the whole tree');
      assert.strictEqual(recovered.body.routes.length, 4);
    });
  });

  module('a public realm without host routes', function (hooks) {
    let realmURL = testRealmURLFor('no-host-routes/');
    let request: RealmRequest;

    setupPermissionedRealmCached(hooks, {
      realmURL,
      permissions: { '*': ['read'] },
      fileSystem: {
        'home.json': card('@cardstack/base/card-api', 'CardDef', {
          cardInfo: { name: 'Home' },
        }),
      },
      onRealmSetup(args) {
        request = withRealmPath(args.request, realmURL);
      },
    });

    test('answers an empty tree to a caller who is not signed in', async function (assert) {
      let response = await request
        .get('/_host-routes')
        .set('Accept', SupportedMimeType.JSON);

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      assert.deepEqual(response.body, { routes: [] }, 'no routes');
    });
  });
});
