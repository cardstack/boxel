// Pretui — Magnetic unit tests. Imports from ../motion-pointer; when Magnetic moves to its
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
import { Magnetic } from './magnetic';

function root(): HTMLElement {
  return document.querySelector('[data-test-pretui-magnetic]') as HTMLElement;
}

function prop(name: string): string {
  return root().style.getPropertyValue(name);
}

module('Pretui | components/magnetic', function (hooks) {
  setupCardTest(hooks);

  test('draws the reach halo by default and leans the control inside it', async function (assert) {
    await render(<template><Magnetic><button type='button' data-test-btn>Save</button></Magnetic></template>);
    assert.ok(root().querySelector('.pretui-magnetic-halo'), 'the resting state that makes it visible in a still frame');
    assert.strictEqual(root().querySelector('.pretui-magnetic-halo')?.getAttribute('aria-hidden'), 'true');
    assert.ok(root().querySelector('.pretui-magnetic-lean [data-test-btn]'), 'the control is a live child, not replaced by the overlay layer (pointer-events is CSS, unverifiable here)');
    assert.deepEqual(
      ['--pretui-px', '--pretui-py', '--pretui-pd'].map((p) => prop(p)).map((v, i) => (i < 2 ? /^-?\d+(\.\d+)?px$/.test(v) : v)),
      [true, true, '0'],
      'the pointer-field modifier seeds its properties at install: a measured centre and a zero drive',
    );
    assert.strictEqual(prop('--pretui-magnetic-range'), '', 'no knobs, no overrides');
  });

  test('takes range, intensity and a validated hue; the halo can be dropped', async function (assert) {
    await render(<template><Magnetic @range={{80}} @intensity={{0.5}} @hue='var(--chart-1)' @halo={{false}}>x</Magnetic></template>);
    assert.deepEqual([prop('--pretui-magnetic-range'), prop('--pretui-magnetic-intensity'), prop('--pretui-magnetic-hue')], ['80px', '0.5', 'var(--chart-1)']);
    assert.strictEqual(root().querySelector('.pretui-magnetic-halo'), null);

    await render(<template><Magnetic @hue='red; background: url(javascript:0)'>x</Magnetic></template>);
    assert.strictEqual(prop('--pretui-magnetic-hue'), '', 'the unsafe hue is dropped whole');
    assert.strictEqual(root().style.getPropertyValue('background'), '', 'and the hue carries nothing past the guard');
  });

  test('a string smuggled into a numeric arg is rejected, and its declaration is dropped', async function (assert) {
    // Every numeric arg across the motion modules goes through the kit's
    // `cssNumber`, so a value that is not a number cannot reach the attribute
    // at all — not even truncated, which is the partial landing pretui-css.gts
    // forbids.
    const EVIL = 'red; background: url(javascript:0)' as unknown as number;
    await render(<template><Magnetic @intensity={{EVIL}}>x</Magnetic></template>);
    assert.strictEqual(root().style.getPropertyValue('background'), '', 'no live declaration on the root');
    assert.strictEqual(prop('--pretui-magnetic-intensity'), '', 'and the property is dropped, not set to a partial value');
  });
});
