/**
 * Port of Motion's packages/framer-motion/src/gestures/__tests__/press.test.tsx (motion@bbabb00).
 * pointerDown/pointerUp are real PointerEvents; fireEvent.focus/keyDown/keyUp/blur are real events too.
 * MockDrag-driven cases use the Cypress-style trigger() (the pan session listens on window for moves).
 * React `rerender()` calls that only re-render with the same props are dropped.
 */
import { render, settled } from '@ember/test-helpers';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { setupRenderingTest } from 'ember-qunit';
import motion from 'glimmer-motion/motion';
import { setupMotion } from 'glimmer-motion/test-support';
import { motionValue, type Transition } from 'motion-dom';
import { module, test } from 'qunit';

import { trigger } from '../../../helpers/layout-fixture';
import {
  blurEl,
  focusEl,
  keyDown,
  keyUp,
  nextFrame,
  pointerDown,
  pointerEnter,
  pointerLeave,
  pointerUp,
  sleep,
  spy,
} from '../../../helpers/motion';

const OFF: Transition = { type: false };
const $ = (sel: string) => document.querySelector(sel) as HTMLElement;
const first = () => document.querySelector('#ember-testing > *')!;
const byId = (id: string) => $(`[data-testid='${id}']`);
const PROP_NO_TAP = { tap: false };

