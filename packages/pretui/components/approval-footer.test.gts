// Pretui — ApprovalFooter unit tests.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules
// are not applied).
import { module, test } from 'qunit';
import { render, click } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { ApprovalFooter } from './approval-footer';

function footer(): HTMLElement {
  return document.querySelector('[data-test-pretui-approval-footer]') as HTMLElement;
}
function buttons(): HTMLButtonElement[] {
  return Array.from(footer().querySelectorAll('button')) as HTMLButtonElement[];
}
function button(text: string): HTMLButtonElement {
  return buttons().find((b) => b.textContent?.trim() === text) as HTMLButtonElement;
}

module('Pretui | components/approval-footer', function (hooks) {
  setupCardTest(hooks);

  test('says how many changes await, with the right grammar', async function (assert) {
    await render(<template><ApprovalFooter /></template>);
    assert.strictEqual(footer().querySelector('.pretui-approval-msg')?.textContent?.trim(), '1 change awaits your approval');
    await render(<template><ApprovalFooter @count={{3}} /></template>);
    assert.strictEqual(footer().querySelector('.pretui-approval-msg')?.textContent?.trim(), '3 changes await your approval');
    await render(<template><ApprovalFooter @message='Retire this listing?' /></template>);
    assert.strictEqual(footer().querySelector('.pretui-approval-msg')?.textContent?.trim(), 'Retire this listing?');
  });

  test('offers Revert and Keep; Accept all only with a handler', async function (assert) {
    await render(<template><ApprovalFooter /></template>);
    assert.deepEqual(buttons().map((b) => b.textContent?.trim()), ['Revert', 'Keep']);
    const noop = () => {};
    await render(<template><ApprovalFooter @onAcceptAll={{noop}} /></template>);
    assert.deepEqual(buttons().map((b) => b.textContent?.trim()), ['Accept all', 'Revert', 'Keep']);
  });

  test('a destructive approval renames Keep so the reader knows what they are keeping', async function (assert) {
    await render(<template><ApprovalFooter @destructive={{true}} /></template>);
    assert.ok(button('Keep anyway'), 'destructive operations always ask, regardless of autonomy level');
  });

  test('routes each action', async function (assert) {
    let seen: string[] = [];
    const onKeep = () => seen.push('keep');
    const onRevert = () => seen.push('revert');
    const onAcceptAll = () => seen.push('all');
    await render(<template><ApprovalFooter @onKeep={{onKeep}} @onRevert={{onRevert}} @onAcceptAll={{onAcceptAll}} /></template>);
    await click(button('Keep'));
    await click(button('Revert'));
    await click(button('Accept all'));
    assert.deepEqual(seen, ['keep', 'revert', 'all']);
  });
});
