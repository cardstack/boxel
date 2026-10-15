/**
 * Moving around the Choreo gallery is the host's: each tile is the demo
 * card's fitted format, so a click opens the demo card in the stack in
 * interact mode and as a stack item of the published site in host mode, and
 * the demo page's pager opens its neighbours the same way.
 */
import { getOwner } from '@ember/owner';
import {
  click,
  currentURL,
  settled,
  visit,
  waitFor,
  waitUntil,
} from '@ember/test-helpers';

import { module, test } from 'qunit';

import HostModeService from '@cardstack/host/services/host-mode-service';

import {
  setupAcceptanceTestRealm,
  setupAuthEndpoints,
  setupLocalIndexing,
  setupOnSave,
  setupUserSubscription,
  testHostModeRealmURL,
  testRealmURL,
  visitOperatorMode,
} from '../helpers';
import { choreoGalleryRealmOf } from '../helpers/choreo-gallery';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';

/** three light demos, in the order the test gallery links them */
const DEMOS = ['keyframes', 'enter', 'stagger'];

const tile = (slug: string) => `[data-gallery-tile="${slug}"] .tile-title`;

/** the element the gallery scrolls in, as the stage-resting code finds it */
function scrollerOf(selector: string): HTMLElement {
  let node = document.querySelector(selector)?.parentElement ?? null;
  while (node) {
    let { overflowY } = getComputedStyle(node);
    if (overflowY === 'auto' || overflowY === 'scroll') {
      return node;
    }
    node = node.parentElement;
  }
  return document.scrollingElement as HTMLElement;
}

module(
  'Acceptance | Choreo gallery | navigation in interact mode',
  function (hooks) {
    setupApplicationTest(hooks);
    setupLocalIndexing(hooks);
    setupOnSave(hooks);

    let mockMatrixUtils = setupMockMatrix(hooks, {
      loggedInAs: '@testuser:localhost',
      activeRealms: [testRealmURL],
    });

    hooks.beforeEach(async function () {
      mockMatrixUtils.createAndJoinRoom({
        sender: '@testuser:localhost',
        name: 'room-test',
      });
      setupUserSubscription();
      setupAuthEndpoints();
      await setupAcceptanceTestRealm({
        mockMatrixUtils,
        contents: choreoGalleryRealmOf(DEMOS),
      });
    });

    const gallery = `${testRealmURL}index`;
    const demo = (slug: string) => `${testRealmURL}demos/${slug}`;
    const stackCard = (stack: number, index: number) =>
      `[data-test-operator-mode-stack="${stack}"] [data-test-stack-card-index="${index}"]`;

    test('a tile opens its demo card in the stack, and closing it returns to the grid', async function (assert) {
      await visitOperatorMode({
        stacks: [[{ id: gallery, format: 'isolated' }]],
      });
      await waitFor(`${stackCard(0, 0)} ${tile('enter')}`);

      await click(`${stackCard(0, 0)} ${tile('enter')}`);
      await waitFor(
        `${stackCard(0, 1)}[data-test-stack-card="${demo('enter')}"]`,
      );
      assert
        .dom(`${stackCard(0, 1)} .demo-head h1`)
        .hasText('Enter', 'the demo card opens over the gallery');

      await click(`${stackCard(0, 1)} [data-test-close-button]`);
      await waitFor(stackCard(0, 1), { count: 0 });
      assert
        .dom(`${stackCard(0, 0)}[data-test-stack-card="${gallery}"]`)
        .exists('the gallery is back on top');
      assert.dom(`${stackCard(0, 0)} ${tile('enter')}`).exists('with its grid');
    });

    test('closing the demo returns to the grid at the place it was left', async function (assert) {
      await visitOperatorMode({
        stacks: [[{ id: gallery, format: 'isolated' }]],
      });
      await waitFor(`${stackCard(0, 0)} ${tile('stagger')}`);
      // down to the tile, so the click lands on what the viewer can see
      let grid = scrollerOf(`${stackCard(0, 0)} [data-gallery-tile]`);
      let scrolled = new Promise((resolve) =>
        grid.addEventListener('scroll', resolve, { once: true }),
      );
      document
        .querySelector(`${stackCard(0, 0)} ${tile('stagger')}`)!
        .scrollIntoView({ block: 'center' });
      await scrolled;
      let left = grid.scrollTop;
      assert.true(left > 0, `the grid is scrolled (${left}px)`);

      await click(`${stackCard(0, 0)} ${tile('stagger')}`);
      await waitFor(`${stackCard(0, 1)} .demo-head h1`);
      await click(`${stackCard(0, 1)} [data-test-close-button]`);
      await waitFor(stackCard(0, 1), { count: 0 });
      await waitUntil(() => grid.scrollTop === left, {
        timeout: 3000,
        timeoutMessage: `the grid stays at ${grid.scrollTop}px`,
      });
      await settled();

      assert.strictEqual(grid.scrollTop, left, 'the grid is where it was left');
    });

    test('with two stacks, a tile opens its demo in its own stack', async function (assert) {
      await visitOperatorMode({
        stacks: [
          [{ id: gallery, format: 'isolated' }],
          [{ id: gallery, format: 'isolated' }],
        ],
      });
      await waitFor(`${stackCard(1, 0)} ${tile('stagger')}`);

      await click(`${stackCard(1, 0)} ${tile('stagger')}`);
      await waitFor(
        `${stackCard(1, 1)}[data-test-stack-card="${demo('stagger')}"]`,
      );
      assert
        .dom(stackCard(0, 1))
        .doesNotExist('the other stack still shows its gallery');

      await click(`${stackCard(1, 1)} [data-test-close-button]`);
      await waitFor(stackCard(1, 1), { count: 0 });
      assert.dom(`${stackCard(1, 0)} ${tile('stagger')}`).exists();
    });

    test('the pager opens the next demo in catalog order', async function (assert) {
      await visitOperatorMode({
        stacks: [[{ id: demo('keyframes'), format: 'isolated' }]],
      });
      await waitFor(`${stackCard(0, 0)} .next-demo`);
      assert
        .dom(`${stackCard(0, 0)} .next-demo b`)
        .hasText('Enter', 'the next demo in the gallery');

      await click(`${stackCard(0, 0)} .next-demo`);
      await waitFor(
        `${stackCard(0, 1)}[data-test-stack-card="${demo('enter')}"]`,
      );
      assert
        .dom(`${stackCard(0, 1)} .pager a`)
        .exists({ count: 2 }, 'the middle demo pages both ways');
    });
  },
);

