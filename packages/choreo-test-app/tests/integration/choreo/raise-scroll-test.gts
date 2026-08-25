/**
 * c.Raise and c.Scroll (docs/choreo-constructs.md §6.1, §6.3).
 * A raise escapes stacking contexts and clips on a real layer, with the
 * slot held by a placeholder; a scroll occupies the sequence and yields
 * to the user's own wheel.
 */
import { array, concat } from '@ember/helper';
import { find, render, settled } from '@ember/test-helpers';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { setupRenderingTest } from 'ember-qunit';
import { Choreo, motion } from 'glimmer-motion';
import { animationsSettled } from 'glimmer-motion/test-support';
import { module, test } from 'qunit';

import { setupFixtureViewport } from '../../helpers/layout-fixture';
import { nextFrame } from '../../helpers/motion';

module('Integration | choreo | raise and scroll', function (hooks) {
  setupRenderingTest(hooks);
  setupFixtureViewport(hooks);

  test('a raised sprite escapes its clipping ancestor for the span, then goes home', async function (assert) {
    class App extends Component {
      @tracked step = 0;
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
          <div id="clipper" style="overflow:hidden;width:80px;height:40px">
            <div
              id="lifted"
              data-s={{this.step}}
              style="width:60px;height:30px;background:#fa0"
              {{motion id="lifted" role="card"}}
            ></div>
          </div>
          <c.Sequence>
            <c.Parallel>
              <c.Raise @of={{c.role "card"}} @shadow={{true}} />
              <c.Tween
                @of={{c.role "card"}}
                @opacity={{0.9}}
                @duration={{0.1}}
              />
            </c.Parallel>
          </c.Sequence>
        </Choreo>
      </template>
    }
    let app: App | undefined;
    await render(<template><App /></template>);
    await animationsSettled();
    app!.step = 1;
    await settled();
    await nextFrame();
    const el = find('#lifted') as HTMLElement;
    assert.ok(
      el.closest('[data-choreo-raised]'),
      'promoted to the elevated layer for the span'
    );
    assert.ok(
      document.querySelector('#clipper [aria-hidden]'),
      'a placeholder holds the slot'
    );
    assert.true(
      el.style.filter.includes('drop-shadow'),
      'the shadow casts on the layer below'
    );
    await animationsSettled();
    const home = find('#lifted') as HTMLElement;
    assert.strictEqual(
      home.parentElement!.id,
      'clipper',
      'restored exactly where it was'
    );
    assert.notOk(document.querySelector('#clipper [aria-hidden]'));
    assert.strictEqual(home.style.filter, '', 'the costume comes off');
  });

  test('a scroll step lands the sprite at @align and occupies the sequence', async function (assert) {
    class App extends Component {
      @tracked cited = 0;
      constructor(o: unknown, a: object) {
        super(o as never, a);
        app = this;
      }
      <template>
        <Choreo class="stage" style="position:relative;width:200px" as |c|>
          <div id="scroller" style="overflow-y:scroll;height:100px">
            {{#each (array 0 1 2 3 4 5 6 7 8 9) as |i|}}
              <div
                id="row-{{i}}"
                data-c={{this.cited}}
                style="height:40px"
                {{motion id=(concat "row-" i) role="row"}}
              >row {{i}}</div>
            {{/each}}
          </div>
          <c.Sequence>
            <c.Scroll @of={{c.id "row-8"}} @align="center" @duration={{0.08}} />
            <c.Hold
              @of={{c.id "row-8"}}
              @outline="2px solid red"
              @duration={{0.05}}
            />
          </c.Sequence>
        </Choreo>
      </template>
    }
    let app: App | undefined;
    await render(<template><App /></template>);
    await animationsSettled();
    const scroller = find('#scroller') as HTMLElement;
    assert.strictEqual(scroller.scrollTop, 0);
    app!.cited = 1;
    await animationsSettled();
    // row-8 spans 320..360 of 400; centered in a 100px viewport → 290
    assert.strictEqual(
      Math.round(scroller.scrollTop),
      290,
      'the container ends with the sprite centered'
    );
  });
});
