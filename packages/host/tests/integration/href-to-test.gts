import { render, waitUntil } from '@ember/test-helpers';

import { CardDef, contains, field, linksTo } from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import {
  DURING_PRERENDER_HEADER,
  validateHostRoutes,
  type HostRoute,
  type HostRouteTypeInfo,
  type RawHostRoutingRule,
} from '@cardstack/runtime-common';

import ENV from '@cardstack/host/config/environment';

import {
  setupCardLogs,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
  testRRI,
} from '../helpers';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupRenderingTest } from '../helpers/setup';

import type * as HrefToModule from '@cardstack/base/href-to';

class Author extends CardDef {
  @field name = contains(StringField);
}
class Post extends CardDef {
  @field slug = contains(StringField);
  @field author = linksTo(Author);
}

const AUTHOR_KEY = `${testRealmURL}test-cards/Author`;
const POST_KEY = `${testRealmURL}test-cards/Post`;
const contained = { type: 'contains' as const, isPrimitive: true };
const TYPES: Record<string, HostRouteTypeInfo> = {
  Author: {
    key: AUTHOR_KEY,
    types: [AUTHOR_KEY],
    isCardType: true,
    fields: { name: contained },
  },
  Post: {
    key: POST_KEY,
    types: [POST_KEY],
    isCardType: true,
    fields: {
      slug: contained,
      author: { type: 'linksTo', isPrimitive: false, target: AUTHOR_KEY },
    },
  },
};

const RULES: RawHostRoutingRule[] = [
  { path: '/people/:id', name: 'people', card: './Author/:id' },
  {
    path: '/posts/:slug',
    type: { module: testRRI('test-cards'), name: 'Post' },
    match: { slug: ':slug' },
  },
  {
    path: '/by-name/:name',
    type: { module: testRRI('test-cards'), name: 'Author' },
    match: { name: ':name' },
  },
];

function validatedRoutes(): readonly HostRoute[] {
  let { routes, warnings } = validateHostRoutes(RULES, {
    realmURL: new URL(testRealmURL),
    lookupType: (type) => TYPES[type.name],
  });
  let dropped = warnings.filter((w) => w.dropped);
  if (dropped.length > 0) {
    throw new Error(`test routes were dropped: ${JSON.stringify(dropped)}`);
  }
  return routes;
}

// A realm config card with one card id route for authors at `path`.
function realmConfig(path: string) {
  return {
    data: {
      type: 'card',
      attributes: {
        cardInfo: { name: 'Routed Realm' },
        hostRoutingRules: [{ path, name: 'people', card: './Author/:id' }],
      },
      meta: {
        adoptsFrom: {
          module: '@cardstack/base/realm-config',
          name: 'RealmConfig',
        },
      },
    },
  };
}

// The page config the realm server writes for a page served on a host URL.
type PageConfig = { hostDynamicRoutes?: unknown };

