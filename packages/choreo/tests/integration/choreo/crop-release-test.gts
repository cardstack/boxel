/**
 * A crop is a clip while it runs, and nothing once it lands.
 *
 * `@size='crop'` shows a size change through a clip-path that ends at
 * inset(0px 0px 0px 0px). Left on the element, that clip cuts whatever the
 * element draws outside its box (a focus ring, a shadow, an inset that
 * hangs into a gutter) for as long as the element lives.
 */
import { Choreo, type ChoreoContext } from '@cardstack/choreo';
import { setupChoreo } from '@cardstack/choreo/test-support';
import { array } from '@ember/helper';
import { render, settled } from '@ember/test-helpers';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { setupRenderingTest } from 'ember-qunit';
import { motion } from 'glimmer-motion';
import { animationsSettled } from 'glimmer-motion/test-support';
import { module, test } from 'qunit';

import { setupFixtureViewport } from '../../helpers/layout-fixture';

let stage: Stage | undefined;
const seize = (s: Stage) => {
  stage = s;
};

class Stage extends Component<{ Args: { seize: (self: Stage) => void } }> {
  @tracked tall = false;
  constructor(owner: unknown, args: { seize: (self: Stage) => void }) {
    super(owner as never, args as never);
    args.seize(this);
  }
  get boxStyle() {
    return `height:${this.tall ? 120 : 40}px;background:#0af`;
  }
  <template>
    <Choreo class='stage' style='position:relative;width:300px' as |c|>
      <div data-box style={{this.boxStyle}} {{motion id='box'}}></div>
      <c.Move @of={{c.all}} @duration={{0.2}} @ease='linear' @size='crop' />
    </Choreo>
  </template>
}

let ctx: ChoreoContext | undefined;
const grab = (c: ChoreoContext) => {
  ctx = c;
  return '';
};
let leaving: Leaving | undefined;

/** a box that can reflow, beside a leaver that fades out slowly */
class Leaving extends Component {
  @tracked tall = false;
  @tracked shown = true;
  constructor(owner: unknown, args: object) {
    super(owner as never, args as never);
    leaving = this;
  }
  get boxStyle() {
    return `height:${this.tall ? 120 : 40}px;background:#0af`;
  }
  <template>
    <Choreo class='stage' style='position:relative;width:300px' as |c|>
      {{grab c}}
      <div data-box style={{this.boxStyle}} {{motion id='box'}}></div>
      {{#if this.shown}}
        <div style='height:20px' {{motion id='leaver'}}></div>
      {{/if}}
      <c.Move @of={{c.all}} @duration={{0.2}} @ease='linear' @size='crop' />
      <c.Tween @of={{c.removed}} @opacity={{array 1 0}} @duration={{2}} />
    </Choreo>
  </template>
}

module('Integration | choreo | crop release', function (hooks) {
  setupRenderingTest(hooks);
  setupFixtureViewport(hooks);
  setupChoreo(hooks);

  test('a crop leaves no clip on the element once it lands', async function (assert) {
    await render(<template><Stage @seize={{seize}} /></template>);
    stage!.tall = true;
    await settled();
    await animationsSettled();
    let box = document.querySelector('[data-box]') as HTMLElement;
    let clip = getComputedStyle(box).clipPath;
    assert.strictEqual(clip, 'none', `no clip once landed (was ${clip})`);
  });

  test('a crop interrupted mid-flight leaves no clip once it lands', async function (assert) {
    await render(<template><Stage @seize={{seize}} /></template>);
    for (let i = 0; i < 5; i++) {
      stage!.tall = !stage!.tall;
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    await settled();
    await animationsSettled();
    await new Promise((resolve) => setTimeout(resolve, 300));
    let box = document.querySelector('[data-box]') as HTMLElement;
    let clip = getComputedStyle(box).clipPath;
    assert.strictEqual(
      clip,
      'none',
      `no clip once landed (was ${clip}; inline ${box.style.clipPath})`,
    );
  });

  test('a reflow while a leaver is still in flight compiles a new run', async function (assert) {
    await render(<template><Leaving /></template>);
    await animationsSettled();
    leaving!.shown = false;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    let first = ctx?.run;
    assert.ok(first && !first.isDone(), 'the leaver is in flight');
    leaving!.tall = true;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    assert.notStrictEqual(
      ctx?.run,
      first,
      'the reflow is a real move: the region recompiles instead of keeping the run',
    );
    ctx = undefined;
    leaving = undefined;
    await settled();
    await animationsSettled();
  });
});
