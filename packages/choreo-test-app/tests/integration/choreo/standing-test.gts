/**
 * Standing steps — an annotation that is simply ON.
 *
 * `c.Tether`, `c.Hold`, `c.Raise` and `c.Follow` without `@duration` borrow
 * the span of the block they stand in. A timeline of NOTHING BUT those steps
 * has no span to borrow, and the score used to compile to zero: the run ended
 * on the frame it was born and the wire was never drawn. The app that found
 * this faked `ms: 3_600_000` — an hour of clock for a wire that should simply
 * be on.
 *
 * These are the two halves of that: the score with no length of its own keeps
 * its run STANDING, and a standing run survives the render noise of a busy
 * page rather than being torn down and rebuilt on every pass.
 */
import { find, render, settled } from '@ember/test-helpers';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { setupRenderingTest } from 'ember-qunit';
import { Choreo, type ChoreoContext, motion, type Rect } from 'glimmer-motion';
import { animationsSettled, setupMotion } from 'glimmer-motion/test-support';
import { module, test } from 'qunit';

import { setupFixtureViewport } from '../../helpers/layout-fixture';
import { nextFrame } from '../../helpers/motion';

/**
 * Hoisted, as every property function in a timeline must be: the region
 * fingerprints the tree by identity, and a fresh closure per pass reads as
 * an edited timeline.
 */
const line = (a: Rect, b: Rect) =>
  `M ${a.x + a.width} ${a.y + a.height / 2} L ${b.x} ${b.y + b.height / 2}`;

let ctx: ChoreoContext;
const grabCtx = (c: ChoreoContext) => {
  ctx = c;
  return '';
};

const wires = () =>
  [...document.querySelectorAll('[data-choreo-tether]')] as SVGPathElement[];

module('Integration | choreo | standing steps', function (hooks) {
  setupRenderingTest(hooks);
  setupFixtureViewport(hooks);
  setupMotion(hooks);

  class Wired extends Component {
    @tracked noise = 'x';
    constructor(o: unknown, a: object) {
      super(o as never, a);
      app = this;
    }
    <template>
      <Choreo
        class="stage"
        style="position:relative;width:300px;height:200px"
        as |c|
      >
        {{grabCtx c}}
        {{! a neighbour writing tracked state: the render noise a busy page
            makes, and the reflow it pushes through the participants }}
        <div id="noise" style="height:{{this.noise.length}}px">
          {{this.noise}}
        </div>
        <div
          id="a"
          style="width:40px;height:20px;background:#0af"
          {{motion id="a"}}
        ></div>
        <div
          id="b"
          style="margin-left:180px;width:40px;height:20px;background:#fa0"
          {{motion id="b"}}
        ></div>
        <c.Tether
          @from={{c.id "a"}}
          @to={{c.id "b"}}
          @path={{line}}
          @name="w"
        />
      </Choreo>
    </template>
  }
  let app: Wired | undefined;

  /** the region compiles nothing on its first render: a pass is a CHANGE */
  async function arm() {
    await render(<template><Wired /></template>);
    await animationsSettled();
    app!.noise = 'xx';
    await settled();
    await nextFrame();
  }

  test('a timeline of only an open tether keeps its run standing', async function (assert) {
    await arm();
    await animationsSettled();

    assert.strictEqual(wires().length, 1, 'the wire is drawn');
    const run = ctx.run!;
    assert.true(run.standing, 'the run knows it has no length of its own');
    assert.false(run.isDone(), 'and so it has not ended');
    const d = wires()[0]!.getAttribute('d') ?? '';
    assert.true(/^M [\d.]+ [\d.]+ L [\d.]+ [\d.]+$/.test(d), `drawn: ${d}`);
  });

  test('a standing wire survives the render noise of a busy page', async function (assert) {
    await arm();
    await animationsSettled();
    const first = wires()[0]!;
    const run = ctx.run;

    // a re-render that REFLOWS the participants: the fast keep cannot
    // decline this pass, so the recompiled score has to be recognised as
    // the one already standing
    app!.noise = 'xxxxxxxxxx';
    await settled();
    await nextFrame();
    await animationsSettled();

    assert.strictEqual(wires().length, 1, 'still exactly one wire');
    assert.strictEqual(wires()[0], first, 'and it is the SAME path element');
    assert.true(first.isConnected, 'never torn out of the layer');
    assert.strictEqual(ctx.run, run, 'the run was kept, not replaced');
  });

  test('a standing run reports settled — it is on, not busy', async function (assert) {
    await arm();
    // animationsSettled() would hang forever if a standing run counted as
    // flight: this test IS the assertion, and its timeout is the failure
    await animationsSettled();
    assert.false(ctx.run!.isDone(), 'still alive');
    assert.strictEqual(wires().length, 1, 'still drawing');
  });

  test('a wire whose ends move redraws where the ends went', async function (assert) {
    await arm();
    await animationsSettled();
    const before = wires()[0]!.getAttribute('d')!;

    app!.noise = 'xxxxxxxxxxxxxxxxxxxx';
    await settled();
    await nextFrame();
    await nextFrame();
    await animationsSettled();

    const after = wires()[0]!.getAttribute('d')!;
    assert.notStrictEqual(after, before, 'the wire followed the reflow');
    const layer = find('[data-choreo-tethers]') as unknown as SVGSVGElement;
    const inverse = layer.getScreenCTM()!.inverse();
    const a = (find('#a') as HTMLElement).getBoundingClientRect();
    const p = new DOMPoint(a.right, a.top + a.height / 2).matrixTransform(
      inverse
    );
    const m = /M (-?[\d.]+) (-?[\d.]+)/.exec(after)!;
    const err = Math.hypot(Number(m[1]) - p.x, Number(m[2]) - p.y);
    assert.true(err < 2, `the wire starts on its sprite (${err.toFixed(1)}px)`);
  });
});
