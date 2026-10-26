// Pretui — JumpChip unit tests.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules
// are not applied).
import { module, test } from 'qunit';
import { render, click, settled } from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { JumpChip } from './jump-chip';

function root(): HTMLElement {
  return document.querySelector('[data-test-pretui-jump-chip]') as HTMLElement;
}
function status(): HTMLElement {
  return document.querySelector('[data-test-pretui-jump-chip-status]') as HTMLElement;
}
function button(): HTMLButtonElement {
  return root().querySelector('[data-test-pretui-jump-chip-button]') as HTMLButtonElement;
}

module('Pretui | components/jump-chip', function (hooks) {
  setupCardTest(hooks);

  test('is a visible "Back to bottom" by default', async function (assert) {
    await render(<template><JumpChip /></template>);
    assert.strictEqual(root().dataset['visible'], 'true');
    assert.strictEqual(root().dataset['direction'], 'down');
    assert.strictEqual(root().dataset['news'], undefined);
    assert.false(root().inert);
    assert.strictEqual(button().textContent?.trim(), 'Back to bottom');
  });

  test('hidden means inert — not merely faded — so it cannot be tabbed to', async function (assert) {
    await render(<template><JumpChip @visible={{false}} /></template>);
    assert.strictEqual(root().dataset['visible'], undefined);
    assert.true(root().inert);
  });

  test('new arrivals switch it to the news voice with a count, and it jumps on click', async function (assert) {
    let jumps = 0;
    const onJump = () => (jumps += 1);
    await render(<template><JumpChip @count={{1}} @onJump={{onJump}} /></template>);
    assert.strictEqual(root().dataset['news'], 'true');
    assert.strictEqual(button().textContent?.trim(), '1 new message');
    await click(button());
    assert.strictEqual(jumps, 1);

    await render(<template><JumpChip @count={{4}} /></template>);
    assert.strictEqual(button().textContent?.trim(), '4 new messages');
  });

  test('points up on request, and a caller label overrides everything', async function (assert) {
    await render(<template><JumpChip @direction='up' /></template>);
    assert.strictEqual(root().dataset['direction'], 'up');
    assert.strictEqual(button().textContent?.trim(), 'Back to top');
    await render(<template><JumpChip @count={{9}} @label='Jump to live' /></template>);
    assert.strictEqual(button().textContent?.trim(), 'Jump to live');
  });

  test('formats the count and picks the plural from it', async function (assert) {
    await render(<template><JumpChip @count={{1204}} /></template>);
    assert.strictEqual(button().textContent?.trim(), '1,204 new messages');
  });

  test('says the news once through a polite status region outside the chip', async function (assert) {
    class State {
      @tracked count = 0;
      @tracked visible = true;
    }
    let state = new State();
    await render(<template><JumpChip @count={{state.count}} @visible={{state.visible}} /></template>);
    assert.strictEqual(status().getAttribute('role'), 'status');
    assert.false(root().contains(status()), 'the region is not inside the chip, which goes inert while hidden');
    assert.strictEqual(status().textContent?.trim(), '', 'no news, nothing to say');

    state.count = 3;
    await settled();
    assert.strictEqual(status().textContent?.trim(), '3 new messages');

    state.visible = false;
    await settled();
    assert.strictEqual(status().textContent?.trim(), '', 'a hidden chip offers nothing to hear');
  });

  test('a keyboard jump that hides the chip keeps focus on its button until focus leaves', async function (assert) {
    class State {
      @tracked visible = true;
    }
    let state = new State();
    const onJump = () => (state.visible = false);
    await render(
      <template>
        <JumpChip @count={{2}} @visible={{state.visible}} @onJump={{onJump}} />
        <input aria-label='elsewhere' data-test-elsewhere />
      </template>,
    );
    button().focus();
    assert.true(button().matches(':focus-visible'), 'keyboard focus on the chip');
    button().click();
    await settled();
    assert.strictEqual(root().dataset['visible'], undefined, 'the caller hid the chip');
    assert.false(root().inert, 'not inert while it holds the focus');
    assert.strictEqual(document.activeElement, button(), 'focus stayed on the button');

    (document.querySelector('[data-test-elsewhere]') as HTMLElement).focus();
    await settled();
    assert.true(root().inert, 'inert once focus left');
  });
});
