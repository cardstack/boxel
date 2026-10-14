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
import { module, test } from 'qunit';

import { nextFrame } from '../helpers/motion';

class Timing {
  @tracked transition: Record<string, unknown>;
  constructor(transition: Record<string, unknown>) {
    this.transition = transition;
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
});
