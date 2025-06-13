import { module, test } from 'qunit';
import { setupRenderingTest } from 'test-app/tests/helpers';
import { click, render, waitFor, triggerEvent } from '@ember/test-helpers';
import {
  BoxelDropdown,
  Menu as BoxelMenu,
} from '@cardstack/boxel-ui/components';
import { MenuItem } from '@cardstack/boxel-ui/helpers';

module('Integration | Component | dropdown', function (hooks) {
  setupRenderingTest(hooks);

  test('dropdown auto-close behavior with pointer', async function (assert) {
    const menuOptions = [
      new MenuItem('Option 1', 'action', { action: () => {} }),
      new MenuItem('Option 2', 'action', { action: () => {} }),
      new MenuItem('Option 3', 'action', { action: () => {} }),
    ];

    await render(<template>
      <BoxelDropdown>
        <:trigger as |dd|>
          <button data-test-dropdown-trigger {{dd}}>Open</button>
        </:trigger>
        <:content as |dd|>
          <div data-test-boxel-dropdown-content class='boxel-dropdown__content'>
            <BoxelMenu @closeMenu={{dd.close}} @items={{menuOptions}} />
          </div>
        </:content>
      </BoxelDropdown>
    </template>);

    await click('[data-test-dropdown-trigger]');
    await waitFor('[data-test-boxel-dropdown-content]');

    // Get the dropdown content element's position
    const dropdownContent = document.querySelector('.boxel-dropdown__content');
    assert.ok(dropdownContent, 'dropdown content element should exist');
    const rect = dropdownContent!.getBoundingClientRect();

    // Test mouse inside - should stay open
    await triggerEvent(window, 'mousemove', {
      clientX: rect.left + 10,
      clientY: rect.top + 10,
    });
    assert
      .dom('[data-test-boxel-dropdown-content]')
      .exists('dropdown should stay open when mouse is inside');

    // Test mouse outside - should close after 200ms delay
    await triggerEvent(window, 'mousemove', {
      clientX: rect.right + 100,
      clientY: rect.bottom + 100,
    });

    // Wait for all pending operations to complete
    await waitFor('[data-test-boxel-dropdown-content]', { count: 0 });
    assert
      .dom('[data-test-boxel-dropdown-content]')
      .doesNotExist('dropdown should close when mouse is outside');

    // Test quick movement with timeout clearing
    await click('[data-test-dropdown-trigger]');
    await waitFor('[data-test-boxel-dropdown-content]');

    // Move outside
    await triggerEvent(window, 'mousemove', {
      clientX: rect.right + 100,
      clientY: rect.bottom + 100,
    });

    // Quickly move back inside before timeout
    await triggerEvent(window, 'mousemove', {
      clientX: rect.left + 10,
      clientY: rect.top + 10,
    });

    // Wait for all pending operations to complete
    await waitFor('[data-test-boxel-dropdown-content]');
    assert
      .dom('[data-test-boxel-dropdown-content]')
      .exists('dropdown should stay open when mouse moves back inside quickly');
  });
});
