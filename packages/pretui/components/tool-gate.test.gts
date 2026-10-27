// Pretui — ToolGate unit tests: focus through the decline flow, a busy
// answer that keeps focus, and the destructive gate's answers.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness.
import { module, test } from 'qunit';
import { render, click, settled, triggerKeyEvent } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { ToolGate } from './tool-gate';
import type { ToolGateAction } from './tool-gate';

function answer(id: string): HTMLButtonElement {
  return document.querySelector(`[data-test-pretui-tool-gate-action="${id}"]`) as HTMLButtonElement;
}

module('Pretui | components/tool-gate', function (hooks) {
  setupCardTest(hooks);

  test('declining moves focus to the reason field, and Back or Escape returns it to the decline answer', async function (assert) {
    const noop = () => undefined;
    const onDecline = () => undefined;
    const actions: ToolGateAction[] = [
      { id: 'allow', label: 'Allow once', kind: 'primary', onAct: noop },
      { id: 'deny', label: 'Deny', kind: 'quiet', declines: true, onAct: noop },
    ];
    await render(<template><ToolGate @prompt='Run this?' @actions={{actions}} @onDecline={{onDecline}} /></template>);

    await click(answer('deny'));
    assert.strictEqual(document.activeElement, document.querySelector('[data-test-pretui-tool-gate-reason]'), 'the reason field has focus');

    await click('[data-test-pretui-tool-gate-decline-back]');
    assert.strictEqual(document.activeElement, answer('deny'), 'Back returns focus to Deny');

    await click(answer('deny'));
    let escapes = 0;
    const countEscape = () => escapes++;
    document.addEventListener('keydown', countEscape);
    await triggerKeyEvent('[data-test-pretui-tool-gate-reason]', 'keydown', 'Escape');
    document.removeEventListener('keydown', countEscape);
    assert.strictEqual(document.activeElement, answer('deny'), 'Escape returns focus to Deny');
    assert.strictEqual(escapes, 0, 'the field keeps its Escape from the document');
  });

  test('a pressed answer stays focusable while its action runs', async function (assert) {
    let calls = 0;
    let finish: () => void = () => undefined;
    const allow = () => {
      calls++;
      return new Promise<void>((resolve) => (finish = resolve));
    };
    const actions: ToolGateAction[] = [{ id: 'allow', label: 'Allow once', kind: 'primary', onAct: allow }];
    await render(<template><ToolGate @prompt='Run this?' @actions={{actions}} /></template>);
    let button = answer('allow');
    button.focus();
    click(button);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.false(button.disabled, 'busy is not the disabled attribute');
    assert.dom(button).hasAttribute('aria-disabled', 'true');
    assert.strictEqual(document.activeElement, button);
    await click(button);
    assert.strictEqual(calls, 1, 'a second press does nothing');
    finish();
    await settled();
  });

  test('a destructive gate says so and drops any "always" answer', async function (assert) {
    const noop = () => undefined;
    const actions: ToolGateAction[] = [
      { id: 'delete', label: 'Delete 3 files', kind: 'primary', onAct: noop },
      { id: 'always', label: 'Always for this session', always: true, onAct: noop },
    ];
    await render(<template><ToolGate @prompt='Delete these files?' @actions={{actions}} @destructive={{true}} /></template>);
    assert.dom('[data-test-pretui-tool-gate]').hasAttribute('data-destructive', 'true');
    assert.dom('[data-test-pretui-tool-gate-destructive]').hasText('This cannot be undone.');
    assert.dom('[data-test-pretui-tool-gate-action="delete"]').hasAttribute('data-kind', 'primary');
    assert.dom('[data-test-pretui-tool-gate-action="always"]').doesNotExist();
  });
});
