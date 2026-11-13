import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { Test, SuperTest } from 'supertest';
import { rri } from '@cardstack/runtime-common';
import type {
  CachingDefinitionLookup,
  LooseSingleCardDocument,
  Realm,
} from '@cardstack/runtime-common';
import { setupPermissionedRealmCached } from '../helpers/index.ts';
import type { PgAdapter } from '@cardstack/postgres';
import {
  HostRouteLookupError,
  visitorHostRouteLookups,
} from '../../lib/host-route-lookups.ts';
import {
  admitSearch,
  getSearchInFlight,
  resetSearchAdmissionForTests,
  setSearchAdmissionForTests,
} from '../../search-inflight.ts';

const realmURL = new URL('http://127.0.0.1:4444/dynamic-routes/');
const realmPath = realmURL.pathname;
const TYPE_NAMES = ['Post', 'Page', 'Category', 'Product'];
const CARD_DEF = { module: rri('@cardstack/base/card-api'), name: 'CardDef' };

function card(
  name: string,
  attributes: Record<string, unknown>,
  relationships?: Record<string, { links: { self: string } }>,
): LooseSingleCardDocument {
  return {
    data: {
      type: 'card',
      attributes,
      ...(relationships ? { relationships } : {}),
      meta: { adoptsFrom: { module: rri('../site'), name } },
    },
  };
}

