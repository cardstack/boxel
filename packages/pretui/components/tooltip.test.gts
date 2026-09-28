// Pretui — Tooltip unit tests. Imports from ../structure; when Tooltip moves
// to its own file only the import path changes.
//
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules are
// not applied).
import { module, test } from 'qunit';
import {
  render,
  focus,
  blur,
  triggerEvent,
  triggerKeyEvent,
} from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Tooltip } from './tooltip';

function q(sel: string): HTMLElement {
  return document.querySelector(sel) as HTMLElement;
}

module('Pretui | components/tooltip', function (hooks) {
  setupCardTest(hooks);

  test('Tooltip wires its bubble onto the trigger via aria-describedby', async function (assert) {
    await render(
      <template>
        <Tooltip @content='Publishes to the realm'>
          <button type='button' data-test-trigger>Publish</button>
        </Tooltip>
      </template>,
    );
    let tip = q('[role="tooltip"]');
    let trigger = q('[data-test-trigger]');
    assert.ok(tip.id, 'the bubble has an id to point at');
    assert.strictEqual(
      trigger.getAttribute('aria-describedby'),
      tip.id,
      'the trigger references it — a bubble nobody points at is announced to nobody',
    );
    assert.strictEqual(tip.textContent?.trim(), 'Publishes to the realm');
    assert.strictEqual(tip.dataset['open'], undefined, 'closed at rest');
    assert.strictEqual(tip.dataset['side'], 'top', 'top by default');
  });

  test('Tooltip names rather than describes when @labels is set', async function (assert) {
    await render(
      <template>
        <Tooltip @content='Delete' @labels={{true}}>
          <button type='button' data-test-trigger>✕</button>
        </Tooltip>
      </template>,
    );
    let trigger = q('[data-test-trigger]');
    assert.strictEqual(trigger.getAttribute('aria-labelledby'), q('[role="tooltip"]').id);
    assert.strictEqual(trigger.getAttribute('aria-describedby'), null, 'one relationship, not both');
  });

  test('Tooltip preserves a describedby the trigger already had', async function (assert) {
    await render(
      <template>
        <Tooltip @content='Extra'>
          <button type='button' data-test-trigger aria-describedby='existing-hint'>Go</button>
        </Tooltip>
        <span id='existing-hint'>hint</span>
      </template>,
    );
    assert.strictEqual(
      q('[data-test-trigger]').getAttribute('aria-describedby'),
      `existing-hint ${q('[role="tooltip"]').id}`,
      'appended, not overwritten',
    );
  });

  test('Tooltip opens on hover and on focus, and closes again', async function (assert) {
    await render(
      <template>
        <Tooltip @content='Hint' @side='right'>
          <button type='button' data-test-trigger>Go</button>
        </Tooltip>
      </template>,
    );
    let wrap = q('[data-test-pretui-tooltip]');
    let tip = q('[role="tooltip"]');
    assert.strictEqual(tip.dataset['side'], 'right');

    await triggerEvent(wrap, 'mouseenter');
    assert.strictEqual(tip.dataset['open'], 'true', 'hover opens it');
    await triggerEvent(wrap, 'mouseleave');
    assert.strictEqual(tip.dataset['open'], undefined);

    await focus('[data-test-trigger]');
    assert.strictEqual(tip.dataset['open'], 'true', 'keyboard focus opens it too');
    await blur('[data-test-trigger]');
    assert.strictEqual(tip.dataset['open'], undefined);
  });

  test('Tooltip is dismissible with Escape while the pointer stays put (WCAG 1.4.13)', async function (assert) {
    await render(
      <template>
        <Tooltip @content='Hint'>
          <button type='button' data-test-trigger>Go</button>
        </Tooltip>
      </template>,
    );
    let tip = q('[role="tooltip"]');
    await triggerEvent(q('[data-test-pretui-tooltip]'), 'mouseenter');
    assert.strictEqual(tip.dataset['open'], 'true');

    await triggerKeyEvent(document, 'keydown', 'Escape');
    assert.strictEqual(tip.dataset['open'], undefined, 'Escape hides it without moving the pointer');

    await triggerEvent(q('[data-test-pretui-tooltip]'), 'mouseleave');
    await triggerEvent(q('[data-test-pretui-tooltip]'), 'mouseenter');
    assert.strictEqual(tip.dataset['open'], 'true', 'leaving and returning arms it again');
  });
});
