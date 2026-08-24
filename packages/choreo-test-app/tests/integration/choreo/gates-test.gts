/**
 * Gates and the run handle (docs/choreo-constructs.md §4.1, §4.6).
 * A gate parks the run; advance() opens it; mid-segment advance is
 * Keynote's click-through — every property lands on its segment-end
 * value. A parked run is a still, and settled.
 */
import { find, render, setupOnerror, settled } from '@ember/test-helpers';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { setupRenderingTest } from 'ember-qunit';
import { Choreo, type ChoreoContext, motion } from 'glimmer-motion';
import { animationsSettled } from 'glimmer-motion/test-support';
import { module, test } from 'qunit';

import { setupFixtureViewport } from '../../helpers/layout-fixture';
import { nextFrame } from '../../helpers/motion';

let app: Fixture;
let ctx: ChoreoContext;

const grab = (c: ChoreoContext) => {
  ctx = c;
  return '';
};

const opacityOf = (sel: string) =>
  parseFloat(getComputedStyle(find(sel)!).opacity);

class Fixture extends Component {
  @tracked step = 0;
  constructor(o: unknown, a: object) {
    super(o as never, a);
    app = this;
  }
  bump = () => this.step++;
  <template>
    <Choreo class="stage" style="width:300px;height:100px" as |c|>
      {{grab c}}
      <div
        id="a"
        data-step={{this.step}}
        style="width:40px;height:40px;background:#0af"
        {{motion id="a" role="card"}}
      ></div>
      <c.Sequence>
        <c.Tween @of={{c.role "card"}} @opacity={{0.5}} @duration={{0.08}} />
        <c.Gate />
        <c.Tween @of={{c.role "card"}} @opacity={{0.1}} @duration={{0.08}} />
      </c.Sequence>
    </Choreo>
  </template>
}

module('Integration | choreo | gates', function (hooks) {
  setupRenderingTest(hooks);
  setupFixtureViewport(hooks);

  test('a run parks at its gate, reads as settled, and advances on advance()', async function (assert) {
    await render(<template><Fixture /></template>);
    await animationsSettled();
    app.bump();
    // the parked run must count as settled, or every gated scene hangs —
    // this is a semantic decision and this assertion is its record
    await animationsSettled();
    const run = ctx.run!;
    assert.true(run.parked, 'parked at the gate');
    assert.strictEqual(run.segment, 0, 'still in the first segment');
    assert.strictEqual(
      opacityOf('#a'),
      0.5,
      'the first segment landed; the second has not started',
    );
    ctx.advance();
    await animationsSettled();
    assert.false(run.parked);
    assert.strictEqual(opacityOf('#a'), 0.1, 'the second segment played');
    assert.true(run.isDone());
  });

  test('advancing mid-segment completes it instantly — every value on its segment-end', async function (assert) {
    await render(<template><Fixture /></template>);
    await animationsSettled();
    app.bump();
    await settled();
    await nextFrame(); // mid-flight in segment one
    ctx.advance();
    assert.strictEqual(
      opacityOf('#a'),
      0.5,
      'click-through lands the exact segment-end value',
    );
    assert.true(ctx.run!.parked, 'and parks at the gate');
    ctx.advance();
    await animationsSettled();
    assert.strictEqual(opacityOf('#a'), 0.1);
  });

  test('setting time is a still; setting it across a gate parks there', async function (assert) {
    await render(<template><Fixture /></template>);
    await animationsSettled();
    app.bump();
    await settled();
    const run = ctx.run!;
    run.pause();
    run.time = 0.04; // mid first tween
    await nextFrame();
    const mid = opacityOf('#a');
    assert.true(mid < 1 && mid > 0.5, `scrubbed mid-flight (${mid})`);
    run.time = 10; // far past the gate
    assert.true(run.parked, 'a seek across a gate parks at the gate');
    assert.strictEqual(run.time, 0.08, 'clamped to the gate, not the end');
    run.time = 0;
    await nextFrame();
    assert.strictEqual(opacityOf('#a'), 1, 'scrubbed back to the first frame');
    ctx.advance();
    await animationsSettled();
  });

  test('a self-opening gate advances without a hand', async function (assert) {
    class Auto extends Component {
      @tracked step = 0;
      constructor(o: unknown, a: object) {
        super(o as never, a);
        app = this as never;
      }
      <template>
        <Choreo class="stage" style="width:300px;height:100px" as |c|>
          <div id="a" data-s={{this.step}} {{motion id="a" role="card"}}></div>
          <c.Sequence>
            <c.Tween @of={{c.role "card"}} @opacity={{0.5}} @duration={{0.05}} />
            <c.Gate @delay={{0.05}} />
            <c.Tween @of={{c.role "card"}} @opacity={{0.1}} @duration={{0.05}} />
          </c.Sequence>
        </Choreo>
      </template>
    }
    await render(<template><Auto /></template>);
    await animationsSettled();
    (app as { step: number }).step++;
    await settled();
    await new Promise((r) => setTimeout(r, 400));
    await animationsSettled();
    assert.strictEqual(opacityOf('#a'), 0.1, 'the gate opened by itself');
  });

  test('a gate inside a parallel fails at compile, named', async function (assert) {
    class Bad extends Component {
      @tracked step = 0;
      constructor(o: unknown, a: object) {
        super(o as never, a);
        app = this as never;
      }
      <template>
        <Choreo class="stage" as |c|>
          <div id="a" data-s={{this.step}} {{motion id="a" role="card"}}></div>
          <c.Parallel>
            <c.Tween @of={{c.role "card"}} @opacity={{0.5}} @duration={{0.05}} />
            <c.Gate />
          </c.Parallel>
        </Choreo>
      </template>
    }
    await render(<template><Bad /></template>);
    await animationsSettled();
    let message = '';
    setupOnerror((error) => {
      message = String(error);
    });
    (app as { step: number }).step++;
    await settled().catch(() => {});
    assert.true(
      /total order/.test(message),
      `the error names the rule (${message})`,
    );
  });
});
