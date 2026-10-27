/**
 * A run's clock starts on its first painted frame, and a region can cap how
 * much animation time one frame may advance.
 *
 * The frame loop hands each tick the time since ITS last frame, up to 40 ms.
 * A run's first tick advances nothing, so the run does not open with that
 * whole step; with `@maxFrameStep`, a long frame in the middle of a move
 * advances it by the cap at most, so a busy page slows a move rather than
 * making it jump.
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

  test('with @maxFrameStep, a run started late in a long task starts on its first frame', async function (assert) {
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
    await nextFrame();
    // 1 s linear over 200 px: dated back 120 ms, the first frame would show
    // 24 px gone
    assert.true(
      offset() < -190,
      `the first frame shows the move at its start (${offset().toFixed(1)}px of -200)`,
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
