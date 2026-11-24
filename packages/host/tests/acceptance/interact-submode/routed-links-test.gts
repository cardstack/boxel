import { click, settled, waitFor } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import window from 'ember-window-mock';
import { module, test } from 'qunit';

import {
  validateHostRoutes,
  type HostRoute,
  type RawHostRoutingRule,
} from '@cardstack/runtime-common';

import {
  setupAcceptanceTestRealm,
  setupAuthEndpoints,
  setupLocalIndexing,
  setupOnSave,
  setupUserSubscription,
  testRealmURL,
  visitOperatorMode,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupApplicationTest } from '../../helpers/setup';

import type { CardDef as CardDefType } from '@cardstack/base/card-api';
import type * as HrefToModule from '@cardstack/base/href-to';

// The realm's routes, as its routes endpoint answers them: one route that
// serves authors at `path`.
function routesServingAuthorsAt(path: string): readonly HostRoute[] {
  let rules: RawHostRoutingRule[] = [{ path, card: './Author/:id' }];
  let { routes, warnings } = validateHostRoutes(rules, {
    realmURL: new URL(testRealmURL),
    lookupType: () => undefined,
  });
  if (warnings.some((w) => w.dropped)) {
    throw new Error(`test routes were dropped: ${JSON.stringify(warnings)}`);
  }
  return routes;
}

module('Acceptance | interact submode | routed links', function (hooks) {
  // The `hrefTo` helper of the loader the app renders with, which the
  // post's link calls.
  let linkHrefTo: (typeof HrefToModule)['hrefTo'] | undefined;
  // The path the realm's routes endpoint serves authors at. The endpoint is
  // answered here, so a test controls what the app reads, and when.
  let authorsPath: string;
  let routesReads: number;
  let serveRoutes = async (request: Request) => {
    if (request.url !== `${testRealmURL}_host-routes`) {
      return null;
    }
    routesReads++;
    return new Response(
      JSON.stringify({ routes: routesServingAuthorsAt(authorsPath) }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };

  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupOnSave(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
  });

  // A click the app does not take over would load another page in the
  // test's own tab, so a listener that runs after the app's records each
  // such click and stops it there.
  let leftToBrowser: string[];
  let stopNavigation = (event: MouseEvent) => {
    if (event.defaultPrevented) {
      return;
    }
    let anchor = (event.target as Element).closest('[data-test-link]');
    leftToBrowser.push(anchor?.getAttribute('data-test-link') ?? '');
    event.preventDefault();
  };
  let link = (name: string) => `[data-test-link="${name}"]`;
  let post = `[data-test-stack-card="${testRealmURL}Post/hello"]`;
  let author = `[data-test-stack-card="${testRealmURL}Author/jane"]`;

  hooks.beforeEach(async function () {
    mockMatrixUtils.createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'room-test',
    });
    setupUserSubscription();
    setupAuthEndpoints();

    let loader = getService('loader-service').loader;
    let cardApi: typeof import('@cardstack/base/card-api') =
      await loader.import('@cardstack/base/card-api');
    let string: typeof import('@cardstack/base/string') = await loader.import(
      '@cardstack/base/string',
    );
    ({ hrefTo: linkHrefTo } = await loader.import<typeof HrefToModule>(
      '@cardstack/base/href-to',
    ));
    let { field, contains, linksTo, CardDef, Component } = cardApi;
    let { default: StringField } = string;

    class Author extends CardDef {
      static displayName = 'Author';
      @field name = contains(StringField);
      @field cardTitle = contains(StringField, {
        computeVia: function (this: Author) {
          return this.name;
        },
      });
    }
    class Post extends CardDef {
      static displayName = 'Post';
      @field author = linksTo(Author);

      static isolated = class Isolated extends Component<typeof this> {
        realm = testRealmURL;
        routedHref = (card: CardDefType | null | undefined) =>
          linkHrefTo?.(card);

        <template>
          <a
            data-test-link='routed'
            href={{this.routedHref @model.author}}
          >Author</a>
          <a
            data-test-link='missing'
            href='{{this.realm}}people/nobody'
          >Missing</a>
        </template>
      };
    }

    // Before the realm starts, so that the renders of its own index read the
    // same routes as the app.
    authorsPath = '/people/:id';
    routesReads = 0;
    getService('network').virtualNetwork.mount(serveRoutes, { prepend: true });

    await setupAcceptanceTestRealm({
      mockMatrixUtils,
      contents: {
        'blog.gts': { Author, Post },
        'Author/jane.json': {
          data: {
            attributes: { name: 'Jane' },
            meta: { adoptsFrom: { module: '../blog', name: 'Author' } },
          },
        },
        'Post/hello.json': {
          data: {
            relationships: {
              author: { links: { self: '../Author/jane' } },
            },
            meta: { adoptsFrom: { module: '../blog', name: 'Post' } },
          },
        },
      },
    });

    leftToBrowser = [];
    globalThis.addEventListener('click', stopNavigation);
  });

  hooks.afterEach(function () {
    globalThis.removeEventListener('click', stopNavigation);
    getService('network').virtualNetwork.unmount(serveRoutes);
    linkHrefTo = undefined;
  });

  async function openPost() {
    await visitOperatorMode({
      stacks: [[{ id: `${testRealmURL}Post/hello`, format: 'isolated' }]],
    });
    // The link has its routed address once the app has read the routes.
    await waitFor(`${link('routed')}[href="${testRealmURL}people/jane"]`);
    await settled();
  }

  test('a click on a routed link opens its card in the stack, with no page load', async function (assert) {
    await openPost();
    let pageURL = window.location.href;

    await click(link('routed'));

    assert
      .dom(`[data-test-operator-mode-stack="0"] ${author}`)
      .exists('the card the address resolves to is on the stack');
    assert.dom(`[data-test-operator-mode-stack="0"] ${post}`).exists();
    assert.dom('[data-test-operator-mode-stack]').exists({ count: 1 });
    assert.deepEqual(leftToBrowser, [], 'the app took the click');
    assert.strictEqual(window.location.href, pageURL, 'no page load');
  });

  test('a click with a modifier key is left to the browser', async function (assert) {
    await openPost();

    await click(link('routed'), { metaKey: true });

    assert.deepEqual(leftToBrowser, ['routed']);
    assert.dom(author).doesNotExist();
  });

  test('a link to an address that resolves to no card is loaded by the browser', async function (assert) {
    await openPost();
    let href = (document.querySelector(link('missing')) as HTMLAnchorElement)
      .href;

    await click(link('missing'));

    assert.strictEqual(
      window.location.href,
      href,
      'the browser was sent to the address',
    );
    assert.dom(author).doesNotExist();
  });

  test('a change to the routes reaches the app after the realm is indexed', async function (assert) {
    await openPost();
    let readsBefore = routesReads;

    authorsPath = '/authors/:id';
    getService('message-service').relayRealmEvent({
      eventName: 'index',
      indexType: 'incremental',
      invalidations: [`${testRealmURL}realm`],
      realmURL: testRealmURL,
    });

    await waitFor(`${link('routed')}[href="${testRealmURL}authors/jane"]`);
    await settled();
    await click(link('routed'));

    assert.strictEqual(
      routesReads,
      readsBefore + 1,
      'the app read the routes again after the index',
    );
    assert.dom(`[data-test-operator-mode-stack="0"] ${author}`).exists();
    assert.deepEqual(leftToBrowser, []);
  });
});
