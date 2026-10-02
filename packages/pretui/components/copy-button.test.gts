// Pretui — CopyButton unit tests.
//
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules are
// not applied).
import { module, test } from 'qunit';
import { render, click, triggerEvent } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { CopyButton } from './copy-button';

function q(sel: string): HTMLElement {
  return document.querySelector(sel) as HTMLElement;
}

// Stubs navigator.clipboard with an own property and returns the undo: the
// own property is deleted again (so an inherited Navigator.prototype getter
// keeps working for later tests), or restored to its original descriptor.
function stubClipboard(written: string[], { fail = false } = {}): () => void {
  let original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: (t: string) => {
        written.push(t);
        return fail
          ? Promise.reject(new Error('Write permission denied.'))
          : Promise.resolve();
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
    let status = q('[data-test-pretui-copy-button-status]');
    assert.strictEqual(status.getAttribute('role'), 'status', 'the live region is in place before anything is copied');
    assert.strictEqual(status.textContent, '');
    assert.notOk(btn.contains(status), 'outside the button, whose children are presentational');
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
      assert.strictEqual(q('[data-test-pretui-copy-button-status]').textContent, 'Copied', 'the result is announced');
      assert.strictEqual(btn.getAttribute('aria-label'), 'Copy to clipboard', 'the name stays put, so voice control still matches it');
      assert.strictEqual(btn.querySelectorAll('.pretui-copy-check').length, 1);

      // Realm components own no free-running timers, so the confirmation
      // lasts exactly as long as the pointer lingers or the button has focus.
      await triggerEvent(btn, 'pointerleave');
      assert.strictEqual(q('[data-test-pretui-copy-button]').dataset['state'], undefined);
      assert.strictEqual(q('[data-test-pretui-copy-button-status]').textContent, '');

      await click('[data-test-pretui-copy-button]');
      assert.strictEqual(q('[data-test-pretui-copy-button]').dataset['state'], 'copied');
      await triggerEvent(btn, 'blur');
      assert.strictEqual(q('[data-test-pretui-copy-button]').dataset['state'], undefined, 'blur resets too, so a keyboard user is not left stuck on "Copied"');
    } finally {
      restore();
    }
  });

  test('CopyButton shows and announces a failed copy', async function (assert) {
    let written: string[] = [];
    let restore = stubClipboard(written, { fail: true });
    let originalError = console.error;
    let logged: unknown[] = [];
    console.error = (...args: unknown[]) => logged.push(...args);
    try {
      await render(<template><CopyButton @text='SKU-8812' /></template>);
      await click('[data-test-pretui-copy-button]');
      let btn = q('[data-test-pretui-copy-button]');
      assert.strictEqual(btn.dataset['state'], 'failed');
      assert.strictEqual(q('[data-test-pretui-copy-button-status]').textContent, 'Copy failed');
      assert.strictEqual(btn.querySelectorAll('.pretui-copy-failed').length, 1);
      assert.strictEqual(btn.querySelectorAll('.pretui-copy-check').length, 0, 'never a check for a copy that did not happen');
      assert.deepEqual(logged, ['Write permission denied.']);
    } finally {
      console.error = originalError;
      restore();
    }
  });

  test('CopyButton takes the payload and name from their aliases and does nothing with no payload', async function (assert) {
    let written: string[] = [];
    let restore = stubClipboard(written);
    try {
      await render(<template><CopyButton @value='from-value' /></template>);
      await click('[data-test-pretui-copy-button]');
      assert.deepEqual(written, ['from-value']);

      await render(<template><CopyButton @textToCopy='from-boxel-ui' @ariaLabel='Copy SKU' /></template>);
      await click('[data-test-pretui-copy-button]');
      assert.deepEqual(written, ['from-value', 'from-boxel-ui'], "boxel-ui's spellings work");
      assert.strictEqual(q('[data-test-pretui-copy-button]').getAttribute('aria-label'), 'Copy SKU');

      await render(<template><CopyButton @label='Copy id' /></template>);
      assert.strictEqual(q('[data-test-pretui-copy-button]').getAttribute('aria-label'), 'Copy id');
      await click('[data-test-pretui-copy-button]');
      assert.strictEqual(written.length, 2, 'nothing to copy is not an empty clipboard write');
    } finally {
      restore();
    }
  });
});
