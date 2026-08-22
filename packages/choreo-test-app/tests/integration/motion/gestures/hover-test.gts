/**
 * Port of Motion's packages/framer-motion/src/gestures/__tests__/hover.test.tsx (motion@bbabb00).
 * jest.setup's pointerEnter/pointerLeave become real PointerEvents with the same init.
 */
import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';
import { render } from '@ember/test-helpers';
import { motionValue, isDragging, frame, type Transition, type Variants } from 'motion-dom';
import motion from 'glimmer-motion/motion';
import { nextFrame, sleep, spy, pointerEnter, pointerLeave, pointerDown, pointerUp } from '../../../helpers/motion';

const OFF: Transition = { type: false };
const el = () => document.querySelector('#el')!;

module('Integration | motion | hover', function (hooks) {
  setupRenderingTest(hooks);

  test('hover event listeners fire', async function (assert) {
    const hoverIn = spy(), hoverOut = spy();
    await render(<template><div id="el" {{motion onHoverStart=hoverIn onHoverEnd=hoverOut}}></div></template>);
    pointerEnter(el()); pointerLeave(el());
    await nextFrame();
    assert.strictEqual(hoverIn.calls.length, 1);
    assert.strictEqual(hoverOut.calls.length, 1);
  });

  test('filters touch events', async function (assert) {
    const hoverIn = spy(), hoverOut = spy();
    await render(<template><div id="el" {{motion onHoverStart=hoverIn onHoverEnd=hoverOut}}></div></template>);
    pointerEnter(el(), { pointerType: 'touch' }); pointerLeave(el(), { pointerType: 'touch' });
    await nextFrame();
    assert.strictEqual(hoverIn.calls.length, 0);
    assert.strictEqual(hoverOut.calls.length, 0);
  });

  test('whileHover applied', async function (assert) {
    const opacity = motionValue(1); const style = { opacity }; const H = { opacity: 0 };
    await render(<template><div id="el" {{motion whileHover=H transition=OFF style=style}}></div></template>);
    pointerEnter(el()); await nextFrame();
    assert.strictEqual(opacity.get(), 0);
  });

  test('whileHover applied as variant', async function (assert) {
    const target = 0.5; const variants = { hidden: { opacity: target } };
    const opacity = motionValue(1); const style = { opacity };
    await render(<template><div id="el" {{motion whileHover="hidden" variants=variants transition=OFF style=style}}></div></template>);
    pointerEnter(el()); await nextFrame();
    assert.strictEqual(opacity.get(), target);
  });

  test('whileHover propagates to children', async function (assert) {
    const target = 0.2; const parent = { hidden: { opacity: 0.8 } }; const child = { hidden: { opacity: target } };
    const opacity = motionValue(1); const style = { opacity };
    await render(<template><div id="el" {{motion whileHover="hidden" variants=parent transition=OFF}}><div {{motion variants=child style=style transition=OFF}}></div></div></template>);
    pointerEnter(el()); await nextFrame();
    assert.strictEqual(opacity.get(), target);
  });

  test('whileHover is unapplied when hover ends', async function (assert) {
    const variants = { hidden: { opacity: 0.5, transitionEnd: { opacity: 0.75 } } };
    const opacity = motionValue(1); const style = { opacity };
    let hasMousedOut = false;
    const result = new Promise<number>((resolve) => {
      const onComplete = () => { frame.postRender(() => { if (hasMousedOut) resolve(opacity.get()); }); };
      render(<template><div id="el" {{motion whileHover="hidden" variants=variants transition=OFF style=style onAnimationComplete=onComplete}}></div></template>).then(async () => {
        pointerEnter(el()); await nextFrame();
        setTimeout(() => { hasMousedOut = true; pointerLeave(el()); }, 10);
      });
    });
    assert.strictEqual(await result, 1);
  });

  test('Correctly uses transition applied to initial', async function (assert) {
    const variants: Variants = { initial: { opacity: 0.9, transition: { type: false } }, hidden: { opacity: 0.5, transition: { type: false }, transitionEnd: { opacity: 0.75 } } };
    const opacity = motionValue(0.9); const style = { opacity };
    let hasMousedOut = false;
    const result = new Promise<number>((resolve) => {
      const onComplete = () => { frame.postRender(() => { if (hasMousedOut) resolve(opacity.get()); }); };
      render(<template><div id="el" {{motion whileHover="hidden" variants=variants style=style onAnimationComplete=onComplete}}></div></template>).then(async () => {
        pointerEnter(el()); await nextFrame();
        setTimeout(() => { hasMousedOut = true; pointerLeave(el()); }, 10);
      });
    });
    assert.strictEqual(await result, 0.9);
  });

  test('whileHover is unapplied after drag ends when pointer left element during drag', async function (assert) {
    const opacity = motionValue(1); const style = { opacity }; const H = { opacity: 0.5 };
    await render(<template><div id="el" {{motion whileHover=H transition=OFF style=style}}></div></template>);
    pointerEnter(el()); await nextFrame();
    assert.strictEqual(opacity.get(), 0.5);
    pointerDown(el()); isDragging.x = true;
    pointerLeave(el()); await nextFrame(); // pointerLeave during drag is deferred
    assert.strictEqual(opacity.get(), 0.5);
    isDragging.x = false; pointerUp(el()); await nextFrame();
    assert.strictEqual(opacity.get(), 1);
  });

  test('whileHover remains active when pointer is over element after drag ends', async function (assert) {
    const opacity = motionValue(1); const style = { opacity }; const H = { opacity: 0.5 };
    await render(<template><div id="el" {{motion whileHover=H transition=OFF style=style}}></div></template>);
    pointerEnter(el()); await nextFrame();
    assert.strictEqual(opacity.get(), 0.5);
    pointerDown(el()); isDragging.x = true;
    isDragging.x = false; pointerUp(el()); await nextFrame();
    assert.strictEqual(opacity.get(), 0.5);
  });

  test('whileHover stays active during press and deactivates on release outside element', async function (assert) {
    const opacity = motionValue(1); const style = { opacity }; const H = { opacity: 0.5 };
    await render(<template><div id="el" {{motion whileHover=H transition=OFF style=style}}></div></template>);
    pointerEnter(el()); await nextFrame();
    assert.strictEqual(opacity.get(), 0.5);
    pointerDown(el()); pointerLeave(el()); await nextFrame();
    assert.strictEqual(opacity.get(), 0.5, 'hover stays active while pressed');
    pointerUp(el()); await nextFrame();
    assert.strictEqual(opacity.get(), 1);
  });

  test('whileHover stays active during press when pointer leaves before drag starts', async function (assert) {
    const opacity = motionValue(1); const style = { opacity }; const H = { opacity: 0.5 };
    await render(<template><div id="el" {{motion drag=true whileHover=H transition=OFF style=style}}></div></template>);
    pointerEnter(el()); await nextFrame();
    assert.strictEqual(opacity.get(), 0.5);
    pointerDown(el()); pointerLeave(el()); await nextFrame();
    assert.strictEqual(opacity.get(), 0.5);
    pointerUp(el()); await nextFrame();
    assert.strictEqual(opacity.get(), 1);
  });

  test("whileHover only animates values that aren't being controlled by a higher-priority gesture", async function (assert) {
    const variants = { hovering: { opacity: 0.5, scale: 0.5 }, tapping: { scale: 2 } };
    const opacity = motionValue(1), scale = motionValue(1); const style = { opacity, scale };
    await render(<template><div id="el" {{motion whileHover="hovering" whileTap="tapping" variants=variants transition=OFF style=style}}></div></template>);
    await nextFrame(); pointerDown(el()); await nextFrame(); pointerEnter(el()); await nextFrame();
    assert.deepEqual([opacity.get(), scale.get()], [0.5, 2]);
    pointerUp(el());
  });
});

void sleep;
