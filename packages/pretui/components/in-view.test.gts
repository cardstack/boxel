// Pretui — InView unit tests. Imports from ../motion-core; when InView moves to its
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
import { InView } from './in-view';

function root(): HTMLElement {
  return document.querySelector('[data-test-pretui-inview]') as HTMLElement;
}

module('Pretui | components/in-view', function (hooks) {
  setupCardTest(hooks);

  test('a single block reveal publishes its preset and timings as custom properties', async function (assert) {
    await render(<template><InView><p data-test-body>hello</p></InView></template>);
    assert.strictEqual(root().dataset['mode'], 'block');
    assert.strictEqual(root().getAttribute('style'), '--pretui-inview-from: translateY(var(--pretui-motion-distance, 8px)); --pretui-inview-duration: 0.480s; --pretui-inview-delay: 0.000s; --pretui-inview-stagger: 0.000s', 'rise is the default entrance');
    assert.ok(root().querySelector('[data-test-body]'));
    assert.strictEqual(root().dataset['inview'], 'true', 'in the test viewport the observer has already flipped it visible');
  });

  test('installs hidden — data-inview="false" is written before the observer ever reports', async function (assert) {
    // Off-screen and @once, so the observer's first report (not intersecting)
    // writes nothing: the attribute can only come from the install write. That
    // polarity is the accessibility fix components/in-view.gts describes — the resting
    // style is the visible end state, and only JS opts into the hidden pre-state.
    await render(
      <template>
        {{! template-lint-disable no-inline-styles }}
        <div style='position: fixed; top: -5000px'><InView @once={{true}}>x</InView></div>
      </template>,
    );
    assert.strictEqual(root().dataset['inview'], 'false');
  });

  test('a list staggers each item by its index through the item block', async function (assert) {
    const ITEMS = ['a', 'b', 'c'];
    await render(
      <template>
        <InView @items={{ITEMS}} @enter='fade' @stagger={{0.08}} @delay={{0.2}} @duration={{1}}>
          <:item as |item index|><span data-test-cell>{{index}}:{{item}}</span></:item>
        </InView>
      </template>,
    );
    assert.strictEqual(root().dataset['mode'], 'items');
    assert.strictEqual(root().getAttribute('style'), '--pretui-inview-from: none; --pretui-inview-duration: 1.000s; --pretui-inview-delay: 0.200s; --pretui-inview-stagger: 0.080s');
    let cells = Array.from(root().querySelectorAll('.pretui-inview-item')) as HTMLElement[];
    assert.deepEqual(cells.map((c) => c.getAttribute('style')), ['--pretui-inview-i: 0', '--pretui-inview-i: 1', '--pretui-inview-i: 2']);
    assert.deepEqual(cells.map((c) => c.textContent?.trim()), ['0:a', '1:b', '2:c']);
  });

  test('distance and scale retune the preset without leaving its vocabulary', async function (assert) {
    await render(<template><InView @enter='scale' @distance={{24}} @scale={{0.8}}>x</InView></template>);
    let style = root().getAttribute('style') ?? '';
    assert.true(style.includes('--pretui-inview-from: scale(var(--pretui-motion-scale, 0.96))'));
    assert.true(style.includes('--pretui-motion-distance: 24px'));
    assert.true(style.includes('--pretui-motion-scale: 0.8'));
  });
});
