// Pretui — SkipLink unit tests: a real in-page anchor with defaults.
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { SkipLink } from './skip-link';

function link(): HTMLAnchorElement {
  return document.querySelector('[data-test-pretui-skip-link]') as HTMLAnchorElement;
}

module('Pretui | components/skip-link', function (hooks) {
  setupCardTest(hooks);

  test('it is a link to #main that says Skip to content', async function (assert) {
    await render(<template><SkipLink /></template>);
    assert.strictEqual(link().tagName, 'A');
    assert.strictEqual(link().getAttribute('href'), '#main');
    assert.strictEqual(link().textContent?.trim(), 'Skip to content');
    assert.notOk(link().hasAttribute('tabindex'), 'in the natural tab order');
    assert.notOk(link().hasAttribute('aria-hidden'));
  });

  test('@href and @label override the defaults, attributes land on the anchor', async function (assert) {
    await render(<template><SkipLink @href='#results' @label='Skip to results' data-where='top' /></template>);
    assert.strictEqual(link().getAttribute('href'), '#results');
    assert.strictEqual(link().textContent?.trim(), 'Skip to results');
    assert.strictEqual(link().getAttribute('data-where'), 'top');
  });

  test('it can take focus', async function (assert) {
    await render(<template><SkipLink /></template>);
    link().focus();
    assert.strictEqual(document.activeElement, link());
  });
});
