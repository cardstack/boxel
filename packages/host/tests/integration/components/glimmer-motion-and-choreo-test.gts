import { hash } from '@ember/helper';
import { find, render, settled } from '@ember/test-helpers';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { Choreo } from '@cardstack/choreo';
import { setupChoreo } from '@cardstack/choreo/test-support';
import { motion } from 'glimmer-motion';
import { animationsSettled } from 'glimmer-motion/test-support';
import { module, test } from 'qunit';

import { setupRenderingTest } from '../../helpers/setup';

module('Integration | glimmer-motion and choreo', function (hooks) {
  setupRenderingTest(hooks);
  setupChoreo(hooks);

  test('a motion element animates to its target', async function (assert) {
    await render(
      <template>
        <div
          id='fader'
          {{motion
            initial=(hash opacity=0)
            animate=(hash opacity=1)
            transition=(hash duration=0.05)
          }}
        ></div>
      </template>,
    );
    await animationsSettled();
    assert.strictEqual(
      (find('#fader') as HTMLElement).style.opacity,
      '1',
      'the modifier wrote the animated value to the element',
    );
  });

  test('a choreographed leaver stays in the document while its exit plays', async function (assert) {
    class Stage extends Component {
      @tracked show = true;
      constructor(owner: unknown, args: object) {
        super(owner as never, args);
        stage = this;
      }
      <template>
        <Choreo as |c|>
          {{#if this.show}}
            <div id='leaver' {{motion id='leaver' role='card'}}>Leaver</div>
          {{/if}}
          <c.Tween @of={{c.removed 'card'}} @opacity={{0}} @duration={{0.05}} />
        </Choreo>
      </template>
    }
    let stage: Stage | undefined;
    await render(<template><Stage /></template>);
    await animationsSettled();

    stage!.show = false;
    await settled();
    assert
      .dom('[data-choreo-orphans] #leaver')
      .exists('the removed element moves to the orphan layer for its exit');

    await animationsSettled();
    assert.dom('#leaver').doesNotExist('it unmounts when its exit ends');
  });
});
