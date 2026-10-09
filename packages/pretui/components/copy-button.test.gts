// Pretui — CopyButton unit tests.
//
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules are
// not applied).
import { module, test } from 'qunit';
import { render, click, settled, triggerEvent, waitUntil } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { CopyButton, RESET_MS } from './copy-button';

function q(sel: string): HTMLElement {
  return document.querySelector(sel) as HTMLElement;
}

interface ClipboardStub {
  /** writeText rejects */
  fail?: boolean;
  /** writeText stays pending until resolve() is called */
  pending?: boolean;
  /** navigator.clipboard is undefined, as outside a secure context */
  absent?: boolean;
}

// Stubs navigator.clipboard with an own property and returns the undo: the
// own property is deleted again (so an inherited Navigator.prototype getter
// keeps working for later tests), or restored to its original descriptor.
function stubClipboard(
  written: string[],
  { fail = false, pending = false, absent = false }: ClipboardStub = {},
): { restore: () => void; resolve: () => void } {
  let original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  let resolve = () => {};
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: absent
      ? undefined
      : {
          writeText: (t: string) => {
            written.push(t);
            if (pending) {
              return new Promise<void>((r) => (resolve = r));
            }
            return fail
              ? Promise.reject(new Error('Write permission denied.'))
              : Promise.resolve();
          },
        },
  });
  let restore = () => {
    if (original) {
      Object.defineProperty(navigator, 'clipboard', original);
    } else {
      delete (navigator as { clipboard?: unknown }).clipboard;
    }
  };
  return { restore, resolve: () => resolve() };
}

module('Pretui | components/copy-button', function (hooks) {
  setupCardTest(hooks);

  test('CopyButton names itself and shows the copy glyph while idle', async function (assert) {
    await render(<template><CopyButton @text='SKU-8812' /></template>);
    let btn = q('[data-test-pretui-copy-button]');
    assert.strictEqual(btn.getAttribute('aria-label'), 'Copy to clipboard');
    assert.strictEqual(btn.dataset['state'], undefined, 'nothing copied yet');
    assert.strictEqual(q('[data-test-pretui-copy-button-glyph]').dataset['glyph'], 'copy', 'the copy glyph shows while idle');
    let status = q('[data-test-pretui-copy-button-status]');
    assert.strictEqual(status.getAttribute('role'), 'status', 'the live region is in place before anything is copied');
    assert.strictEqual(status.textContent, '');
    assert.notOk(btn.contains(status), 'outside the button, whose children are presentational');
  });

  test('CopyButton copies the text and confirms, and keeps the result through a blur', async function (assert) {
    let written: string[] = [];
    let { restore } = stubClipboard(written);
    try {
      await render(<template><CopyButton @text='SKU-8812' /></template>);
      await click('[data-test-pretui-copy-button]');
      assert.deepEqual(written, ['SKU-8812']);

      let btn = q('[data-test-pretui-copy-button]');
      assert.strictEqual(btn.dataset['state'], 'copied');
      assert.strictEqual(q('[data-test-pretui-copy-button-status]').textContent, 'Copied', 'the result is announced');
      assert.strictEqual(btn.getAttribute('aria-label'), 'Copy to clipboard', 'the name stays put, so voice control still matches it');
      assert.strictEqual(q('[data-test-pretui-copy-button-glyph]').dataset['glyph'], 'check');

      await triggerEvent(btn, 'pointerleave');
      await triggerEvent(btn, 'blur');
      assert.strictEqual(btn.dataset['state'], 'copied', 'only the timer resets it, so the result can be read');
    } finally {
      restore();
    }
  });

  test('CopyButton shows and announces a failed copy', async function (assert) {
    let written: string[] = [];
    let { restore } = stubClipboard(written, { fail: true });
    let originalError = console.error;
    let logged: unknown[] = [];
    console.error = (...args: unknown[]) => logged.push(...args);
    try {
      await render(<template><CopyButton @text='SKU-8812' /></template>);
      await click('[data-test-pretui-copy-button]');
      let btn = q('[data-test-pretui-copy-button]');
      assert.strictEqual(btn.dataset['state'], 'failed');
      assert.strictEqual(q('[data-test-pretui-copy-button-status]').textContent, 'Copy failed');
      assert.strictEqual(q('[data-test-pretui-copy-button-glyph]').dataset['glyph'], 'cross', 'never a check for a copy that did not happen');
      assert.deepEqual(logged, ['Write permission denied.']);
    } finally {
      console.error = originalError;
      restore();
    }
  });

  test('CopyButton takes the payload and name from their aliases and does nothing with no payload', async function (assert) {
    let written: string[] = [];
    let { restore } = stubClipboard(written);
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

      await render(<template><CopyButton @text='x' @label='' /></template>);
      assert.strictEqual(q('[data-test-pretui-copy-button]').getAttribute('aria-label'), 'Copy to clipboard', 'an empty name is no name');
    } finally {
      restore();
    }
  });

  test('CopyButton keeps the glyph through a repeat copy and announces it again', async function (assert) {
    let { restore, resolve } = stubClipboard([], { pending: true });
    try {
      await render(<template><CopyButton @text='SKU-8812' /></template>);
      await click('[data-test-pretui-copy-button]');
      resolve();
      await settled();
      let btn = q('[data-test-pretui-copy-button]');
      assert.strictEqual(btn.dataset['state'], 'copied');

      await click('[data-test-pretui-copy-button]');
      assert.strictEqual(btn.dataset['state'], 'copied', 'the check stays while the second write is in flight');
      assert.strictEqual(q('[data-test-pretui-copy-button-status]').textContent, '', 'the region is emptied so the result can be announced again');
      resolve();
      await settled();
      assert.strictEqual(q('[data-test-pretui-copy-button-status]').textContent, 'Copied');
    } finally {
      restore();
    }
  });

  test('CopyButton clears the result by itself when nothing else resets it', async function (assert) {
    let { restore } = stubClipboard([]);
    try {
      await render(<template><CopyButton @text='SKU-8812' /></template>);
      await click('[data-test-pretui-copy-button]');
      let btn = q('[data-test-pretui-copy-button]');
      assert.strictEqual(btn.dataset['state'], 'copied');
      await waitUntil(() => btn.dataset['state'] === undefined, { timeout: RESET_MS * 2 });
      assert.strictEqual(q('[data-test-pretui-copy-button-status]').textContent, '', 'a keyboard user keeps focus and a tap leaves no pointer, so the timer clears it');
    } finally {
      restore();
    }
  });

  test('CopyButton says so when there is no clipboard to write to', async function (assert) {
    let { restore } = stubClipboard([], { absent: true });
    try {
      await render(<template><CopyButton @text='SKU-8812' /></template>);
      await click('[data-test-pretui-copy-button]');
      let btn = q('[data-test-pretui-copy-button]');
      await waitUntil(() => btn.dataset['state'] === 'failed');
      assert.strictEqual(q('[data-test-pretui-copy-button-status]').textContent, 'Copy failed', 'the failure is announced');
      assert.strictEqual(btn.getAttribute('aria-label'), 'Copy to clipboard', 'the name stays put');
      assert.strictEqual(q('[data-test-pretui-copy-button-glyph]').dataset['glyph'], 'cross', 'and no checkmark claims success');
      await waitUntil(() => btn.dataset['state'] === undefined, { timeout: RESET_MS * 2 });
      assert.strictEqual(q('[data-test-pretui-copy-button-status]').textContent, '', 'the same timer clears it');
    } finally {
      restore();
    }
  });
});
