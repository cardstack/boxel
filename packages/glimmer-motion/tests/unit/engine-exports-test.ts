/**
 * glimmer-motion's curated re-exports of the engine.
 *
 * Realm cards reach motion-dom only through these names, so the contract is
 * identity: each is the engine's own function, sharing the one frame loop with
 * `{{motion}}`, not a copy or a wrapper.
 */
import {
  animate,
  frame,
  type MotionValue,
  motionValue,
  styleEffect,
  transformValue,
} from 'glimmer-motion';
import { animate as motionAnimate } from 'motion';
import * as engine from 'motion-dom';
import { module, test } from 'qunit';

const nextRender = () =>
  new Promise<void>((resolve) => frame.render(() => resolve()));

module('Unit | glimmer-motion engine exports', function () {
  test('each export is the engine’s own function', function (assert) {
    assert.strictEqual(motionValue, engine.motionValue, 'motionValue');
    assert.strictEqual(transformValue, engine.transformValue, 'transformValue');
    assert.strictEqual(styleEffect, engine.styleEffect, 'styleEffect');
    assert.strictEqual(frame, engine.frame, 'frame');
    assert.strictEqual(animate, motionAnimate, 'animate');
  });

  test('a derived value follows its source, and animate drives a value', async function (assert) {
    const x: MotionValue<number> = motionValue(0);
    const doubled = transformValue(() => x.get() * 2);

    await animate(x, 50, { duration: 0.05 });

    assert.strictEqual(x.get(), 50, 'animate reached its target');
    assert.strictEqual(doubled.get(), 100, 'transformValue recomputed');
  });

  test('styleEffect writes a motion value to an element on the frame loop', async function (assert) {
    const element = document.createElement('div');
    const opacity = motionValue(0.25);
    const stop = styleEffect(element, { opacity });

    await nextRender();
    assert.strictEqual(element.style.opacity, '0.25');

    opacity.set(0.75);
    await nextRender();
    assert.strictEqual(element.style.opacity, '0.75');

    stop();
  });
});
