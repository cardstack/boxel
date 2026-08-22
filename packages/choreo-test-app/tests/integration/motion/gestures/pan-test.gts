/**
 * Port of Motion's packages/framer-motion/src/gestures/__tests__/pan.test.tsx (motion@bbabb00).
 * MockDrag's pointer is the Cypress-style trigger() on a real element; React state becomes a tracked property.
 */
import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';
import { render } from '@ember/test-helpers';
import motion from 'glimmer-motion/motion';
import { nextFrame, spy } from '../../../helpers/motion';
import { trigger } from '../../../helpers/layout-fixture';

const BOX = { width: 100, height: 100, background: 'red' };
const el = () => document.querySelector('#el')!;

module('Integration | motion | pan', function (hooks) {
  setupRenderingTest(hooks);

  test("pan handlers aren't frozen at pan session start", async function (assert) {
    let count = 0, increment = 0;
    const done = new Promise<void>((resolve) => { (window as any).__panEnd = resolve; });
    const onPanStart = () => { count += increment; increment = 2; };
    const onPan = () => { count += increment; };
    const onPanEnd = () => { count += increment; (window as any).__panEnd(); };
    await render(<template><div id="el" {{motion onPanStart=onPanStart onPan=onPan onPanEnd=onPanEnd style=BOX}}></div></template>);
    trigger(el(), 'pointerdown', 10, 10); trigger(el(), 'pointermove', 110, 110); await nextFrame();
    trigger(el(), 'pointermove', 60, 60); await nextFrame();
    trigger(el(), 'pointerup'); await done;
    assert.true(count > 0, `count ${count}`);
  });

  test('onPanStart fires before onPan', async function (assert) {
    const events: string[] = [];
    const done = new Promise<void>((resolve) => { (window as any).__panEnd = resolve; });
    const onPanStart = () => events.push('start');
    const onPan = () => events.push('pan');
    const onPanEnd = () => { events.push('end'); (window as any).__panEnd(); };
    await render(<template><div id="el" {{motion onPanStart=onPanStart onPan=onPan onPanEnd=onPanEnd style=BOX}}></div></template>);
    trigger(el(), 'pointerdown', 10, 10); trigger(el(), 'pointermove', 110, 110); await nextFrame();
    trigger(el(), 'pointerup'); await done;
    const startIndex = events.indexOf('start'), firstPanIndex = events.indexOf('pan');
    assert.true(startIndex >= 0); assert.true(firstPanIndex >= 0); assert.true(startIndex < firstPanIndex);
  });

  test("onPanEnd doesn't fire unless onPanStart has", async function (assert) {
    const onPanStart = spy(), onPanEnd = spy();
    await render(<template><div id="el" {{motion onPanStart=onPanStart onPanEnd=onPanEnd style=BOX}}></div></template>);
    trigger(el(), 'pointerdown', 10, 10); trigger(el(), 'pointermove', 11, 11); await nextFrame();
    trigger(el(), 'pointerup'); await nextFrame();
    assert.strictEqual(onPanStart.calls.length, 0); assert.strictEqual(onPanEnd.calls.length, 0);
  });
});
