import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';
import { render } from '@ember/test-helpers';
import hbs from 'htmlbars-inline-precompile';
import { Changeset } from 'animations-experiment/models/changeset';
import Sprite from 'animations-experiment/models/sprite';

module('Integration | Rendering', function (hooks) {
  setupRenderingTest(hooks);
  let changeset: Changeset;

  hooks.beforeEach(function () {
    // TODO: fix how we perform measurements in situations where scale is applied on a container of animated stuff
    (document.querySelector('#ember-testing') as HTMLElement).style.transform =
      'scale(1)';
  });

  module('AnimationContext receives correct sprites', function (hooks) {
    hooks.beforeEach(function () {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      changeset = undefined;
      this.set('setChangeset', (c: Changeset) => {
        changeset = c;
      });
    });

    test('when an element is inserted', async function (assert) {
      this.set('show', false);

      await render(hbs`
      <AnimationContext @use={{this.setChangeset}}>
        {{#if this.show}}
          <div {{sprite id="sprite" }}>Here</div>
        {{/if}}
      </AnimationContext>
      `);

      this.set('show', true);
      assert.deepEqual(
        Array.from(changeset.insertedSprites).map((v) => (v as Sprite).id),
        ['sprite']
      );
      assert.deepEqual(
        Array.from(changeset.keptSprites).map((v) => (v as Sprite).id),
        []
      );
      assert.deepEqual(
        Array.from(changeset.removedSprites).map((v) => (v as Sprite).id),
        []
      );
    });

    test('when an element is removed', async function (assert) {
      this.set('show', true);

      await render(hbs`
      <AnimationContext @use={{this.setChangeset}}>
        {{#if this.show}}
          <div {{sprite id="sprite" }}>Here</div>
        {{/if}}
      </AnimationContext>
      `);

      this.set('show', false);

      assert.deepEqual(
        Array.from(changeset.insertedSprites).map((v) => (v as Sprite).id),
        []
      );
      assert.deepEqual(
        Array.from(changeset.keptSprites).map((v) => (v as Sprite).id),
        []
      );
      assert.deepEqual(
        Array.from(changeset.removedSprites).map((v) => (v as Sprite).id),
        ['sprite']
      );
    });

    test('when an element is modified', async function (assert) {
      this.set('value', 'A');

      await render(hbs`
      <AnimationContext @use={{this.setChangeset}}>
        <div {{sprite id="sprite" }}>{{this.value}}</div>
      </AnimationContext>
      `);

      this.set('value', 'B');

      assert.deepEqual(
        Array.from(changeset.insertedSprites).map((v) => (v as Sprite).id),
        []
      );
      assert.deepEqual(
        Array.from(changeset.keptSprites).map((v) => (v as Sprite).id),
        ['sprite']
      );
      assert.deepEqual(
        Array.from(changeset.removedSprites).map((v) => (v as Sprite).id),
        []
      );
    });

    test('when an element is replaced with an equivalent one', async function (assert) {
      this.set('showA', true);

      await render(hbs`
      <AnimationContext @use={{this.setChangeset}}>
        {{#if this.showA}}
          <div {{sprite id="sprite" }}>A</div>
        {{else}}
          <div {{sprite id="sprite" }}>B</div>
        {{/if}}
      </AnimationContext>
      `);

      this.set('showA', false);

      assert.deepEqual(
        Array.from(changeset.insertedSprites).map((v) => (v as Sprite).id),
        []
      );
      assert.deepEqual(
        Array.from(changeset.keptSprites).map((v) => (v as Sprite).id),
        ['sprite']
      );
      assert.deepEqual(
        Array.from(changeset.removedSprites).map((v) => (v as Sprite).id),
        []
      );
    });

    test('sprite measurements are correct', async function (assert) {
      this.set('left', true);

      await render(hbs`
      {{!-- template-lint-disable no-inline-styles --}}
      <AnimationContext @use={{this.setChangeset}} style="position: relative;">
        {{!-- template-lint-disable style-concatenation --}}
        <div style={{concat "position: absolute; " (if this.left "left: 0;" "left: 100px;" )}} {{sprite id="sprite" }}>A</div>
      </AnimationContext>
      `);

      this.set('left', false);

      let sprite = Array.from(changeset.keptSprites)[0] as Sprite;
      assert.deepEqual(sprite.initialBounds?.relativeToParent.left, 0);
      assert.deepEqual(sprite.finalBounds?.relativeToParent.left, 100);
    });
  });

  // module('position transitions', function (hooks) {});
  // module('resize transitions', function (hooks) {});
});
