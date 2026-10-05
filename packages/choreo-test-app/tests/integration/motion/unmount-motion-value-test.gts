/**
 * Port of Motion's packages/framer-motion/src/motion/__tests__/unmount-motion-value.test.tsx (motion@bbabb00).
 *
 * Regression coverage for motion#3315: VisualElement.unmount() must not stop animations on the motion
 * values it owns synchronously — a remount may re-subscribe before the next frame (React 19 reorder
 * reconciliation; the same holds for Glimmer re-keying). Only the deferred auto-stop in the
 * MotionValue's change-listener cleanup runs.
 *
 * React's `unmount()` is synchronous; @ember/test-helpers' clearRender() settles the runloop, which is
 * still well inside the frame the deferred stop waits for.
 */
import { clearRender, find, render } from '@ember/test-helpers';
import { setupRenderingTest } from 'ember-qunit';
import motion from 'glimmer-motion/motion';
import { setupMotion } from 'glimmer-motion/test-support';
import { frame, visualElementStore } from 'motion-dom';
import { module, test } from 'qunit';

import { nextFrame, spy } from '../../helpers/motion';

const animate = { x: 100 };
const t = { duration: 10, ease: 'linear' as const };

async function mountAnimating() {
  await render(
    <template>
      <div id="m" {{motion animate=animate transition=t}}></div>
    </template>
  );
  await nextFrame();
  const ve = visualElementStore.get(find('#m')!)!;
  return { ve, xValue: ve.getValue('x')! };
}

module(
  'Integration | motion | motion value lifecycle on unmount (#3315)',
  function (hooks) {
    setupRenderingTest(hooks);
    setupMotion(hooks);

    test('does not synchronously stop animations on VE-owned motion values', async function (assert) {
      const { ve, xValue } = await mountAnimating();
      // Confirm the test setup is exercising a VE-owned motion value
      // (this is the only path that hit the old synchronous stop).
      assert.strictEqual(xValue.owner, ve);
      assert.true(xValue.isAnimating());
      // Subscribe so the deferred auto-stop won't run when the VE unmounts — this simulates
      // the remount case where a new VisualElement re-binds to the motion value before the next frame.
      const externalSubscriber = spy();
      const stopListening = xValue.on('change', externalSubscriber);
      await clearRender();
      // Pre-#3315 this would be false: VE.unmount called value.stop() synchronously and killed the animation.
      assert.true(xValue.isAnimating());
      stopListening();
    });

    test('deferred auto-stop fires on next frame when nothing resubscribes', async function (assert) {
      const { xValue } = await mountAnimating();
      assert.true(xValue.isAnimating());
      await clearRender();
      // Synchronously, animation is still running...
      assert.true(xValue.isAnimating());
      // ...but with no listener attached, the deferred auto-stop runs on the next frame and the
      // animation is cleaned up. This is the path that prevents leaks for genuinely permanent unmounts.
      await nextFrame();
      assert.false(xValue.isAnimating());
    });

    test('animation can survive an unmount-then-resubscribe within a single frame', async function (assert) {
      const { xValue } = await mountAnimating();
      assert.true(xValue.isAnimating());
      await clearRender();
      // Simulate a remount re-establishing a change listener before the deferred auto-stop callback runs.
      const resubscribe = spy();
      const stopListening = xValue.on('change', resubscribe);
      // Wait long enough for the deferred frame.read callback to fire.
      await nextFrame();
      // Because a listener is now present, the auto-stop must skip and the animation should keep ticking.
      assert.true(xValue.isAnimating());
      // The motion value should still be reporting changes after the simulated remount.
      const valueAfterRemount = xValue.get();
      await new Promise<void>((resolve) => frame.postRender(() => resolve()));
      assert.notStrictEqual(xValue.get(), valueAfterRemount);
      stopListening();
    });
  }
);
