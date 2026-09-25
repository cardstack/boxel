// Pretui — Label unit tests. Imports from ./extras rather than the
// './controls' barrel: the per-component test is the unit contract and has to
// keep holding as modules are extracted; when Label moves to its own file only
// the import path changes.
//
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules are
// not applied).
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Label } from './label';

function q(sel: string): HTMLElement {
  return document.querySelector(sel) as HTMLElement;
}
function all(sel: string): HTMLElement[] {
  return Array.from(document.querySelectorAll(sel)) as HTMLElement[];
}

module('Pretui | components/label', function (hooks) {
  setupCardTest(hooks);

  test('Label is a <label> by default and points at the control it names', async function (assert) {
    await render(
      <template>
        <Label @for='tea-name'>Tea name</Label>
        <input id='tea-name' />
      </template>,
    );
    let label = q('[data-test-pretui-label]') as HTMLLabelElement;
    assert.strictEqual(label.tagName, 'LABEL');
    assert.strictEqual(label.getAttribute('for'), 'tea-name');
    assert.strictEqual(label.control?.id, 'tea-name', 'the pairing actually resolves');
    assert.strictEqual(label.textContent?.trim(), 'Tea name');
  });

  test('Label becomes a legend or a plain span on request', async function (assert) {
    await render(
      <template>
        <Label @tag='legend'>Grouped</Label>
        <Label @tag='span'>Not a control label</Label>
      </template>,
    );
    assert.deepEqual(all('[data-test-pretui-label]').map((l) => l.tagName), ['LEGEND', 'SPAN']);
  });

  test('Label ignores @for on a tag that cannot carry it', async function (assert) {
    await render(<template><Label @tag='span' @for='nope'>Caption</Label></template>);
    assert.strictEqual(
      q('[data-test-pretui-label]').getAttribute('for'),
      null,
      'a for= on a span is a dangling reference, not a pairing',
    );
  });
});
