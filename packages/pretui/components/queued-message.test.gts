// Pretui — QueuedMessage unit tests. Imports from ../agentic; when QueuedMessage moves to its
// own file only the import path changes.
//
// Local-only test file, kept off the realm by `.boxelignore` (`*.test.gts`);
// run with `boxel test`. No assertion touches a computed style: the
// component's own `<style scoped>` is inert in this harness (the scoped-css
// attribute is stamped, the rules are not applied).
import { module, test } from 'qunit';
import { render, click } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { QueuedMessage } from './queued-message';

function msg(): HTMLElement {
  return document.querySelector('[data-test-pretui-queued-message]') as HTMLElement;
}
function buttons(): string[] {
  return Array.from(msg().querySelectorAll('button')).map((b) => b.textContent?.trim() as string);
}

module('Pretui | components/queued-message', function (hooks) {
  setupCardTest(hooks);

  test('steer is the default and states its delivery semantics in words', async function (assert) {
    await render(<template><QueuedMessage @text='Also check the Anxi lot' /></template>);
    assert.strictEqual(msg().querySelector('.pretui-queued-mode')?.textContent?.trim(), 'steer');
    assert.strictEqual(msg().querySelector('.pretui-queued-text')?.textContent?.trim(), 'Also check the Anxi lot');
    assert.strictEqual(msg().querySelector('.pretui-queued-note')?.textContent?.trim(), 'delivered at next checkpoint');
    assert.deepEqual(buttons(), [], 'no actions without handlers');
  });

  test('send-now says it interrupts, and cannot be sent now again', async function (assert) {
    const noop = () => {};
    await render(<template><QueuedMessage @text='x' @mode='now' @onSendNow={{noop}} @onEdit={{noop}} /></template>);
    assert.strictEqual(msg().querySelector('.pretui-queued-mode')?.textContent?.trim(), 'send now');
    assert.strictEqual(msg().querySelector('.pretui-queued-note')?.textContent?.trim(), 'interrupts the run');
    assert.deepEqual(buttons(), ['Edit'], 'Send now is meaningless on a message already marked now');
  });

  test('a steered message offers Edit and Send now, each routed', async function (assert) {
    let seen: string[] = [];
    const onEdit = () => seen.push('edit');
    const onSendNow = () => seen.push('now');
    await render(<template><QueuedMessage @text='x' @onEdit={{onEdit}} @onSendNow={{onSendNow}} /></template>);
    assert.deepEqual(buttons(), ['Edit', 'Send now']);
    await click(msg().querySelectorAll('button')[0] as HTMLElement);
    await click(msg().querySelectorAll('button')[1] as HTMLElement);
    assert.deepEqual(seen, ['edit', 'now']);
  });
});
