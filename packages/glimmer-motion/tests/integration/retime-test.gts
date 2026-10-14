/**
 * `retime(root)`: motion already running under an element takes its current
 * transition. A transition edited while `animate` stays put is, in Motion, an
 * edit for the next animation, so a running loop or spring keeps its old
 * timing; retime is how a tuning tool asks for it now.
 */
import { find, render, settled } from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';
import { setupRenderingTest } from 'ember-qunit';
import { motionValue, retime } from 'glimmer-motion';
import motion from 'glimmer-motion/motion';
import { setupMotion } from 'glimmer-motion/test-support';
import type { Variants as MotionVariants } from 'motion-dom';
import { module, test } from 'qunit';

import { nextFrame, sleep } from '../helpers/motion';

class Timing {
  @tracked transition: Record<string, unknown>;
  constructor(transition: Record<string, unknown>) {
    this.transition = transition;
  }
}

class Variants {
  @tracked variants: MotionVariants;
  constructor(variants: MotionVariants) {
    this.variants = variants;
  }
}

/** the running animation of a value, as Motion's playback controls */
function running(value: { animation?: unknown }) {
  return value.animation as { duration: number; time: number } | undefined;
}

module('Integration | retime', function (hooks) {
  setupRenderingTest(hooks);
  setupMotion(hooks);

  test('an infinite loop takes an edited duration on retime, keeping its phase', async function (assert) {
    const x = motionValue(0);
    const style = { x };
    const animate = { x: [0, 100, 0] };
    const timing = new Timing({
      duration: 4,
      ease: 'linear',
      repeat: Infinity,
    });
    await render(
      <template>
        <div id='stage'>
          <div
            {{motion animate=animate transition=timing.transition style=style}}
          ></div>
        </div>
      </template>,
    );
    await nextFrame();
    running(x)!.time = 1;
    assert.strictEqual(running(x)!.duration, 4, 'the loop runs a 4s cycle');

    timing.transition = { duration: 8, ease: 'linear', repeat: Infinity };
    await settled();
    assert.strictEqual(
      running(x)!.duration,
      4,
      'an edited transition alone does not touch the running loop',
    );

    retime(find('#stage')!);
    const loop = running(x)!;
    assert.strictEqual(loop.duration, 8, 'retimed onto an 8s cycle');
    assert.ok(
      Math.abs(loop.time / loop.duration - 0.25) < 0.02,
      `still a quarter of the way round (${loop.time / loop.duration})`,
    );
  });

  test('motion whose timing is unchanged is left running', async function (assert) {
    const x = motionValue(0);
    const style = { x };
    const animate = { x: [0, 100, 0] };
    const transition = {
      duration: 4,
      ease: 'linear' as const,
      repeat: Infinity,
    };
    await render(
      <template>
        <div id='stage'>
          <div
            {{motion animate=animate transition=transition style=style}}
          ></div>
        </div>
      </template>,
    );
    await nextFrame();
    const before = running(x);
    before!.time = 1;

    retime(find('#stage')!);
    assert.strictEqual(running(x), before, 'the same animation runs on');
    assert.ok(Math.abs(running(x)!.time - 1) < 0.1, 'from where it was');
  });

  test('a tween in flight restarts from where it is under its edited duration', async function (assert) {
    const x = motionValue(0);
    const style = { x };
    const initial = { x: 0 };
    const animate = { x: 100 };
    const timing = new Timing({ duration: 10, ease: 'linear' });
    await render(
      <template>
        <div id='stage'>
          <div
            {{motion
              initial=initial
              animate=animate
              transition=timing.transition
              style=style
            }}
          ></div>
        </div>
      </template>,
    );
    await nextFrame();
    running(x)!.time = 5;
    await nextFrame();
    const midway = x.get();
    assert.ok(Math.abs(midway - 50) < 2, `halfway through its 10s (${midway})`);

    timing.transition = { duration: 2, ease: 'linear' };
    await settled();
    retime(find('#stage')!);
    assert.strictEqual(running(x)!.duration, 2, 'restarted on a 2s tween');
    assert.ok(
      Math.abs(x.get() - midway) < 2,
      `from where it stood (${x.get()})`,
    );
  });

  /**
   * A loop on `x` parked `time` seconds in, then edited from `from` to `to`
   * and retimed: where its new clock stands. Wrapped, because playback
   * controls are thenable and an async function would wait out the loop.
   */
  async function retimedLoop(
    from: Record<string, unknown>,
    to: Record<string, unknown>,
    time: number,
  ) {
    const x = motionValue(0);
    const style = { x };
    const animate = { x: [0, 100] };
    const timing = new Timing(from);
    await render(
      <template>
        <div id='stage'>
          <div
            {{motion animate=animate transition=timing.transition style=style}}
          ></div>
        </div>
      </template>,
    );
    await nextFrame();
    running(x)!.time = time;
    timing.transition = to;
    await settled();
    retime(find('#stage')!);
    return { loop: running(x)! };
  }

  test('a loop that comes back the way it went keeps its direction', async function (assert) {
    // 6s into a 4s reverse loop: on the way back, halfway, 3/4 of a turn
    const { loop } = await retimedLoop(
      { duration: 4, ease: 'linear', repeat: Infinity, repeatType: 'reverse' },
      { duration: 8, ease: 'linear', repeat: Infinity, repeatType: 'reverse' },
      6,
    );
    assert.strictEqual(loop.duration, 8);
    assert.ok(
      Math.abs(loop.time - 12) < 0.1,
      `still on the way back, halfway (${loop.time}s of a 16s turn)`,
    );
  });

  test('a loop with a repeat delay keeps its place in the whole turn', async function (assert) {
    // 3s into a 2s loop with a 2s rest: three quarters of a 4s turn, resting
    const { loop } = await retimedLoop(
      { duration: 2, ease: 'linear', repeat: Infinity, repeatDelay: 2 },
      { duration: 4, ease: 'linear', repeat: Infinity, repeatDelay: 2 },
      3,
    );
    assert.ok(
      Math.abs(loop.time - 4.5) < 0.1,
      `three quarters of the new 6s turn (${loop.time}s)`,
    );
  });

  test('a loop already past its delay does not wait for it again', async function (assert) {
    // 1.5s in, behind a 0.5s delay: a quarter of the way round a 4s loop
    const { loop } = await retimedLoop(
      { delay: 0.5, duration: 4, ease: 'linear', repeat: Infinity },
      { delay: 0.5, duration: 8, ease: 'linear', repeat: Infinity },
      1.5,
    );
    assert.ok(
      Math.abs(loop.time - 2) < 0.1,
      `a quarter of the way round, with no delay ahead of it (${loop.time}s)`,
    );
  });

  test('an animation that has finished is not replayed', async function (assert) {
    const opacity = motionValue(0);
    const style = { opacity };
    const animate = { opacity: [0, 1] };
    const timing = new Timing({ duration: 0.05 });
    await render(
      <template>
        <div id='stage'>
          <div
            {{motion animate=animate transition=timing.transition style=style}}
          ></div>
        </div>
      </template>,
    );
    await sleep(150);
    assert.strictEqual(opacity.get(), 1, 'settled at its last keyframe');

    timing.transition = { duration: 2 };
    await settled();
    retime(find('#stage')!);
    assert.false(opacity.isAnimating(), 'nothing restarted');
    assert.strictEqual(opacity.get(), 1, 'still where it settled');
  });

  test('a child that takes its label from its parent is retimed', async function (assert) {
    const x = motionValue(0);
    const style = { x };
    const parentVariants = { spin: {} };
    const child = new Variants({
      spin: {
        x: [0, 100, 0],
        transition: { duration: 4, ease: 'linear', repeat: Infinity },
      },
    });
    await render(
      <template>
        <div id='stage' {{motion animate='spin' variants=parentVariants}}>
          <div {{motion variants=child.variants style=style}}></div>
        </div>
      </template>,
    );
    await nextFrame();
    running(x)!.time = 1;

    child.variants = {
      spin: {
        x: [0, 100, 0],
        transition: { duration: 8, ease: 'linear', repeat: Infinity },
      },
    };
    await settled();
    retime(find('#stage')!);
    const loop = running(x)!;
    assert.strictEqual(loop.duration, 8, 'retimed onto an 8s cycle');
    assert.ok(
      Math.abs(loop.time - 2) < 0.1,
      `a quarter of the way round (${loop.time}s)`,
    );
  });

  test('a custom value that does not serialise still retimes', async function (assert) {
    const x = motionValue(0);
    const style = { x };
    const custom: Record<string, unknown> = {};
    custom['self'] = custom;
    const animate = { x: [0, 100, 0] };
    const timing = new Timing({
      duration: 4,
      ease: 'linear',
      repeat: Infinity,
    });
    await render(
      <template>
        <div id='stage'>
          <div
            {{motion
              animate=animate
              custom=custom
              transition=timing.transition
              style=style
            }}
          ></div>
        </div>
      </template>,
    );
    await nextFrame();
    timing.transition = { duration: 8, ease: 'linear', repeat: Infinity };
    await settled();
    retime(find('#stage')!);
    assert.strictEqual(running(x)!.duration, 8);
  });
});
