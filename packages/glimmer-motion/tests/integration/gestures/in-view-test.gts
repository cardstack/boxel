/**
 * whileInView / onViewportEnter / onViewportLeave — Motion's viewport feature over a real IntersectionObserver.
 * Upstream has no unit test for it (its fixture is exercised manually); these pin the feature's contract.
 */
import { render } from '@ember/test-helpers';
import { setupRenderingTest } from 'ember-qunit';
import motion from 'glimmer-motion/motion';
import { setupMotion } from 'glimmer-motion/test-support';
import { motionValue, type Transition } from 'motion-dom';
import { module, test } from 'qunit';

import { sleep } from '../../helpers/motion';

const OFF: Transition = { type: false };
const IN = { opacity: 1 };
const SCROLLER = 'height:200px;overflow:auto;position:relative';
const SPACER = 'height:1000px';
const scroller = () => document.querySelector('#scroller') as HTMLElement;
const waitForObserver = () => sleep(100);

module('Integration | motion | whileInView', function (hooks) {
  setupRenderingTest(hooks);
  setupMotion(hooks);

  test('whileInView applies when the element scrolls into view and unapplies when it leaves', async function (assert) {
    const opacity = motionValue(0);
    const style = { opacity, height: 50 };
    await render(
      <template>
        <div id='scroller' style={{SCROLLER}}><div style={{SPACER}}></div><div
            id='box'
            {{motion whileInView=IN transition=OFF style=style}}
          ></div><div style={{SPACER}}></div></div>
      </template>,
    );
    await waitForObserver();
    assert.strictEqual(opacity.get(), 0, 'out of view');
    scroller().scrollTop = 1000;
    await waitForObserver();
    assert.strictEqual(opacity.get(), 1, 'in view');
    scroller().scrollTop = 0;
    await waitForObserver();
    assert.strictEqual(opacity.get(), 0, 'left view');
  });

  test('onViewportEnter / onViewportLeave fire with the entry', async function (assert) {
    const entered: IntersectionObserverEntry[] = [],
      left: IntersectionObserverEntry[] = [];
    const enter = (e: IntersectionObserverEntry | null) => {
        if (e) {
          entered.push(e);
        }
      },
      leave = (e: IntersectionObserverEntry | null) => {
        if (e) {
          left.push(e);
        }
      };
    await render(
      <template>
        <div id='scroller' style={{SCROLLER}}><div style={{SPACER}}></div><div
            id='box'
            style='height:50px'
            {{motion onViewportEnter=enter onViewportLeave=leave}}
          ></div><div style={{SPACER}}></div></div>
      </template>,
    );
    await waitForObserver();
    scroller().scrollTop = 1000;
    await waitForObserver();
    assert.strictEqual(entered.length, 1);
    assert.true(entered[0]!.isIntersecting);
    scroller().scrollTop = 0;
    await waitForObserver();
    assert.strictEqual(left.length, 1);
    assert.false(left[0]!.isIntersecting);
  });

  test('viewport.once keeps whileInView applied after leaving', async function (assert) {
    const opacity = motionValue(0);
    const style = { opacity, height: 50 };
    const once = { once: true };
    await render(
      <template>
        <div id='scroller' style={{SCROLLER}}><div style={{SPACER}}></div><div
            id='box'
            {{motion whileInView=IN viewport=once transition=OFF style=style}}
          ></div><div style={{SPACER}}></div></div>
      </template>,
    );
    await waitForObserver();
    scroller().scrollTop = 1000;
    await waitForObserver();
    assert.strictEqual(opacity.get(), 1);
    scroller().scrollTop = 0;
    await waitForObserver();
    assert.strictEqual(opacity.get(), 1, 'stays applied');
  });

  test('viewport.amount: "all" requires the whole element to be visible', async function (assert) {
    const opacity = motionValue(0);
    const style = { opacity, height: 100 };
    const all = { amount: 'all' as const };
    await render(
      <template>
        <div id='scroller' style={{SCROLLER}}><div style={{SPACER}}></div><div
            id='box'
            {{motion whileInView=IN viewport=all transition=OFF style=style}}
          ></div><div style={{SPACER}}></div></div>
      </template>,
    );
    await waitForObserver();
    scroller().scrollTop = 850;
    await waitForObserver(); // 50px of the box visible
    assert.strictEqual(opacity.get(), 0, 'partially visible');
    scroller().scrollTop = 950;
    await waitForObserver(); // fully visible
    assert.strictEqual(opacity.get(), 1);
  });
});
