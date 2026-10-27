// Pretui — SystemLine unit tests.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules
// are not applied), so the checkpoint's one-line layout is not checked here.
import { module, test } from 'qunit';
import { render, click } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { SystemLine } from './system-line';

function root(): HTMLElement {
  return document.querySelector('[data-test-pretui-system-line]') as HTMLElement;
}
function action(): HTMLButtonElement | null {
  return root().querySelector('[data-test-pretui-system-line-action]');
}
function dismiss(): HTMLButtonElement | null {
  return root().querySelector('[data-test-pretui-system-line-dismiss]');
}

module('Pretui | components/system-line', function (hooks) {
  setupCardTest(hooks);

  test('is one caption line with no controls by default', async function (assert) {
    await render(<template><SystemLine @text='Model set to GPT-5.6 Terra' @by='Rupert' /></template>);
    assert.strictEqual(root().tagName, 'P');
    assert.strictEqual(root().dataset['variant'], 'line');
    assert.true(root().textContent?.includes('Model set to GPT-5.6 Terra · by Rupert'));
    assert.strictEqual(action(), null);
    assert.strictEqual(dismiss(), null);
  });

  test('a checkpoint carries its verb and a named dismiss button, each firing its own callback', async function (assert) {
    let calls: string[] = [];
    const onAction = () => calls.push('action');
    const onDismiss = () => calls.push('dismiss');
    await render(
      <template>
        <SystemLine @text='Before the refactor' @variant='checkpoint' @onAction={{onAction}} @onDismiss={{onDismiss}} />
      </template>,
    );
    assert.strictEqual(root().dataset['variant'], 'checkpoint');
    assert.strictEqual(action()?.textContent?.trim(), 'Restore', 'a checkpoint restores by default');
    assert.strictEqual(dismiss()?.getAttribute('aria-label'), 'Dismiss', 'the icon-only button has a name');
    assert.strictEqual(action()?.getAttribute('type'), 'button');
    assert.strictEqual(dismiss()?.getAttribute('type'), 'button');
    await click(action() as HTMLElement);
    await click(dismiss() as HTMLElement);
    assert.deepEqual(calls, ['action', 'dismiss']);
  });
});
