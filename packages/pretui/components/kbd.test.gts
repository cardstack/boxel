// Pretui — Kbd unit tests, plus the shortcut helpers behind it. Imports from
// ../menu; when Kbd moves to its own file only the import path changes.
//
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules are
// not applied).
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Kbd, ariaKeyShortcuts, formatShortcut } from '../menu';

function kbd(): HTMLElement {
  return document.querySelector('[data-test-pretui-kbd]') as HTMLElement;
}

module('Pretui | components/kbd', function (hooks) {
  setupCardTest(hooks);

  test('formatShortcut renders one spec as glyphs on Apple and words elsewhere', function (assert) {
    assert.strictEqual(formatShortcut('Mod+K', 'apple'), '⌘K');
    assert.strictEqual(formatShortcut('Mod+K', 'other'), 'Ctrl+K');
    assert.strictEqual(formatShortcut('Mod+Shift+K', 'apple'), '⇧⌘K', 'Apple orders shift before command');
    assert.strictEqual(formatShortcut('Mod+Shift+K', 'other'), 'Ctrl+Shift+K');
    assert.strictEqual(formatShortcut('Escape', 'other'), 'Esc');
    assert.strictEqual(formatShortcut('⌘K', 'other'), '⌘K', 'a literal face passes through untouched for the hand-typed call sites');
    assert.strictEqual(formatShortcut(undefined, 'other'), undefined);
  });

  test('ariaKeyShortcuts is the platform-neutral spelling, or nothing for a literal', function (assert) {
    assert.strictEqual(ariaKeyShortcuts('Mod+K', 'apple'), 'Meta+K', 'AT gets key names rather than a glyph');
    assert.strictEqual(ariaKeyShortcuts('Mod+K', 'other'), 'Control+K');
    assert.strictEqual(ariaKeyShortcuts('⌘K', 'apple'), undefined, 'a literal cannot be spelled out honestly');
  });

  test('renders a <kbd> whose face follows the platform and whose name is the spelled-out chord', async function (assert) {
    await render(<template><Kbd @value='Mod+K' @platform='apple' /></template>);
    assert.strictEqual(kbd().tagName, 'KBD');
    assert.strictEqual(kbd().textContent, '⌘K');
    assert.strictEqual(kbd().getAttribute('aria-label'), 'Meta+K');

    await render(<template><Kbd @value='Mod+K' @platform='other' /></template>);
    assert.strictEqual(kbd().textContent, 'Ctrl+K');
    assert.strictEqual(kbd().getAttribute('aria-label'), 'Control+K');
  });

  test('a literal face renders as written with no aria-label to contradict it', async function (assert) {
    await render(<template><Kbd @value='F2' @platform='other' /></template>);
    assert.strictEqual(kbd().textContent, 'F2');
    assert.strictEqual(kbd().getAttribute('aria-label'), null);
  });
});
