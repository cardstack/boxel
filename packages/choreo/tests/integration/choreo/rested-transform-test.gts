/**
 * A transform a tween is still carrying (an entrance's scale) is part of the
 * picture, not of the layout. A pass that lands while it is in flight must
 * measure the element at rest, and when the new score names the element
 * only for something else (a fade), the region must carry the transform on
 * to rest rather than leave it where the measurement found it. A transform
 * the new score drives itself (a single-value tween, a hold) carries on from
 * where it is painted, or stands where the hold puts it. A pass that keeps
 * the run stands the rested transform back up where it was painted.
 */
import { Choreo, type ChoreoContext } from '@cardstack/choreo';
import {
  setupChoreo,
  strandedTransforms,
} from '@cardstack/choreo/test-support';
import { render } from '@ember/test-helpers';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { setupRenderingTest } from 'ember-qunit';
import { motion } from 'glimmer-motion';
import { animationsSettled, bounds } from 'glimmer-motion/test-support';
import { module, test } from 'qunit';

import { setupFixtureViewport } from '../../helpers/layout-fixture';

const frames = (n: number) =>
  new Promise<void>((resolve) => {
    const step = () => (n-- <= 0 ? resolve() : requestAnimationFrame(step));
    requestAnimationFrame(step);
  });

const scaleOf = (el: Element) =>
  new DOMMatrixReadOnly(getComputedStyle(el).transform).a;