module('Integration | motion | press', function (hooks) {
  setupRenderingTest(hooks);
  setupMotion(hooks);

  test('press event listeners fire', async function (assert) {
    const press = spy();
    await render(
      <template>
        <div {{motion onTap=press}}></div>
      </template>
    );
    pointerDown(first());
    pointerUp(first());
    await nextFrame();
    assert.strictEqual(press.calls.length, 1);
  });

  test("press event listeners don't fire if element is disabled", async function (assert) {
    const press = spy();
    await render(
      <template>
        <button type="button" disabled {{motion onTap=press}}></button>
      </template>
    );
    pointerDown(first());
    pointerUp(first());
    await nextFrame();
    assert.strictEqual(press.calls.length, 0);
  });

  test('global press event listeners fire', async function (assert) {
    const press = spy();
    await render(
      <template>
        <div data-testid="target"></div><div
          {{motion globalTapTarget=true onTap=press}}
        ></div>
      </template>
    );
    pointerDown(byId('target'));
    pointerUp(byId('target'));
    await nextFrame();
    assert.strictEqual(press.calls.length, 1);
  });

  test('press event listeners fire via keyboard', async function (assert) {
    const press = spy(),
      pressStart = spy(),
      pressCancel = spy();
    await render(
      <template>
        <div
          {{motion onTapStart=pressStart onTap=press onTapCancel=pressCancel}}
        ></div>
      </template>
    );
    focusEl(first());
    keyDown(first(), 'Enter');
    await nextFrame();
    assert.strictEqual(pressStart.calls.length, 1);
    keyUp(first(), 'Enter');
    await nextFrame();
    assert.strictEqual(pressStart.calls.length, 1);
    assert.strictEqual(press.calls.length, 1);
    assert.strictEqual(pressCancel.calls.length, 0);
  });

  test('press cancel event listeners fire via keyboard', async function (assert) {
    const press = spy(),
      pressStart = spy(),
      pressCancel = spy();
    await render(
      <template>
        <div
          {{motion onTapStart=pressStart onTap=press onTapCancel=pressCancel}}
        ></div>
      </template>
    );
    focusEl(first());
    keyDown(first(), 'Enter');
    await nextFrame();
    assert.strictEqual(pressStart.calls.length, 1);
    blurEl(first());
    await nextFrame();
    assert.strictEqual(pressStart.calls.length, 1);
    assert.strictEqual(press.calls.length, 0);
    assert.strictEqual(pressCancel.calls.length, 1);
  });

  test('press cancel event listeners not fired via keyboard after keyUp', async function (assert) {
    const press = spy(),
      pressStart = spy(),
      pressCancel = spy();
    await render(
      <template>
        <div
          {{motion onTapStart=pressStart onTap=press onTapCancel=pressCancel}}
        ></div>
      </template>
    );
    focusEl(first());
    keyDown(first(), 'Enter');
    keyUp(first(), 'Enter');
    await nextFrame();
    assert.strictEqual(pressStart.calls.length, 1);
    blurEl(first());
    await nextFrame();
    assert.strictEqual(press.calls.length, 1);
    assert.strictEqual(pressStart.calls.length, 1);
    assert.strictEqual(pressCancel.calls.length, 0);
  });

  test('press event listeners are cleaned up', async function (assert) {
    const press = spy();
    class Host extends Component {
      @tracked onTap: (() => void) | undefined = press;
      constructor(o: unknown, a: object) {
        super(o as never, a);
        host = this;
      }
      <template>
        <div {{motion onTap=this.onTap}}></div>
      </template>
    }
    let host: Host | undefined;
    await render(<template><Host /></template>);
    pointerDown(first());
    pointerUp(first());
    await nextFrame();
    assert.strictEqual(press.calls.length, 1);
    host!.onTap = undefined;
    await settled();
    pointerDown(first());
    pointerUp(first());
    await nextFrame();
    assert.strictEqual(press.calls.length, 1);
  });

  test('onTapCancel is correctly removed from a component', async function (assert) {
    const cancelA = spy(),
      noop = () => {};
    await render(
      <template>
        <div
          data-testid="a"
          {{motion onTap=noop onTapCancel=cancelA}}
        ></div><div data-testid="b" {{motion onTap=noop}}></div>
      </template>
    );
    pointerDown(byId('a'));
    pointerUp(byId('a'));
    await nextFrame();
    assert.strictEqual(cancelA.calls.length, 0);
    pointerDown(byId('b'));
    pointerUp(byId('b'));
    await nextFrame();
    assert.strictEqual(cancelA.calls.length, 0);
  });

  test('press event listeners fire if triggered by child', async function (assert) {
    const press = spy();
    await render(
      <template>
        <div {{motion onTap=press}}><div
            data-testid="child"
            {{motion}}
          ></div></div>
      </template>
    );
    pointerDown(byId('child'));
    pointerUp(byId('child'));
    await nextFrame();
    assert.strictEqual(press.calls.length, 1);
  });

  test('press event listeners fire if triggered by child and released on bound element', async function (assert) {
    const press = spy();
    await render(
      <template>
        <div {{motion onTap=press}}><div
            data-testid="child"
            {{motion}}
          ></div></div>
      </template>
    );
    pointerDown(byId('child'));
    pointerUp(first());
    await nextFrame();
    assert.strictEqual(press.calls.length, 1);
  });

  test('press event listeners fire if triggered by bound element and released on child', async function (assert) {
    const press = spy();
    await render(
      <template>
        <div {{motion onTap=press}}><div
            data-testid="child"
            {{motion}}
          ></div></div>
      </template>
    );
    pointerDown(first());
    pointerUp(byId('child'));
    await nextFrame();
    assert.strictEqual(press.calls.length, 1);
  });

  test('press cancel fires if press released outside element', async function (assert) {
    const pressCancel = spy();
    await render(
      <template>
        <div {{motion}}><div
            data-testid="child"
            {{motion onTapCancel=pressCancel}}
          ></div></div>
      </template>
    );
    pointerDown(byId('child'));
    pointerUp(first());
    await nextFrame();
    assert.strictEqual(pressCancel.calls.length, 1);
  });

  test("press event listeners doesn't fire if parent is being dragged", async function (assert) {
    const press = spy();
    await render(
      <template>
        <div {{motion drag=true style=BOX}}><div
            data-testid="pressTarget"
            style="width:50px;height:50px"
            {{motion onTap=press}}
          ></div></div>
      </template>
    );
    const t = byId('pressTarget');
    trigger(t, 'pointerdown', 5, 5);
    trigger(t, 'pointermove', 6, 6);
    await nextFrame();
    trigger(t, 'pointermove', 15, 15);
    await nextFrame();
    trigger(t, 'pointerup');
    await nextFrame();
    assert.strictEqual(press.calls.length, 0);
  });

  test('press event listeners do fire if parent is being dragged only a little bit', async function (assert) {
    const press = spy();
    await render(
      <template>
        <div {{motion drag=true style=BOX}}><div
            data-testid="pressTarget"
            style="width:50px;height:50px"
            {{motion onTap=press}}
          ></div></div>
      </template>
    );
    const t = byId('pressTarget');
    trigger(t, 'pointerdown', 5, 5);
    trigger(t, 'pointermove', 5.5, 5.5);
    await nextFrame();
    trigger(t, 'pointerup');
    await nextFrame();
    assert.strictEqual(press.calls.length, 1);
  });

  test('press event listeners do fire after drag gesture on parent element', async function (assert) {
    const press = spy();
    await render(
      <template>
        <div data-testid="parent" {{motion drag=true style=BOX}}><div
            data-testid="child"
            style="width:50px;height:50px"
            {{motion onTap=press}}
          ></div></div>
      </template>
    );
    const child = byId('child');
    trigger(child, 'pointerdown', 5, 5);
    trigger(child, 'pointermove', 10, 10);
    await nextFrame();
    trigger(child, 'pointermove', 100, 100);
    await nextFrame();
    trigger(child, 'pointerup');
    await nextFrame();
    pointerDown(child);
    pointerUp(child);
    await nextFrame();
    assert.strictEqual(press.calls.length, 1);
  });

  test('press event listeners unset', async function (assert) {
    const press = spy();
    await render(
      <template>
        <div {{motion onTap=press}}></div>
      </template>
    );
    pointerDown(first());
    pointerUp(first());
    pointerDown(first());
    pointerUp(first());
    pointerDown(first());
    pointerUp(first());
    await nextFrame();
    assert.strictEqual(press.calls.length, 3);
  });

  test('press gesture variant applies and unapplies', async function (assert) {
    const history: number[] = [];
    const opacity = motionValue(0.5);
    const style = { opacity };
    const log = () => history.push(opacity.get());
    await render(
      <template>
        <div
          {{motion initial=HALF transition=OFF whileTap=FULL style=style}}
        ></div>
      </template>
    );
    await nextFrame();
    log();
    pointerDown(first());
    await nextFrame();
    log();
    pointerUp(first());
    await nextFrame();
    log();
    assert.deepEqual(history, [0.5, 1, 0.5]);
  });

  test('press gesture variant applies and unapplies via keyboard', async function (assert) {
    const history: number[] = [];
    const opacity = motionValue(0.5);
    const style = { opacity };
    const log = () => history.push(opacity.get());
    await render(
      <template>
        <div
          {{motion initial=HALF transition=OFF whileTap=FULL style=style}}
        ></div>
      </template>
    );
    await nextFrame();
    log();
    focusEl(first());
    keyDown(first(), 'Enter');
    await nextFrame();
    log();
    keyUp(first(), 'Enter');
    await nextFrame();
    log();
    assert.deepEqual(history, [0.5, 1, 0.5]);
  });

  test('press gesture variant applies and unapplies via blur cancel', async function (assert) {
    const history: number[] = [];
    const opacity = motionValue(0.5);
    const style = { opacity };
    const log = () => history.push(opacity.get());
    await render(
      <template>
        <div
          {{motion initial=HALF transition=OFF whileTap=FULL style=style}}
        ></div>
      </template>
    );
    await nextFrame();
    log();
    focusEl(first());
    keyDown(first(), 'Enter');
    await nextFrame();
    log();
    blurEl(first());
    await nextFrame();
    log();
    assert.deepEqual(history, [0.5, 1, 0.5]);
  });

  test('press gesture variant unapplies children', async function (assert) {
    const history: number[] = [];
    const opacity = motionValue(0.5);
    const style = { opacity };
    const log = () => history.push(opacity.get());
    const variants = { pressed: { opacity: 1 } };
    await render(
      <template>
        <div {{motion whileTap="pressed"}}><div
            data-testid="child"
            {{motion variants=variants style=style transition=OFF}}
          ></div></div>
      </template>
    );
    await nextFrame();
    log();
    pointerDown(byId('child'));
    await nextFrame();
    log();
    pointerUp(byId('child'));
    await nextFrame();
    log();
    assert.deepEqual(history, [0.5, 1, 0.5]);
  });

  test('press gesture on children returns to parent-defined variant', async function (assert) {
    const history: number[] = [];
    const opacity = motionValue(0.5);
    const style = { opacity };
    const log = () => history.push(opacity.get());
    const variants = { visible: { opacity: 1 }, hidden: { opacity: 0 } };
    await render(
      <template>
        <div {{motion animate="visible" initial="hidden"}}><div
            data-testid="child"
            {{motion
              variants=variants
              style=style
              transition=OFF
              whileTap=HALF
            }}
          ></div></div>
      </template>
    );
    await nextFrame();
    log();
    pointerDown(byId('child'));
    await nextFrame();
    log();
    pointerUp(byId('child'));
    await nextFrame();
    log();
    assert.deepEqual(history, [1, 0.5, 1]);
  });

  test('press gesture works with animation state', async function (assert) {
    const childVariants = { rest: { opacity: 0.5 }, pressed: { opacity: 0.8 } };
    const fast = { duration: 0.01 };
    class Host extends Component {
      @tracked isPressed = false;
      get animate() {
        return this.isPressed ? ['pressed'] : ['rest'];
      }
      press = () => {
        this.isPressed = true;
      };
      <template>
        <div data-testid="parent" {{motion animate=this.animate}}>
          <div
            data-testid="a"
            {{motion
              variants=childVariants
              transition=fast
              onTapStart=this.press
            }}
          ></div>
          <div
            data-testid="b"
            {{motion variants=childVariants transition=fast}}
          ></div>
        </div>
      </template>
    }
    await render(<template><Host /></template>);
    pointerDown(byId('a'));
    await sleep(200);
    assert.strictEqual(getComputedStyle(byId('a')).opacity, '0.8');
    assert.strictEqual(getComputedStyle(byId('b')).opacity, '0.8');
    pointerUp(byId('a'));
  });

  test('press gesture variant applies and unapplies with whileHover', async function (assert) {
    const history: number[] = [];
    const opacity = motionValue(0.5);
    const style = { opacity };
    const log = () => history.push(opacity.get());
    const H = { opacity: 0.75 };
    await render(
      <template>
        <div
          {{motion
            initial=HALF
            transition=OFF
            whileHover=H
            whileTap=FULL
            style=style
          }}
        ></div>
      </template>
    );
    await nextFrame();
    log();
    pointerEnter(first());
    await nextFrame();
    log();
    pointerDown(first());
    await nextFrame();
    log();
    pointerUp(first());
    await nextFrame();
    log();
    pointerLeave(first());
    await nextFrame();
    log();
    pointerEnter(first());
    await nextFrame();
    log();
    pointerDown(first());
    await nextFrame();
    log();
    pointerLeave(first());
    await nextFrame();
    log();
    pointerUp(first());
    await nextFrame();
    log();
    assert.deepEqual(history, [0.5, 0.75, 1, 0.75, 0.5, 0.75, 1, 1, 0.5]);
  });

  test('press gesture variant applies and unapplies as state changes', async function (assert) {
    const history: number[] = [];
    const opacity = motionValue(0.5);
    const style = { opacity };
    const log = () => history.push(opacity.get());
    class Host extends Component {
      @tracked isActive = false;
      get initial() {
        return { opacity: this.isActive ? 1 : 0.5 };
      }
      get animate() {
        return { opacity: this.isActive ? 1 : 0.5 };
      }
      get hover() {
        return { opacity: this.isActive ? 1 : 0.75 };
      }
      constructor(o: unknown, a: object) {
        super(o as never, a);
        host = this;
      }
      <template>
        <div
          {{motion
            initial=this.initial
            animate=this.animate
            whileHover=this.hover
            whileTap=FULL
            transition=OFF
            style=style
          }}
        ></div>
      </template>
    }
    let host: Host | undefined;
    await render(<template><Host /></template>);
    await nextFrame();
    log();
    pointerEnter(first());
    await nextFrame();
    log();
    pointerDown(first());
    await nextFrame();
    log();
    host!.isActive = true;
    await settled();
    pointerUp(first());
    await nextFrame();
    log();
    pointerLeave(first());
    await nextFrame();
    log();
    pointerEnter(first());
    await nextFrame();
    log();
    pointerDown(first());
    await nextFrame();
    log();
    pointerLeave(first());
    await nextFrame();
    log();
    pointerUp(first());
    await nextFrame();
    log();
    assert.deepEqual(history, [0.5, 0.75, 1, 1, 1, 1, 1, 1, 1]);
  });

  test('propagate={{ tap: false }} prevents parent onTap from firing', async function (assert) {
    const parentTap = spy(),
      childTap = spy();
    await render(
      <template>
        <div {{motion onTap=parentTap}}><div
            data-testid="child"
            {{motion onTap=childTap propagate=PROP_NO_TAP}}
          ></div></div>
      </template>
    );
    pointerDown(byId('child'));
    pointerUp(byId('child'));
    await nextFrame();
    assert.strictEqual(childTap.calls.length, 1);
    assert.strictEqual(parentTap.calls.length, 0);
  });

  test('without propagate both parent and child onTap fire', async function (assert) {
    const parentTap = spy(),
      childTap = spy();
    await render(
      <template>
        <div {{motion onTap=parentTap}}><div
            data-testid="child"
            {{motion onTap=childTap}}
          ></div></div>
      </template>
    );
    pointerDown(byId('child'));
    pointerUp(byId('child'));
    await nextFrame();
    assert.strictEqual(childTap.calls.length, 1);
    assert.strictEqual(parentTap.calls.length, 1);
  });

  test('propagate={{ tap: false }} isolates whileTap to child only', async function (assert) {
    const parentOpacity = motionValue(0.5),
      childOpacity = motionValue(0.5);
    const ps = { opacity: parentOpacity },
      cs = { opacity: childOpacity };
    const ph: number[] = [],
      ch: number[] = [];
    const log = () => {
      ph.push(parentOpacity.get());
      ch.push(childOpacity.get());
    };
    await render(
      <template>
        <div {{motion initial=HALF transition=OFF whileTap=FULL style=ps}}><div
            data-testid="child"
            {{motion
              initial=HALF
              transition=OFF
              whileTap=FULL
              style=cs
              propagate=PROP_NO_TAP
            }}
          ></div></div>
      </template>
    );
    await nextFrame();
    log();
    pointerDown(byId('child'));
    await nextFrame();
    log();
    pointerUp(byId('child'));
    await nextFrame();
    log();
    assert.deepEqual({ ph, ch }, { ph: [0.5, 0.5, 0.5], ch: [0.5, 1, 0.5] });
  });

  test('propagate={{ tap: false }} prevents all ancestor onTap handlers (three levels)', async function (assert) {
    const grandparentTap = spy(),
      parentTap = spy(),
      childTap = spy();
    await render(
      <template>
        <div {{motion onTap=grandparentTap}}><div
            {{motion onTap=parentTap}}
          ><div
              data-testid="child"
              {{motion onTap=childTap propagate=PROP_NO_TAP}}
            ></div></div></div>
      </template>
    );
    pointerDown(byId('child'));
    pointerUp(byId('child'));
    await nextFrame();
    assert.strictEqual(childTap.calls.length, 1);
    assert.strictEqual(parentTap.calls.length, 0);
    assert.strictEqual(grandparentTap.calls.length, 0);
  });

  test('ignore press event when button is disabled', async function (assert) {
    const press = spy();
    await render(
      <template>
        <button type="button" disabled {{motion onTap=press}}></button>
      </template>
    );
    pointerDown(first());
    pointerUp(first());
    await nextFrame();
    assert.strictEqual(press.calls.length, 0);
  });
});

const HALF = { opacity: 0.5 },
  FULL = { opacity: 1 };
const BOX = { width: 100, height: 100, background: 'red' };
