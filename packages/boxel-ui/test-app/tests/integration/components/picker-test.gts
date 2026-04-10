import { module, test } from 'qunit';
import { setupRenderingTest } from 'test-app/tests/helpers';
import {
  click,
  render,
  waitFor,
  fillIn,
  setupOnerror,
  resetOnerror,
} from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';
import { Picker, type PickerOption } from '@cardstack/boxel-ui/components';

function noop() {}

module('Integration | Component | picker', function (hooks) {
  setupRenderingTest(hooks);

  const testOptions: PickerOption[] = [
    { id: '1', label: 'Option 1', icon: 'https://via.placeholder.com/20' },
    { id: '2', label: 'Option 2', icon: 'https://via.placeholder.com/20' },
    { id: '3', label: 'Option 3' },
    { id: '4', label: 'Option 4' },
  ];
  const selectAllOption: PickerOption = {
    id: 'select-all',
    label: 'All options',
    type: 'select-all',
  };
  const testOptionsWithSelectAll: PickerOption[] = [
    selectAllOption,
    ...testOptions,
  ];

  const emptyArray: PickerOption[] = [];

  // Helper to get option IDs from the main dropdown list only (excludes before-options)
  const getMainListOptionIds = () =>
    Array.from(
      document.querySelectorAll(
        '.ember-power-select-options [data-test-boxel-picker-option-row]',
      ),
    ).map((el) =>
      (el as HTMLElement).getAttribute('data-test-boxel-picker-option-row'),
    );

  test('picker renders with label and defaults to select-all', async function (assert) {
    class SelectionController {
      @tracked selected: PickerOption[] = [];
    }

    const controller = new SelectionController();

    const onChange = (newSelected: PickerOption[]) => {
      controller.selected = newSelected;
    };

    await render(
      <template>
        <Picker
          @options={{testOptionsWithSelectAll}}
          @selected={{controller.selected}}
          @onChange={{onChange}}
          @label='Test Label'
          @placeholder='Select items'
        />
      </template>,
    );

    assert.dom('[data-test-boxel-picker-trigger-label]').hasText('Test Label');
    assert.dom('[data-test-boxel-picker-trigger-placeholder]').doesNotExist();
  });

  test('picker shows selected items in trigger', async function (assert) {
    const selected = [testOptions[0], testOptions[1]];

    await render(
      <template>
        <Picker
          @options={{testOptionsWithSelectAll}}
          @selected={{selected}}
          @onChange={{noop}}
          @label='Test'
        />
      </template>,
    );

    // Check that selected items are displayed (they should be in pills)
    await click('[data-test-boxel-picker-trigger]');
    assert.dom('[data-test-boxel-picker-selected-item]').exists({ count: 2 });
  });

  test('picker opens dropdown when clicked', async function (assert) {
    class SelectionController {
      @tracked selected: PickerOption[] = [];
    }

    const controller = new SelectionController();

    const onChange = (newSelected: PickerOption[]) => {
      controller.selected = newSelected;
    };

    await render(
      <template>
        <Picker
          @options={{testOptionsWithSelectAll}}
          @selected={{controller.selected}}
          @onChange={{onChange}}
          @label='Test'
        />
      </template>,
    );

    await click('[data-test-boxel-picker-trigger]');
    await waitFor('[data-test-boxel-picker-option-row]');

    // Select-all in before-options + 4 options in main list
    assert.dom('[data-test-boxel-picker-select-all]').exists();
    assert
      .dom('.ember-power-select-options [data-test-boxel-picker-option-row]')
      .exists({ count: 4 });
  });

  test('picker shows selected items in summary section', async function (assert) {
    const selected = [testOptions[2], testOptions[3]];

    await render(
      <template>
        <Picker
          @options={{testOptionsWithSelectAll}}
          @selected={{selected}}
          @onChange={{noop}}
          @label='Test'
        />
      </template>,
    );

    await click('[data-test-boxel-picker-trigger]');
    await waitFor('[data-test-boxel-picker-option-row]');

    // Selected items should appear in the summary section
    assert
      .dom('[data-test-boxel-picker-selected-summary]')
      .exists('Summary section should exist when items are selected');
    assert
      .dom('[data-test-boxel-picker-summary-item="3"]')
      .exists('Option 3 should be in summary');
    assert
      .dom('[data-test-boxel-picker-summary-item="4"]')
      .exists('Option 4 should be in summary');

    // Main list should be in original order
    assert.deepEqual(
      getMainListOptionIds(),
      ['1', '2', '3', '4'],
      'Main list stays in original order',
    );

    // Divider should exist between summary and main list
    assert
      .dom('[data-test-boxel-picker-divider]')
      .exists('Divider should exist between summary and main list');
  });

  test('picker toggles selection when option is clicked', async function (assert) {
    class SelectionController {
      @tracked selected: PickerOption[] = [];
    }

    const controller = new SelectionController();

    const onChange = (newSelected: PickerOption[]) => {
      controller.selected = newSelected;
    };

    await render(
      <template>
        <Picker
          @options={{testOptionsWithSelectAll}}
          @selected={{controller.selected}}
          @onChange={{onChange}}
          @label='Test'
        />
      </template>,
    );

    await click('[data-test-boxel-picker-trigger]');
    await waitFor('[data-test-boxel-picker-option-row]');

    // Click first option in main list
    const firstOption = document.querySelector(
      '.ember-power-select-options [data-test-boxel-picker-option-row="1"]',
    ) as HTMLElement;
    await click(
      firstOption.closest('.ember-power-select-option') as HTMLElement,
    );

    assert.strictEqual(
      controller.selected.length,
      1,
      'Should have one selected item',
    );
    assert.strictEqual(
      controller.selected[0].id,
      '1',
      'Should have selected first option',
    );

    await click(
      firstOption.closest('.ember-power-select-option') as HTMLElement,
    );
    assert.strictEqual(
      controller.selected.length,
      1,
      'Select-all option cannot be deselected',
    );
  });

  test('picker shows search input when searchEnabled is true', async function (assert) {
    class SelectionController {
      @tracked selected: PickerOption[] = [];
    }

    const controller = new SelectionController();

    const onChange = (newSelected: PickerOption[]) => {
      controller.selected = newSelected;
    };

    await render(
      <template>
        <Picker
          @options={{testOptionsWithSelectAll}}
          @selected={{controller.selected}}
          @onChange={{onChange}}
          @label='Test'
          @searchPlaceholder='Search...'
        />
      </template>,
    );

    await click('[data-test-boxel-picker-trigger]');
    await waitFor('[data-test-boxel-picker-before-options]');

    assert.dom('[data-test-boxel-picker-search]').exists();
    assert
      .dom('[data-test-boxel-picker-search] input')
      .hasAttribute('placeholder', 'Search...');
  });

  test('picker filters main list by search term while summary stays visible', async function (assert) {
    const selected = [testOptionsWithSelectAll[2]]; // Option 2

    await render(
      <template>
        <Picker
          @options={{testOptionsWithSelectAll}}
          @selected={{selected}}
          @onChange={{noop}}
          @label='Test'
          @searchPlaceholder='Search...'
        />
      </template>,
    );

    await click('[data-test-boxel-picker-trigger]');
    await waitFor('[data-test-boxel-picker-before-options]');

    await fillIn('[data-test-boxel-picker-search] input', '3');

    // Summary should still show selected Option 2
    assert
      .dom('[data-test-boxel-picker-summary-item="2"]')
      .exists('Selected option stays in summary during search');

    // Main list should only show matching option
    assert.deepEqual(
      getMainListOptionIds(),
      ['3'],
      'Main list shows only search-matching options',
    );
  });

  test('picker removes select-all when another option is selected', async function (assert) {
    class SelectionController {
      @tracked selected: PickerOption[] = [selectAllOption];
    }

    const controller = new SelectionController();

    const onChange = (newSelected: PickerOption[]) => {
      controller.selected = newSelected;
    };

    await render(
      <template>
        <Picker
          @options={{testOptionsWithSelectAll}}
          @selected={{controller.selected}}
          @onChange={{onChange}}
          @label='Test'
        />
      </template>,
    );

    await click('[data-test-boxel-picker-trigger]');
    await waitFor('[data-test-boxel-picker-option-row]');

    // Click first option in main list
    const firstOption = document.querySelector(
      '.ember-power-select-options [data-test-boxel-picker-option-row="1"]',
    ) as HTMLElement;
    await click(
      firstOption.closest('.ember-power-select-option') as HTMLElement,
    );

    assert.deepEqual(
      controller.selected.map((option) => option.id),
      ['1'],
      'select-all is removed once another option is selected',
    );
  });

  test('picker selects select-all when it is chosen after other options', async function (assert) {
    class SelectionController {
      @tracked selected: PickerOption[] = [testOptionsWithSelectAll[1]];
    }

    const controller = new SelectionController();

    const onChange = (newSelected: PickerOption[]) => {
      controller.selected = newSelected;
    };

    await render(
      <template>
        <Picker
          @options={{testOptionsWithSelectAll}}
          @selected={{controller.selected}}
          @onChange={{onChange}}
          @label='Test'
        />
      </template>,
    );

    await click('[data-test-boxel-picker-trigger]');
    await waitFor('[data-test-boxel-picker-option-row]');

    // Click select-all in before-options section
    await click('[data-test-boxel-picker-select-all]');

    assert.deepEqual(
      controller.selected.map((option) => option.id),
      ['select-all'],
      'select-all replaces existing selections when selected',
    );
  });

  test('picker hides remove button for select-all pill', async function (assert) {
    const selecteOptions: PickerOption[] = [selectAllOption];

    await render(
      <template>
        <Picker
          @options={{testOptionsWithSelectAll}}
          @selected={{selecteOptions}}
          @onChange={{noop}}
          @label='Test'
        />
      </template>,
    );

    assert
      .dom(
        '[data-test-boxel-picker-selected-item] button[aria-label="Remove item"]',
      )
      .doesNotExist('select-all pill should not render a remove button');
  });

  test('picker selects select-all when all options are selected', async function (assert) {
    class SelectionController {
      @tracked selected: PickerOption[] = [];
    }

    const controller = new SelectionController();

    const onChange = (newSelected: PickerOption[]) => {
      controller.selected = newSelected;
    };

    await render(
      <template>
        <Picker
          @options={{testOptionsWithSelectAll}}
          @selected={{controller.selected}}
          @onChange={{onChange}}
          @label='Test'
        />
      </template>,
    );

    await click('[data-test-boxel-picker-trigger]');
    await waitFor('[data-test-boxel-picker-option-row]');

    // Click all non-select-all options in the main list
    const optionRows = Array.from(
      document.querySelectorAll(
        '.ember-power-select-options [data-test-boxel-picker-option-row]',
      ),
    );

    for (const row of optionRows) {
      const li = (row as HTMLElement).closest(
        '.ember-power-select-option',
      ) as HTMLElement;
      await click(li);
    }

    assert.deepEqual(
      controller.selected.map((option) => option.id),
      ['select-all'],
      'select-all replaces individual selections when all are selected',
    );
  });

  test('picker selects select-all when no options are selected', async function (assert) {
    class SelectionController {
      @tracked selected: PickerOption[] = [];
    }

    const controller = new SelectionController();

    const onChange = (newSelected: PickerOption[]) => {
      controller.selected = newSelected;
    };

    await render(
      <template>
        <Picker
          @options={{testOptionsWithSelectAll}}
          @selected={{controller.selected}}
          @onChange={{onChange}}
          @label='Test'
        />
      </template>,
    );

    await click('[data-test-boxel-picker-trigger]');
    await waitFor('[data-test-boxel-picker-option-row]');

    // Click first option in main list to select it (removes select-all)
    const firstOption = document.querySelector(
      '.ember-power-select-options [data-test-boxel-picker-option-row="1"]',
    ) as HTMLElement;
    await click(
      firstOption.closest('.ember-power-select-option') as HTMLElement,
    );

    // Click it again to deselect
    await click(
      firstOption.closest('.ember-power-select-option') as HTMLElement,
    );

    assert.deepEqual(
      controller.selected.map((option) => option.id),
      ['select-all'],
      'select-all is selected when no options remain selected',
    );
  });

  test('picker selects select-all by default when selected is empty', async function (assert) {
    class SelectionController {
      @tracked selected: PickerOption[] = [];
    }

    const controller = new SelectionController();

    const onChange = (newSelected: PickerOption[]) => {
      controller.selected = newSelected;
    };

    await render(
      <template>
        <Picker
          @options={{testOptionsWithSelectAll}}
          @selected={{controller.selected}}
          @onChange={{onChange}}
          @label='Test'
        />
      </template>,
    );

    assert.deepEqual(
      controller.selected.map((option) => option.id),
      ['select-all'],
      'select-all is chosen when no initial selection is provided',
    );
  });

  test('picker throws when select-all option is missing', async function (assert) {
    setupOnerror((error: Error) => {
      assert.ok(
        /select-all option/i.test(error.message),
        'throws expected select-all option error',
      );
    });

    try {
      await render(
        <template>
          <Picker
            @options={{testOptions}}
            @selected={{emptyArray}}
            @onChange={{noop}}
            @label='Test'
          />
        </template>,
      );
    } finally {
      resetOnerror();
    }
  });

  test('picker limits displayed items when maxSelectedDisplay is set', async function (assert) {
    const selected = [testOptions[0], testOptions[1], testOptions[2]];

    await render(
      <template>
        <Picker
          @options={{testOptionsWithSelectAll}}
          @selected={{selected}}
          @onChange={{noop}}
          @label='Test'
          @maxSelectedDisplay={{2}}
        />
      </template>,
    );

    // Only 2 items should be visible
    assert.dom('[data-test-boxel-picker-selected-item]').exists({ count: 2 });
  });

  test('picker shows +X more pill when items exceed maxSelectedDisplay', async function (assert) {
    const selected = [
      testOptions[0],
      testOptions[1],
      testOptions[2],
      testOptions[3],
    ];

    await render(
      <template>
        <Picker
          @options={{testOptionsWithSelectAll}}
          @selected={{selected}}
          @onChange={{noop}}
          @label='Test'
          @maxSelectedDisplay={{2}}
        />
      </template>,
    );

    // 2 items + 1 more pill
    assert.dom('[data-test-boxel-picker-selected-item]').exists({ count: 2 });
    assert.dom('[data-test-boxel-picker-more-items]').exists();
    assert.dom('[data-test-boxel-picker-more-items]').hasText('+2 more');
  });

  test('picker does not show +X more pill when items do not exceed maxSelectedDisplay', async function (assert) {
    const selected = [testOptions[0], testOptions[1]];

    await render(
      <template>
        <Picker
          @options={{testOptionsWithSelectAll}}
          @selected={{selected}}
          @onChange={{noop}}
          @label='Test'
          @maxSelectedDisplay={{3}}
        />
      </template>,
    );

    // Only 2 items should be visible, no more pill
    assert.dom('[data-test-boxel-picker-selected-item]').exists({ count: 2 });
    assert.dom('[data-test-boxel-picker-more-items]').doesNotExist();
  });

  test('clicking +X more pill opens the dropdown', async function (assert) {
    const selected = [
      testOptions[0],
      testOptions[1],
      testOptions[2],
      testOptions[3],
    ];

    await render(
      <template>
        <Picker
          @options={{testOptionsWithSelectAll}}
          @selected={{selected}}
          @onChange={{noop}}
          @label='Test'
          @maxSelectedDisplay={{2}}
        />
      </template>,
    );

    assert.dom('[data-test-boxel-picker-more-items]').exists();

    // Click the more items pill
    await click('[data-test-boxel-picker-more-items]');
    await waitFor('[data-test-boxel-picker-option-row]');

    // Dropdown should be open with 4 options in main list
    assert
      .dom('.ember-power-select-options [data-test-boxel-picker-option-row]')
      .exists({ count: 4 });
  });

  test('picker shows all items when maxSelectedDisplay is not set', async function (assert) {
    const selected = [
      testOptions[0],
      testOptions[1],
      testOptions[2],
      testOptions[3],
    ];

    await render(
      <template>
        <Picker
          @options={{testOptionsWithSelectAll}}
          @selected={{selected}}
          @onChange={{noop}}
          @label='Test'
        />
      </template>,
    );

    // All 4 items should be visible
    assert.dom('[data-test-boxel-picker-selected-item]').exists({ count: 4 });
    assert.dom('[data-test-boxel-picker-more-items]').doesNotExist();
  });

  test('picker main list never reorders regardless of selection changes', async function (assert) {
    class SelectionController {
      @tracked selected: PickerOption[] = [testOptions[0], testOptions[1]];
    }

    const controller = new SelectionController();

    const onChange = (newSelected: PickerOption[]) => {
      controller.selected = newSelected;
    };

    await render(
      <template>
        <Picker
          @options={{testOptionsWithSelectAll}}
          @selected={{controller.selected}}
          @onChange={{onChange}}
          @label='Test'
        />
      </template>,
    );

    await click('[data-test-boxel-picker-trigger]');
    await waitFor('[data-test-boxel-picker-option-row]');

    // Main list should always be in original order
    assert.deepEqual(
      getMainListOptionIds(),
      ['1', '2', '3', '4'],
      'Initial main list order matches original options order',
    );

    // Uncheck Option 1
    const option1 = document.querySelector(
      '.ember-power-select-options [data-test-boxel-picker-option-row="1"]',
    ) as HTMLElement;
    await click(option1.closest('.ember-power-select-option') as HTMLElement);

    // Main list still in original order
    assert.deepEqual(
      getMainListOptionIds(),
      ['1', '2', '3', '4'],
      'Main list order unchanged after deselecting item',
    );

    // Check Option 3
    const option3 = document.querySelector(
      '.ember-power-select-options [data-test-boxel-picker-option-row="3"]',
    ) as HTMLElement;
    await click(option3.closest('.ember-power-select-option') as HTMLElement);

    // Main list still in original order
    assert.deepEqual(
      getMainListOptionIds(),
      ['1', '2', '3', '4'],
      'Main list order unchanged after selecting new item',
    );
  });

  test('picker main list order stays stable across close and reopen', async function (assert) {
    class SelectionController {
      @tracked selected: PickerOption[] = [testOptions[0], testOptions[1]];
    }

    const controller = new SelectionController();

    const onChange = (newSelected: PickerOption[]) => {
      controller.selected = newSelected;
    };

    await render(
      <template>
        <Picker
          @options={{testOptionsWithSelectAll}}
          @selected={{controller.selected}}
          @onChange={{onChange}}
          @label='Test'
        />
      </template>,
    );

    // Open, change selection, close, reopen
    await click('[data-test-boxel-picker-trigger]');
    await waitFor('[data-test-boxel-picker-option-row]');

    // Uncheck Option 1, check Option 3
    const option1 = document.querySelector(
      '.ember-power-select-options [data-test-boxel-picker-option-row="1"]',
    ) as HTMLElement;
    await click(option1.closest('.ember-power-select-option') as HTMLElement);

    const option3 = document.querySelector(
      '.ember-power-select-options [data-test-boxel-picker-option-row="3"]',
    ) as HTMLElement;
    await click(option3.closest('.ember-power-select-option') as HTMLElement);

    // Close
    await click('[data-test-boxel-picker-trigger]');

    // Reopen
    await click('[data-test-boxel-picker-trigger]');
    await waitFor('[data-test-boxel-picker-option-row]');

    // Main list still in original order after reopen
    assert.deepEqual(
      getMainListOptionIds(),
      ['1', '2', '3', '4'],
      'Main list order stays the same after close and reopen',
    );

    // Summary shows currently selected items
    assert
      .dom('[data-test-boxel-picker-summary-item="2"]')
      .exists('Option 2 in summary');
    assert
      .dom('[data-test-boxel-picker-summary-item="3"]')
      .exists('Option 3 in summary');
  });

  test('picker summary section hidden when select-all is active', async function (assert) {
    class SelectionController {
      @tracked selected: PickerOption[] = [selectAllOption];
    }

    const controller = new SelectionController();

    await render(
      <template>
        <Picker
          @options={{testOptionsWithSelectAll}}
          @selected={{controller.selected}}
          @onChange={{noop}}
          @label='Test'
        />
      </template>,
    );

    await click('[data-test-boxel-picker-trigger]');
    await waitFor('[data-test-boxel-picker-option-row]');

    // Select-all should be shown in before-options
    assert
      .dom('[data-test-boxel-picker-select-all]')
      .exists('Select-all shown in before-options');

    // Summary section should not exist
    assert
      .dom('[data-test-boxel-picker-selected-summary]')
      .doesNotExist('Summary hidden when select-all is active');
  });

  test('picker deselects item from summary section', async function (assert) {
    class SelectionController {
      @tracked selected: PickerOption[] = [testOptions[0], testOptions[1]];
    }

    const controller = new SelectionController();

    const onChange = (newSelected: PickerOption[]) => {
      controller.selected = newSelected;
    };

    await render(
      <template>
        <Picker
          @options={{testOptionsWithSelectAll}}
          @selected={{controller.selected}}
          @onChange={{onChange}}
          @label='Test'
        />
      </template>,
    );

    await click('[data-test-boxel-picker-trigger]');
    await waitFor('[data-test-boxel-picker-option-row]');

    // Click Option 1 in the summary to deselect it
    await click('[data-test-boxel-picker-summary-item="1"]');

    assert.deepEqual(
      controller.selected.map((o) => o.id),
      ['2'],
      'Option 1 removed from selection when clicked in summary',
    );

    // Option 1 should now be unchecked in the main list
    assert
      .dom(
        '.ember-power-select-options [data-test-boxel-picker-option-row="1"][data-test-boxel-picker-option-selected="false"]',
      )
      .exists('Option 1 shows as unchecked in main list');
  });

  test('picker divider exists between summary and main list', async function (assert) {
    const selected = [testOptions[0], testOptions[1]];

    await render(
      <template>
        <Picker
          @options={{testOptionsWithSelectAll}}
          @selected={{selected}}
          @onChange={{noop}}
          @label='Test'
        />
      </template>,
    );

    await click('[data-test-boxel-picker-trigger]');
    await waitFor('[data-test-boxel-picker-option-row]');

    assert
      .dom('[data-test-boxel-picker-divider]')
      .exists('Divider exists between before-options and main list');
  });
});
