import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';
import { Loader } from '@cardstack/runtime-common/loader';

import CreateSpecCommand from '@cardstack/host/commands/create-specs';

import { Spec } from 'https://cardstack.com/base/spec';

import {
  testRealmURL,
  setupCardLogs,
  setupIntegrationTestRealm,
  setupLocalIndexing,
} from '../../helpers';
import { setupBaseRealm } from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

module('Integration | Command | create-specs', function (hooks) {
  setupRenderingTest(hooks);
  const realmName = 'Create Spec Test Realm';
  let loader: Loader;
  let createSpecCommand: CreateSpecCommand;

  hooks.beforeEach(function () {
    loader = getService('loader-service').loader;
    let commandService = getService('command-service');
    createSpecCommand = new CreateSpecCommand(commandService.commandContext);
  });

  setupLocalIndexing(hooks);
  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });
  setupBaseRealm(hooks);
  setupCardLogs(
    hooks,
    async () => await loader.import(`${baseRealm.url}card-api`),
  );

  hooks.beforeEach(async function () {
    await setupIntegrationTestRealm({
      mockMatrixUtils,
      realmURL: testRealmURL,
      contents: {
        'test-card.gts': `import { CardDef, field, contains } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

export class TestCard extends CardDef {
  static displayName = 'Test Card';
  @field name = contains(StringField);
}`,
        'test-field.gts': `import { FieldDef } from 'https://cardstack.com/base/card-api';

export class TestField extends FieldDef {
  static displayName = 'Test Field';
}`,
        'app-card.gts': `import { CardDef } from 'https://cardstack.com/base/card-api';

export class AppCard extends CardDef {
  static displayName = 'App Card';
}`,
        'test-component.gts': `import Component from '@glimmer/component';

export default class TestComponent extends Component {
  static displayName = 'Test Component';
}`,
        'test-command.gts': `import { Command } from '@cardstack/runtime-common';

export default class TestCommand extends Command {
  static displayName = 'Test Command';
}`,
        '.realm.json': `{ "name": "${realmName}" }`,
      },
    });
  });

  test('creates spec with correct type for card definition', async function (assert) {
    const result = await createSpecCommand.execute({
      codeRef: {
        module: `${testRealmURL}test-card.gts`,
        name: 'TestCard',
      },
      targetRealm: testRealmURL,
    });

    assert.ok(result.specs?.[0], 'Spec was created');
    assert.ok(result.specs[0].id, 'Spec has an ID');

    // Get the spec from store to verify its properties
    const store = getService('store');
    const savedSpec = (await store.get(result.specs[0].id!)) as Spec;

    assert.strictEqual(savedSpec.specType, 'card', 'Spec type is card');
    assert.strictEqual(
      savedSpec.title,
      'TestCard',
      'Spec title matches codeRef name',
    );
    assert.strictEqual(
      savedSpec.ref?.module,
      `${testRealmURL}test-card.gts`,
      'Spec ref module is correct',
    );
    assert.strictEqual(
      savedSpec.ref?.name,
      'TestCard',
      'Spec ref name is correct',
    );
  });

  test('creates spec with correct type for field definition', async function (assert) {
    const result = await createSpecCommand.execute({
      codeRef: {
        module: `${testRealmURL}test-field.gts`,
        name: 'TestField',
      },
      targetRealm: testRealmURL,
    });

    assert.ok(result.specs?.[0], 'Spec was created');

    const store = getService('store');
    const savedSpec = (await store.get(result.specs[0].id!)) as Spec;

    assert.strictEqual(savedSpec.specType, 'field', 'Spec type is field');
  });

  test('creates spec with correct type for app definition', async function (assert) {
    const result = await createSpecCommand.execute({
      codeRef: {
        module: `${testRealmURL}app-card.gts`,
        name: 'AppCard',
      },
      targetRealm: testRealmURL,
    });

    assert.ok(result.specs?.[0], 'Spec was created');

    const store = getService('store');
    const savedSpec = (await store.get(result.specs[0].id!)) as Spec;

    assert.strictEqual(savedSpec.specType, 'app', 'Spec type is app');
  });

  test('creates spec with correct type for component definition', async function (assert) {
    const result = await createSpecCommand.execute({
      codeRef: {
        module: `${testRealmURL}test-component.gts`,
        name: 'TestComponent',
      },
      targetRealm: testRealmURL,
    });

    assert.ok(result.specs?.[0], 'Spec was created');

    const store = getService('store');
    const savedSpec = (await store.get(result.specs[0].id!)) as Spec;

    assert.strictEqual(
      savedSpec.specType,
      'component',
      'Spec type is component',
    );
  });

  test('creates spec with correct type for command definition', async function (assert) {
    const result = await createSpecCommand.execute({
      codeRef: {
        module: `${testRealmURL}test-command.gts`,
        name: 'TestCommand',
      },
      targetRealm: testRealmURL,
    });

    assert.ok(result.specs?.[0], 'Spec was created');

    const store = getService('store');
    const savedSpec = (await store.get(result.specs[0].id!)) as Spec;

    assert.strictEqual(savedSpec.specType, 'command', 'Spec type is command');
  });

  test('throws error when export is not found in module', async function (assert) {
    try {
      await createSpecCommand.execute({
        codeRef: {
          module: `${testRealmURL}test-card.gts`,
          name: 'NonExistentExport', // Export that doesn't exist
        },
        targetRealm: testRealmURL,
      });
      assert.ok(false, 'Should have thrown an error');
    } catch (error) {
      assert.ok(error instanceof Error, 'Error is thrown');
      if (error instanceof Error) {
        assert.strictEqual(
          error.message,
          `Could not find declaration for NonExistentExport in ${testRealmURL}test-card.gts`,
        );
      }
    }
  });

  test('uses current realm when targetRealm is not provided', async function (assert) {
    const result = await createSpecCommand.execute({
      codeRef: {
        module: `${testRealmURL}test-card.gts`,
        name: 'TestCard',
      },
      // No targetRealm provided
    });

    assert.ok(result.specs?.[0], 'Spec was created');
    assert.ok(result.specs[0].id, 'Spec has an ID');

    // Verify the spec was created in the current realm
    const store = getService('store');
    const savedSpec = (await store.get(result.specs[0].id!)) as Spec;
    assert.ok(
      savedSpec.id?.startsWith(testRealmURL),
      'Spec was created in the current realm',
    );
  });

  test('creates multiple specs when codeRef.name is not provided', async function (assert) {
    const result = await createSpecCommand.execute({
      module: `${testRealmURL}test-card.gts`,
      targetRealm: testRealmURL,
    });

    assert.ok(result.specs, 'Specs array was created');
    assert.ok(result.specs.length > 0, 'At least one spec was created');

    // Verify each spec was created correctly
    const store = getService('store');
    for (const spec of result.specs) {
      assert.ok(spec.id, 'Spec has an ID');
      const savedSpec = (await store.get(spec.id!)) as Spec;
      assert.ok(savedSpec.specType, 'Spec has a type');
      assert.ok(savedSpec.title, 'Spec has a title');
      assert.ok(savedSpec.ref?.module, 'Spec has a module reference');
    }
  });
});
