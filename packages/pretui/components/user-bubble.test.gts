// Pretui — UserBubble unit tests.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
import { module, test } from 'qunit';
import { render, click, fillIn, triggerKeyEvent } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { UserBubble } from './user-bubble';

module('Pretui | components/user-bubble', function (hooks) {
  setupCardTest(hooks);

  test('Edit shows only with the text it edits', async function (assert) {
    const onEdit = () => {};
    await render(<template><UserBubble @onEdit={{onEdit}}><b>rich</b></UserBubble></template>);
    assert.dom('[data-test-pretui-user-bubble-edit]').doesNotExist('a block alone gives the editor nothing to start from');
    await render(<template><UserBubble @text='Hello' @onEdit={{onEdit}}><b>Hello</b></UserBubble></template>);
    assert.dom('[data-test-pretui-user-bubble-edit]').exists();
  });

  test('an empty draft keeps the editor open with Save disabled', async function (assert) {
    let seen: string[] = [];
    const onEdit = (t: string) => seen.push(t);
    await render(<template><UserBubble @text='Hello' @onEdit={{onEdit}} /></template>);
    await click('[data-test-pretui-user-bubble-edit]');
    await fillIn('[data-test-pretui-user-bubble-editor] textarea', '   ');
    assert.dom('[data-test-pretui-user-bubble-save]').isDisabled();
    await triggerKeyEvent('[data-test-pretui-user-bubble-editor] textarea', 'keydown', 'Enter', { ctrlKey: true });
    assert.dom('[data-test-pretui-user-bubble-editor]').exists('still editing');
    assert.deepEqual(seen, []);
  });

  test('an unchanged draft is a Cancel: nothing is resent', async function (assert) {
    let seen: string[] = [];
    const onEdit = (t: string) => seen.push(t);
    await render(<template><UserBubble @text='Hello' @onEdit={{onEdit}} /></template>);
    await click('[data-test-pretui-user-bubble-edit]');
    await click('[data-test-pretui-user-bubble-save]');
    assert.deepEqual(seen, [], 'the thread is not rewound');
    assert.dom('[data-test-pretui-user-bubble-editor]').doesNotExist();
    await click('[data-test-pretui-user-bubble-edit]');
    await fillIn('[data-test-pretui-user-bubble-editor] textarea', 'Hello there');
    await click('[data-test-pretui-user-bubble-save]');
    assert.deepEqual(seen, ['Hello there']);
  });

  test('closing the editor returns focus to Edit, and its Escape stays inside', async function (assert) {
    let reached = 0;
    let onDoc = (e: KeyboardEvent) => e.key === 'Escape' && reached++;
    document.addEventListener('keydown', onDoc);
    try {
      const onEdit = () => {};
      await render(<template><UserBubble @text='Hello' @onEdit={{onEdit}} /></template>);
      await click('[data-test-pretui-user-bubble-edit]');
      await triggerKeyEvent('[data-test-pretui-user-bubble-editor] textarea', 'keydown', 'Escape');
      assert.dom('[data-test-pretui-user-bubble-editor]').doesNotExist();
      assert.strictEqual(reached, 0, 'the host does not also see the Escape');
      assert.dom('[data-test-pretui-user-bubble-edit]').isFocused('Escape returns focus to Edit');
      await click('[data-test-pretui-user-bubble-edit]');
      await click('[data-test-pretui-user-bubble-cancel]');
      assert.dom('[data-test-pretui-user-bubble-edit]').isFocused('Cancel returns focus to Edit');
    } finally {
      document.removeEventListener('keydown', onDoc);
    }
  });
});
