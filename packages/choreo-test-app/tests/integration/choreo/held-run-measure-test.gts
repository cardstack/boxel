/**
 * A run that is HELD must not hide a layout change from the next pass.
 *
 * A host that scrubs a run — the finger driving `run.time` — pauses it and
 * parks it somewhere. A paused run is not idle: it keeps inline width,
 * height and transform on every sprite it owns. The next pass has to decide
 * whether anything changed, and the cheap check it uses (`fastKeep`) reads
 * `offsetWidth`/`offsetHeight` — which are the values the RUN wrote, not the
 * ones the stylesheet now asks for.
 *
 * When the run is parked at the pose it compiled TO, those two agree, and a
 * genuine layout change lands on a pass that declines itself. The score is
 * never recompiled and the new pose never arrives.
 */
import { render, settled } from '@ember/test-helpers';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { setupRenderingTest } from 'ember-qunit';
import { Choreo, type ChoreoContext, motion } from 'glimmer-motion';
import { setupChoreo } from 'glimmer-motion/choreo/test-support';
import { animationsSettled } from 'glimmer-motion/test-support';
import { module, test } from 'qunit';

import { setupFixtureViewport } from '../../helpers/layout-fixture';

let ctx: ChoreoContext | undefined;
let held: Held | undefined;
const seize = (h: Held) => {
  held = h;
};
const grab = (c: ChoreoContext) => {
  ctx = c;
  return '';
};

/** one participant whose resting width is whatever the frame around it is */
class Held extends Component<{ Args: { seize?: (self: Held) => void } }> {
  @tracked width = 100;
  constructor(owner: unknown, args: { seize?: (self: Held) => void }) {
    super(owner as never, args as never);
    args.seize?.(this);
  }
  <template>
    <Choreo class="stage" style="position:relative;width:600px" as |c|>
      {{grab c}}
      <div style="width:{{this.width}}px">
        <div
          data-box
          style="width:100%;height:40px;background:#0af"
          {{motion id="box"}}
        ></div>
      </div>
      <c.Move @of={{c.all}} @duration={{0.4}} @ease="linear" />
    </Choreo>
  </template>
}

/**
 * The box's width as a FRACTION of the frame it fills.
 *
 * The frame is the resting width the stylesheet asks for and the box is
 * `width:100%` of it, so at rest the ratio is 1 whatever the QUnit fixture
 * is scaled by — and mid-flight it is however far the run has carried the
 * box away from that. Absolute pixels would only be measuring the fixture.
 */
const fill = () => {
  const box = document.querySelector<HTMLElement>('[data-box]')!;
  const frame = box.parentElement!;
  return (
    box.getBoundingClientRect().width / frame.getBoundingClientRect().width
  );
};

const frames = (n: number) =>
  new Promise<void>((resolve) => {
    const step = () => (n-- <= 0 ? resolve() : requestAnimationFrame(step));
    requestAnimationFrame(step);
  });

module('Integration | choreo | a held run and the next pass', function (hooks) {
  setupRenderingTest(hooks);
  // ember-testing renders inside a 50%-scaled container; unscale it so a
  // measurement is of the run and not of the harness
  setupFixtureViewport(hooks);
  setupChoreo(hooks);

  test('a layout change lands even when the run is parked at the pose it compiled to', async function (assert) {
    await render(<template><Held @seize={{seize}} /></template>);
    await animationsSettled();

    // pass one: 100 -> 200, then hold the run at its FAR end, which is
    // exactly the resting layout it compiled to
    held!.width = 200;
    await settled();
    const first = ctx?.run;
    assert.ok(first, 'a run compiled for the first change');
    const born =
      `after settled: fill=${fill().toFixed(3)} ` +
      `time=${first!.time.toFixed(3)}/${first!.duration.toFixed(3)} ` +
      `done=${first!.isDone()} parked=${first!.parked}`;
    first!.pause();
    const want = first!.duration - 0.001;
    first!.time = want;
    await frames(3);
    assert.ok(
      Math.abs(first!.time - want) < 0.01,
      `the clock went where it was put: asked ${want.toFixed(3)}, ` +
        `reads ${first!.time.toFixed(3)} of ${first!.duration.toFixed(3)}`
    );
    assert.ok(
      Math.abs(fill() - 1) < 0.02,
      `parked at the far pose (fill ${fill().toFixed(3)}) | ${born}`
    );

    // pass two: the stylesheet now asks for 300. The run is still holding,
    // and what it is holding happens to agree with what it compiled to — so
    // the cheap keep check sees an unchanged layout and can decline the pass
    // outright, and the new pose never compiles.
    held!.width = 300;
    await settled();

    const second = ctx?.run;
    assert.ok(
      second && second !== first,
      'the layout change compiled a NEW run rather than being declined'
    );
    second!.pause();
    second!.time = second!.duration - 0.001;
    await frames(3);
    assert.ok(
      Math.abs(fill() - 1) < 0.02,
      `the new run carries the box to the new resting width ` +
        `(fill ${fill().toFixed(3)})`
    );
  });
  /**
   * The journey a scrubbing host actually makes: more than two poses.
   *
   * A score is compiled from a CHANGESET, and a changeset has exactly two
   * ends — so N poses is N-1 scores, and a host driving a playhead across
   * them swaps the loaded score at each waypoint. Every swap happens while
   * the outgoing run is held at that waypoint, which is precisely the case
   * the fast path used to decline.
   */
  test('a three-pose journey lands every waypoint, in both directions', async function (assert) {
    await render(<template><Held @seize={{seize}} /></template>);
    await animationsSettled();

    /** carry the box to `width` and park the new score at its far end */
    const step = async (width: number) => {
      const before = ctx?.run;
      held!.width = width;
      await settled();
      const run = ctx?.run;
      assert.ok(
        run && run !== before,
        `a score compiled for the step to ${width}`
      );
      run!.pause();
      run!.time = run!.duration - 0.001;
      await frames(3);
      return fill();
    };

    for (const width of [200, 300, 200, 100]) {
      const landed = await step(width);
      assert.ok(
        Math.abs(landed - 1) < 0.02,
        `landed on the ${width} pose (fill ${landed.toFixed(3)})`
      );
    }
  });
});
