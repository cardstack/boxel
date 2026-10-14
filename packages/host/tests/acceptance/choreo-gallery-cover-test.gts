/**
 * A demo card opened from the Choreo gallery covers the gallery without
 * unmounting it: the stack item below in interact mode, the primary card
 * under the stack on a published site. The grid's stages rest while they
 * are covered — no loop runs, no endless animation plays — and carry on
 * from where they were when the demo closes.
 */
import { getOwner } from '@ember/owner';
import { click, find, visit, waitFor, waitUntil } from '@ember/test-helpers';

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
 * Crossing first, so its tile is in view: its tape scrolls itself every
 * frame for as long as the stage is on, which makes the loop observable.
 */
const DEMOS = ['crossing', 'keyframes', 'enter'];

const stageOf = (slug: string) => `[data-gallery-tile="${slug}"] .tile-stage`;

const resting = (stage: Element) => stage.classList.contains('is-resting');

const runningIn = (stage: Element) =>
  stage
    .getAnimations({ subtree: true })
    .filter((animation) => animation.playState === 'running').length;

/** painted frames, counted: a stopped loop is one that misses them */
const frames = (count: number) =>
  new Promise<void>((resolve) => {
    let left = count;
    let step = () =>
      // eslint-disable-next-line @cardstack/boxel/no-raf-for-state -- counting painted frames is the point
      --left <= 0 ? resolve() : requestAnimationFrame(step);
    // eslint-disable-next-line @cardstack/boxel/no-raf-for-state -- counting painted frames is the point
    requestAnimationFrame(step);
  });

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

      await click(`${stackCard(0)} [data-gallery-tile="enter"] .tile-title`);
      await waitFor(
        `${stackCard(1)}[data-test-stack-card="${demo('enter')}"] .demo-head h1`,
      );
      await waitUntil(() => resting(stage));
      assert.strictEqual(
        find(`${stackCard(0)} ${stageOf('crossing')}`),
        stage,
        'the covered stage is the one that was running, still mounted',
      );
      await frames(2);
      assert.strictEqual(runningIn(stage), 0, 'nothing in it plays');

      await click(`${stackCard(1)} [data-test-close-button]`);
      await waitFor(stackCard(1), { count: 0 });
      await waitUntil(() => !resting(stage));
      assert.strictEqual(
        find(`${stackCard(0)} ${stageOf('crossing')}`),
        stage,
        'the same stage wakes, rather than a new one starting over',
      );
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
      let tape = stage.querySelector<HTMLElement>('[data-test-scroll]')!;
      await waitUntil(() => !resting(stage) && tape.scrollTop > 0);

      await click('[data-gallery-tile="enter"] .tile-title');
      await waitFor(`${stackItem('enter')} .demo-head h1`);
      assert
        .dom('.current-card')
        .hasAttribute('inert', '', 'the gallery under the stack is inert');
      await waitUntil(() => resting(stage));
      await frames(2);
      assert.strictEqual(runningIn(stage), 0, 'nothing in the stage plays');
      let held = tape.scrollTop;
      await frames(10);
      assert.strictEqual(
        tape.scrollTop,
        held,
        'the stage’s own loop is stopped: its tape holds its line',
      );

      await click('[data-test-host-stack-item-close-button]');
      await waitFor(stackItem('enter'), { count: 0 });
      assert
        .dom('.current-card')
        .doesNotHaveAttribute('inert', 'the gallery is live again');
      await waitUntil(() => !resting(stage));
      await waitUntil(() => tape.scrollTop !== held);
      assert.strictEqual(
        find(stageOf('crossing')),
        stage,
        'the same stage carries on',
      );
    });
  });
});
