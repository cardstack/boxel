/**
 * Scrubbing BACKWARD across several finished cues of one sprite.
 *
 * Each track's `origin` is its own start pose, and a sprite with
 * sequential cues has one origin per cue — each equal to the previous
 * cue's landing. A jump back must stand the sprite on the value the
 * timeline holds AT the playhead: the earliest still-future cue's
 * origin, not whichever origin happens to be restored last.
 */
import { array } from '@ember/helper';
import { find, render } from '@ember/test-helpers';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { setupRenderingTest } from 'ember-qunit';
import { Choreo, type ChoreoContext, motion } from 'glimmer-motion';
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

  test('a jump back lands on the value at the playhead, not the last origin', async function (assert) {
    class App extends Component {
      @tracked take = 0;
      constructor(o: unknown, a: object) {
        super(o as never, a);
        app = this;
      }
      <template>
        <Choreo
          class="stage"
          style="position:relative;width:300px;height:100px"
          as |c|
        >
          {{grab c}}
          <div
            id="walker"
            data-take={{this.take}}
            style="position:absolute;top:20px;left:0;width:20px;height:20px;background:#0af"
            {{motion id="walker"}}
          ></div>
          <c.Sequence>
            <c.Tween
              @of={{c.id "walker"}}
              @x={{array 10 110}}
              @duration={{0.1}}
            />
            <c.Wait @of={{c.id "walker"}} @duration={{0.05}} />
            <c.Tween
              @of={{c.id "walker"}}
              @x={{array 110 210}}
              @duration={{0.1}}
            />
            <c.Wait @of={{c.id "walker"}} @duration={{0.05}} />
            <c.Tween
              @of={{c.id "walker"}}
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
      `a jump to 0 stands on the opening pose — ${x()}`
    );

    // and a jump into the gap between cue 1 and cue 2: cue 1's landing
    run.time = 0.125;
    await frames(4);
    assert.true(
      x().includes('110'),
      `mid-gap stands on the previous landing — ${x()}`
    );

    run.cancel();
    await animationsSettled();
  });
});
