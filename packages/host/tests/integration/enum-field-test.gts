import { RenderingTestContext, click } from '@ember/test-helpers';

import ArrowDownIcon from '@cardstack/boxel-icons/arrow-down';
import ArrowUpIcon from '@cardstack/boxel-icons/arrow-up';
import MinusIcon from '@cardstack/boxel-icons/minus';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import {
  PermissionsContextName,
  type Permissions,
  baseRealm,
  getField,
} from '@cardstack/runtime-common';
import { Loader } from '@cardstack/runtime-common/loader';

import {
  provideConsumeContext,
  setupCardLogs,
  setupIntegrationTestRealm,
} from '../helpers';
import {
  setupBaseRealm,
  StringField,
  field,
  contains,
  containsMany,
  CardDef,
  Component,
  serializeCard,
  createFromSerialized,
  getQueryableValue,
  enumField,
  enumOptions,
  enumValues,
  enumConfig,
  linksTo,
} from '../helpers/base-realm';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { renderCard } from '../helpers/render-component';
import { setupRenderingTest } from '../helpers/setup';
/* icons imported above */

let loader: Loader;

module('Integration | enumField', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks);

  hooks.beforeEach(function (this: RenderingTestContext) {
    let permissions: Permissions = { canWrite: true, canRead: true };
    provideConsumeContext(PermissionsContextName, permissions);
    loader = getService('loader-service').loader;
  });

  setupCardLogs(
    hooks,
    async () => await loader.import(`${baseRealm.url}card-api`),
  );

  test('edit renders a dropdown with the enum options', async function (assert) {
    assert.expect(4);

    // enumField available via base-realm helpers

    // This assertion makes the test fail early until enumField exists
    assert.strictEqual(
      typeof enumField,
      'function',
      'enumField factory exists (intentional fail until implemented)',
    );

    const PriorityField = enumField(StringField, {
      options: ['High', 'Medium', 'Low'],
    });

    class Task extends CardDef {
      @field priority = contains(PriorityField);
      static edit = class Edit extends Component<typeof this> {
        <template>
          <@fields.priority />
        </template>
      };
    }

    let task = new Task({ priority: 'Low' });
    await renderCard(loader, task, 'edit');

    // Expect the enum editor to be a BoxelSelect dropdown
    assert.dom('.boxel-select').exists('renders a BoxelSelect trigger');

    // Open dropdown and expect the provided options
    await click('.boxel-select');
    assert
      .dom('.boxel-select__dropdown .boxel-select-option-text')
      .exists({ count: 3 }, 'shows all enum options');
    // Assert option text to prevent regressions like boolean rendering
    let primLabels = Array.from(
      document.querySelectorAll(
        '.boxel-select__dropdown .boxel-select-option-text',
      ),
    ).map((el) => (el.textContent || '').trim());
    assert.deepEqual(
      primLabels,
      ['High', 'Medium', 'Low'],
      'dropdown shows correct primitive labels in order',
    );
  });

  test('programmatic set outside options does not throw (UI remains constrained)', async function (assert) {
    assert.expect(2);

    // via base-realm helpers
    const PriorityField = enumField(StringField, {
      options: ['High', 'Medium', 'Low'],
    });

    class Task extends CardDef {
      @field priority = contains(PriorityField);
    }

    let task = new Task({ priority: 'Low' });
    (task as any).priority = 'Urgent';
    assert.strictEqual(
      task.priority,
      'Urgent',
      'value can be set programmatically',
    );
    // helpers still report configured options
    assert.deepEqual(enumValues(task, 'priority'), ['High', 'Medium', 'Low']);
  });

  test('enumValues helper returns configured options', async function (assert) {
    assert.expect(2);

    // via base-realm helpers
    const PriorityField = enumField(StringField, {
      options: ['High', 'Medium', 'Low'],
    });

    class Task extends CardDef {
      @field priority = contains(PriorityField);
    }

    let t = new Task({ priority: 'High' });
    let values = enumValues(t, 'priority');
    assert.ok(Array.isArray(values), 'enumValues returns an array');
    assert.deepEqual(
      values,
      ['High', 'Medium', 'Low'],
      'enumValues returns configured options in order',
    );
  });

  test('containsMany renders dropdowns for each enum item and supports add', async function (assert) {
    assert.expect(4);

    // via base-realm helpers
    const PriorityField = enumField(StringField, {
      options: ['High', 'Medium', 'Low'],
    });

    class Task extends CardDef {
      @field priorities = containsMany(PriorityField);
      static edit = class Edit extends Component<typeof this> {
        <template>
          <@fields.priorities />
        </template>
      };
    }

    let task = new Task({ priorities: ['High', 'Low'] });
    await renderCard(loader, task, 'edit');

    // contains-many editor exists and shows two selects
    assert
      .dom('[data-test-contains-many="priorities"]')
      .exists('containsMany editor is rendered');
    assert
      .dom('[data-test-contains-many="priorities"] .boxel-select')
      .exists({ count: 2 }, 'renders two selects for two items');

    // Add a new item, should render a third select
    await click('[data-test-contains-many="priorities"] [data-test-add-new]');
    assert
      .dom('[data-test-contains-many="priorities"] .boxel-select')
      .exists({ count: 3 }, 'renders third select after add');

    // Open the third select and verify options
    let selects = document.querySelectorAll(
      '[data-test-contains-many="priorities"] .boxel-select',
    );
    await click(selects[2] as Element);
    assert
      .dom('.boxel-select__dropdown .boxel-select-option-text')
      .exists({ count: 3 }, 'shows all enum options');
    // Row presence is sufficient; specific labels covered in other tests
  });

  test('containsMany programmatic set outside options does not throw', async function (assert) {
    assert.expect(1);

    // via base-realm helpers
    const PriorityField = enumField(StringField, {
      options: ['High', 'Medium', 'Low'],
    });

    class Task extends CardDef {
      @field priorities = containsMany(PriorityField);
    }

    let t = new Task({ priorities: ['High'] });
    (t as any).priorities = ['High', 'Urgent'];
    assert.deepEqual(
      t.priorities,
      ['High', 'Urgent'],
      'values can be set programmatically',
    );
  });

  test('serialization round-trip preserves enum value(s)', async function (assert) {
    assert.expect(4);

    const PriorityField = enumField(StringField, {
      options: ['High', 'Medium', 'Low'],
    });

    class Task extends CardDef {
      @field priority = contains(PriorityField);
      @field priorities = containsMany(PriorityField);
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Task },
      },
    });

    // Single value
    let t1 = new Task({ priority: 'Medium' });
    let doc1 = serializeCard(t1);
    let t1b = (await createFromSerialized(
      doc1.data,
      doc1,
      new URL('http://localhost:4202/test/'),
    )) as Task;
    assert.strictEqual(t1b.priority, 'Medium', 'single enum value round-trips');

    // Plural values
    let t2 = new Task({ priorities: ['Low', 'High'] });
    let doc2 = serializeCard(t2);
    let t2b = (await createFromSerialized(
      doc2.data,
      doc2,
      new URL('http://localhost:4202/test/'),
    )) as Task;
    assert.ok(
      Array.isArray(t2b.priorities),
      'plural enum round-trips as array',
    );
    assert.deepEqual(
      t2b.priorities,
      ['Low', 'High'],
      'plural enum values round-trip in order',
    );

    // Ensure unchanged original instances for sanity
    assert.strictEqual(
      t1.priority,
      'Medium',
      'original single remains unchanged',
    );
  });

  test('queryableValue delegates to base field for enums', async function (assert) {
    assert.expect(2);

    const PriorityField = enumField(StringField, {
      options: ['High', 'Medium', 'Low'],
    });

    class Task extends CardDef {
      @field priority = contains(PriorityField);
      @field priorities = containsMany(PriorityField);
    }

    let task = new Task({ priority: 'High', priorities: ['Low', 'Medium'] });
    let singleField = getField(task, 'priority');
    let pluralField = getField(task, 'priorities');

    let qSingle = getQueryableValue(singleField as any, task.priority);
    let qPlural = getQueryableValue(pluralField as any, task.priorities);

    assert.strictEqual(
      qSingle,
      'High',
      'single enum queryableValue is scalar string',
    );
    assert.deepEqual(
      qPlural,
      ['Low', 'Medium'],
      'plural enum queryableValue is array of strings',
    );
  });

  test('single enum accepts null and serializes as null', async function (assert) {
    assert.expect(3);

    const PriorityField = enumField(StringField, {
      options: ['High', 'Medium', 'Low'],
    });

    class Task extends CardDef {
      @field priority = contains(PriorityField);
    }

    let t = new Task({ priority: null as any });
    // queryableValue for null returns null (not string)
    let fieldRef = getField(t, 'priority');
    let q = getQueryableValue(fieldRef as any, t.priority);
    assert.strictEqual(q, null, 'queryableValue for null is null');

    // register card so it can be identified for serialization
    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Task },
      },
    });

    // serialize null
    let doc = serializeCard(t);
    assert.ok(doc.data?.attributes, 'has attributes');
    let attrPriority = (doc.data!.attributes as any).priority;
    assert.strictEqual(
      Object.prototype.hasOwnProperty.call(
        doc.data!.attributes as any,
        'priority',
      )
        ? attrPriority
        : null,
      null,
      'serializes priority as null when set to null (or omits attribute)',
    );
  });

  test('containsMany enum handles empty arrays and null members', async function (assert) {
    assert.expect(4);

    const PriorityField = enumField(StringField, {
      options: ['High', 'Medium', 'Low'],
    });

    class Task extends CardDef {
      @field priorities = containsMany(PriorityField);
    }

    // Empty array → queryableValue is null (for SQLite limitation)
    let t1 = new Task({ priorities: [] as any });
    let fieldRef = getField(t1, 'priorities');
    let q = getQueryableValue(fieldRef as any, t1.priorities);
    assert.strictEqual(q, null, 'queryableValue for empty array is null');

    // register card so it can be identified for serialization
    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Task },
      },
    });

    // Array with null element serializes with null preserved
    let t2 = new Task({ priorities: [null as any, 'Medium'] });
    let doc = serializeCard(t2);
    assert.ok(doc.data?.attributes, 'has attributes');
    let arr = (doc.data!.attributes as any).priorities as any[];
    assert.ok(Array.isArray(arr), 'serialized priorities is an array');
    assert.deepEqual(arr, [null, 'Medium'], 'preserves null element in array');
  });

  test('enumField edit respects @canEdit (computed fields are disabled)', async function (assert) {
    assert.expect(2);

    const PriorityField = enumField(StringField, {
      options: ['High', 'Medium', 'Low'],
    });

    class Task extends CardDef {
      @field priorityRaw = contains(PriorityField);
      @field priority = contains(PriorityField, {
        computeVia: function (this: Task) {
          return this.priorityRaw;
        },
      });
    }

    let t = new Task({ priorityRaw: 'High' });
    await renderCard(loader, t, 'edit');

    // Non-computed select is enabled (aria-disabled is "false")
    assert
      .dom('[data-test-field="priorityRaw"] .boxel-select')
      .hasAttribute(
        'aria-disabled',
        'false',
        'non-computed enum should be enabled',
      );

    // Computed select is disabled
    assert
      .dom('[data-test-field="priority"] .boxel-select')
      .hasAttribute(
        'aria-disabled',
        'true',
        'computed enum should be disabled',
      );
  });

  test('rich options API renders labels and stores primitive values', async function (assert) {
    assert.expect(10);

    const PriorityField = enumField(StringField, {
      options: [
        { value: 'high', label: 'High', icon: ArrowUpIcon },
        { value: 'medium', label: 'Medium', icon: MinusIcon },
        { value: 'low', label: 'Low', icon: ArrowDownIcon },
      ],
    });

    class Task extends CardDef {
      @field priority = contains(PriorityField);
      static edit = class Edit extends Component<typeof this> {
        <template>
          <@fields.priority />
        </template>
      };
    }

    let t = new Task({ priority: 'medium' });
    await renderCard(loader, t, 'edit');

    // Dropdown shows rich labels
    await click('.boxel-select');
    assert
      .dom('.boxel-select__dropdown .boxel-select-option-text')
      .exists({ count: 3 }, 'renders three option rows');
    let richLabels = Array.from(
      document.querySelectorAll(
        '.boxel-select__dropdown .boxel-select-option-text',
      ),
    ).map((el) => (el.textContent || '').trim());
    assert.deepEqual(
      richLabels,
      ['High', 'Medium', 'Low'],
      'dropdown shows correct rich labels in order',
    );
    // verify labels via helper rather than DOM text (dropdown wrapper mangles text nodes)
    // Icons should be present when provided
    assert.dom('.boxel-select__dropdown .lucide.lucide-arrow-up').exists();
    assert.dom('.boxel-select__dropdown .lucide.lucide-minus').exists();
    assert.dom('.boxel-select__dropdown .lucide.lucide-arrow-down').exists();

    // enumValues returns the primitive values (in order)
    let rich = enumOptions(t, 'priority');
    assert.ok(Array.isArray(rich), 'enumOptions returns an array');
    assert.strictEqual(rich[0]?.value, 'high', 'enumOptions exposes value');
    assert.strictEqual(rich[0]?.label, 'High', 'enumOptions exposes label');
    assert.strictEqual(rich[1]?.label, 'Medium', 'enumOptions exposes label');
    assert.strictEqual(rich[2]?.label, 'Low', 'enumOptions exposes label');
  });

  test('enumOptions returns objects for primitive enums', async function (assert) {
    assert.expect(3);

    const StatusField = enumField(StringField, { options: ['Open', 'Closed'] });
    class Ticket extends CardDef {
      @field status = contains(StatusField);
    }
    let t = new Ticket({ status: 'Open' });

    let options = enumOptions(t, 'status');
    assert.ok(Array.isArray(options), 'returns array');
    assert.strictEqual(options[0]?.value, 'Open', 'value preserved');
    assert.strictEqual(
      options[0]?.label,
      'Open',
      'label defaults to String(value)',
    );
  });

  test('enumValues returns primitive values for rich enums', async function (assert) {
    assert.expect(2);

    const PriorityField = enumField(StringField, {
      options: [
        { value: 'high', label: 'High', icon: ArrowUpIcon },
        { value: 'medium', label: 'Medium', icon: MinusIcon },
        { value: 'low', label: 'Low', icon: ArrowDownIcon },
      ],
    });

    class Task extends CardDef {
      @field priority = contains(PriorityField);
    }

    let t = new Task({ priority: 'medium' });

    let values = enumValues(t, 'priority');
    assert.ok(Array.isArray(values), 'returns array');
    assert.deepEqual(
      values,
      ['high', 'medium', 'low'],
      'returns primitive values derived from rich options',
    );
  });

  test('enumOptions exposes icon for rich enums', async function (assert) {
    assert.expect(2);

    const PriorityField = enumField(StringField, {
      options: [
        { value: 'high', label: 'High', icon: ArrowUpIcon },
        { value: 'medium', label: 'Medium', icon: MinusIcon },
        { value: 'low', label: 'Low', icon: ArrowDownIcon },
      ],
    });
    class Task extends CardDef {
      @field priority = contains(PriorityField);
    }
    let t = new Task({ priority: 'high' });

    let options = enumOptions(t, 'priority');
    assert.strictEqual(options[0]?.icon, ArrowUpIcon, 'icon is propagated');
    assert.strictEqual(options[1]?.icon, MinusIcon, 'icon is propagated');
  });

  test('trigger shows selected label and icon for rich enum', async function (assert) {
    assert.expect(2);

    const PriorityField = enumField(StringField, {
      options: [
        { value: 'high', label: 'High', icon: ArrowUpIcon },
        { value: 'medium', label: 'Medium', icon: MinusIcon },
        { value: 'low', label: 'Low', icon: ArrowDownIcon },
      ],
    });

    class Task extends CardDef {
      @field priority = contains(PriorityField);
      static edit = class Edit extends Component<typeof this> {
        <template>
          <@fields.priority />
        </template>
      };
    }

    let t = new Task({ priority: 'medium' });
    await renderCard(loader, t, 'edit');

    // Trigger (closed state) shows the selected label and its icon
    // The selected label element should be present in the trigger
    assert
      .dom('.boxel-select .option-title')
      .exists('trigger shows selected label element');
    assert
      .dom('.boxel-select .lucide.lucide-minus')
      .exists('trigger shows selected icon');
  });

  test('selecting an option updates single enum value and trigger', async function (assert) {
    assert.expect(2);

    const PriorityField = enumField(StringField, {
      options: [
        { value: 'high', label: 'High', icon: ArrowUpIcon },
        { value: 'medium', label: 'Medium', icon: MinusIcon },
        { value: 'low', label: 'Low', icon: ArrowDownIcon },
      ],
    });

    class Task extends CardDef {
      @field priority = contains(PriorityField);
      static edit = class Edit extends Component<typeof this> {
        <template>
          <@fields.priority />
        </template>
      };
    }

    let t = new Task({ priority: 'medium' });
    await renderCard(loader, t, 'edit');

    // Open and choose 'Low'
    await click('.boxel-select');
    await click('[data-test-option="2"]');

    assert.strictEqual(
      t.priority,
      'low',
      'model value updates to selected value',
    );
    assert
      .dom('.boxel-select .lucide.lucide-arrow-down')
      .exists('trigger shows selected icon');
    // UI asserts: icon presence is a stable proxy; label text is verified elsewhere
  });

  test('selecting an option updates containsMany item', async function (assert) {
    assert.expect(1);

    const PriorityField = enumField(StringField, {
      options: [
        { value: 'high', label: 'High', icon: ArrowUpIcon },
        { value: 'medium', label: 'Medium', icon: MinusIcon },
        { value: 'low', label: 'Low', icon: ArrowDownIcon },
      ],
    });

    class Task extends CardDef {
      @field priorities = containsMany(PriorityField);
      static edit = class Edit extends Component<typeof this> {
        <template>
          <@fields.priorities />
        </template>
      };
    }

    let t = new Task({ priorities: ['high', 'low'] });
    await renderCard(loader, t, 'edit');

    // Open the second select and choose 'Medium' (index 1)
    let triggers = document.querySelectorAll(
      '[data-test-contains-many="priorities"] .boxel-select',
    );
    await click(triggers[1] as Element);
    await click('[data-test-option="1"]');

    assert.deepEqual(t.priorities, ['high', 'medium'], 'second item updates');
    // UI text is verified in other tests; value change is sufficient here
  });

  test('dynamic options provider resolves options per instance (intentional fail until implemented)', async function (assert) {
    assert.expect(1);

    class CrmApp extends CardDef {
      @field globalPriorityOptions = containsMany(StringField);
    }

    const PriorityField = enumField(StringField, {
      options: function (this: any) {
        return this.crmApp?.globalPriorityOptions;
      },
    });

    class Task extends CardDef {
      @field crmApp = linksTo(CrmApp);
      @field priority = contains(PriorityField);
    }

    let app = new CrmApp({ globalPriorityOptions: ['High', 'Low'] });
    let t = new Task({ crmApp: app as any, priority: 'High' });

    const enumModule = await loader.import(`${baseRealm.url}enum`);
    const enumValues = (enumModule as any).enumValues;

    let values = enumValues(t, 'priority');
    assert.deepEqual(
      values,
      ['High', 'Low'],
      'resolves enum values from linked card',
    );
  });

  test('single-value: explicit null option renders with label and can be selected (intentional fail until implemented)', async function (assert) {
    assert.expect(5);

    const PriorityField = enumField(StringField, {
      options: [{ value: null, label: 'None' }, 'High'],
    });

    class Task extends CardDef {
      @field priority = contains(PriorityField);
      static edit = class Edit extends Component<typeof this> {
        <template>
          <@fields.priority />
        </template>
      };
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Task },
      },
    });

    let t = new Task({ priority: null });

    // Helpers include null only when provided explicitly
    const enumModule = await loader.import(`${baseRealm.url}enum`);
    const enumValues = (enumModule as any).enumValues;
    assert.deepEqual(
      enumValues(t, 'priority'),
      [null, 'High'],
      'enumValues includes explicit null',
    );

    await renderCard(loader, t, 'edit');
    await click('.boxel-select');
    let labels = Array.from(
      document.querySelectorAll(
        '.boxel-select__dropdown .boxel-select-option-text',
      ),
    ).map((el) => (el.textContent || '').trim());
    assert.deepEqual(
      labels,
      ['None', 'High'],
      'dropdown renders explicit null label and other options',
    );

    // Select the null option
    await click('[data-test-option="0"]');
    assert.strictEqual(
      t.priority,
      null,
      'selecting labeled null sets value to null',
    );

    // Round-trip serialization preserves null
    let doc = serializeCard(t);
    let t2 = (await createFromSerialized(
      doc.data,
      doc,
      new URL('http://localhost:4202/test/'),
    )) as Task;
    assert.strictEqual(
      t2.priority,
      null,
      'serialized/deserialized value stays null',
    );

    // Trigger should show the label for null (not placeholder)
    assert
      .dom('.boxel-select .option-title')
      .hasText('None', 'trigger shows null label');
  });

  test('single-value: placeholder shown when value is null and null is not in options; can be customized via unsetLabel (intentional fail until implemented)', async function (assert) {
    assert.expect(5);

    const PriorityField = enumField(StringField, { options: ['High', 'Low'] });

    class TaskA extends CardDef {
      @field priority = contains(PriorityField);
      static edit = class Edit extends Component<typeof this> {
        <template>
          <@fields.priority />
        </template>
      };
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          <@fields.priority @format='atom' />
        </template>
      };
    }

    let a = new TaskA({ priority: null });
    await renderCard(loader, a, 'edit');
    // Default placeholder (Boxel trigger renders placeholder text with this class)
    assert
      .dom('.boxel-select .boxel-trigger-placeholder')
      .hasText('Choose…', 'uses default placeholder');

    // Atom fallback in embedded/atom format renders a dash; also carries a marker
    await renderCard(loader, a, 'embedded');
    assert
      .dom('.option-title')
      .hasText('—', 'atom renders unset fallback dash');

    // Usage-level override via configuration.enum.unsetLabel
    class TaskB extends CardDef {
      @field priority = contains(PriorityField, {
        configuration: () => ({
          enum: { options: ['High', 'Low'], unsetLabel: 'Select one' },
        }),
      });
      static edit = class Edit extends Component<typeof this> {
        <template>
          <@fields.priority />
        </template>
      };
    }
    let b = new TaskB({ priority: null });
    await renderCard(loader, b, 'edit');
    assert
      .dom('.boxel-select .boxel-trigger-placeholder')
      .hasText('Select one', 'uses configured unsetLabel');

    // Helpers do not synthesize null when not in options
    assert.deepEqual(
      enumValues(a, 'priority'),
      ['High', 'Low'],
      'enumValues excludes null when not provided',
    );
    assert.deepEqual(
      enumValues(b, 'priority'),
      ['High', 'Low'],
      'enumValues excludes null even with unsetLabel',
    );
  });

  test('containsMany: explicit null option can be chosen per item (intentional fail until implemented)', async function (assert) {
    assert.expect(3);

    const PriorityField = enumField(StringField, {
      options: [{ value: null, label: 'None' }, 'High'],
    });

    class Task extends CardDef {
      @field priorities = containsMany(PriorityField);
      static edit = class Edit extends Component<typeof this> {
        <template>
          <@fields.priorities />
        </template>
      };
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Task },
      },
    });

    let t = new Task({ priorities: ['High', 'High'] });
    await renderCard(loader, t, 'edit');

    // Open second select and choose the explicit null option
    let triggers = document.querySelectorAll(
      '[data-test-contains-many="priorities"] .boxel-select',
    );
    await click(triggers[1] as Element);
    await click('[data-test-option="0"]');
    assert.deepEqual(t.priorities, ['High', null], 'second item set to null');

    // Helpers include null only when provided
    assert.deepEqual(
      enumValues(t, 'priorities'),
      [null, 'High'],
      'enumValues includes null when provided',
    );

    // Round-trip (array containing null should persist)
    let doc = serializeCard(t);
    let t2 = (await createFromSerialized(
      doc.data,
      doc,
      new URL('http://localhost:4202/test/'),
    )) as Task;
    assert.deepEqual(
      t2.priorities,
      ['High', null],
      'plural serialization preserves null items',
    );
  });

  test('atom-only: renders dash for null when unsetLabel is not provided', async function (assert) {
    assert.expect(1);

    const PriorityField = enumField(StringField, { options: ['High', 'Low'] });

    class Task extends CardDef {
      @field priority = contains(PriorityField);
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          <@fields.priority @format='atom' />
        </template>
      };
    }

    let t = new Task({ priority: null });
    await renderCard(loader, t, 'embedded');
    assert
      .dom('.option-title')
      .hasText('—', 'atom renders default dash for null');
  });

  test('atom-only: renders String(@model) when value not in options (value fallback)', async function (assert) {
    assert.expect(2);

    const PriorityField = enumField(StringField, { options: ['High', 'Low'] });

    class Task extends CardDef {
      @field priority = contains(PriorityField);
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          <@fields.priority @format='atom' />
        </template>
      };
    }

    let t = new Task({ priority: 'Unexpected' as any });
    await renderCard(loader, t, 'embedded');
    assert
      .dom('.option-title')
      .hasText('Unexpected', 'atom renders raw value when no matching option');
    assert
      .dom('[data-test-enum-atom-fallback]')
      .exists('atom sets fallback marker for unmatched value');
  });

  test('throws error for duplicate primitive option values', async function (assert) {
    assert.expect(1);

    const PriorityField = enumField(StringField, {
      options: ['High', 'High'],
    });
    class Task extends CardDef {
      @field priority = contains(PriorityField);
    }
    let t = new Task({ priority: 'High' });
    assert.throws(
      () => {
        // Accessing options triggers normalization and should throw
        enumOptions(t, 'priority');
      },
      /duplicate option value/i,
      'duplicate values should throw',
    );
  });

  test('throws error for duplicate values provided via usage-level configuration', async function (assert) {
    assert.expect(1);

    const PriorityField = enumField(StringField, { options: ['High', 'Low'] });
    class Task extends CardDef {
      @field priority = contains(PriorityField, {
        configuration: enumConfig(() => ({ options: ['Low', 'Low'] })),
      });
    }
    let t = new Task({ priority: 'Low' });
    assert.throws(
      () => {
        enumOptions(t, 'priority');
      },
      /duplicate option value/i,
      'duplicate values via usage-level config should throw',
    );
  });

  test('usage-level configuration function supplies options for contains() using parent instance', async function (assert) {
    assert.expect(3);

    // Base enum with static defaults
    const PriorityField = enumField(StringField, {
      options: ['High', 'Low'],
    });

    class Task extends CardDef {
      @field customOptions = containsMany(StringField);
      @field priority = contains(PriorityField, {
        // Access options from the parent Task instance
        configuration: enumConfig(function (this: Task) {
          return { options: this.customOptions };
        }),
      });
      static edit = class Edit extends Component<typeof this> {
        <template>
          <@fields.priority />
        </template>
      };
    }

    let t = new Task({
      customOptions: ['Urgent', 'Normal'],
      priority: 'Normal',
    });

    // Helpers should reflect usage-level configuration
    const enumModule = await loader.import(`${baseRealm.url}enum`);
    const enumValues = (enumModule as any).enumValues;
    assert.deepEqual(
      enumValues(t, 'priority'),
      ['Urgent', 'Normal'],
      'enumValues reflects usage-level options (replacing defaults)',
    );

    // The editor should render the usage-level options
    await renderCard(loader, t, 'edit');
    await click('.boxel-select');
    assert
      .dom('.boxel-select__dropdown .boxel-select-option-text')
      .exists({ count: 2 }, 'editor shows usage-level options');
    let usageLabels = Array.from(
      document.querySelectorAll(
        '.boxel-select__dropdown .boxel-select-option-text',
      ),
    ).map((el) => (el.textContent || '').trim());
    assert.deepEqual(
      usageLabels,
      ['Urgent', 'Normal'],
      'dropdown shows options from parent instance configuration',
    );
  });
});
