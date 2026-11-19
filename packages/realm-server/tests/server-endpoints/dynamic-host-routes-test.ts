import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { Test, SuperTest } from 'supertest';
import { parseRoutePathPattern, rri } from '@cardstack/runtime-common';
import type {
  CachingDefinitionLookup,
  HostRoute,
  HostRoutesValidation,
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

    // Answers the realm's host routes, with or without their type reads, as
    // `change` makes them from the realm's own validation.
    function withHostRoutes(
      change: (validation: HostRoutesValidation) => HostRoutesValidation,
    ) {
      let { getHostRoutes, getHostRoutesWithoutTypeReads } = testRealm;
      let changed = async function (this: Realm) {
        return change(await getHostRoutes.call(this));
      };
      testRealm.getHostRoutes = changed;
      testRealm.getHostRoutesWithoutTypeReads = changed;
      return () => {
        testRealm.getHostRoutes = getHostRoutes;
        testRealm.getHostRoutesWithoutTypeReads = getHostRoutesWithoutTypeReads;
      };
    }

    // Answers the realm's host routes as an incomplete validation, as it is
    // while a field-match route's type can't be read: the routes `keep`
    // rejects are dropped, by default the `/posts/:slug` route.
    function withIncompleteHostRoutes(
      keep: (route: HostRoute) => boolean = (route) =>
        route.fullPath !== '/posts/:slug',
    ) {
      return withHostRoutes((validation) => ({
        ...validation,
        routes: validation.routes.filter(keep),
        complete: false,
      }));
    }

    hooks.beforeEach(async function () {
      await testRealm.indexing();
      // Cache the field-match types first, so most tests don't wait for a
      // module render.
      for (let name of TYPE_NAMES) {
        await definitionLookup.forRealm(testRealm).lookupDefinition({
          module: rri(`${realmURL.href}site`),
          name,
        });
      }
    });

    // The generic-Accept gate serves pages only for a published realm.
    async function markRealmPublished() {
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
    }

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

    test('the first request after the definitions cache is cleared serves the page', async function (assert) {
      // What a server restart does: it clears the definitions cache, and the
      // realm boots on its existing index.
      await definitionLookup.clearRealmDefinitions(realmURL.href);
      testRealm.clearRealmIndexCaches();
      let response = await page('posts/hello');
      assert.strictEqual(
        response.status,
        200,
        'the request waits for the read',
      );
      assert.true(response.text.includes('Served Post A'), 'serves Post A');
    });

    test('on a published realm, the first request after the definitions cache is cleared serves the page', async function (assert) {
      // The prerender imports the route type's module with a generic Accept
      // header, so the import must not wait for the validation that renders
      // the module.
      await markRealmPublished();
      await definitionLookup.clearRealmDefinitions(realmURL.href);
      testRealm.clearRealmIndexCaches();
      let response = await page('posts/hello');
      assert.strictEqual(
        response.status,
        200,
        'the request waits for the read',
      );
      assert.true(response.text.includes('Served Post A'), 'serves Post A');
    });

    test('a path that only a route dropped for an unreadable type matches answers 503', async function (assert) {
      let pattern = parseRoutePathPattern('/posts/:slug');
      if (!pattern.ok) {
        throw new Error('the pattern does not parse');
      }
      let restore = withHostRoutes((validation) => {
        let posts = validation.routes.find(
          (route) => route.fullPath === '/posts/:slug',
        )!;
        return {
          routes: validation.routes.filter(
            (route) => route.kind === 'fixed-card',
          ),
          warnings: [
            {
              code: 'type-unavailable',
              message: 'The definition of Post is not available',
              position: posts.position,
              path: '/posts/:slug',
              dropped: true,
            },
          ],
          complete: false,
          unavailableRoutePatterns: [pattern.pattern],
        };
      });
      try {
        let response = await page('posts/hello');
        assert.strictEqual(response.status, 503, 'not a 404');
        let other = await page('no-route/here');
        assert.notStrictEqual(
          other.status,
          503,
          'a path the dropped route does not match is served as before',
        );
      } finally {
        restore();
      }
    });

    test('while a route type is read, only a page a field-match route could answer waits for it', async function (assert) {
      await markRealmPublished();
      testRealm.clearRealmIndexCaches();
      let release!: () => void;
      let held = new Promise<void>((resolve) => (release = resolve));
      let lookup = definitionLookup.lookupDefinitionEntryForRealm;
      definitionLookup.lookupDefinitionEntryForRealm = async function (
        this: CachingDefinitionLookup,
        ...args: Parameters<
          CachingDefinitionLookup['lookupDefinitionEntryForRealm']
        >
      ) {
        await held;
        return await lookup.apply(this, args);
      };
      let generic = (path: string) =>
        request.get(`${realmPath}${path}`).set('Accept', '*/*');
      try {
        let fixed = await page('fixed');
        assert.strictEqual(fixed.status, 200, 'a fixed route does not wait');

        let module = await generic('site');
        assert.strictEqual(module.status, 200, 'a module import does not wait');
        assert.false(
          module.text.includes('<meta name="@cardstack'),
          'and gets the module',
        );

        let crawler = await generic('posts/hello');
        assert.strictEqual(
          crawler.status,
          503,
          'a generic-Accept request does not wait for the type',
        );

        let waiting = page('posts/hello').then((response) => response);
        release();
        let served = await waiting;
        assert.strictEqual(served.status, 200, 'a browser waits for the type');
        assert.true(served.text.includes('Served Post A'), 'serves Post A');
      } finally {
        release();
        definitionLookup.lookupDefinitionEntryForRealm = lookup;
      }
    });

    test('while every dynamic route is dropped, the injected routes still say the validation is incomplete', async function (assert) {
      let restore = withIncompleteHostRoutes(
        (route) => route.kind === 'fixed-card' || route.fullPath === '/tos',
      );
      try {
        let response = await page('people/robin');
        assert.strictEqual(response.status, 200, 'the page is served');
        let config = hostConfig(response.text);
        assert.false(config.hostDynamicRoutes?.complete, 'incomplete');
        assert.deepEqual(
          config.hostDynamicRoutes?.routes.map(
            (route: { fullPath: string }) => route.fullPath,
          ),
          ['/fixed', '/tos'],
          'only the fixed routes survived',
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
      await markRealmPublished();
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

  module('an alias route', function (hooks) {
    const aliasRealmURL = new URL('http://127.0.0.1:4444/alias-routes/');
    const aliasRealmPath = aliasRealmURL.pathname;
    let request: SuperTest<Test>;
    let testRealm: Realm;
    let definitionLookup: CachingDefinitionLookup;

    // Aliases (`statusCode: 301`) in front of a nested field match, a field
    // match with a `where`, and a card id template the `where` sends drafts
    // to. Notes fit no route but their alias. A memo's canonical address is
    // its alias's own path, and a gadget's goes through its link to a
    // category. Two products share a slug, so their address serves the one
    // that sorts first.
    function makeAliasFixture(): Record<
      string,
      string | LooseSingleCardDocument
    > {
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
          ${labelled('Category')}
          ${labelled('Product', '@field category = linksTo(() => Category);')}
          ${labelled('Post', '@field status = contains(StringField);')}
          ${labelled('Note')}
          ${labelled('Memo')}
          ${labelled(
            'Gadget',
            // A field match filters through the link, so its target is in
            // the search doc.
            '@field category = linksTo(() => Category, { searchable: true });',
          )}
        `,
        'Category/shoes.json': card('Category', {
          slug: 'shoes',
          label: 'Shoes',
        }),
        'Product/trail.json': card(
          'Product',
          { slug: 'trail-runner', label: 'Trail Runner' },
          { category: { links: { self: '../Category/shoes' } } },
        ),
        // Shares Product/trail's slug and category; Product/trail sorts
        // first.
        'Product/trail2.json': card(
          'Product',
          { slug: 'trail-runner', label: 'Second Trail Runner' },
          { category: { links: { self: '../Category/shoes' } } },
        ),
        'Post/hello.json': card('Post', {
          slug: 'hello',
          status: 'published',
          label: 'Hello Post',
        }),
        'Post/draft.json': card('Post', {
          slug: 'draft-one',
          status: 'draft',
          label: 'Draft Post',
        }),
        'Note/one.json': card('Note', { slug: 'one', label: 'Note One' }),
        'Memo/x.json': card('Memo', { slug: 'x', label: 'Memo X' }),
        'Gadget/boot.json': card(
          'Gadget',
          { slug: 'boot', label: 'Boot Gadget' },
          { category: { links: { self: '../Category/shoes' } } },
        ),
        'realm.json': {
          data: {
            type: 'card',
            attributes: {
              cardInfo: { name: 'Alias Routes Realm' },
              hostRoutingRules: [
                { path: '/p/:id', card: './Product/:id', statusCode: 301 },
                { path: '/a/:id', card: './Post/:id', statusCode: 301 },
                { path: '/n/:id', card: './Note/:id', statusCode: 301 },
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
                  path: '/posts/:slug',
                  type: { module: './site', name: 'Post' },
                  where: { eq: { status: 'published' } },
                  match: { slug: ':slug' },
                },
                { path: '/archive/:id', card: './Post/:id' },
                // An alias and a later route that give the same path.
                { path: '/m/:id', card: './Memo/:id', statusCode: 301 },
                { path: '/m/:key', card: './Memo/:key' },
                // A field match through a link.
                {
                  path: '/gadget/:id',
                  card: './Gadget/:id',
                  statusCode: 301,
                },
                {
                  path: '/g/:cat/:slug',
                  type: { module: './site', name: 'Gadget' },
                  match: { 'category.slug': ':cat', slug: ':slug' },
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

    setupPermissionedRealmCached(hooks, {
      realmURL: aliasRealmURL,
      permissions: { '*': ['read'] },
      fileSystem: makeAliasFixture(),
      onRealmSetup(args) {
        request = args.request;
        testRealm = args.testRealm;
        definitionLookup = serverDefinitionLookup(args.testRealmServer);
      },
    });

    hooks.beforeEach(async function () {
      await testRealm.indexing();
      for (let name of ['Category', 'Product', 'Post', 'Gadget']) {
        await definitionLookup.forRealm(testRealm).lookupDefinition({
          module: rri(`${aliasRealmURL.href}site`),
          name,
        });
      }
    });

    function page(path: string) {
      return request.get(`${aliasRealmPath}${path}`).set('Accept', 'text/html');
    }

    test("an alias answers 301 to the card's field-match address", async function (assert) {
      let response = await page('a/hello?utm_source=newsletter');
      assert.strictEqual(response.status, 301);
      assert.strictEqual(
        response.headers.location,
        `${aliasRealmURL.origin}${aliasRealmPath}posts/hello?utm_source=newsletter`,
        'to the canonical address under the mount, with the query string',
      );
    });

    test('an alias answers 301 to a nested address, its parent filled from the link', async function (assert) {
      let response = await page('p/trail');
      assert.strictEqual(response.status, 301);
      assert.strictEqual(
        new URL(response.headers.location).pathname,
        `${aliasRealmPath}c/shoes/trail-runner`,
      );
      let target = await page('c/shoes/trail-runner');
      assert.strictEqual(target.status, 200, 'the target serves the card');
      assert.true(target.text.includes('Served Trail Runner'));
    });

    test("a card that fails the canonical route's where goes to the next route that fits", async function (assert) {
      let response = await page('a/draft');
      assert.strictEqual(response.status, 301);
      assert.strictEqual(
        new URL(response.headers.location).pathname,
        `${aliasRealmPath}archive/draft`,
      );
    });

    test('an alias whose canonical address is its own path serves the card', async function (assert) {
      let response = await page('m/x');
      assert.strictEqual(response.status, 200, 'no redirect to itself');
      assert.true(response.text.includes('Served Memo X'));

      let slashed = await page('m/x/');
      assert.strictEqual(slashed.status, 308, 'the trailing-slash form');
      assert.strictEqual(
        new URL(slashed.headers.location, aliasRealmURL).pathname,
        `${aliasRealmPath}m/x`,
        'goes to the path without the slash',
      );
    });

    test('an alias reads a value through a link, also when the search leaves out the linked cards', async function (assert) {
      let response = await page('gadget/boot');
      assert.strictEqual(response.status, 301);
      assert.strictEqual(
        new URL(response.headers.location).pathname,
        `${aliasRealmPath}g/shoes/boot`,
      );

      // Under load the realm answers a search with links only: the
      // response carries each result's own card and none it links to.
      let handle = testRealm.handle;
      let searches = 0;
      testRealm.handle = async (req: Request) => {
        let response = await handle(req);
        if (!response || !new URL(req.url).pathname.endsWith('/_search')) {
          return response;
        }
        searches++;
        let doc = await response.json();
        let items = new Set(
          (doc.data ?? []).map(
            (entry: { relationships?: { item?: { data?: { id: string } } } }) =>
              entry.relationships?.item?.data?.id,
          ),
        );
        doc.included = (doc.included ?? []).filter(
          (resource: { type: string; id: string }) =>
            resource.type !== 'card' || items.has(resource.id),
        );
        return new Response(JSON.stringify(doc), {
          status: response.status,
          headers: response.headers,
        });
      };
      try {
        let degraded = await page('gadget/boot');
        assert.true(searches > 0, 'the canonical address was searched');
        assert.strictEqual(degraded.status, 301);
        assert.strictEqual(
          new URL(degraded.headers.location).pathname,
          `${aliasRealmPath}g/shoes/boot`,
          'the same address as with the linked cards in the response',
        );
      } finally {
        testRealm.handle = handle;
      }
    });

    test('an alias whose card fits no other route serves the card', async function (assert) {
      let response = await page('n/one');
      assert.strictEqual(response.status, 200);
      assert.true(response.text.includes('Served Note One'));
    });

    test('a failed lookup of the canonical address serves the card at the alias path', async function (assert) {
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
        let failed = await page('a/hello');
        assert.strictEqual(failed.status, 200, 'a failed search');
        assert.true(failed.text.includes('Served Hello Post'));
        status = 429;
        let limited = await page('a/hello');
        assert.strictEqual(limited.status, 200, 'a rate limit');
        assert.true(limited.text.includes('Served Hello Post'));
      } finally {
        testRealm.handle = handle;
      }
    });

    test('while a route is dropped for an unavailable type, an alias serves the card', async function (assert) {
      // The canonical route of a published post is dropped, so the walk
      // would reach the archive route, which isn't canonical.
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
      try {
        let response = await page('a/hello');
        assert.strictEqual(response.status, 200, 'no redirect');
        assert.true(response.text.includes('Served Hello Post'));
      } finally {
        testRealm.getHostRoutes = getHostRoutes;
      }
    });

    test('an alias whose canonical address serves another card with the same value serves its own card', async function (assert) {
      let shared = await page('c/shoes/trail-runner');
      assert.true(
        shared.text.includes('Served Trail Runner'),
        'the shared address serves the card that sorts first',
      );
      assert.false(shared.text.includes('Served Second Trail Runner'));

      let first = await page('p/trail');
      assert.strictEqual(first.status, 301, 'the first card redirects');

      let second = await page('p/trail2');
      assert.strictEqual(second.status, 200, 'the second card does not');
      assert.true(second.text.includes('Served Second Trail Runner'));
    });
  });
});