// A site with one route of each dynamic kind beside fixed routes: a card id
// template, field matches (one with a `where`, two siblings sharing `/:slug`),
// a nested field match, and a dynamic redirect. Each card's isolated template
// prints its label, so a response shows which card it served.
function makeSiteFixture(): Record<string, string | LooseSingleCardDocument> {
  let labelled = (name: string, extra = '') => `
    export class ${name} extends CardDef {
      static displayName = '${name}';
      @field slug = contains(StringField);
      @field label = contains(StringField);
      ${extra}
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <p data-test-label>Served {{@model.label}}</p>
        </template>
      };
    }`;
  return {
    'site.gts': `
      import { CardDef, Component, field, contains, linksTo } from "@cardstack/base/card-api";
      import StringField from "@cardstack/base/string";
      ${labelled('Person')}
      ${labelled('Post', '@field status = contains(StringField);')}
      ${labelled('Page')}
      ${labelled('Category')}
      ${labelled('Product', '@field category = linksTo(() => Category);')}
    `,
    'Person/robin.json': card('Person', { label: 'Robin' }),
    'Post/a.json': card('Post', {
      slug: 'hello',
      status: 'published',
      label: 'Post A',
    }),
    // Shares Post A's slug; Post A sorts first.
    'Post/b.json': card('Post', {
      slug: 'hello',
      status: 'published',
      label: 'Post B',
    }),
    'Post/draft.json': card('Post', {
      slug: 'unpublished',
      status: 'draft',
      label: 'Draft',
    }),
    // Slugs a URL path carries percent-encoded.
    'Post/cafe.json': card('Post', {
      slug: 'café',
      status: 'published',
      label: 'Cafe Post',
    }),
    'Post/spaced.json': card('Post', {
      slug: 'hello world',
      status: 'published',
      label: 'Spaced Post',
    }),
    'Page/about.json': card('Page', { slug: 'about', label: 'About' }),
    'Category/shoes.json': card('Category', { slug: 'shoes', label: 'Shoes' }),
    'Category/hats.json': card('Category', { slug: 'hats', label: 'Hats' }),
    'Product/trail.json': card(
      'Product',
      { slug: 'trail-runner', label: 'Trail Runner' },
      { category: { links: { self: '../Category/shoes' } } },
    ),
    // A card at the realm root whose own path a `/:slug` route matches
    // without finding it.
    'loose.json': {
      data: {
        type: 'card',
        attributes: { slug: 'not-loose', label: 'Loose' },
        meta: { adoptsFrom: { module: rri('./site'), name: 'Page' } },
      },
    },
    'realm.json': {
      data: {
        type: 'card',
        attributes: {
          cardInfo: { name: 'Dynamic Routes Realm' },
          hostRoutingRules: [
            { path: '/fixed' },
            { path: '/tos', redirectTo: '/terms' },
            { path: '/people/:id', card: './Person/:id' },
            {
              path: '/posts/:slug',
              type: { module: './site', name: 'Post' },
              where: { eq: { status: 'published' } },
              match: { slug: ':slug' },
            },
            {
              path: '/c/:category',
              type: { module: './site', name: 'Category' },
              match: { slug: ':category' },
              routes: [
                {
                  path: '/:product',
                  type: { module: './site', name: 'Product' },
                  match: { slug: ':product' },
                },
              ],
            },
            {
              path: '/u/:handle',
              redirectTo: '/people/:handle',
              statusCode: 301,
            },
            {
              path: '/:slug',
              type: { module: './site', name: 'Post' },
              match: { slug: ':slug' },
            },
            {
              path: '/:slug',
              type: { module: './site', name: 'Page' },
              match: { slug: ':slug' },
            },
          ],
        },
        relationships: {
          'hostRoutingRules.0.instance': { links: { self: './Page/about' } },
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

module(`server-endpoints/${basename(import.meta.filename)}`, function () {
  module('serving a page through dynamic host routes', function (hooks) {
    let request: SuperTest<Test>;
    let testRealm: Realm;
    let definitionLookup: CachingDefinitionLookup;
    let dbAdapter: PgAdapter;

    setupPermissionedRealmCached(hooks, {
      realmURL,
      permissions: { '*': ['read'] },
      fileSystem: makeSiteFixture(),
      onRealmSetup(args) {
        request = args.request;
        testRealm = args.testRealm;
        definitionLookup = serverDefinitionLookup(args.testRealmServer);
        dbAdapter = args.dbAdapter;
      },
    });

    function hostConfig(text: string) {
      let match = text.match(
        /<meta name="@cardstack\/host\/config\/environment" content="([^"]+)"/,
      );
      if (!match) {
        throw new Error('the page has no config meta tag');
      }
      return JSON.parse(decodeURIComponent(match[1]));
    }

    // Answers the realm's host routes as an incomplete validation, as it is
    // while a field-match route's type isn't cached yet: the `/posts/:slug`
    // route is dropped.
    function withIncompleteHostRoutes() {
      let getHostRoutes = testRealm.getHostRoutes;
      testRealm.getHostRoutes = async function (this: Realm) {
        let validation = await getHostRoutes.call(this);
        return {
          ...validation,
          routes: validation.routes.filter(
            (route) => route.fullPath !== '/posts/:slug',
          ),
          complete: false,
        };
      };
      return () => {
        testRealm.getHostRoutes = getHostRoutes;
      };
    }

    hooks.beforeEach(async function () {
      await testRealm.indexing();
      // A host route reads only cached type definitions, so cache the
      // field-match types first.
      for (let name of TYPE_NAMES) {
        await definitionLookup.forRealm(testRealm).lookupDefinition({
          module: rri(`${realmURL.href}site`),
          name,
        });
      }
    });

    function page(path: string) {
      return request.get(`${realmPath}${path}`).set('Accept', 'text/html');
    }

    test('a card id template serves its card', async function (assert) {
      let response = await page('people/robin');
      assert.strictEqual(response.status, 200);
      assert.true(response.text.includes('Served Robin'), 'serves Robin');
    });

    test('a field match serves the card that sorts first', async function (assert) {
      let response = await page('posts/hello');
      assert.strictEqual(response.status, 200);
      assert.true(response.text.includes('Served Post A'), 'serves Post A');
      assert.false(response.text.includes('Served Post B'));
    });

    test('a field match whose `where` excludes the card answers 404', async function (assert) {
      let response = await page('posts/unpublished');
      assert.strictEqual(response.status, 404);
      assert.false(response.text.includes('Served Draft'));
    });

    test('a sibling that finds no card falls through to the next one', async function (assert) {
      let response = await page('about');
      assert.strictEqual(response.status, 200);
      assert.true(
        response.text.includes('Served About'),
        'the Page route serves it',
      );
    });

    test('a nested route serves the child card within its parent', async function (assert) {
      let response = await page('c/shoes/trail-runner');
      assert.strictEqual(response.status, 200);
      assert.true(response.text.includes('Served Trail Runner'));

      let parent = await page('c/shoes');
      assert.strictEqual(parent.status, 200);
      assert.true(parent.text.includes('Served Shoes'));

      let wrongParent = await page('c/hats/trail-runner');
      assert.strictEqual(
        wrongParent.status,
        404,
        'a child that does not belong to the parent is not served',
      );
    });

    test('a dynamic redirect answers its status and fills its target', async function (assert) {
      let response = await page('u/robin?utm_source=newsletter');
      assert.strictEqual(response.status, 301);
      assert.strictEqual(
        response.headers['location'],
        `${realmURL.origin}${realmPath}people/robin?utm_source=newsletter`,
      );
    });

    test('a path a route matches that finds no card answers 404', async function (assert) {
      let response = await page('posts/no-such-post');
      assert.strictEqual(response.status, 404);
      assert.false(
        Boolean(response.headers['etag']),
        'a 404 carries no validator',
      );
    });

    test("a card's own path is still served when a route matches it and finds nothing", async function (assert) {
      let response = await page('loose');
      assert.strictEqual(response.status, 200);
      assert.true(response.text.includes('Served Loose'));
    });

    test('a path no route matches is served as before', async function (assert) {
      let response = await page('Post/b');
      assert.strictEqual(response.status, 200);
      assert.true(response.text.includes('Served Post B'));
    });

    test('the trailing-slash form 308-redirects to the canonical form', async function (assert) {
      let response = await page('posts/hello/?x=1');
      assert.strictEqual(response.status, 308);
      assert.strictEqual(
        response.headers['location'],
        `${realmURL.origin}${realmPath}posts/hello?x=1`,
      );
    });

    test('fixed routes and redirects behave as before', async function (assert) {
      let fixed = await page('fixed');
      assert.strictEqual(fixed.status, 200);
      assert.true(fixed.text.includes('Served About'));

      let slash = await page('fixed/');
      assert.strictEqual(slash.status, 308);
      assert.strictEqual(
        slash.headers['location'],
        `${realmURL.origin}${realmPath}fixed`,
      );

      let redirect = await page('tos');
      assert.strictEqual(redirect.status, 302);
      assert.strictEqual(
        redirect.headers['location'],
        `${realmURL.origin}${realmPath}terms`,
      );
    });

    test('the dynamic routes are injected into the host config', async function (assert) {
      let response = await page('posts/hello');
      let match = response.text.match(
        /<meta name="@cardstack\/host\/config\/environment" content="([^"]+)"/,
      );
      assert.ok(match, 'the config meta tag is there');
      let config = JSON.parse(decodeURIComponent(match![1]));
      assert.strictEqual(config.hostDynamicRoutes?.realmURL, realmURL.href);
      assert.true(
        config.hostDynamicRoutes?.complete,
        'the validation is complete',
      );
      assert.deepEqual(
        config.hostDynamicRoutes?.routes.map(
          (route: { kind: string; fullPath: string }) => [
            route.kind,
            route.fullPath,
          ],
        ),
        [
          ['fixed-card', '/fixed'],
          ['redirect', '/tos'],
          ['card-id', '/people/:id'],
          ['field-match', '/posts/:slug'],
          ['field-match', '/c/:category'],
          ['redirect', '/u/:handle'],
          ['field-match', '/:slug'],
          ['field-match', '/:slug'],
        ],
      );
      assert.deepEqual(
        config.hostRoutingMap.map((rule: { path: string }) => rule.path),
        [`${realmPath}fixed`, `${realmPath}tos`, `${realmPath}posts/hello`],
        'the fixed routing map keeps its shape, with the served path last',
      );
    });

    test('a path a dynamic route serves is a serve rule in the injected routing map', async function (assert) {
      function routingMap(text: string) {
        let match = text.match(
          /<meta name="@cardstack\/host\/config\/environment" content="([^"]+)"/,
        );
        assert.ok(match, 'the config meta tag is there');
        return JSON.parse(decodeURIComponent(match![1])).hostRoutingMap as {
          path: string;
          id?: string;
          redirectTo?: string;
        }[];
      }

      let response = await page('c/shoes/trail-runner');
      assert.strictEqual(response.status, 200);
      assert.deepEqual(
        routingMap(response.text).find(
          (rule) => rule.path === `${realmPath}c/shoes/trail-runner`,
        ),
        {
          path: `${realmPath}c/shoes/trail-runner`,
          id: `${realmURL.href}Product/trail`,
        },
        'the host app finds the served card for this path on first render',
      );

      let fixed = await page('fixed');
      assert.deepEqual(
        routingMap(fixed.text).map((rule) => rule.path),
        [`${realmPath}fixed`, `${realmPath}tos`],
        'a fixed route adds no rule',
      );

      let missing = await page('posts/unpublished');
      assert.strictEqual(missing.status, 404);
      assert.deepEqual(
        routingMap(missing.text).map((rule) => rule.path),
        [`${realmPath}fixed`, `${realmPath}tos`],
        'a path that resolves to nothing adds no rule',
      );
    });

    test('a slug that needs percent-encoding is served, and its rule has the path the host compares', async function (assert) {
      // The host's `/*path` catch-all receives the browser's
      // `location.pathname` unchanged: route-recognizer does not decode a
      // star segment. So the rule's path is the request path as it arrived,
      // percent-encoded.
      for (let [path, label, cardPath] of [
        ['posts/caf%C3%A9', 'Cafe Post', 'Post/cafe'],
        ['posts/hello%20world', 'Spaced Post', 'Post/spaced'],
      ]) {
        let response = await page(path);
        assert.strictEqual(response.status, 200, `${path} is served`);
        assert.true(response.text.includes(`Served ${label}`));
        let match = response.text.match(
          /<meta name="@cardstack\/host\/config\/environment" content="([^"]+)"/,
        );
        let map = JSON.parse(decodeURIComponent(match![1])).hostRoutingMap;
        assert.deepEqual(
          map.at(-1),
          { path: `${realmPath}${path}`, id: `${realmURL.href}${cardPath}` },
          `${path} has a serve rule`,
        );
      }
    });

    test('a route search takes a slot under the search ceiling, and a shed answers 429', async function (assert) {
      setSearchAdmissionForTests({ limit: 1, waitMs: 10 });
      let held = await admitSearch();
      try {
        assert.ok(held, 'the test holds the only slot');
        let shed = await page('posts/hello');
        assert.strictEqual(shed.status, 429, 'the shed search answers 429');
        assert.strictEqual(shed.headers['retry-after'], '1');
        held!();
        held = null;
        let served = await page('posts/hello');
        assert.strictEqual(served.status, 200, 'with a slot free, it serves');
        assert.strictEqual(getSearchInFlight(), 0, 'the slot is handed back');
      } finally {
        held?.();
        resetSearchAdmissionForTests();
      }
    });

    test('while a route is dropped for an unavailable type, a path that resolves to nothing answers 503', async function (assert) {
      let before = await page('c/no-such-category');
      assert.strictEqual(before.status, 404, 'a complete validation: 404');

      let restore = withIncompleteHostRoutes();
      try {
        let missing = await page('c/no-such-category');
        assert.strictEqual(missing.status, 503, 'an incomplete one: 503');

        let served = await page('people/robin');
        assert.strictEqual(served.status, 200, 'a route that resolves serves');
        assert.false(
          hostConfig(served.text).hostDynamicRoutes.complete,
          'the injected routes say the validation is incomplete',
        );
      } finally {
        restore();
      }
    });

    test('a file of the realm a route pattern covers is served as before', async function (assert) {
      for (let path of ['site', 'site.gts']) {
        let response = await page(path);
        assert.strictEqual(response.status, 200, `${path} gets the page`);
      }
      let missing = await page('no-such-thing');
      assert.strictEqual(missing.status, 404, 'a path no file has: 404');
    });

    test('a generic-Accept request of a published realm goes through the dynamic routes', async function (assert) {
      // The generic-Accept gate serves pages only for a published realm.
      await dbAdapter.execute(`DELETE FROM realm_registry WHERE url = $1`, {
        bind: [realmURL.href],
      });
      await dbAdapter.execute(
        `INSERT INTO realm_registry (url, kind, disk_id, owner_username, source_url, last_published_at) VALUES ($1, 'published', $2, $3, $4, $5)`,
        {
          bind: [
            realmURL.href,
            'dynamic-routes-published',
            'owner',
            'http://127.0.0.1:4444/dynamic-routes-source/',
            Date.now(),
          ],
        },
      );
      let generic = (path: string) =>
        request.get(`${realmPath}${path}`).set('Accept', '*/*');

      let served = await generic('posts/hello');
      assert.strictEqual(served.status, 200, 'a routed path is served');
      assert.true(served.text.includes('Served Post A'));

      let redirected = await generic('u/robin');
      assert.strictEqual(redirected.status, 301, 'a dynamic redirect answers');

      let module = await generic('site');
      assert.strictEqual(module.status, 200, 'a module is still served');
      assert.false(
        module.text.includes('<meta name="@cardstack'),
        'as the module, not the page',
      );

      let missing = await generic('posts/no-such-post');
      assert.strictEqual(missing.status, 404, 'a path that finds nothing: 404');
    });

    test('a failed lookup answers 503, and a rate-limited one 429', async function (assert) {
      let handle = testRealm.handle;
      let status = 500;
      testRealm.handle = async (req: Request) => {
        if (new URL(req.url).pathname.endsWith('/_search')) {
          return new Response('', {
            status,
            headers: status === 429 ? { 'Retry-After': '30' } : {},
          });
        }
        return handle(req);
      };
      try {
        let failed = await page('posts/hello');
        assert.strictEqual(failed.status, 503, 'a failed search answers 503');
        assert.false(failed.text.includes('<meta name="@cardstack'));

        status = 429;
        let limited = await page('posts/hello');
        assert.strictEqual(limited.status, 429, 'a rate limit answers 429');
        assert.strictEqual(limited.headers['retry-after'], '30');

        let byId = await page('people/robin');
        assert.strictEqual(
          byId.status,
          200,
          'a route that does not search is not affected',
        );
      } finally {
        testRealm.handle = handle;
      }
    });
  });

  module('host route lookups as an anonymous visitor', function (hooks) {
    let privateRealmURL = new URL('http://127.0.0.1:4444/private-routes/');
    let testRealm: Realm;

    setupPermissionedRealmCached(hooks, {
      realmURL: privateRealmURL,
      permissions: { '@owner:localhost': ['read', 'write', 'realm-owner'] },
      fileSystem: {
        'Thing/one.json': {
          data: {
            type: 'card',
            attributes: { cardInfo: { name: 'One' } },
            meta: {
              adoptsFrom: {
                module: rri('@cardstack/base/card-api'),
                name: 'CardDef',
              },
            },
          },
        },
      },
      onRealmSetup(args) {
        testRealm = args.testRealm;
      },
    });

    test('an address that holds a file other than a card is a miss', async function (assert) {
      let handle = testRealm.handle;
      testRealm.handle = async () =>
        new Response(
          JSON.stringify({
            data: {
              type: 'file-meta',
              id: `${privateRealmURL.href}docs/readme.md`,
              attributes: {},
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      try {
        let { load } = visitorHostRouteLookups({
          realm: testRealm,
          visitorHeaders: {},
        });
        assert.strictEqual(
          await load({
            cardHref: `${privateRealmURL.href}docs/readme.md`,
            linkFields: [],
          }),
          undefined,
          'the load resolves to no card',
        );
      } finally {
        testRealm.handle = handle;
      }
    });

    test('a card the visitor cannot read is a miss, and a search the realm refuses is an error', async function (assert) {
      let { load, search } = visitorHostRouteLookups({
        realm: testRealm,
        visitorHeaders: {},
      });
      assert.strictEqual(
        await load({
          cardHref: `${privateRealmURL.href}Thing/one`,
          linkFields: [],
        }),
        undefined,
        'the load resolves to no card',
      );
      await assert.rejects(
        search({
          type: CARD_DEF,
          filter: {
            on: CARD_DEF,
            eq: { 'cardInfo.name': 'One' },
          },
          linkFields: [],
        }),
        (error: unknown) =>
          error instanceof HostRouteLookupError && error.status === 503,
        'the refused search rejects with a 503 error',
      );
    });
  });
});
