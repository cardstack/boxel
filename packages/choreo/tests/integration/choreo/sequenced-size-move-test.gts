/**
 * Size-animating moves played one after another, where the first one's size
 * places the second element (siblings in a flex row). Every cue's first
 * keyframe stands from the run's first frame, so the second element holds
 * its start translate while the first one grows: it is carried along by
 * layout, and when its own window opens it starts from where it is painted.
 * Its path has no jump, and it lands where layout puts it.
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
import { animationsSettled } from 'glimmer-motion/test-support';
import { module, test } from 'qunit';

import { setupFixtureViewport } from '../../helpers/layout-fixture';

const styleFor = (width: number) => ({ width: `${width}px` });

class Row extends Component<{ Args: { seize: (self: Row) => void } }> {
  @tracked grownWidth = 100;
  constructor(owner: unknown, args: { seize: (self: Row) => void }) {
    super(owner as never, args as never);
    args.seize(this);
  }
  <template>
    <Choreo
      style='display:flex;position:relative;width:800px;height:200px'
      as |c|
    >
      <div
        style='height:100px;background:#0af;flex:none'
        {{motion id='a' role='box' style=(styleFor this.grownWidth)}}
        data-test-box='a'
      ></div>
      <div
        style='width:100px;height:100px;background:#fa0;flex:none'
        {{motion id='b' role='box'}}
        data-test-box='b'
      ></div>
      <c.Sequence>
        <c.Move @of={{c.id 'a'}} @duration={{0.3}} />
        <c.Move @of={{c.id 'b'}} @duration={{0.3}} />
      </c.Sequence>
    </Choreo>
  </template>
}

module('Integration | choreo | sequenced size move', function (hooks) {
  setupRenderingTest(hooks);
  setupFixtureViewport(hooks, { width: 800 });
  setupChoreo(hooks);

  test('a sibling moved after a growing box never jumps and lands at its place', async function (assert) {
    let row: Row | undefined;
    const seize = (self: Row) => (row = self);
    await render(<template><Row @seize={{seize}} /></template>);
    await animationsSettled();

    const b = document.querySelector('[data-test-box="b"]')!;
    // seeded with where it stands before the change, so the run's first
    // frame is compared too
    const xs: number[] = [b.getBoundingClientRect().x];
    let on = true;
    const tick = () => {
      if (!on) {
        return;
      }
      xs.push(b.getBoundingClientRect().x);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);

    row!.grownWidth = 300;
    await animationsSettled();
    on = false;

    // at 60 Hz the largest step either move can make is well under 40 px
    const steps = xs.slice(1).map((x, i) => Math.abs(x - xs[i]!));
    assert.true(
      Math.max(...steps) < 40,
      `no frame jumps (largest step ${Math.max(...steps).toFixed(1)} px): ${xs.map((x) => x.toFixed(0)).join(' ')}`,
    );
    assert.strictEqual(
      Math.round(xs[xs.length - 1]!),
      300,
      'the sibling lands where layout puts it',
    );
    assert.deepEqual(strandedTransforms(), [], 'no transform is stranded');
  });
});
