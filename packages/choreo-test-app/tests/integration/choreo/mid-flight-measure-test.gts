/**
 * A pass that compiles while the region's camera is MID-FLIGHT must land
 * the same shots as one compiled at rest.
 *
 * The trap: the barrier measures painted geometry (WAAPI-inclusive
 * rects) but the region descaled it by the run's shadow zoom — a frame
 * apart from the paint while a camera cue is flying. Inside a fast cue
 * the two differ wildly, fitted zooms cancel the mismatch but translate
 * targets keep it, and every shot the replacement run lands is shifted
 * by a take-dependent factor (the reel's 4-loop protocol measured whole
 * scores displaced hundreds of pixels per loop). The zoom the measure
 * divides by must come from the painted frame itself.
 */
import { find, render } from '@ember/test-helpers';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { setupRenderingTest } from 'ember-qunit';
import { Choreo, type ChoreoContext, motion } from 'glimmer-motion';
import { animationsSettled } from 'glimmer-motion/test-support';
import { module, test } from 'qunit';

import { setupFixtureViewport } from '../../helpers/layout-fixture';

const frames = (n: number) =>
  new Promise<void>((resolve) => {
    const step = () => (n-- <= 0 ? resolve() : requestAnimationFrame(step));
    requestAnimationFrame(step);
  });

let ctx: ChoreoContext | undefined;
const grab = (c: ChoreoContext) => {
  ctx = c;
  return '';
};

/**
 * A camera flight toward a far subject, long enough to be caught
 * mid-air, then a hold. The extra participant the flip inserts is what
 * forces a replacement pass; the score itself never changes.
 */
class MidFlight extends Component<{
  Args: { seize?: (self: MidFlight) => void };
}> {
  @tracked extra = false;
  @tracked take = 0;
  constructor(owner: unknown, args: { seize?: (self: MidFlight) => void }) {
    super(owner as never, args as never);
    args.seize?.(this);
  }
  <template>
    <Choreo
      class="stage"
      style="position:relative;width:300px;height:200px"
      as |c|
    >
      {{grab c}}
      <div data-take={{this.take}}>
        <div
          data-subject
          style="position:absolute;top:150px;left:240px;width:40px;height:30px;background:#0af"
          {{motion id="subject" role="subject"}}
        ></div>
        {{#if this.extra}}
          <div
            data-extra
            style="position:absolute;top:10px;left:10px;width:20px;height:20px;background:#fa0"
            {{motion id="extra" role="extra"}}
          ></div>
        {{/if}}
      </div>
      <c.Sequence>
        <c.Frame @of={{c.id "subject"}} @padding={{0.7}} @duration={{0.4}} />
        <c.Wait @duration={{0.4}} />
      </c.Sequence>
    </Choreo>
  </template>
}

async function landedPose(flipMidFlight: boolean): Promise<string> {
  ctx = undefined;
  let app: MidFlight | undefined;
  const seize = (self: MidFlight) => (app = self);
  await render(<template><MidFlight @seize={{seize}} /></template>);
  await animationsSettled();
  app!.take = 1;
  if (flipMidFlight) {
    // catch the Frame cue mid-air: the camera is flying on WAAPI when
    // the flip forces the replacement pass
    await frames(3);
    app!.extra = true;
    await frames(2);
  } else {
    // the control: land the flight first, then flip at a standing pose
    await animationsSettled();
    app!.extra = true;
    await frames(2);
  }
  const run = ctx!.run!;
  run.pause();
  run.time = 0.6;
  await frames(2);
  return (find('[data-choreo]') as HTMLElement).style.transform;
}

module('Integration | choreo | mid-flight measure', function (hooks) {
  setupRenderingTest(hooks);
  setupFixtureViewport(hooks);

  test('a replacement compiled mid-camera-flight lands the same shot as one compiled at rest', async function (assert) {
    const atRest = await landedPose(false);
    const midFlight = await landedPose(true);
    const parts = (tf: string) =>
      (tf.match(/[-\d.]+/g) ?? []).map((n) => parseFloat(n));
    const a = parts(atRest);
    const b = parts(midFlight);
    // a mid-flight measure reads the painted zoom, which carries the
    // computed matrix's quantisation — the shots must agree to well under
    // a pixel, not to the byte
    assert.true(
      a.length === b.length &&
        a.every((v, i) => Math.abs(v - (b[i] ?? Infinity)) < 0.1),
      `the landed pose must not depend on when the pass compiled ` +
        `(mid-flight "${midFlight}" vs at-rest "${atRest}")`
    );
  });
});
