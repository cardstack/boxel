import { getOwner } from '@ember/owner';
import { RenderingTestContext } from '@ember/test-helpers';

import { module, skip, test } from 'qunit';

import ReadTextFileCommand from '@cardstack/host/commands/read-text-file';
import type CommandService from '@cardstack/host/services/command-service';

import RealmService from '@cardstack/host/services/realm';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  lookupService,
  testRealmURL,
  testRealmInfo,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

class StubRealmService extends RealmService {
  get defaultReadableRealm() {
    return {
      path: testRealmURL,
      info: testRealmInfo,
    };
  }
}

module('Integration | commands | read-text-file', function (hooks) {
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks);

  hooks.beforeEach(function (this: RenderingTestContext) {
    getOwner(this)!.register('service:realm', StubRealmService);
  });

  let readTextFileCommand: ReadTextFileCommand;
  hooks.beforeEach(async function () {
    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'test.txt': 'Hello World!',
        'subdir/nested.txt': 'I am nested.',
        'empty.txt': '',
        'data.json': JSON.stringify({ message: 'test data' }),
        'component.gts': `import Component from '@glimmer/component';\n\nexport default class TestComponent extends Component {}`,
      },
    });
    let commandService = lookupService<CommandService>('command-service');
    readTextFileCommand = new ReadTextFileCommand(
      commandService.commandContext,
    );
  });

  test('reads an existing text file', async function (assert) {
    let result = await readTextFileCommand.execute({
      path: 'test.txt',
      realm: testRealmURL,
    });

    assert.strictEqual(result.content, 'Hello World!');
  });

  test('reads a JSON file', async function (assert) {
    let result = await readTextFileCommand.execute({
      path: 'data.json',
      realm: testRealmURL,
    });

    assert.strictEqual(
      result.content,
      JSON.stringify({ message: 'test data' }),
    );
  });

  test('reads a GTS file', async function (assert) {
    let result = await readTextFileCommand.execute({
      path: 'component.gts',
      realm: testRealmURL,
    });

    assert.strictEqual(
      result.content,
      `import Component from '@glimmer/component';\nexport default class TestComponent extends Component {}`,
    );
  });

  // test is skipped because we can't catch command errors in host tests
  skip('throws error when file does not exist', async function (assert) {
    try {
      await readTextFileCommand.execute({
        path: 'nonexistent.txt',
        realm: testRealmURL,
      });
      assert.notOk(true, 'Should have thrown an error');
    } catch (error: any) {
      assert.ok(
        error.message.includes('Error reading file'),
        'Error message should mention reading file error',
      );
      assert.ok(
        error.message.includes('nonexistent.txt'),
        'Error message should include the file path',
      );
    }
  });

  // test is skipped because we can't catch command errors in host tests
  skip('throws error with invalid realm URL', async function (assert) {
    try {
      await readTextFileCommand.execute({
        path: 'test.txt',
        realm: 'invalid-url',
      });
      assert.notOk(true, 'Should have thrown an error');
    } catch (error: any) {
      assert.ok(
        error.message.includes('Error reading file') ||
          error.message.includes('Invalid URL'),
        'Error message should indicate URL or reading error',
      );
    }
  });

  test('reads file with subdirectory path', async function (assert) {
    let result = await readTextFileCommand.execute({
      path: 'subdir/nested.txt',
      realm: testRealmURL,
    });

    assert.strictEqual(result.content, 'I am nested.');
  });

  test('handles empty file', async function (assert) {
    let result = await readTextFileCommand.execute({
      path: 'empty.txt',
      realm: testRealmURL,
    });

    assert.strictEqual(result.content, '');
  });
});
