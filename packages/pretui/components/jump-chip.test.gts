// Pretui — JumpChip unit tests. Imports from ../agentic-chat; when JumpChip moves to its
// own file only the import path changes.
//
// Local-only test file, kept off the realm by `.boxelignore` (`*.test.gts`);
// run with `boxel test`. No assertion touches a computed style: the
// component's own `<style scoped>` is inert in this harness (the scoped-css
// attribute is stamped, the rules are not applied).
import { module, test } from 'qunit';
import { render, click } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { JumpChip } from './jump-chip';

function root(): HTMLElement {
  return document.querySelector('[data-test-pretui-jump-chip]') as HTMLElement;
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
});
