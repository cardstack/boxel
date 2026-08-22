/**
 * Port of Motion's packages/framer-motion/src/motion/__tests__/transition-keyframes.test.tsx (motion@bbabb00).
 * Same cases and assertions; the upstream file fires a few `expect(promise).resolves` without awaiting —
 * here every case is awaited.
 */
import { find, render, settled } from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';
import { setupRenderingTest } from 'ember-qunit';
import motion from 'glimmer-motion/motion';
import { checkVariantsDidChange, motionValue } from 'motion-dom';
import { module, test } from 'qunit';

import { sleep } from '../../helpers/motion';

const el = () => find('#m') as HTMLElement;

class P {
  @tracked animate: any;
  constructor(p: Partial<P> = {}) {
    Object.assign(this, p);
  }
}

module('Integration | motion | keyframes transition', function (hooks) {
  setupRenderingTest(hooks);

  test('keyframes as target', async function (assert) {
    const initial = { x: 0 },
      animate = { x: [10, 200] },
      t = { duration: 0.1 };
    const done = new Promise<HTMLElement>((resolve) => {
      const onComplete = () => requestAnimationFrame(() => resolve(el()));
      void render(
        <template>
          <div
            id="m"
            {{motion
              initial=initial
              animate=animate
              transition=t
              onAnimationComplete=onComplete
            }}
          ></div>
        </template>
      );
    });
    assert.strictEqual((await done).style.transform, 'translateX(200px)');
  });

  test('hasUpdated detects only changed keyframe arrays', function (assert) {
    assert.true(checkVariantsDidChange('1', '2'));
    assert.false(checkVariantsDidChange(['1', '2', '3'], ['1', '2', '3']));
    assert.true(checkVariantsDidChange(['1', '2', '3'], ['1', '2', '4']));
  });

  test('keyframes with non-pixel values', async function (assert) {
    const initial = { width: '0%' },
      animate = { width: ['0%', '100%'] },
      t = { duration: 0.1 };
    const done = new Promise<HTMLElement>((resolve) => {
      const onComplete = () => requestAnimationFrame(() => resolve(el()));
      void render(
        <template>
          <div
            id="m"
            {{motion
              initial=initial
              animate=animate
              transition=t
              onAnimationComplete=onComplete
            }}
          ></div>
        </template>
      );
    });
    assert.strictEqual((await done).style.width, '100%');
  });

  test('if initial={false}, take state of final keyframe', async function (assert) {
    const x = motionValue(0);
    const variants = { a: { x: [0, 100] }, b: { x: [0, 100] } };
    const t = { ease: () => 0.5, duration: 10 };
    const style = { x };
    await render(
      <template>
        <div
          {{motion
            initial=false
            animate="a"
            variants=variants
            transition=t
            style=style
          }}
        ></div>
      </template>
    );
    await sleep(50);
    assert.strictEqual(x.get(), 100);
  });

  test('keyframes animation reruns when variants change and keyframes are the same', async function (assert) {
    const x = motionValue(0);
    const variants = {
      a: { x: [0, 100] },
      b: { x: [0, 100], transition: { type: false as const } },
    };
    const t = { ease: () => 0.5, duration: 10 };
    const style = { x };
    const p = new P({ animate: 'a' });
    await render(
      <template>
        <div
          {{motion
            initial=false
            animate=p.animate
            variants=variants
            transition=t
            style=style
          }}
        ></div>
      </template>
    );
    p.animate = 'b';
    await settled();
    p.animate = 'a';
    await settled();
    await sleep(50);
    assert.strictEqual(x.get(), 50);
  });

  test('issue #2855: keyframes with shared values across variants rerun on each change', async function (assert) {
    const z = motionValue(0);
    const updateCounts: number[] = [];
    const variants = {
      start: { rotateZ: [0, 10, 0] },
      end: { rotateZ: [0, 10, 0] },
    };
    const t = { duration: 0.05, ease: 'linear' as const };
    const style = { rotateZ: z };
    const recordAndReset = async () => {
      let count = 0;
      const unsubscribe = z.on('change', () => count++);
      await sleep(100);
      unsubscribe();
      updateCounts.push(count);
    };
    const p = new P({ animate: 'start' });
    await render(
      <template>
        <div
          {{motion
            animate=p.animate
            variants=variants
            transition=t
            style=style
          }}
        ></div>
      </template>
    );
    await recordAndReset();
    p.animate = 'end';
    await settled();
    await recordAndReset();
    p.animate = 'start';
    await settled();
    await recordAndReset();
    assert.true(updateCounts[0]! > 0);
    assert.true(updateCounts[1]! > 0);
    assert.true(updateCounts[2]! > 0);
  });

  test('times works as expected', async function (assert) {
    const animate = { x: [50, 100, 200, 300] },
      t = { duration: 0.1, times: [0, 0, 1, 1] };
    // Manually setting willChange to auto to prevent changes to willChange triggering onUpdate
    const style = { willChange: 'auto' };
    const values = await new Promise<number[]>((resolve) => {
      const output: number[] = [];
      const onUpdate = (latest: any) => output.push(Math.round(latest.x));
      const onComplete = () => resolve(output);
      void render(
        <template>
          <div
            {{motion
              animate=animate
              transition=t
              onUpdate=onUpdate
              onAnimationComplete=onComplete
              style=style
            }}
          ></div>
        </template>
      );
    });
    assert.true(values[0]! >= 100);
    assert.true(values[values.length - 2]! <= 200);
  });
});
