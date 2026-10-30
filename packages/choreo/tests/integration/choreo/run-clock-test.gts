/**
 * A run's clock starts on its first painted frame, and a region can cap how
 * much animation time one frame may advance.
 *
 * The frame loop hands each tick the time since ITS last frame, up to 40 ms,
 * and motion-dom dates a tween from a clock that holds one reading for a
 * whole task. A run's first tick advances nothing and stands every tween it
 * started at the progress it had when the run started, so a run compiled
 * late in a long task does not open that far in, with or without a cap;
 * with `@maxFrameStep`, a long frame in the middle of a move advances it by
 * the cap at most, so a busy page slows a move rather than making it jump.
 */
import { Choreo, type ChoreoContext } from '@cardstack/choreo';
import { setupChoreo } from '@cardstack/choreo/test-support';
import { run } from '@ember/runloop';
import { render, settled } from '@ember/test-helpers';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { setupRenderingTest } from 'ember-qunit';
import { motion } from 'glimmer-motion';
import { time } from 'motion-dom';
import { module, test } from 'qunit';

import { setupFixtureViewport } from '../../helpers/layout-fixture';
import { nextFrame as painted } from '../../helpers/motion';

let stage: Stage | undefined;
let ctx: ChoreoContext | undefined;
const grab = (c: ChoreoContext) => {
  ctx = c;
  return '';
};
const seize = (s: Stage) => {
  stage = s;
};

class Stage extends Component<{
  Args: { maxFrameStep?: number; seize: (self: Stage) => void };
}> {
  @tracked above = 0;
  constructor(
    owner: unknown,
    args: { maxFrameStep?: number; seize: (self: Stage) => void },
  ) {
    super(owner as never, args as never);
    args.seize(this);
  }
  get aboveStyle() {
    return `height:${this.above}px`;
  }
  <template>
    <Choreo
      class='stage'
      style='position:relative'
      @maxFrameStep={{@maxFrameStep}}
      as |c|
    >
      {{grab c}}
      <div style={{this.aboveStyle}}></div>
      <div
        data-box
        style='height:40px;background:#0af'
        {{motion id='box'}}
      ></div>
      <c.Move @of={{c.all}} @duration={{1}} @ease='linear' />
    </Choreo>
  </template>
}

/** how far the box still has to travel: its translate, in px */
function offset(): number {
  let el = document.querySelector('[data-box]') as HTMLElement;
  let transform = getComputedStyle(el).transform;
  if (!transform || transform === 'none') {
    return 0;
  }
  return new DOMMatrix(transform).m42;
}

const nextFrame = () =>
  new Promise((resolve) => requestAnimationFrame(resolve));

/** hold the main thread, as a long render does */
function busy(ms: number) {
  let end = performance.now() + ms;
  while (performance.now() < end) {
    // spin
  }
}

module('Integration | choreo | run clock', function (hooks) {
  setupRenderingTest(hooks);
  setupFixtureViewport(hooks);
  setupChoreo(hooks);

  hooks.afterEach(() => {
    stage = undefined;
    ctx = undefined;
  });

  test("a run's clock advances nothing on the first frame it paints", async function (assert) {
    await render(<template><Stage @seize={{seize}} /></template>);
    await nextFrame();
    // the frame loop's last frame is long gone: its next delta is the cap
    busy(100);
    stage!.above = 200;
    await nextFrame();
    await nextFrame();
    let time = ctx!.run!.time;
    // the run has ticked once: that first tick paints where the run starts
    // and advances nothing. A first tick that took the frame loop's delta
    // would read a whole frame (or up to 40 ms after a long one).
    assert.true(
      time < 0.008,
      `two frames in, the run's clock reads ${(time * 1000).toFixed(1)} ms`,
    );
    await settled();
  });

  test('with @maxFrameStep, a run compiled late in a long task starts on its first painted frame and steps once on the next', async function (assert) {
    await render(
      <template><Stage @seize={{seize}} @maxFrameStep={{16}} /></template>,
    );
    await nextFrame();
    // motion-dom holds one time for a whole task: read it at the task's
    // start, render the change at its end
    time.now();
    busy(120);
    // eslint-disable-next-line ember/no-runloop -- the render has to land in the same task as the stall, which only a synchronous run gives
    run(() => {
      stage!.above = 200;
    });
    // `painted` resolves after the frame's render step: what this frame paints
    await painted();
    let first = offset();
    // 1 s linear over 200 px: dated back 120 ms, the first frame would show
    // 24 px gone
    assert.true(
      Math.abs(first + 200) < 0.5,
      `the first painted frame shows the move at its start (${first.toFixed(1)}px of -200)`,
    );
    await painted();
    let step = offset() - first;
    // 16 ms of a 1 s linear move over 200 px is 3.2 px
    assert.true(
      step > 0 && step <= 3.25,
      `the second frame advances by one step at most (${step.toFixed(2)}px)`,
    );
    await settled();
  });

  test('without @maxFrameStep, a run compiled late in a long task still starts on its first painted frame', async function (assert) {
    await render(<template><Stage @seize={{seize}} /></template>);
    await nextFrame();
    time.now();
    busy(120);
    // eslint-disable-next-line ember/no-runloop -- the render has to land in the same task as the stall, which only a synchronous run gives
    run(() => {
      stage!.above = 200;
    });
    await painted();
    let first = offset();
    assert.true(
      Math.abs(first + 200) < 0.5,
      `the first painted frame shows the move at its start (${first.toFixed(1)}px of -200)`,
    );
    assert.true(
      ctx!.run!.time < 0.001,
      `the run's clock reads ${(ctx!.run!.time * 1000).toFixed(1)} ms on that frame`,
    );
    await painted();
    let step = offset() - first;
    // uncapped, a frame advances by the frame loop's delta, 40 ms (8 px) at most
    assert.true(
      step > 0 && step <= 8.1,
      `the second frame advances by the frame loop's delta at most (${step.toFixed(2)}px)`,
    );
    await settled();
  });

  test('with @maxFrameStep, a resumed run carries its tweens on from where they paused', async function (assert) {
    await render(
      <template><Stage @seize={{seize}} @maxFrameStep={{16}} /></template>,
    );
    stage!.above = 200;
    await painted();
    await painted();
    await painted();
    let run = ctx!.run!;
    run.pause();
    let held = offset();
    assert.true(
      held > -200 && held < -180,
      `paused a few frames in (${held.toFixed(1)}px of -200)`,
    );
    await painted();
    // resumed from a task, the tween's start is dated from the task's held
    // time; the first frame it paints must stand it where it was held
    run.play();
    await painted();
    let resumed = offset();
    assert.true(
      resumed >= held - 0.5 && resumed <= held + 3.25,
      `the first frame after resuming carries on from the hold (${resumed.toFixed(1)}px, held at ${held.toFixed(1)}px)`,
    );
    await settled();
  });

  test('with @maxFrameStep, a long frame mid-move advances the run by the cap at most', async function (assert) {
    await render(
      <template><Stage @seize={{seize}} @maxFrameStep={{16}} /></template>,
    );
    stage!.above = 200;
    await nextFrame();
    await nextFrame();
    let before = offset();
    busy(150);
    await nextFrame();
    let step = offset() - before;
    // 1 s linear over 200 px: 16 ms is 3.2 px; without the cap, 40 ms is 8
    assert.true(
      step > 0 && step < 5,
      `the frame after a 150 ms stall moved ${step.toFixed(1)}px`,
    );
    await settled();
  });
});
