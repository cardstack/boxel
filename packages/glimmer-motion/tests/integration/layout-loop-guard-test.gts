import { render, settled } from '@ember/test-helpers';
import {
  layoutLoopDetected,
  requestSettle,
  resetLayoutLoopGuard,
} from 'glimmer-motion';
import LayoutGroup from 'glimmer-motion/layout-group';
import motion from 'glimmer-motion/motion';
import { setupMotion } from 'glimmer-motion/test-support';
import { module, test } from 'qunit';

import { setupRenderingTest } from '../helpers';

/**
 * The engine's circuit breaker.
 *
 * A settle measures every projecting node, and it is scheduled into the
 * runloop, which Ember drains in a microtask — as does the engine's own
 * projection update. A chain of microtasks never yields, so an application
 * that manages to close the loop (the classic being a `@tracked` property
 * assigned on every frame of a drag: tracked has no equality check, so
 * assigning an unchanged value still invalidates every consumer) does not make
 * the page slow. It makes the page STOP: no timers, no frames, no input, no
 * paint, and no way to catch it from outside, because the outside is what got
 * starved.
 *
 * The library cannot stop an application writing that loop. It can refuse to
 * let the loop take the tab, which is what these two assert.
 */
module('Integration | motion | layout loop guard', function (hooks) {
  setupRenderingTest(hooks);
  setupMotion(hooks);

  /**
   * Frames are stubbed rather than awaited.
   *
   * The breaker's whole question is "has a frame happened since the last
   * settle", so a test that lets real frames through is testing the scheduler's
   * mood. Holding the frame callbacks lets the burst be built exactly.
   */
  function holdFrames() {
    const real = window.requestAnimationFrame;
    const held: FrameRequestCallback[] = [];
    window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      held.push(cb);
      return held.length;
    }) as typeof real;
    return {
      held,
      release() {
        window.requestAnimationFrame = real;
        held.splice(0).forEach((cb) => cb(performance.now()));
      },
    };
  }

  test('a settle storm trips the breaker instead of taking the frame loop with it', async function (assert) {
    await render(
      <template>
        <LayoutGroup>
          <div class='box' {{motion layout=true}}></div>
        </LayoutGroup>
      </template>,
    );
    resetLayoutLoopGuard();
    const frames = holdFrames();
    try {
      assert.false(layoutLoopDetected(), 'nothing wrong to start with');
      // Sixty-one settles with no frame in between — the shape of the runaway,
      // without needing an application that actually runs one.
      // Comfortably past the limit rather than exactly on it: a frame booked
      // during render can still be in flight when the loop starts, and it
      // resets the count once on its way out.
      for (let i = 0; i < 70; i++) {
        requestSettle();
        await settled();
      }
      assert.true(
        layoutLoopDetected(),
        'the breaker noticed and said so, rather than the tab going quiet',
      );
    } finally {
      frames.release();
      await settled();
      // This test trips the breaker ON PURPOSE, and setupMotion's afterEach
      // fails any test that leaves one tripped — which is the behaviour the
      // second half of this module relies on. Clear it, having asserted it.
      resetLayoutLoopGuard();
    }
  });

  test('an ordinary page never trips it', async function (assert) {
    await render(
      <template>
        <LayoutGroup>
          <div class='box' {{motion layout=true}}></div>
        </LayoutGroup>
      </template>,
    );
    resetLayoutLoopGuard();
    // Settles spread across real frames, which is what every legitimate render
    // pass looks like: the counter resets each frame and never accumulates.
    for (let i = 0; i < 12; i++) {
      requestSettle();
      await settled();
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    assert.false(
      layoutLoopDetected(),
      'a guard that fires on normal work is a guard everyone turns off',
    );
  });
});
