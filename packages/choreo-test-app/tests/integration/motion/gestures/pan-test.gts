/**
 * Port of Motion's packages/framer-motion/src/gestures/__tests__/pan.test.tsx (motion@v13.4.6).
 * MockDrag's pointer is the Cypress-style trigger() on a real element; React state becomes a tracked property.
 * jest.spyOn(performance, 'now') → an own `now` on `performance`, deleted after each test to expose the prototype's again.
 */
import { render } from '@ember/test-helpers';
import { setupRenderingTest } from 'ember-qunit';
import motion from 'glimmer-motion/motion';
import { MotionConfig } from 'glimmer-motion/motion-config';
import type { PanInfo } from 'motion-dom';
import { module, test } from 'qunit';

import { trigger } from '../../../helpers/layout-fixture';
import {
  nextFrame,
  pointerDown,
  pointerMove,
  pointerUp,
  spy,
} from '../../../helpers/motion';

const BOX = { width: 100, height: 100, background: 'red' };
const el = () => document.querySelector('#el')!;

module('Integration | motion | pan', function (hooks) {
  setupRenderingTest(hooks);
  // runs even when a test times out waiting on a gesture that never ends
  hooks.afterEach(function () {
    delete (performance as { now?: unknown }).now;
  });

  test("pan handlers aren't frozen at pan session start", async function (assert) {
    let count = 0,
      increment = 0;
    const done = new Promise<void>((resolve) => {
      (window as any).__panEnd = resolve;
    });
    const onPanStart = () => {
      count += increment;
      increment = 2;
    };
    const onPan = () => {
      count += increment;
    };
    const onPanEnd = () => {
      count += increment;
      (window as any).__panEnd();
    };
    await render(
      <template>
        <div
          id="el"
          {{motion
            onPanStart=onPanStart
            onPan=onPan
            onPanEnd=onPanEnd
            style=BOX
          }}
        ></div>
      </template>
    );
    trigger(el(), 'pointerdown', 10, 10);
    trigger(el(), 'pointermove', 110, 110);
    await nextFrame();
    trigger(el(), 'pointermove', 60, 60);
    await nextFrame();
    trigger(el(), 'pointerup');
    await done;
    assert.true(count > 0, `count ${count}`);
  });

  test('onPanStart fires before onPan', async function (assert) {
    const events: string[] = [];
    const done = new Promise<void>((resolve) => {
      (window as any).__panEnd = resolve;
    });
    const onPanStart = () => events.push('start');
    const onPan = () => events.push('pan');
    const onPanEnd = () => {
      events.push('end');
      (window as any).__panEnd();
    };
    await render(
      <template>
        <div
          id="el"
          {{motion
            onPanStart=onPanStart
            onPan=onPan
            onPanEnd=onPanEnd
            style=BOX
          }}
        ></div>
      </template>
    );
    trigger(el(), 'pointerdown', 10, 10);
    trigger(el(), 'pointermove', 110, 110);
    await nextFrame();
    trigger(el(), 'pointerup');
    await done;
    const startIndex = events.indexOf('start'),
      firstPanIndex = events.indexOf('pan');
    assert.true(startIndex >= 0);
    assert.true(firstPanIndex >= 0);
    assert.true(startIndex < firstPanIndex);
  });

  test("onPanEnd doesn't fire unless onPanStart has", async function (assert) {
    const onPanStart = spy(),
      onPanEnd = spy();
    await render(
      <template>
        <div
          id="el"
          {{motion onPanStart=onPanStart onPanEnd=onPanEnd style=BOX}}
        ></div>
      </template>
    );
    trigger(el(), 'pointerdown', 10, 10);
    trigger(el(), 'pointermove', 11, 11);
    await nextFrame();
    trigger(el(), 'pointerup');
    await nextFrame();
    assert.strictEqual(onPanStart.calls.length, 0);
    assert.strictEqual(onPanEnd.calls.length, 0);
  });

  test('velocity includes a pointermove that arrives in the same frame as pointerup', async function (assert) {
    let now = 0;
    Object.defineProperty(performance, 'now', {
      configurable: true,
      value: () => now,
    });
    const pos = { x: 0, y: 0 };
    const transformPagePoint = () => pos;
    let resolveEnd: (info: PanInfo) => void;
    const ended = new Promise<PanInfo>((resolve) => {
      resolveEnd = resolve;
    });
    const onPanEnd = (_: PointerEvent, info: PanInfo) => resolveEnd(info);

    await render(
      <template>
        <MotionConfig @transformPagePoint={{transformPagePoint}}>
          <div id="el" {{motion onPanEnd=onPanEnd}}></div>
        </MotionConfig>
      </template>
    );
    await nextFrame();
    pointerDown(el());

    now = 1000;
    pos.x = 10;
    pointerMove(document.body);
    await nextFrame();

    now = 1050;
    pos.x = 60;
    pointerMove(document.body);
    pointerUp(el());

    const { offset, velocity } = await ended;
    assert.strictEqual(offset.x, 60);
    // 50px between the last two moves, 50ms apart
    assert.strictEqual(velocity.x, 1000);
  });
});
