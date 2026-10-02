// Pretui — EmojiButton unit tests. The picker
// itself has its own file (emoji-picker.test.gts); asserted here is the
// trigger and the popover round-trip.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules
// are not applied).
import { module, test } from 'qunit';
import { render, click } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { EmojiButton } from './emoji-button';

function trigger(): HTMLButtonElement {
  return document.querySelector('[data-test-pretui-emoji-trigger]') as HTMLButtonElement;
}
function picker(): HTMLElement | null {
  return document.querySelector('[data-test-pretui-emoji-picker]');
}

module('Pretui | components/emoji-button', function (hooks) {
  setupCardTest(hooks);

  test('is a named dialog trigger with a decorative glyph, closed at rest', async function (assert) {
    await render(<template><EmojiButton /></template>);
    assert.strictEqual(trigger().getAttribute('aria-label'), 'Insert emoji');
    assert.strictEqual(trigger().getAttribute('aria-haspopup'), 'dialog');
    assert.strictEqual(trigger().getAttribute('aria-expanded'), 'false');
    assert.strictEqual(trigger().dataset['open'], undefined);
    assert.strictEqual(trigger().querySelector('.epb-glyph')?.getAttribute('aria-hidden'), 'true', 'the face is decoration; the label carries the meaning');
    assert.strictEqual(trigger().querySelector('.epb-glyph')?.textContent, '\u{1F642}');
    assert.strictEqual(picker(), null, 'the picker mounts only while open');
  });

  test('takes a caller label and glyph', async function (assert) {
    await render(<template><EmojiButton @label='React' @glyph='👍' /></template>);
    assert.strictEqual(trigger().getAttribute('aria-label'), 'React');
    assert.strictEqual(trigger().querySelector('.epb-glyph')?.textContent, '👍');
  });

  test('opens the picker on click and closes it on a second click', async function (assert) {
    await render(<template><EmojiButton /></template>);
    await click(trigger());
    assert.strictEqual(trigger().getAttribute('aria-expanded'), 'true');
    assert.strictEqual(trigger().dataset['open'], 'true');
    assert.ok(picker(), 'the picker is in the popover');
    assert.ok(document.querySelector('[data-test-pretui-emoji-search]'), 'with its search field');

    await click(trigger());
    assert.strictEqual(trigger().getAttribute('aria-expanded'), 'false');
    assert.strictEqual(picker(), null);
  });
});
