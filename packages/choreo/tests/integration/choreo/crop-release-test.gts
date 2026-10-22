/**
 * A crop is a clip while it runs, and nothing once it lands.
 *
 * `@size='crop'` shows a size change through a clip-path that ends at
 * inset(0px 0px 0px 0px). Left on the element, that clip cuts whatever the
 * element draws outside its box (a focus ring, a shadow, an inset that
 * hangs into a gutter) for as long as the element lives.
 */
import { Choreo } from '@cardstack/choreo';
import { setupChoreo } from '@cardstack/choreo/test-support';
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
});
