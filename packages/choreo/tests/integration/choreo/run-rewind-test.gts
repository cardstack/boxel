/**
 * Scrubbing BACKWARD across several finished cues of one sprite.
 *
 * Each track's `origin` is its own start pose, and a sprite with
 * sequential cues has one origin per cue — each equal to the previous
 * cue's landing. A jump back must stand the sprite on the value the
 * timeline holds AT the playhead: the earliest still-future cue's
 * origin, not whichever origin happens to be restored last.
 */
import { Choreo, type ChoreoContext } from '@cardstack/choreo';
import { setupChoreo } from '@cardstack/choreo/test-support';
import { array } from '@ember/helper';
import { find, render } from '@ember/test-helpers';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { setupRenderingTest } from 'ember-qunit';
import { motion } from 'glimmer-motion';
import { animationsSettled } from 'glimmer-motion/test-support';
import { module, test } from 'qunit';

import { setupFixtureViewport } from '../../helpers/layout-fixture';

let ctx: ChoreoContext;
const grab = (c: ChoreoContext) => {
  ctx = c;
  return '';
};

const frames = (n: number) =>
  new Promise<void>((resolve) => {
    const step = () => (n-- <= 0 ? resolve() : requestAnimationFrame(step));
    requestAnimationFrame(step);
  });

module('Integration | choreo | run rewind', function (hooks) {
  setupRenderingTest(hooks);
  setupFixtureViewport(hooks);
  setupChoreo(hooks);

  test('a jump back lands on the value at the playhead, not the last origin', async function (assert) {
    class App extends Component {
      @tracked take = 0;
      constructor(o: unknown, a: object) {
        super(o as never, a);
        app = this;
      }
      <template>
        <Choreo
          class='stage'
          style='position:relative;width:300px;height:100px'
          as |c|
        >
          {{grab c}}
          <div
            id='walker'
            data-take={{this.take}}
            style='position:absolute;top:20px;left:0;width:20px;height:20px;background:#0af'
            {{motion id='walker'}}
          ></div>
          <c.Sequence>
            <c.Tween
              @of={{c.id 'walker'}}
              @x={{array 10 110}}
              @duration={{0.1}}
            />
            <c.Wait @of={{c.id 'walker'}} @duration={{0.05}} />
            <c.Tween
              @of={{c.id 'walker'}}
              @x={{array 110 210}}
              @duration={{0.1}}
            />
            <c.Wait @of={{c.id 'walker'}} @duration={{0.05}} />
            <c.Tween
              @of={{c.id 'walker'}}
              @x={{array 210 60}}
              @duration={{0.1}}
            />
          </c.Sequence>
        </Choreo>
      </template>
    }
    let app: App | undefined;
    await render(<template><App /></template>);
    await animationsSettled();
    // the first render plays nothing; the bump compiles the score
    app!.take = 1;
    await frames(4);
    const run = ctx.run!;
    assert.ok(run, 'the score compiled into a run');
    run.pause();

    const x = () => (find('#walker') as HTMLElement).style.transform;

    // park at the very end: the last cue's landing stands
    run.time = run.duration;
    await frames(4);
    assert.true(x().includes('60'), `parked at the end — ${x()}`);

    // ONE jump back to zero, across every finished cue: the sprite must
    // stand on the FIRST cue's origin, not the third's
    run.time = 0;
    await frames(4);
    assert.true(
      x().includes('10'),
      `a jump to 0 stands on the opening pose — ${x()}`,
    );

    // and a jump into the gap between cue 1 and cue 2: cue 1's landing
    run.time = 0.125;
    await frames(4);
    assert.true(
      x().includes('110'),
      `mid-gap stands on the previous landing — ${x()}`,
    );

    run.cancel();
    await animationsSettled();
  });
});

/**
 * retreat() — Keynote's back rule as an engine verb (§4.1): land PARKED
 * at the previous gate with everything ahead re-closed, and HOLD. A
 * retreat never plays, a @delay gate reached backwards never opens
 * itself, and the next advance() replays the un-built segment forward.
 */
