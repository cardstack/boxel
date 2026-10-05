// Pretui — TextRotate unit tests.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm. No assertion touches a computed style: the
// component's own `<style scoped>` is inert in this harness (the scoped-css
// attribute is stamped, the rules are not applied) — so motion is asserted
// as the custom properties and structure the CSS animates from, never as
// movement.
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { TextRotate } from './text-rotate';

function root(): HTMLElement {
  return document.querySelector('[data-test-pretui-text-rotate]') as HTMLElement;
}

module('Pretui | components/text-rotate', function (hooks) {
  setupCardTest(hooks);

  test('builds a stepped reel that ends where it began, and mirrors every word for screen readers', async function (assert) {
    const WORDS = ['tea', 'coffee', 'cocoa'];
    await render(<template><TextRotate @words={{WORDS}} /></template>);
    let reel = root().querySelector('.pretui-rotate-reel') as HTMLElement;
    assert.deepEqual(Array.from(reel.querySelectorAll('.pretui-rotate-word')).map((w) => w.textContent), ['tea', 'coffee', 'cocoa', 'tea'], 'the first word repeats at the end so the loop has no seam');
    assert.strictEqual(reel.getAttribute('style'), '--pretui-rotate-count: 3; animation-duration: 6.00s; animation-timing-function: steps(3, end)', 'three words at the default two seconds each');
    assert.strictEqual(root().querySelector('.pretui-rotate-mask')?.getAttribute('aria-hidden'), 'true');
    assert.strictEqual(root().querySelector('.pretui-sr')?.textContent, 'tea, coffee, cocoa', 'a screen reader gets the list at once, not a word every two seconds');
  });

  test('takes an interval, ignores empty words, and degrades to plain text for a single word', async function (assert) {
    const WORDS = ['tea', '', 'cocoa'];
    await render(<template><TextRotate @words={{WORDS}} @interval={{0.5}} /></template>);
    assert.true(root().querySelector('.pretui-rotate-reel')?.getAttribute('style')?.includes('--pretui-rotate-count: 2; animation-duration: 1.00s'));

    const ONE = ['tea'];
    await render(<template><TextRotate @words={{ONE}} /></template>);
    assert.strictEqual(root().querySelector('.pretui-rotate-mask'), null, 'nothing to rotate');
    assert.strictEqual(root().textContent?.trim(), 'tea');
  });
});
