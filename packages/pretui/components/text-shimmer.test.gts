// Pretui — TextShimmer unit tests. Imports from ../motion; when TextShimmer moves to its
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
import { TextShimmer } from './text-shimmer';

function root(): HTMLElement {
  return document.querySelector('[data-test-pretui-text-shimmer]') as HTMLElement;
}

module('Pretui | components/text-shimmer', function (hooks) {
  setupCardTest(hooks);

  test('renders the text itself and sizes the sheen to its length', async function (assert) {
    await render(<template><TextShimmer @text='Thinking' /></template>);
    assert.strictEqual(root().textContent, 'Thinking', 'real text, not a decoration over it — nothing to mirror');
    assert.strictEqual(root().getAttribute('style'), '--pretui-shimmer-duration: 2.000s; --pretui-shimmer-spread: 16.0px', 'eight characters at two px each');
  });

  test('takes duration and spread, and floors a non-positive duration', async function (assert) {
    await render(<template><TextShimmer @text='Go' @duration={{0.5}} @spread={{5}} /></template>);
    assert.strictEqual(root().getAttribute('style'), '--pretui-shimmer-duration: 0.500s; --pretui-shimmer-spread: 10.0px');
    await render(<template><TextShimmer @text='Go' @duration={{-1}} /></template>);
    assert.true(root().getAttribute('style')?.startsWith('--pretui-shimmer-duration: 2.000s'));
  });
});
