// Pretui — Skeleton unit tests. Imports from ../structure; when Skeleton
// moves to its own file only the import path changes.
//
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules are
// not applied).
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Skeleton } from './skeleton';

function q(sel: string): HTMLElement {
  return document.querySelector(sel) as HTMLElement;
}

module('Pretui | components/skeleton', function (hooks) {
  setupCardTest(hooks);

  test('Skeleton is hidden from assistive tech and sized through custom properties', async function (assert) {
    await render(<template><Skeleton /></template>);
    let el = q('[data-test-pretui-skeleton]');
    assert.strictEqual(el.getAttribute('aria-hidden'), 'true', 'a placeholder is not content');
    assert.strictEqual(el.style.getPropertyValue('--_w'), '100%', 'the default width');
    assert.strictEqual(el.style.getPropertyValue('--_h'), '12px', 'the default height');
    assert.strictEqual(el.textContent?.trim(), '', 'nothing to read');
  });

  test('Skeleton takes caller dimensions', async function (assert) {
    await render(<template><Skeleton @width='8rem' @height='40px' /></template>);
    let el = q('[data-test-pretui-skeleton]');
    assert.strictEqual(el.style.getPropertyValue('--_w'), '8rem');
    assert.strictEqual(el.style.getPropertyValue('--_h'), '40px');
    assert.strictEqual(
      el.getAttribute('style'),
      '--_w: 8rem; --_h: 40px',
      'the whole attribute is exactly the two declarations',
    );
  });

  test('Skeleton drops a caller string that carries a second declaration', async function (assert) {
    await render(<template><Skeleton @width='0px; background: red' /></template>);
    assert.strictEqual(
      q('[data-test-pretui-skeleton]').getAttribute('style'),
      '--_h: 12px',
      'the rejected width is dropped whole; the height still paints',
    );
  });
});
