// Pretui — CopyButton unit tests. Imports from ./extras; when CopyButton moves to
// its own file only the import path changes.
//
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules are
// not applied).
import { module, test } from 'qunit';
import { render, click, triggerEvent } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { CopyButton } from './extras';

function q(sel: string): HTMLElement {
  return document.querySelector(sel) as HTMLElement;
}

// Stubs navigator.clipboard with an own property and returns the undo: the
// own property is deleted again (so an inherited Navigator.prototype getter
// keeps working for later tests), or restored to its original descriptor.
function stubClipboard(written: string[]): () => void {
  let original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: (t: string) => {
        written.push(t);
        return Promise.resolve();
      },
    },
  });
  return () => {
    if (original) {
      Object.defineProperty(navigator, 'clipboard', original);
    } else {
      delete (navigator as { clipboard?: unknown }).clipboard;
    }
  };
}

module('Pretui | components/copy-button', function (hooks) {
  setupCardTest(hooks);

  test('CopyButton names itself and shows the copy glyph while idle', async function (assert) {
    await render(<template><CopyButton @text='SKU-8812' /></template>);
    let btn = q('[data-test-pretui-copy-button]');
    assert.strictEqual(btn.getAttribute('aria-label'), 'Copy to clipboard');
    assert.strictEqual(btn.dataset['state'], undefined, 'nothing copied yet');
    assert.strictEqual(btn.querySelectorAll('svg').length, 1, 'one glyph while idle');
    assert.strictEqual(btn.querySelectorAll('.pretui-copy-check').length, 0, 'and it is not the checkmark');
  });

  test('CopyButton copies the text and confirms, then resets when the pointer leaves', async function (assert) {
    let written: string[] = [];
    let restore = stubClipboard(written);
    try {
      await render(<template><CopyButton @text='SKU-8812' /></template>);
      await click('[data-test-pretui-copy-button]');
      assert.deepEqual(written, ['SKU-8812']);

      let btn = q('[data-test-pretui-copy-button]');
      assert.strictEqual(btn.dataset['state'], 'copied');
      assert.strictEqual(
        btn.getAttribute('aria-label'),
        'Copied',
        'the accessible name follows the state (a label swap is not itself announced — copy-button.md names that as the open gap)',
      );
      assert.strictEqual(btn.querySelectorAll('.pretui-copy-check').length, 1);

      // Realm components own no free-running timers, so the confirmation
      // lasts exactly as long as the pointer lingers or the button has focus.
      await triggerEvent(btn, 'pointerleave');
      assert.strictEqual(q('[data-test-pretui-copy-button]').dataset['state'], undefined);

      await click('[data-test-pretui-copy-button]');
      assert.strictEqual(q('[data-test-pretui-copy-button]').dataset['state'], 'copied');
      await triggerEvent(btn, 'blur');
      assert.strictEqual(q('[data-test-pretui-copy-button]').dataset['state'], undefined, 'blur resets too, so a keyboard user is not left stuck on "Copied"');
    } finally {
      restore();
    }
  });

  test('CopyButton takes the payload from the @value alias and does nothing with none', async function (assert) {
    let written: string[] = [];
    let restore = stubClipboard(written);
    try {
      await render(<template><CopyButton @value='from-value' /></template>);
      await click('[data-test-pretui-copy-button]');
      assert.deepEqual(written, ['from-value']);

      await render(<template><CopyButton @label='Copy id' /></template>);
      assert.strictEqual(q('[data-test-pretui-copy-button]').getAttribute('aria-label'), 'Copy id');
      await click('[data-test-pretui-copy-button]');
      assert.strictEqual(written.length, 1, 'nothing to copy is not an empty clipboard write');
    } finally {
      restore();
    }
  });
});
