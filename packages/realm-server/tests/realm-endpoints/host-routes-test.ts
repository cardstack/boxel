import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import {
  DEFAULT_PERMISSIONS,
  DURING_PRERENDER_HEADER,
  HostRoutesReadError,
  SupportedMimeType,
  rri,
} from '@cardstack/runtime-common';
import type {
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

module(`realm-endpoints/${basename(import.meta.filename)}`, function () {
  module('a private realm with host routes', function (hooks) {
    let realmURL = testRealmURLFor('host-routes/');
    let request: RealmRequest;
    let testRealm: Realm;

    setupPermissionedRealmCached(hooks, {
      realmURL,
      permissions: {
        [ownerUserId]: ['read', 'write', 'realm-owner'],
      },
      fileSystem: makeRoutedFixture(),
      onRealmSetup(args) {
        testRealm = args.testRealm;
        request = withRealmPath(args.request, realmURL);
      },
    });

    hooks.beforeEach(async function () {
      await testRealm.indexing();
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
        ['routes', 'servedAtHostURL'],
        'the answer holds the routes, whether a host URL serves the realm, and nothing else',
      );
      assert.false(
        response.body.servedAtHostURL,
        'no host URL serves a realm that is not published',
      );
      let { routes } = await testRealm.getHostRoutes();
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

    test('answers 503 with Retry-After, and no routes, when the index can not be read', async function (assert) {
      let getHostRoutes = testRealm.getHostRoutes;
      testRealm.getHostRoutes = async () => {
        throw new HostRoutesReadError('the index can not be read');
      };
      try {
        let response = await hostRoutes(ownerUserId);
        assert.strictEqual(response.status, 503, 'HTTP 503 status');
        assert.strictEqual(
          response.headers['retry-after'],
          '30',
          'the caller is asked to try again',
        );
        assert.strictEqual(
          response.headers['cache-control'],
          'no-store',
          'the answer is not stored',
        );
        assert.strictEqual(response.body.routes, undefined, 'no routes');
      } finally {
        testRealm.getHostRoutes = getHostRoutes;
      }
      let again = await hostRoutes(ownerUserId);
      assert.strictEqual(again.status, 200, 'the next read gets the tree');
    });

    test('refuses a caller who cannot read the realm', async function (assert) {
      let anonymous = await hostRoutes();
      assert.strictEqual(anonymous.status, 401, 'no token: 401');
      assert.strictEqual(anonymous.body.routes, undefined, 'and no routes');

      let stranger = await hostRoutes(strangerUserId, []);
      assert.strictEqual(stranger.status, 403, 'no read permission: 403');
      assert.strictEqual(stranger.body.routes, undefined, 'and no routes');
    });

    test('answers a render without reading the routes, because no host URL serves the realm', async function (assert) {
      let getHostRoutes = testRealm.getHostRoutes;
      let reads = 0;
      testRealm.getHostRoutes = async function (this: Realm) {
        reads++;
        return await getHostRoutes.call(this);
      };
      try {
        let response = await hostRoutes(ownerUserId).set(
          DURING_PRERENDER_HEADER,
          '1',
        );

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.deepEqual(
          response.body,
          { servedAtHostURL: false },
          'the answer says only that no host URL serves the realm',
        );
        assert.strictEqual(reads, 0, 'the routes were not read');
      } finally {
        testRealm.getHostRoutes = getHostRoutes;
      }
    });
  });

  module('a published realm with host routes', function (hooks) {
    let realmURL = testRealmURLFor('published-host-routes/');
    let request: RealmRequest;
    let testRealm: Realm;

    setupPermissionedRealmCached(hooks, {
      realmURL,
      permissions: { '*': ['read'] },
      fileSystem: makeRoutedFixture(),
      published: true,
      onRealmSetup(args) {
        testRealm = args.testRealm;
        request = withRealmPath(args.request, realmURL);
      },
    });

    function hostRoutesForRender() {
      return request
        .get('/_host-routes')
        .set('Accept', SupportedMimeType.JSON)
        .set(DURING_PRERENDER_HEADER, '1');
    }

    test('answers a render the routes, and that a host URL serves the realm', async function (assert) {
      // The routes are the tree the index stored, so a render's request
      // doesn't wait for a type's definition.
      let response = await hostRoutesForRender();

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      assert.true(response.body.servedAtHostURL, 'a host URL serves it');
      assert.deepEqual(
        response.body.routes,
        JSON.parse(JSON.stringify((await testRealm.getHostRoutes()).routes)),
        'with its routes',
      );
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
      assert.deepEqual(
        response.body,
        { routes: [], servedAtHostURL: false },
        'no routes',
      );
    });
  });
});