class Scene extends Component<{ Args: { seize: (self: Scene) => void } }> {
  @tracked showA = false;
  @tracked showB = false;
  constructor(owner: unknown, args: { seize: (self: Scene) => void }) {
    super(owner as never, args as never);
    args.seize(this);
  }
  <template>
    <Choreo style='position:relative;width:600px;height:400px' as |c|>
      {{#if this.showA}}
        <div
          data-box='a'
          style='position:absolute;left:20px;top:20px;width:200px;height:120px;background:#0af'
          {{motion id='a' role='box'}}
        ></div>
      {{/if}}
      {{#if this.showB}}
        <div
          data-box='b'
          style='position:absolute;left:320px;top:20px;width:200px;height:120px;background:#fa0'
          {{motion id='b' role='box'}}
        ></div>
      {{/if}}
      <c.Parallel>
        <c.Tween
          @of={{c.inserted 'box'}}
          @scale={{array 0.5 1}}
          @duration={{0.6}}
        />
        {{! names a kept box for its opacity only }}
        <c.Tween @of={{c.kept 'box'}} @opacity={{1}} @duration={{0.6}} />
      </c.Parallel>
    </Choreo>
  </template>
}

const array = (...values: number[]) => values;

const xOf = (el: Element) => el.getBoundingClientRect().x;
const yOf = (el: Element) => el.getBoundingClientRect().y;

class Slide extends Component<{ Args: { seize: (self: Slide) => void } }> {
  @tracked go = false;
  @tracked showB = false;
  constructor(owner: unknown, args: { seize: (self: Slide) => void }) {
    super(owner as never, args as never);
    args.seize(this);
  }
  <template>
    <Choreo style='position:relative;width:600px;height:400px' as |c|>
      <div
        data-box='a'
        data-go={{this.go}}
        style='position:absolute;left:0;top:20px;width:100px;height:100px;background:#0af'
        {{motion id='a' role='box'}}
      ></div>
      {{#if this.showB}}
        <div
          data-box='b'
          style='position:absolute;left:320px;top:200px;width:100px;height:100px;background:#fa0'
          {{motion id='b' role='box'}}
        ></div>
      {{/if}}
      {{#if this.go}}
        <c.Tween @of={{c.id 'a'}} @x={{200}} @duration={{2}} @ease='linear' />
      {{/if}}
    </Choreo>
  </template>
}

class HeldMove extends Component<{
  Args: { seize: (self: HeldMove) => void };
}> {
  @tracked moved = false;
  @tracked held = false;
  constructor(owner: unknown, args: { seize: (self: HeldMove) => void }) {
    super(owner as never, args as never);
    args.seize(this);
  }
  <template>
    <Choreo style='position:relative;width:600px;height:400px' as |c|>
      <div
        data-box='a'
        style={{if
          this.moved
          'position:absolute;left:300px;top:200px;width:100px;height:100px;background:#0af'
          'position:absolute;left:0;top:0;width:100px;height:100px;background:#0af'
        }}
        {{motion id='a' role='box'}}
      ></div>
      {{#if this.held}}
        <c.Hold @of={{c.id 'a'}} @y={{-30}} @fill={{true}} />
      {{else}}
        <c.Move @of={{c.moved 'box'}} @duration={{2}} @ease='linear' />
      {{/if}}
    </Choreo>
  </template>
}

let ctx: ChoreoContext | undefined;
const grab = (c: ChoreoContext) => {
  ctx = c;
  return '';
};

/**
 * A box enters with a scale while another leaves. With the leaver still
 * aloft, a render that inserts and removes nothing keeps the run. On that
 * re-pass the box is kept, not inserted, so the score compiles no tween for
 * its scale and only the keep puts the scale back. A playing run is declined
 * before the pass measures anything; a held run is measured, which rests
 * the scale.
 */
class Swap extends Component<{ Args: { seize: (self: Swap) => void } }> {
  @tracked swapped = false;
  // renders outside every participant: a pass that changes nothing else
  @tracked noise = 0;
  constructor(owner: unknown, args: { seize: (self: Swap) => void }) {
    super(owner as never, args as never);
    args.seize(this);
  }
  <template>
    <Choreo style='position:relative;width:600px;height:400px' as |c|>
      {{grab c}}
      {{#if this.swapped}}
        <div
          data-box='a'
          style='position:absolute;left:20px;top:20px;width:200px;height:120px;background:#0af'
          {{motion id='a' role='box'}}
        ></div>
      {{else}}
        <div
          data-box='old'
          style='position:absolute;left:320px;top:20px;width:200px;height:120px;background:#fa0'
          {{motion id='old' role='leaver'}}
        ></div>
      {{/if}}
      <div style='position:absolute;top:300px'>{{this.noise}}</div>
      <c.Parallel>
        <c.Tween
          @of={{c.inserted 'box'}}
          @scale={{array 0.5 1}}
          @duration={{0.6}}
        />
        <c.Tween @of={{c.removed 'leaver'}} @opacity={{0}} @duration={{0.6}} />
      </c.Parallel>
    </Choreo>
  </template>
}

module('Integration | choreo | rested transform', function (hooks) {
  setupRenderingTest(hooks);
  setupFixtureViewport(hooks, { width: 600 });
  setupChoreo(hooks);
  hooks.afterEach(() => {
    ctx = undefined;
  });

  test('an entrance scale cut short by a pass that names the element only for a fade is carried on to rest', async function (assert) {
    let scene: Scene | undefined;
    const seize = (self: Scene) => (scene = self);
    await render(<template><Scene @seize={{seize}} /></template>);
    await animationsSettled();

    scene!.showA = true;
    await frames(6);
    const a = document.querySelector('[data-box="a"]')!;
    const midway = scaleOf(a);
    assert.true(
      midway > 0.5 && midway < 1,
      `the entrance is in flight when the next pass lands (scale ${midway})`,
    );

    // a second box arrives: a replacement pass, in which 'a' is kept and
    // named by the score only for its opacity
    scene!.showB = true;
    await frames(2);
    const carried = scaleOf(a);
    assert.true(
      carried >= midway - 0.05 && carried < 0.999,
      `the scale carries on from where it was painted, neither stranded nor snapped to rest (${carried} after ${midway})`,
    );

    await animationsSettled();
    assert.strictEqual(scaleOf(a), 1, 'the entrance reaches its rest');
    assert.deepEqual(
      [bounds(a as HTMLElement).width, bounds(a as HTMLElement).height],
      [200, 120],
      'the box stands at its laid-out size',
    );
    assert.deepEqual(strandedTransforms(), [], 'no transform is stranded');
  });

  test('an entrance scale rested for a pass that keeps its run stands back up where it was painted', async function (assert) {
    let scene: Swap | undefined;
    const seize = (self: Swap) => (scene = self);
    await render(<template><Swap @seize={{seize}} /></template>);
    await animationsSettled();

    scene!.swapped = true;
    await frames(6);
    const a = document.querySelector('[data-box="a"]')!;
    const run = ctx!.run!;
    run.pause();
    await frames(1);
    const held = scaleOf(a);
    assert.true(
      held > 0.5 && held < 1,
      `the entrance is in flight when the run is held (scale ${held})`,
    );

    scene!.noise++;
    await frames(2);
    assert.strictEqual(ctx!.run, run, 'the pass keeps the run');
    assert.true(
      Math.abs(scaleOf(a) - held) < 0.01,
      `the scale stands where it was painted, not at rest (${scaleOf(a)} after ${held})`,
    );

    run.play();
    await animationsSettled();
    assert.strictEqual(scaleOf(a), 1, 'the entrance reaches its rest');
    assert.deepEqual(
      [bounds(a as HTMLElement).width, bounds(a as HTMLElement).height],
      [200, 120],
      'the box stands at its laid-out size',
    );
    assert.deepEqual(strandedTransforms(), [], 'no transform is stranded');
  });

  test('a single-value tween caught by another pass carries on from where it is painted', async function (assert) {
    let scene: Slide | undefined;
    const seize = (self: Slide) => (scene = self);
    await render(<template><Slide @seize={{seize}} /></template>);
    await animationsSettled();
    const a = document.querySelector('[data-box="a"]')!;

    scene!.go = true;
    await frames(12);
    const before = xOf(a);
    assert.true(before > 0, `the tween is in flight (x ${before})`);

    // another box arrives: a replacement pass whose score drives 'a' on x
    scene!.showB = true;
    await frames(1);
    assert.true(
      xOf(a) >= before - 1,
      `x carries on rather than snapping back (${xOf(a)} after ${before})`,
    );
    await animationsSettled();
    assert.strictEqual(Math.round(xOf(a)), 200, 'the tween reaches its end');
  });

  test('a box caught mid-move and then held stands where the hold puts it', async function (assert) {
    let scene: HeldMove | undefined;
    const seize = (self: HeldMove) => (scene = self);
    await render(<template><HeldMove @seize={{seize}} /></template>);
    await animationsSettled();
    const a = document.querySelector('[data-box="a"]')!;

    scene!.moved = true;
    await frames(12);
    scene!.held = true;
    await animationsSettled();
    await frames(2);
    assert.strictEqual(
      Math.round(yOf(a)),
      200 - 30,
      'the hold wins over the continuation of the move it caught',
    );
  });
});
