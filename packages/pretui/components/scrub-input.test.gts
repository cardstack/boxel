// Pretui — ScrubInput unit tests. No assertion touches a computed style: the
// component's own `<style scoped>` is inert in this harness.
import { module, test } from 'qunit';
import { render, triggerEvent, triggerKeyEvent } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { ScrubInput } from './scrub-input';

function grip(): HTMLElement {
  return document.querySelector('[data-test-pretui-scrub-grip]') as HTMLElement;
}

async function scrubTo(clientX: number) {
  await triggerEvent(grip(), 'pointerdown', { button: 0, pointerId: 1, clientX: 0 });
  await triggerEvent(grip(), 'pointermove', { pointerId: 1, clientX });
}

module('Pretui | components/scrub-input', function (hooks) {
  setupCardTest(hooks);

  test('a controlled scrub commits the scrubbed value on release', async function (assert) {
    let inputs: (number | null)[] = [];
    let changes: (number | null)[] = [];
    let onInput = (v: number | null) => inputs.push(v);
    let onChange = (v: number | null) => changes.push(v);
    await render(
      <template>
        <ScrubInput @value={{10}} @unit='px' @label='Width' @onInput={{onInput}} @onChange={{onChange}} />
      </template>,
    );
    await scrubTo(5);
    assert.deepEqual(inputs, [15], 'move frames report the scrubbed value');
    assert.deepEqual(changes, [], 'nothing commits mid-drag');
    await triggerEvent(grip(), 'pointerup', { pointerId: 1, clientX: 5 });
    assert.deepEqual(changes, [15], 'release commits the value the drag reached, not the controlled 10');
  });

  test('a press without movement commits nothing', async function (assert) {
    let changes: (number | null)[] = [];
    let onChange = (v: number | null) => changes.push(v);
    await render(<template><ScrubInput @value={{10}} @unit='px' @label='Width' @onChange={{onChange}} /></template>);
    await triggerEvent(grip(), 'pointerdown', { button: 0, pointerId: 1, clientX: 0 });
    await triggerEvent(grip(), 'pointerup', { pointerId: 1, clientX: 0 });
    assert.deepEqual(changes, []);
  });

  test('Escape cancels the scrub, restores the start value, and stops there', async function (assert) {
    let inputs: (number | null)[] = [];
    let changes: (number | null)[] = [];
    let outer = 0;
    let onInput = (v: number | null) => inputs.push(v);
    let onChange = (v: number | null) => changes.push(v);
    let count = (e: Event) => (e as KeyboardEvent).key === 'Escape' && outer++;
    document.addEventListener('keydown', count, true);
    try {
      await render(
        <template>
          <ScrubInput @defaultValue={{10}} @unit='px' @label='Width' @onInput={{onInput}} @onChange={{onChange}} />
        </template>,
      );
      await scrubTo(5);
      await triggerKeyEvent(grip(), 'keydown', 'Escape');
      assert.deepEqual(inputs, [15, 10], 'the start value is written back');
      assert.deepEqual(changes, [], 'nothing commits');
      assert.strictEqual(outer, 0, 'a document capture listener (an enclosing overlay) never sees that Escape');
      assert.strictEqual(document.querySelector('.pretui-scrub-input')?.getAttribute('aria-valuenow'), '10');
      await triggerEvent(grip(), 'pointerup', { pointerId: 1, clientX: 5 });
      assert.deepEqual(changes, [], 'the pointerup after a cancel is not a commit');
    } finally {
      document.removeEventListener('keydown', count, true);
    }
  });

  test('pointercancel puts the value back like Escape', async function (assert) {
    let changes: (number | null)[] = [];
    let onChange = (v: number | null) => changes.push(v);
    await render(<template><ScrubInput @defaultValue={{10}} @unit='px' @label='Width' @onChange={{onChange}} /></template>);
    await scrubTo(5);
    await triggerEvent(grip(), 'pointercancel', { pointerId: 1 });
    assert.deepEqual(changes, []);
    assert.strictEqual(document.querySelector('.pretui-scrub-input')?.getAttribute('aria-valuenow'), '10');
  });

  test('disabled steppers are announced as disabled', async function (assert) {
    await render(<template><ScrubInput @value={{10}} @label='Width' @steppers={{true}} @disabled={{true}} /></template>);
    assert.strictEqual(document.querySelector('[data-test-pretui-scrub-up]')?.getAttribute('aria-disabled'), 'true');
    assert.strictEqual(document.querySelector('[data-test-pretui-scrub-down]')?.getAttribute('aria-disabled'), 'true');
  });
});
