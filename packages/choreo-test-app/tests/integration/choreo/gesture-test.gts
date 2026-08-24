/**
 * The hot start — c.gesture seeds the sprite (§6.1).
 */
import { array } from '@ember/helper';
import { find, render, settled, triggerEvent } from '@ember/test-helpers';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { setupRenderingTest } from 'ember-qunit';
import { Choreo, motion } from 'glimmer-motion';
import { animationsSettled, bounds } from 'glimmer-motion/test-support';
import { module, test } from 'qunit';

import { setupFixtureViewport } from '../../helpers/layout-fixture';
import { nextFrame } from '../../helpers/motion';

module('Integration | choreo | gesture', function (hooks) {
  setupRenderingTest(hooks);
  setupFixtureViewport(hooks);

  test('a Move from the gesture starts at the release point, not the resting box', async function (assert) {
    class App extends Component {
      @tracked gen = 0;
      constructor(o: unknown, a: object) {
        super(o as never, a);
        app = this;
      }
      <template>
        <Choreo class="stage" style="position:relative;width:300px;height:200px" as |c|>
          {{#each (array this.gen) key="@identity" as |g|}}
            {{#if g}}
              <div
                id="dropped"
                style="position:absolute;left:20px;top:20px;width:40px;height:40px;background:#0af"
                {{motion id="dropped" role="card"}}
              ></div>
            {{/if}}
          {{/each}}
          <c.Move
            @of={{c.inserted "card"}}
            @from={{c.gesture}}
            @duration={{0.1}}
            @ease="easeInOut"
          />
        </Choreo>
      </template>
    }
    let app: App | undefined;
    await render(<template><App /></template>);
    await animationsSettled();
    const stage = find('.stage') as HTMLElement;
    const box = stage.getBoundingClientRect();
    await triggerEvent(stage, 'pointermove', {
      clientX: box.left + 250,
      clientY: box.top + 160,
    });
    app!.gen = 1;
    await settled();
    await nextFrame();
    const mid = bounds(find('#dropped') as HTMLElement);
    assert.true(
      mid.left > 100,
      `starts from the release point, flying home (${mid.left})`,
    );
    await animationsSettled();
    const rest = bounds(find('#dropped') as HTMLElement);
    assert.true(
      Math.abs(rest.left - 20) < 1.5 && Math.abs(rest.top - 20) < 1.5,
      `lands on the resting box (${rest.left}, ${rest.top})`,
    );
  });
});
