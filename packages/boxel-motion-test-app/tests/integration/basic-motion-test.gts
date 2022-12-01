import { click } from '@ember/test-helpers';
import { setupRenderingTest } from 'ember-qunit';
import { module, test } from 'qunit';
import type { Changeset } from '@cardstack/boxel-motion/models/animator';
import type { AnimationDefinition } from '@cardstack/boxel-motion/models/orchestration';
import AnimationContext from "@cardstack/boxel-motion/components/animation-context";
import sprite from "@cardstack/boxel-motion/modifiers/sprite";
import TweenBehavior from '@cardstack/boxel-motion/behaviors/tween';
import { tracked } from '@glimmer/tracking';
import { setupAnimationTest, renderComponent } from '../helpers';
import Component from '@glimmer/component';
import { on } from '@ember/modifier';

module('Integration | basic-motion', function (hooks) {
  setupRenderingTest(hooks);
  let time = setupAnimationTest(hooks);

  test('it renders', async function (assert) {
    class TestComponent extends Component {
      <template>
        <button data-toggle {{on "click" this.toggleBig}}>Toggle</button>
        <AnimationContext @use={{this.transition}}>
          {{#if this.big}}
            <div data-target style="height: 300px; width: 300px; background-color: red" {{sprite id="1"}}></div>
          {{else}}
            <div data-target style="height: 50px; width: 300px; background-color: red" {{sprite id="1"}}></div>
          {{/if}}
        </AnimationContext>
      </template>

      @tracked big = false;
      toggleBig = () => {
        this.big = !this.big;
      };
      transition = (changeset: Changeset): AnimationDefinition => {
        return {
          timeline: {
            type: 'parallel',
            animations: [
              {
                sprites: changeset.keptSprites,
                properties: {
                  height: {},
                },
                timing: {
                  behavior: new TweenBehavior(),
                  duration: 6000,
                },
              },
            ],
          },
        };
      };
    }

    await renderComponent(TestComponent);

    await assert.visualContinuity('[data-target]', async () => {
      await click('[data-toggle]');
      time.pauseAt(0);
    });

    assert.pixels('[data-target]', { height: 50 });

    time.advanceTo(3000);
    assert.pixels('[data-target]', { height: 175 });

    time.advanceTo(5999);
    await assert.visualContinuity('[data-target]', async () => {
      time.advanceTo(6000);
    });

    assert.pixels('[data-target]', { height: 300 });
  });
});