module('Integration | choreo | retreat', function (hooks) {
  setupRenderingTest(hooks);
  setupFixtureViewport(hooks);
  setupChoreo(hooks);

  let app2: { take: number } | undefined;

  class Deck extends Component {
    @tracked take = 0;
    constructor(o: unknown, a: object) {
      super(o as never, a);
      app2 = this;
    }
    <template>
      <Choreo
        class='stage'
        style='position:relative;width:400px;height:100px'
        as |c|
      >
        {{grab c}}
        <div
          id='builder'
          data-take={{this.take}}
          style='position:absolute;top:20px;left:0;width:20px;height:20px;background:#fa0'
          {{motion id='builder'}}
        ></div>
        <c.Sequence>
          <c.Tween
            @of={{c.id 'builder'}}
            @x={{array 0 100}}
            @duration={{0.15}}
          />
          <c.Gate @delay={{0.2}} />
          <c.Tween
            @of={{c.id 'builder'}}
            @x={{array 100 200}}
            @duration={{0.15}}
          />
          <c.Gate />
          <c.Tween
            @of={{c.id 'builder'}}
            @x={{array 200 300}}
            @duration={{0.15}}
          />
        </c.Sequence>
      </Choreo>
    </template>
  }

  const xOf = () => {
    const el = find('#builder') as HTMLElement;
    const m = new DOMMatrix(getComputedStyle(el).transform);
    return m.e;
  };
  const parked = () =>
    new Promise<void>((resolve) => {
      const look = () =>
        ctx.run && ctx.run.parked ? resolve() : requestAnimationFrame(look);
      look();
    });

  test('a retreat re-closes the gate, and the next advance replays the build', async function (assert) {
    await render(<template><Deck /></template>);
    await animationsSettled();
    app2!.take = 1;
    await frames(2);
    const run = ctx.run!;
    await parked(); // parked at gate 1 (after segment A)... the @delay gate
    run.advance();
    await parked(); // segment B done, parked at gate 2
    assert.true(Math.abs(xOf() - 200) < 2, `built to 200 (${xOf()})`);

    assert.true(run.retreat(), 'there is a build behind');
    await frames(2);
    assert.true(run.parked, 'holding at the previous gate');
    assert.true(
      Math.abs(xOf() - 100) < 2,
      `the un-built segment is un-built (${xOf()})`,
    );

    run.advance();
    await frames(6);
    const mid = xOf();
    assert.true(
      mid > 102 && mid < 198,
      `advance REPLAYS the segment — mid-flight at ${mid}, not a jump`,
    );
    await parked();
    assert.true(Math.abs(xOf() - 200) < 2, `and lands built again (${xOf()})`);
    run.cancel();
    await animationsSettled();
  });

  test('a retreat onto a self-opening gate holds until the user advances', async function (assert) {
    await render(<template><Deck /></template>);
    await animationsSettled();
    app2!.take = 1;
    await frames(2);
    const run = ctx.run!;
    await parked(); // the @delay 0.2 gate — it would open itself going forward
    run.advance();
    await parked(); // at gate 2
    assert.true(run.retreat(), 'stepped back onto the @delay gate');
    // wait well past the gate's 200ms self-open window
    await new Promise((r) => setTimeout(r, 450));
    assert.true(run.parked, 'still parked: a retreat is a HOLD');
    assert.true(
      Math.abs(xOf() - 100) < 2,
      `nothing played on its own (${xOf()})`,
    );
    run.cancel();
    await animationsSettled();
  });

  test('a retreat from the end un-ends the run, and the last build replays', async function (assert) {
    await render(<template><Deck /></template>);
    await animationsSettled();
    app2!.take = 1;
    await frames(2);
    const run = ctx.run!;
    await parked();
    run.advance();
    await parked();
    run.advance();
    await animationsSettled(); // the run finishes past the last gate
    assert.true(run.isDone(), 'the run ended');
    assert.true(run.retreat(), 'and still has a build behind');
    await frames(2);
    assert.true(
      Math.abs(xOf() - 200) < 2,
      `standing before the finale (${xOf()})`,
    );
    run.advance();
    await animationsSettled();
    assert.true(Math.abs(xOf() - 300) < 2, `the finale replayed (${xOf()})`);
    run.cancel();
    await animationsSettled();
  });

  test('nothing behind: retreat declines, so the caller can fall through', async function (assert) {
    await render(<template><Deck /></template>);
    await animationsSettled();
    app2!.take = 1;
    await frames(2);
    const run = ctx.run!;
    await parked(); // at the FIRST gate — no user-built segment behind
    assert.false(run.retreat(), 'the first park has nothing behind it');
    run.cancel();
    await animationsSettled();
  });
});
