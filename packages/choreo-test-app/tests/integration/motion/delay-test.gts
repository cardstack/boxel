/**
 * Port of framer-motion/src/motion/__tests__/delay.test.tsx (motion@bbabb00).
 * Every case: a delayed animation has not moved by the next animation frame.
 */
import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';
import { render } from '@ember/test-helpers';
import { motionValue, stagger, type Variants } from 'motion-dom';
import motion from 'glimmer-motion/motion';

const raf = () => new Promise((r) => requestAnimationFrame(r));
const NO = { type: false } as const;

module('Integration | motion | delay attr', function (hooks) {
  setupRenderingTest(hooks);

  test('in transition prop', async function (assert) {
    const x = motionValue(0);
    const animate = { x: 10 }, t = { delay: 1, type: false as const }, style = { x };
    await render(<template><div {{motion animate=animate transition=t style=style}}></div></template>);
    await raf();
    assert.strictEqual(x.get(), 0);
  });

  test('value-specific delay on instant transition', async function (assert) {
    const x = motionValue(0);
    const animate = { x: 10 }, t = { x: { delay: 1, type: false as const } }, style = { x };
    await render(<template><div {{motion animate=animate transition=t style=style}}></div></template>);
    await raf();
    assert.strictEqual(x.get(), 0);
  });

  test('value-specific delay on animation', async function (assert) {
    const x = motionValue(0);
    const animate = { x: 10 }, t = { x: { delay: 1 } }, style = { x };
    await render(<template><div {{motion animate=animate transition=t style=style}}></div></template>);
    await raf();
    assert.strictEqual(x.get(), 0);
  });

  test('in animate.transition', async function (assert) {
    const x = motionValue(0);
    const animate = { x: 10, transition: { delay: 1, type: false as const } }, style = { x };
    await render(<template><div {{motion animate=animate style=style}}></div></template>);
    await raf();
    assert.strictEqual(x.get(), 0);
  });

  test('in variant', async function (assert) {
    const x = motionValue(0);
    const variants = { visible: { x: 10, transition: { delay: 1, type: false as const } } }, style = { x };
    await render(<template><div {{motion variants=variants animate="visible" style=style}}></div></template>);
    await raf();
    assert.strictEqual(x.get(), 0);
  });

  test('in variant children via delayChildren', async function (assert) {
    const x = motionValue(0);
    const parent: Variants = { visible: { x: 10, transition: { delay: 0, delayChildren: 1, type: false } } };
    const child: Variants = { visible: { x: 10, transition: NO } };
    const style = { x };
    await render(<template><div {{motion variants=parent animate="visible"}}><div {{motion variants=child style=style}}></div></div></template>);
    await raf();
    assert.strictEqual(x.get(), 0);
  });

  test('in variant children via staggerChildren', async function (assert) {
    const x = motionValue(0);
    const parent: Variants = { visible: { x: 10, transition: { delay: 0, staggerChildren: 1, type: false } } };
    const child: Variants = { visible: { x: 10, transition: NO } };
    const style = { x };
    await render(<template><div {{motion variants=parent animate="visible"}}><div {{motion variants=child}}></div><div {{motion variants=child style=style}}></div></div></template>);
    await raf();
    assert.strictEqual(x.get(), 0);
  });

  test('in variant children via delayChildren: stagger(interval)', async function (assert) {
    const x = motionValue(0);
    const parent: Variants = { visible: { x: 10, transition: { delay: 0, delayChildren: stagger(1), type: false } } };
    const child: Variants = { visible: { x: 10, transition: NO } };
    const style = { x };
    await render(<template><div {{motion variants=parent animate="visible"}}><div {{motion variants=child}}></div><div {{motion variants=child style=style}}></div></div></template>);
    await raf();
    assert.strictEqual(x.get(), 0);
  });
});
