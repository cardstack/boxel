import { module, test } from 'qunit';
import { setupRenderingTest } from 'test-app/tests/helpers';
import {
  click,
  render,
  waitFor,
  fillIn,
  triggerEvent,
} from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';
import { Picker, type PickerOption } from '@cardstack/boxel-ui/components';
import Ember from 'ember';

function noop() {}

module('Integration | Component | picker', function (hooks) {
  setupRenderingTest(hooks);

  const testOptions: PickerOption[] = [
    { id: '1', name: 'Option 1', icon: 'https://via.placeholder.com/20' },
    { id: '2', name: 'Option 2', icon: 'https://via.placeholder.com/20' },
    { id: '3', name: 'Option 3' },
    { id: '4', name: 'Option 4' },
  ];
  const selectAllOption: PickerOption = {
    id: 'select-all',
    name: 'All options',
    type: 'select-all',
  };
  const testOptionsWithSelectAll: PickerOption[] = [
    selectAllOption,
    ...testOptions,
  ];

  const emptyArray: PickerOption[] = [];

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

    assert.dom('[data-test-boxel-picker-option-row]').exists({ count: 5 });
  });

  test('picker groups selected items first when groupSelected is true', async function (assert) {
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

    // First two should be selected
    assert
      .dom(
        `[data-test-boxel-picker-option-row="2"][data-test-boxel-picker-option-selected]`,
      )
      .exists();
    assert
      .dom(
        `[data-test-boxel-picker-option-row="3"][data-test-boxel-picker-option-selected]`,
      )
      .exists();

    // Check for divider after selected items
    const divider = document.querySelector('[data-test-boxel-picker-divider]');
    assert
      .dom(divider)
      .exists('Divider should exist between selected and unselected');
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

    // Click first option
    const firstOption = document.querySelectorAll(
      '[data-test-boxel-picker-option-row]',
    )[1];
    await click(firstOption as HTMLElement);

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

    await click(firstOption as HTMLElement);
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

  test('picker keeps select-all and selected options first when searching', async function (assert) {
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
    await waitFor('[data-test-boxel-picker-option-row]');

    const optionIds = Array.from(
      document.querySelectorAll('[data-test-boxel-picker-option-row]'),
    ).map((el) =>
      (el as HTMLElement).getAttribute('data-test-boxel-picker-option-row'),
    );

    assert.deepEqual(
      optionIds,
      ['select-all', '2', '3'],
      'select-all stays first, then selected option, then matching unselected option',
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

    const secondOption = document.querySelectorAll(
      '[data-test-boxel-picker-option-row]',
    )[1];
    await click(secondOption as HTMLElement);

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

    const selectAllRow = document.querySelectorAll(
      '[data-test-boxel-picker-option-row]',
    )[0];
    await click(selectAllRow as HTMLElement);

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

    const optionRows = Array.from(
      document.querySelectorAll('[data-test-boxel-picker-option-row]'),
    );
    const nonSelectAllRows = optionRows.filter(
      (row) =>
        (row as HTMLElement).getAttribute(
          'data-test-boxel-picker-option-row',
        ) !== 'select-all',
    );

    for (const row of nonSelectAllRows) {
      await click(row as HTMLElement);
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

    const firstOption = document.querySelectorAll(
      '[data-test-boxel-picker-option-row]',
    )[1];

    await click(firstOption as HTMLElement);
    await click(firstOption as HTMLElement);

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
    let original = Ember.onerror;

    Ember.onerror = (error) => {
      assert.ok(
        /select-all option/i.test(error.message),
        'throws expected select-all option error',
      );
      // swallow so it doesn't become a "global failure"
      return true;
    };

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
      Ember.onerror = original;
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

    // Dropdown should be open and show all options
    assert.dom('[data-test-boxel-picker-option-row]').exists({ count: 5 });
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

  test('picker keeps unchecked item in selected section while hovering', async function (assert) {
    class SelectionController {
      @tracked selected: PickerOption[] = [testOptions[0], testOptions[1]]; // Option 1 and Option 2 selected
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

    // Get the option IDs before any interaction
    const getOptionIds = () =>
      Array.from(
        document.querySelectorAll('[data-test-boxel-picker-option-row]'),
      ).map((el) =>
        (el as HTMLElement).getAttribute('data-test-boxel-picker-option-row'),
      );

    // Initial order: select-all, then selected items (1, 2), then unselected (3, 4)
    assert.deepEqual(
      getOptionIds(),
      ['select-all', '1', '2', '3', '4'],
      'Initial order has selected items first',
    );

    // Hover over Option 1 (which is selected)
    const option1Row = document.querySelector(
      '[data-test-boxel-picker-option-row="1"]',
    ) as HTMLElement;
    await triggerEvent(option1Row, 'mouseenter');

    // Click to uncheck Option 1
    await click(option1Row);

    // Option 1 should still be in the selected section while hovering
    assert.deepEqual(
      getOptionIds(),
      ['select-all', '1', '2', '3', '4'],
      'Unchecked item stays in selected section while hovering',
    );

    // Verify Option 1 is actually unchecked (checkbox state)
    assert
      .dom('[data-test-boxel-picker-option-row="1"]')
      .hasAttribute(
        'data-test-boxel-picker-option-selected',
        'false',
        'Option 1 checkbox shows unchecked',
      );

    // Mouse leave - item should now move to unselected section
    await triggerEvent(option1Row, 'mouseleave');

    assert.deepEqual(
      getOptionIds(),
      ['select-all', '2', '1', '3', '4'],
      'After mouse leave, unchecked item moves to unselected section',
    );
  });

  test('picker keeps checked item in unselected section while hovering', async function (assert) {
    class SelectionController {
      @tracked selected: PickerOption[] = [testOptions[0]]; // Only Option 1 selected
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

    const getOptionIds = () =>
      Array.from(
        document.querySelectorAll('[data-test-boxel-picker-option-row]'),
      ).map((el) =>
        (el as HTMLElement).getAttribute('data-test-boxel-picker-option-row'),
      );

    // Initial order: select-all, then selected item (1), then unselected (2, 3, 4)
    assert.deepEqual(
      getOptionIds(),
      ['select-all', '1', '2', '3', '4'],
      'Initial order has selected items first',
    );

    // Hover over Option 2 (which is unselected)
    const option2Row = document.querySelector(
      '[data-test-boxel-picker-option-row="2"]',
    ) as HTMLElement;
    await triggerEvent(option2Row, 'mouseenter');

    // Click to check Option 2
    await click(option2Row);

    // Option 2 should still be in the unselected section while hovering
    assert.deepEqual(
      getOptionIds(),
      ['select-all', '1', '2', '3', '4'],
      'Checked item stays in unselected section while hovering',
    );

    // Verify Option 2 is actually checked (checkbox state)
    assert
      .dom('[data-test-boxel-picker-option-row="2"]')
      .hasAttribute(
        'data-test-boxel-picker-option-selected',
        'true',
        'Option 2 checkbox shows checked',
      );

    // Mouse leave - item should now move to selected section
    await triggerEvent(option2Row, 'mouseleave');

    assert.deepEqual(
      getOptionIds(),
      ['select-all', '1', '2', '3', '4'],
      'After mouse leave, checked item moves to selected section',
    );
  });

  test('picker divider stays in correct position while item is pinned', async function (assert) {
    class SelectionController {
      @tracked selected: PickerOption[] = [testOptions[0], testOptions[1]]; // Option 1 and 2 selected
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

    // Hover over Option 2 (last selected item)
    const option2Row = document.querySelector(
      '[data-test-boxel-picker-option-row="2"]',
    ) as HTMLElement;
    await triggerEvent(option2Row, 'mouseenter');

    // Click to uncheck Option 2
    await click(option2Row);

    // The divider should still appear after Option 2 (pinned in selected section)
    // since it's visually the last item in the selected section
    const divider = document.querySelector('[data-test-boxel-picker-divider]');
    assert.dom(divider).exists('Divider should exist while item is pinned');

    // Mouse leave
    await triggerEvent(option2Row, 'mouseleave');

    // After unpin, divider should now be after Option 1 (only remaining selected)
    const dividerAfterUnpin = document.querySelector(
      '[data-test-boxel-picker-divider]',
    );
    assert
      .dom(dividerAfterUnpin)
      .exists('Divider should still exist after unpin');
  });
});
