// Pretui — Typewriter unit tests. Imports from ../motion; when Typewriter moves to its
// own file only the import path changes.
//
// Local-only test file, kept off the realm by `.boxelignore` (`*.test.gts`);
// run with `boxel test`. No assertion touches a computed style: the
// component's own `<style scoped>` is inert in this harness (the scoped-css
// attribute is stamped, the rules are not applied) — so motion is asserted
// as the custom properties and structure the CSS animates from, never as
// movement.
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Typewriter } from './typewriter';

function root(): HTMLElement {
  return document.querySelector('[data-test-pretui-typewriter]') as HTMLElement;
}

module('Pretui | components/typewriter', function (hooks) {
  setupCardTest(hooks);

  test('indexes every character for a CSS reveal and mirrors the whole text', async function (assert) {
    await render(<template><Typewriter @text='Wuyi' /></template>);
    assert.strictEqual(root().getAttribute('style'), '--pretui-type-step: 0.0625s; --pretui-type-delay: 0.000s', 'sixteen characters per second');
    let chars = Array.from(root().querySelectorAll('.pretui-type-char')) as HTMLElement[];
    assert.deepEqual(chars.map((c) => c.textContent), ['W', 'u', 'y', 'i']);
    assert.deepEqual(chars.map((c) => c.getAttribute('style')), ['--pretui-type-i: 0', '--pretui-type-i: 1', '--pretui-type-i: 2', '--pretui-type-i: 3']);
    assert.strictEqual(root().querySelector('.pretui-type-caret'), null, 'no caret unless asked');
    assert.strictEqual(root().querySelector('.pretui-sr')?.textContent, 'Wuyi');
    assert.strictEqual(root().querySelector('[aria-hidden="true"]')?.contains(chars[0] as Node), true, 'the staged characters are decoration');
  });

  test('takes speed, a start delay and a caret; a non-positive speed falls back', async function (assert) {
    await render(<template><Typewriter @text='ab' @speed={{4}} @startDelay={{1.5}} @caret={{true}} /></template>);
    assert.strictEqual(root().getAttribute('style'), '--pretui-type-step: 0.2500s; --pretui-type-delay: 1.500s');
    assert.ok(root().querySelector('.pretui-type-caret'));
    await render(<template><Typewriter @text='ab' @speed={{0}} /></template>);
    assert.true(root().getAttribute('style')?.startsWith('--pretui-type-step: 0.0625s'));
  });
});
