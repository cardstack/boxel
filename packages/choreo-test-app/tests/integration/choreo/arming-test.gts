/**
 * `createArming()` — the crossing's lifecycle, as a library part.
 *
 * A host that has to KNOW a scene change is under way (to gate entrances, to
 * hold back a heavy mount until the landing) needs a flag that arms before the
 * run exists and stands down after the run that survives has settled. The
 * subtle parts are all in "the run that survives": the run is born a render
 * later than the decision to cross, a real interruption REPLACES it mid-flight
 * and the replacement must inherit the watch, and a transition that produced
 * no pass at all must still stand the flag down.
 *
 * The gallery hand-copied that machinery, and so did the app that was ported
 * onto this engine — the second copy is what made it a library part.
 */
import { render, settled } from '@ember/test-helpers';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { setupRenderingTest } from 'ember-qunit';
import {
  Choreo,
  type ChoreoContext,
  createArming,
  motion,
  type SpringSpec,
} from 'glimmer-motion';
import { setupChoreo } from 'glimmer-motion/choreo/test-support';
import { animationsSettled } from 'glimmer-motion/test-support';
import { module, test } from 'qunit';

import { setupFixtureViewport } from '../../helpers/layout-fixture';
import { nextFrame, sleep } from '../../helpers/motion';

const SLOW: SpringSpec = { damping: 26, stiffness: 60 };

let ctx: ChoreoContext;
const grabCtx = (c: ChoreoContext) => {
  ctx = c;
  return '';
};

module('Integration | choreo | arming', function (hooks) {
  setupRenderingTest(hooks);
  setupFixtureViewport(hooks);
  setupChoreo(hooks);

  class Board extends Component {
    @tracked far = false;
    constructor(o: unknown, a: object) {
      super(o as never, a);
      app = this;
    }
    <template>
      <Choreo
        class="stage"
        style="position:relative;width:400px;height:200px"
        as |c|
      >
        {{grabCtx c}}
        <div
          id="card"
          style="position:absolute;top:{{if this.far 140 10}}px;left:{{if
            this.far
            300
            10
          }}px;width:60px;height:40px;background:#0af"
          {{motion id="card" role="card"}}
        ></div>
        <c.Move @of={{c.moved "card"}} @spring={{SLOW}} />
      </Choreo>
    </template>
  }
  let app: Board | undefined;

  test('an arming stands up before the run exists and down when it settles', async function (assert) {
    const crossing = createArming();
    await render(<template><Board /></template>);
    await animationsSettled();

    assert.false(crossing.active(), 'nothing armed');
    crossing.begin(ctx);
    assert.true(crossing.active(), 'armed BEFORE the pass — no run yet');
    assert.strictEqual(ctx.run, null, 'and there is genuinely no run');

    app!.far = true;
    await settled();
    await nextFrame();
    assert.true(crossing.active(), 'still armed while the flight is aloft');

    await animationsSettled();
    await sleep(50);
    assert.false(crossing.active(), 'stood down when the run settled');
  });

  test('settled() resolves with the crossing, and at once when none is armed', async function (assert) {
    const crossing = createArming();
    await render(<template><Board /></template>);
    await animationsSettled();

    let landed = false;
    await crossing.settled();
    assert.true(true, 'an unarmed settled() resolves immediately');

    crossing.begin(ctx);
    void crossing.settled().then(() => (landed = true));
    app!.far = true;
    await settled();
    await nextFrame();
    assert.false(landed, 'not yet');

    await animationsSettled();
    await sleep(50);
    assert.true(landed, 'the waiter was released on the settle');
  });

  test('a run replaced mid-flight hands the watch to its successor', async function (assert) {
    const crossing = createArming();
    await render(<template><Board /></template>);
    await animationsSettled();

    crossing.begin(ctx);
    app!.far = true;
    await settled();
    await nextFrame();
    const first = ctx.run;
    assert.ok(first, 'a run is aloft');

    // interrupt: a second change recompiles the score and replaces the run
    app!.far = false;
    await settled();
    await nextFrame();
    assert.notStrictEqual(ctx.run, first, 'the run was replaced');
    assert.true(crossing.active(), 'the arming did not stand down on the swap');

    await animationsSettled();
    await sleep(50);
    assert.false(crossing.active(), 'it stood down with the SURVIVING run');
  });

  test('a crossing that never produced a run stands down on the deadline', async function (assert) {
    const crossing = createArming({ deadline: 60 });
    await render(<template><Board /></template>);
    await animationsSettled();

    crossing.begin(ctx);
    assert.true(crossing.active(), 'armed');
    await crossing.settled();
    assert.false(crossing.active(), 'the backstop stood it down');
  });

  test('end() stands an arming down by hand, and runs the host hook', async function (assert) {
    let downs = 0;
    const crossing = createArming({ onStandDown: () => (downs += 1) });
    await render(<template><Board /></template>);
    await animationsSettled();

    crossing.begin(ctx);
    crossing.end();
    assert.false(crossing.active(), 'stood down');
    assert.strictEqual(downs, 1, 'the host was told');

    // a stale run must not stand a NEWER arming down
    crossing.begin(ctx);
    app!.far = true;
    await settled();
    await nextFrame();
    assert.true(crossing.active(), 're-armed for the second pass');
    await animationsSettled();
    await sleep(50);
    assert.false(crossing.active());
    assert.strictEqual(downs, 2, 'told once per stand-down');
  });
});
