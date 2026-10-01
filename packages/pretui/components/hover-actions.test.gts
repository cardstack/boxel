// Pretui — HoverActions unit tests for Escape parking the @actions cluster.
// Local-only test file, kept off the realm by `.boxelignore` (`*.test.gts`);
// run with `boxel test`.
import { module, test } from 'qunit';
import { render, triggerKeyEvent } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { HoverActions } from './hover-actions';
import type { HoverAction } from './hover-actions';

const ACTIONS: HoverAction[] = [
  { id: 'edit', label: 'Edit' },
  { id: 'share', label: 'Share' },
];

module('Pretui | components/hover-actions', function (hooks) {
  setupCardTest(hooks);

  test('Escape parks the cluster: its buttons leave the tab order', async function (assert) {
    await render(<template><HoverActions @actions={{ACTIONS}} @label='Actions for Lot 7' @reveal='always'><p>Lot 7</p></HoverActions></template>);
    let first = document.querySelector('[data-test-pretui-hover-action="edit"]') as HTMLElement;
    first.focus();
    await triggerKeyEvent(first, 'keydown', 'Escape');
    let buttons = [...document.querySelectorAll('[data-test-pretui-hover-action]')] as HTMLElement[];
    assert.ok(buttons.length > 0);
    assert.true(buttons.every((b) => b.tabIndex === -1), 'none is a tab stop while parked');
  });
});
