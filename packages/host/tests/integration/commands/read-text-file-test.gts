import { getOwner } from '@ember/owner';
import { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, skip, test } from 'qunit';

import ReadTextFileCommand from '@cardstack/host/commands/read-text-file';

import RealmService from '@cardstack/host/services/realm';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
  testRealmInfo,
  setupSnapshotRealm,
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
  let snapshot = setupSnapshotRealm(hooks, {
    mockMatrixUtils,
    async build({ loader }) {
      let loaderService = getService('loader-service');
      loaderService.loader = loader;
      await setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {
          'test.txt': 'Hello World!',
          'subdir/nested.txt': 'I am nested.',
          'empty.txt': '',
          'data.json': JSON.stringify({ message: 'test data' }),
          'component.gts': `import Component from '@glimmer/component';\nexport default class TestComponent extends Component {}`,
        },
        loader,
      });
      let commandService = getService('command-service');
      return {
        readTextFileCommand: new ReadTextFileCommand(
          commandService.commandContext,
        ),
      };
    },
  });

  hooks.beforeEach(function (this: RenderingTestContext) {
    getOwner(this)!.register('service:realm', StubRealmService);
  });

  let readTextFileCommand: ReadTextFileCommand;
  hooks.beforeEach(function () {
    ({ readTextFileCommand } = snapshot.get());
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

  test('uses text/plain accept header for requests', async function (assert) {
    let targetUrl = `${testRealmURL}test.txt`;
    let network = getService('network');
    let originalFetch = network.virtualNetwork.fetch;
    let acceptHeader: string | null = null;
    let stubFetch: typeof originalFetch = async (input, init) => {
      let request = input instanceof Request ? input : new Request(input, init);
      if (request.url === targetUrl) {
        acceptHeader = request.headers.get('Accept');
        return new Response('stubbed', { status: 200 });
      }
      return originalFetch(input, init);
    };
    network.virtualNetwork.fetch = stubFetch;
    try {
      await readTextFileCommand.execute({
        path: 'test.txt',
        realm: testRealmURL,
      });
    } finally {
      network.virtualNetwork.fetch = originalFetch;
    }
    assert.strictEqual(acceptHeader, 'text/plain');
  });
});
