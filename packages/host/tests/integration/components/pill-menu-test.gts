import { click, render, waitUntil } from '@ember/test-helpers';

import { module, test } from 'qunit';

import PillMenu from '@cardstack/host/components/pill-menu';

import { setupRenderingTest } from '../../helpers/setup';

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

    await click('[data-test-pill-menu-collapsed]');
    assert.strictEqual(expanded, 1, 'onExpand fires with the click');
    assert.dom('[data-test-pill-menu-header]').exists('the menu is rendered');
    assert.dom('[data-test-menu-content]').exists();
    assert.dom('[data-test-pill-menu-collapsed]').doesNotExist();

    await click('[data-test-pill-menu-header] [data-test-pill-menu-button]');
    assert.strictEqual(
      collapsed,
      1,
      'onCollapse fires with the click, not when an animation ends',
    );
    assert
      .dom('[data-test-pill-menu-collapsed]')
      .exists('the pill is back in the same render as the state change');

    // Host tests run with motion off: the leaving menu has no exit to play,
    // and the presence layer removes it on its next pass.
    await waitUntil(
      () => !document.querySelector('[data-test-pill-menu-header]'),
      { timeoutMessage: 'the collapsed menu never left the DOM' },
    );
    assert.dom('[data-test-menu-content]').doesNotExist();

    await click('[data-test-pill-menu-collapsed]');
    assert.strictEqual(expanded, 2, 'the menu expands again');
    assert.dom('[data-test-pill-menu-header]').exists();

    await click('[data-test-pill-menu-detail-close]');
    assert.strictEqual(
      collapsed,
      2,
      'the header detail also collapses, as a state change',
    );
    assert.dom('[data-test-pill-menu-collapsed]').exists();
  });
});