// a request to a published site: the realm is the page's whole origin
class StubHostModeService extends HostModeService {
  get isActive() {
    return true;
  }

  get hostModeOrigin() {
    return testHostModeRealmURL.replace(/\/test\/?$/, '');
  }
}

module(
  'Acceptance | Choreo gallery | navigation on a published site',
  function (hooks) {
    setupApplicationTest(hooks);
    setupLocalIndexing(hooks);
    setupOnSave(hooks);

    let mockMatrixUtils = setupMockMatrix(hooks, {
      loggedInAs: '@testuser:localhost',
      activeRealms: [testHostModeRealmURL],
    });

    hooks.beforeEach(async function (this) {
      let owner = getOwner(this)! as ReturnType<typeof getOwner> & {
        unregister?: (fullName: string) => void;
      };
      owner.unregister?.('service:host-mode-service');
      owner.register('service:host-mode-service', StubHostModeService);

      mockMatrixUtils.createAndJoinRoom({
        sender: '@testuser:localhost',
        name: 'room-test',
      });
      setupUserSubscription();
      setupAuthEndpoints();
      await setupAcceptanceTestRealm({
        realmURL: testHostModeRealmURL,
        mockMatrixUtils,
        permissions: { '*': ['read'] },
        contents: choreoGalleryRealmOf(DEMOS),
      });
      mockMatrixUtils.setActiveRealms([testHostModeRealmURL]);
    });

    const demo = (slug: string) => `${testHostModeRealmURL}demos/${slug}`;
    const stackItem = (slug: string) =>
      `[data-test-host-mode-stack-item="${demo(slug)}"]`;
    const stackParam = () =>
      new URL(currentURL()!, 'http://localhost').searchParams.get(
        'hostModeStack',
      );

    test('a tile opens its demo with the URL updating, and Back returns to the grid', async function (assert) {
      await visit('/test');
      await waitFor(tile('enter'));

      await click(tile('enter'));
      await waitFor(`${stackItem('enter')} .demo-head h1`);
      assert.dom(`${stackItem('enter')} .demo-head h1`).hasText('Enter');
      assert.strictEqual(
        stackParam(),
        JSON.stringify([demo('enter')]),
        'the URL names the open demo',
      );

      // Back is a transition to the URL before the click: the stack follows it
      await visit('/test');
      await waitFor(stackItem('enter'), { count: 0 });
      assert.strictEqual(stackParam(), null, 'the URL is the gallery again');
      assert.dom(tile('enter')).exists('and the grid is what shows');
    });

    test('Back returns to the grid at the place it was left', async function (assert) {
      await visit('/test');
      await waitFor(tile('stagger'));
      // down to the tile, so the click lands on what the viewer can see
      document
        .querySelector(tile('stagger'))!
        .scrollIntoView({ block: 'center' });
      let left = scrollerOf('[data-gallery-tile]').scrollTop;
      assert.true(left > 0, `the grid is scrolled (${left}px)`);

      await click(tile('stagger'));
      await waitFor(`${stackItem('stagger')} .demo-head h1`);
      await visit('/test');
      await waitFor(stackItem('stagger'), { count: 0 });
      await settled();

      assert.strictEqual(
        scrollerOf('[data-gallery-tile]').scrollTop,
        left,
        'the grid is where it was left',
      );
    });

    test("a demo's URL loads that demo directly, and its pager opens the next", async function (assert) {
      let stack = encodeURIComponent(JSON.stringify([demo('keyframes')]));
      await visit(`/test?hostModeStack=${stack}`);
      await waitFor(`${stackItem('keyframes')} .demo-head h1`);
      assert
        .dom(`${stackItem('keyframes')} .demo-head h1`)
        .hasText('Keyframes');

      await waitFor(`${stackItem('keyframes')} .next-demo`);
      await click(`${stackItem('keyframes')} .next-demo`);
      await waitFor(`${stackItem('enter')} .demo-head h1`);
      assert.strictEqual(
        stackParam(),
        JSON.stringify([demo('keyframes'), demo('enter')]),
        'the next demo stacks over it, in the URL too',
      );
    });
  },
);
