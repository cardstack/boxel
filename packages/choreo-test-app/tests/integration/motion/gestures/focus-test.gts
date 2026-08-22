/**
 * Port of Motion's packages/framer-motion/src/gestures/__tests__/focus.test.tsx (motion@bbabb00).
 * `ref.current.matches = …` overrides become the same assignment on the element.
 */
import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';
import { render } from '@ember/test-helpers';
import { motionValue, frame, type Transition, type Variants } from 'motion-dom';
import motion from 'glimmer-motion/motion';
import { nextFrame, focusEl, blurEl } from '../../../helpers/motion';

const OFF: Transition = { type: false };
const el = () => document.querySelector("[data-testid='myAnchorElement']") as HTMLAnchorElement;

module('Integration | motion | focus', function (hooks) {
  setupRenderingTest(hooks);

  test('whileFocus applied', async function (assert) {
    const opacity = motionValue(1); const style = { opacity }; const F = { opacity: 0.1 };
    await render(<template><a data-testid="myAnchorElement" href="#" {{motion whileFocus=F transition=OFF style=style}}></a></template>);
    el().matches = () => true;
    focusEl(el()); await nextFrame();
    assert.strictEqual(opacity.get(), 0.1);
  });

  test('whileFocus not applied when :focus-visible is false', async function (assert) {
    const opacity = motionValue(1); const style = { opacity }; const F = { opacity: 0.1 };
    await render(<template><a data-testid="myAnchorElement" href="#" {{motion whileFocus=F transition=OFF style=style}}></a></template>);
    el().matches = () => false;
    focusEl(el());
    assert.strictEqual(opacity.get(), 1);
  });

  test('whileFocus applied if focus-visible selector throws unsupported', async function (assert) {
    const opacity = motionValue(1); const style = { opacity }; const F = { opacity: 0.1 };
    await render(<template><a data-testid="myAnchorElement" href="#" {{motion whileFocus=F transition=OFF style=style}}></a></template>);
    el().matches = () => { throw new Error('this selector not supported'); };
    focusEl(el()); await nextFrame();
    assert.strictEqual(opacity.get(), 0.1);
  });

  test('whileFocus applied as variant', async function (assert) {
    const target = 0.5; const variants = { hidden: { opacity: target } };
    const opacity = motionValue(1); const style = { opacity };
    await render(<template><a data-testid="myAnchorElement" href="#" {{motion whileFocus="hidden" variants=variants transition=OFF style=style}}></a></template>);
    el().matches = () => true;
    focusEl(el()); await nextFrame();
    assert.strictEqual(opacity.get(), target);
  });

  test('whileFocus is unapplied when blur', async function (assert) {
    const variants = { hidden: { opacity: 0.5, transitionEnd: { opacity: 0.75 } } };
    const opacity = motionValue(1); const style = { opacity };
    let blurred = false;
    const result = new Promise<number>((resolve) => {
      const onComplete = () => { frame.postRender(() => { if (blurred) resolve(opacity.get()); }); };
      render(<template><a data-testid="myAnchorElement" href="#" {{motion whileFocus="hidden" variants=variants transition=OFF style=style onAnimationComplete=onComplete}}></a></template>).then(async () => {
        el().matches = () => true;
        focusEl(el()); await nextFrame();
        setTimeout(() => { blurred = true; blurEl(el()); }, 10);
      });
    });
    assert.strictEqual(await result, 1);
  });
});
