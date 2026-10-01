import { render } from '@ember/test-helpers';
import motion from 'glimmer-motion/motion';
import { module, test } from 'qunit';
import { setupRenderingTest } from 'test-app/tests/helpers';

/**
 * A touch that lands on a draggable is claimed by the page unless the element
 * says otherwise: the gesture gets the pointerdown and then nothing, because
 * the browser has taken the moves for a scroll. Which is to say a drag demo
 * that works with a mouse can be completely dead under a finger, and nothing
 * about it looks wrong.
 */
module('Integration | motion | drag touch-action', function (hooks) {
  setupRenderingTest(hooks);

  const of = () =>
    document.querySelector<HTMLElement>('[data-testid="box"]')!.style
      .touchAction;

  test('dragging both axes leaves the page nothing to scroll', async function (assert) {
    await render(
      <template>
        <div data-testid="box" {{motion drag=true}}></div>
      </template>
    );
    assert.strictEqual(of(), 'none');
  });

  test('a single-axis drag leaves the other axis to the page', async function (assert) {
    await render(
      <template>
        <div data-testid="box" {{motion drag="x"}}></div>
      </template>
    );
    assert.strictEqual(of(), 'pan-y', 'drag x, pan y');
  });

  test('and the other way round', async function (assert) {
    await render(
      <template>
        <div data-testid="box" {{motion drag="y"}}></div>
      </template>
    );
    assert.strictEqual(of(), 'pan-x', 'drag y, pan x');
  });

  test('an element that does not drag is left alone', async function (assert) {
    await render(
      <template>
        <div data-testid="box" style="touch-action: manipulation" {{motion}}>
        </div>
      </template>
    );
    assert.strictEqual(
      of(),
      'manipulation',
      'only ever gives back what it took'
    );
  });
});
