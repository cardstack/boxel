import { module, test } from 'qunit';
import { setupRenderingTest } from 'test-app/tests/helpers';
import { click, render, waitFor, fillIn } from '@ember/test-helpers';
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
});
