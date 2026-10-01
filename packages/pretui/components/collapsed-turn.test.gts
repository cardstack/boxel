// Pretui — CollapsedTurn unit tests. Imports from ../agentic; when CollapsedTurn moves to its
// own file only the import path changes.
//
// Local-only test file, kept off the realm by `.boxelignore` (`*.test.gts`);
// run with `boxel test`. No assertion touches a computed style: the
// component's own `<style scoped>` is inert in this harness (the scoped-css
// attribute is stamped, the rules are not applied).
import { module, test } from 'qunit';
import { render, click } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { CollapsedTurn } from './collapsed-turn';

module('Pretui | components/collapsed-turn', function (hooks) {
  setupCardTest(hooks);

  test('is a button carrying the receipt, and expands on click', async function (assert) {
    let expanded = 0;
    const onExpand = () => (expanded += 1);
    await render(<template><CollapsedTurn @summary='4 files changed · 2 approvals' @onExpand={{onExpand}} /></template>);
    let el = document.querySelector('[data-test-pretui-collapsed-turn]') as HTMLButtonElement;
    assert.strictEqual(el.tagName, 'BUTTON', 'settled history is one keyboard-reachable stop');
    assert.true(el.textContent?.includes('4 files changed · 2 approvals'), 'a receipt of counts, not content');
    assert.strictEqual(el.querySelector('.pretui-collapsed-check')?.textContent?.trim(), '✓');
    await click(el);
    assert.strictEqual(expanded, 1);
  });
});
