import { find, render, rerender } from '@ember/test-helpers';

import { module, test } from 'qunit';

import PillMenu from '@cardstack/host/components/pill-menu';

import { setupRenderingTest } from '../../helpers/setup';

// A native click runs the component's handler synchronously, so the callback
// counts are read before anything can settle. `rerender()` waits for the
// render but not for test waiters, so a component that held its state change
// open until an animation ended (behind a waiter that `await click()` would
// sit on) fails these assertions instead of passing late.
function clickNow(selector: string) {
  let element = find(selector);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`no element matches ${selector}`);
  }
  element.click();
}

module('Integration | Component | pill-menu', function (hooks) {
  setupRenderingTest(hooks);

  test('expanding and collapsing are state changes that do not wait on motion', async function (assert) {
    let expanded = 0;
    let collapsed = 0;
    let onExpand = () => expanded++;
    let onCollapse = () => collapsed++;

    await render(
      <template>
        <PillMenu @onExpand={{onExpand}} @onCollapse={{onCollapse}}>
          <:headerDetail>Detail</:headerDetail>
          <:content><div data-test-menu-content>Content</div></:content>
        </PillMenu>
      </template>,
    );

    assert.dom('[data-test-pill-menu-collapsed]').exists('starts as a pill');
    assert.dom('[data-test-pill-menu-header]').doesNotExist();

    clickNow('[data-test-pill-menu-collapsed]');
    assert.strictEqual(expanded, 1, 'onExpand fires in the click handler');
    await rerender();
    assert.dom('[data-test-pill-menu-header]').exists('the menu is rendered');
    assert.dom('[data-test-menu-content]').exists();
    assert.dom('[data-test-pill-menu-collapsed]').doesNotExist();

    clickNow('[data-test-pill-menu-header] [data-test-pill-menu-button]');
    assert.strictEqual(
      collapsed,
      1,
      'onCollapse fires in the click handler, not when an animation ends',
    );
    await rerender();
    assert
      .dom('[data-test-pill-menu-collapsed]')
      .exists('the pill is back on the next render');
    assert.dom('[data-test-pill-menu-header]').doesNotExist();
    assert.dom('[data-test-menu-content]').doesNotExist();

    clickNow('[data-test-pill-menu-collapsed]');
    assert.strictEqual(expanded, 2, 'the menu expands again');
    await rerender();
    assert.dom('[data-test-pill-menu-header]').exists();

    clickNow('[data-test-pill-menu-detail-close]');
    assert.strictEqual(
      collapsed,
      2,
      'the header detail also collapses in the click handler',
    );
    await rerender();
    assert.dom('[data-test-pill-menu-collapsed]').exists();
  });
});
