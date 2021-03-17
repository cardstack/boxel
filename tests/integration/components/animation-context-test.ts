import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';
import { render, settled } from '@ember/test-helpers';
import hbs from 'htmlbars-inline-precompile';

function tick() {
  return new Promise((resolve) => setTimeout(resolve, 500));
}

module('Integration | Component | animation-context', function (hooks) {
  setupRenderingTest(hooks);
  let transitions;

  hooks.beforeEach(function (assert) {
    let animations = this.owner.lookup('service:animations');
    transitions = [];
    animations.notifyTransition = function (
      changeset: Changeset,
      animationContext: AnimationContext
    ) {
      transitions.push({
        changeset: changeset,
        animationContext: animationContext,
      });
    };
  });

  test('it does not transition on initial render', async function (assert) {
    assert.deepEqual(transitions, []);

    await render(hbs`
      <AnimationContext @id="foo" @use="bar">
        <div {{sprite id="a"}}>
        </div>
      </AnimationContext>
    `);

    assert.deepEqual(transitions, []);
  });

  test('it transitions when adding a component', async function (assert) {
    assert.deepEqual(transitions, []);

    await render(hbs`
      <AnimationContext @id="foo" @use="bar">
        {{#if showSprite}}
          <div {{sprite id="a"}}>
            Sprite
          </div>
        {{/if}}
      </AnimationContext>
    `);

    assert.equal(this.element.textContent.trim(), '');
    debugger;

    await tick();

    this.set('showSprite', true);

    assert.equal(this.element.textContent.trim(), 'Sprite');

    await tick();

    assert.deepEqual(transitions, []);
  });
});
