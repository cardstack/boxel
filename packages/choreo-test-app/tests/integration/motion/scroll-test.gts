/**
 * useInView: port of Motion's packages/framer-motion/src/utils/__tests__/use-in-view.test.tsx (motion@bbabb00),
 * with a real IntersectionObserver (a scrolling container) instead of the mocked observer.
 * useScroll: a contract test over the vendored scroll() — upstream's use-scroll.test only covers the
 * ScrollTimeline `accelerate` hint, which these helpers don't set (scroll() with a callback is used).
 */
import { render } from '@ember/test-helpers';
import { setupRenderingTest } from 'ember-qunit';
import { useInView, useScroll } from 'glimmer-motion/scroll';
import { module, test } from 'qunit';

import { nextFrame, sleep } from '../../helpers/motion';

const SCROLLER = 'height:200px;overflow:auto;position:relative';
const SPACER = 'height:1000px';
const scroller = () => document.querySelector('#scroller') as HTMLElement;
const settleObserver = () => sleep(100);

module('Integration | motion | useInView', function (hooks) {
  setupRenderingTest(hooks);

  test('Returns false on mount', async function (assert) {
    const v = useInView();
    await render(
      <template>
        <div id="scroller" style={{SCROLLER}}><div style={{SPACER}}></div><div
            style="height:50px"
            {{v.observe}}
          ></div></div>
      </template>
    );
    await settleObserver();
    assert.false(v.isInView);
  });

  test('Can change initial value', async function (assert) {
    const v = useInView({ initial: true });
    assert.true(v.isInView);
  });

  test('Returns true when element enters the viewport', async function (assert) {
    const v = useInView();
    const results: boolean[] = [v.isInView];
    await render(
      <template>
        <div id="scroller" style={{SCROLLER}}><div style={{SPACER}}></div><div
            style="height:50px"
            {{v.observe}}
          ></div></div>
      </template>
    );
    await settleObserver();
    scroller().scrollTop = 1000;
    await settleObserver();
    results.push(v.isInView);
    assert.deepEqual(results, [false, true]);
  });

  test('Returns false when element leaves the viewport', async function (assert) {
    const v = useInView();
    const results: boolean[] = [v.isInView];
    await render(
      <template>
        <div id="scroller" style={{SCROLLER}}><div style={{SPACER}}></div><div
            style="height:50px"
            {{v.observe}}
          ></div></div>
      </template>
    );
    await settleObserver();
    for (const top of [1000, 0, 1000, 0]) {
      scroller().scrollTop = top;
      await settleObserver();
      results.push(v.isInView);
    }
    assert.deepEqual(results, [false, true, false, true, false]);
  });

  test('Only triggers true once, if once is set', async function (assert) {
    const v = useInView({ once: true });
    const results: boolean[] = [v.isInView];
    await render(
      <template>
        <div id="scroller" style={{SCROLLER}}><div style={{SPACER}}></div><div
            style="height:50px"
            {{v.observe}}
          ></div></div>
      </template>
    );
    await settleObserver();
    for (const top of [1000, 0, 1000, 0]) {
      scroller().scrollTop = top;
      await settleObserver();
      if (results[results.length - 1] !== v.isInView) {
        results.push(v.isInView);
      }
    }
    assert.deepEqual(results, [false, true]);
  });
});

module('Integration | motion | useScroll', function (hooks) {
  setupRenderingTest(hooks);

  test('tracks a container: scrollY and scrollYProgress', async function (assert) {
    const s = useScroll();
    await render(
      <template>
        <div id="scroller" style={{SCROLLER}} {{s.container}}><div
            style="height:1200px"
          ></div></div>
      </template>
    );
    await nextFrame();
    assert.strictEqual(s.scrollY.get(), 0);
    assert.strictEqual(s.scrollYProgress.get(), 0);
    scroller().scrollTop = 500;
    await nextFrame();
    await nextFrame();
    assert.strictEqual(s.scrollY.get(), 500);
    assert.true(
      Math.abs(s.scrollYProgress.get() - 0.5) < 0.01,
      `progress ${s.scrollYProgress.get()}`
    );
    scroller().scrollTop = 1000;
    await nextFrame();
    await nextFrame();
    assert.strictEqual(s.scrollYProgress.get(), 1);
  });

  test('tracks a target within the container with an offset', async function (assert) {
    const s = useScroll({ offset: ['start end', 'end start'] });
    await render(
      <template>
        <div id="scroller" style={{SCROLLER}} {{s.container}}><div
            style="height:400px"
          ></div><div id="target" style="height:100px" {{s.target}}></div><div
            style="height:400px"
          ></div></div>
      </template>
    );
    await nextFrame();
    assert.strictEqual(
      s.scrollYProgress.get(),
      0,
      'target below the container'
    );
    scroller().scrollTop = 350;
    await nextFrame();
    await nextFrame(); // 'start end' → 'end start' spans scrollTop 200..500
    assert.true(
      Math.abs(s.scrollYProgress.get() - 0.5) < 0.01,
      `progress ${s.scrollYProgress.get()}`
    );
    scroller().scrollTop = 600;
    await nextFrame();
    await nextFrame();
    assert.strictEqual(s.scrollYProgress.get(), 1);
  });

  test('stops tracking when the modifier is torn down', async function (assert) {
    const s = useScroll();
    await render(
      <template>
        <div id="scroller" style={{SCROLLER}} {{s.container}}><div
            style="height:1200px"
          ></div></div>
      </template>
    );
    scroller().scrollTop = 500;
    await nextFrame();
    await nextFrame();
    assert.strictEqual(s.scrollY.get(), 500);
    await render(
      <template>
        <div id="scroller" style={{SCROLLER}}><div
            style="height:1200px"
          ></div></div>
      </template>
    );
    scroller().scrollTop = 100;
    await nextFrame();
    await nextFrame();
    assert.strictEqual(s.scrollY.get(), 500, 'no longer updated');
  });
});
