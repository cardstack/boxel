import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import CopyFileToRealmCommand from '@cardstack/host/commands/copy-file-to-realm';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
  setupRealmCacheTeardown,
  withCachedRealmSetup,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

const testRealm2URL = 'http://test-realm/test2/';

module('Integration | commands | copy-file-to-realm', function (hooks) {
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL, testRealm2URL],
  });

  setupRealmCacheTeardown(hooks);

  hooks.beforeEach(async function () {
    await withCachedRealmSetup(async () => {
      await setupIntegrationTestRealm({
        mockMatrixUtils,
        realmURL: testRealmURL,
        contents: {
          'hello.txt': 'Hello World!',
          'nested/deep.txt': 'Nested file content',
        },
      });

      await setupIntegrationTestRealm({
        mockMatrixUtils,
        realmURL: testRealm2URL,
        contents: {
          'existing.txt': 'I already exist',
        },
      });
    });

    let realmService = getService('realm');
    await realmService.login(testRealmURL);
    await realmService.login(testRealm2URL);
  });

  test('copies file to target realm', async function (assert) {
    let commandService = getService('command-service');
    let copyFileCommand = new CopyFileToRealmCommand(
      commandService.commandContext,
    );

    let result = await copyFileCommand.execute({
      sourceFileUrl: `${testRealmURL}hello.txt`,
      targetRealm: testRealm2URL,
    });

    assert.ok(result.newFileUrl, 'new file URL is returned');
    assert.true(
      result.newFileUrl.startsWith(testRealm2URL),
      'new file is in target realm',
    );

    let cardService = getService('card-service');
    let copied = await cardService.getSource(new URL(result.newFileUrl));
    assert.strictEqual(copied.status, 200, 'copied file exists');
    assert.strictEqual(copied.content, 'Hello World!', 'content matches');
  });

  test('handles filename conflicts by creating non-conflicting name', async function (assert) {
    let commandService = getService('command-service');
    let copyFileCommand = new CopyFileToRealmCommand(
      commandService.commandContext,
    );

    // First, copy hello.txt to test2 realm so there is a conflict on the second copy
    await copyFileCommand.execute({
      sourceFileUrl: `${testRealmURL}hello.txt`,
      targetRealm: testRealm2URL,
    });

    // Copy again - should get a non-conflicting name
    let result = await copyFileCommand.execute({
      sourceFileUrl: `${testRealmURL}hello.txt`,
      targetRealm: testRealm2URL,
    });

    assert.ok(result.newFileUrl, 'new file URL is returned');
    assert.true(
      result.newFileUrl.startsWith(testRealm2URL),
      'new file is in target realm',
    );
    assert.notStrictEqual(
      result.newFileUrl,
      `${testRealm2URL}hello.txt`,
      'file URL is different from the original (conflict resolved)',
    );

    let cardService = getService('card-service');
    let copied = await cardService.getSource(new URL(result.newFileUrl));
    assert.strictEqual(copied.status, 200, 'copied file exists');
    assert.strictEqual(copied.content, 'Hello World!', 'content matches');
  });

  test('errors when user does not have write permissions to target realm', async function (assert) {
    let commandService = getService('command-service');
    let copyFileCommand = new CopyFileToRealmCommand(
      commandService.commandContext,
    );

    let realmService = getService('realm');
    realmService.logout();
    await realmService.login(testRealmURL);

    try {
      await copyFileCommand.execute({
        sourceFileUrl: `${testRealmURL}hello.txt`,
        targetRealm: testRealm2URL,
      });
      assert.ok(false, 'should have thrown an error');
    } catch (error: any) {
      assert.ok(error instanceof Error, 'throws an error');
      assert.strictEqual(
        error.message,
        `Do not have write permissions to ${testRealm2URL}`,
        'error message indicates write permission issue',
      );
    }
  });
});
