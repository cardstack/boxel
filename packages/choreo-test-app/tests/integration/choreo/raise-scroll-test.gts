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
import { setupChoreo } from 'glimmer-motion/choreo/test-support';
import { animationsSettled } from 'glimmer-motion/test-support';
import { module, test } from 'qunit';

import { setupFixtureViewport } from '../../helpers/layout-fixture';
import { nextFrame } from '../../helpers/motion';

module('Integration | choreo | raise and scroll', function (hooks) {
  setupRenderingTest(hooks);
  setupFixtureViewport(hooks);
  setupChoreo(hooks);

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

  /**
   * A promotion is a move between two parents, and every number it writes is
   * a LOCAL pixel — but the boxes it reads are client rects, which carry
   * every transform above them. Where the region is being scaled by
   * something outside it (a page crossing carrying the whole demo; a camera
   * zoom, which is the same transform one element higher), a difference of
   * two client rects written back as a local offset is the scale applied
   * twice, and the sprite jumps the moment it is lifted. The eye reads that
   * as the raise itself being wrong.
   */
  test('a raise inside a scaled ancestor does not move the sprite', async function (assert) {
    class App extends Component {
      @tracked step = 0;
      constructor(o: unknown, a: object) {
        super(o as never, a);
        app = this;
      }
      <template>
        {{! the crossing, reduced to the one wrapper that matters }}
        <div style="transform:scale(0.5);transform-origin:0 0">
          <Choreo
            class="stage"
            style="position:relative;width:400px;height:300px"
            as |c|
          >
            <div
              id="clip2"
              style="overflow:hidden;margin:60px 0 0 120px;width:80px;height:40px"
            >
              <div
                id="lift2"
                data-s={{this.step}}
                style="width:60px;height:30px;background:#fa0"
                {{motion id="lift2" role="card"}}
              ></div>
            </div>
            <c.Parallel>
              <c.Raise @of={{c.role "card"}} />
              <c.Tween
                @of={{c.role "card"}}
                @opacity={{0.9}}
                @duration={{0.6}}
              />
            </c.Parallel>
          </Choreo>
        </div>
      </template>
    }
    let app: App | undefined;
    await render(<template><App /></template>);
    await animationsSettled();
    const el = find('#lift2') as HTMLElement;
    const before = el.getBoundingClientRect();

    app!.step = 1;
    await settled();
    await nextFrame();
    assert.ok(el.closest('[data-choreo-raised]'), 'promoted');

    const after = el.getBoundingClientRect();
    for (const key of ['left', 'top', 'width', 'height'] as const) {
      assert.true(
        Math.abs(after[key] - before[key]) < 1,
        `${key} unchanged by the lift (${before[key]} → ${after[key]})`
      );
    }

    const seat = document.querySelector('#clip2 [aria-hidden]') as HTMLElement;
    const seatBox = seat.getBoundingClientRect();
    assert.true(
      Math.abs(seatBox.width - before.width) < 1 &&
        Math.abs(seatBox.height - before.height) < 1,
      'and the placeholder holds a seat the same size as the sprite'
    );
    await animationsSettled();
  });

  /**
   * The same external-scale rule the raise learned: a scroll target is
   * computed from client rects but written as scrollTop/scrollLeft,
   * which are LAYOUT pixels. Inside a scaled ancestor the rect deltas
   * carry the scale and the landing misses by exactly that factor.
   */
  test('a scroll inside a scaled ancestor still lands the sprite at @align', async function (assert) {
    class App extends Component {
      @tracked cited = 0;
      constructor(o: unknown, a: object) {
        super(o as never, a);
        app = this;
      }
      <template>
        {{! the crossing, reduced to the one wrapper that matters }}
        <div style="transform:scale(0.5);transform-origin:0 0">
          <Choreo class="stage" style="position:relative;width:200px" as |c|>
            <div id="scroller2" style="overflow-y:scroll;height:100px">
              {{#each (array 0 1 2 3 4 5 6 7 8 9) as |i|}}
                <div
                  id="srow-{{i}}"
                  data-c={{this.cited}}
                  style="height:40px"
                  {{motion id=(concat "srow-" i) role="srow"}}
                >row {{i}}</div>
              {{/each}}
            </div>
            <c.Sequence>
              <c.Scroll
                @of={{c.id "srow-8"}}
                @align="center"
                @duration={{0.08}}
              />
            </c.Sequence>
          </Choreo>
        </div>
      </template>
    }
    let app: App | undefined;
    await render(<template><App /></template>);
    await animationsSettled();
    const scroller = find('#scroller2') as HTMLElement;
    assert.strictEqual(scroller.scrollTop, 0);
    app!.cited = 1;
    await animationsSettled();
    // the same landing as the unscaled case: scroll coordinates are
    // layout pixels, and the wrapper's scale must cancel out of them
    assert.strictEqual(
      Math.round(scroller.scrollTop),
      290,
      'the container ends with the sprite centered, scale cancelled'
    );
    const rBox = (find('#srow-8') as HTMLElement).getBoundingClientRect();
    const cBox = scroller.getBoundingClientRect();
    assert.true(
      Math.abs(rBox.top + rBox.height / 2 - (cBox.top + cBox.height / 2)) < 3,
      'and the sprite truly sits at the viewport centre'
    );
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
