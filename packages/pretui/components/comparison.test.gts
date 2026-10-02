// Pretui — Comparison unit tests.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules
// are not applied).
import { module, test } from 'qunit';
import { render, triggerKeyEvent } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Comparison } from './comparison';

function root(): HTMLElement {
  return document.querySelector('[data-test-pretui-comparison]') as HTMLElement;
}
function handle(): HTMLElement {
  return root().querySelector('[role="slider"]') as HTMLElement;
}

module('Pretui | components/comparison', function (hooks) {
  setupCardTest(hooks);

  test('is a before/after pair split by a keyboard-operable slider, resting at the middle', async function (assert) {
    await render(
      <template>
        <Comparison>
          <:before><img data-test-before alt='' /></:before>
          <:after><img data-test-after alt='' /></:after>
        </Comparison>
      </template>,
    );
    assert.ok(root().querySelector('.pretui-comparison-before [data-test-before]'));
    assert.ok(root().querySelector('.pretui-comparison-after [data-test-after]'));
    assert.strictEqual(root().getAttribute('style'), '--split: 50%');
    assert.strictEqual(handle().getAttribute('aria-label'), 'Comparison position');
    assert.strictEqual(handle().getAttribute('aria-valuemin'), '0');
    assert.strictEqual(handle().getAttribute('aria-valuemax'), '100');
    assert.strictEqual(handle().getAttribute('aria-valuenow'), '50');
    assert.strictEqual(handle().tabIndex, 0, 'a drag-only seam would exclude the keyboard');
    assert.strictEqual(root().dataset['dragging'], undefined);
  });

  test('arrows step by one, Shift+arrow by ten, Home and End to the edges, all clamped and reported', async function (assert) {
    let seen: number[] = [];
    const record = (v: number) => seen.push(v);
    await render(<template><Comparison @onValueChange={{record}}><:before>a</:before><:after>b</:after></Comparison></template>);
    await triggerKeyEvent(handle(), 'keydown', 'ArrowRight');
    await triggerKeyEvent(handle(), 'keydown', 'ArrowLeft', { shiftKey: true });
    await triggerKeyEvent(handle(), 'keydown', 'End');
    await triggerKeyEvent(handle(), 'keydown', 'ArrowUp');
    await triggerKeyEvent(handle(), 'keydown', 'Home');
    assert.deepEqual(seen, [51, 41, 100, 0], 'ArrowUp past 100 changes nothing, so reports nothing');
    assert.strictEqual(handle().getAttribute('aria-valuenow'), '0');
    assert.strictEqual(root().getAttribute('style'), '--split: 0%');
  });

  test('a controlled @value holds the seam still and reports the request', async function (assert) {
    let seen: number[] = [];
    const record = (v: number) => seen.push(v);
    await render(<template><Comparison @value={{30}} @label='Before and after' @onValueChange={{record}}><:before>a</:before><:after>b</:after></Comparison></template>);
    assert.strictEqual(handle().getAttribute('aria-label'), 'Before and after');
    await triggerKeyEvent(handle(), 'keydown', 'ArrowRight');
    assert.deepEqual(seen, [31]);
    assert.strictEqual(root().getAttribute('style'), '--split: 30%', 'the owner decides');
  });
});
