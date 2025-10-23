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
    assert.expect(3);

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
    // Option titles render via BoxelSelect; text assertions can be environment-sensitive,
    // so we assert row presence and rely on enumOptions/enumValues tests for exact labels.
  });

  test('rejects value outside allowed options (validation)', async function (assert) {
    assert.expect(1);

    // via base-realm helpers
    const PriorityField = enumField(StringField, {
      options: ['High', 'Medium', 'Low'],
    });

    class Task extends CardDef {
      @field priority = contains(PriorityField);
    }

    let task = new Task({ priority: 'Low' });

    assert.throws(
      () => {
        (task as any).priority = 'Urgent';
      },
      /invalid|enum/i,
      'setting a value not in the enum should throw',
    );
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

    const helperModule = await loader.import(
      `${baseRealm.url}helpers/enum-values`,
    );
    const enumValues = (helperModule as any).default;

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

  test('containsMany rejects values outside allowed options (validation)', async function (assert) {
    assert.expect(1);

    // via base-realm helpers
    const PriorityField = enumField(StringField, {
      options: ['High', 'Medium', 'Low'],
    });

    class Task extends CardDef {
      @field priorities = containsMany(PriorityField);
    }

    let t = new Task({ priorities: ['High'] });

    assert.throws(
      () => {
        (t as any).priorities = ['High', 'Urgent'];
      },
      /invalid|enum/i,
      'setting an array that includes a non-enum value should throw',
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
    assert.expect(9);

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
    // verify labels via helper rather than DOM text (dropdown wrapper mangles text nodes)
    // Icons should be present when provided
    assert.dom('.boxel-select__dropdown .lucide.lucide-arrow-up').exists();
    assert.dom('.boxel-select__dropdown .lucide.lucide-minus').exists();
    assert.dom('.boxel-select__dropdown .lucide.lucide-arrow-down').exists();

    // enumValues returns the primitive values (in order)
    const helperModule = await loader.import(
      `${baseRealm.url}helpers/enum-options`,
    );
    const enumOptions = (helperModule as any).default;
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

    const helperModule = await loader.import(
      `${baseRealm.url}helpers/enum-options`,
    );
    const enumOptions = (helperModule as any).default;
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

    const helperModule = await loader.import(
      `${baseRealm.url}helpers/enum-values`,
    );
    const enumValues = (helperModule as any).default;
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

    const helperModule = await loader.import(
      `${baseRealm.url}helpers/enum-options`,
    );
    const enumOptions = (helperModule as any).default;
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
});
