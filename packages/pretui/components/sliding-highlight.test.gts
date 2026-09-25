// Pretui — SlidingHighlight unit tests. Imports from ../motion-core; when SlidingHighlight moves to its
// own file only the import path changes.
//
// No assertion touches a computed style: the
// component's own `<style scoped>` is inert in this harness (the scoped-css
// attribute is stamped, the rules are not applied) — so motion is asserted
// as the custom properties and structure the CSS animates from, never as
// movement.
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { SlidingHighlight, slidingHighlight } from './sliding-highlight';

function root(): HTMLElement {
  return document.querySelector('[data-test-pretui-sliding-highlight]') as HTMLElement;
}

module('Pretui | components/sliding-highlight', function (hooks) {
  setupCardTest(hooks);

  test('is a decorative pill by default that needs no arguments', async function (assert) {
    await render(<template><SlidingHighlight /></template>);
    assert.strictEqual(root().dataset['variant'], 'pill');
    assert.strictEqual(root().getAttribute('aria-hidden'), 'true');
    assert.strictEqual(root().getAttribute('style'), '');
  });

  test('takes a variant and timing knobs, and yields a slot for a custom paint', async function (assert) {
    await render(<template><SlidingHighlight @variant='underline' @duration={{0.4}} @thickness={{2}} @radius={{1}}><i data-test-paint></i></SlidingHighlight></template>);
    assert.strictEqual(root().dataset['variant'], 'underline');
    assert.strictEqual(root().getAttribute('style'), '--pretui-highlight-duration: 0.400s; --pretui-highlight-thickness: 2px; --pretui-highlight-radius: 1px');
    assert.ok(root().querySelector('[data-test-paint]'));
  });

  test('inside a rail carrying the modifier, the active item is measured onto the container', async function (assert) {
    await render(
      <template>
        <div data-test-rail {{slidingHighlight}}>
          <SlidingHighlight />
          <button type='button' data-state='active'>One</button>
          <button type='button'>Two</button>
        </div>
      </template>,
    );
    let rail = document.querySelector('[data-test-rail]') as HTMLElement;
    assert.strictEqual(rail.style.getPropertyValue('--pretui-highlight-on'), '1', 'an active item was found');
    let [w, h] = ['--pretui-highlight-w', '--pretui-highlight-h'].map((p) => parseFloat(rail.style.getPropertyValue(p)));
    assert.true((w ?? 0) > 0 && (h ?? 0) > 0, `a real measured box (${w}×${h}) was written for the pill to travel to`);
  });
});
