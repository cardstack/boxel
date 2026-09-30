import { array } from '@ember/helper';
import { clearRender, find, render } from '@ember/test-helpers';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { setupRenderingTest } from 'ember-qunit';
import { Choreo, type ChoreoContext, motion } from 'glimmer-motion';
import { setupMotion } from 'glimmer-motion/test-support';
import { module, test } from 'qunit';

import { nextFrame } from '../../helpers/motion';

module('Integration | choreo | keyframe timing', function (hooks) {
  setupRenderingTest(hooks);
  setupMotion(hooks);
  for (const repeat of [0, Infinity]) {
    test(`nonuniform offsets survive playback and reverse seeking (repeat ${repeat})`, async function (assert) {
      let ctx: ChoreoContext;
      let app: App;
      const grab = (c: ChoreoContext) => {
        ctx = c;
        return '';
      };
      class App extends Component {
        @tracked take = 0;
        constructor(owner: unknown, args: object) {
          super(owner as never, args);
          app = this;
        }
        <template>
          <Choreo as |c|>
            {{grab c}}
            <div
              data-test-timed
              data-take={{this.take}}
              {{motion id="timed"}}
            >●</div>
            <c.Tween
              @of={{c.id "timed"}}
              @x={{array 0 0 100 100}}
              @times={{array 0 0.25 0.75 1}}
              @duration={{4}}
              @ease="linear"
              @repeat={{repeat}}
            />
            <div data-test-timed-text {{motion id="text"}}>One two</div>
            <c.Tween
              @of={{c.id "text"}}
              @by="word"
              @x={{array 0 0 100 100}}
              @times={{array 0 0.25 0.75 1}}
              @duration={{4}}
              @ease="linear"
            />
            <c.Wait @of={{c.id "timed"}} @duration={{4}} />
          </Choreo>
        </template>
      }
      await render(<template><App /></template>);
      await nextFrame();
      app!.take++;
      await nextFrame();
      await nextFrame();
      const run = ctx!.run!;
      assert.ok(run);
      run.pause();
      const slots = (
        find('[data-test-timed-text]') as HTMLElement
      ).getAnimations({ subtree: true });
      assert.ok(slots.length > 0, 'text delivery created slot animations');
      for (const slot of slots) {
        assert.deepEqual(
          (slot.effect as KeyframeEffect)
            .getKeyframes()
            .map((frame) => frame.computedOffset),
          [0, 0.25, 0.75, 1],
          'text delivery preserves offsets'
        );
      }
      const element = find('[data-test-timed]') as HTMLElement;
      for (const [time, expected] of [
        [0.5, 0],
        [2, 50],
        [3.5, 100],
        [2, 50],
        [0, 0],
      ]) {
        run.time = time!;
        await nextFrame();
        await nextFrame();
        const matrix = new DOMMatrix(getComputedStyle(element).transform);
        assert.ok(
          Math.abs(matrix.m41 - expected!) < 1,
          `${time}s: expected ${expected}, got ${matrix.m41}`
        );
      }
      if (repeat === Infinity) {
        const animation = element.getAnimations()[0]!;
        assert.deepEqual(
          (animation.effect as KeyframeEffect)
            .getKeyframes()
            .map((f) => f.computedOffset),
          [0, 0.25, 0.75, 1]
        );
      }
      run.cancel();
      await clearRender();
      assert.strictEqual(
        element.getAnimations().length,
        0,
        'teardown releases animation'
      );
    });
  }
});
