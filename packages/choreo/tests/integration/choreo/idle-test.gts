/**
 * An idle region sits render passes out: a change inside it lands at once,
 * with no motion, and the pass that sets it back to watching animates the
 * next change as usual. A page with a region per list item idles the ones
 * that cannot change, so passes cost what the live ones cost.
 */
import { Choreo } from '@cardstack/choreo';
import { setupChoreo } from '@cardstack/choreo/test-support';
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

class Stage extends Component<{ Args: { seize: (self: Stage) => void } }> {
  @tracked above = 0;
  @tracked idle = true;
  constructor(owner: unknown, args: { seize: (self: Stage) => void }) {
    super(owner as never, args as never);
    args.seize(this);
  }
  get aboveStyle() {
    return `height:${this.above}px`;
  }
  <template>
    <Choreo class='stage' style='position:relative' @idle={{this.idle}} as |c|>
      <div style={{this.aboveStyle}}></div>
      <div
        data-box
        style='height:40px;background:#0af'
        {{motion id='box'}}
      ></div>
      <c.Move @of={{c.all}} @duration={{0.4}} @ease='linear' />
    </Choreo>
  </template>
}

/** a move FLIPs: the box carries a transform while it travels */
function moving(): boolean {
  let el = document.querySelector('[data-box]') as HTMLElement;
  let transform = getComputedStyle(el).transform;
  return transform !== 'none' && transform !== '';
}

const nextFrame = () =>
  new Promise((resolve) => requestAnimationFrame(resolve));

module('Integration | choreo | idle', function (hooks) {
  setupRenderingTest(hooks);
  setupFixtureViewport(hooks);
  setupChoreo(hooks);

  hooks.afterEach(() => {
    stage = undefined;
  });

  test('an idle region lets a change land without motion', async function (assert) {
    await render(<template><Stage @seize={{seize}} /></template>);
    stage!.above = 100;
    await nextFrame();
    assert.false(moving(), 'the box moved, and nothing animated it');
    await settled();
  });

  test('a region set back to watching animates the next change', async function (assert) {
    await render(<template><Stage @seize={{seize}} /></template>);
    stage!.idle = false;
    await settled();
    stage!.above = 100;
    await nextFrame();
    assert.true(moving(), 'the region animates the box from where it was');
    await settled();
  });
});
