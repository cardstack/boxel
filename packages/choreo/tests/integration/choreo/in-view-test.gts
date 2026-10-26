/**
 * `@inView`: a region inside a scroller wires only what can be seen, or what
 * a move may bring on screen, and leaves the rest to layout. A load or a
 * jump is not a change: it lands as layout puts it.
 */
import { Choreo } from '@cardstack/choreo';
import { setupChoreo } from '@cardstack/choreo/test-support';
import { array, concat } from '@ember/helper';
import { render, settled } from '@ember/test-helpers';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { setupRenderingTest } from 'ember-qunit';
import { motion } from 'glimmer-motion';
import { module, test } from 'qunit';

import { setupFixtureViewport } from '../../helpers/layout-fixture';

let stage: Stage | undefined;
const seize = (s: Stage) => {
  stage = s;
};

const ROWS = Array.from({ length: 40 }, (_, i) => i);

class Stage extends Component<{
  Args: { idle?: boolean; inView?: boolean; seize: (self: Stage) => void };
}> {
  @tracked above = 0;
  @tracked rows = ROWS;
  constructor(
    owner: unknown,
    args: { idle?: boolean; inView?: boolean; seize: (self: Stage) => void },
  ) {
    super(owner as never, args as never);
    args.seize(this);
  }
  get inView() {
    return this.args.inView ?? true;
  }
  get aboveStyle() {
    return `height:${this.above}px`;
  }
  <template>
    <div data-scroller style='height:200px;overflow-y:auto'>
      <Choreo @inView={{this.inView}} @idle={{@idle}} as |c|>
        <div style={{this.aboveStyle}}></div>
        {{#each this.rows as |row|}}
          <div
            data-row={{row}}
            style='height:50px'
            {{motion id=(concat 'row-' row) role='row'}}
          ></div>
        {{/each}}
        <c.Move @of={{c.moved 'row'}} @duration={{1}} @ease='linear' />
        <c.Tween
          @of={{c.inserted 'row'}}
          @opacity={{array 0 1}}
          @duration={{1}}
        />
      </Choreo>
    </div>
  </template>
}

function moving(row: number): boolean {
  let el = document.querySelector(`[data-row="${row}"]`) as HTMLElement;
  let t = getComputedStyle(el).transform;
  return !!t && t !== 'none' && new DOMMatrix(t).m42 !== 0;
}

const nextFrame = () =>
  new Promise((resolve) => requestAnimationFrame(resolve));

module('Integration | choreo | in view', function (hooks) {
  setupRenderingTest(hooks);
  setupFixtureViewport(hooks);
  setupChoreo(hooks);

  hooks.afterEach(() => {
    stage = undefined;
  });

  test('a move animates the rows near the view and leaves far ones to layout', async function (assert) {
    await render(<template><Stage @seize={{seize}} /></template>);
    // the observer reports after a frame
    await nextFrame();
    await nextFrame();
    stage!.above = 60;
    await nextFrame();
    await nextFrame();
    assert.true(moving(0), 'a row in view glides');
    assert.true(moving(7), 'a row within a view below glides in');
    assert.false(moving(30), 'a row far below is not wired: layout places it');
    await settled();
  });

  test('a jump farther than the margin lands as layout puts it', async function (assert) {
    await render(<template><Stage @seize={{seize}} /></template>);
    await nextFrame();
    await nextFrame();
    stage!.above = 900;
    await nextFrame();
    await nextFrame();
    assert.false(moving(0), 'nothing flies past rows that were never wired');
    await settled();
  });

  test('a region that starts idle does not play its first rows as arrivals on waking', async function (assert) {
    class Host {
      @tracked idle = true;
    }
    const host = new Host();
    await render(
      <template><Stage @seize={{seize}} @idle={{host.idle}} /></template>,
    );
    host.idle = false;
    await nextFrame();
    let el = document.querySelector('[data-row="0"]') as HTMLElement;
    assert.strictEqual(
      getComputedStyle(el).opacity,
      '1',
      'the first render is not an arrival',
    );
    await settled();
  });

  test('switched on after the first render, it wires the rows near the view', async function (assert) {
    class Host {
      @tracked inView = false;
    }
    const host = new Host();
    await render(
      <template><Stage @seize={{seize}} @inView={{host.inView}} /></template>,
    );
    host.inView = true;
    await settled();
    stage!.above = 60;
    await nextFrame();
    await nextFrame();
    assert.true(moving(0), 'a row in view glides');
    assert.false(moving(30), 'a row far below is not wired');
    await settled();
  });
});
