// Pretui — Spotlight unit tests.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm. No assertion touches a computed style: the
// component's own `<style scoped>` is inert in this harness (the scoped-css
// attribute is stamped, the rules are not applied) — so motion is asserted
// as the custom properties and structure the CSS animates from, never as
// movement.
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Spotlight } from './spotlight';

function root(): HTMLElement {
  return document.querySelector('[data-test-pretui-spotlight]') as HTMLElement;
}

function prop(name: string): string {
  return root().style.getPropertyValue(name);
}

module('Pretui | components/spotlight', function (hooks) {
  setupCardTest(hooks);

  test('lays a hidden light under the content', async function (assert) {
    await render(<template><Spotlight><p data-test-body>text</p></Spotlight></template>);
    assert.strictEqual(root().querySelector('.pretui-spotlight-light')?.getAttribute('aria-hidden'), 'true');
    assert.ok(root().querySelector('.pretui-spotlight-content [data-test-body]'));
    assert.strictEqual(prop('--pretui-spotlight-size'), '', 'no knobs, no overrides');
  });

  test('takes size, hue, intensity as a percentage and a rest floor; an unsafe hue is dropped', async function (assert) {
    await render(<template><Spotlight @size={{300}} @hue='var(--chart-2)' @intensity={{0.755}} @rest={{0.2}}>x</Spotlight></template>);
    assert.deepEqual([prop('--pretui-spotlight-size'), prop('--pretui-spotlight-hue'), prop('--pretui-spotlight-strength'), prop('--pretui-spotlight-rest')], ['300px', 'var(--chart-2)', '76%', '0.2']);

    await render(<template><Spotlight @intensity={{9}} @hue='url(javascript:0)'>x</Spotlight></template>);
    assert.strictEqual(prop('--pretui-spotlight-strength'), '100%', 'intensity clamps to 1');
    assert.strictEqual(prop('--pretui-spotlight-hue'), '', 'the hue is dropped whole');
  });
});
