// Pretui — TextScramble unit tests. Imports from ../motion; when TextScramble moves to its
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
import { TextScramble } from './text-scramble';

function root(): HTMLElement {
  return document.querySelector('[data-test-pretui-text-scramble]') as HTMLElement;
}
function cells(): HTMLElement[] {
  return Array.from(root().querySelectorAll('.pretui-scramble-cell')) as HTMLElement[];
}

module('Pretui | components/text-scramble', function (hooks) {
  setupCardTest(hooks);

  test('sweeps the resolve delay across the characters and leaves spaces alone', async function (assert) {
    await render(<template><TextScramble @text='ab c' /></template>);
    assert.strictEqual(root().getAttribute('style'), '--pretui-scramble-window: 0.400s', 'half of the 0.8s default');
    assert.deepEqual(cells().map((c) => c.getAttribute('style')), ['--pretui-scr-delay: 0.000s', '--pretui-scr-delay: 0.133s', '--pretui-scr-delay: 0.400s'], 'the last character resolves at the end of the sweep');
    assert.deepEqual(cells().map((c) => c.querySelector('.pretui-scramble-real')?.textContent), ['a', 'b', 'c']);
    assert.strictEqual(root().querySelectorAll('.pretui-scramble-space').length, 1);
    assert.strictEqual(root().querySelector('.pretui-sr')?.textContent, 'ab c', 'the real text is readable at once');
    assert.strictEqual(root().querySelector('[aria-hidden="true"]')?.contains(cells()[0] as Node), true);
  });

  test('noise glyphs are deterministic — the same text always scrambles the same way', async function (assert) {
    await render(<template><TextScramble @text='Wuyi' /><TextScramble @text='Wuyi' /></template>);
    let all = Array.from(document.querySelectorAll('[data-test-pretui-text-scramble]')) as HTMLElement[];
    let noise = (el: HTMLElement) => Array.from(el.querySelectorAll('.pretui-scramble-noise')).map((n) => n.textContent).join('');
    assert.strictEqual(noise(all[0] as HTMLElement), noise(all[1] as HTMLElement), 'two renders of one text agree');
    assert.strictEqual(noise(all[0] as HTMLElement), '$?/~¤§!+', 'the exact glyphs FNV-1a over "Wuyi" picks — the seed, the per-slot index and the glyph table all pinned');

    await render(<template><TextScramble @text='Anxi' /></template>);
    assert.strictEqual(noise(document.querySelector('[data-test-pretui-text-scramble]') as HTMLElement), '/@$§!~¤%', 'a different text, different noise — the seed is derived from the text');
  });

  test('takes a duration and floors a non-positive one', async function (assert) {
    await render(<template><TextScramble @text='ab' @duration={{2}} /></template>);
    assert.strictEqual(root().getAttribute('style'), '--pretui-scramble-window: 1.000s');
    await render(<template><TextScramble @text='ab' @duration={{0}} /></template>);
    assert.strictEqual(root().getAttribute('style'), '--pretui-scramble-window: 0.400s');
  });
});
