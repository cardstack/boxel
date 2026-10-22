// Pretui — Masonry unit tests.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules
// are not applied).
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Masonry } from './masonry';

interface Note { text: string }
const NOTES: Note[] = [{ text: 'a' }, { text: 'b' }, { text: 'c' }];
const textOf = (n: Note) => n.text;

function root(): HTMLElement {
  return document.querySelector('[data-test-pretui-masonry]') as HTMLElement;
}

module('Pretui | components/masonry', function (hooks) {
  setupCardTest(hooks);

  test('lays each item in its own cell, in order, with no inline style by default', async function (assert) {
    await render(
      <template>
        <Masonry @items={{NOTES}}>
          <:item as |note index|><span data-test-cell>{{index}}:{{textOf note}}</span></:item>
        </Masonry>
      </template>,
    );
    assert.deepEqual(Array.from(root().querySelectorAll('.pretui-masonry-cell [data-test-cell]')).map((c) => c.textContent), ['0:a', '1:b', '2:c']);
    assert.strictEqual(root().getAttribute('style'), null, 'no inline overrides, so the stylesheet paints');
  });

  test('publishes the layout knobs as custom properties, floored and validated', async function (assert) {
    await render(<template><Masonry @items={{NOTES}} @columns={{2.7}} @min='12rem' @gap={{-4}}><:item as |n|>{{textOf n}}</:item></Masonry></template>);
    assert.strictEqual(root().getAttribute('style'), '--pretui-masonry-columns: 2; --pretui-masonry-min: 12rem; --pretui-masonry-gap: 0px');
  });

  test('drops a minimum width that is not a CSS length', async function (assert) {
    await render(<template><Masonry @items={{NOTES}} @min='12rem; background: url(javascript:0)'><:item as |n|>{{textOf n}}</:item></Masonry></template>);
    assert.strictEqual(root().getAttribute('style'), null, 'dropped whole — no attribute at all');
  });

  test('an unbalanced paren in @min is rejected, and the declaration after it survives', async function (assert) {
    await render(<template><Masonry @items={{NOTES}} @min='calc(1' @gap={{7}}><:item as |n|>{{textOf n}}</:item></Masonry></template>);
    assert.strictEqual(
      root().getAttribute('style'),
      '--pretui-masonry-gap: 7px',
      'the min is dropped whole',
    );
    assert.strictEqual(
      root().style.getPropertyValue('--pretui-masonry-gap'),
      '7px',
      'and the gap is no longer swallowed by the open paren',
    );
  });
});
