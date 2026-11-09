/**
 * A transform a tween is still carrying (an entrance's scale) is part of the
 * picture, not of the layout. A pass that lands while it is in flight must
 * measure the element at rest, and when the new score names the element
 * only for something else (a fade), the region must carry the transform on
 * to rest rather than leave it where the measurement found it.
 *
 * Before: the scale was neither rested for the measure nor carried on, so
 * the element was measured at its mid-entrance size and stayed scaled down
 * for good.
 */
import { Choreo } from '@cardstack/choreo';
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

module('Integration | choreo | rested transform', function (hooks) {
  setupRenderingTest(hooks);
  setupFixtureViewport(hooks, { width: 600 });
  setupChoreo(hooks);

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
});
