import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import CopyFileToRealmTool from '@cardstack/host/tools/copy-file-to-realm';
import ShowFileTool from '@cardstack/host/tools/show-file';

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

module('Integration | tools | copy-file-to-realm', function (hooks) {
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
    let toolService = getService('tool-service');
    let copyFileCommand = new CopyFileToRealmTool(toolService.toolContext);

    let result = await copyFileCommand.execute({
      sourceFileIdentifier: `${testRealmURL}hello.txt`,
      targetRealm: testRealm2URL,
    });

    assert.ok(result.newFileIdentifier, 'new file URL is returned');
    assert.true(
      result.newFileIdentifier.startsWith(testRealm2URL),
      'new file is in target realm',
    );

    let cardService = getService('card-service');
    let copied = await cardService.getSource(new URL(result.newFileIdentifier));
    assert.strictEqual(copied.status, 200, 'copied file exists');
    assert.strictEqual(copied.content, 'Hello World!', 'content matches');
  });

  test('handles filename conflicts by creating non-conflicting name', async function (assert) {
    let toolService = getService('tool-service');
    let copyFileCommand = new CopyFileToRealmTool(toolService.toolContext);

    // First, copy hello.txt to test2 realm so there is a conflict on the second copy
    await copyFileCommand.execute({
      sourceFileIdentifier: `${testRealmURL}hello.txt`,
      targetRealm: testRealm2URL,
    });

    // Copy again - should get a non-conflicting name
    let result = await copyFileCommand.execute({
      sourceFileIdentifier: `${testRealmURL}hello.txt`,
      targetRealm: testRealm2URL,
    });

    assert.ok(result.newFileIdentifier, 'new file URL is returned');
    assert.true(
      result.newFileIdentifier.startsWith(testRealm2URL),
      'new file is in target realm',
    );
    assert.notStrictEqual(
      result.newFileIdentifier,
      `${testRealm2URL}hello.txt`,
      'file URL is different from the original (conflict resolved)',
    );

    let cardService = getService('card-service');
    let copied = await cardService.getSource(new URL(result.newFileIdentifier));
    assert.strictEqual(copied.status, 200, 'copied file exists');
    assert.strictEqual(copied.content, 'Hello World!', 'content matches');
  });

  test('after copying, show file command switches to code submode with correct file URL', async function (assert) {
    let toolService = getService('tool-service');
    let operatorModeStateService = getService('operator-mode-state-service');

    operatorModeStateService.restore({
      stacks: [[]],
      submode: 'interact',
    });

    let copyFileCommand = new CopyFileToRealmTool(toolService.toolContext);

    let result = await copyFileCommand.execute({
      sourceFileIdentifier: `${testRealmURL}hello.txt`,
      targetRealm: testRealm2URL,
    });

    assert.ok(result.newFileIdentifier, 'new file URL is returned');

    let showFileCommand = new ShowFileTool(toolService.toolContext);
    await showFileCommand.execute({
      fileIdentifier: result.newFileIdentifier,
    });

    assert.strictEqual(
      operatorModeStateService.state?.submode,
      'code',
      'submode is switched to code',
    );
    assert.strictEqual(
      operatorModeStateService.state?.codePath,
      result.newFileIdentifier,
      'code path is set to the copied file URL',
    );
  });

  test('show file command opens a prefix-form file identifier', async function (assert) {
    let toolService = getService('tool-service');
    let operatorModeStateService = getService('operator-mode-state-service');
    let { virtualNetwork } = getService('network');
    let testRealmPrefix = '@test/show-realm/';
    virtualNetwork.addRealmMapping(testRealmPrefix, testRealmURL);
    try {
      operatorModeStateService.restore({
        stacks: [[]],
        submode: 'interact',
      });

      await new ShowFileTool(toolService.toolContext).execute({
        fileIdentifier: `${testRealmPrefix}hello.txt`,
      });

      assert.strictEqual(
        operatorModeStateService.state?.submode,
        'code',
        'submode is switched to code',
      );
      let codePath = operatorModeStateService.state?.codePath;
      assert.strictEqual(
        codePath ? virtualNetwork.toURL(codePath).href : undefined,
        `${testRealmURL}hello.txt`,
        'code path is the file the prefix-form identifier names',
      );
    } finally {
      // The code path is held in the prefix form, so it is cleared before the
      // prefix stops resolving.
      await operatorModeStateService.updateCodePath(null);
      virtualNetwork.removeRealmMapping(testRealmPrefix);
    }
  });

  test('copies a file named by prefix-form identifiers', async function (assert) {
    let toolService = getService('tool-service');
    let { virtualNetwork } = getService('network');
    let sourcePrefix = '@test/copy-source/';
    let targetPrefix = '@test/copy-target/';
    virtualNetwork.addRealmMapping(sourcePrefix, testRealmURL);
    virtualNetwork.addRealmMapping(targetPrefix, testRealm2URL);
    try {
      let result = await new CopyFileToRealmTool(
        toolService.toolContext,
      ).execute({
        sourceFileIdentifier: `${sourcePrefix}hello.txt`,
        targetRealm: targetPrefix,
      });

      assert.strictEqual(
        result.newFileIdentifier,
        `${targetPrefix}hello.txt`,
        'the new file identifier keeps the prefix form',
      );
      let response = await fetch(new URL('hello.txt', testRealm2URL));
      assert.strictEqual(response.status, 200, 'copied file exists');
      assert.strictEqual(
        await response.text(),
        'Hello World!',
        'content matches',
      );
    } finally {
      virtualNetwork.removeRealmMapping(sourcePrefix);
      virtualNetwork.removeRealmMapping(targetPrefix);
    }
  });

  test('errors when user does not have write permissions to target realm', async function (assert) {
    let toolService = getService('tool-service');
    let copyFileCommand = new CopyFileToRealmTool(toolService.toolContext);

    let realmService = getService('realm');
    realmService.logout();
    await realmService.login(testRealmURL);

    try {
      await copyFileCommand.execute({
        sourceFileIdentifier: `${testRealmURL}hello.txt`,
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
