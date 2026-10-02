// Alert unit tests: what a screen reader reaches inside the banner. The tone
// glyph is hidden from it, and a visually hidden tone word is read in its
// place, because the role only singles out `danger`.
//
// Run with `boxel test`.
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Alert } from './alert';

function alerts(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-test-pretui-alert]')];
}

// The text left in the accessibility tree: every text node that no
// `aria-hidden="true"` ancestor (up to and including `root`) removes.
function accessibleText(root: HTMLElement): string {
  let walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let parts: string[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    let hidden = node.parentElement?.closest('[aria-hidden="true"]');
    if (!hidden || !root.contains(hidden)) {
      parts.push(node.textContent ?? '');
    }
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

module('Pretui | components/alert', function (hooks) {
  setupCardTest(hooks);

  test('the tone glyph is hidden from assistive technology in every tone', async function (assert) {
    await render(
      <template>
        <Alert @tone='info' @title='Heads up' />
        <Alert @tone='success' @title='Saved' />
        <Alert @tone='warning' @title='Low credit' />
        <Alert @tone='danger' @title='Payment failed' />
      </template>,
    );
    let glyphs = alerts().map((el) => el.querySelector('.pretui-alert-glyph'));
    assert.deepEqual(
      glyphs.map((g) => g?.textContent?.trim()),
      ['i', '✓', '!', '✕'],
      'each tone still paints its glyph',
    );
    assert.deepEqual(
      glyphs.map((g) => g?.getAttribute('aria-hidden')),
      ['true', 'true', 'true', 'true'],
    );
  });

  test('the accessible text is the tone word, the title and the message, with no glyph', async function (assert) {
    await render(
      <template>
        <Alert @tone='danger' @title='Payment failed'>The card was declined.</Alert>
        <Alert @tone='info'>Three records imported.</Alert>
      </template>,
    );
    let [danger, info] = alerts();
    assert.strictEqual(danger.getAttribute('role'), 'alert', 'the danger tone still escalates the role');
    assert.strictEqual(accessibleText(danger), 'Error: Payment failed The card was declined.');
    assert.strictEqual(info.getAttribute('role'), 'status');
    assert.strictEqual(accessibleText(info), 'Info: Three records imported.');
  });

  test('the polite tones share a role, so the tone word is what tells them apart', async function (assert) {
    await render(
      <template>
        <Alert @tone='info' @title='Three records imported.' />
        <Alert @tone='success' @title='Three records imported.' />
        <Alert @tone='warning' @title='Three records imported.' />
        <Alert @tone='danger' @title='Three records imported.' />
      </template>,
    );
    assert.deepEqual(
      alerts().map((el) => el.getAttribute('role')),
      ['status', 'status', 'status', 'alert'],
    );
    assert.deepEqual(alerts().map(accessibleText), [
      'Info: Three records imported.',
      'Success: Three records imported.',
      'Warning: Three records imported.',
      'Error: Three records imported.',
    ]);
    assert.strictEqual(
      document.querySelectorAll('[data-test-pretui-alert] [data-test-pretui-visually-hidden]').length,
      4,
      'the word is visually hidden, so the glyph stays the only tone mark on screen',
    );
  });

  test('the tone word follows the React spellings and takes a caller label', async function (assert) {
    await render(
      <template>
        <Alert @variant='destructive' @title='Gone' />
        <Alert @tone='notice' @title='Low credit' />
        <Alert @tone='warning' @toneLabel='Avertissement' @title='Crédit faible' />
      </template>,
    );
    assert.deepEqual(alerts().map(accessibleText), [
      'Error: Gone',
      'Warning: Low credit',
      'Avertissement: Crédit faible',
    ]);
  });
});
