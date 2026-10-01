// Pretui — Transmute unit tests. Imports from ../agentic; when Transmute moves to its
// own file only the import path changes.
//
// Local-only test file, kept off the realm by `.boxelignore` (`*.test.gts`);
// run with `boxel test`. No assertion touches a computed style: the
// component's own `<style scoped>` is inert in this harness (the scoped-css
// attribute is stamped, the rules are not applied).
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Transmute } from './transmute';

function el(): HTMLElement {
  return document.querySelector('[data-test-pretui-transmute]') as HTMLElement;
}

module('Pretui | components/transmute', function (hooks) {
  setupCardTest(hooks);

  test('carries the three cuts of one truth, resting on the label tier', async function (assert) {
    await render(<template><Transmute @verb='SEARCH' @label='catalog listings' @call='search-cards --realm catalog' /></template>);
    assert.strictEqual(el().dataset['tier'], 't1');
    assert.strictEqual(el().querySelector('.pretui-verb')?.textContent?.trim(), 'SEARCH', 'the verb never moves');
    assert.strictEqual(el().querySelector('[data-t="1"]')?.textContent?.trim(), 'catalog listings');
    assert.strictEqual(el().querySelector('[data-t="2"]')?.textContent?.trim(), 'search-cards --realm catalog');
  });

  test('promotes a tier on request', async function (assert) {
    await render(<template><Transmute @verb='SEARCH' @tier='t2' /></template>);
    assert.strictEqual(el().dataset['tier'], 't2');
  });
});
