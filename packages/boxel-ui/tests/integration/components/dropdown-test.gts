import {
  BoxelDropdown,
  Menu as BoxelMenu,
} from '@cardstack/boxel-ui/components';
import { MenuItem } from '@cardstack/boxel-ui/helpers';
import { click, render, triggerEvent, waitFor } from '@ember/test-helpers';
import { module, test } from 'qunit';

import { setupRenderingTest } from '../../helpers';

module('Integration | Component | dropdown', function (hooks) {
  setupRenderingTest(hooks);

  test('dropdown auto-close behavior: auto-close when enabled, stays open when disabled', async function (assert) {
    const menuOptions = [
      new MenuItem({ label: 'Option 1', action: () => {} }),
      new MenuItem({ label: 'Option 2', action: () => {} }),
      new MenuItem({ label: 'Option 3', action: () => {} }),
    ];

    // Scenario 1
    // Test with autoClose enabled
    await render(
      <template>
        <BoxelDropdown @autoClose={{true}}>
          <:trigger as |dd|>
            <button data-test-dropdown-trigger-1 {{dd}}>Open</button>
          </:trigger>
          <:content as |dd|>
            <div
              data-test-boxel-dropdown-content-1
              class='boxel-dropdown__content'
            >
              <BoxelMenu @closeMenu={{dd.close}} @items={{menuOptions}} />
            </div>
          </:content>
        </BoxelDropdown>
      </template>,
    );

    await click('[data-test-dropdown-trigger-1]');
    await waitFor('[data-test-boxel-dropdown-content-1]');

    // Test mouse leave - should close
    await triggerEvent('[data-test-boxel-dropdown-content-1]', 'mouseleave');

    await waitFor('[data-test-boxel-dropdown-content-1]', { count: 0 });
    assert
      .dom('[data-test-boxel-dropdown-content-1]')
      .doesNotExist('dropdown should close when mouse leaves the content');

    // Scenario 2
    // Test with autoClose disabled
    await render(
      <template>
        <BoxelDropdown @autoClose={{false}}>
          <:trigger as |dd|>
            <button data-test-dropdown-trigger-2 {{dd}}>Open</button>
          </:trigger>
          <:content as |dd|>
            <div
              data-test-boxel-dropdown-content-2
              class='boxel-dropdown__content'
            >
              <BoxelMenu @closeMenu={{dd.close}} @items={{menuOptions}} />
            </div>
          </:content>
        </BoxelDropdown>
      </template>,
    );

    await click('[data-test-dropdown-trigger-2]');
    await waitFor('[data-test-boxel-dropdown-content-2]');

    // Test mouse leave - should stay open when autoClose is false
    await triggerEvent('[data-test-boxel-dropdown-content-2]', 'mouseleave');

    assert
      .dom('[data-test-boxel-dropdown-content-2]')
      .exists('dropdown should stay open when autoClose is false');
  });

  test('--boxel-dropdown-background-color wins over ember-basic-dropdown', async function (assert) {
    // ember-basic-dropdown paints .ember-basic-dropdown-content white. That
    // rule is less specific than the scoped .boxel-dropdown__content rule, so
    // it can only win by sitting in a higher cascade layer — which is what
    // happens when the layer order statement is lost during bundling.
    document.documentElement.style.setProperty(
      '--boxel-dropdown-background-color',
      'rgb(1, 2, 3)',
    );
    try {
      await render(
        <template>
          <BoxelDropdown>
            <:trigger as |dd|>
              <button data-test-dropdown-trigger {{dd}}>Open</button>
            </:trigger>
            <:content>
              <div>content</div>
            </:content>
          </BoxelDropdown>
        </template>,
      );

      await click('[data-test-dropdown-trigger]');
      await waitFor('[data-test-boxel-dropdown-content]');

      const content = document.querySelector(
        '[data-test-boxel-dropdown-content]',
      )!;
      assert.strictEqual(
        getComputedStyle(content).backgroundColor,
        'rgb(1, 2, 3)',
        'the documented custom property paints the dropdown',
      );
    } finally {
      document.documentElement.style.removeProperty(
        '--boxel-dropdown-background-color',
      );
    }
  });
});
