import { module, test } from 'qunit';
import { setupRenderingTest } from 'test-app/tests/helpers';
import {
  click,
  render,
  waitFor,
  fillIn,
  triggerKeyEvent,
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

    // Selected options should have checked checkboxes in the dropdown
    assert
      .dom(
        '[data-test-boxel-picker-option-row="1"] .picker-option-row__checkbox--selected',
      )
      .exists('Option 1 checkbox is checked');
    assert
      .dom(
        '[data-test-boxel-picker-option-row="2"] .picker-option-row__checkbox--selected',
      )
      .exists('Option 2 checkbox is checked');
    // Unselected options should have unchecked checkboxes
    assert
      .dom(
        '[data-test-boxel-picker-option-row="3"] .picker-option-row__checkbox--selected',
      )
      .doesNotExist('Option 3 checkbox is unchecked');
    assert
      .dom(
        '[data-test-boxel-picker-option-row="4"] .picker-option-row__checkbox--selected',
      )
      .doesNotExist('Option 4 checkbox is unchecked');
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
    // Checkbox should be checked for selected option
    assert
      .dom(
        '[data-test-boxel-picker-option-row="1"] .picker-option-row__checkbox--selected',
      )
      .exists('Option 1 checkbox is checked after selecting');

    // Click again to deselect — should fall back to select-all
    await click(
      firstOption.closest('.ember-power-select-option') as HTMLElement,
    );
    assert.strictEqual(
      controller.selected.length,
      1,
      'Select-all option cannot be deselected',
    );
    // Checkbox should be unchecked after deselecting
    assert
      .dom(
        '[data-test-boxel-picker-option-row="1"] .picker-option-row__checkbox--selected',
      )
      .doesNotExist('Option 1 checkbox is unchecked after deselecting');
  });

  // When a consumer reconstructs PickerOption objects on every render
  // rather than keeping object references stable, power-select's
  // identity-based multi-select toggle can't match the clicked option
  // against @selected and emits a duplicate-id selection. Picker
  // normalizes by id so a duplicate signals a toggle-off.
  test('picker toggles selection by id when consumer rebuilds option objects each render', async function (assert) {
    class SelectionController {
      @tracked selectedIds: string[] = [];

      get options(): PickerOption[] {
        return [
          { id: 'select-all', label: 'All', type: 'select-all' },
          { id: '1', label: 'Option 1' },
          { id: '2', label: 'Option 2' },
        ];
      }

      get selected(): PickerOption[] {
        if (this.selectedIds.length === 0) {
          return this.options.filter((o) => o.type === 'select-all');
        }
        return this.selectedIds.map((id) => ({ id, label: `Option ${id}` }));
      }
    }

    const controller = new SelectionController();

    const onChange = (newSelected: PickerOption[]) => {
      controller.selectedIds = newSelected
        .filter((o) => o.type !== 'select-all')
        .map((o) => o.id);
    };

    await render(
      <template>
        <Picker
          @options={{controller.options}}
          @selected={{controller.selected}}
          @onChange={{onChange}}
          @label='Test'
        />
      </template>,
    );

    await click('[data-test-boxel-picker-trigger]');
    await waitFor('[data-test-boxel-picker-option-row]');

    const optionOne = () =>
      document
        .querySelector(
          '.ember-power-select-options [data-test-boxel-picker-option-row="1"]',
        )!
        .closest('.ember-power-select-option') as HTMLElement;

    await click(optionOne());
    assert.deepEqual(
      controller.selectedIds,
      ['1'],
      'first click selects option 1',
    );

    await click(optionOne());
    assert.deepEqual(
      controller.selectedIds,
      [],
      'second click on the same option unselects it (no duplicate)',
    );
    assert
      .dom(
        '[data-test-boxel-picker-option-row="1"] .picker-option-row__checkbox--selected',
      )
      .doesNotExist('checkbox is unchecked after toggle off');
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
    // Option 1 checkbox should be checked, select-all unchecked
    assert
      .dom(
        '[data-test-boxel-picker-option-row="1"] .picker-option-row__checkbox--selected',
      )
      .exists('Option 1 checkbox is checked');
    assert
      .dom(
        '[data-test-boxel-picker-option-row="select-all"] .picker-option-row__checkbox--selected',
      )
      .doesNotExist('Select-all checkbox is unchecked');
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
    // Select-all checkbox should be checked, Option 1 unchecked
    assert
      .dom(
        '[data-test-boxel-picker-option-row="select-all"] .picker-option-row__checkbox--selected',
      )
      .exists('Select-all checkbox is checked');
    assert
      .dom(
        '[data-test-boxel-picker-option-row="1"] .picker-option-row__checkbox--selected',
      )
      .doesNotExist('Option 1 checkbox is unchecked after select-all');
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

    // No summary items other than select-all should exist in before-options
    assert
      .dom(
        '[data-test-boxel-picker-selected-summary] [data-test-boxel-picker-summary-item]',
      )
      .doesNotExist(
        'No individual selected items in summary when select-all is active',
      );
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

  test('ArrowDown highlights the first option in the main list', async function (assert) {
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

    const searchInput = '[data-test-boxel-picker-search] input';

    // Select-all is already highlighted on open via activateFirstItem
    assert
      .dom('[data-test-boxel-picker-select-all].picker-option-row--highlighted')
      .exists('Select-all in summary is highlighted first');

    // ArrowDown moves to the first main list option
    await triggerKeyEvent(searchInput, 'keydown', 'ArrowDown');

    assert
      .dom(
        '.ember-power-select-options .ember-power-select-option[aria-current="true"]',
      )
      .exists(
        'A main list option is highlighted after navigating past summary',
      );
  });

  test('ArrowDown and ArrowUp move through options', async function (assert) {
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

    const searchInput = '[data-test-boxel-picker-search] input';

    // Navigate past summary (selectAll) into main list
    await triggerKeyEvent(searchInput, 'keydown', 'ArrowDown'); // selectAll
    await triggerKeyEvent(searchInput, 'keydown', 'ArrowDown'); // first main

    const firstHighlighted = document.querySelector(
      '.ember-power-select-options .ember-power-select-option[aria-current="true"] [data-test-boxel-picker-option-row]',
    );
    const firstId = firstHighlighted?.getAttribute(
      'data-test-boxel-picker-option-row',
    );
    assert.ok(firstId, 'A main list option is highlighted');

    await triggerKeyEvent(searchInput, 'keydown', 'ArrowDown'); // second main

    const secondHighlighted = document.querySelector(
      '.ember-power-select-options .ember-power-select-option[aria-current="true"] [data-test-boxel-picker-option-row]',
    );
    const secondId = secondHighlighted?.getAttribute(
      'data-test-boxel-picker-option-row',
    );

    assert.notStrictEqual(
      firstId,
      secondId,
      'ArrowDown moves highlight to a different option',
    );

    // Move back up
    await triggerKeyEvent(searchInput, 'keydown', 'ArrowUp');

    const thirdHighlighted = document.querySelector(
      '.ember-power-select-options .ember-power-select-option[aria-current="true"] [data-test-boxel-picker-option-row]',
    );
    assert.strictEqual(
      thirdHighlighted?.getAttribute('data-test-boxel-picker-option-row'),
      firstId,
      'ArrowUp returns to the previous option',
    );
  });

  test('Enter selects the highlighted option and keeps dropdown open', async function (assert) {
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

    const searchInput = '[data-test-boxel-picker-search] input';

    // Navigate past summary into main list, then press Enter
    await triggerKeyEvent(searchInput, 'keydown', 'ArrowDown'); // selectAll
    await triggerKeyEvent(searchInput, 'keydown', 'ArrowDown'); // first main

    const highlighted = document.querySelector(
      '.ember-power-select-options .ember-power-select-option[aria-current="true"] [data-test-boxel-picker-option-row]',
    );
    const highlightedId = highlighted?.getAttribute(
      'data-test-boxel-picker-option-row',
    );

    await triggerKeyEvent(searchInput, 'keydown', 'Enter');

    assert.true(
      controller.selected.some((o) => o.id === highlightedId),
      `Highlighted option ${highlightedId} is selected after Enter`,
    );

    // Dropdown should still be open
    assert
      .dom('.ember-power-select-options')
      .exists('Dropdown remains open after Enter');
  });

  test('Enter on already-selected option deselects it without closing', async function (assert) {
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

    const searchInput = '[data-test-boxel-picker-search] input';
    const initialCount = controller.selected.length;

    // Navigate to the highlighted option and press Enter to toggle it off
    await triggerKeyEvent(searchInput, 'keydown', 'ArrowDown');
    await triggerKeyEvent(searchInput, 'keydown', 'Enter');

    assert.notStrictEqual(
      controller.selected.length,
      initialCount,
      'Selection changed after Enter on highlighted option',
    );

    // Dropdown should still be open
    assert
      .dom('.ember-power-select-options')
      .exists('Dropdown remains open after toggling selection via Enter');
  });

  test('Escape closes the dropdown', async function (assert) {
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

    await triggerKeyEvent(
      '[data-test-boxel-picker-search] input',
      'keydown',
      'Escape',
    );

    assert
      .dom('.ember-power-select-options')
      .doesNotExist('Dropdown is closed after Escape');
  });

  test('Arrow keys skip disabled options', async function (assert) {
    const optionsWithDisabled: PickerOption[] = [
      selectAllOption,
      { id: '1', label: 'Option 1' },
      { id: '2', label: 'Option 2', disabled: true },
      { id: '3', label: 'Option 3' },
    ];

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
          @options={{optionsWithDisabled}}
          @selected={{controller.selected}}
          @onChange={{onChange}}
          @label='Test'
        />
      </template>,
    );

    await click('[data-test-boxel-picker-trigger]');
    await waitFor('[data-test-boxel-picker-option-row]');

    const searchInput = '[data-test-boxel-picker-search] input';

    // Navigate: selectAll(summary) → option1(main) → skip disabled option2 → option3(main)
    await triggerKeyEvent(searchInput, 'keydown', 'ArrowDown'); // selectAll
    await triggerKeyEvent(searchInput, 'keydown', 'ArrowDown'); // option1
    await triggerKeyEvent(searchInput, 'keydown', 'ArrowDown'); // skip option2(disabled) → option3

    const highlighted = document.querySelector(
      '.ember-power-select-options .ember-power-select-option[aria-current="true"] [data-test-boxel-picker-option-row]',
    );
    assert.strictEqual(
      highlighted?.getAttribute('data-test-boxel-picker-option-row'),
      '3',
      'Disabled Option 2 is skipped, Option 3 is highlighted',
    );
  });

  test('Search filtering with keyboard navigation works on filtered results', async function (assert) {
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

    // Type to filter
    await fillIn('[data-test-boxel-picker-search] input', '3');

    // Only Option 3 should be in main list
    assert.deepEqual(
      getMainListOptionIds(),
      ['3'],
      'Only Option 3 in filtered list',
    );

    const searchInput = '[data-test-boxel-picker-search] input';

    // ArrowDown past selectAll summary, then to filtered option, then Enter
    await triggerKeyEvent(searchInput, 'keydown', 'ArrowDown'); // selectAll
    await triggerKeyEvent(searchInput, 'keydown', 'ArrowDown'); // option3
    await triggerKeyEvent(searchInput, 'keydown', 'Enter');

    assert.deepEqual(
      controller.selected.map((o) => o.id),
      ['3'],
      'Filtered option is selected via keyboard',
    );
  });

  test('ArrowUp from first main list option highlights last summary item', async function (assert) {
    const selected = [testOptions[0], testOptions[1]];

    class SelectionController {
      @tracked selected: PickerOption[] = selected;
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

    const searchInput = '[data-test-boxel-picker-search] input';

    // ArrowDown to highlight first main list option, then ArrowUp to go into summary
    await triggerKeyEvent(searchInput, 'keydown', 'ArrowDown');

    // Keep pressing ArrowUp until we get into the summary section
    // First ArrowUp should go to the last summary item (Option 2)
    await triggerKeyEvent(searchInput, 'keydown', 'ArrowUp');

    assert
      .dom(
        '[data-test-boxel-picker-selected-summary] .picker-option-row--highlighted',
      )
      .exists('A summary item is highlighted after ArrowUp from main list');
  });

  test('ArrowDown from last summary item highlights first main list option', async function (assert) {
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

    const searchInput = '[data-test-boxel-picker-search] input';

    // Select-all is already highlighted on open via activateFirstItem
    assert
      .dom('[data-test-boxel-picker-select-all].picker-option-row--highlighted')
      .exists('Select-all is highlighted');

    // ArrowDown should move to the first main list option
    await triggerKeyEvent(searchInput, 'keydown', 'ArrowDown');

    assert
      .dom(
        '[data-test-boxel-picker-selected-summary] .picker-option-row--highlighted',
      )
      .doesNotExist('Summary highlight is cleared');

    assert
      .dom(
        '.ember-power-select-options .ember-power-select-option[aria-current="true"]',
      )
      .exists('A main list option is highlighted');
  });

  test('Enter on highlighted summary select-all toggles it', async function (assert) {
    class SelectionController {
      @tracked selected: PickerOption[] = [testOptions[0]];
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

    const searchInput = '[data-test-boxel-picker-search] input';

    // ArrowDown to highlight select-all, then Enter
    await triggerKeyEvent(searchInput, 'keydown', 'ArrowDown');
    await triggerKeyEvent(searchInput, 'keydown', 'Enter');

    assert.deepEqual(
      controller.selected.map((o) => o.id),
      ['select-all'],
      'Select-all is toggled on via keyboard Enter',
    );

    // Dropdown should still be open
    assert
      .dom('.ember-power-select-options')
      .exists('Dropdown remains open after Enter on select-all');
  });

  test('ArrowUp from select-all does nothing (no wrap)', async function (assert) {
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

    const searchInput = '[data-test-boxel-picker-search] input';

    // Select-all is already highlighted on open via activateFirstItem
    assert
      .dom('[data-test-boxel-picker-select-all].picker-option-row--highlighted')
      .exists('Select-all is highlighted');

    // ArrowUp should do nothing (already at top)
    await triggerKeyEvent(searchInput, 'keydown', 'ArrowUp');

    assert
      .dom('[data-test-boxel-picker-select-all].picker-option-row--highlighted')
      .exists('Select-all remains highlighted after ArrowUp at boundary');
  });
});
