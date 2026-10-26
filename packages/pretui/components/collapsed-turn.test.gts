// Pretui — CollapsedTurn unit tests.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules
// are not applied).
import { module, test } from 'qunit';
import { render, click } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { CollapsedTurn } from './collapsed-turn';

function root(): HTMLButtonElement {
  return document.querySelector('[data-test-pretui-collapsed-turn]') as HTMLButtonElement;
}
function part(name: string): HTMLElement | null {
  return root().querySelector(`[data-test-pretui-collapsed-turn-${name}]`);
}

module('Pretui | components/collapsed-turn', function (hooks) {
  setupCardTest(hooks);

  test('is one button carrying the receipt and a done mark, and expands on click', async function (assert) {
    let expanded = 0;
    const onExpand = () => (expanded += 1);
    await render(<template><CollapsedTurn @summary='4 files changed · 2 approvals' @onExpand={{onExpand}} /></template>);
    assert.strictEqual(root().tagName, 'BUTTON', 'settled history is one keyboard-reachable stop');
    assert.strictEqual(root().getAttribute('type'), 'button', 'never submits a surrounding form');
    assert.strictEqual(part('summary')?.textContent?.trim(), '4 files changed · 2 approvals', 'a receipt of counts, not content');
    assert.ok(part('check')?.querySelector('svg'), 'the done mark is an icon');
    assert.strictEqual(part('check')?.textContent?.trim(), '', 'not a printed character');
    assert.strictEqual(part('check')?.getAttribute('aria-hidden'), 'true', 'the mark is decoration; the button is named by its words');
    assert.strictEqual(root().textContent?.trim(), '4 files changed · 2 approvals', 'so its name is the receipt alone');
    assert.strictEqual(root().getAttribute('aria-expanded'), null, 'a plain expander is not a toggle');
    assert.strictEqual(part('chevron'), null);
    await click(root());
    assert.strictEqual(expanded, 1);
  });

  test('as a toggle it says whether the work shows, and which element it shows', async function (assert) {
    await render(<template><CollapsedTurn @summary='3 calls' @expanded={{false}} @controls='turn-7' /></template>);
    assert.strictEqual(root().getAttribute('aria-expanded'), 'false');
    assert.strictEqual(root().getAttribute('aria-controls'), 'turn-7');
    assert.strictEqual(part('chevron')?.dataset['open'], undefined, 'the chevron points right while folded');

    await render(<template><CollapsedTurn @summary='3 calls' @expanded={{true}} @controls='turn-7' /></template>);
    assert.strictEqual(root().getAttribute('aria-expanded'), 'true');
    assert.strictEqual(part('chevron')?.dataset['open'], 'true', 'and down while the work shows');
  });

  test('takes the row form on request', async function (assert) {
    await render(<template><CollapsedTurn @summary='x' /></template>);
    assert.strictEqual(root().dataset['variant'], 'pill');
    await render(<template><CollapsedTurn @summary='x' @variant='row' /></template>);
    assert.strictEqual(root().dataset['variant'], 'row');
  });
});
