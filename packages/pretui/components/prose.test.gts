// Pretui — Prose unit tests. Imports from ../reading rather than the
// './controls' barrel: the per-component test is the unit contract and has to
// keep holding as modules are extracted; when Prose moves to its own file only
// the import path changes.
//
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules are
// not applied).
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Prose } from '../reading';

function q(sel: string): HTMLElement {
  return document.querySelector(sel) as HTMLElement;
}

module('Pretui | components/prose', function (hooks) {
  setupCardTest(hooks);

  test('Prose wraps its block as the reading surface', async function (assert) {
    await render(<template><Prose><p data-test-para>A curing note.</p></Prose></template>);
    assert.ok(q('[data-test-pretui-prose] [data-test-para]'));
  });
});
