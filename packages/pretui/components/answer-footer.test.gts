// Pretui — AnswerFooter unit tests.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
import { module, test } from 'qunit';
import { render, click } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { AnswerFooter } from './answer-footer';

module('Pretui | components/answer-footer', function (hooks) {
  setupCardTest(hooks);

  test('saving keeps focus on the one save button and announces the saved name', async function (assert) {
    let opened = 0;
    const onSave = async () => 'Tea notes';
    const onOpenSaved = () => opened++;
    await render(<template><AnswerFooter @text='x' @onSave={{onSave}} @onOpenSaved={{onOpenSaved}} /></template>);
    let button = document.querySelector('[data-test-pretui-answer-save]') as HTMLElement;
    assert.dom('[data-test-pretui-answer-save-status]').hasAttribute('role', 'status');
    assert.dom('[data-test-pretui-answer-save-status]').hasText('');
    await click(button);
    assert.strictEqual(document.activeElement, button, 'focus stays on the same button');
    assert.dom(button).hasText('Saved · Tea notes');
    assert.dom('[data-test-pretui-answer-save-status]').hasText('Saved as Tea notes');
    await click(button);
    assert.strictEqual(opened, 1, 'the same button now opens what was saved');
  });

  test('a failed save is announced once, from the status region', async function (assert) {
    const onSave = async () => {
      throw new Error('No write access');
    };
    await render(<template><AnswerFooter @text='x' @onSave={{onSave}} /></template>);
    await click('[data-test-pretui-answer-save]');
    assert.dom('[data-test-pretui-answer-save-status]').hasText('Couldn’t save: No write access');
    assert.dom('[data-test-pretui-answer-save-error]').doesNotHaveAttribute('role');
    assert.dom('[data-test-pretui-answer-save]').isFocused();
  });
});
