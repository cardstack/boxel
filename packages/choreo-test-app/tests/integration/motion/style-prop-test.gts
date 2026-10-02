/**
 * Port of Motion's packages/framer-motion/src/motion/__tests__/style-prop.test.tsx (motion@bbabb00).
 * `style` carries static values, transform shorthands (x/y/z) and MotionValues; the engine owns
 * whatever it has a value for, the binding applies the rest — the same split React's style attribute
 * and useStyle make. The first upstream case wraps in <MotionConfig isStatic>; nothing in it animates,
 * so it is ported without (MotionConfig is not part of the binding yet).
 */
import { find, render, settled } from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';
import { setupRenderingTest } from 'ember-qunit';
import motion from 'glimmer-motion/motion';
import { setupMotion } from 'glimmer-motion/test-support';
import { motionValue } from 'motion-dom';
import { module, test } from 'qunit';

import { nextMicrotask } from '../../helpers/motion';

const el = () => find('#m') as HTMLElement;

class P {
  @tracked style: any;
  @tracked x = 0;
  @tracked useX = false;
  @tracked useBackgroundColor = false;
  constructor(p: Partial<P> = {}) {
    Object.assign(this, p);
  }
}

module('Integration | motion | style prop', function (hooks) {
  setupRenderingTest(hooks);
  setupMotion(hooks);

  test('should remove non-set styles', async function (assert) {
    const p = new P({ style: { position: 'absolute' } });
    await render(
      <template>
        <div id="m" {{motion style=p.style}}></div>
      </template>
    );
    assert.strictEqual(getComputedStyle(el()).position, 'absolute');
    p.style = {};
    await settled();
    assert.notStrictEqual(getComputedStyle(el()).position, 'absolute');
  });

  test('should update transforms when passed a new value', async function (assert) {
    const p = new P({ x: 0 });
    const style = () => ({ x: p.x });
    await render(
      <template>
        <div id="m" {{motion style=(style)}}></div>
      </template>
    );
    assert.strictEqual(el().style.transform, 'none');
    p.x = 1;
    await settled();
    await nextMicrotask();
    assert.strictEqual(el().style.transform, 'translateX(1px)');
    p.x = 0;
    await settled();
    await nextMicrotask();
    assert.strictEqual(el().style.transform, 'none');
  });

  test("doesn't update transforms that are handled by animation props", async function (assert) {
    const initial = { x: 1 },
      animate = { x: 200 };
    const p = new P({ x: 0 });
    const style = () => ({ x: p.x });
    await render(
      <template>
        <div
          id="m"
          {{motion initial=initial animate=animate style=(style)}}
        ></div>
      </template>
    );
    // environment delta: React asserts translateX(1px) synchronously after render, before the first frame.
    // Ember's render() settles through a polling timer, so the spring from the initial 1 may already be
    // ticking; what the assertion pins is that the initial value landed, not the style's 0.
    const px = () => parseFloat(el().style.transform.replace(/[^0-9.]/g, ''));
    assert.true(
      px() >= 1 && px() < 200,
      `transform is in flight from the initial 1px (${el().style.transform})`
    );
    p.x = 2;
    await settled();
    assert.notStrictEqual(el().style.transform, 'translateX(2px)');
  });

  test('should update when passed new MotionValue', async function (assert) {
    const x = motionValue(1),
      y = motionValue(2),
      z = motionValue(3);
    const p = new P({ useX: false });
    const style = () => ({
      x: p.useX ? x : 0,
      y: !p.useX ? y : 0,
      z: !p.useX ? z : 0,
    });
    await render(
      <template>
        <div id="m" {{motion style=(style)}}></div>
      </template>
    );
    assert.strictEqual(el().style.transform, 'translateY(2px) translateZ(3px)');
    p.useX = true;
    await settled();
    await nextMicrotask();
    assert.strictEqual(el().style.transform, 'translateX(1px)');
    p.useX = false;
    await settled();
    await nextMicrotask();
    assert.strictEqual(el().style.transform, 'translateY(2px) translateZ(3px)');
  });

  test('should update when swapping between motion value and static value', async function (assert) {
    const backgroundColor = motionValue('#fff');
    const p = new P({ useBackgroundColor: true });
    const style = () => ({
      backgroundColor: p.useBackgroundColor ? backgroundColor : '#000',
    });
    await render(
      <template>
        <div id="m" {{motion style=(style)}}></div>
      </template>
    );
    assert.strictEqual(
      getComputedStyle(el()).backgroundColor,
      'rgb(255, 255, 255)'
    );
    p.useBackgroundColor = false;
    await settled();
    await nextMicrotask();
    assert.strictEqual(getComputedStyle(el()).backgroundColor, 'rgb(0, 0, 0)');
    p.useBackgroundColor = true;
    await settled();
    await nextMicrotask();
    assert.strictEqual(
      getComputedStyle(el()).backgroundColor,
      'rgb(255, 255, 255)'
    );
  });

  /**
   * React's style prop appends `px` to a number only for length properties;
   * `gridColumn: 2` writes `2`. Getting this wrong is silent — the browser
   * drops `2px` as an invalid grid line and the element auto-places.
   */
  test('a number lands unitless where React would leave it unitless', async function (assert) {
    const p = new P({
      style: {
        gridColumn: 2,
        gridRow: 3,
        opacity: 0.5,
        order: 2,
        zIndex: 4,
      },
    });
    await render(
      <template>
        <div id="m" {{motion style=p.style}}></div>
      </template>
    );
    const s = el().style;
    assert.strictEqual(s.gridColumn, '2', 'grid lines are not lengths');
    assert.strictEqual(s.gridRow, '3');
    assert.strictEqual(s.zIndex, '4');
    assert.strictEqual(s.order, '2');
    assert.strictEqual(s.opacity, '0.5');
  });

  test('a number still lands as px where it is a length', async function (assert) {
    const p = new P({ style: { height: 20, top: 8, width: 120 } });
    await render(
      <template>
        <div id="m" {{motion style=p.style}}></div>
      </template>
    );
    const s = el().style;
    assert.strictEqual(s.width, '120px');
    assert.strictEqual(s.height, '20px');
    assert.strictEqual(s.top, '8px');
  });

  test('a grid-placed element really lands in its column', async function (assert) {
    const p = new P({ style: { gridColumn: 3 } });
    await render(
      <template>
        <div
          id="grid"
          style="display: grid; grid-template-columns: 100px 100px 100px"
        >
          <div id="m" {{motion style=p.style}}></div>
        </div>
      </template>
    );
    await nextMicrotask();
    assert.strictEqual(
      getComputedStyle(el()).gridColumnStart,
      '3',
      'the third column, not auto-placed'
    );
  });
});