module('Integration | hrefTo', function (hooks) {
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });

  let hrefTo: (typeof HrefToModule)['hrefTo'];

  setupCardLogs(
    hooks,
    async () =>
      await getService('loader-service').loader.import(
        '@cardstack/base/card-api',
      ),
  );

  hooks.beforeEach(async function () {
    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'realm.json': realmConfig('/people/:id'),
        'test-cards.gts': { Author, Post },
        'Author/jane.json': {
          data: {
            attributes: { name: 'jane' },
            meta: {
              adoptsFrom: { module: testRRI('test-cards'), name: 'Author' },
            },
          },
        },
        'Post/hello.json': {
          data: {
            attributes: { slug: 'hello-world' },
            relationships: {
              author: { links: { self: '../Author/jane' } },
            },
            meta: {
              adoptsFrom: { module: testRRI('test-cards'), name: 'Post' },
            },
          },
        },
      },
    });
    // The app starts this service at boot; a rendering test has no boot.
    getService('host-route-links');
    ({ hrefTo } = await getService('loader-service').loader.import<
      typeof HrefToModule
    >('@cardstack/base/href-to'));
  });

  hooks.afterEach(function () {
    delete (ENV as PageConfig).hostDynamicRoutes;
  });

  function servePageWithRoutes() {
    (ENV as PageConfig).hostDynamicRoutes = {
      realmURL: testRealmURL,
      routes: validatedRoutes(),
    };
  }

  function href(selector: string): string | null | undefined {
    return document.querySelector(selector)?.getAttribute('href');
  }

  test('a link gets the address the realm routes serve its target at', async function (assert) {
    servePageWithRoutes();
    let store = getService('store');
    let post = (await store.get(`${testRealmURL}Post/hello`)) as Post;
    let author = (await store.get(`${testRealmURL}Author/jane`)) as Author;
    let AuthorType = author.constructor as typeof CardDef;

    await render(
      <template>
        <a data-test-post href={{hrefTo post}}>post</a>
        <a data-test-author href={{hrefTo author}}>author</a>
        <a data-test-author-id href={{hrefTo author.id}}>author id</a>
        <a data-test-type href={{hrefTo AuthorType name='jane'}}>type</a>
        <a data-test-route href={{hrefTo author route='people'}}>route</a>
        <a data-test-no-type href={{hrefTo AuthorType slug='x'}}>no type</a>
        <a data-test-no-route href={{hrefTo author route='team'}}>no route</a>
        <a data-test-empty href={{hrefTo undefined}}>empty</a>
      </template>,
    );

    assert.strictEqual(
      href('[data-test-post]'),
      `${testRealmURL}posts/hello-world`,
      'a card that a field match serves',
    );
    assert.strictEqual(
      href('[data-test-author]'),
      `${testRealmURL}people/jane`,
      'a card that a card id template serves',
    );
    assert.strictEqual(
      href('[data-test-author-id]'),
      `${testRealmURL}people/jane`,
      'a card id',
    );
    assert.strictEqual(
      href('[data-test-type]'),
      `${testRealmURL}by-name/jane`,
      'a card type with field values',
    );
    assert.strictEqual(
      href('[data-test-route]'),
      `${testRealmURL}people/jane`,
      'a route name',
    );
    assert.strictEqual(
      href('[data-test-no-type]'),
      null,
      'no route on the type with these fields: no href',
    );
    assert.strictEqual(
      href('[data-test-no-route]'),
      null,
      'no route with the name: no href',
    );
    assert.strictEqual(href('[data-test-empty]'), null, 'an empty link');
  });

  test('a link given the id of a card that is not loaded loads it through the store', async function (assert) {
    servePageWithRoutes();
    let postId = `${testRealmURL}Post/hello`;

    await render(
      <template>
        <a data-test-post-id href={{hrefTo postId}}>post</a>
      </template>,
    );
    await waitUntil(
      () => href('[data-test-post-id]') === `${testRealmURL}posts/hello-world`,
    );
    assert.strictEqual(
      href('[data-test-post-id]'),
      `${testRealmURL}posts/hello-world`,
      'the link has the address once the card is loaded',
    );
  });

  test('in the app a link keeps the card URL, and the app reads no routes', async function (assert) {
    let store = getService('store');
    let author = (await store.get(`${testRealmURL}Author/jane`)) as Author;
    let AuthorType = author.constructor as typeof CardDef;
    let requests = 0;
    let network = getService('network');
    let spy = async (request: Request) => {
      if (request.url === `${testRealmURL}_host-routes`) {
        requests++;
      }
      return null;
    };
    network.virtualNetwork.mount(spy, { prepend: true });
    try {
      await render(
        <template>
          <a data-test-author href={{hrefTo author}}>author</a>
          <a data-test-author-id href={{hrefTo author.id}}>author id</a>
          <a data-test-type href={{hrefTo AuthorType name='jane'}}>type</a>
          <a data-test-route href={{hrefTo author route='people'}}>route</a>
        </template>,
      );
      await store.loaded();

      assert.strictEqual(
        href('[data-test-author]'),
        `${testRealmURL}Author/jane`,
        'a card that a route of the realm serves keeps its own URL',
      );
      assert.strictEqual(
        href('[data-test-author-id]'),
        `${testRealmURL}Author/jane`,
        'a card id keeps the card URL',
      );
      assert.strictEqual(
        href('[data-test-type]'),
        null,
        'a card type with field values: no href',
      );
      assert.strictEqual(
        href('[data-test-route]'),
        null,
        'a route name: no href',
      );
      assert.strictEqual(requests, 0, 'the realm routes were not asked for');
    } finally {
      network.virtualNetwork.unmount(spy);
    }
  });

  // An HTML visit as the reader sees it: the render flag is up and the
  // visit's realm is named. `routesRequest` answers the request for the
  // realm's routes, or returns null to let the realm answer.
  async function inHTMLVisit(
    routesRequest: (request: Request) => Response | null,
    run: () => Promise<void>,
  ) {
    let globals = globalThis as {
      __boxelRenderContext?: boolean;
      __boxelConsumingRealm?: string;
    };
    let before = {
      context: globals.__boxelRenderContext,
      realm: globals.__boxelConsumingRealm,
    };
    let network = getService('network');
    let handler = async (request: Request) =>
      request.url === `${testRealmURL}_host-routes`
        ? routesRequest(request)
        : null;
    network.virtualNetwork.mount(handler, { prepend: true });
    globals.__boxelRenderContext = true;
    globals.__boxelConsumingRealm = testRealmURL;
    try {
      await run();
    } finally {
      network.virtualNetwork.unmount(handler);
      if (before.context === undefined) {
        delete globals.__boxelRenderContext;
      } else {
        globals.__boxelRenderContext = before.context;
      }
      if (before.realm === undefined) {
        delete globals.__boxelConsumingRealm;
      } else {
        globals.__boxelConsumingRealm = before.realm;
      }
    }
  }

  test('an HTML visit for a realm that no host URL serves keeps card URLs', async function (assert) {
    let links = getService('host-route-links');
    let store = getService('store');
    let author = (await store.get(`${testRealmURL}Author/jane`)) as Author;
    let requests: Request[] = [];

    await inHTMLVisit(
      (request) => {
        requests.push(request);
        // The realm answers: it is not a published realm.
        return null;
      },
      async () => {
        links.routes();
        await getService('render-store').loaded();
        assert.strictEqual(
          links.routes(),
          undefined,
          'the visit has no routes, and no failure',
        );
        assert.strictEqual(
          hrefTo(author),
          `${testRealmURL}Author/jane`,
          'a card that a route of the realm serves keeps its own URL',
        );
        assert.strictEqual(
          hrefTo(author, { route: 'people' }),
          undefined,
          'a route name gives no address',
        );
      },
    );

    assert.strictEqual(requests.length, 1, 'the visit asked the realm once');
  });

  test('an HTML visit for a realm that a host URL serves gets routed addresses', async function (assert) {
    let links = getService('host-route-links');
    let store = getService('store');
    let author = (await store.get(`${testRealmURL}Author/jane`)) as Author;
    let post = (await store.get(`${testRealmURL}Post/hello`)) as Post;
    let requests: Request[] = [];

    await inHTMLVisit(
      (request) => {
        requests.push(request);
        return new Response(
          JSON.stringify({ routes: validatedRoutes(), servedAtHostURL: true }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
      async () => {
        assert.strictEqual(links.routes(), undefined, 'the read is under way');
        await getService('render-store').loaded();
        assert.strictEqual(requests.length, 1, 'the HTML visit read once');
        assert.strictEqual(
          requests[0]?.headers.get(DURING_PRERENDER_HEADER),
          '1',
          'the request says that a render waits on it',
        );
        assert.strictEqual(
          hrefTo(author),
          `${testRealmURL}people/jane`,
          'a card that a card id template serves',
        );
        assert.strictEqual(
          hrefTo(post),
          `${testRealmURL}posts/hello-world`,
          'a card that a field match serves',
        );
        assert.strictEqual(
          hrefTo(author, { route: 'people' }),
          `${testRealmURL}people/jane`,
          'a route name',
        );
        assert.strictEqual(requests.length, 1, 'and did not read again');
      },
    );
  });

  test('an HTML visit fails, and does not ask again, when the routes endpoint fails', async function (assert) {
    let links = getService('host-route-links');
    let requests = 0;

    await inHTMLVisit(
      () => {
        requests++;
        return new Response(
          JSON.stringify({ errors: [{ status: 503, title: 'unavailable' }] }),
          { status: 503 },
        );
      },
      async () => {
        links.routes();
        await getService('render-store').loaded();
        let thrown: { gatewayFailure?: boolean; status?: number } | undefined;
        try {
          links.routes();
        } catch (e) {
          thrown = e as typeof thrown;
        }
        assert.true(
          thrown?.gatewayFailure,
          'a link throws an error that makes the visit run again',
        );
        assert.strictEqual(thrown?.status, 503);
        assert.strictEqual(requests, 1, 'the endpoint was asked once');
      },
    );
  });
});
