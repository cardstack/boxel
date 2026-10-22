// Pretui — Fold unit tests.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules
// are not applied).
import { module, test } from 'qunit';
import { render, click } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Fold } from './fold';

function fold(): HTMLElement {
  return document.querySelector('[data-test-pretui-fold]') as HTMLElement;
}
function toggle(): HTMLButtonElement {
  return fold().querySelector('button') as HTMLButtonElement;
}

module('Pretui | components/fold', function (hooks) {
  setupCardTest(hooks);

  test('starts folded to its receipt, with the children not rendered', async function (assert) {
    await render(<template><Fold @receipt='3 steps · 12s'><span data-test-child>work</span></Fold></template>);
    assert.strictEqual(fold().dataset['fold'], 'folded');
    assert.strictEqual(toggle().getAttribute('aria-expanded'), 'false');
    assert.true(toggle().textContent?.includes('3 steps · 12s'));
    assert.strictEqual(fold().querySelector('.pretui-fold-mark')?.textContent?.trim(), '✓', 'settled work folds to a check');
    assert.strictEqual(fold().querySelector('[data-test-child]'), null);
  });

  test('opens on click and reports each move', async function (assert) {
    let seen: boolean[] = [];
    const record = (open: boolean) => seen.push(open);
    await render(<template><Fold @receipt='r' @onOpenChange={{record}}><span data-test-child>work</span></Fold></template>);
    await click(toggle());
    assert.strictEqual(fold().dataset['fold'], 'open');
    assert.strictEqual(toggle().getAttribute('aria-expanded'), 'true');
    assert.strictEqual(fold().querySelector('.pretui-fold-mark')?.textContent?.trim(), '▾');
    assert.ok(fold().querySelector('.pretui-fold-children [data-test-child]'));
    await click(toggle());
    assert.deepEqual(seen, [true, false]);
  });

  test('seeds open from @defaultOpen; a controlled @open holds still and reports', async function (assert) {
    await render(<template><Fold @receipt='r' @defaultOpen={{true}}>x</Fold></template>);
    assert.strictEqual(fold().dataset['fold'], 'open');

    let seen: boolean[] = [];
    const record = (open: boolean) => seen.push(open);
    await render(<template><Fold @receipt='r' @open={{false}} @onOpenChange={{record}}>x</Fold></template>);
    await click(toggle());
    assert.strictEqual(fold().dataset['fold'], 'folded', 'the owner decides');
    assert.deepEqual(seen, [true]);
  });
});
