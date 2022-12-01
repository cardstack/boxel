import { render, click } from '@ember/test-helpers';
import { setupRenderingTest } from 'ember-qunit';
import hbs from 'htmlbars-inline-precompile';
import { module, test } from 'qunit';
import type { Changeset } from '@cardstack/boxel-motion/models/animator';
import type { AnimationDefinition } from '@cardstack/boxel-motion/models/orchestration';
import TweenBehavior from '@cardstack/boxel-motion/behaviors/tween';
import { tracked } from '@glimmer/tracking';
import { setupAnimationTest } from '../helpers';

module('Integration | basic-motion', function (hooks) {
  setupRenderingTest(hooks);
  let time = setupAnimationTest(hooks);

  test('it renders', async function (assert) {
    class Example {
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
                  duration: 1000,
                },
              },
            ],
          },
        };
      };
    }

    (this as any).example = new Example();

    await render(hbs`
      <button data-toggle {{on "click" this.example.toggleBig}}>Toggle</button>
      <AnimationContext @use={{this.example.transition}}>
        {{#if this.example.big}}
          <div data-target style="height: 300px; width: 300px; background-color: red" {{sprite id="1"}}></div>
        {{else}}
          <div data-target style="height: 50px; width: 300px; background-color: red" {{sprite id="1"}}></div>
        {{/if}}
      </AnimationContext>
    `);

    await assert.visualContinuity('[data-target]', async () => {
      await click('[data-toggle]');
      time.pauseAt(0);
    });

    assert.pixels('[data-target]', { height: 50 });

    time.advanceTo(500);
    assert.pixels('[data-target]', { height: 175 });

    time.advanceTo(999);
    await assert.visualContinuity('[data-target]', async () => {
      time.advanceTo(1000);
    });

    assert.pixels('[data-target]', { height: 300 });
  });
});
