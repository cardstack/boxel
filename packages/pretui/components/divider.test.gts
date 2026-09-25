// Pretui — Divider unit tests. Imports from ./composites rather than the
// './controls' barrel: the per-component test is the unit contract and has to
// keep holding as modules are extracted; when Divider moves to its own file only
// the import path changes.
//
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules are
// not applied).
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Divider } from './composites';

function q(sel: string): HTMLElement {
  return document.querySelector(sel) as HTMLElement;
}
function all(sel: string): HTMLElement[] {
  return Array.from(document.querySelectorAll(sel)) as HTMLElement[];
}

module('Pretui | components/divider', function (hooks) {
  setupCardTest(hooks);

  test('Divider is a horizontal separator with no label of its own', async function (assert) {
    await render(<template><Divider /></template>);
    let el = q('[data-test-pretui-divider]');
    assert.strictEqual(el.getAttribute('role'), 'separator');
    assert.strictEqual(el.getAttribute('aria-orientation'), 'horizontal');
    assert.strictEqual(el.dataset['orientation'], 'horizontal');
    assert.notOk(el.querySelector('.pretui-divider-label'));
  });

  test('Divider carries a centered label as its accessible name', async function (assert) {
    await render(<template><Divider @label='or' /></template>);
    let el = q('[data-test-pretui-divider]');
    assert.strictEqual(el.querySelector('.pretui-divider-label')?.textContent?.trim(), 'or');
    assert.strictEqual(el.getAttribute('aria-label'), 'or');
  });

  test('Divider turns vertical, and treats any other spelling as horizontal', async function (assert) {
    // Cast because the point of the test is a value the type forbids: the
    // runtime narrowing is what stops a dead aria-orientation reaching a
    // screen reader when a template hands over something off-list.
    const OFF_LIST = 'sideways' as 'horizontal';
    await render(
      <template>
        <Divider @orientation='vertical' />
        <Divider @orientation={{OFF_LIST}} />
      </template>,
    );
    assert.deepEqual(
      all('[data-test-pretui-divider]').map((d) => d.getAttribute('aria-orientation')),
      ['vertical', 'horizontal'],
      'an unrecognised orientation is never emitted as a dead ARIA value',
    );
  });
});
