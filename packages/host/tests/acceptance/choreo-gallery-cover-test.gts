/**
 * A demo card opened from the Choreo gallery covers the gallery without
 * unmounting it: the stack item below in interact mode, the primary card
 * under the stack on a published site. The grid's stages rest while they
 * are covered — no loop runs, no endless animation plays — and carry on
 * from where they were when the demo closes.
 */
import { getOwner } from '@ember/owner';
import {
  click,
  find,
  findAll,
  triggerEvent,
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

/**
 * Crossing first, so its tile is in view: its tape scrolls itself in a frame
 * loop for as long as the stage is on. Circle loop's score repeats forever,
 * so nothing but resting stops it.
 */
const DEMOS = ['crossing', 'circle-loop', 'keyframes', 'enter'];

/** the module that runs the tape's loop */
const TAPE = '/lib/xstress-live';

const stageOf = (slug: string) => `[data-gallery-tile="${slug}"] .tile-stage`;

const resting = (stage: Element) => stage.classList.contains('is-resting');

/** animations playing in any tile's stage */
const runningInStages = () =>
  findAll('.tile-stage')
    .flatMap((stage) => stage.getAnimations({ subtree: true }))
    .filter((animation) => animation.playState === 'running').length;

/**
 * Waits for every tile's stage to stop playing. A resting stage pauses what
 * it finds at once, and looks again within a second for effects a score
 * starts by script, so a tile whose score passes as the page opens over it
 * rests a moment later than the rest.
 */
const stagesSettled = () =>
  waitUntil(() => runningInStages() === 0, { timeout: 2500 }).catch(
    () => undefined,
  );

/**
 * A click on a tile's title as a pointer makes it. The `click` helper also
 * focuses the link first, and focusing a link scrolls it into view, which in
 * the test's small container scrolls the tile being watched out of it.
 */
const openTile = (scope: string, slug: string) =>
  triggerEvent(`${scope}[data-gallery-tile="${slug}"] .tile-title`, 'click');

const frames = (count: number) =>
  new Promise<void>((resolve) => {
    let left = count;
    let step = () =>
      // eslint-disable-next-line @cardstack/boxel/no-raf-for-state -- counting painted frames is the point
      --left <= 0 ? resolve() : requestAnimationFrame(step);
    // eslint-disable-next-line @cardstack/boxel/no-raf-for-state -- counting painted frames is the point
    requestAnimationFrame(step);
  });

/**
 * How many frames a module's code asks for over a run of painted frames. A
 * running loop asks for every one; a stopped loop asks for none. (The tape's
 * own position is no measure: it moves under a pixel a frame, and at a device
 * pixel ratio of 1 the browser rounds that back to where it was.)
 */
async function framesAskedBy(module: string, count = 10) {
  let asked = 0;
  let original = window.requestAnimationFrame;
  window.requestAnimationFrame = (callback) => {
    if (new Error().stack?.includes(module)) {
      asked++;
    }
    return original.call(window, callback);
  };
  try {
    await frames(count);
  } finally {
    window.requestAnimationFrame = original;
  }
  return asked;
}

module('Acceptance | Choreo gallery | covered by a demo', function () {
  module('in interact mode', function (hooks) {
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
    const stackCard = (index: number) =>
      `[data-test-operator-mode-stack="0"] [data-test-stack-card-index="${index}"]`;

    test('the grid’s stages rest under the demo, mounted, and wake when it closes', async function (assert) {
      await visitOperatorMode({
        stacks: [[{ id: gallery, format: 'isolated' }]],
      });
      await waitFor(`${stackCard(0)} ${stageOf('crossing')}`);
      let stage = find(`${stackCard(0)} ${stageOf('crossing')}`)!;
      await waitUntil(() => !resting(stage));
      assert.true((await framesAskedBy(TAPE)) > 0, 'the tape runs in view');

      await openTile(`${stackCard(0)} `, 'enter');
      await waitFor(
        `${stackCard(1)}[data-test-stack-card="${demo('enter')}"] .demo-head h1`,
      );
      await waitUntil(() => resting(stage));
      assert.strictEqual(
        find(`${stackCard(0)} ${stageOf('crossing')}`),
        stage,
        'the covered stage is the one that was running, still mounted',
      );
      await stagesSettled();
      assert.strictEqual(
        runningInStages(),
        0,
        'nothing in any tile’s stage plays',
      );
      assert.strictEqual(
        await framesAskedBy(TAPE),
        0,
        'and its own loop asks for no frames',
      );

      await click(`${stackCard(1)} [data-test-close-button]`);
      await waitFor(stackCard(1), { count: 0 });
      await waitUntil(() => !resting(stage));
      assert.strictEqual(
        find(`${stackCard(0)} ${stageOf('crossing')}`),
        stage,
        'the same stage wakes, rather than a new one starting over',
      );
      assert.true((await framesAskedBy(TAPE)) > 0, 'its tape runs again');
    });
  });

  // a request to a published site: the realm is the page's whole origin
  class StubHostModeService extends HostModeService {
    get isActive() {
      return true;
    }

    get hostModeOrigin() {
      return testHostModeRealmURL.replace(/\/test\/?$/, '');
    }
  }

  module('on a published site', function (hooks) {
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

    const stackItem = (slug: string) =>
      `[data-test-host-mode-stack-item="${testHostModeRealmURL}demos/${slug}"]`;

    test('the grid’s stages rest under the stack, and carry on when it closes', async function (assert) {
      await visit('/test');
      await waitFor(stageOf('crossing'));
      let stage = find(stageOf('crossing'))!;
      await waitUntil(() => !resting(stage));
      assert.true((await framesAskedBy(TAPE)) > 0, 'the tape runs in view');

      await openTile('', 'enter');
      await waitFor(`${stackItem('enter')} .demo-head h1`);
      assert
        .dom('.current-card')
        .hasAttribute('inert', '', 'the gallery under the stack is inert');
      await waitUntil(() => resting(stage));
      await stagesSettled();
      assert.strictEqual(
        runningInStages(),
        0,
        'nothing in any tile’s stage plays',
      );
      assert.strictEqual(
        await framesAskedBy(TAPE),
        0,
        'and its own loop asks for no frames',
      );

      await click('[data-test-host-stack-item-close-button]');
      await waitFor(stackItem('enter'), { count: 0 });
      assert
        .dom('.current-card')
        .doesNotHaveAttribute('inert', 'the gallery is live again');
      await waitUntil(() => !resting(stage));
      assert.strictEqual(
        find(stageOf('crossing')),
        stage,
        'the same stage carries on',
      );
      assert.true((await framesAskedBy(TAPE)) > 0, 'its tape runs again');
    });
  });
});
