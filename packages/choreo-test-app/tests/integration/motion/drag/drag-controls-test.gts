/**
 * Port of Motion's packages/framer-motion/src/gestures/drag/__tests__/use-drag-controls.test.tsx, the
 * "snapToCursor centres the element under the pointer on every drag start" case (motion@v13.4.6).
 * useDragControls() → createDragControls(). The mocked getBoundingClientRect models a 100×100 element laid
 * out at (500, 0) and offset by its transform; here the element is laid out there in the fixture viewport,
 * and a frame passes after each x.set/y.set so the transform reaches the DOM before the next measurement.
 */
import { on } from '@ember/modifier';
import { render } from '@ember/test-helpers';
import { setupRenderingTest } from 'ember-qunit';
import { createDragControls } from 'glimmer-motion/gestures/drag-controls';
import motion from 'glimmer-motion/motion';
import { motionValue } from 'motion-dom';
import { module, test } from 'qunit';

import { setupFixtureViewport } from '../../../helpers/layout-fixture';
import { nextFrame, pointerUp } from '../../../helpers/motion';

const INITIAL = { x: 100, y: 40 };

module('Integration | motion | useDragControls', function (hooks) {
  setupRenderingTest(hooks);
  setupFixtureViewport(hooks);

  test('snapToCursor centres the element under the pointer on every drag start', async function (assert) {
    const x = motionValue(0);
    const y = motionValue(0);
    const style = {
      x,
      y,
      position: 'absolute',
      top: 0,
      left: 500,
      width: 100,
      height: 100,
    };
    const dragControls = createDragControls();
    const startDrag = (e: PointerEvent) =>
      dragControls.start(e, { snapToCursor: true });

    await render(
      <template>
        <div data-testid="drag-handle" {{on "pointerdown" startDrag}}></div>
        <div
          data-testid="draggable"
          {{motion
            drag=true
            dragControls=dragControls
            dragListener=false
            initial=INITIAL
            style=style
          }}
        ></div>
      </template>
    );
    await nextFrame();

    const handle = document.querySelector("[data-testid='drag-handle']")!;
    const snapTo = (clientX: number, clientY: number) => {
      handle.dispatchEvent(
        new PointerEvent('pointerdown', {
          isPrimary: true,
          bubbles: true,
          clientX,
          clientY,
        })
      );
      pointerUp(handle);
    };

    assert.strictEqual(x.get(), 100);
    assert.strictEqual(y.get(), 40);

    snapTo(50, 50);
    assert.strictEqual(x.get(), -500);
    assert.strictEqual(y.get(), 0);

    // Simulate the element having been dragged elsewhere
    x.set(-350);
    y.set(50);
    await nextFrame();

    snapTo(50, 50);
    assert.strictEqual(x.get(), -500);
    assert.strictEqual(y.get(), 0);
  });
});
