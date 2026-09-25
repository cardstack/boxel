// Pretui — StreamingText unit tests. Imports from ../reading; when
// StreamingText moves to its own file only the import path changes.
//
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules are
// not applied).
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { StreamingText } from '../reading';

function q(sel: string): HTMLElement {
  return document.querySelector(sel) as HTMLElement;
}
function all(sel: string): HTMLElement[] {
  return Array.from(document.querySelectorAll(sel)) as HTMLElement[];
}

module('Pretui | components/streaming-text', function (hooks) {
  setupCardTest(hooks);

  test('StreamingText stages each word on a CSS delay and mirrors the whole text for screen readers', async function (assert) {
    await render(<template><StreamingText @text='Three words here' /></template>);
    let root = q('[data-test-pretui-streaming-text]');
    let words = all('.pretui-stream-word');
    assert.deepEqual(words.map((w) => w.textContent?.trim()), ['Three', 'words', 'here']);
    assert.deepEqual(
      words.map((w) => w.getAttribute('style')),
      ['animation-delay: 0.000s', 'animation-delay: 0.056s', 'animation-delay: 0.111s'],
      'the default rate is 18 words per second — CSS delays, not a timer',
    );
    assert.strictEqual(
      root.querySelector('[aria-hidden="true"]')?.contains(words[0] as Node),
      true,
      'the staged words are hidden from assistive tech',
    );
    assert.strictEqual(
      root.querySelector('.pretui-sr')?.textContent?.trim(),
      'Three words here',
      'and the full text is available at once',
    );
  });

  test('StreamingText obeys the rate and the start delay', async function (assert) {
    await render(<template><StreamingText @text='a b' @rate={{2}} @startDelay={{1.5}} /></template>);
    assert.deepEqual(
      all('.pretui-stream-word').map((w) => w.getAttribute('style')),
      ['animation-delay: 1.500s', 'animation-delay: 2.000s'],
    );
  });

  test('StreamingText shows the cursor only when asked, and hides it from screen readers', async function (assert) {
    await render(<template><StreamingText @text='typing' /></template>);
    assert.notOk(q('.pretui-stream-cursor'));

    await render(<template><StreamingText @text='typing' @cursor={{true}} /></template>);
    assert.strictEqual(q('.pretui-stream-cursor').getAttribute('aria-hidden'), 'true');
  });
});
