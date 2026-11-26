import { click, settled, waitFor, waitUntil } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import window from 'ember-window-mock';
import { module, test } from 'qunit';

import {
  validateHostRoutes,
  VirtualNetwork,
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
// serves authors at `path`, a redirect to it, and a redirect out of the
// realm.
function routesServingAuthorsAt(path: string): readonly HostRoute[] {
  let rules: RawHostRoutingRule[] = [
    { path, card: './Author/:id' },
    { path: '/writers/:id', redirectTo: path },
    { path: '/elsewhere', redirectTo: 'https://example.com/elsewhere' },
  ];
  let { routes, warnings } = validateHostRoutes(rules, {
    realmURL: new URL(testRealmURL),
    virtualNetwork: new VirtualNetwork(),
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
  // While set, a request for Jane waits for it, so a test can change the
  // stacks while a click's lookup is under way.
  let janeRequestGate: Promise<void> | undefined;
  let serveRoutes = async (request: Request) => {
    if (request.url === `${testRealmURL}Author/jane` && janeRequestGate) {
      await janeRequestGate;
      return null;
    }
    if (request.url === `${testRealmURL}Author/broken`) {
      return new Response('the realm failed', { status: 500 });
    }
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
    let anchor = (event.target as Element).closest('a[href]');
    if (event.defaultPrevented || !anchor) {
      return;
    }
    leftToBrowser.push(anchor.getAttribute('data-test-link') ?? '');
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
          <a
            data-test-link='redirect'
            href='{{this.realm}}writers/jane'
          >Redirect</a>
          <a
            data-test-link='elsewhere'
            href='{{this.realm}}elsewhere'
          >Elsewhere</a>
          <a
            data-test-link='broken'
            href='{{this.realm}}people/broken'
          >Broken</a>
          <a data-test-link='own' href='{{this.realm}}Author/joe'>Joe</a>
          <a data-test-link='file' href='{{this.realm}}Author/joe.json'>Joe's
            file</a>
        </template>
      };
    }

    // Before the realm starts, so that the renders of its own index read the
    // same routes as the app.
    authorsPath = '/people/:id';
    routesReads = 0;
    janeRequestGate = undefined;
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
        'Author/joe.json': {
          data: {
            attributes: { name: 'Joe' },
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

  async function openPost(
    otherStacks: { id: string; format: 'isolated' }[][] = [],
  ) {
    await visitOperatorMode({
      stacks: [
        [{ id: `${testRealmURL}Post/hello`, format: 'isolated' }],
        ...otherStacks,
      ],
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

  test("a link to a card's own URL, which no route serves, opens the card in the stack", async function (assert) {
    await openPost();
    let pageURL = window.location.href;

    await click(link('own'));

    assert
      .dom(
        `[data-test-operator-mode-stack="0"] [data-test-stack-card="${testRealmURL}Author/joe"]`,
      )
      .exists();
    assert.deepEqual(leftToBrowser, [], 'the app took the click');
    assert.strictEqual(window.location.href, pageURL, 'no page load');
  });

  test("a link to a card's file is loaded by the browser", async function (assert) {
    await openPost();
    let href = (document.querySelector(link('file')) as HTMLAnchorElement).href;

    await click(link('file'));

    assert.strictEqual(window.location.href, href);
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
  test('an index that changes no route source does not read the routes again', async function (assert) {
    await openPost();
    let readsBefore = routesReads;

    getService('message-service').relayRealmEvent({
      eventName: 'index',
      indexType: 'incremental',
      invalidations: [`${testRealmURL}Author/jane`],
      realmURL: testRealmURL,
    });
    await settled();

    assert.strictEqual(routesReads, readsBefore);
  });

  test('a click whose stack item closes before its card is known is dropped', async function (assert) {
    await openPost();
    let release!: () => void;
    janeRequestGate = new Promise((resolve) => (release = resolve));

    // Not the test helpers' click, which waits until the app settles, and
    // the app waits for the lookup.
    (document.querySelector(link('routed')) as HTMLElement).click();
    (
      document.querySelector(
        `[data-test-operator-mode-stack="0"] [data-test-close-button]`,
      ) as HTMLElement
    ).click();
    await waitUntil(() => !document.querySelector(post));
    release();
    await settled();

    assert.dom(author).doesNotExist('no card opened for the closed item');
    assert.deepEqual(leftToBrowser, []);
  });

  test('a routed link outside the stacks opens its card in the right-most stack', async function (assert) {
    await openPost([
      [{ id: `${testRealmURL}Author/jane`, format: 'isolated' }],
    ]);
    let pageURL = window.location.href;
    let outside = document.createElement('a');
    outside.setAttribute('data-test-link', 'outside');
    outside.href = `${testRealmURL}people/joe`;
    outside.textContent = 'Joe';
    document.querySelector('#ember-testing')!.append(outside);

    try {
      await click(link('outside'));
    } finally {
      outside.remove();
    }

    assert
      .dom(
        `[data-test-operator-mode-stack="1"] [data-test-stack-card="${testRealmURL}Author/joe"]`,
      )
      .exists();
    assert.deepEqual(leftToBrowser, [], 'the app took the click');
    assert.strictEqual(window.location.href, pageURL, 'no page load');
  });

  test('a redirect inside the realm is followed in the app', async function (assert) {
    await openPost();
    let pageURL = window.location.href;

    await click(link('redirect'));

    assert.dom(`[data-test-operator-mode-stack="0"] ${author}`).exists();
    assert.deepEqual(leftToBrowser, []);
    assert.strictEqual(window.location.href, pageURL, 'no page load');
  });

  test('a redirect out of the realm is loaded by the browser', async function (assert) {
    await openPost();

    await click(link('elsewhere'));

    assert.strictEqual(window.location.href, 'https://example.com/elsewhere');
  });

  test('a failed lookup keeps the app where it is and shows the failure', async function (assert) {
    await openPost();
    let pageURL = window.location.href;

    await click(link('broken'));

    assert.strictEqual(window.location.href, pageURL, 'no page load');
    assert.deepEqual(leftToBrowser, []);
    assert
      .dom(`[data-test-operator-mode-stack="0"] [data-test-card-error]`)
      .exists('the card whose load failed shows its failure');
  });

  module('in code mode', function () {
    async function openPostFile() {
      await visitOperatorMode({
        submode: 'code',
        codePath: `${testRealmURL}Post/hello.json`,
      });
      // The link in the preview has its routed address once the app has
      // read the routes.
      await waitFor(`${link('routed')}[href="${testRealmURL}people/jane"]`);
      await settled();
    }

    test("a click on a routed link in the preview opens its card's file, with no page load", async function (assert) {
      await openPostFile();
      let pageURL = window.location.href;

      await click(link('routed'));

      assert
        .dom('[data-test-card-url-bar-input]')
        .hasValue(`${testRealmURL}Author/jane.json`);
      assert.deepEqual(leftToBrowser, [], 'the app took the click');
      assert.strictEqual(window.location.href, pageURL, 'no page load');
    });

    test("a link to a card's own URL opens the card's file", async function (assert) {
      await openPostFile();
      let pageURL = window.location.href;

      await click(link('own'));

      assert
        .dom('[data-test-card-url-bar-input]')
        .hasValue(`${testRealmURL}Author/joe.json`);
      assert.deepEqual(leftToBrowser, [], 'the app took the click');
      assert.strictEqual(window.location.href, pageURL, 'no page load');
    });

    test('a link to an address that resolves to no card opens in a new tab', async function (assert) {
      await openPostFile();
      let pageURL = window.location.href;
      let opened: string[] = [];
      window.open = ((url?: string | URL) => {
        opened.push(String(url));
        return null;
      }) as typeof window.open;
      let href = (document.querySelector(link('missing')) as HTMLAnchorElement)
        .href;

      await click(link('missing'));

      assert.deepEqual(opened, [href], 'the address opened in a new tab');
      assert.deepEqual(leftToBrowser, [], 'the app took the click');
      assert.strictEqual(window.location.href, pageURL, 'no page load');
      assert
        .dom('[data-test-card-url-bar-input]')
        .hasValue(`${testRealmURL}Post/hello.json`, 'the file stays open');
    });
  });
});
