import { Choreo, type ChoreoContext } from '@cardstack/choreo';
import { setupChoreo } from '@cardstack/choreo/test-support';
import { array } from '@ember/helper';
import { find, render } from '@ember/test-helpers';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { setupRenderingTest } from 'ember-qunit';
import { motion } from 'glimmer-motion';
import { module, test } from 'qunit';

import { nextFrame } from '../../helpers/motion';

/** the ambient loop's platform animation, and where it is in its cycle */
function loopOn(element: HTMLElement) {
  const animation = element.getAnimations()[0]!;
  const cycle = Number(animation.effect!.getComputedTiming().duration);
  const time = Number(animation.currentTime);
  return { animation, cycle, phase: (time % cycle) / cycle };
}

module('Integration | choreo | ambient loop retime', function (hooks) {
  setupRenderingTest(hooks);
  setupChoreo(hooks);

  test('an edited loop duration lands on the running loop and keeps its phase', async function (assert) {
    let ctx: ChoreoContext;
    let app: App;
    const grab = (c: ChoreoContext) => {
      ctx = c;
      return '';
    };
    class App extends Component {
      @tracked duration = 4;
      @tracked ready = false;
      constructor(owner: unknown, args: object) {
        super(owner as never, args);
        app = this;
      }
      <template>
        <Choreo as |c|>
          {{grab c}}
          <div data-test-looping {{motion id='looping'}}>●</div>
          {{#if this.ready}}
            <c.Tween
              @of={{c.id 'looping'}}
              @x={{array 0 100 0}}
              @duration={{this.duration}}
              @ease='linear'
              @repeat={{Infinity}}
            />
          {{/if}}
        </Choreo>
      </template>
    }
    await render(<template><App /></template>);
    await nextFrame();
    app!.ready = true;
    await nextFrame();
    await nextFrame();
    const element = find('[data-test-looping]') as HTMLElement;
    const first = ctx!.run!;
    // a run of nothing but ambient loops has no length of its own: each loop
    // goes round on its platform animation's clock, so a second of playing
    // is a second on that clock
    loopOn(element).animation.currentTime = 1000;
    const before = loopOn(element);
    assert.strictEqual(before.cycle, 4000, 'the loop starts on its 4s cycle');
    assert.ok(
      Math.abs(before.phase - 0.25) < 0.01,
      `a quarter of the way round (${before.phase})`,
    );

    app!.duration = 8;
    await nextFrame();
    await nextFrame();
    assert.notStrictEqual(ctx!.run, first, 'the edit replaced the run');
    const after = loopOn(element);
    assert.strictEqual(element.getAnimations().length, 1, 'one loop, not two');
    assert.strictEqual(after.cycle, 8000, 'the loop now takes 8s a cycle');
    assert.ok(
      Math.abs(after.phase - 0.25) < 0.02,
      `the loop carried on from a quarter of the way round (${after.phase})`,
    );
  });

  test('a render elsewhere on the page leaves a run of loops playing as it was', async function (assert) {
    let ctx: ChoreoContext;
    let app: App;
    const grab = (c: ChoreoContext) => {
      ctx = c;
      return '';
    };
    class App extends Component {
      @tracked elsewhere = 0;
      @tracked ready = false;
      constructor(owner: unknown, args: object) {
        super(owner as never, args);
        app = this;
      }
      <template>
        <p>{{this.elsewhere}}</p>
        <Choreo as |c|>
          {{grab c}}
          <div data-test-looping {{motion id='looping'}}>●</div>
          {{#if this.ready}}
            <c.Tween
              @of={{c.id 'looping'}}
              @x={{array 0 100 0}}
              @duration={{4}}
              @ease='linear'
              @repeat={{Infinity}}
            />
          {{/if}}
        </Choreo>
      </template>
    }
    await render(<template><App /></template>);
    await nextFrame();
    app!.ready = true;
    await nextFrame();
    await nextFrame();
    const element = find('[data-test-looping]') as HTMLElement;
    const run = ctx!.run!;
    const { animation } = loopOn(element);
    animation.currentTime = 1000;

    app!.elsewhere++;
    await nextFrame();
    await nextFrame();
    assert.strictEqual(ctx!.run, run, 'the run was kept');
    assert.strictEqual(
      loopOn(element).animation,
      animation,
      'the loop is the same animation',
    );
    assert.strictEqual(element.getAnimations().length, 1, 'one loop, not two');
    assert.ok(
      Number(animation.currentTime) >= 1000,
      `the loop went on from where it was (${animation.currentTime})`,
    );
  });

  test('a loop the new run starts on a different sprite starts from its own beginning', async function (assert) {
    let app: App;
    class App extends Component {
      @tracked target = 'one';
      @tracked ready = false;
      constructor(owner: unknown, args: object) {
        super(owner as never, args);
        app = this;
      }
      <template>
        <Choreo as |c|>
          <div data-test-one {{motion id='one'}}>●</div>
          <div data-test-two {{motion id='two'}}>●</div>
          {{#if this.ready}}
            <c.Tween
              @of={{c.id this.target}}
              @x={{array 0 100 0}}
              @duration={{4}}
              @ease='linear'
              @repeat={{Infinity}}
            />
          {{/if}}
        </Choreo>
      </template>
    }
    await render(<template><App /></template>);
    await nextFrame();
    app!.ready = true;
    await nextFrame();
    await nextFrame();
    loopOn(find('[data-test-one]') as HTMLElement).animation.currentTime = 1000;

    app!.target = 'two';
    await nextFrame();
    await nextFrame();
    const two = find('[data-test-two]') as HTMLElement;
    assert.ok(
      loopOn(two).phase < 0.05,
      `a loop no prior run was playing starts at the top (${loopOn(two).phase})`,
    );
  });
});
