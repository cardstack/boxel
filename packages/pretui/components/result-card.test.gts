// Pretui — ResultCard unit tests. Imports from ../agentic; when ResultCard moves to its
// own file only the import path changes.
//
// Local-only test file, kept off the realm by `.boxelignore` (`*.test.gts`);
// run with `boxel test`. No assertion touches a computed style: the
// component's own `<style scoped>` is inert in this harness (the scoped-css
// attribute is stamped, the rules are not applied).
import { module, test } from 'qunit';
import { render, click } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { ResultCard } from './result-card';

function card(): HTMLElement {
  return document.querySelector('[data-test-pretui-result-card]') as HTMLElement;
}

module('Pretui | components/result-card', function (hooks) {
  setupCardTest(hooks);

  test('renders the title, an optional eyebrow and each line — card-shaped, never a JSON blob', async function (assert) {
    const LINES = ['12 crates', 'Fujian'];
    await render(<template><ResultCard @eyebrow='Lot' @title='Wuyi Origins' @lines={{LINES}} /></template>);
    assert.strictEqual(card().querySelector('.pretui-eyebrow')?.textContent?.trim(), 'Lot');
    assert.strictEqual(card().querySelector('.pretui-resultcard-title')?.textContent?.trim(), 'Wuyi Origins');
    assert.deepEqual(Array.from(card().querySelectorAll('.pretui-resultcard-line')).map((l) => l.textContent?.trim()), ['12 crates', 'Fujian']);
    assert.strictEqual(card().querySelector('.pretui-resultcard-menu'), null, 'no menu without a handler');
  });

  test('offers a named menu button only when given a handler', async function (assert) {
    let opened = 0;
    const onMenu = () => (opened += 1);
    await render(<template><ResultCard @title='x' @onMenu={{onMenu}} /></template>);
    let btn = card().querySelector('.pretui-resultcard-menu') as HTMLButtonElement;
    assert.strictEqual(btn.getAttribute('aria-label'), 'More', 'a ⋯ needs a name');
    await click(btn);
    assert.strictEqual(opened, 1);
    assert.strictEqual(card().querySelector('.pretui-eyebrow'), null, 'no empty eyebrow');
  });
});
