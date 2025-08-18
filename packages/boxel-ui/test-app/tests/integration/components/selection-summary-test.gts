import { module, test } from 'qunit';
import { setupRenderingTest } from 'test-app/tests/helpers';
import { click, render, waitFor } from '@ember/test-helpers';
import { SelectionSummary } from '@cardstack/boxel-ui/components';
import { MenuItem } from '@cardstack/boxel-ui/helpers';

module('Integration | Component | selection-summary', function (hooks) {
  setupRenderingTest(hooks);

  test('zero selected shows Select All and fires onSelectAll', async function (assert) {
    const onSelectAll = () => assert.step('select-all');
    const onDeselectAll = () => assert.step('deselect-all');
    const menuItems: MenuItem[] = [];

    await render(<template>
      <SelectionSummary
        @selectedCount={{0}}
        @totalCount={{10}}
        @onSelectAll={{onSelectAll}}
        @onDeselectAll={{onDeselectAll}}
        @menuItems={{menuItems}}
      />
    </template>);

    assert.dom('.boxel-selection-summary').exists('wrapper renders');
    assert
      .dom('.selection-circle')
      .doesNotHaveClass('selection-circle--selected', 'not selected');
    assert
      .dom('.selection-circle')
      .doesNotHaveClass('selection-circle--partial', 'not partial');

    // Click the selection circle toggler
    await click('.selection-circle');

    // Click the Select All CTA button
    await click('.boxel-selection-summary .boxel-button');

    assert.verifySteps(['select-all', 'select-all']);
  });

  test('N selected shows count, partial indicator, renders menu, and fires callbacks', async function (assert) {
    const onSelectAll = () => assert.step('select-all');
    const onDeselectAll = () => assert.step('deselect-all');

    const actions: MenuItem[] = [
      new MenuItem('Deselect All', 'action', {
        action: () => assert.step('menu:deselect-all'),
      }),
      new MenuItem('Delete 3 items', 'action', {
        dangerous: true,
        action: () => assert.step('menu:delete'),
      }),
    ];

    await render(<template>
      <SelectionSummary
        @selectedCount={{3}}
        @totalCount={{10}}
        @onSelectAll={{onSelectAll}}
        @onDeselectAll={{onDeselectAll}}
        @menuItems={{actions}}
      />
    </template>);

    assert.dom('.boxel-selection-summary').exists('wrapper renders');
    assert.dom('.boxel-selection-summary').includesText('3 Selected');
    assert.dom('.selection-circle').hasClass('selection-circle--selected');
    assert.dom('.selection-circle').hasClass('selection-circle--partial');

    // Clicking the selection circle should call onDeselectAll
    await click('.selection-circle');

    // Open the overflow dropdown by clicking the icon button
    await click('.summary-overflow');

    await click('[data-test-boxel-menu-item-text="Deselect All"]');

    // Open again and click delete
    await click('.summary-overflow');
    await waitFor('[data-test-boxel-menu-item-text="Delete 3 items"]');
    await click('[data-test-boxel-menu-item-text="Delete 3 items"]');

    assert.verifySteps(['deselect-all', 'menu:deselect-all', 'menu:delete']);
  });

  test('Full selection shows selected state without partial class', async function (assert) {
    const noop = () => {};
    const empty: MenuItem[] = [];
    await render(<template>
      <SelectionSummary
        @selectedCount={{10}}
        @totalCount={{10}}
        @onSelectAll={{noop}}
        @onDeselectAll={{noop}}
        @menuItems={{empty}}
      />
    </template>);

    assert.dom('.selection-circle').hasClass('selection-circle--selected');
    assert
      .dom('.selection-circle')
      .doesNotHaveClass('selection-circle--partial');
  });
});
